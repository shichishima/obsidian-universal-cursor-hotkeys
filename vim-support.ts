import { Setting, sanitizeHTMLToDom } from 'obsidian';
import { findClusterBreak } from '@codemirror/state';
import { getCellIndex } from './table-cell-utils';

// Obsidian's built-in Vim mode (codemirror-vim) — not exposed in obsidian.d.ts.
interface VimPos { line: number; ch: number }
interface VimMotionArgs { forward: boolean; repeat: number }
type VimMotionFn = (cm: unknown, head: VimPos, motionArgs: VimMotionArgs) => VimPos;
interface VimApi {
	defineMotion(name: string, fn: VimMotionFn): void;
}
interface VimCm {
	getLine(line: number): string;
	lastLine(): number;
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
}

const getActiveEditor = (): EditorBridge | undefined =>
	(window as unknown as { app?: { workspace?: { activeEditor?: { editor?: EditorBridge } } } })
		.app?.workspace?.activeEditor?.editor;

// Minimal shape VimSupport needs from the host plugin — kept structural (duck-typed)
// rather than importing the concrete plugin class, so this module has no dependency
// on main.ts and can be lifted out (e.g. into a separate plugin) without untangling.
export interface VimSupportHost {
	settings: { vimHlSupport: boolean };
	saveSettings(): Promise<void>;
	// editor/cellIndex are passed through untyped (see EditorBridge) — the host's
	// real implementation casts back to its own Editor type internally. goalCh is
	// the desired column, relative to the landing <br>-segment's own start.
	// Returns the outer {line, ch} landed on (or null), for goal-column resync.
	crossTableRowForCell(editor: unknown, cellIndex: number, forward: boolean, goalCh: number): { line: number; ch: number } | null;
	// Full (syntax-tree-based) table-membership check — confirms a cheap textual
	// pre-filter before committing to a table-entry landing (see scheduleTableEntry).
	isLinePartOfTable(editor: unknown, line: number, ch: number): boolean;
	// Lands on cellIndex-0's first/last <br>-segment at goalCh, for moving from
	// plain text onto a table row. Returns the outer {line, ch} landed on (or null).
	enterTableAtLine(editor: unknown, targetLine: number, forward: boolean, goalCh: number): { line: number; ch: number } | null;
}

export class VimSupport {
	private readonly host: VimSupportHost;

	// Not persisted — whether the Vim h/l override is actually active in the
	// current running session. Re-enabling always works live; disabling does not
	// (see restoreHlOverride), so this only ever flips true → it goes back to
	// false only via a fresh app start where settings.vimHlSupport is already off.
	liveApplied = false;

	constructor(host: VimSupportHost) {
		this.host = host;
	}

	get wantsOn(): boolean {
		return this.host.settings.vimHlSupport;
	}

	// Call from the plugin's onload().
	setup(): void {
		if (this.host.settings.vimHlSupport) {
			this.applyHlOverride();
			this.liveApplied = true;
		}
	}

	// Call from the plugin's onunload(). Best-effort only — see restoreHlOverride's own caveat.
	teardown(): void {
		this.restoreHlOverride();
	}

	// State A -> B. Applies immediately; reliable.
	enableHlSupport(): void {
		this.host.settings.vimHlSupport = true;
		this.applyHlOverride();
		this.liveApplied = true;
		void this.host.saveSettings();
	}

	// State B -> C. Does not touch the live override (disabling isn't reliable
	// mid-session) — only schedules it to stay off from the next app start.
	scheduleDisableHlSupport(): void {
		this.host.settings.vimHlSupport = false;
		void this.host.saveSettings();
	}

	// State C -> B. The override was never actually removed, so this is just
	// cancelling the pending disable — reliable, no re-apply needed.
	cancelDisableHlSupport(): void {
		this.host.settings.vimHlSupport = true;
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

	private applyHlOverride(): void {
		getVim()?.defineMotion('moveByCharacters', this.moveByCharacters);
		getVim()?.defineMotion('moveByLines', this.moveByLines);
	}

	// Best-effort restore — see the liveApplied field's own note: this does not
	// reliably take effect within a running session (cause unconfirmed), so it
	// is only ever called from teardown(), never exposed as a live "disable" action.
	private restoreHlOverride(): void {
		getVim()?.defineMotion('moveByCharacters', VimSupport.VIM_DEFAULT_MOVE_BY_CHARACTERS);
		getVim()?.defineMotion('moveByLines', VimSupport.VIM_DEFAULT_MOVE_BY_LINES);
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
	private lastReturnedPos: VimPos | null = null;

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

		const continuing = this.lastReturnedPos !== null &&
			head.line === this.lastReturnedPos.line &&
			head.ch === this.lastReturnedPos.ch;
		const goalCh = continuing && this.goalCh !== null ? this.goalCh : head.ch;

		const lastLine = vcm.lastLine();
		const rawTargetLine = motionArgs.forward ? head.line + motionArgs.repeat : head.line - motionArgs.repeat;

		if (rawTargetLine < 0 || rawTargetLine > lastLine) {
			this.scheduleRowCrossing(motionArgs.forward, goalCh);
		} else if (vcm.getLine(rawTargetLine).trimStart().startsWith('|')) {
			// Cheap pre-filter (the same shortcut used elsewhere for "already
			// confirmed inside a table") — only worth a deferred full syntax-tree
			// check if the target line even looks like it could be a table row.
			// When already inside a cell, cm is the inner view and its own lines
			// never start with a literal pipe, so this naturally only fires when
			// currently in plain text and about to enter a table.
			this.scheduleTableEntry(rawTargetLine, motionArgs.forward, goalCh);
		}

		const line = Math.max(0, Math.min(lastLine, rawTargetLine));
		const ch = Math.min(goalCh, VimSupport.maxNormalModeCh(vcm.getLine(line)));

		this.goalCh = goalCh;
		const result = { line, ch };
		this.lastReturnedPos = result;
		return result;
	};

	// Row-crossing: called when repeat carries head past the current cell's own
	// <br>-segment range. The actual crossing is deferred to a setTimeout, run
	// from *outside* vim's synchronous motion call stack — calling the existing
	// row-crossing primitive (the one Ctrl-N/P also uses) directly inside the
	// motion function's own return previously crashed in vim.js's
	// clipCursorToContent; deferring it avoids that. Confirmed working manually
	// for single-row crossing, including entering/exiting the table entirely.
	// Not yet handled: a repeat large enough to span more than one row boundary
	// (e.g. "3j" spanning two rows) only crosses one row.
	private scheduleRowCrossing(forward: boolean, goalCh: number): void {
		setTimeout(() => {
			const editor = getActiveEditor();
			if (!editor || !editor.inTableCell) return;
			const cursor = editor.getCursor();
			const line = editor.getLine(cursor.line);
			const cellIndex = getCellIndex(line, cursor.ch);
			const landedOuter = this.host.crossTableRowForCell(editor, cellIndex, forward, goalCh);
			this.resyncAfterDeferredMove(editor, landedOuter, goalCh);
		}, 0);
	}

	// Table entry: called when moveByLines' cheap pre-filter suggests the target
	// line (still in plain-text coordinates) might be a table row. Deferred to a
	// setTimeout for the same reason as scheduleRowCrossing — entering a table
	// cell is itself a view-boundary crossing, carrying the same crash risk.
	private scheduleTableEntry(targetLine: number, forward: boolean, goalCh: number): void {
		setTimeout(() => {
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

			const landedOuter = this.host.enterTableAtLine(editor, targetLine, forward, goalCh);
			this.resyncAfterDeferredMove(editor, landedOuter, goalCh);
		}, 0);
	}

	// Shared by scheduleRowCrossing and scheduleTableEntry: the motion function's
	// own synchronous return already cached a (now-stale) position in the *old*
	// view. Without re-syncing here, the next keystroke's head — from the new
	// view — won't match it, the continuing-chain check fails, and goalCh
	// incorrectly resets to whatever column this landing happened to clamp to
	// (e.g. a short row passed through mid-chain). Read back the actual landing
	// position in the new inner view's own local coordinates and re-sync against
	// that, keeping goalCh at its original (not clamped) value.
	private resyncAfterDeferredMove(editor: EditorBridge, landedOuter: { line: number; ch: number } | null, goalCh: number): void {
		if (!landedOuter) return;
		const inner = editor.activeCM;
		if (!inner) return;
		const head = inner.state.selection.main.head;
		const innerLine = inner.state.doc.lineAt(head);
		this.lastReturnedPos = { line: innerLine.number - 1, ch: head - innerLine.from };
		this.goalCh = goalCh;
	}
}

export function renderVimSupportSetting(containerEl: HTMLElement, vim: VimSupport, rerender: () => void): void {
	// State A: never enabled this session. B: enabled and live. C: disable scheduled for next restart.
	const state: 'A' | 'B' | 'C' = !vim.liveApplied ? 'A' : (vim.wantsOn ? 'B' : 'C');

	const baseDesc = 'Fixes two native bugs in Obsidian\'s Vim mode inside Live Preview table cells — ' +
		'h/l miscounting multi-byte characters (e.g. emoji), and h/l incorrectly jumping to the adjacent ' +
		'cell instead of stopping at the line boundary.<br>' +
		'Off by default: if you already customize h/l via your own vimrc or another Vim plugin, enabling this will override that.';

	const setting = new Setting(containerEl).setName('Vim h/l support (experimental)');
	const setDesc = (html: string) => setting.setDesc(sanitizeHTMLToDom(html));

	if (state === 'A') {
		setDesc(baseDesc);
		setting.addButton(btn => btn
			.setButtonText('Enable')
			.setCta()
			.onClick(() => {
				vim.enableHlSupport();
				rerender();
			}));
	} else if (state === 'B') {
		setDesc('✅ <b>Enabled</b> — takes effect immediately.<br>' + baseDesc);
		setting.addButton(btn => btn
			.setButtonText('Disable (after restart)')
			.setCta()
			.onClick(() => {
				vim.scheduleDisableHlSupport();
				rerender();
			}));
	} else {
		setDesc('⏳ <b>Will disable after you restart Obsidian.</b> Still active for the rest of this session.<br>' + baseDesc);
		setting.addButton(btn => btn
			.setButtonText('Keep enabled')
			.setCta()
			.onClick(() => {
				vim.cancelDisableHlSupport();
				rerender();
			}));
	}
}
