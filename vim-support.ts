import { findClusterBreak } from '@codemirror/state';
import { getCellIndex } from './table-cell-utils';

// Obsidian's built-in Vim mode (codemirror-vim) — not exposed in obsidian.d.ts.
interface VimPos { line: number; ch: number }
// wordEnd/bigWord are moveByWords' own args (w/b/e/W/B/E/ge/gE all share this
// one motion, differing only by these two flags plus forward) — optional
// since moveByCharacters/moveByLines never set them. repeatIsExplicit is
// moveToLineOrEdgeOfDocument's own (gg/G) — true for a count-prefixed jump
// (e.g. "5gg"), where repeat means the target line number itself rather than
// "how many times".
interface VimMotionArgs { forward: boolean; repeat: number; wordEnd?: boolean; bigWord?: boolean; repeatIsExplicit?: boolean }
// vim.js's own evalInput calls motions as (cm, head, motionArgs, vim, inputState) —
// inputState.operator is set (e.g. 'delete') when this motion is computing an
// operator's range (e.g. "dw"), not a standalone cursor move (plain "w").
// Captured *before* vim.js's own clearInputState() replaces vim.inputState with
// a fresh object, so it reliably reflects the pending operator (or lack of one)
// regardless of when our motion actually runs.
interface VimInputState { operator?: string }
// vim.js's own per-editor vim state (cm.state.vim) — undocumented/private,
// but passed directly to every motion function as its own 4th argument, so
// reading/writing it needs no special access beyond typing it properly.
// lastHPos/lastHSPos are vim.js's own real curswant (ch-based and
// pixel-based respectively — codemirror-vim's own naming, "H" for
// Horizontal); lastMotion is the previously-run motion function reference
// (set automatically by vim.js's own processMotion right after calling
// whichever motion just ran, including our own defineMotion overrides —
// nothing needs to write this ourselves). See moveByLines' own comment for
// why relying on this only covers *within the same view* continuity — a
// fresh vim state is created per CodeMirror instance, so it resets across a
// table-row-crossing/table-entry/exit (a different inner EditorView).
interface VimState { lastHPos: number; lastHSPos: number; lastMotion: unknown }
type VimMotionFn = (cm: unknown, head: VimPos, motionArgs: VimMotionArgs, vim?: VimState, inputState?: VimInputState) => VimPos;
// Actions (unlike motions) don't return a new head — they perform their own
// side-effecting cm.setCursor()/replaceRange() calls directly. repeat here is
// "J"'s own meaning: how many lines to join (vim.js's own default is 2, i.e.
// join the current line with just the next one).
interface VimActionArgs { repeat: number }
type VimActionFn = (cm: unknown, actionArgs: VimActionArgs, vim?: unknown) => void;
interface VimApi {
	defineMotion(name: string, fn: VimMotionFn): void;
	defineAction(name: string, fn: VimActionFn): void;
	exitVisualMode(cm: unknown, moveHead?: boolean): void;
}
interface VimCm {
	getLine(line: number): string;
	lastLine(): number;
	getCursor(mode?: string): VimPos;
	setCursor(pos: VimPos): void;
	replaceRange(text: string, from: VimPos, to: VimPos): void;
	// Pixel x-coordinate of pos — the unit vim.js's own lastHSPos (and gj/gk's
	// own findPosV goalColumn) expects, since Markdown's proportional-width
	// text means a raw ch index isn't a stable visual column.
	charCoords(pos: VimPos, mode: 'div'): { left: number };
	// vim.js's own real gj/gk primitive — a genuine public method on the cm
	// adapter (unlike moveByScroll/moveToColumn/moveToEol, this is not part of
	// the private, unexposed `motions` table), so the plain-text case can
	// delegate to it directly rather than reimplementing visual-line stepping.
	// Confirmed unreliable specifically inside Obsidian's embedded table-cell
	// views (inconsistent hitSide/boundary detection) — the in-cell branch
	// uses lower-level coordsAtPos/posAtCoords (via InnerCmLike) instead,
	// bypassing this method's own flaky boundary heuristics for that case.
	findPosV(cur: VimPos, dir: number, unit: 'line', goalColumn: number): VimPos & { hitSide?: boolean };
}
// A found word's span, from vim.js's own findWord (see moveByWords).
interface VimWordSpan { from: number; to: number; line: number }

const getVim = (): VimApi | undefined =>
	(window as unknown as { CodeMirrorAdapter?: { Vim?: VimApi } }).CodeMirrorAdapter?.Vim;

// The inner EditorView, as seen from outside a synchronous vim motion callback —
// just enough to read back the post-crossing cursor position (see
// scheduleRowCrossing's resync step).
interface InnerCmLike {
	state: {
		doc: {
			lineAt(pos: number): { number: number; from: number };
			// 1-indexed, mirroring CM6's own Text.line(n) — needed to convert a
			// {line, ch} (0-indexed, vim's own convention) into a flat doc offset
			// for coordsAtPos/posAtCoords (see moveByDisplayLines' own in-cell
			// branch, which does this conversion in both directions every step).
			line(n: number): { from: number };
		};
		selection: { main: { head: number } };
		// vim.js's own per-view vim state — a plain property vim.js itself
		// assigns directly onto the CM6 state object (`cm.state.vim = {...}`,
		// not a proper StateField), so it's readable/writable from outside a
		// motion callback too. Undefined until vim.js's own maybeInitVimState
		// has run for this specific view (i.e. until at least one vim command
		// has actually been dispatched to it) — see resyncAfterDeferredMove's
		// own guard for why seeding is skipped when absent.
		vim?: VimState;
	};
	// Real CM6 EditorView methods (this interface is duck-typed against the
	// actual inner EditorView, not vim.js's own cm adapter — see moveByDisplayLines'
	// own comment on why these lower-level primitives are used instead of
	// vim.js's own findPosV for the in-cell case). null signals the coordinate
	// couldn't be resolved (e.g. out of the rendered viewport).
	coordsAtPos(pos: number): { top: number; bottom: number; left: number; right: number } | null;
	posAtCoords(coords: { x: number; y: number }, precise: boolean): number | null;
}

// Minimal shape needed to read the current table-cell cursor position from
// outside a synchronous vim motion callback (see scheduleRowCrossing).
// Kept duck-typed against Obsidian's real Editor rather than imported, for the
// same reason as VimSupportHost below.
interface EditorBridge {
	inTableCell: boolean;
	getCursor(): VimPos;
	getLine(line: number): string;
	activeCM?: InnerCmLike;
	cm?: InnerCmLike;
}

const getActiveEditor = (): EditorBridge | undefined =>
	(window as unknown as { app?: { workspace?: { activeEditor?: { editor?: EditorBridge } } } })
		.app?.workspace?.activeEditor?.editor;

// Minimal shape VimSupport needs from the host plugin — kept structural (duck-typed)
// rather than importing the concrete plugin class, so this module has no dependency
// on main.ts and can be lifted out (e.g. into a separate plugin) without untangling.
export interface VimSupportHost {
	// smartJoin here is the *existing* Emacs-side setting (Kill Line's
	// cross-line join already reuses it) — Vim's J reuses the same toggle and
	// the same underlying stripping logic (getBeginningOfLinePosition) rather
	// than introducing a separate setting, applying regardless of whether J is
	// used inside or outside a table cell.
	// smartHomeStandard gates Vim's `^` override the same way it gates the
	// physical Home key: off leaves `^` as vim's own native (whitespace-only)
	// behavior untouched; on (whether smartHomeAdvanced is also on or not)
	// routes through getBeginningOfLinePosition, whose own std/adv branching
	// then applies with no extra logic needed here.
	settings: {
		vimHlSupport: boolean;
		vimJkSupport: boolean;
		vimJoinSupport: boolean;
		vimCaretSupport: boolean;
		vimWordSupport: boolean;
		vimGgSupport: boolean;
		vimDisplayLineSupport: boolean;
		smartJoin: boolean;
		smartHomeStandard: boolean;
	};
	saveSettings(): Promise<void>;
	// Markdown-aware "smart" line-start position (list markers, blockquotes,
	// headings, etc. — see main.ts's own doc comment), used by Vim's J when
	// smartJoin is on, and by Vim's `^` when smartHomeStandard is on. Returns 0
	// (no stripping) when Smart Home itself (settings.smartHomeStandard) is off
	// — J's smart-join enhancement is built on the same position-detection
	// logic, so it naturally goes quiet too.
	getBeginningOfLinePosition(line: string, ch: number): number;
	// editor/cellIndex are passed through untyped (see EditorBridge) — the host's
	// real implementation casts back to its own Editor type internally. goalCh is
	// the desired column, relative to the landing <br>-segment's own start.
	// overshoot is how many logical lines (rows and/or <br>-segments) beyond the
	// current cell's own range still need to be consumed — see moveByLines.
	// Returns the outer {line, ch} landed on (or null), for goal-column resync.
	crossTableRowForCell(editor: unknown, cellIndex: number, forward: boolean, goalCh: number, overshoot: number): { line: number; ch: number } | null;
	// Vim's w/b/e cell-crossing (single cell only — no multi-cell count
	// precision, a deliberate scope cut mirroring j/k's own "known gap").
	// Finds the next/prev row (or exits the table entirely if there is none),
	// lands at the target cell's first/last <br>-segment content-start/end,
	// then refines to the nearest actual word boundary on that landed line
	// before dispatching. Returns the outer {line, ch} landed on (or null).
	crossTableRowForWord(editor: unknown, cellIndex: number, forward: boolean, bigWord: boolean, wordEnd: boolean): { line: number; ch: number } | null;
	// Vim's gg/G (and count-prefixed "5gg"/"5G"). explicitLine is the
	// 0-indexed absolute target line for a count-prefixed jump (null for
	// plain gg/G, which targets the document's own first/last line). Checks
	// whether the target line is itself a table row (isPositionInTable) and,
	// if so, reuses enterTableAtLine to land inside that row's leftmost cell
	// rather than on its raw markdown text — a note that happens to start or
	// end with a table, or a "50gg" landing inside one elsewhere in the
	// document, are both real possibilities worth getting right, not just the
	// "currently inside a cell, exiting" case. Otherwise lands at the smart
	// (Smart Home aware) position via setCursorViaCm. Returns the outer
	// {line, ch} landed on (or null).
	jumpToDocumentLine(editor: unknown, forward: boolean, explicitLine: number | null): { line: number; ch: number } | null;
	// Full (syntax-tree-based) table-membership check — confirms a cheap textual
	// pre-filter before committing to a table-entry landing (see scheduleTableEntry).
	isLinePartOfTable(editor: unknown, line: number, ch: number): boolean;
	// Lands on cellIndex's <br>-segment at goalCh, remaining logical lines in from
	// targetLine's own first/last segment (0 = that edge segment itself; walks
	// further rows if remaining doesn't fit within targetLine's own cell) — for
	// moving from plain text onto a table row. cellIndex is goalCellIndex, or 0
	// as a fallback. Returns the outer {line, ch} landed on (or null).
	enterTableAtLine(editor: unknown, targetLine: number, cellIndex: number, forward: boolean, goalCh: number, remaining: number): { line: number; ch: number } | null;
	// Vim's gj/gk row-crossing refinement — step 2, always preceded by a plain
	// crossTableRowForCell(editor, cellIndex, forward, 0, 1) call for step 1
	// (the "rough landing": land at the target row's own cellIndex, first/
	// last <br>-segment, ch clamped to 0 — no meaningful ch-based goal exists
	// for a pixel-driven motion, and single-row-crossing only, matching
	// crossTableRowForWord's own identical "no multi-row count precision"
	// scope cut, since gj/gk's own "remaining visual lines" count doesn't map
	// onto crossTableRowForCell's own <br>-segment-unit "overshoot" anyway —
	// one <br>-segment can span a different number of visual lines than
	// logical ones). vim-support.ts calls this step only after an additional
	// tick past that rough landing, once the newly-entered cell has had a
	// chance to actually render — gj/gk needs the target row's own *rendered*
	// layout to land on the correct visual line/pixel column, not knowable
	// until then. Reads the *current* inner view's own coordsAtPos/posAtCoords
	// to find the real x=pixelGoal position, and if it differs from the rough
	// landing, dispatches a *second* setCursorViaCm call to correct it —
	// reusing the same already-proven-safe function for both dispatches
	// (never a separate raw EditorView.dispatch) is the key architectural
	// change from the discarded prior attempt; see this branch's own design
	// notes for why an uncoordinated raw dispatch, layered on top of Ctrl-N/
	// P's own moveCursorUpInTable/DownInTable engine, is the likely cause of a
	// real, repeated vim.js key-dispatch corruption observed live. Never lets
	// the correction change which line the cursor is on (purely horizontal).
	// Returns the outer {line, ch} after correction (or the unchanged rough
	// landing if no correction was possible/needed).
	refineDisplayLineColumn(editor: unknown, pixelGoal: number): { line: number; ch: number } | null;
}

export class VimSupport {
	private readonly host: VimSupportHost;

	// Session-only (not persisted) — set once any feature is turned off, since
	// restoring vim's own default doesn't reliably take effect mid-session (see
	// each restore*'s own caveat). Turning that same feature (or another) back on
	// afterward does *not* clear this — once a restart is genuinely needed to
	// guarantee a clean state, it stays needed for the rest of the session.
	needsRestart = false;

	constructor(host: VimSupportHost) {
		this.host = host;
	}

	// Temporary diagnostic for the key-double-dispatch investigation (a single
	// physical keystroke sometimes reaching vim.js's own processCommand/
	// processMotion more than once — confirmed via Chrome's own repeat-count
	// log-collapsing badge showing an identical moveByLines call logged twice
	// in a row for one keystroke). Called as the very first line of every
	// motion/action override below, so the sequence/timestamp here can be
	// cross-referenced against main.ts's own raw keydown log (which fires
	// regardless of vim mode, including when a keystroke is wrongly falling
	// through to plain text insertion instead of being interpreted as a
	// motion at all). Remove once root-caused.
	private static dispatchSeq = 0;
	private logDispatch(name: string, extra: Record<string, unknown>): void {
		VimSupport.dispatchSeq += 1;
		// eslint-disable-next-line obsidianmd/rule-custom-message -- console.log requested explicitly for this temporary diagnostic.
		console.log('[UCH dispatch]', JSON.stringify({ seq: VimSupport.dispatchSeq, t: performance.now(), name, ...extra }));
	}

	// Pixel x-coordinate of pos, in whichever coordinate space the *other* end
	// of a given pixel-goal computation will consume it in. vim.js's own
	// cm.charCoords(pos, 'div') (CM5-compat "div" mode) returns coordinates
	// relative to the editor's own wrapper element; CM6's own real
	// coordsAtPos/posAtCoords (used directly by moveByDisplayLines' own in-cell
	// stepping, and by main.ts's refineDisplayLineColumn) return viewport-
	// relative coordinates instead — two different coordinate spaces. Mixing
	// them (computing a "fresh" goal via charCoords, then feeding it into
	// posAtCoords) was confirmed live to silently resolve to the wrong column
	// (always landing at ch 0). Whenever an inner table-cell view is
	// available, this uses the same raw coordsAtPos API those consumers use,
	// so the two stay in the same coordinate space; only when there's no inner
	// view at all (plain text) does it fall back to vim.js's own charCoords,
	// which findPosV's own real vim.js internals expect for that case.
	private static charCoordsLeft(vcm: VimCm, pos: VimPos, inner: InnerCmLike | undefined): number {
		if (inner) {
			const offset = inner.state.doc.line(pos.line + 1).from + pos.ch;
			const coords = inner.coordsAtPos(offset);
			if (coords) return coords.left;
		}
		return vcm.charCoords(pos, 'div').left;
	}

	// Converts a pixel goal between vim.js's own div-relative space and raw
	// CM6's viewport-relative space, via a same-reference-point offset rather
	// than replicating vim.js's own div-relative math from scratch:
	// `referencePos`'s own position is computable in *both* spaces via
	// charCoordsLeft (div-relative by omitting a view; viewport-relative by
	// passing a real CM6 view as `inner`), and the difference between them is
	// exactly the constant shift (the outer editor's own wrapper position)
	// that separates the two conventions — the same regardless of which
	// specific position is used as the reference, so this works identically
	// even when the only reference position at hand happens to be
	// degenerate/meaningless on its own (e.g. ch 0, forced by landing on a
	// too-short/empty line to visually test a goal against at all) — unlike
	// recomputing the goal itself "fresh" from that position would.
	private static convertPixelGoalSpace(vcm: VimCm, referencePos: VimPos, outerView: InnerCmLike, toSpace: 'div' | 'viewport', value: number): number {
		const divAtRef = VimSupport.charCoordsLeft(vcm, referencePos, undefined);
		const viewportAtRef = VimSupport.charCoordsLeft(vcm, referencePos, outerView);
		const offset = toSpace === 'div' ? divAtRef - viewportAtRef : viewportAtRef - divAtRef;
		return value + offset;
	}

	// Converts a stored *viewport-relative* pixel goal (carried across a
	// genuine table exit — see goalHSPosNeedsDivConversion's own comment)
	// into whichever space the *current* call's own consumer actually needs.
	// Still in-cell (a re-entry before ever landing on a usable plain-text
	// line): viewport-relative is already the right space, used as-is — no
	// conversion needed. Plain text: needs vim.js's own div-relative space
	// instead, via convertPixelGoalSpace.
	private static resolveViewportGoalForCurrentContext(vcm: VimCm, head: VimPos, editorNow: EditorBridge | undefined, viewportGoal: number): number {
		if (editorNow?.inTableCell) return viewportGoal;
		if (!editorNow?.cm) return VimSupport.charCoordsLeft(vcm, head, undefined);
		return VimSupport.convertPixelGoalSpace(vcm, head, editorNow.cm, 'div', viewportGoal);
	}

	// Call from the plugin's onload().
	setup(): void {
		if (this.host.settings.vimHlSupport) this.applyHl();
		if (this.host.settings.vimJkSupport) this.applyJk();
		if (this.host.settings.vimJoinSupport) this.applyJoin();
		if (this.host.settings.vimCaretSupport) this.applyCaret();
		if (this.host.settings.vimWordSupport) this.applyWords();
		if (this.host.settings.vimGgSupport) this.applyGg();
		if (this.host.settings.vimDisplayLineSupport) this.applyDisplayLines();
	}

	// Call from the plugin's onunload(). Best-effort only — see each restore*'s own caveat.
	teardown(): void {
		this.restoreHl();
		this.restoreJk();
		this.restoreJoin();
		this.restoreCaret();
		this.restoreWords();
		this.restoreDisplayLines();
		this.restoreGg();
	}

	setHlEnabled(on: boolean): void {
		this.setFeature(on, v => { this.host.settings.vimHlSupport = v; }, () => this.applyHl(), () => this.restoreHl());
	}

	setJkEnabled(on: boolean): void {
		this.setFeature(on, v => { this.host.settings.vimJkSupport = v; }, () => this.applyJk(), () => this.restoreJk());
	}

	setJoinEnabled(on: boolean): void {
		this.setFeature(on, v => { this.host.settings.vimJoinSupport = v; }, () => this.applyJoin(), () => this.restoreJoin());
	}

	setCaretEnabled(on: boolean): void {
		this.setFeature(on, v => { this.host.settings.vimCaretSupport = v; }, () => this.applyCaret(), () => this.restoreCaret());
	}

	setWordsEnabled(on: boolean): void {
		this.setFeature(on, v => { this.host.settings.vimWordSupport = v; }, () => this.applyWords(), () => this.restoreWords());
	}

	setGgEnabled(on: boolean): void {
		this.setFeature(on, v => { this.host.settings.vimGgSupport = v; }, () => this.applyGg(), () => this.restoreGg());
	}

	// Turning on is reliable and immediate. Turning off calls the restore-target
	// default, but per the caveat on each restore* function, that isn't guaranteed
	// to fully take effect until an app reload — so needsRestart latches on.
	private setFeature(on: boolean, setFlag: (v: boolean) => void, apply: () => void, restore: () => void): void {
		setFlag(on);
		if (on) {
			apply();
		} else {
			restore();
			this.needsRestart = true;
		}
		void this.host.saveSettings();
	}

	// Vim's own moveByCharacters, hardcoded (codemirror-vim's `motions` table is
	// write-only via defineMotion — there is no public API to read the previous
	// value before overriding it, so this is our restore target on toggle-off /
	// unload). If another plugin's vimrc customized 'moveByCharacters' before ours
	// loaded, restoring goes to this vim.js default rather than that customization.
	private static readonly VIM_DEFAULT_MOVE_BY_CHARACTERS: VimMotionFn = (_cm, head, motionArgs) => ({
		line: head.line,
		ch: motionArgs.forward ? head.ch + motionArgs.repeat : head.ch - motionArgs.repeat,
	});

	// Grapheme-cluster-aware replacement for h/l (moveByCharacters). Fixes two
	// native bugs observed in Obsidian's Vim mode inside Live Preview table cells:
	// (1) naive ch±repeat arithmetic miscounts multi-UTF-16-unit characters
	//     (e.g. surrogate-pair emoji), landing mid-character.
	// (2) h/l cross into the adjacent table cell even from a non-boundary
	//     position (e.g. the end of a non-last wrapped sub-line). By always
	//     computing and returning a position clamped within the current line
	//     ourselves, we never hand vim.js an out-of-range Pos for it to "fix" —
	//     which is where the cell-crossing appears to happen.
	private readonly moveByCharacters: VimMotionFn = (cm, head, motionArgs) => {
		this.logDispatch('moveByCharacters', { head, motionArgs });
		const lineText = (cm as VimCm).getLine(head.line);
		let ch = head.ch;
		for (let i = 0; i < motionArgs.repeat; i++) {
			const next = findClusterBreak(lineText, ch, motionArgs.forward);
			if (next === ch) break; // already at the line boundary; vim's h/l don't wrap
			ch = next;
		}
		return { line: head.line, ch };
	};

	private applyHl(): void {
		getVim()?.defineMotion('moveByCharacters', this.moveByCharacters);
	}

	// Best-effort restore — see needsRestart's own note: this does not reliably
	// take effect within a running session (cause unconfirmed), so a restart is
	// always offered as the guaranteed fix rather than relying on this alone.
	private restoreHl(): void {
		getVim()?.defineMotion('moveByCharacters', VimSupport.VIM_DEFAULT_MOVE_BY_CHARACTERS);
	}

	private applyJk(): void {
		getVim()?.defineMotion('moveByLines', this.moveByLines);
	}

	private restoreJk(): void {
		getVim()?.defineMotion('moveByLines', VimSupport.VIM_DEFAULT_MOVE_BY_LINES);
	}

	private applyJoin(): void {
		getVim()?.defineAction('joinLines', this.joinLines);
	}

	private restoreJoin(): void {
		getVim()?.defineAction('joinLines', VimSupport.VIM_DEFAULT_JOIN_LINES);
	}

	private applyCaret(): void {
		getVim()?.defineMotion('moveToFirstNonWhiteSpaceCharacter', this.moveToFirstNonWhiteSpaceCharacter);
	}

	private restoreCaret(): void {
		getVim()?.defineMotion('moveToFirstNonWhiteSpaceCharacter', VimSupport.VIM_DEFAULT_MOVE_TO_FIRST_NON_WS);
	}

	private applyWords(): void {
		getVim()?.defineMotion('moveByWords', this.moveByWords);
	}

	private restoreWords(): void {
		getVim()?.defineMotion('moveByWords', VimSupport.VIM_DEFAULT_MOVE_BY_WORDS);
	}

	private applyGg(): void {
		getVim()?.defineMotion('moveToLineOrEdgeOfDocument', this.moveToLineOrEdgeOfDocument);
	}

	private restoreGg(): void {
		getVim()?.defineMotion('moveToLineOrEdgeOfDocument', VimSupport.VIM_DEFAULT_MOVE_TO_LINE_OR_EDGE);
	}

	// --- w/b/e (moveByWords) — faithful port of vim.js's own word-motion
	// algorithm (src/vim.js's findWord/moveToWord + src/cm_adapter.ts's
	// isWordChar), since defineMotion is write-only and there is no API to
	// call through to vim.js's real implementation for the plain-text case.
	// w/b/e/W/B/E/ge/gE all share this one motion, distinguished only by
	// motionArgs (forward/wordEnd/bigWord).

	// Matches cm_adapter.ts's own wordChar regex exactly.
	private static readonly isWordChar = (ch: string): boolean => {
		return /[\w\p{Alphabetic}\p{Number}_]/u.test(ch);
	};

	// [0]: word chars. [1]: "punctuation" — not a word char, not whitespace.
	private static readonly WORD_CHAR_TEST: Array<(ch: string) => boolean> = [
		VimSupport.isWordChar,
		(ch: string) => !!ch && !VimSupport.isWordChar(ch) && !/\s/.test(ch),
	];
	// vim's WORD (bigWord): any non-whitespace run counts as one word.
	private static readonly BIG_WORD_CHAR_TEST: Array<(ch: string) => boolean> = [
		(ch: string) => /\S/.test(ch),
	];

	private static isLine(vcm: VimCm, line: number): boolean {
		return line >= 0 && line <= vcm.lastLine();
	}

	// Faithful port of vim.js's own findWord: locates the next/prev word span
	// from `cur`, walking line by line within this view's own bounds. Returns
	// null once it runs off the end/start of the view (cm's own line range) —
	// the live moveByWords override treats that as "hit a cell/buffer
	// boundary" and (inside a table cell) triggers a crossing; the
	// restore-target default leaves it as vim's own boundary-clamped behavior.
	private static findWord(
		vcm: VimCm, cur: VimPos, forward: boolean, bigWord: boolean, emptyLineIsWord: boolean,
	): VimWordSpan | null {
		let lineNum = cur.line;
		let pos = cur.ch;
		let line = vcm.getLine(lineNum);
		const dir = forward ? 1 : -1;
		const charTests = bigWord ? VimSupport.BIG_WORD_CHAR_TEST : VimSupport.WORD_CHAR_TEST;

		if (emptyLineIsWord && line === '') {
			lineNum += dir;
			line = vcm.getLine(lineNum);
			if (!VimSupport.isLine(vcm, lineNum)) return null;
			pos = forward ? 0 : line.length;
		}

		for (;;) {
			if (emptyLineIsWord && line === '') {
				return { from: 0, to: 0, line: lineNum };
			}
			const stop = dir > 0 ? line.length : -1;
			let wordStart = stop;
			let wordEnd = stop;
			while (pos !== stop) {
				let foundWord = false;
				for (let i = 0; i < charTests.length && !foundWord; i++) {
					if (charTests[i](line.charAt(pos))) {
						wordStart = pos;
						while (pos !== stop && charTests[i](line.charAt(pos))) {
							pos += dir;
						}
						wordEnd = pos;
						foundWord = wordStart !== wordEnd;
						if (wordStart === cur.ch && lineNum === cur.line && wordEnd === wordStart + dir) {
							// Started at the end of a word — keep looking for the next one.
							continue;
						}
						return {
							from: Math.min(wordStart, wordEnd + 1),
							to: Math.max(wordStart, wordEnd),
							line: lineNum,
						};
					}
				}
				if (!foundWord) pos += dir;
			}
			lineNum += dir;
			if (!VimSupport.isLine(vcm, lineNum)) return null;
			line = vcm.getLine(lineNum);
			pos = dir > 0 ? 0 : line.length;
		}
	}

	// Faithful port of vim.js's own moveToWord. Returns the computed position
	// (null only in the degenerate repeat<1 case, never reached in practice)
	// plus shortCircuit — true when the walk ran out of words before
	// consuming the full (possibly +1, per wordEnd/forward below) repeat
	// count, i.e. it hit findWord's boundary-clamped fallback.
	private static runMoveToWord(
		vcm: VimCm, cur: VimPos, repeat: number, forward: boolean, wordEnd: boolean, bigWord: boolean,
	): { pos: VimPos | null; shortCircuit: boolean; hitBoundary: boolean } {
		const curStart: VimPos = { line: cur.line, ch: cur.ch };
		const words: VimWordSpan[] = [];
		// w/b overshoot by one word on purpose (vim.js's own quirk) so it can
		// tell "started mid-word" apart from "started exactly on a word start".
		let effectiveRepeat = repeat;
		if ((forward && !wordEnd) || (!forward && wordEnd)) effectiveRepeat++;
		const emptyLineIsWord = !(forward && wordEnd);
		let walkCur = cur;
		// True the moment any findWord call in the loop genuinely finds
		// nothing left in this view — a more reliable "hit the view's own
		// boundary" signal than shortCircuit below, which (for the b/e cases,
		// where effectiveRepeat isn't incremented) can misreport false even
		// when the very first call already came back empty, since the single
		// synthesized fallback entry still happens to match effectiveRepeat's
		// own count.
		let hitBoundary = false;
		for (let i = 0; i < effectiveRepeat; i++) {
			const word = VimSupport.findWord(vcm, walkCur, forward, bigWord, emptyLineIsWord);
			if (!word) {
				hitBoundary = true;
				const eodCh = vcm.getLine(vcm.lastLine()).length;
				words.push(forward
					? { line: vcm.lastLine(), from: eodCh, to: eodCh }
					: { line: 0, from: 0, to: 0 });
				break;
			}
			words.push(word);
			walkCur = { line: word.line, ch: forward ? word.to - 1 : word.from };
		}
		const shortCircuit = words.length !== effectiveRepeat;
		const firstWord = words[0];
		let lastWord = words.pop();
		if (forward && !wordEnd) {
			// w
			if (!shortCircuit && firstWord && (firstWord.from !== curStart.ch || firstWord.line !== curStart.line)) {
				lastWord = words.pop();
			}
			return { pos: lastWord ? { line: lastWord.line, ch: lastWord.from } : null, shortCircuit, hitBoundary };
		} else if (forward && wordEnd) {
			// e
			return { pos: lastWord ? { line: lastWord.line, ch: lastWord.to - 1 } : null, shortCircuit, hitBoundary };
		} else if (!forward && wordEnd) {
			// ge
			if (!shortCircuit && firstWord && (firstWord.to !== curStart.ch || firstWord.line !== curStart.line)) {
				lastWord = words.pop();
			}
			return { pos: lastWord ? { line: lastWord.line, ch: lastWord.to } : null, shortCircuit, hitBoundary };
		} else {
			// b
			return { pos: lastWord ? { line: lastWord.line, ch: lastWord.from } : null, shortCircuit, hitBoundary };
		}
	}

	// Restore target — vim.js's own default moveByWords, hardcoded for the
	// same reason as VIM_DEFAULT_MOVE_BY_CHARACTERS. No crossing: a boundary
	// hit just clamps to the buffer's own edge, matching vim.js's real
	// (un-enhanced) behavior.
	private static readonly VIM_DEFAULT_MOVE_BY_WORDS: VimMotionFn = (cm, head, motionArgs) => {
		const vcm = cm as VimCm;
		const { pos } = VimSupport.runMoveToWord(
			vcm, head, motionArgs.repeat, motionArgs.forward, !!motionArgs.wordEnd, !!motionArgs.bigWord,
		);
		return pos ?? head;
	};

	// Live w/b/e/W/B/E/ge/gE. Same as the default everywhere except: inside a
	// table cell, hitting the cell's own boundary (hitBoundary) schedules a
	// crossing into the adjacent cell/row (or out of the table entirely),
	// deferred the same way scheduleRowCrossing is — the synchronous return
	// here is just the boundary-clamped placeholder vim.js's own clipping
	// already expects. Scoped to a single cell crossing (matches a plain
	// keystroke's repeat, effectively 1 boundary) — a count spanning more
	// than one cell/row isn't precisely handled, mirroring j/k's own
	// documented gap for the same reason (this session's scope decision).
	//
	// Crossing is only scheduled for a *standalone* motion keystroke (plain
	// w/b/e) — never when inputState.operator is set (e.g. "dw"/"cw"/"yw"),
	// since then this call is only computing the operator's target range, not
	// actually moving the cursor. Without this guard, e.g. "dw" on a cell's
	// last word would correctly empty the cell but then the deferred crossing
	// would *still* fire afterward, leaving the cursor in the next cell —
	// wrong regardless of table context, and it also stranded undo (u) in the
	// wrong cell's own vim state.
	private readonly moveByWords: VimMotionFn = (cm, head, motionArgs, _vim, inputState) => {
		this.logDispatch('moveByWords', { head, motionArgs, operator: inputState?.operator ?? null });
		const vcm = cm as VimCm;
		const forward = motionArgs.forward;
		const bigWord = !!motionArgs.bigWord;
		const wordEnd = !!motionArgs.wordEnd;
		const { pos, hitBoundary } = VimSupport.runMoveToWord(
			vcm, head, motionArgs.repeat, forward, wordEnd, bigWord,
		);
		const editorNow = getActiveEditor();
		if (hitBoundary && !inputState?.operator && editorNow?.inTableCell) {
			this.scheduleWordCrossing(forward, bigWord, wordEnd);
		}
		return pos ?? head;
	};

	// Deferred for the same crash-avoidance reason as scheduleRowCrossing —
	// crossing a view boundary from inside vim.js's own synchronous motion
	// call previously crashed clipCursorToContent.
	private scheduleWordCrossing(forward: boolean, bigWord: boolean, wordEnd: boolean): void {
		window.setTimeout(() => {
			const editor = getActiveEditor();
			if (!editor || !editor.inTableCell) return;
			const cellIndex = VimSupport.currentCellIndex() ?? getCellIndex(editor.getLine(editor.getCursor().line), editor.getCursor().ch);
			const landedOuter = this.host.crossTableRowForWord(editor, cellIndex, forward, bigWord, wordEnd);
			// Word-motion has no goal-column concept to resync (unlike j/k) —
			// nothing further needed once the crossing itself has landed.
			void landedOuter;
		}, 0);
	}

	// --- gg/G (moveToLineOrEdgeOfDocument) — ports vim.js's own logic
	// exactly, but the *current* cm's own firstLine()/lastLine() only span
	// the current view — the whole document's when in plain text (already
	// correct, matching the same reasoning that ruled out fixing 0/$), but
	// only the current table cell's own <br>-segment range when inside one
	// (the real gap: gg/G should always reach the actual document's own
	// first/last line, per this session's design). Always defers to a host
	// round-trip (jumpToDocumentLine) rather than only on a boundary hit —
	// unlike w/b/e, even an *already-correct* plain-text landing still needs
	// the host's table-membership check (the target line itself might happen
	// to be a table row, e.g. a note that starts/ends with one, or a
	// count-prefixed "50gg" landing inside one elsewhere in the document).

	// Restore target — vim.js's own default, hardcoded for the same reason as
	// VIM_DEFAULT_MOVE_BY_CHARACTERS. No table-awareness: matches vim.js's
	// real (un-enhanced) behavior, clamped within whatever cm it's handed.
	private static readonly VIM_DEFAULT_MOVE_TO_LINE_OR_EDGE: VimMotionFn = (cm, _head, motionArgs) => {
		const vcm = cm as VimCm;
		const lastLine = vcm.lastLine();
		const rawLine = motionArgs.repeatIsExplicit ? motionArgs.repeat - 1 : (motionArgs.forward ? lastLine : 0);
		const line = Math.max(0, Math.min(rawLine, lastLine));
		return { line, ch: VimSupport.findFirstNonWhiteSpaceCharacter(vcm.getLine(line)) };
	};

	// Live gg/G. Synchronous return mirrors the default (safe, clamped within
	// the current cm) *unless* the target line's raw text looks like a table
	// row (cheap textual pre-filter — same shortcut moveByLines' own
	// plain-text-to-table walk uses; the host's deferred jump does the real,
	// syntax-tree-confirmed check). Landing vim.js's own synchronous cursor
	// dispatch directly inside table markdown text triggers Obsidian's own
	// auto-creation of that cell's inner view — a *second*, independent
	// transition racing the deferred jumpToDocumentLine call a tick later,
	// which corrupted vim's own internal state (crashed in exitInsertMode).
	// Staying at the unchanged head instead avoids ever landing there
	// synchronously; the deferred call still performs the real jump either way.
	// Suppressed when an operator is pending (e.g. "dgg"/"dG"), for the same
	// reason as moveByWords/moveByLines' own guards: this call would then
	// only be computing the operator's linewise range, not actually moving
	// the cursor.
	private readonly moveToLineOrEdgeOfDocument: VimMotionFn = (cm, head, motionArgs, _vim, inputState) => {
		this.logDispatch('moveToLineOrEdgeOfDocument', { head, motionArgs, operator: inputState?.operator ?? null });
		const vcm = cm as VimCm;
		const forward = motionArgs.forward;
		const lastLine = vcm.lastLine();
		const rawLine = motionArgs.repeatIsExplicit ? motionArgs.repeat - 1 : (forward ? lastLine : 0);
		const line = Math.max(0, Math.min(rawLine, lastLine));
		const targetLineText = vcm.getLine(line);
		const looksLikeTableRow = targetLineText.trimStart().startsWith('|');
		const safePos = looksLikeTableRow
			? head
			: { line, ch: VimSupport.findFirstNonWhiteSpaceCharacter(targetLineText) };
		if (!inputState?.operator) {
			const explicitLine = motionArgs.repeatIsExplicit ? motionArgs.repeat - 1 : null;
			this.scheduleDocumentEdgeJump(forward, explicitLine);
		}
		return safePos;
	};

	private scheduleDocumentEdgeJump(forward: boolean, explicitLine: number | null): void {
		window.setTimeout(() => {
			const editor = getActiveEditor();
			if (!editor) return;
			this.host.jumpToDocumentLine(editor, forward, explicitLine);
		}, 0);
	}

	// vim.js's own findFirstNonWhiteSpaceCharacter: first non-whitespace char,
	// or line end if the line is entirely whitespace. Shared by the live
	// override's off-path (smartHomeStandard off — vim's native `^` must stay
	// untouched) and the hardcoded restore-target default below.
	private static findFirstNonWhiteSpaceCharacter(line: string): number {
		const firstNonWs = line.search(/\S/);
		return firstNonWs === -1 ? line.length : firstNonWs;
	}

	// Restore target for `^` on toggle-off/unload — vim.js's own default,
	// hardcoded for the same reason as VIM_DEFAULT_MOVE_BY_CHARACTERS.
	private static readonly VIM_DEFAULT_MOVE_TO_FIRST_NON_WS: VimMotionFn = (cm, head) => {
		const line = (cm as VimCm).getLine(head.line);
		return { line: head.line, ch: VimSupport.findFirstNonWhiteSpaceCharacter(line) };
	};

	// Vim's `^`. When smartHomeStandard is off, vim's own native behavior is
	// left untouched (whitespace-only skip) — unlike J's smartJoin, there is no
	// "off means UCH's own position logic" here, since getBeginningOfLinePosition
	// itself hardcodes 0 when smartHomeStandard is off (matching the physical
	// Home key's own off-state, which is vim's `0` — not `^`). When on (std or
	// adv — getBeginningOfLinePosition's own branching covers that), route
	// through the same Markdown-aware position Home/J already use, called with
	// line.length as ch so it always resolves past any prefix (non-toggling,
	// matching vim's own non-toggling `^`).
	private readonly moveToFirstNonWhiteSpaceCharacter: VimMotionFn = (cm, head) => {
		this.logDispatch('moveToFirstNonWhiteSpaceCharacter', { head });
		const line = (cm as VimCm).getLine(head.line);
		if (!this.host.settings.smartHomeStandard) {
			return { line: head.line, ch: VimSupport.findFirstNonWhiteSpaceCharacter(line) };
		}
		return { line: head.line, ch: this.host.getBeginningOfLinePosition(line, line.length || 1) };
	};

	// Vim's own joinLines default (see VIM_DEFAULT_MOVE_BY_CHARACTERS for why this
	// must be hardcoded rather than captured) — restore target for J on
	// toggle-off/unload. Mirrors vim.js's own default exactly: strip the next
	// line's leading whitespace only, insert one space (join with nothing if the
	// next line is entirely whitespace).
	private static readonly VIM_DEFAULT_JOIN_LINES: VimActionFn = (cm, actionArgs, vim) => {
		VimSupport.runJoinLines(cm as VimCm, actionArgs, vim as { visualMode?: boolean } | undefined, false, () => 0);
	};

	// Markdown-aware replacement for J (joinLines). When settings.smartJoin is on,
	// strips the next line's leading Markdown syntax (list markers, blockquotes,
	// headings, etc. — via host.getBeginningOfLinePosition, the same logic Kill
	// Line's own cross-line join already uses) instead of just whitespace, while
	// still inserting the same single space vim.js's own default does — keeping
	// J's familiar "space-joined" feel while adding the same smarter stripping
	// Kill Line already has. Off (the vim.js default) leaves J untouched.
	// Applies both inside and outside table cells — unlike h/l/j/k, this isn't a
	// Live-Preview-architecture fix, so there's no table-specific gap to scope to.
	private readonly joinLines: VimActionFn = (cm, actionArgs, vim) => {
		this.logDispatch('joinLines', { actionArgs });
		VimSupport.runJoinLines(
			cm as VimCm, actionArgs, vim as { visualMode?: boolean } | undefined,
			this.host.settings.smartJoin,
			(line, ch) => this.host.getBeginningOfLinePosition(line, ch),
		);
	};

	// Shared by joinLines and its restore-target default. Mirrors vim.js's own
	// joinLines structure (see vim.js source, action 'joinLines') — both the
	// normal-mode (repeat lines from cursor) and visual-mode (anchor..head)
	// paths converge on the same per-line join loop; only the per-join
	// whitespace-vs-Markdown-stripping decision differs by smartJoin.
	private static runJoinLines(
		vcm: VimCm, actionArgs: VimActionArgs, vim: { visualMode?: boolean } | undefined,
		smartJoin: boolean, getSmartPosition: (line: string, ch: number) => number,
	): void {
		let curStart: VimPos;
		let curEndLine: number;

		if (vim?.visualMode) {
			const anchor = vcm.getCursor('anchor');
			const head = vcm.getCursor('head');
			const anchorFirst = anchor.line < head.line || (anchor.line === head.line && anchor.ch <= head.ch);
			curStart = anchorFirst ? anchor : head;
			curEndLine = anchorFirst ? head.line : anchor.line;
		} else {
			// Repeat is the number of lines to join; vim.js's own minimum is 2
			// (plain "J" joins the current line with just the next one).
			const repeat = Math.max(actionArgs.repeat, 2);
			curStart = vcm.getCursor();
			curEndLine = Math.min(curStart.line + repeat - 1, vcm.lastLine());
		}

		let finalCh = 0;
		for (let i = curStart.line; i < curEndLine; i++) {
			// Re-read every iteration: a multi-line join (repeat > 2) grows
			// curStart.line's own length after each preceding join.
			finalCh = vcm.getLine(curStart.line).length;
			const nextLine = vcm.getLine(curStart.line + 1);
			let nextStartCh: number;
			let text: string;
			if (smartJoin) {
				nextStartCh = getSmartPosition(nextLine, nextLine.length || 1);
				text = ' ';
			} else {
				const firstNonSpace = nextLine.search(/\S/);
				if (firstNonSpace === -1) {
					nextStartCh = nextLine.length;
					text = '';
				} else {
					nextStartCh = firstNonSpace;
					text = ' ';
				}
			}
			vcm.replaceRange(text, { line: curStart.line, ch: finalCh }, { line: curStart.line + 1, ch: nextStartCh });
		}
		vcm.setCursor({ line: curStart.line, ch: finalCh });

		// Mirror vim.js's own joinLines: leave Visual mode once the join is
		// done. Without this, the editor stays in Visual mode afterwards,
		// where e.g. 'u' means "lowercase selection", not undo.
		if (vim?.visualMode) {
			getVim()?.exitVisualMode(vcm, false);
		}
	}

	// Hardcoded default for 'moveByLines' (see VIM_DEFAULT_MOVE_BY_CHARACTERS for why
	// this must be hardcoded rather than captured). Deliberately simplified vs.
	// vim.js's own pixel-based goal column (no tab/wrap-aware column math) — this is
	// only a restore target, not something a user should notice in practice.
	private static readonly VIM_DEFAULT_MOVE_BY_LINES: VimMotionFn = (cm, head, motionArgs) => {
		const vcm = cm as VimCm;
		const lastLine = vcm.lastLine();
		const line = Math.max(0, Math.min(lastLine,
			motionArgs.forward ? head.line + motionArgs.repeat : head.line - motionArgs.repeat));
		const ch = Math.min(head.ch, VimSupport.maxNormalModeCh(vcm.getLine(line)));
		return { line, ch };
	};

	// j/k are normal/visual-mode-only motions, where the cursor may never rest one
	// past the last character (that position is only valid in insert mode). Clamping
	// to this (rather than the full line length) matters for goal-column tracking:
	// if we return the line-length position, vim.js's own invariant enforcement
	// silently pulls it back by one, and the actual next head then no longer matches
	// what we stored as lastReturnedPos — breaking the "is this a continuing
	// vertical-move chain" check on every single-keystroke j/k (though not on a
	// count-prefixed "3j", which jumps straight to the final line in one call and
	// never has an intermediate result to mismatch against).
	private static maxNormalModeCh(lineText: string): number {
		return Math.max(0, lineText.length - 1);
	}

	// Goal-column memory for consecutive j/k — this UCH-side field is the
	// cross-view-boundary-persistent counterpart to vim.js's own real
	// per-view lastHPos (same "H" naming, deliberately matched — see
	// VimState's own comment). vim.js's own lastHPos already handles
	// continuity *within one view* for free (including external changes
	// like a mouse click, via its own cursorActivity listener, and chaining
	// from other real vim motions like moveByScroll/moveToEol we haven't
	// overridden) — this field exists only for the one thing vim.js's own
	// state *can't* cover: a table-row-crossing/table-entry/exit creates a
	// brand-new inner EditorView with its own fresh (reset) vim state, so
	// the goal has to be carried externally across that boundary. A call
	// "continues" this external chain only if the incoming head matches
	// what we returned last time — any other motion in between (h/l, click,
	// edit) breaks the match, and head.ch is correctly treated as a fresh
	// goal column. See moveByLines' own comment for how this combines with
	// vim.js's own native lastMotion/lastHPos check.
	private goalHPos: number | null = null;
	// Pixel-x counterpart to goalHPos, mirroring vim.js's own lastHSPos —
	// not read by moveByLines itself (which only needs the ch-based value),
	// but kept in sync so a *future* gj/gk override can carry a valid pixel
	// goal across the same view boundaries this field already handles for ch.
	private goalHSPos: number | null = null;
	// Set only by resyncAfterDeferredMove's own genuine-exit case (see its own
	// comment): true means this.goalHSPos is still expressed in the *inner*
	// (viewport-relative, raw-CM6-coordsAtPos) space it had while crossing
	// out of a table cell — valid as-is for a subsequent posAtCoords
	// consumer (still/again in-cell), but needing conversion to vim.js's own
	// div-relative charCoords space before a plain-text findPosV call can use
	// it. Deliberately does *not* discard the value itself (an earlier
	// attempt did — see moveByDisplayLines' own goalHSPos ternary comment for
	// why that broke curswant-style preservation through an intervening
	// short/empty line, unlike moveByLines' own ch-based goalHPos, which
	// needs no such conversion and so survives those lines "for free"):
	// resolveViewportGoalForCurrentContext converts it on demand, checked
	// first in moveByDisplayLines' own ternary, ahead of both external and
	// native continuity, and cleared only once that conversion has actually
	// been applied.
	private goalHSPosNeedsDivConversion = false;
	// Same idea, for which table cell (column-wise) to prefer — e.g. exiting a
	// table below and re-entering it (or a different, narrower table) further
	// down a continuing chain should return to the same cell, not always the
	// leftmost one. Riding the same continuity check as goalHPos: reset together
	// with it whenever the chain breaks.
	private goalCellIndex: number | null = null;
	private lastReturnedPos: VimPos | null = null;
	// The cm the above lastReturnedPos belongs to. Inner-local {line, ch} numbering
	// is not unique across different cells — e.g. every single-<br>-segment cell
	// numbers its own content from {line: 0, ch: 0}, regardless of which cell it
	// is — so an action that moves to a *different* cell (Tab, a click, etc.) can
	// coincidentally land on the exact same {line, ch} some earlier, unrelated
	// chain last returned, without this cm check falsely reading as "continuing."
	private lastCm: unknown = null;
	// Outer-document {line, ch} the above lastReturnedPos/lastCm correspond to,
	// recorded only after a deferred crossing/entry (see resyncAfterDeferredMove)
	// — a second, independent continuity signal alongside the inner cm/head check.
	// Needed because inner view identity turns out to be unstable for *empty*
	// table cells specifically: Obsidian appears to create a fresh inner
	// EditorView instance every time one is (re-)focused, so cm/lastCm never
	// matches on the very next keystroke even though nothing else happened in
	// between. Outer document coordinates don't have that problem — unlike
	// inner-local numbering, they're globally unique, so matching on them alone
	// is if anything a *stronger* signal that this is genuinely the same chain.
	private lastOuterPos: VimPos | null = null;

	// Step 1 of j/k support: plain-text linewise movement with goal-column memory.
	// The inner EditorView for a table cell already models each <br>-delimited
	// segment as its own doc line (confirmed empirically), so this same code,
	// operating on whichever cm vim handed us, already gives correct <br>-aware
	// in-cell movement for free — no separate table-cell branch needed for that
	// part. What remains is: what happens when repeat carries head past this
	// view's own line range (i.e. past the cell's first/last <br> segment) —
	// that boundary case is handled by the crossing-test branch below.
	// Crossing (scheduleRowCrossing/scheduleTableEntry below) only ever runs
	// for a standalone j/k keystroke — never when inputState.operator is set
	// (e.g. "dj"), since then this call is only computing the operator's
	// linewise range, not actually moving the cursor. See moveByWords' own
	// identical guard for why: the deferred crossing would otherwise still
	// fire after the delete, leaving the cursor in the wrong cell/row and
	// stranding undo (u) in that cell's own vim state.
	private readonly moveByLines: VimMotionFn = (cm, head, motionArgs, vim, inputState) => {
		this.logDispatch('moveByLines', { head, motionArgs, operator: inputState?.operator ?? null });
		const vcm = cm as VimCm;
		const isOperatorPending = !!inputState?.operator;

		// Does vim.js's own per-view state say the previous motion was one of
		// ours? This is the *same-view* continuity signal — see VimState's own
		// comment for why it can't cover a row-crossing (a fresh inner view
		// resets its own vim state), which is what the external check below is
		// still needed for. Checks both j/k and gj/gk's own overrides — real
		// vim.js's own switch-case lists moveByLines and moveByDisplayLines as
		// one continuity family (plus moveByScroll/moveToColumn/moveToEol,
		// which aren't overridden here and so can never match this comparison
		// — see VimState's own comment on that accepted asymmetry).
		const nativeContinuing = !!vim && (vim.lastMotion === this.moveByLines || vim.lastMotion === this.moveByDisplayLines);

		const continuingInner = this.lastCm === cm && this.lastReturnedPos !== null &&
			head.line === this.lastReturnedPos.line &&
			head.ch === this.lastReturnedPos.ch;
		const editorNow = getActiveEditor();
		const outerNow = editorNow?.getCursor() ?? null;
		const continuingOuter = outerNow !== null && this.lastOuterPos !== null &&
			outerNow.line === this.lastOuterPos.line && outerNow.ch === this.lastOuterPos.ch;
		const externalContinuing = continuingInner || continuingOuter;
		const continuing = nativeContinuing || externalContinuing;
		// External wins when both agree it's continuing: right after a
		// row-crossing/table-entry/exit, Obsidian's own async settling can
		// still fire another cursorActivity/handleExternalSelection *after*
		// resyncAfterDeferredMove's own seed already ran, silently re-narrowing
		// vim.lastHPos to whatever the landing ch happened to be — a real,
		// observed race, not hypothetical. UCH's own external tracking has no
		// such exposure (it's plain field assignment, not something vim.js's
		// own event handling can race against), so it's the safer source of
		// truth whenever it applies. Native only matters for a chain external
		// has no visibility into at all — today that's nothing yet (we haven't
		// overridden moveByScroll/moveToColumn/moveToEol), so this fallback is
		// currently dormant; it starts pulling weight once one of those lands.
		const goalHPos = externalContinuing && this.goalHPos !== null ? this.goalHPos
			: nativeContinuing && vim ? vim.lastHPos
			: head.ch;
		const goalCellIndex = continuing && this.goalCellIndex !== null
			? this.goalCellIndex
			: VimSupport.currentCellIndex();

		const lastLine = vcm.lastLine();

		let line: number;
		if (editorNow?.inTableCell) {
			// Already inside a cell: cm is the inner view, so flat head±repeat
			// arithmetic against lastLine is exactly this cell's own <br>-segment
			// range — going out of it is a row-crossing.
			const rawTargetLine = motionArgs.forward ? head.line + motionArgs.repeat : head.line - motionArgs.repeat;
			if (rawTargetLine < 0 || rawTargetLine > lastLine) {
				// How many logical lines beyond this cell's own range still need
				// consuming — e.g. a repeat of 5 from line 3 of a 4-line (0..3)
				// cell overshoots by 1 (needs 1 more logical line beyond this cell).
				const overshoot = motionArgs.forward ? rawTargetLine - lastLine : -rawTargetLine;
				if (!isOperatorPending) {
					// Computed here (not read from this.goalHSPos) because the tail
					// below hasn't run yet for *this* call — this.goalHSPos still
					// holds the previous call's value at this point.
					// goalHPos is a *carried-over* goal column (curswant) — it can
					// legitimately be wider than this specific segment's own actual
					// length (e.g. continuing from a longer line/cell). Bug fixed
					// here: passing it straight through to coordsAtPos crashed
					// ("No tile at position N") once a wide-enough goal actually
					// exceeded the segment's real length — clamp first, same as
					// every other consumer of a carried-over ch against this line.
					const clampedGoalCh = Math.min(goalHPos, VimSupport.maxNormalModeCh(vcm.getLine(head.line)));
					const goalHSPosNow = VimSupport.charCoordsLeft(vcm, { line: head.line, ch: clampedGoalCh }, editorNow.activeCM);
					this.scheduleRowCrossing(motionArgs.forward, goalHPos, goalHSPosNow, goalCellIndex, overshoot);
				}
				line = Math.max(0, Math.min(lastLine, rawTargetLine));
			} else {
				line = rawTargetLine;
			}
		} else {
			// Plain text: cm is the outer, whole-document view, so flat head±repeat
			// arithmetic would treat every raw markdown line as one logical line —
			// wrong once the path enters a table row with multiple <br>-segments,
			// which should each count as their own logical line. Walk one line at
			// a time instead, switching to segment-aware counting (the same walk
			// scheduleRowCrossing uses) as soon as a table row is reached, so a
			// repeat that partway enters a multi-segment cell lands correctly
			// instead of overshooting past it via naive flat arithmetic.
			let remaining = motionArgs.repeat;
			let currentLine = head.line;
			let enteredAt = -1;
			while (remaining > 0) {
				const nextLine = motionArgs.forward ? currentLine + 1 : currentLine - 1;
				if (nextLine < 0 || nextLine > lastLine) break;
				if (vcm.getLine(nextLine).trimStart().startsWith('|')) {
					// Cheap pre-filter (the same shortcut used elsewhere for
					// "already confirmed inside a table") — scheduleTableEntry
					// does the full syntax-tree confirm before committing.
					// remaining is *not* decremented for this step — entering
					// this row is not itself a consumed step; walkTableRows'
					// own remaining<=segCount / segmentOffset=remaining-1
					// convention already accounts for reaching a row's first/
					// last segment as consuming 1 (matching how overshoot works
					// for row-crossing). Decrementing here as well was double-
					// counting that step, landing everything one segment early.
					enteredAt = nextLine;
					break;
				}
				currentLine = nextLine;
				remaining -= 1;
			}
			if (enteredAt !== -1) {
				if (!isOperatorPending) {
					// vcm.charCoords(...,'div') here would be vim.js's own
					// div-relative space — fine for *this* call's own findPosV-free
					// plain-text arithmetic (which doesn't use it at all), but wrong
					// for what scheduleTableEntry's own resyncAfterDeferredMove goes
					// on to seed (vim.lastHSPos / this.goalHSPos) once landed inside
					// the entered cell: a *later* gj/gk call continuing from there
					// feeds that seeded value straight into raw CM6 posAtCoords,
					// which needs viewport-relative coordinates. Recompute via the
					// outer cm's own coordsAtPos instead (still real/rendered even in
					// plain text, unlike activeCM), matching the identical fix
					// already applied to moveByDisplayLines' own plain-text entry.
					// Bug fixed here: a "k" that entered a table from plain text,
					// followed by a "gj" still inside that same cell, silently
					// reset the column — the div-relative value seeded by this call
					// site was fed straight into gj/gk's viewport-relative posAtCoords.
					// goalHPos is a carried-over goal column (curswant) — clamp
					// against head.line's own actual length before the coordsAtPos
					// lookup, same as scheduleRowCrossing's own identical clamp
					// (an unclamped wide goal crashed coordsAtPos with "No tile at
					// position N" once it genuinely exceeded the line's length).
					const clampedGoalCh = Math.min(goalHPos, VimSupport.maxNormalModeCh(vcm.getLine(head.line)));
					const goalHSPosNow = editorNow ? VimSupport.charCoordsLeft(vcm, { line: head.line, ch: clampedGoalCh }, editorNow.cm) : goalHPos;
					this.scheduleTableEntry(enteredAt, motionArgs.forward, goalHPos, goalHSPosNow, goalCellIndex, remaining);
				}
				// Stay put rather than jumping straight to enteredAt: unlike
				// row-crossing (naturally clamped within the current cell's own
				// safe range above), plain text has no such bound, so this would
				// otherwise land exactly on the raw target line — including,
				// sometimes, a table delimiter row, which likely has no focusable
				// rendered position in Live Preview at all. The real, corrected
				// landing happens in the deferred callback regardless of where
				// this temporary value sits.
				line = head.line;
			} else {
				line = currentLine;
			}
		}
		const ch = Math.min(goalHPos, VimSupport.maxNormalModeCh(vcm.getLine(line)));

		// External (cross-view) carry — unchanged mechanism, still the only
		// thing that survives a row-crossing/table-entry/exit.
		this.goalHPos = goalHPos;
		this.goalCellIndex = goalCellIndex;
		const result = { line, ch };
		this.lastReturnedPos = result;
		this.lastCm = cm;

		// Native (same-view) write-back — matches vim.js's own real
		// moveByLines tail exactly (`vim.lastHSPos = cm.charCoords(new
		// Pos(line, endCh),'div').left;`), so a subsequent same-view call
		// (ours or vim.js's own untouched moveByScroll/moveToEol/etc.) reads
		// a fresh, correct value regardless of which of us it came from.
		// vim.lastMotion itself is updated by vim.js's own processMotion
		// right after this function returns — nothing to set here.
		//
		// Deliberately writes back goalHPos (the wide, unclamped goal), not
		// the clamped `ch` used for the actual landing — real vim.js's own
		// moveByLines only narrows lastHPos on a *fresh* motion (`vim.lastHPos
		// = endCh` where endCh is still the pre-move cursor's own ch, in the
		// `default` switch branch); while continuing, it reads lastHPos but
		// never re-narrows it, so a short line along the way doesn't erase
		// the original wide goal. Writing the clamped ch here instead would
		// silently narrow the goal on the first short line and never recover
		// it for the rest of the same-view chain.
		if (vim) {
			vim.lastHPos = goalHPos;
			// goalHPos is deliberately the wide, unclamped goal (see the
			// comment above) — but `line` here is the *actual landed* line,
			// which can be shorter than that goal (the same curswant scenario
			// the comment above describes). Clamp before the coordsAtPos
			// lookup (same fix as scheduleRowCrossing's and scheduleTableEntry's
			// identical call sites) — an unclamped wide goal here crashes
			// coordsAtPos with "No tile at position N" once it genuinely
			// exceeds the landed line's length.
			const clampedGoalCh = Math.min(goalHPos, VimSupport.maxNormalModeCh(vcm.getLine(line)));
			this.goalHSPos = VimSupport.charCoordsLeft(vcm, { line, ch: clampedGoalCh }, editorNow?.inTableCell ? editorNow.activeCM : undefined);
			this.goalHSPosNeedsDivConversion = false;
			vim.lastHSPos = this.goalHSPos;
		}

		// Temporary diagnostic for curswant-integration verification — always
		// on for now so the vim.js-native state can be inspected without a
		// console flag. Remove once verified.
		// eslint-disable-next-line obsidianmd/rule-custom-message -- console.log requested explicitly for this temporary diagnostic; obsidianmd's own no-console rule only allows warn/error/debug otherwise.
		console.log('[UCH vim j/k]', JSON.stringify({
			headIn: head, repeat: motionArgs.repeat, forward: motionArgs.forward,
			inTableCell: editorNow?.inTableCell ?? false,
			nativeContinuing, continuingInner, continuingOuter, goalHPos, goalCellIndex,
			vimHasState: !!vim, vimLastHPos: vim?.lastHPos, vimLastHSPos: vim?.lastHSPos,
			vimLastMotionIsOurs: !!vim && vim.lastMotion === this.moveByLines,
			result,
		}));

		return result;
	};

	// Derives the current cell index from the live cursor position, to initialize
	// goalCellIndex when starting a fresh (non-continuing) vertical-move chain.
	// Null when not currently inside a table cell (goalCellIndex then stays null
	// too, until some chain actually starts from inside a cell).
	private static currentCellIndex(): number | null {
		const editor = getActiveEditor();
		if (!editor || !editor.inTableCell) return null;
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		return getCellIndex(line, cursor.ch);
	}

	// Row-crossing: called when repeat carries head past the current cell's own
	// <br>-segment range. The actual crossing is deferred to a setTimeout, run
	// from *outside* vim's synchronous motion call stack — calling the existing
	// row-crossing primitive (the one Ctrl-N/P also uses) directly inside the
	// motion function's own return previously crashed in vim.js's
	// clipCursorToContent; deferring it avoids that. Confirmed working manually
	// for single-row crossing, including entering/exiting the table entirely, and
	// (via overshoot) multi-row crossing for count-prefixed motions.
	private scheduleRowCrossing(forward: boolean, goalHPos: number, goalHSPos: number, goalCellIndex: number | null, overshoot: number): void {
		window.setTimeout(() => {
			const editor = getActiveEditor();
			if (!editor || !editor.inTableCell) return;
			// goalCellIndex should already be non-null here (we're crossing *from*
			// inside a cell, so the synchronous call's currentCellIndex() found
			// one) — the live re-derive is only a defensive fallback.
			const cellIndex = goalCellIndex ?? getCellIndex(editor.getLine(editor.getCursor().line), editor.getCursor().ch);
			const landedOuter = this.host.crossTableRowForCell(editor, cellIndex, forward, goalHPos, overshoot);
			// Deferred an extra frame: setCursorViaCm's own RAF-based focus-transfer
			// fallback can swap in a *different* inner view instance than whatever
			// editor.activeCM reports in this same setTimeout tick — reading it here
			// risks resyncing against a transient view that isn't what vim.js will
			// actually hand the next motion call.
			window.requestAnimationFrame(() => {
				this.resyncAfterDeferredMove(editor, landedOuter, goalHPos, goalHSPos, cellIndex);
			});
		}, 0);
	}

	// Table entry: called when moveByLines' cheap pre-filter suggests the target
	// line (still in plain-text coordinates) might be a table row. Deferred to a
	// setTimeout for the same reason as scheduleRowCrossing — entering a table
	// cell is itself a view-boundary crossing, carrying the same crash risk.
	private scheduleTableEntry(targetLine: number, forward: boolean, goalHPos: number, goalHSPos: number, goalCellIndex: number | null, remaining: number): void {
		window.setTimeout(() => {
			const editor = getActiveEditor();
			if (!editor) return;
			// Note: by the time this fires, editor.inTableCell is likely already
			// true — the motion function's own synchronous return already landed
			// (incorrectly, at a raw-line ch) inside the table row, and Obsidian
			// auto-created/focused the inner view in response. That's expected,
			// not a sign this isn't really an entry; isLinePartOfTable (not
			// inTableCell) is what confirms targetLine is genuinely a table row
			// before overriding that temporary landing with the correct one.
			if (!this.host.isLinePartOfTable(editor, targetLine, 1)) return;

			// goalCellIndex is null for a genuinely fresh entry (no continuing
			// chain to remember a cell from) — falls back to the leftmost cell,
			// matching Ctrl-N/P's own table-entry convention.
			const cellIndex = goalCellIndex ?? 0;
			const landedOuter = this.host.enterTableAtLine(editor, targetLine, cellIndex, forward, goalHPos, remaining);
			// See scheduleRowCrossing's own comment on why this read is deferred an
			// extra frame past the RAF-based focus-transfer fallback.
			window.requestAnimationFrame(() => {
				this.resyncAfterDeferredMove(editor, landedOuter, goalHPos, goalHSPos, cellIndex);
			});
		}, 0);
	}

	// Shared by scheduleRowCrossing and scheduleTableEntry: the motion function's
	// own synchronous return already cached a (now-stale) position in the *old*
	// view. Without re-syncing here, the next keystroke's head — from the new
	// view — won't match it, the continuing-chain check fails, and goalHPos/
	// goalCellIndex incorrectly reset to whatever this landing happened to clamp
	// to (e.g. a short row, or a narrower table, passed through mid-chain). Read
	// back the actual landing position in the new inner view's own local
	// coordinates and re-sync against that, keeping goalHPos/goalCellIndex at their
	// original (not clamped) values.
	private resyncAfterDeferredMove(editor: EditorBridge, landedOuter: { line: number; ch: number } | null, goalHPos: number, goalHSPos: number | null, goalCellIndex: number): void {
		if (!landedOuter) return;
		// Root cause (confirmed via a dedicated diagnostic log, not guessed):
		// editor.activeCM can equal editor.cm itself once there's no genuine
		// inner focus (see the "no inner" branch's own comment — an existing,
		// already-documented Obsidian convention) — including right after a
		// genuine table exit, where activeCM was observed live to still be
		// truthy (== cm) even though editor.inTableCell was already false and
		// the landed line's own text was ordinary plain prose. A bare
		// `if (inner)` check treats that as "still have an inner view" and
		// takes the wrong branch below, silently skipping the "genuine exit"
		// handling entirely — refineDisplayLineColumn (main.ts) already
		// guards against exactly this with its own `inner !== e.cm` check;
		// this needs the identical guard.
		const inner = editor.activeCM && editor.activeCM !== editor.cm ? editor.activeCM : undefined;
		let seedTarget: InnerCmLike | undefined;
		let resolvedGoalHSPos = goalHSPos;
		if (inner) {
			const head = inner.state.selection.main.head;
			const innerLine = inner.state.doc.lineAt(head);
			this.lastReturnedPos = { line: innerLine.number - 1, ch: head - innerLine.from };
			this.lastCm = inner;
			seedTarget = inner;
		} else {
			// No *distinct* inner view for this landing — either an empty
			// cell (activeCM falls back to the outer cm even though
			// inTableCell is true) or a genuine table *exit* into plain text.
			// Either way, resync against outer coordinates directly instead
			// of silently leaving stale state.
			this.lastReturnedPos = landedOuter;
			this.lastCm = editor.cm;
			seedTarget = editor.cm;
			// A genuine exit into plain text must not let the *incoming*
			// goalHSPos be fed unconverted into a later plain-text findPosV
			// call: that value was computed for whichever raw-CM6 posAtCoords
			// consumer led to this landing (a cell-to-cell crossing, or an
			// in-cell boundary step) — viewport-relative space — but findPosV
			// needs vim.js's own div-relative charCoords space instead
			// (confirmed live: a viewport-relative ~442 fed into findPosV
			// landed at ch 67 on an ordinary line). goalHSPosNeedsDivConversion
			// flags this *without discarding the value itself* (see that
			// field's own comment for why a first attempt — nulling it out so
			// the next call recomputes "fresh" from wherever it landed —
			// broke curswant-style preservation whenever that landing was on
			// a too-short/empty line to test a pixel goal against: the
			// "fresh" value was then just that degenerate line's own ch 0,
			// permanently losing the real goal even once a longer line was
			// reached later). Left alone for a genuine empty cell
			// (editor.inTableCell still true) — no coordinate-space mismatch
			// there, since a subsequent gj/gk still in-cell expects the same
			// viewport-relative space this value already carries.
			if (!editor.inTableCell) {
				this.goalHSPosNeedsDivConversion = true;
			}
		}
		// Seed the landed view's own native vim state with the carried-over,
		// *unclamped* goal (not this.lastReturnedPos.ch, which is the clamped
		// landing — the whole point is preserving the wide goal despite a
		// clamped landing, same as moveByLines' own tail). Without this, the
		// landing's own cursor placement (a plain Editor API call, not a vim
		// motion) triggers vim.js's own cursorActivity/handleExternalSelection
		// as a genuine external change and resets *only* lastHPos (not
		// lastMotion) to the clamped landing ch — so the very next keystroke's
		// nativeContinuing check (lastMotion still stale-true from before this
		// crossing) would wrongly read that corrupted, narrow value. Only
		// possible if vim.js's own maybeInitVimState has already run for this
		// view (i.e. at least one vim command has been dispatched to it
		// already) — skipped silently otherwise, matching the interface's own
		// optional `vim?`. lastHSPos is seeded alongside it (when known) for
		// the same reason, on the pixel side — needed for gj/gk's own goal to
		// survive a crossing that j/k itself initiated (a "j" then "gj" chain).
		if (seedTarget?.state?.vim) {
			seedTarget.state.vim.lastHPos = goalHPos;
			if (resolvedGoalHSPos !== null) seedTarget.state.vim.lastHSPos = resolvedGoalHSPos;
		}
		// Recorded regardless of whether an inner view was found — this is the
		// second, cm-identity-independent continuity signal (see lastOuterPos's
		// own comment).
		this.lastOuterPos = landedOuter;
		this.goalHPos = goalHPos;
		// Unlike seedTarget.state.vim.lastHSPos above (a non-nullable vim.js
		// field, so null there just means "leave it untouched"), this.goalHSPos
		// is nullable and null is exactly the signal a genuine exit needs to
		// send (see the "no inner" branch's own comment) — always assign,
		// don't guard it away.
		this.goalHSPos = resolvedGoalHSPos;
		this.goalCellIndex = goalCellIndex;
	}

	// --- gj/gk (moveByDisplayLines) — builds directly on j/k's own curswant
	// integration above, sharing every field (goalHPos/goalHSPos/goalCellIndex/
	// lastReturnedPos/lastCm/lastOuterPos) rather than a parallel gj/gk-only
	// copy. This is what gives j/k↔gj/gk cross-family continuity and click
	// detection "for free" — see moveByLines' own nativeContinuing comment.
	//
	// Third implementation attempt. The first two both deferred *every*
	// in-cell keystroke to a host round-trip (reusing Ctrl-N/P's own
	// moveCursorUpInTable/DownInTable engine, then a separate raw
	// EditorView.dispatch to pixel-correct). Live testing traced a repeated
	// vim.js key-dispatch corruption (confirmed via Chrome's own log-repeat
	// badge showing moveByLines fired twice for one keystroke, plus a single
	// "g" behaving like "gg", plus Normal-mode "l" inserting literal
	// characters) to that combination specifically — a `dd` press-and-hold
	// (a real vim.js 2-key command, zero UCH code involved) never reproduced
	// it, ruling out "2-key commands in general" as the cause. This version
	// instead computes the common (same-cell) case *synchronously*, via
	// direct coordsAtPos/posAtCoords calls on the current (already-rendered,
	// not being swapped) inner view — no dispatch, no defer, exactly like any
	// other motion. Only a genuine cell-boundary crossing still defers, and
	// even then only ever dispatches through setCursorViaCm (the same
	// function j/k's own crossing already uses safely), never a separate raw
	// dispatch.

	// Hardcoded default for 'moveByDisplayLines' (see VIM_DEFAULT_MOVE_BY_CHARACTERS
	// for why this must be hardcoded rather than captured). Deliberately simplified
	// vs. the live override: no goal-column persistence across separate keystrokes
	// (each call's own goal is just wherever *this* call started) — only a restore
	// target, not something a user should notice in practice.
	private static readonly VIM_DEFAULT_MOVE_BY_DISPLAY_LINES: VimMotionFn = (cm, head, motionArgs) => {
		const vcm = cm as VimCm;
		const repeat = Math.round(motionArgs.repeat);
		const goalHSPos = vcm.charCoords(head, 'div').left;
		let cur = head;
		for (let i = 0; i < repeat; i++) {
			const res = vcm.findPosV(cur, motionArgs.forward ? 1 : -1, 'line', goalHSPos);
			if (res.hitSide) break;
			cur = res;
		}
		const ch = Math.min(cur.ch, VimSupport.maxNormalModeCh(vcm.getLine(cur.line)));
		return { line: cur.line, ch };
	};

	// Live gj/gk. Continuity/goal-computation block mirrors moveByLines' own
	// exactly (same external-first/native-fallback priority, same reasoning
	// for why — see moveByLines' own comment on the race that priority order
	// avoids), just driven by goalHSPos (pixel) instead of goalHPos (ch).
	private readonly moveByDisplayLines: VimMotionFn = (cm, head, motionArgs, vim, inputState) => {
		this.logDispatch('moveByDisplayLines', { head, motionArgs, operator: inputState?.operator ?? null });
		const vcm = cm as VimCm;
		const isOperatorPending = !!inputState?.operator;
		const editorNow = getActiveEditor();

		const nativeContinuing = !!vim && (vim.lastMotion === this.moveByLines || vim.lastMotion === this.moveByDisplayLines);
		const continuingInner = this.lastCm === cm && this.lastReturnedPos !== null &&
			head.line === this.lastReturnedPos.line &&
			head.ch === this.lastReturnedPos.ch;
		const outerNow = editorNow?.getCursor() ?? null;
		const continuingOuter = outerNow !== null && this.lastOuterPos !== null &&
			outerNow.line === this.lastOuterPos.line && outerNow.ch === this.lastOuterPos.ch;
		const externalContinuing = continuingInner || continuingOuter;
		const continuing = nativeContinuing || externalContinuing;
		// goalHSPosNeedsDivConversion (see its own comment) takes priority over
		// both external and native continuity. Bug fixed here (second
		// attempt): the first attempt recomputed goalHSPos "fresh from head"
		// in this branch instead of converting the preserved value — correct
		// only when head is a genuinely meaningful position, but wrong
		// whenever the exit landed on a too-short/empty line to test a pixel
		// goal against at all (refineDisplayLineColumn's own outer branch
		// gives up there, leaving head at that degenerate line's own ch 0) —
		// confirmed live via a direct comparison to moveByLines' own (ch-based,
		// no conversion needed) goalHPos, which *does* survive an identical
		// empty-line crossing unscathed. resolveViewportGoalForCurrentContext
		// converts the *original* preserved goal instead, which works
		// regardless of the current line's own length.
		const goalHSPos = this.goalHSPosNeedsDivConversion && this.goalHSPos !== null
			? VimSupport.resolveViewportGoalForCurrentContext(vcm, head, editorNow, this.goalHSPos)
			: externalContinuing && this.goalHSPos !== null ? this.goalHSPos
			: nativeContinuing && vim ? vim.lastHSPos
			: VimSupport.charCoordsLeft(vcm, head, editorNow?.inTableCell ? editorNow.activeCM : undefined);
		const goalCellIndex = continuing && this.goalCellIndex !== null
			? this.goalCellIndex
			: VimSupport.currentCellIndex();

		if (editorNow?.inTableCell) {
			if (isOperatorPending) {
				// No synchronous visual-line computation is attempted in-cell for
				// an operator's own target (e.g. "dgj") — approximate via the same
				// logical-line arithmetic moveByLines' own in-cell branch uses.
				// Exact for a non-wrapped cell, imperfect for a wrapped one —
				// a documented, narrow scope cut (matches moveByWords'/
				// moveByLines' own precedent) rather than building a second
				// synchronous path just for the operator+gj/gk case.
				const lastLine = vcm.lastLine();
				const rawTargetLine = motionArgs.forward ? head.line + motionArgs.repeat : head.line - motionArgs.repeat;
				const line = Math.max(0, Math.min(lastLine, rawTargetLine));
				const ch = Math.min(head.ch, VimSupport.maxNormalModeCh(vcm.getLine(line)));
				return { line, ch };
			}

			// Synchronous same-cell stepping: vim.js's own findPosV is unreliable
			// specifically inside Obsidian's embedded table-cell views (confirmed
			// via live testing of real, unmodified vim.js), so this uses the
			// lower-level coordsAtPos/posAtCoords directly on the current inner
			// view instead — a real, already-rendered view (not one that's being
			// swapped), so no deferral is needed here, unlike a crossing.
			const inner = editorNow.activeCM;
			let cur = head;
			let remaining = Math.round(motionArgs.repeat);
			if (inner) {
				while (remaining > 0) {
					const headOffset = inner.state.doc.line(cur.line + 1).from + cur.ch;
					const coords = inner.coordsAtPos(headOffset);
					if (!coords) break; // can't resolve — treat as a cell boundary
					const targetY = motionArgs.forward ? coords.bottom + 9 : coords.top - 9;
					const targetOffset = inner.posAtCoords({ x: goalHSPos, y: targetY }, false);
					if (targetOffset === null) break; // outside the rendered cell — boundary
					const targetCoords = inner.coordsAtPos(targetOffset);
					// Same-top means posAtCoords couldn't actually move to a new
					// visual line (clipped back to the current one) — the same
					// "did this actually move" check real vim.js's own hitSide
					// signals, just derived manually since findPosV itself isn't
					// trustworthy here.
					if (!targetCoords || targetCoords.top === coords.top) break;
					const targetLine = inner.state.doc.lineAt(targetOffset);
					cur = { line: targetLine.number - 1, ch: targetOffset - targetLine.from };
					remaining -= 1;
				}
			}
			// remaining > 0 means either there's no inner view at all (an empty
			// cell — nothing to step through, matching moveCursorUpInTable's/
			// DownInTable's own "empty cell: go directly to next/prev row" fast
			// path) or a genuine cell-boundary was hit before repeat was fully
			// consumed — either way, a crossing is needed. Only a single row is
			// ever crossed per keystroke regardless of how large remaining is
			// (see crossTableRowForDisplayLine's own scope-cut comment).
			if (remaining > 0) {
				this.scheduleDisplayLineCrossing(motionArgs.forward, goalHSPos, goalCellIndex);
			}
			const ch = Math.min(cur.ch, VimSupport.maxNormalModeCh(vcm.getLine(cur.line)));
			const result = { line: cur.line, ch };

			// External (cross-view) carry — same fields j/k uses. Written
			// unconditionally (matching moveByLines' own tail): even when a
			// crossing was also scheduled, this is a safe, temporary placeholder
			// that resyncAfterDeferredMove will correct once the crossing settles.
			this.goalHPos = result.ch;
			this.goalHSPos = goalHSPos;
			this.goalHSPosNeedsDivConversion = false;
			this.goalCellIndex = goalCellIndex;
			this.lastReturnedPos = result;
			this.lastCm = cm;

			// Native write-back — mirror image of moveByLines' own tail: here
			// goalHSPos (the driver) is preserved across a continuing chain
			// (only refreshed fresh), while lastHPos is unconditionally
			// overwritten to wherever this actually landed (matching real
			// vim.js's own `if (cur != head) vim.lastHPos = cur.ch;` — no
			// "preserve the wide ch goal" behavior here; switching from gj/gk
			// back to j/k picks up wherever gj/gk actually left the cursor).
			if (vim) {
				if (result.line !== head.line || result.ch !== head.ch) vim.lastHPos = result.ch;
				if (!continuing) vim.lastHSPos = goalHSPos;
			}

			// Temporary diagnostic, mirroring moveByLines' own "[UCH vim j/k]" —
			// see that one's comment. Remove once verified.
			// eslint-disable-next-line obsidianmd/rule-custom-message -- console.log requested explicitly for this temporary diagnostic.
			console.log('[UCH vim gj/gk]', JSON.stringify({
				headIn: head, repeat: motionArgs.repeat, forward: motionArgs.forward,
				inTableCell: true,
				nativeContinuing, continuingInner, continuingOuter, goalHSPos, goalCellIndex,
				vimHasState: !!vim, vimLastHPos: vim?.lastHPos, vimLastHSPos: vim?.lastHSPos,
				vimLastMotionIsOurs: !!vim && (vim.lastMotion === this.moveByLines || vim.lastMotion === this.moveByDisplayLines),
				result,
			}));

			return result;
		}

		// Plain text: mirrors real vim.js's own moveByDisplayLines exactly —
		// findPosV is a genuine public method (unlike moveByScroll/moveToColumn/
		// moveToEol), so no reimplementation is needed for the movement itself.
		// Looped one line at a time (matching real vim.js's own loop) so each
		// hop can be checked against the same "does the landing line look like
		// a table row" prefilter moveByLines' own plain-text walk uses —
		// landing directly on raw table markdown text synchronously triggers
		// Obsidian's own inner-view auto-creation, racing the deferred jump a
		// tick later (see moveToLineOrEdgeOfDocument's own comment on the exact
		// crash this avoids). remaining/enteredAt mirror moveByLines' own
		// convention exactly: a step that turns out to be the entry itself
		// doesn't consume a unit of remaining.
		const repeat = Math.round(motionArgs.repeat);
		let cur = head;
		let remaining = repeat;
		let enteredAt = -1;
		while (remaining > 0) {
			const res = vcm.findPosV(cur, motionArgs.forward ? 1 : -1, 'line', goalHSPos);
			if (res.hitSide) break;
			if (vcm.getLine(res.line).trimStart().startsWith('|')) {
				enteredAt = res.line;
				break;
			}
			cur = res;
			remaining -= 1;
		}

		let line: number;
		if (enteredAt !== -1) {
			if (!isOperatorPending) {
				// goalHSPos here is in vim.js's own 'div'-relative space (see
				// charCoordsLeft's own comment) — correct for the findPosV steps
				// above, but the entry's own pixel-refinement
				// (scheduleDisplayLineEntry -> scheduleDisplayLineRefinement ->
				// refineDisplayLineColumn) reads raw CM6 coordsAtPos/posAtCoords
				// on the newly-entered *inner* view, a different (viewport-
				// relative) space. Convert via convertPixelGoalSpace (a
				// same-reference-point offset, using cur as the reference and
				// the *outer* cm — still a real, already-rendered CM6 view even
				// in plain text, unlike activeCM) rather than recomputing a
				// fresh value directly from cur's own position.
				//
				// Bug fixed here (second attempt): the first attempt did
				// exactly that — VimSupport.charCoordsLeft(vcm, cur,
				// editorNow.cm), reading cur's own viewport-relative position
				// as the goal — silently resolving to the wrong (col-0) column
				// once inside the entered cell whenever cur itself happened to
				// be a degenerate ch-0 position (e.g. findPosV's own loop
				// breaking on the entry-detection step *before* ever advancing
				// cur off of a preceding too-short/empty plain-text line — cur
				// stays at head in that case, see this loop's own remaining/
				// enteredAt convention comment). Converting the already-correct
				// goalHSPos (valid for wherever we actually are, regardless of
				// cur's own degeneracy) is the same fix already applied to the
				// exit-side coordinate-space bug, applied here to entry.
				const entryPixelGoal = editorNow?.cm
					? VimSupport.convertPixelGoalSpace(vcm, cur, editorNow.cm, 'viewport', goalHSPos)
					: goalHSPos;
				this.scheduleDisplayLineEntry(enteredAt, motionArgs.forward, entryPixelGoal, goalCellIndex);
			}
			// Stay put rather than jumping straight to enteredAt — same
			// reasoning as moveByLines' own identical branch.
			line = head.line;
		} else {
			line = cur.line;
		}
		const ch = Math.min(cur.ch, VimSupport.maxNormalModeCh(vcm.getLine(line)));
		const result = { line, ch };

		this.goalHPos = result.ch;
		this.goalHSPos = goalHSPos;
		this.goalHSPosNeedsDivConversion = false;
		this.goalCellIndex = goalCellIndex;
		this.lastReturnedPos = result;
		this.lastCm = cm;

		if (vim) {
			if (result.line !== head.line || result.ch !== head.ch) vim.lastHPos = result.ch;
			if (!continuing) vim.lastHSPos = goalHSPos;
		}

		// Temporary diagnostic, mirroring moveByLines' own "[UCH vim j/k]" —
		// see that one's comment. Remove once verified.
		// eslint-disable-next-line obsidianmd/rule-custom-message -- console.log requested explicitly for this temporary diagnostic.
		console.log('[UCH vim gj/gk]', JSON.stringify({
			headIn: head, repeat: motionArgs.repeat, forward: motionArgs.forward,
			inTableCell: false,
			nativeContinuing, continuingInner, continuingOuter, goalHSPos, goalCellIndex,
			vimHasState: !!vim, vimLastHPos: vim?.lastHPos, vimLastHSPos: vim?.lastHSPos,
			vimLastMotionIsOurs: !!vim && (vim.lastMotion === this.moveByLines || vim.lastMotion === this.moveByDisplayLines),
			result,
		}));

		return result;
	};

	private applyDisplayLines(): void {
		getVim()?.defineMotion('moveByDisplayLines', this.moveByDisplayLines);
	}

	private restoreDisplayLines(): void {
		getVim()?.defineMotion('moveByDisplayLines', VimSupport.VIM_DEFAULT_MOVE_BY_DISPLAY_LINES);
	}

	setDisplayLinesEnabled(on: boolean): void {
		this.setFeature(on, v => { this.host.settings.vimDisplayLineSupport = v; }, () => this.applyDisplayLines(), () => this.restoreDisplayLines());
	}

	// Deferred for the same crash-avoidance reason as scheduleRowCrossing — a
	// cell-boundary crossing cannot be resolved synchronously. Two host calls,
	// one tick apart: crossTableRowForCell lands roughly (a single
	// setCursorViaCm dispatch, enough to make the target cell's inner view
	// actually exist/render); refineDisplayLineColumn then reads that
	// now-rendered view's own layout and, only if needed, dispatches a
	// *second* setCursorViaCm call to pixel-correct it. Never a separate raw
	// EditorView.dispatch — see this override's own class comment for why.
	private scheduleDisplayLineCrossing(forward: boolean, goalHSPos: number, goalCellIndex: number | null): void {
		window.setTimeout(() => {
			const editor = getActiveEditor();
			if (!editor || !editor.inTableCell) return;
			const cellIndex = goalCellIndex ?? getCellIndex(editor.getLine(editor.getCursor().line), editor.getCursor().ch);
			// Rough landing: reuses j/k's own crossTableRowForCell as-is (single
			// row only, so overshoot=1 — see refineDisplayLineColumn's own
			// comment on both). goalCh itself isn't a real pixel-aware goal, but
			// its direction still matters: landInCellSegment lands at the target
			// segment's own *start* (forward) or, via this large sentinel,
			// clamps to its own *end* (backward) — same convention
			// crossTableRowForWord's own goalCh already uses. This matters for a
			// wrapped (multi-visual-line) target segment specifically:
			// refineDisplayLineColumn only ever corrects the *column* on
			// whichever (inner) line the rough landing already put it on — it
			// never changes lines — so gk crossing backward into a wrapped
			// segment must land on that segment's own *last* character (its
			// bottom visual line) up front, not its first (which forward's
			// own start-of-segment landing already correctly targets: gj
			// entering a row from above should land on the segment's own top
			// visual line).
			const roughLanding = this.host.crossTableRowForCell(editor, cellIndex, forward, forward ? 0 : Number.MAX_SAFE_INTEGER, 1);
			if (!roughLanding) return;
			this.scheduleDisplayLineRefinement(editor, goalHSPos, cellIndex);
		}, 0);
	}

	// Table entry from plain text (mirrors moveByLines' own scheduleTableEntry
	// row-finding, but as a separate, gj/gk-only method rather than sharing
	// that one — j/k's own scheduleTableEntry has no pixel-refinement step at
	// all, and adding one there would be meaningless for a ch-only motion).
	// Same two-step (rough landing via enterTableAtLine, then
	// scheduleDisplayLineRefinement) shape as scheduleDisplayLineCrossing —
	// entering a table row is just as much a view-boundary crossing as moving
	// between two already-inside-the-table rows, so it needs the same
	// pixel-correction follow-up, not just a rough, uncorrected landing.
	// Single-row precision only (remaining=0), matching
	// crossTableRowForCell's own scope cut above.
	private scheduleDisplayLineEntry(targetLine: number, forward: boolean, goalHSPos: number, goalCellIndex: number | null): void {
		window.setTimeout(() => {
			const editor = getActiveEditor();
			if (!editor) return;
			// See scheduleTableEntry's own identical check: confirms targetLine
			// is genuinely a table row (not just text that starts with '|')
			// before committing to this landing.
			if (!this.host.isLinePartOfTable(editor, targetLine, 1)) return;
			const cellIndex = goalCellIndex ?? 0;
			const roughLanding = this.host.enterTableAtLine(editor, targetLine, cellIndex, forward, forward ? 0 : Number.MAX_SAFE_INTEGER, 0);
			if (!roughLanding) return;
			this.scheduleDisplayLineRefinement(editor, goalHSPos, cellIndex);
		}, 0);
	}

	// Shared by scheduleDisplayLineCrossing and scheduleDisplayLineEntry: waits
	// one more tick for the rough landing's own inner view to actually render
	// before reading its layout (the same class of wait scheduleTableEntry's
	// own comment describes — Obsidian's inner-view creation in response to a
	// dispatch isn't necessarily synchronous with that dispatch returning),
	// then pixel-corrects via refineDisplayLineColumn. Bug fixed here:
	// this used to skip refineDisplayLineColumn entirely whenever the rough
	// landing had already exited the table into plain text (!editor.inTableCell),
	// resyncing against the live (uncorrected, exitTableWithColumn's own
	// hardcoded ch=0/MAX_SAFE_INTEGER) cursor instead — the "column not
	// preserved when exiting the table's last row" report. refineDisplayLineColumn
	// (main.ts) now handles that exact case itself (falling back to the outer
	// view's own coordsAtPos/posAtCoords when there's no distinct inner view —
	// an empty cell or a genuine exit alike), so it can always be called here.
	private scheduleDisplayLineRefinement(editor: EditorBridge, goalHSPos: number, cellIndex: number): void {
		window.setTimeout(() => {
			const refined = this.host.refineDisplayLineColumn(editor, goalHSPos);
			// See scheduleRowCrossing's own comment on why this final read is
			// deferred an extra frame past setCursorViaCm's own RAF-based
			// focus-transfer fallback.
			window.requestAnimationFrame(() => {
				this.resyncAfterDeferredMove(editor, refined, refined?.ch ?? 0, goalHSPos, cellIndex);
			});
		}, 0);
	}
}
