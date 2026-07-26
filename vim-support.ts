import { findClusterBreak } from '@codemirror/state';
import { getCellIndex } from './table-cell-utils';

// Obsidian's built-in Vim mode (codemirror-vim) — not exposed in obsidian.d.ts.
interface VimPos { line: number; ch: number }
interface VimMotionArgs { forward: boolean; repeat: number }
type VimMotionFn = (cm: unknown, head: VimPos, motionArgs: VimMotionArgs) => VimPos;
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
}

const getVim = (): VimApi | undefined =>
	(window as unknown as { CodeMirrorAdapter?: { Vim?: VimApi } }).CodeMirrorAdapter?.Vim;

// The inner EditorView, as seen from outside a synchronous vim motion callback —
// just enough to read back the post-crossing cursor position (see
// scheduleRowCrossing's resync step).
interface InnerCmLike {
	state: {
		doc: { lineAt(pos: number): { number: number; from: number } };
		selection: { main: { head: number } };
	};
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
	// Full (syntax-tree-based) table-membership check — confirms a cheap textual
	// pre-filter before committing to a table-entry landing (see scheduleTableEntry).
	isLinePartOfTable(editor: unknown, line: number, ch: number): boolean;
	// Lands on cellIndex's <br>-segment at goalCh, remaining logical lines in from
	// targetLine's own first/last segment (0 = that edge segment itself; walks
	// further rows if remaining doesn't fit within targetLine's own cell) — for
	// moving from plain text onto a table row. cellIndex is goalCellIndex, or 0
	// as a fallback. Returns the outer {line, ch} landed on (or null).
	enterTableAtLine(editor: unknown, targetLine: number, cellIndex: number, forward: boolean, goalCh: number, remaining: number): { line: number; ch: number } | null;
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

	// Call from the plugin's onload().
	setup(): void {
		if (this.host.settings.vimHlSupport) this.applyHl();
		if (this.host.settings.vimJkSupport) this.applyJk();
		if (this.host.settings.vimJoinSupport) this.applyJoin();
		if (this.host.settings.vimCaretSupport) this.applyCaret();
	}

	// Call from the plugin's onunload(). Best-effort only — see each restore*'s own caveat.
	teardown(): void {
		this.restoreHl();
		this.restoreJk();
		this.restoreJoin();
		this.restoreCaret();
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

	// Goal-column memory for consecutive j/k, kept independent of vim.js's own
	// internal per-editor state (its property names, e.g. lastHPos, are undocumented
	// and version-fragile). Instead: a call "continues" a vertical-move chain only if
	// the incoming head matches what we returned last time — any other motion in
	// between (h/l, click, edit) breaks the match, and head.ch is correctly treated
	// as a fresh goal column.
	private goalCh: number | null = null;
	// Same idea, for which table cell (column-wise) to prefer — e.g. exiting a
	// table below and re-entering it (or a different, narrower table) further
	// down a continuing chain should return to the same cell, not always the
	// leftmost one. Riding the same continuity check as goalCh: reset together
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
	private readonly moveByLines: VimMotionFn = (cm, head, motionArgs) => {
		const vcm = cm as VimCm;

		const continuingInner = this.lastCm === cm && this.lastReturnedPos !== null &&
			head.line === this.lastReturnedPos.line &&
			head.ch === this.lastReturnedPos.ch;
		const editorNow = getActiveEditor();
		const outerNow = editorNow?.getCursor() ?? null;
		const continuingOuter = outerNow !== null && this.lastOuterPos !== null &&
			outerNow.line === this.lastOuterPos.line && outerNow.ch === this.lastOuterPos.ch;
		const continuing = continuingInner || continuingOuter;
		const goalCh = continuing && this.goalCh !== null ? this.goalCh : head.ch;
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
				this.scheduleRowCrossing(motionArgs.forward, goalCh, goalCellIndex, overshoot);
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
				this.scheduleTableEntry(enteredAt, motionArgs.forward, goalCh, goalCellIndex, remaining);
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
		const ch = Math.min(goalCh, VimSupport.maxNormalModeCh(vcm.getLine(line)));

		this.goalCh = goalCh;
		this.goalCellIndex = goalCellIndex;
		const result = { line, ch };
		this.lastReturnedPos = result;
		this.lastCm = cm;

		// Temporary diagnostic for an intermittent "single j/k moves 2 lines"
		// report — not yet reproduced on demand. Silent unless
		// window.__uchVimDebug is set (e.g. from the DevTools console).
		// Remove once root-caused.
		if ((window as unknown as { __uchVimDebug?: boolean }).__uchVimDebug) {
			console.debug('[UCH vim j/k]', {
				headIn: head, repeat: motionArgs.repeat, forward: motionArgs.forward,
				inTableCell: editorNow?.inTableCell ?? false,
				continuingInner, continuingOuter, goalCh, goalCellIndex,
				result,
			});
		}

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
	private scheduleRowCrossing(forward: boolean, goalCh: number, goalCellIndex: number | null, overshoot: number): void {
		window.setTimeout(() => {
			const editor = getActiveEditor();
			if (!editor || !editor.inTableCell) return;
			// goalCellIndex should already be non-null here (we're crossing *from*
			// inside a cell, so the synchronous call's currentCellIndex() found
			// one) — the live re-derive is only a defensive fallback.
			const cellIndex = goalCellIndex ?? getCellIndex(editor.getLine(editor.getCursor().line), editor.getCursor().ch);
			const landedOuter = this.host.crossTableRowForCell(editor, cellIndex, forward, goalCh, overshoot);
			// Deferred an extra frame: setCursorViaCm's own RAF-based focus-transfer
			// fallback can swap in a *different* inner view instance than whatever
			// editor.activeCM reports in this same setTimeout tick — reading it here
			// risks resyncing against a transient view that isn't what vim.js will
			// actually hand the next motion call.
			window.requestAnimationFrame(() => {
				this.resyncAfterDeferredMove(editor, landedOuter, goalCh, cellIndex);
			});
		}, 0);
	}

	// Table entry: called when moveByLines' cheap pre-filter suggests the target
	// line (still in plain-text coordinates) might be a table row. Deferred to a
	// setTimeout for the same reason as scheduleRowCrossing — entering a table
	// cell is itself a view-boundary crossing, carrying the same crash risk.
	private scheduleTableEntry(targetLine: number, forward: boolean, goalCh: number, goalCellIndex: number | null, remaining: number): void {
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
			const landedOuter = this.host.enterTableAtLine(editor, targetLine, cellIndex, forward, goalCh, remaining);
			// See scheduleRowCrossing's own comment on why this read is deferred an
			// extra frame past the RAF-based focus-transfer fallback.
			window.requestAnimationFrame(() => {
				this.resyncAfterDeferredMove(editor, landedOuter, goalCh, cellIndex);
			});
		}, 0);
	}

	// Shared by scheduleRowCrossing and scheduleTableEntry: the motion function's
	// own synchronous return already cached a (now-stale) position in the *old*
	// view. Without re-syncing here, the next keystroke's head — from the new
	// view — won't match it, the continuing-chain check fails, and goalCh/
	// goalCellIndex incorrectly reset to whatever this landing happened to clamp
	// to (e.g. a short row, or a narrower table, passed through mid-chain). Read
	// back the actual landing position in the new inner view's own local
	// coordinates and re-sync against that, keeping goalCh/goalCellIndex at their
	// original (not clamped) values.
	private resyncAfterDeferredMove(editor: EditorBridge, landedOuter: { line: number; ch: number } | null, goalCh: number, goalCellIndex: number): void {
		if (!landedOuter) return;
		const inner = editor.activeCM;
		if (inner) {
			const head = inner.state.selection.main.head;
			const innerLine = inner.state.doc.lineAt(head);
			this.lastReturnedPos = { line: innerLine.number - 1, ch: head - innerLine.from };
			this.lastCm = inner;
		} else {
			// No inner view for this landing (editor.activeCM falls back to the
			// outer cm even though inTableCell is true) — resync against outer
			// coordinates directly instead of silently leaving stale state.
			this.lastReturnedPos = landedOuter;
			this.lastCm = editor.cm;
		}
		// Recorded regardless of whether an inner view was found — this is the
		// second, cm-identity-independent continuity signal (see lastOuterPos's
		// own comment).
		this.lastOuterPos = landedOuter;
		this.goalCh = goalCh;
		this.goalCellIndex = goalCellIndex;
	}
}
