import { Editor, Plugin, MarkdownView } from 'obsidian';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from "@codemirror/view";

// Extend the Obsidian Editor interface to include the internal CodeMirror 6 instance (EditorView)
declare module "obsidian" {
    interface Editor {
        cm: EditorView;
    }
}


const CELL_SEPARATOR_REGEX = /(?<!\\)\|/g;

export default class universalCursorHotkeysPlugin extends Plugin {

	onload() {

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

	}

	onunload() {

	}


	moveCursorHome(editor: Editor) {
		const cursor = editor.getCursor();
		let position = cursor.ch;
		if (position === 0) return;

		const line = editor.getLine(cursor.line);
		if (this.isLivePreviewMode() && this.isPositionInTable(editor)) {
			// LivePreviewMode & In the table
			({ pos: position } = this.getBeginningOfCellPosition(line, position));
		} else {
			// Out of table
			position = this.getBeginningOfLinePosition(line, position);
		}
		editor.setCursor({ line: cursor.line, ch: position });
	}


	isPositionInTable(editor: Editor, line?: number, ch?: number): boolean {
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
	setCursorViaCm(editor: Editor, line: number, ch: number) {
		const cm = editor.cm;
		const pos = editor.posToOffset({ line, ch });
		cm.dispatch({ selection: { anchor: pos, head: pos } });
		cm.focus();
	}


	isLivePreviewMode(): boolean {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (view) {
			const mode = view.getMode(); // "preview" or "source"

			if (mode === 'preview') {
				return false;
			} else if (mode === "source") {
				const state = view.getState();

				if (state.source) {
					return false;
				} else {
					return true;
				}
			}
		}
		return false;
	}


	//   ch ...   d  c                b  b   a              a
	//            V  V                V  V   V              V
	// line ... |    left cell text |    current cell text      |
	//  pos ...   D  C            B      A
	//
	//					ch=a   -> return pos=A,   edge=false
	//					ch=b   -> return pos=B,   edge=true
	//					ch=c,d -> return pos=C,D, edge=true
	//
	getBeginningOfCellPosition(line: string, ch: number): { pos: number, isOnLeftEdge: boolean } {
		const lastPipeIndex = line.lastIndexOf('|', ch - 1);
		if (lastPipeIndex === -1) return { pos: 0, isOnLeftEdge: true };

		// Locate the first non-space character in the current cell
		const startOffset = line.slice(lastPipeIndex + 1).search(/\S|$/);
		const startOfCellContent = lastPipeIndex + 1 + startOffset;
		if (ch > startOfCellContent) {
			return { pos: startOfCellContent, isOnLeftEdge: false }; // (A)
		}

		if (lastPipeIndex === 0) {
			return { pos: ch, isOnLeftEdge: true }; // Leftmost cell (C,D)
		}

		// If already at the start, move to the end of the previous cell content.
		const secondLastPipeIndex = line.lastIndexOf('|', lastPipeIndex - 1);
		if (secondLastPipeIndex !== -1) {
			const endOffset = line.slice(secondLastPipeIndex + 1, lastPipeIndex).trimEnd().length;
			return { pos: secondLastPipeIndex + 1 + endOffset, isOnLeftEdge: true }; // (B)
		}
		return { pos: ch, isOnLeftEdge: true };
	}


	getBeginningOfLinePosition(line: string, ch: number): number {

		// Headings in an unordered list
		//    - ###
		// First to the beginning of the heading,
		// then to the beginning of the list,
		// and a third time to the beginning of the line
		let result = line.match(/^(\s*[-+*]\s)?#+\s/);
		if (result !== null && result[0].length < ch) {
			return result[0].length;
		}

		// Headings
		// # or ## or... ###### (heading 1 to 6)
		result = line.match(/^#{1,6}\s/);

		if (result === null) {
			// Footnotes
			// [^1]: (not only number)
			result = line.match(/^\[\^.+\]:\s*/);
		}

		if (result === null) {
			// Ordered lists
			// 1. or 1)
			result = line.match(/^\s*\d+[.)]\s/);
		}
		if (result === null) {
			// Quotes
			// >
			result = line.match(/^\s*>\s*/);
		}
		if (result === null) {
			// Indents, Unordered lists, Task lists
			// -     or *     or +
			// - [ ] or * [ ] or + [ ]
			result = line.match(/^\s*([-+*]\s(\[.\]\s)?)?/);
		}

		if (result !== null && result[0].length < ch) {
			return result[0].length;
		} else {
			return 0;
		}
	}


	moveCursorEnd(editor: Editor) {
		const cursor = editor.getCursor();
		let position = cursor.ch;
		const line = editor.getLine(cursor.line);

		if (position === line.length) return;

		if (this.isLivePreviewMode() && this.isPositionInTable(editor)) {
			// LivePreviewMode & In the table
			({ pos: position } = this.getEndOfCellPosition(line, position));
		} else {
			// Out of table
			position = line.length;
		}
		editor.setCursor({ line: cursor.line, ch: position });
	}


	//              c     d  d              e       b  a
	//              V     V  V              V       V  V
	// line ... | cell text    |    cell text      |
	//                    C         D       E          A
	//
	getEndOfCellPosition(line: string, ch: number): { pos: number, isOnRightEdge: boolean } {
		const nextPipeIndex = line.indexOf('|', ch);

		// If no more pipes are found, move to the very end of the line.
		if (nextPipeIndex === -1) {
			const length = line.length;
			if (ch === length) {
				return { pos: line.length, isOnRightEdge: true};	// (a->A)
			} else {
				return { pos: line.length, isOnRightEdge: false};	// (b->A)
			}
		}

		// If the cursor is before the actual content ends, move to the end of the content (excluding trailing spaces).
		const cellContentBeforePipe = line.slice(0, nextPipeIndex);
		const contentEndOffset = cellContentBeforePipe.trimEnd().length;
		if (ch < contentEndOffset) {
			return { pos: contentEndOffset, isOnRightEdge: false};	// (c->C)
		}

		// If already at or past the content end, move to the start of the next cell's content.
		const nextPipeEndIndex = line.indexOf('|', nextPipeIndex + 1);

		if (nextPipeEndIndex !== -1) {
			const searchArea = line.slice(nextPipeIndex + 1, nextPipeEndIndex);
			const startOffset = searchArea.search(/\S|$/);
			return { pos: nextPipeIndex + 1 + startOffset, isOnRightEdge: true };	// (d->D)
		} else {
			return { pos: ch, isOnRightEdge: true };	// (e->E)
		}
	}


	moveCursorUp(editor: Editor) {
		const cursor = editor.getCursor();

		// Top of file
		if (cursor.line === 0) {
			// If it is the first line of the file, goUp is OK even if it is in a table.
			editor.exec('goUp');
			return;
		}

		if (this.isLivePreviewMode()) {
			if (this.isPositionInTable(editor)) {
				// LivePreviewMode & In the table
				const line = editor.getLine(cursor.line);
				const ch = cursor.ch;
				const lastPipeIndex = line.lastIndexOf('|', ch - 1);
				if (lastPipeIndex === -1) return;

				// Locate the first non-space character in the current cell
				const startOffset = line.slice(lastPipeIndex + 1).search(/\S|$/);
				const startOfCellContent = lastPipeIndex + 1 + startOffset;
				const cellIndex = this.getCellIndex(line, ch);

				// Enter the widget so that goUp/goDown navigate visual lines within it.
				// Without this, a cursor placed by cm.dispatch (e.g. from moveToBottomVisualLineOfCell)
				// is not registered inside the widget, causing goDown tests to misbehave.
				editor.exec('goRight');
				editor.exec('goLeft');

				editor.exec('goUp');

				// If goUp stayed on the same logical line, and the cursor was already
				// at cell start before goUp, proceed to the previous row.
				// (If cursor was on a lower visual line, goUp correctly moved to the
				// visual line above within the same cell — no further action needed.)
				const cursorAfter = editor.getCursor();
				if (cursorAfter.line === cursor.line) {
					if (cursor.ch <= startOfCellContent) {
						// Was at cell start -> go to previous row
						this.setCursorToPrevRow(editor, cellIndex);
						setTimeout(() => {
							this.moveToBottomVisualLineOfCell(editor);
						}, 0);
					} else if (cursorAfter.ch === startOfCellContent) {
						this.handleCellStartSnap(editor, cursor.line, cursor.ch, cellIndex);
					}
					// else: goUp moved within cell to visual line above - done
				} else {
					// goUp moved to a different logical line (previous table row or outside table)
					if (this.isPositionInTable(editor)) {
						// Re-place cursor at cell start so moveToBottomVisualLineOfCell can
						// navigate down properly (same pattern as setCursorToPrevRow + moveToBottom)
						const targetLine = cursorAfter.line;
						const targetCh = this.getChByCellIndex(editor, targetLine, cellIndex);
						if (targetCh !== -1) {
							this.setCursorViaCm(editor, targetLine, targetCh);
						}
					}
					setTimeout(() => {
						if (this.isPositionInTable(editor)) {
							this.moveToBottomVisualLineOfCell(editor);
						}
					}, 0);
				}
				return;
			} else {
				// Out of table

				if (this.isPositionInTable(editor, cursor.line - 1, 1)) {
					// Line directly below the table: enter the bottom-left cell and
					// land at the bottom visual line's left edge.
					const targetLine = cursor.line - 1;
					const targetCh = this.getChByCellIndex(editor, targetLine, 0);
					if (targetCh !== -1) {
						editor.setCursor({ line: targetLine, ch: targetCh });
					}
					setTimeout(() => {
						if (this.isPositionInTable(editor)) {
							this.moveToBottomVisualLineOfCell(editor);
						}
					}, 0);
					return;
				}
			}
		}

		editor.exec('goUp');
		return;
	}


	// Called when goUp snapped the cursor to startOfCellContent. Two cases:
	//   (a) Was on VL1 middle    -> goUp snapped to VL1 start -> go to previous row
	//   (b) Was on VL2+ left edge -> goUp moved to VL1 start  -> stay at VL1
	// A goDown probe from VL1 start distinguishes them: if it returns to originalCh
	// we were at VL2 (b); otherwise we were on VL1 (a).
	handleCellStartSnap(editor: Editor, originalLine: number, originalCh: number, cellIndex: number) {
		editor.exec('goDown');
		const backTest = editor.getCursor();
		if (backTest.line === originalLine && backTest.ch === originalCh) {
			// Case (b): was at VL2 left edge — goDown returned to originalCh.
			// Now back at original position; goUp to reach VL1 start.
			editor.exec('goUp');
		} else {
			// Case (a): was on VL1 middle — go to previous row.
			editor.exec('goUp'); // restore cursor to cell start first
			this.setCursorToPrevRow(editor, cellIndex);
			setTimeout(() => { this.moveToBottomVisualLineOfCell(editor); }, 0);
		}
	}


	// Move to the bottom visual line of the current table cell.
	//
	// Strategy:
	//   1. goRight: works around a Live Preview issue where goDown from the leftmost
	//      cell position (placed by cm.dispatch) exits the table immediately.
	//   2. goDown loop: navigates visual lines until no further movement or line change.
	//      lastPos ends up at the bottom visual line or at cell end (non-wrapped).
	//   3. Determine landing position:
	//      - lastPos within cell content: on bottom visual line -> stay at lastPos.
	//      - lastPos at/past cell content end: non-wrapped cell -> restore to cell start.
	moveToBottomVisualLineOfCell(editor: Editor) {
		const startLine = editor.getCursor().line;
		const originalPos = editor.getCursor();
		const line = editor.getLine(startLine);

		// Determine cell content end: trailing-space visual lines in CM6 are unstable
		// cursor positions that get normalized away. Use endOfCellContent to stop the
		// loop before entering the trailing-space area.
		const closingPipeRegex = /(?<!\\)\|/g;
		closingPipeRegex.lastIndex = originalPos.ch;
		const pipeMatch = closingPipeRegex.exec(line);
		const closingPipeIndex = pipeMatch ? pipeMatch.index : -1;
		const cellEnd = closingPipeIndex !== -1 ? closingPipeIndex : line.length;
		const endOfCellContent = line.slice(0, cellEnd).trimEnd().length;

		// goDown from the leftmost cell position exits Live Preview tables immediately.
		// Move one character right to enter the cell widget properly, then return to
		// visual column 0 via goLeft so the goDown loop starts at the left edge.
		editor.exec('goRight');
		if (editor.getCursor().line !== startLine) {
			editor.setCursor(originalPos);
			return;
		}
		editor.exec('goLeft'); // return to visual column 0

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
				// Entering trailing-space area — lastPos is already the bottom content VL.
				// Do NOT update lastPos here; break and dispatch lastPos after normalization.
				breakReason = 'endOfCell';
				break;
			}

			lastPos = { line: newPos.line, ch: newPos.ch };
		}

		// endOfCell: lastPos holds the target — the true bottom content VL for wrapped
		// cells, or originalPos for non-wrapped cells (lastPos is initialised to
		// originalPos and only advances when goDown finds a new content VL).
		// Dispatch after the current tick so CM6 can normalise the trailing-space
		// position before we place the final cursor.
		if (breakReason === 'endOfCell') {
			setTimeout(() => { this.setCursorViaCm(editor, lastPos.line, lastPos.ch); }, 0);
			return;
		}

		if (breakReason === 'exitedLine') {
			// Cursor exited the cell row — go back up to land at the bottom VL.
			editor.exec('goUp');
		}
		// noMove: cursor is already at lastPos (a valid content position)

	}


	getCellIndex(line: string, ch: number): number {
		const textBeforeCursor = line.substring(0, ch);
		const matches = textBeforeCursor.match(CELL_SEPARATOR_REGEX);

		if (!matches) return 0;

		return matches.length - 1;
	}


	// Moves the cursor to the beginning of the specified column number in the row above the current row.
	// It has been confirmed that it is inTable and cursor.line>0.
	//
	// (*1)			    <-- BlankLine
	// | header | (*2)header |  <-- HeaderRow
	// | ------ | ---------- |  <-- DelimiterLine
	// | text   | (*3)text   |  <-- FirstDataRow
	// | text   | (*4)text   |
	// | text   | (*5)text   |
	//
	// (*2)->(*1) if (cursor.line+1) is DelimiterLine, go out of the table.
	// (*3)->(*2) if (cursor.line-1) is DelimiterLine, go to same column at (cursor.line-2).
	// (*4)->(*3),(*5)->(*4) simply go to (cursor.line-1).
	//
	setCursorToPrevRow(editor: Editor, cellIndex: number) {
		const cursor = editor.getCursor();
		let targetLine = cursor.line;
		let targetCh = 0;

		if (!this.isPositionInTable(editor, cursor.line - 1, 1)) {
			// Above row is out-of-table, i.e., Header row. (*2)
			targetLine --;		// (*2)->(*1)
			targetCh = 0;		// left edge of line
		} else {
			// Above row is in-table, i.e., Data row: (*3)(*4)(*5)
			const oneLineUp = editor.getLine(cursor.line - 1);
			const isDelimiterLineAbove = /^\s*\|?[:\s-]+\|[:\s- |]*$/.test(oneLineUp);

			if (isDelimiterLineAbove) {
				targetLine -= 2;	// (*3)->(*2)
			} else {
				targetLine --;		// (*4)->(*3),(*5)->(*4)
			}
			targetCh = this.getChByCellIndex(editor, targetLine, cellIndex);
		}
		if (targetCh !== -1) {
			this.setCursorViaCm(editor, targetLine, targetCh);
		}
	}


	getChByCellIndex(editor: Editor, line: number, cellIndex: number): number {
		const lineText = editor.getLine(line);
		const matches = [...lineText.matchAll(CELL_SEPARATOR_REGEX)];

		if (cellIndex >= 0 && cellIndex < matches.length) {
			const pipeIndex = matches[cellIndex].index!;
			// Limit search to within this cell (up to the next pipe), so that empty cells
			// don't land on the closing | and then jump into the next cell.
			const closingPipeMatch = matches[cellIndex + 1];
			const searchEnd = closingPipeMatch ? closingPipeMatch.index! : lineText.length;
			const cellContent = lineText.substring(pipeIndex + 1, searchEnd);
			const firstNonSpaceMatch = cellContent.search(/\S/);

			if (firstNonSpaceMatch !== -1) {
				return pipeIndex + 1 + firstNonSpaceMatch;
			} else {
				// Empty or whitespace-only cell: place cursor right after opening pipe
				return pipeIndex + 1;
			}
		}

		return -1;
	}


	moveCursorDown(editor: Editor) {
		const cursor = editor.getCursor();

		// Bottom of file
		if (cursor.line === editor.lineCount() - 1) {
			editor.exec('goDown');
			return;
		}

		if (this.isLivePreviewMode()) {
			if (this.isPositionInTable(editor)) {
				// LivePreviewMode & In the table
				const line = editor.getLine(cursor.line);
				const ch = cursor.ch;
				const cellIndex = this.getCellIndex(line, ch);

				editor.exec('goDown');

				// If goDown stayed on the same logical line and reached cell end,
				// proceed to the next row (handles single-line cells and last visual line of wrapped cells)
				const cursorAfter = editor.getCursor();
				if (cursorAfter.line === cursor.line) {
					const nextPipeIndex = line.indexOf('|', cursorAfter.ch);
					const endOfCellContent = nextPipeIndex !== -1
						? line.slice(0, nextPipeIndex).trimEnd().length
						: line.trimEnd().length;

					if (cursorAfter.ch >= endOfCellContent) {
						this.setCursorToNextRow(editor, cellIndex);
					}
				}
				return;
			} else {
				// Out of table

				if (this.isPositionInTable(editor, cursor.line + 1, 1)) {
					// Line directly above the table, move the cursor to +1 row instead of goDown.
					const targetCh = this.getChByCellIndex(editor, cursor.line + 1, 0);
					editor.setCursor({ line: cursor.line + 1, ch: targetCh });
					return;
				}
			}
		}

		editor.exec('goDown');
		return;
	}


	// Moves the cursor to the beginning of the specified column number in the row below the current row.
	//
	// | header | (*1)header(*1b)text |  <-- HeaderRow
	// | ------ | ------------------- |  <-- DelimiterLine
	// | text   | (*2)text(*2b)text   |
	// | text   | (*3)text(*3b)text   |
	// (*4)
	//
	// (*1)->(*2),(*1b)->(*2) if (cursor.line+1) is DelimiterLine, go to same column at (cursor.line+2).
	// (*2)->(*3),(*2b)->(*3) go to same column at (cursor.line+1).
	// (*3)->(*4),(*3b)->(*4) go out of the table.
	setCursorToNextRow(editor: Editor, cellIndex: number) {
		const cursor = editor.getCursor();
		let targetLine = cursor.line;
		let targetCh = 0;

		if (!this.isPositionInTable(editor, cursor.line + 1, 1)) {
			// The next line is outside the table. (*3)
			targetLine ++;		// (*3)->(*4)
			targetCh = 0;		// left edge of line
		} else {
			const oneLineDown = editor.getLine(cursor.line + 1);
			const isDelimiterLineBelow = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/.test(oneLineDown);

			if (isDelimiterLineBelow) {
				targetLine += 2;	// (*1)->(*2)
			} else {
				targetLine ++;		// (*2)->(*3)
			}
			targetCh = this.getChByCellIndex(editor, targetLine, cellIndex);
		}
		if (targetCh !== -1) {
			this.setCursorViaCm(editor, targetLine, targetCh);
		}
	}


	moveCursorLeft(editor: Editor) {
		const cursor = editor.getCursor();

		if (this.isLivePreviewMode() && this.isPositionInTable(editor)) {
			// LivePreviewMode & In the table

			// Check whether right edge of cell text
			const { pos: startOfCellContent, isOnLeftEdge } = this.getBeginningOfCellPosition(editor.getLine(cursor.line), cursor.ch);

			if (isOnLeftEdge) {
				// Move to the right cell
				editor.setCursor({ line: cursor.line, ch: startOfCellContent });
			} else {
				editor.exec('goLeft');
			}
		} else {
			// Out of table

			editor.exec('goLeft');
		}
	}


	moveCursorRight(editor: Editor) {
		const cursor = editor.getCursor();

		if (this.isLivePreviewMode() && this.isPositionInTable(editor)) {
			// LivePreviewMode & In the table

			// Check whether right edge of cell text
			const { pos: endOfCellContent, isOnRightEdge } = this.getEndOfCellPosition(editor.getLine(cursor.line), cursor.ch);

			if (isOnRightEdge) {
				// Move to the right cell
				editor.setCursor({ line: cursor.line, ch: endOfCellContent });
			} else {
				editor.exec('goRight');
			}

		} else {
			// Out of table

			editor.exec('goRight');
		}
	}
}
