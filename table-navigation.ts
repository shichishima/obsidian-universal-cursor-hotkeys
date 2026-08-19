// Table navigation (exit table, jump to adjacent cell) — pure cursor
// movement, shared between the Vim leader-key commands (vim-support.ts) and
// the plain Emacs-side commands (main.ts). Lives in its own file, not
// vim-support.ts, precisely because it isn't vim-specific: both call sites
// pass in their own editor/host references, matching table-cell-utils.ts's
// own "no view-layer coupling, no owner-specific dependency" precedent.

import { getCellIndex, getChByCellIndex, getRightmostCellIndex } from './table-cell-utils';

export interface TableNavPos { line: number; ch: number }

export interface TableNavEditor {
	getCursor(): TableNavPos;
	getLine(line: number): string;
	setCursor(pos: TableNavPos): void;
	lastLine(): number;
}

// Mirrors the relevant slice of VimSupportHost — main.ts's own plugin class
// already implements all four (it's VimSupportHost's real implementation),
// so it can be passed directly as-is; vim-support.ts passes its own `host`.
export interface TableNavHost {
	isLinePartOfTable(editor: unknown, line: number, ch: number): boolean;
	getBeginningOfLinePosition(line: string, ch: number): number;
	crossTableRowForCell(editor: unknown, cellIndex: number, forward: boolean, goalCh: number, overshoot: number): TableNavPos | null;
	// Side-effect-free row lookup — see VimSupportHost's own doc comment for
	// why jumpAdjacentCell needs this instead of just inspecting
	// crossTableRowForCell's return value.
	getAdjacentRowLine(editor: unknown, forward: boolean): number;
	// See VimSupportHost's own doc comment — exitTable's cell→plain-text
	// transition needs the host's real CM6 dispatch, not a plain setCursor.
	setCursorAcrossTableBoundary(editor: unknown, line: number, ch: number): void;
	// See VimSupportHost's own doc comment — the "table runs to the
	// document's last line" case mirrors Ctrl-N's own EOF-append fix.
	appendBlankLineAndLand(editor: unknown): void;
}

// Exits the current table entirely — distinct from gg/G, which jump to the
// whole *document's* first/last line, not just past this one table. Scans
// line-by-line using the same cheap textual pre-filter used elsewhere in
// this plugin (vim-support.ts's own moveByLines/scheduleTableEntry, via the
// `trimStart().startsWith('|')` heuristic) rather than paying for the
// expensive syntax-tree isLinePartOfTable check on every line scanned — only
// the final boundary candidate gets that confirmation, and if it disagrees
// with the heuristic (a table row that doesn't start with a literal pipe),
// the scan just continues past it. Lands via getBeginningOfLinePosition
// (Smart Home aware), matching gg/G's own precedent for table-adjacent
// landings.
export function exitTable(editor: TableNavEditor, host: TableNavHost, forward: boolean): void {
	const lastLine = editor.lastLine();
	let line = editor.getCursor().line;
	while (forward ? line < lastLine : line > 0) {
		line += forward ? 1 : -1;
		const text = editor.getLine(line);
		if (text.trimStart().startsWith('|')) continue;
		if (host.isLinePartOfTable(editor, line, 1)) continue;
		// Leaving the table cell's own inline editor for the outer/whole-
		// document view needs the host's real CM6 dispatch (setCursorViaCm) —
		// confirmed live that the plain EditorBridge setCursor (paired with an
		// explicit focus(), in either order) does not reliably transition
		// inTableCell to false nor move visible DOM focus across this
		// specific boundary, unlike jumpAdjacentCell's own cell-to-cell
		// landings below (which never leave the table and work fine with it).
		host.setCursorAcrossTableBoundary(editor, line, host.getBeginningOfLinePosition(text, 1));
		return;
	}
	// Forward: the table runs all the way to the document's own last line —
	// mirror Ctrl-N's own setCursorToNextRow "append a blank line at EOF" fix
	// rather than no-op (the scan above already walked past any remaining
	// table rows, e.g. a delimiter, before reaching here, so `lastLine`
	// itself is already confirmed to still be table). Backward: no-op —
	// matches real vim's own "k at the buffer's first line" convention, and
	// setCursorToPrevRow's own asymmetric precedent (no "prepend a line"
	// equivalent exists on that side).
	if (forward) host.appendBlankLineAndLand(editor);
}

// Jumps directly to the adjacent cell, landing at its own content start — a
// coarser, spreadsheet-style "next cell" jump, distinct from vim's native
// j/k (column-position-preserving) or h/l (character-by-character). No-op at
// a table edge (leftmost/rightmost cell, first/last row) rather than
// wrapping or leaving the table.
export function jumpAdjacentCell(editor: TableNavEditor, host: TableNavHost, direction: 'h' | 'j' | 'k' | 'l'): void {
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	const cellIndex = getCellIndex(line, cursor.ch);
	if (direction === 'h' || direction === 'l') {
		const targetIndex = direction === 'h' ? cellIndex - 1 : cellIndex + 1;
		if (targetIndex < 0 || targetIndex > getRightmostCellIndex(line)) return;
		const ch = getChByCellIndex(line, targetIndex);
		if (ch === -1) return;
		editor.setCursor({ line: cursor.line, ch });
		return;
	}
	// j/k — crossTableRowForCell itself is *not* side-effect-free at a table
	// boundary (by design, matching Ctrl-P/N/gj/gk's own convention, it exits
	// the table rather than reporting "no landing" — confirmed live to
	// already move the cursor before its return value is even inspected), so
	// a real no-op here (matching h/l's own boundary behavior) needs this
	// check *first*, via the same side-effect-free row lookup Ctrl-P/N/
	// crossTableRowForCell's own row-finding already uses internally.
	if (host.getAdjacentRowLine(editor, direction === 'j') === -1) return;
	// Cross rows via the same "rough landing" primitive gj/gk's own step 1
	// already uses (see VimSupportHost's own crossTableRowForCell doc
	// comment): lands on cellIndex's own first/last <br>-segment, ch clamped
	// to 0. Snapped to the landed line's own content start afterward
	// (skipping leading whitespace/padding), same as every other cell-start
	// landing in vim-support.ts.
	const landed = host.crossTableRowForCell(editor, cellIndex, direction === 'j', 0, 1);
	if (!landed) return;
	const snappedCh = getChByCellIndex(editor.getLine(landed.line), cellIndex);
	editor.setCursor({ line: landed.line, ch: snappedCh === -1 ? landed.ch : snappedCh });
}
