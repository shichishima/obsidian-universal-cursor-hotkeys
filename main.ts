import { App, Editor, Plugin, PluginSettingTab, Setting, MarkdownView, ToggleComponent, sanitizeHTMLToDom } from 'obsidian';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from "@codemirror/view";
import { EditorSelection, Transaction } from '@codemirror/state';

// Extend the Obsidian Editor interface to include the internal CodeMirror 6 instance (EditorView)
declare module "obsidian" {
	interface Editor {
		cm: EditorView;
	}
}


interface UniversalCursorHotkeysSettings {
	smartHomeStandard: boolean;
	smartHomeAdvanced: boolean;
	visualLineMovement: boolean;
	crossRowNavigation: boolean;
}

const DEFAULT_SETTINGS: UniversalCursorHotkeysSettings = {
	smartHomeStandard: true,
	smartHomeAdvanced: true,
	visualLineMovement: true,
	crossRowNavigation: true,
};


interface InCellLineInfo {
	lineType: 'single' | 'first' | 'middle' | 'last';
	startOfInCellLine: number;   // left edge (ch position)
	endOfInCellLine: number;     // right edge (ch position)
	isEmpty: boolean;            // startOfInCellLine === endOfInCellLine
}


export default class universalCursorHotkeysPlugin extends Plugin {

	settings: UniversalCursorHotkeysSettings;

	private readonly CELL_SEPARATOR_REGEX = /(?<!\\)\|/g;
	private readonly TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/;

	private isKillChaining: boolean = false;
	private isDispatchingKill: boolean = false;
	private killCache: string = '';

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new UniversalCursorHotkeysSettingTab(this.app, this));

		this.addCommand({
			id: 'cursor-home',
			name: 'HOME',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveCursorHome(editor)
			}
		});

		this.addCommand({
			id: 'cursor-end',
			name: 'END',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveCursorEnd(editor)
			}
		});

		this.addCommand({
			id: 'cursor-up',
			name: 'UP',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveCursorUp(editor)
			}
		});

		this.addCommand({
			id: 'cursor-down',
			name: 'DOWN',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveCursorDown(editor)
			}
		});

		this.addCommand({
			id: 'cursor-left',
			name: 'LEFT',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveCursorLeft(editor)
			}
		});

		this.addCommand({
			id: 'cursor-right',
			name: 'RIGHT',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveCursorRight(editor)
			}
		});

		this.addCommand({
			id: "select-all",
			name: "Select all",
			editorCallback: (editor: Editor) => {
				editor.setSelection(
					{ line: 0, ch: 0 },
					{ line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length }
				);
			},
		});

		this.addCommand({
			id: 'kill-line',
			name: 'Kill line',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.killLine(editor);
			}
		});

		this.addCommand({
			id: 'yank',
			name: 'Yank',
			editorCallback: (editor: Editor, _: MarkdownView) => {
				void this.yank(editor);
			}
		});

		this.registerEditorExtension(
			EditorView.updateListener.of((update) => {
				if (!this.isKillChaining) return;
				if (update.docChanged || update.selectionSet) {
					// Only reset on genuine user actions (keystrokes, arrow keys, etc.).
					// Programmatic dispatches (our own, Obsidian's table editor re-dispatches)
					// carry no Transaction.userEvent annotation and are ignored here.
					const isUserAction = update.transactions.some(
						tr => tr.annotation(Transaction.userEvent) !== undefined
					);
					if (isUserAction && !this.isDispatchingKill) this.isKillChaining = false;
				}
			})
		);

		this.registerDomEvent(document, 'mousedown', () => {
			this.isKillChaining = false;
		});

		this.registerDomEvent(document, 'copy', () => {
			this.killCache = '';
		});

		this.registerDomEvent(document, 'cut', () => {
			this.killCache = '';
		});

	}

	onunload() {

	}


	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}


	//===========================================================================
	// Entry points: Ctrl-A / Ctrl-E / Ctrl-B / Ctrl-F
	//===========================================================================

	private moveCursorHome(editor: Editor) {
		const cursor = editor.getCursor();
		if (cursor.ch === 0) return;

		if (this.isLivePreviewMode() && this.isPositionInTable(editor)) {
			this.moveCursorHomeInTable(editor);
			return;
		}

		this.moveCursorHomeNonTable(editor);
	}


	private moveCursorEnd(editor: Editor) {
		if (this.isLivePreviewMode() && this.isPositionInTable(editor)) {
			this.moveCursorEndInTable(editor);
			return;
		}

		this.moveCursorEndNonTable(editor);
	}


	private moveCursorLeft(editor: Editor) {
		const cursor = editor.getCursor();

		if (this.isLivePreviewMode() && this.isPositionInTable(editor)) {
			const line = editor.getLine(cursor.line);
			const startOfCell = this.getStartOfCellContent(line, cursor.ch);
			const endOfCell = this.getEndOfCellContent(line, cursor.ch);
			if (startOfCell === endOfCell || cursor.ch <= startOfCell) {
				this.moveToLeftCellEnd(editor);
			} else {
				editor.exec('goLeft');
			}
			return;
		}

		editor.exec('goLeft');
	}


	private moveCursorRight(editor: Editor) {
		const cursor = editor.getCursor();

		if (this.isLivePreviewMode() && this.isPositionInTable(editor)) {
			const line = editor.getLine(cursor.line);
			const endOfCell = this.getEndOfCellContent(line, cursor.ch);
			if (cursor.ch >= endOfCell) {
				this.moveToRightCellStart(editor);
			} else {
				editor.exec('goRight');
			}
			return;
		}

		editor.exec('goRight');
	}


	//===========================================================================
	// Ctrl-A/E table helpers
	//===========================================================================

	// In-cell Home: every in-cell line, no 2-step Home.
	private moveCursorHomeInTable(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const info = this.getInCellLineInfo(line, cursor.ch);
		if (!info) return;

		if (info.isEmpty || cursor.ch <= info.startOfInCellLine) {
			if (info.lineType === 'single' || info.lineType === 'first') {
				this.moveToLeftCellEnd(editor);
			}
			return;
		}

		// Smart home within cell: apply Standard/Advanced prefix detection on cell content.
		const bounds = this.getCellBounds(line, cursor.ch);
		if (!bounds) return;
		const cellContent = line.slice(info.startOfInCellLine, bounds.close);
		const smartHomePos = info.startOfInCellLine + this.getBeginningOfLinePosition(cellContent, cursor.ch - info.startOfInCellLine);

		if (cursor.ch > smartHomePos) {
			this.setCursorViaCm(editor, cursor.line, smartHomePos);
			return;
		}
		// At or before smart home: step back to cell content start.
		this.setCursorViaCm(editor, cursor.line, info.startOfInCellLine);
	}


	// Non-table Home: visual-line-aware 2-step home, markdown-aware smart home.
	private moveCursorHomeNonTable(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cm = editor.cm;
		if (cm && this.settings.visualLineMovement) {
			const lineFrom = editor.posToOffset({ line: cursor.line, ch: 0 });
			const currentHead = cm.state.selection.main.head;
			const vlStart = cm.moveToLineBoundary(cm.state.selection.main, false, true);
			const vlCh = vlStart.head - lineFrom;
			// Only treat as VL2+ if vlCh is past the smart home position.
			// Prevents widget decorations (e.g. footnote [^1]: ) from causing a false VL dispatch.
			const lineSmartHomePos = this.getBeginningOfLinePosition(line, line.length || 1);

			if (vlStart.head !== currentHead && vlCh > lineSmartHomePos) {
				// Case (1a): VL2+, not at VL left edge -> move to VL left edge.
				cm.dispatch({
					selection: EditorSelection.create([EditorSelection.cursor(vlStart.head, vlStart.assoc)]),
					scrollIntoView: true,
					userEvent: 'move',
				});
				return;
			}
			// Case (1b): VL2+ at left edge, or Case (2): VL1 -> fall through to smart home.
		}

		// Smart home: content start -> ch=0.
		const position = this.getBeginningOfLinePosition(line, cursor.ch);
		editor.setCursor({ line: cursor.line, ch: position });
	}


	// In-cell End: every in-cell line, no 2-step End.
	private moveCursorEndInTable(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const info = this.getInCellLineInfo(line, cursor.ch);
		if (!info) return;

		if (info.isEmpty || cursor.ch >= info.endOfInCellLine) {
			if (info.lineType === 'single' || info.lineType === 'last') {
				this.moveToRightCellStart(editor);
			}
			return;
		}
		// Middle or left position -> move to right edge of current in-cell line.
		this.setCursorViaCm(editor, cursor.line, info.endOfInCellLine);
	}


	// Non-table End: visual-line-aware 2-step end.
	private moveCursorEndNonTable(editor: Editor) {
		const cm = editor.cm;
		if (cm && this.settings.visualLineMovement) {
			const currentHead = cm.state.selection.main.head;
			const vlEnd = cm.moveToLineBoundary(cm.state.selection.main, true, true);

			if (vlEnd.head !== currentHead) {
				// Not yet at VL end: move to VL end.
				cm.dispatch({
					selection: EditorSelection.create([EditorSelection.cursor(vlEnd.head, vlEnd.assoc)]),
					scrollIntoView: true,
					userEvent: 'move',
				});
				return;
			}
			// Fell through: already at VL end.
		}
		// visualLineMovement OFF, no cm, or already at VL end -> move to logical line end.
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		if (cursor.ch !== line.length) {
			editor.setCursor({ line: cursor.line, ch: line.length });
		}
	}


	//===========================================================================
	// Entry points: Ctrl-P / Ctrl-N
	//===========================================================================

	private moveCursorUp(editor: Editor) {
		const cursor = editor.getCursor();

		// Top of file: goUp is safe even inside a table.
		if (cursor.line === 0) { editor.exec('goUp'); return; }

		if (this.isLivePreviewMode()) {
			if (this.isPositionInTable(editor)) {
				this.moveCursorUpInTable(editor);
				return;
			}
			if (this.isPositionInTable(editor, cursor.line - 1, 1)) {
				this.moveCursorUpIntoTable(editor);
				return;
			}
		}

		editor.exec('goUp');
	}


	private moveCursorDown(editor: Editor) {
		const cursor = editor.getCursor();

		if (this.isLivePreviewMode()) {
			if (this.isPositionInTable(editor)) {
				this.moveCursorDownInTable(editor);
				return;
			}
			if (this.isPositionInTable(editor, cursor.line + 1, 1)) {
				this.moveCursorDownIntoTable(editor);
				return;
			}
		}

		// Last content line: at the absolute last line, or at the line just before a trailing empty line.
		const lastLine = editor.lineCount() - 1;
		if (cursor.line === lastLine ||
			(cursor.line === lastLine - 1 && editor.getLine(lastLine) === '')) {
			editor.exec('goDown');
			return;
		}

		editor.exec('goDown');
	}


	//===========================================================================
	// Ctrl-P/N table entry helpers
	//===========================================================================

	// Handles goUp when the cursor is inside a table cell in Live Preview mode.
	private moveCursorUpInTable(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const startOfCellContent = this.getStartOfCellContent(line, cursor.ch);
		const cellIndex = this.getCellIndex(line, cursor.ch);

		// Empty cell: goRight/goLeft does not enter the widget, so goUp is unreliable.
		// Detect by string analysis alone and navigate to the previous row directly.
		if (startOfCellContent === this.getEndOfCellContent(line, cursor.ch)) {
			this.setCursorToPrevRow(editor, cellIndex);
			this.scheduleBottomVisualLine(editor);
			return;
		}

		// goRight+goLeft: CM6 internally tracks which VL the cursor belongs to.
		// By stepping right then left, goLeft returns to the same ch but with the
		// correct assoc for the current VL (-1 if on VL_1 trailing edge, +1 if on
		// VL_2+ leading edge). This disambiguates the VL_1/VL_2 boundary where both
		// sides share the same ch value, and also registers the cursor inside the
		// table widget so subsequent goUp navigates visual lines correctly.
		editor.exec('goRight');
		editor.exec('goLeft');
		editor.exec('goUp');

		const cursorAfter = editor.getCursor();
		if (cursorAfter.line !== cursor.line) {
			// goUp moved to a different logical line (previous table row or outside table).
			// Re-place cursor at cell start so moveToBottomVisualLineOfCell can navigate down properly.
			if (this.isPositionInTable(editor)) {
				const targetCh = this.getChByCellIndex(editor.getLine(cursorAfter.line), cellIndex);
				if (targetCh !== -1) {
					this.setCursorViaCm(editor, cursorAfter.line, targetCh);
				}
			}
			this.scheduleBottomVisualLine(editor);
			return;
		}

		// goUp stayed on the same logical line.
		if (cursor.ch <= startOfCellContent) {
			// Was at cell start -> go to previous row.
			this.setCursorToPrevRow(editor, cellIndex);
			this.scheduleBottomVisualLine(editor);
			return;
		}

		if (cursorAfter.ch === startOfCellContent) {
			// goDown from VL1 start in a non-wrapped cell lands at VL1 end (= originalCh),
			// which causes the goDown probe in handleCellStartSnap to give a false case-b.
			// Detect this directly: if cursor was at end of cell content, it's VL1 end
			// of a non-wrapped cell -> go to previous row without probing.
			const endOfCellContent = this.getEndOfCellContent(line, cursor.ch);
			if (cursor.ch >= endOfCellContent) {
				// VL1 end of non-wrapped cell -> go to previous row.
				this.setCursorToPrevRow(editor, cellIndex);
				this.scheduleBottomVisualLine(editor);
			} else {
				this.handleCellStartSnap(editor, cursor.line, cursor.ch, cellIndex);
			}
		}
		// else: goUp moved within the cell to the visual line above - done.
	}


	// Handles goUp when the cursor is on the line directly below a table in Live Preview mode.
	private moveCursorUpIntoTable(editor: Editor) {
		const cursor = editor.getCursor();
		// Only enter the table if on VL1; if on VL2+, a regular goUp suffices.
		editor.exec('goUp');
		if (editor.getCursor().line === cursor.line) {
			// VL2+: goUp moved within visual lines, result already applied.
			return;
		}
		// VL1: goUp moved to the table's last row; reposition to the bottom-left cell.
		const targetLine = cursor.line - 1;
		const targetCh = this.getChByCellIndex(editor.getLine(targetLine), 0);
		if (targetCh !== -1) {
			editor.setCursor({ line: targetLine, ch: targetCh });
		}
		this.scheduleBottomVisualLine(editor);
	}


	// Handles goDown when the cursor is inside a table cell in Live Preview mode.
	private moveCursorDownInTable(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = this.getCellIndex(line, cursor.ch);
		const eoc = this.getEndOfCellContent(line, cursor.ch);
		const inCellInfo = this.getInCellLineInfo(line, cursor.ch);
		const type = inCellInfo?.lineType ?? 'single';

		// Empty cell: goDown is unreliable when the cursor was placed via cm.dispatch
		// (not registered inside the widget).  Detect by string analysis alone and
		// navigate to the next row directly, bypassing goDown entirely.
		if (this.getStartOfCellContent(line, cursor.ch) === eoc) {
			this.setCursorToNextRow(editor, cellIndex);
			return;
		}

		// <br> cells with more in-cell lines below (first/middle): goDown navigates
		// within the cell.  No post-check needed — we never exit the row here.
		if (type === 'first' || type === 'middle') {
			editor.exec('goDown');
			return;
		}

		// type is 'single' or 'last'.
		// If cursor is already at/past cell content end, we are at VL_N end.
		// goDown from this position is unreliable (no-op in LP even when a row exists
		// below).  Navigate to the next row directly.
		if (cursor.ch >= eoc) {
			this.setCursorToNextRow(editor, cellIndex);
			return;
		}

		// Call goDown once and inspect where the cursor lands.
		editor.exec('goDown');
		const after = editor.getCursor();

		if (after.line !== cursor.line) {
			// Exited to a different logical line.
			const afterText = editor.getLine(after.line);
			const isDelim = this.TABLE_DELIMITER_REGEX.test(afterText);
			if (isDelim) {
				this.setCursorToNextRow(editor, cellIndex);
			}
			return;
		}

		if (after.ch === cursor.ch) {
			// Complete no-op: nothing below (file-end).
			this.setCursorToNextRow(editor, cellIndex);
			return;
		}

		const eocAfter = this.getEndOfCellContent(line, after.ch);
		if (after.ch >= eocAfter) {
			// goDown stayed on the same line and ch reached/passed eoc.
			// This means we are on VL_N (last visual line) — exit to next row.
			this.setCursorToNextRow(editor, cellIndex);
			return;
		}

		// ch moved within cell: soft-wrap VL advance.
	}


	// Handles goDown when the cursor is on the line directly above a table in Live Preview mode.
	private moveCursorDownIntoTable(editor: Editor) {
		const cursor = editor.getCursor();
		const targetCh = this.getChByCellIndex(editor.getLine(cursor.line + 1), 0);
		editor.setCursor({ line: cursor.line + 1, ch: targetCh });
	}


	//===========================================================================
	// Shared table actions
	//===========================================================================

	// move to Left cell / Right edge
	//	(a)->(A) : same row
	//	(b)->(B) : if leftmost cell, move to upper row & rightmost cell
	//	(c)->(C) : if left edge of 1st row, leftmost column, exit table above
	// shared by moveCursorHome (Ctrl-A) and moveCursorLeft (Ctrl-B)
	//
	//  cellIndex=0          1           lastCellIndex
	// (C)
	// +--------------+-------------+---+--------------+
	// |(c)Header     | Header      |...|              |
	// +--------------+-------------+---+--------------+
	// | some text in |(a)some text |...| some text in |
	// | the cell(A)  | in the cell |   | the cell(B)  |
	// +--------------+-------------+---+--------------+
	// |(b)some text  |             |...|              |
	// | in the cell  |             |   |              |
	// +--------------+-------------+---+--------------+
	private moveToLeftCellEnd(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = this.getCellIndex(line, cursor.ch);

		if (cellIndex > 0) {
			// Same row: move to left cell's end
			const targetCh = this.getEndOfCellContentByCellIndex(line, cellIndex - 1);
			if (targetCh !== -1) {
				this.setCursorViaCm(editor, cursor.line, targetCh);
			}
			return;
		}

		// Leftmost cell: stop here when row wrapping is disabled
		if (!this.settings.crossRowNavigation) return;

		// Leftmost cell: go to previous row
		const targetLine = this.getPrevRowLine(editor);
		if (targetLine === -1) {
			// Header row: go outside table. (c)->(C)
			if (cursor.line > 0) {
				this.setCursorViaCm(editor, cursor.line - 1, 0);
			}
			return;
		}
		// Previous row: rightmost cell end
		const targetLineText = editor.getLine(targetLine);
		const rightmostIndex = this.getRightmostCellIndex(targetLineText);
		const targetCh = this.getEndOfCellContentByCellIndex(targetLineText, rightmostIndex);
		if (targetCh !== -1) {
			this.setCursorViaCm(editor, targetLine, targetCh);
		}
	}


	// move to Right cell / Left edge
	//	(a)->(A) : same row
	//	(b)->(B) : if rightmost cell, move to lower row & leftmost cell
	//	(c)->(C) : if right edge of bottom row, rightmost column, exit table below
	// shared by moveCursorEnd (Ctrl-E) and moveCursorRight (Ctrl-F)
	//
	//  cellIndex=0      lastCellIndex-1  lastCellIndex
	// +-------------+---+---------------+---------------+
	// |             |...| some text in |(A)some text in |
	// |             |   | the cell(a)  | the cell(b)    |
	// +-------------+---+--------------+----------------+
	// |(B)some text |...|              | some text in   |
	// | in the cell |   |              | the cell(c)    |
	// +-------------+----+-------------+----------------+
	// (C)
	private moveToRightCellStart(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = this.getCellIndex(line, cursor.ch);
		const lastCellIndex = this.getRightmostCellIndex(line);

		if (cellIndex < lastCellIndex) {
			// Same row: move to right cell's start
			const targetCh = this.getChByCellIndex(line, cellIndex + 1);
			if (targetCh !== -1) {
				this.setCursorViaCm(editor, cursor.line, targetCh);
			}
			return;
		}

		// Rightmost cell: stop here when row wrapping is disabled
		if (!this.settings.crossRowNavigation) return;

		// Rightmost cell: go to next row
		const targetLine = this.getNextRowLine(editor);
		if (targetLine === -1) {
			// Last row: go outside table (c)->(C), skipping any remaining table rows (e.g. delimiter).
			let exitLine = cursor.line + 1;
			while (exitLine < editor.lineCount() && this.isPositionInTable(editor, exitLine, 1)) {
				exitLine++;
			}
			if (exitLine >= editor.lineCount()) {
				editor.replaceRange('\n', { line: exitLine - 1, ch: editor.getLine(exitLine - 1).length });
			}
			this.setCursorViaCm(editor, exitLine, 0);
			return;
		}
		// Next row: leftmost cell start
		const targetCh = this.getChByCellIndex(editor.getLine(targetLine), 0);
		if (targetCh !== -1) {
			this.setCursorViaCm(editor, targetLine, targetCh);
		}
	}


	//===========================================================================
	// Table row navigation
	//===========================================================================

	// Pure computation: given whether the adjacent line is in the table and its text,
	// returns the target line number for upward navigation.
	// Extracted from getPrevRowLine to allow unit testing of delimiter detection logic.
	private computePrevRowLine(currentLine: number, prevLineInTable: boolean, prevLineText: string): number {
		if (!prevLineInTable) return -1;
		return this.TABLE_DELIMITER_REGEX.test(prevLineText) ? currentLine - 2 : currentLine - 1;
	}


	// Pure computation: given whether adjacent lines are in the table and the next line's text,
	// returns the target line number for downward navigation.
	// Extracted from getNextRowLine to allow unit testing of delimiter detection logic.
	private computeNextRowLine(currentLine: number, nextLineInTable: boolean, nextLineText: string, lineAfterNextInTable: boolean): number {
		if (!nextLineInTable) return -1;
		if (this.TABLE_DELIMITER_REGEX.test(nextLineText)) {
			// Verify cursor.line+2 exists and is actually a data row inside the table.
			// Without this, a header-only table would return a line outside the table.
			if (!lineAfterNextInTable) return -1;
			return currentLine + 2;
		}
		return currentLine + 1;
	}


	// Returns the line number of the previous table data row.
	// Returns -1 when the current row is the header row (caller should go outside the table).
	private getPrevRowLine(editor: Editor): number {
		const cursor = editor.getCursor();
		return this.computePrevRowLine(
			cursor.line,
			this.isPositionInTable(editor, cursor.line - 1, 1),
			editor.getLine(cursor.line - 1),
		);
	}


	// Returns the line number of the next table data row.
	// Returns -1 when the current row is the last row (caller should go outside the table).
	private getNextRowLine(editor: Editor): number {
		const cursor = editor.getCursor();
		const nextLineExists = cursor.line + 1 < editor.lineCount();
		const lineAfterNextInTable = cursor.line + 2 < editor.lineCount()
			&& this.isPositionInTable(editor, cursor.line + 2, 1);
		return this.computeNextRowLine(
			cursor.line,
			nextLineExists && this.isPositionInTable(editor, cursor.line + 1, 1),
			editor.getLine(cursor.line + 1),
			lineAfterNextInTable,
		);
	}


	// Moves the cursor to the beginning of the specified column in the previous row.
	//
	// (*1)                     <-- BlankLine
	// | header | (*2)header |  <-- HeaderRow
	// | ------ | ---------- |  <-- DelimiterLine
	// | text   | (*3)text   |  <-- FirstDataRow
	// | text   | (*4)text   |
	//
	// (*2)->(*1) if above is outside table (header row), go out.
	// (*3)->(*2) if above is delimiter line, go to cursor.line-2.
	// (*4)->(*3) go to cursor.line-1.
	private setCursorToPrevRow(editor: Editor, cellIndex: number) {
		const cursor = editor.getCursor();
		const targetLine = this.getPrevRowLine(editor);

		if (targetLine === -1) {
			// Header row: go outside table
			this.setCursorViaCm(editor, cursor.line - 1, 0);
			return;
		}
		const targetCh = this.getChByCellIndex(editor.getLine(targetLine), cellIndex);
		if (targetCh !== -1) {
			this.setCursorViaCm(editor, targetLine, targetCh);
		}
	}


	// Moves the cursor to the beginning of the specified column in the next row.
	//
	// | header | (*1)header |  <-- HeaderRow
	// | ------ | ---------- |  <-- DelimiterLine
	// | text   | (*2)text   |
	// | text   | (*3)text   |
	// (*4)
	//
	// (*1)->(*2) if below is delimiter line, go to cursor.line+2.
	// (*2)->(*3) go to cursor.line+1.
	// (*3)->(*4) go outside table.
	private setCursorToNextRow(editor: Editor, cellIndex: number) {
		const cursor = editor.getCursor();
		const targetLine = this.getNextRowLine(editor);

		if (targetLine === -1) {
			// Last data row: exit below, skipping any remaining table rows (e.g. delimiter).
			let exitLine = cursor.line + 1;
			while (exitLine < editor.lineCount() && this.isPositionInTable(editor, exitLine, 1)) {
				exitLine++;
			}
			if (exitLine >= editor.lineCount()) {
				editor.replaceRange('\n', { line: exitLine - 1, ch: editor.getLine(exitLine - 1).length });
			}
			this.setCursorViaCm(editor, exitLine, 0);
			return;
		}
		const targetCh = this.getChByCellIndex(editor.getLine(targetLine), cellIndex);
		if (targetCh !== -1) {
			this.setCursorViaCm(editor, targetLine, targetCh);
		}
	}


	//===========================================================================
	// In-cell line analysis
	//===========================================================================

	// Parses the cell at position ch and returns info about the in-cell line
	// (the <br>-delimited sub-line) that the cursor is currently on.
	private getInCellLineInfo(line: string, ch: number): InCellLineInfo | null {
		// 1. Find bounding pipes for the cell containing ch
		const bounds = this.getCellBounds(line, ch);
		if (!bounds) return null;
		const cellStart = bounds.open + 1;
		const cellEnd   = bounds.close;

		// 2. Find <br> tags within the cell (case-insensitive, no spaces or slash inside)
		const cellContent = line.slice(cellStart, cellEnd);
		const brMatches   = [...cellContent.matchAll(/<[bB][rR]>/g)];
		const brPositions = brMatches.map(m => ({
			start: cellStart + m.index,
			end:   cellStart + m.index + m[0].length,
		}));

		// 3. Build in-cell line segments separated by <br> tags
		//    Segment k: [ prevEnd, brPositions[k].start )
		//    Last segment: [ brPositions[n-1].end, cellEnd )
		const segments: Array<{ start: number; end: number }> = [];
		let prevEnd = cellStart;
		for (const br of brPositions) {
			segments.push({ start: prevEnd, end: br.start });
			prevEnd = br.end;
		}
		segments.push({ start: prevEnd, end: cellEnd });

		// 4. Find which segment contains ch
		//    Boundary: ch at seg.end (= br.start) belongs to the current segment (right edge of it)
		let segIndex = segments.findIndex(seg => ch >= seg.start && ch <= seg.end);
		if (segIndex === -1) {
			// ch is inside a <br> tag: assign to the preceding segment
			for (let i = 0; i < brPositions.length; i++) {
				if (ch > brPositions[i].start && ch < brPositions[i].end) {
					segIndex = i;
					break;
				}
			}
		}
		if (segIndex === -1) segIndex = segments.length - 1; // final fallback

		const seg = segments[segIndex];
		const n   = segments.length;

		// 5. Determine line type
		const lineType: InCellLineInfo['lineType'] =
			n === 1         ? 'single' :
			segIndex === 0  ? 'first'  :
			segIndex < n -1 ? 'middle' : 'last';

		// 6. Compute startOfInCellLine and endOfInCellLine
		//
		//  single / first : startOfInCellLine = first non-whitespace character position
		//                   (leading spaces after pipe or <br> are the separator, not content)
		//  middle / last  : startOfInCellLine = position right after <br>  (= seg.start)
		//
		//  single / last  : endOfInCellLine = position after last non-whitespace  (trimEnd)
		//  first  / middle: endOfInCellLine = position of <br>  (= seg.end)
		//
		//  isEmpty fallback when no non-whitespace is found:
		//    single -> seg.start  (endOfInCellLine = seg.start + 0 = seg.start -> isEmpty)
		//    first  -> seg.end    (= br.start -> startOfInCellLine = endOfInCellLine -> isEmpty)
		const segContent = line.slice(seg.start, seg.end);
		let startOfInCellLine: number;
		let endOfInCellLine: number;

		if (lineType === 'single' || lineType === 'first') {
			const firstNonSpace = segContent.search(/\S/);
			if (firstNonSpace === -1) {
				startOfInCellLine = lineType === 'single' ? seg.start : seg.end;
			} else {
				startOfInCellLine = seg.start + firstNonSpace;
			}
		} else {
			startOfInCellLine = seg.start; // right after <br>
		}

		if (lineType === 'single' || lineType === 'last') {
			endOfInCellLine = seg.start + segContent.trimEnd().length;
		} else {
			endOfInCellLine = seg.end; // position of <br>
		}

		return {
			lineType,
			startOfInCellLine,
			endOfInCellLine,
			isEmpty: startOfInCellLine === endOfInCellLine,
		};
	}


	//===========================================================================
	// Cell content position helpers
	//===========================================================================

	// Returns the open/close pipe positions bounding the cell that contains ch.
	// open  = index of the pipe immediately to the left of ch
	// close = index of the pipe immediately to the right of ch (or line.length if absent)
	// Returns null if ch is not inside any cell (no pipe to the left).
	private getCellBounds(line: string, ch: number): { open: number; close: number } | null {
		const pipes = this.getPipePositions(line);
		let open = -1;
		for (const p of pipes) {
			if (p < ch) open = p;
			else break;
		}
		if (open === -1) return null;
		const close = pipes.find(p => p >= ch) ?? line.length;
		return { open, close };
	}

	// +----------------------+
	// |(a)some text in the   |	(a) startOfCellContent
	// | cell.<br>            |
	// | 2nd in-cell line<br> |	(*) cursor potition
	// | cursor is(*)here<br> |
	// | last in-cell line(b) |	(b) endOfCellContent
	// +----------------------+
	// Indicates cell start/end, regardless of line wrapping or in-cell lines.

	// Returns target cursor position when moving to the left cell with Ctrl-E or Ctrl-F.
	private getStartOfCellContent(line: string, ch: number): number {
		const bounds = this.getCellBounds(line, ch);
		if (!bounds) return 0;
		const { open, close } = bounds;
		const firstNonSpace = line.slice(open + 1, close).search(/\S/);
		return firstNonSpace === -1 ? open + 1 : open + 1 + firstNonSpace;
	}


	// Returns target cursor position when moving to the right cell with Ctrl-A or Ctrl-B.
	private getEndOfCellContent(line: string, ch: number): number {
		const bounds = this.getCellBounds(line, ch);
		if (!bounds) return 0;
		const { open, close } = bounds;
		return open + 1 + line.slice(open + 1, close).trimEnd().length;
	}


	// Returns endOfCellContent for the cell at the given 0-based cellIndex.
	// Returns -1 if cellIndex is out of range.
	private getEndOfCellContentByCellIndex(line: string, cellIndex: number): number {
		const pipes = this.getPipePositions(line);
		if (cellIndex < 0 || cellIndex + 1 >= pipes.length) return -1;
		const openPipe  = pipes[cellIndex];
		const closePipe = pipes[cellIndex + 1];
		return openPipe + 1 + line.slice(openPipe + 1, closePipe).trimEnd().length;
	}


	// Returns the 0-based index of the rightmost cell in a table row.
	private getRightmostCellIndex(line: string): number {
		return Math.max(0, this.getPipePositions(line).length - 2);
	}


	//===========================================================================
	// Cell index helpers
	//===========================================================================

	private getCellIndex(line: string, ch: number): number {
		return Math.max(0, this.getPipePositions(line.substring(0, ch)).length - 1);
	}


	private getChByCellIndex(lineText: string, cellIndex: number): number {
		const pipes = this.getPipePositions(lineText);

		if (cellIndex >= 0 && cellIndex < pipes.length) {
			const pipeIndex = pipes[cellIndex];
			const searchEnd = pipes[cellIndex + 1] ?? lineText.length;
			const cellContent = lineText.substring(pipeIndex + 1, searchEnd);
			const firstNonSpaceMatch = cellContent.search(/\S/);

			return firstNonSpaceMatch !== -1
				? pipeIndex + 1 + firstNonSpaceMatch
				: pipeIndex + 1;
		}

		return -1;
	}


	//===========================================================================
	// Ctrl-P/N deeper helpers
	//===========================================================================

	// Called when goUp snapped the cursor to startOfCellContent.
	// Probes with goDown to distinguish VL1-middle from VL2+ left edge.
	private handleCellStartSnap(editor: Editor, originalLine: number, originalCh: number, cellIndex: number) {
		editor.exec('goDown');
		const backTest = editor.getCursor();
		if (backTest.line === originalLine && backTest.ch === originalCh) {
			// VL2+ left edge: stay at VL1 start
			editor.exec('goUp');
		} else {
			// VL1 middle: go to previous row
			editor.exec('goUp');
			this.setCursorToPrevRow(editor, cellIndex);
			this.scheduleBottomVisualLine(editor);
		}
	}


	// Schedules moveToBottomVisualLineOfCell for the next event loop tick.
	// Used after synchronous cursor placement to let the DOM settle first.
	private scheduleBottomVisualLine(editor: Editor) {
		setTimeout(() => {
			if (this.isPositionInTable(editor)) {
				this.moveToBottomVisualLineOfCell(editor);
			}
		}, 0);
	}


	// Move to the bottom visual line of the current table cell.
	// Strategy:
	//   1. goRight: works around a Live Preview issue where goDown from the leftmost
	//      cell position (placed by cm.dispatch) exits the table immediately.
	//   2. goDown loop: navigates visual lines until no further movement or line change.
	//      lastPos ends up at the bottom visual line or at cell end (non-wrapped).
	//   3. Determine landing position:
	//      - lastPos within cell content: on bottom visual line -> stay at lastPos.
	//      - lastPos at/past cell content end: non-wrapped cell -> restore to cell start.
	private moveToBottomVisualLineOfCell(editor: Editor) {
		const startLine  = editor.getCursor().line;
		const originalPos = editor.getCursor();
		const line = editor.getLine(startLine);

		editor.exec('goRight');
		if (editor.getCursor().line !== startLine) {
			editor.setCursor(originalPos);
			return;
		}
		editor.exec('goLeft');

		const endOfCellContent = this.getEndOfCellContent(line, originalPos.ch);
		let lastPos = editor.getCursor();
		let breakReason: 'endOfCell' | 'noMove' | 'exitedLine' = 'noMove';

		while (true) {
			editor.exec('goDown');
			const newPos = editor.getCursor();

			if (newPos.line !== startLine) {
				breakReason = 'exitedLine';
				break;
			}
			if (newPos.ch === lastPos.ch) {
				breakReason = 'noMove';
				break;
			}
			if (newPos.ch >= endOfCellContent) {
				breakReason = 'endOfCell';
				break;
			}

			lastPos = { line: newPos.line, ch: newPos.ch };
		}

		if (breakReason === 'endOfCell') {
			setTimeout(() => { this.setCursorViaCm(editor, lastPos.line, lastPos.ch); }, 0);
			return;
		}

		if (breakReason === 'exitedLine') {
			editor.exec('goUp');
		}
	}


	//===========================================================================
	// Infrastructure
	//===========================================================================

	private isPositionInTable(editor: Editor, line?: number, ch?: number): boolean {
		const cm = editor.cm;
		if (!cm) return false;

		const posObj = (line !== undefined && ch !== undefined)
			? { line, ch }
			: editor.getCursor();
		const pos = editor.posToOffset(posObj);

		const tree = syntaxTree(cm.state);

		let node = tree.resolveInner(pos, -1);
		while (node) {
			if (node.name.includes('Table') || node.name.includes('table')) {
				return true;
			}
			node = node.parent!;
		}

		return false;
	}


	// Use cm.dispatch directly to avoid triggering Obsidian's table editor
	// interference that occurs when moving the cursor within a Live Preview table.
	private setCursorViaCm(editor: Editor, line: number, ch: number) {
		const cm  = editor.cm;
		const pos = editor.posToOffset({ line, ch });
		cm.dispatch({ selection: { anchor: pos, head: pos } });
		cm.focus();
	}


	private isLivePreviewMode(): boolean {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return false;

		const mode = view.getMode();
		if (mode !== "source") return false;

		return !view.getState().source;
	}


	// Returns the ch position of the content-start for smart Home in non-table lines.
	// When smartHomeStandard is OFF, always returns 0 (plain logical line start).
	private getBeginningOfLinePosition(line: string, ch: number): number {

		if (!this.settings.smartHomeStandard) {
			return 0;
		}

		let result = null
		if (this.settings.smartHomeAdvanced) {
			// Headings in an unordered list (Adv.)
			// `- # heading-text`, 1st after `# `, 2nd after `- `
			result = line.match(/^(\s*[-+*]\s)?#+\s/);
			if (result !== null && result[0].length < ch) {
				return result[0].length;
			}

			result = line.match(/^#{1,6}\s/); // Headings (Adv.)

			if (result === null) {
				result = line.match(/^\[\^.+\]:\s*/); // Footnotes (Adv.)
			}
		}
		if (result === null) {
			result = line.match(/^\s*\d+[.)]\s/); // Ordered lists
		}
		if (result === null) {
			result = line.match(/^\s*>\s*/); // Quotes
		}
		if (result === null) {
			// Indents, Unordered lists, Task lists
			result = line.match(/^\s*([-+*]\s(\[.\]\s)?)?/);
		}

		if (result !== null && result[0].length < ch) {
			return result[0].length;
		} else {
			return 0;
		}
	}


	private getPipePositions(line: string): number[] {
		return [...line.matchAll(this.CELL_SEPARATOR_REGEX)].map(m => m.index);
	}


	private isTableLineSourceMode(line: string): boolean {
		const trimmed = line.trimEnd();
		return trimmed.startsWith('|') && trimmed.endsWith('|');
	}


	//===========================================================================
	// Kill line (Ctrl-K)
	//===========================================================================

	private killLine(editor: Editor) {
		const lineText = editor.getLine(editor.getCursor().line);
		const inLPTable = this.isLivePreviewMode() && this.isPositionInTable(editor);
		const inSourceTable = !this.isLivePreviewMode() && this.isTableLineSourceMode(lineText);

		if (inLPTable || inSourceTable) {
			const info = this.getInCellLineInfo(lineText, editor.getCursor().ch);
			if (info) {
				this.killLineInCellContext(editor, info);
				return;
			}
		}

		this.killLineNonTable(editor);
	}


	private killLineNonTable(editor: Editor) {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);

		if (cursor.ch < lineText.length) {
			const text = lineText.slice(cursor.ch);
			this.updateKillCache(text);
			navigator.clipboard.writeText(this.killCache).catch(() => {});
			this.isDispatchingKill = true;
			editor.replaceRange('', cursor, { line: cursor.line, ch: lineText.length });
			this.isDispatchingKill = false;
			this.isKillChaining = true;
			return;
		}

		if (cursor.line >= editor.lineCount() - 1) return;

		const nextLineText = editor.getLine(cursor.line + 1);
		const leadingWs = this.settings.smartHomeStandard
			? (nextLineText.match(/^[ \t]*/)?.[0] ?? '')
			: '';
		this.updateKillCache('\n' + leadingWs);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		this.isDispatchingKill = true;
		editor.replaceRange('', { line: cursor.line, ch: lineText.length }, { line: cursor.line + 1, ch: leadingWs.length });
		this.isDispatchingKill = false;
		this.isKillChaining = true;
	}


	private killLineInCellContext(editor: Editor, info: InCellLineInfo) {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);

		if (cursor.ch < info.endOfInCellLine) {
			const text = lineText.slice(cursor.ch, info.endOfInCellLine);
			this.updateKillCache(this.normalizeKillText(text));
			navigator.clipboard.writeText(this.killCache).catch(() => {});
			this.isDispatchingKill = true;
			editor.replaceRange('', cursor, { line: cursor.line, ch: info.endOfInCellLine });
			this.isDispatchingKill = false;
			this.isKillChaining = true;
			return;
		}

		// lineType 'first'/'middle': kill <br> forward from endOfInCellLine
		if (info.lineType === 'first' || info.lineType === 'middle') {
			const brMatch = lineText.slice(info.endOfInCellLine).match(/^<[bB][rR]>([ \t]*)/);
			if (brMatch) {
				const toCh = info.endOfInCellLine + brMatch[0].length;
				const targetCh = info.endOfInCellLine;
				const targetLine = cursor.line;
				this.updateKillCache('\n');
				navigator.clipboard.writeText(this.killCache).catch(() => {});
				this.isDispatchingKill = true;
				editor.setLine(targetLine, lineText.slice(0, targetCh) + lineText.slice(toCh));
				this.isDispatchingKill = false;
				// Defer cursor restore until after Obsidian's table editor re-dispatch settles,
				// then set isKillChaining so the chain isn't broken by that re-dispatch.
				setTimeout(() => {
					this.isDispatchingKill = true;
					this.setCursorViaCm(editor, targetLine, targetCh);
					this.isDispatchingKill = false;
					this.isKillChaining = true;
				}, 0);
				return;
			}
		}

		// LP cursor snap: cursor may land at br.end (= startOfInCellLine of 'middle'/'last')
		// rather than br.start. Kill the <br> that ends at cursor.ch.
		if ((info.lineType === 'middle' || info.lineType === 'last') && cursor.ch === info.startOfInCellLine) {
			const brMatch = lineText.slice(0, cursor.ch).match(/<[bB][rR]>([ \t]*)$/);
			if (brMatch) {
				const brStart = cursor.ch - brMatch[0].length;
				const targetLine = cursor.line;
				this.updateKillCache('\n');
				navigator.clipboard.writeText(this.killCache).catch(() => {});
				this.isDispatchingKill = true;
				editor.setLine(targetLine, lineText.slice(0, brStart) + lineText.slice(cursor.ch));
				this.isDispatchingKill = false;
				setTimeout(() => {
					this.isDispatchingKill = true;
					this.setCursorViaCm(editor, targetLine, brStart);
					this.isDispatchingKill = false;
					this.isKillChaining = true;
				}, 0);
				return;
			}
		}
	}


	private normalizeKillText(text: string): string {
		return text.replace(/<[bB][rR]>/g, '\n').replace(/\\\|/g, '|');
	}


	private updateKillCache(text: string): void {
		this.killCache = this.isKillChaining ? this.killCache + text : text;
	}


	//===========================================================================
	// Yank (Ctrl-Y)
	//===========================================================================

	private async yank(editor: Editor) {
		let raw: string;
		try {
			raw = await navigator.clipboard.readText();
		} catch {
			raw = this.killCache;
		}
		if (!raw) return;

		const lineText = editor.getLine(editor.getCursor().line);
		const inLPTable = this.isLivePreviewMode() && this.isPositionInTable(editor);
		const inTable = inLPTable || this.isTableLineSourceMode(lineText);

		const text = inTable
			? raw.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
			: raw;

		if (inLPTable && text.includes('<br>')) {
			const from = editor.getCursor('from');
			const targetLine = from.line;
			const targetCh   = from.ch + text.length;
			editor.replaceSelection(text);
			setTimeout(() => {
				this.setCursorViaCm(editor, targetLine, targetCh);
			}, 0);
		} else {
			editor.replaceSelection(text);
		}
	}

}


class UniversalCursorHotkeysSettingTab extends PluginSettingTab {
	plugin: universalCursorHotkeysPlugin;

	constructor(app: App, plugin: universalCursorHotkeysPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Visual line movement')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> HOME/END first moves to the visual line edge, then to the logical line start/end.<br>' +
				'<b>OFF:</b> Moves directly to the logical line start/end.<br>' +
				'<i>Does not apply inside table cells.</i>'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.visualLineMovement)
				.onChange(async (value) => {
					this.plugin.settings.visualLineMovement = value;
					await this.plugin.saveSettings();
				}));

		let advancedEl: HTMLElement;
		let advancedToggle: ToggleComponent;
		const setAdvancedDisabled = (disabled: boolean) => {
			advancedEl.style.opacity       = disabled ? '0.4' : '';
			advancedEl.style.pointerEvents = disabled ? 'none' : '';
			if (disabled && this.plugin.settings.smartHomeAdvanced) {
				this.plugin.settings.smartHomeAdvanced = false;
				advancedToggle.setValue(false);
				void this.plugin.saveSettings();
			}
		};

		new Setting(containerEl)
			.setName('Smart home (standard)')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> HOME moves to the content start, after leading Markdown syntax (lists, checkboxes, indents, etc.). Kill Line also trims leading whitespace when joining lines.<br>' +
				'<b>OFF:</b> Moves directly to the start of the line. Kill Line joins lines as-is, preserving leading whitespace.'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.smartHomeStandard)
				.onChange(async (value) => {
					this.plugin.settings.smartHomeStandard = value;
					setAdvancedDisabled(!value);
					await this.plugin.saveSettings();
				}));

		advancedEl = new Setting(containerEl)
			.setName('Smart home (advanced)')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> Also skips past headings (<code>#</code>) and footnotes (<code>[^1]:</code>).<br>' +
				'<i>Requires <b>Smart HOME (standard)</b> to be enabled.</i>'))
			.addToggle(toggle => {
				advancedToggle = toggle;
				toggle.setValue(this.plugin.settings.smartHomeAdvanced)
					.onChange(async (value) => {
						this.plugin.settings.smartHomeAdvanced = value;
						await this.plugin.saveSettings();
					});
			})
			.settingEl;

		setAdvancedDisabled(!this.plugin.settings.smartHomeStandard);

		new Setting(containerEl)
			.setName('Cross-row navigation')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> LEFT/HOME at the leftmost cell and RIGHT/END at the rightmost cell wrap to the adjacent row.<br>' +
				'<b>OFF:</b> Stops at the boundary.'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.crossRowNavigation)
				.onChange(async (value) => {
					this.plugin.settings.crossRowNavigation = value;
					await this.plugin.saveSettings();
				}));
	}

	private setHtmlDesc(setting: Setting, html: string): Setting {
		return setting.setDesc(sanitizeHTMLToDom(html));
	}
}
