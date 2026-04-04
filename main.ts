import { Editor, Plugin, MarkdownView } from 'obsidian';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from "@codemirror/view";
import { EditorSelection } from '@codemirror/state';

// Extend the Obsidian Editor interface to include the internal CodeMirror 6 instance (EditorView)
declare module "obsidian" {
	interface Editor {
		cm: EditorView;
	}
}


const CELL_SEPARATOR_REGEX = /(?<!\\)\|/g;

interface InCellLineInfo {
	lineType: 'single' | 'first' | 'middle' | 'last';
	startOfInCellLine: number;   // left edge (ch position)
	endOfInCellLine: number;     // right edge (ch position)
	isEmpty: boolean;            // startOfInCellLine === endOfInCellLine
}


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


	//===========================================================================
	// Entry points: Ctrl-A / Ctrl-E / Ctrl-B / Ctrl-F
	//===========================================================================

	moveCursorHome(editor: Editor) {
		const cursor = editor.getCursor();
		const ch = cursor.ch;
		if (ch === 0) return;

		const line = editor.getLine(cursor.line);

		// In-cell Home : every in-cell line, no 2-step Home.
		if (this.isLivePreviewMode() && this.isPositionInTable(editor)) {
			const info = this.getInCellLineInfo(line, ch);
			if (!info) return;

			if (info.isEmpty || ch <= info.startOfInCellLine) {
				if (info.lineType === 'single' || info.lineType === 'first') {
					this.moveToLeftCellEnd(editor);
				}
				return;
			}
			// Middle or right position -> move to left edge of current in-cell line
			this.setCursorViaCm(editor, cursor.line, info.startOfInCellLine);
			return;
		}

		// Non-table : visual-line-aware 2-step home, markdown-aware smart home.
		const cm = editor.cm;
		if (cm) {
			const lineFrom = editor.posToOffset({ line: cursor.line, ch: 0 });
			const currentHead = cm.state.selection.main.head;
			const vlStart = cm.moveToLineBoundary(cm.state.selection.main, false, true);
			const vlCh = vlStart.head - lineFrom;

			if (vlStart.head !== currentHead && vlCh > 0) {
				// Case (1a): VL2+, not at VL left edge -> move to VL left edge
				cm.dispatch({
					selection: EditorSelection.cursor(vlStart.head, vlStart.assoc),
					scrollIntoView: true,
					userEvent: 'move',
				});
				return;
			}
			// Case (1b): VL2+ at left edge, or Case (2): VL1 -> fall through to smart home
		}

		// Smart home: content start -> ch=0
		const position = this.getBeginningOfLinePosition(line, ch);
		editor.setCursor({ line: cursor.line, ch: position });
	}


	moveCursorEnd(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		// In-cell End : every in-cell line, no 2-step End.
		if (this.isLivePreviewMode() && this.isPositionInTable(editor)) {
			const info = this.getInCellLineInfo(line, cursor.ch);
			if (!info) return;

			if (info.isEmpty || cursor.ch >= info.endOfInCellLine) {
				if (info.lineType === 'single' || info.lineType === 'last') {
					this.moveToRightCellStart(editor);
				}
				return;
			}
			// Middle or left position -> move to right edge of current in-cell line
			this.setCursorViaCm(editor, cursor.line, info.endOfInCellLine);
			return;
		}

		// Non-table: visual-line-aware end
		const cm = editor.cm;
		if (cm) {
			const lineFrom = editor.posToOffset({ line: cursor.line, ch: 0 });
			const currentHead = cm.state.selection.main.head;
			const vlEnd = cm.moveToLineBoundary(cm.state.selection.main, true, true);
			const vlEndCh = vlEnd.head - lineFrom;

			if (vlEnd.head !== currentHead) {
				if (vlEndCh > 0 && vlEndCh < line.length) {
					// Soft-wrap boundary: place at last char of VL1, then goRight
					editor.setCursor({ line: cursor.line, ch: vlEndCh - 1 });
					editor.exec('goRight');
				} else {
					// Last VL in line: go directly to logical line end
					editor.setCursor({ line: cursor.line, ch: line.length });
				}
				return;
			}
		}

		// Already at VL end -> move to logical line end
		if (cursor.ch === line.length) return;
		editor.setCursor({ line: cursor.line, ch: line.length });
	}


	moveCursorLeft(editor: Editor) {
		const cursor = editor.getCursor();

		if (this.isLivePreviewMode() && this.isPositionInTable(editor)) {
			const line = editor.getLine(cursor.line);
			const startOfCell = this.getStartOfCellContent(line, cursor.ch);
			if (cursor.ch <= startOfCell) {
				this.moveToLeftCellEnd(editor);
			} else {
				editor.exec('goLeft');
			}
			return;
		}

		editor.exec('goLeft');
	}


	moveCursorRight(editor: Editor) {
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
	// Entry points: Ctrl-P / Ctrl-N
	//===========================================================================

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
							if (this.isPositionInTable(editor)) {
								this.moveToBottomVisualLineOfCell(editor);
							}
						}, 0);
					} else if (cursorAfter.ch === startOfCellContent) {
						// goDown from VL1 start in a non-wrapped cell lands at VL1 end (= originalCh),
						// which causes the goDown probe in handleCellStartSnap to give a false case-b.
						// Detect this directly: if cursor was at end of cell content, it's VL1 end
						// of a non-wrapped cell -> go to previous row without probing.

						const closingPipeRegex = /(?<!\\)\|/g;
						closingPipeRegex.lastIndex = cursor.ch;
						const pipeMatch = closingPipeRegex.exec(line);
						const endOfCellContent = pipeMatch
							? line.slice(0, pipeMatch.index).trimEnd().length
							: line.trimEnd().length;
						if (cursor.ch >= endOfCellContent) {
							// VL1 end of non-wrapped cell -> go to previous row
							this.setCursorToPrevRow(editor, cellIndex);
							setTimeout(() => {
								if (this.isPositionInTable(editor)) {
									this.moveToBottomVisualLineOfCell(editor);
								}
							}, 0);
						} else {
							this.handleCellStartSnap(editor, cursor.line, cursor.ch, cellIndex);
						}
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
					// Line directly below the table.
					// Only enter the table if on VL1; if on VL2+, a regular goUp suffices.
					editor.exec('goUp');
					const afterUp = editor.getCursor();
					if (afterUp.line === cursor.line) {
						// VL2+: goUp moved within visual lines, result already applied.
						return;
					}
					// VL1: goUp moved to the table's last row; reposition to bottom-left cell.

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
					const targetCh = this.getChByCellIndex(editor, cursor.line + 1, 0);
					editor.setCursor({ line: cursor.line + 1, ch: targetCh });
					return;
				}
			}
		}

		editor.exec('goDown');
		return;
	}


	//===========================================================================
	// Shared table actions
	//===========================================================================

	// move to Left cell / Right edge
	//	(a)->(A) : same row
	//	(b)->(B) : if leftmost cell, move to upper row & rightmost cell
	// shared by moveCursorHome (Ctrl-A) and moveCursorLeft (Ctrl-B)
	//
	//  cellIndex=0          1           lastCellIndex
	// +--------------+-------------+---+--------------+
	// | some text in |(a)some text |...| some text in |
	// | the cell(A)  | in the cell |   | the cell(B)  |
	// +--------------+-------------+---+--------------+
	// |(b)some text  |             |...|              |
	// | in the cell  |             |   |              |
	// +--------------+-------------+---+--------------+
	moveToLeftCellEnd(editor: Editor) {
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

		// Leftmost cell: go to previous row
		const targetLine = this.getPrevRowLine(editor);
		if (targetLine === -1) {
			// Header row: go outside table
			if (cursor.line > 0) {
				editor.setCursor({ line: cursor.line - 1, ch: 0 });
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
	// shared by moveCursorEnd (Ctrl-E) and moveCursorRight (Ctrl-F)
	//
	//  cellIndex=0      lastCellIndex-1  lastCellIndex
	// +-------------+---+---------------+---------------+
	// |             |...| some text in |(A)some text in |
	// |             |   | the cell(a)  | the cell(b)    |
	// +-------------+---+--------------+----------------+
	// |(B)some text |...|              |                |
	// | in the cell |   |              |                |
	// +-------------+----+-------------+----------------+
	moveToRightCellStart(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = this.getCellIndex(line, cursor.ch);
		const lastCellIndex = this.getRightmostCellIndex(line);

		if (cellIndex < lastCellIndex) {
			// Same row: move to right cell's start
			const targetCh = this.getChByCellIndex(editor, cursor.line, cellIndex + 1);
			if (targetCh !== -1) {
				this.setCursorViaCm(editor, cursor.line, targetCh);
			}
			return;
		}

		// Rightmost cell: go to next row
		const targetLine = this.getNextRowLine(editor);
		if (targetLine === -1) {
			// Last row: go outside table
			if (cursor.line < editor.lineCount() - 1) {
				editor.setCursor({ line: cursor.line + 1, ch: 0 });
			}
			return;
		}
		// Next row: leftmost cell start
		const targetCh = this.getChByCellIndex(editor, targetLine, 0);
		if (targetCh !== -1) {
			this.setCursorViaCm(editor, targetLine, targetCh);
		}
	}


	//===========================================================================
	// Table row navigation
	//===========================================================================

	// Returns the line number of the previous table data row.
	// Returns -1 when the current row is the header row (caller should go outside the table).
	getPrevRowLine(editor: Editor): number {
		const cursor = editor.getCursor();
		if (!this.isPositionInTable(editor, cursor.line - 1, 1)) return -1;
		const isDelimiter = /^\s*\|?[:\s-]+\|[:\s- |]*$/.test(editor.getLine(cursor.line - 1));
		return isDelimiter ? cursor.line - 2 : cursor.line - 1;
	}


	// Returns the line number of the next table data row.
	// Returns -1 when the current row is the last row (caller should go outside the table).
	getNextRowLine(editor: Editor): number {
		const cursor = editor.getCursor();
		if (!this.isPositionInTable(editor, cursor.line + 1, 1)) return -1;
		const isDelimiter = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/.test(editor.getLine(cursor.line + 1));
		return isDelimiter ? cursor.line + 2 : cursor.line + 1;
	}


	// Moves the cursor to the beginning of the specified column in the previous row.
	//
	// (*1)            <-- BlankLine
	// | header | (*2)header |  <-- HeaderRow
	// | ------ | ---------- |  <-- DelimiterLine
	// | text   | (*3)text   |  <-- FirstDataRow
	// | text   | (*4)text   |
	//
	// (*2)->(*1) if above is outside table (header row), go out.
	// (*3)->(*2) if above is delimiter line, go to cursor.line-2.
	// (*4)->(*3) go to cursor.line-1.
	setCursorToPrevRow(editor: Editor, cellIndex: number) {
		const cursor = editor.getCursor();
		const targetLine = this.getPrevRowLine(editor);

		if (targetLine === -1) {
			// Header row: go outside table
			this.setCursorViaCm(editor, cursor.line - 1, 0);
			return;
		}
		const targetCh = this.getChByCellIndex(editor, targetLine, cellIndex);
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
	setCursorToNextRow(editor: Editor, cellIndex: number) {
		const cursor = editor.getCursor();
		const targetLine = this.getNextRowLine(editor);

		if (targetLine === -1) {
			// Last row: go outside table
			this.setCursorViaCm(editor, cursor.line + 1, 0);
			return;
		}
		const targetCh = this.getChByCellIndex(editor, targetLine, cellIndex);
		if (targetCh !== -1) {
			this.setCursorViaCm(editor, targetLine, targetCh);
		}
	}


	//===========================================================================
	// In-cell line analysis
	//===========================================================================

	// Parses the cell at position ch and returns info about the in-cell line
	// (the <br>-delimited sub-line) that the cursor is currently on.
	getInCellLineInfo(line: string, ch: number): InCellLineInfo | null {
		// 1. Find bounding pipes for the cell containing ch
		const pipes = [...line.matchAll(CELL_SEPARATOR_REGEX)].map(m => m.index!);
		let openPipeIdx = -1;
		let closePipeIdx = -1;
		for (const p of pipes) {
			if (p < ch) openPipeIdx = p;
			else if (closePipeIdx === -1) { closePipeIdx = p; break; }
		}
		if (openPipeIdx === -1 || closePipeIdx === -1) return null;

		const cellStart = openPipeIdx + 1;
		const cellEnd   = closePipeIdx;

		// 2. Find <br> tags within the cell (case-insensitive, no spaces or slash inside)
		const cellContent = line.slice(cellStart, cellEnd);
		const brMatches   = [...cellContent.matchAll(/<[bB][rR]>/g)];
		const brPositions = brMatches.map(m => ({
			start: cellStart + m.index!,
			end:   cellStart + m.index! + m[0].length,
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
		//    single → seg.start  (endOfInCellLine = seg.start + 0 = seg.start → isEmpty)
		//    first  → seg.end    (= br.start → startOfInCellLine = endOfInCellLine → isEmpty)
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

	// +----------------------+
	// |(a)some text in the   |	(a) startOfCellContent
	// | cell.<br>            |
	// | 2nd in-cell line<br> |	(*) cursor potition
	// | cursor is(*)here<br> |
	// | last in-cell line(b) |	(b) endOfCellContent
	// +----------------------+
	// Indicates cell start/end, regardless of line wrapping or in-cell lines.

	// Returns target cursor position when moving to the left cell with Ctrl-E or Ctrl-F.
	getStartOfCellContent(line: string, ch: number): number {
		const pipes = [...line.matchAll(CELL_SEPARATOR_REGEX)].map(m => m.index!);
		let openPipeIdx = -1;
		for (const p of pipes) {
			if (p < ch) openPipeIdx = p;
			else break;
		}
		if (openPipeIdx === -1) return 0;
		const closePipeIdx = pipes.find(p => p > ch) ?? line.length;
		const firstNonSpace = line.slice(openPipeIdx + 1, closePipeIdx).search(/\S/);
		return firstNonSpace === -1
			? openPipeIdx + 1
			: openPipeIdx + 1 + firstNonSpace;
	}


	// Returns target cursor position when moving to the right cell with Ctrl-A or Ctrl-B.
	getEndOfCellContent(line: string, ch: number): number {
		const pipes = [...line.matchAll(CELL_SEPARATOR_REGEX)].map(m => m.index!);
		let openPipeIdx = -1;
		for (const p of pipes) {
			if (p < ch) openPipeIdx = p;
			else break;
		}
		if (openPipeIdx === -1) return 0;
		const closePipeIdx = pipes.find(p => p > ch) ?? line.length;
		return openPipeIdx + 1 + line.slice(openPipeIdx + 1, closePipeIdx).trimEnd().length;
	}


	// Returns endOfCellContent for the cell at the given 0-based cellIndex.
	// Returns -1 if cellIndex is out of range.
	getEndOfCellContentByCellIndex(line: string, cellIndex: number): number {
		const pipes = [...line.matchAll(CELL_SEPARATOR_REGEX)].map(m => m.index!);
		if (cellIndex < 0 || cellIndex + 1 >= pipes.length) return -1;
		const openPipe  = pipes[cellIndex];
		const closePipe = pipes[cellIndex + 1];
		return openPipe + 1 + line.slice(openPipe + 1, closePipe).trimEnd().length;
	}


	// Returns the 0-based index of the rightmost cell in a table row.
	getRightmostCellIndex(line: string): number {
		const pipes = [...line.matchAll(CELL_SEPARATOR_REGEX)];
		return Math.max(0, pipes.length - 2);
	}


	//===========================================================================
	// Cell index / position helpers
	//===========================================================================

	getCellIndex(line: string, ch: number): number {
		const textBeforeCursor = line.substring(0, ch);
		const matches = textBeforeCursor.match(CELL_SEPARATOR_REGEX);
		if (!matches) return 0;
		return matches.length - 1;
	}


	getChByCellIndex(editor: Editor, line: number, cellIndex: number): number {
		const lineText = editor.getLine(line);
		const matches  = [...lineText.matchAll(CELL_SEPARATOR_REGEX)];

		if (cellIndex >= 0 && cellIndex < matches.length) {
			const pipeIndex = matches[cellIndex].index!;
			const closingPipeMatch = matches[cellIndex + 1];
			const searchEnd = closingPipeMatch ? closingPipeMatch.index! : lineText.length;
			const cellContent = lineText.substring(pipeIndex + 1, searchEnd);
			const firstNonSpaceMatch = cellContent.search(/\S/);

			if (firstNonSpaceMatch !== -1) {
				return pipeIndex + 1 + firstNonSpaceMatch;
			} else {
				return pipeIndex + 1;
			}
		}

		return -1;
	}


	getBeginningOfLinePosition(line: string, ch: number): number {

		// Headings in an unordered list
		let result = line.match(/^(\s*[-+*]\s)?#+\s/);
		if (result !== null && result[0].length < ch) {
			return result[0].length;
		}

		result = line.match(/^#{1,6}\s/); // Headings

		if (result === null) {
			result = line.match(/^\[\^.+\]:\s*/); // Footnotes
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


	//===========================================================================
	// Ctrl-P/N helpers
	//===========================================================================

	// Called when goUp snapped the cursor to startOfCellContent.
	// Probes with goDown to distinguish VL1-middle from VL2+ left edge.
	handleCellStartSnap(editor: Editor, originalLine: number, originalCh: number, cellIndex: number) {
		editor.exec('goDown');
		const backTest = editor.getCursor();
		if (backTest.line === originalLine && backTest.ch === originalCh) {
			// VL2+ left edge: stay at VL1 start
			editor.exec('goUp');
		} else {
			// VL1 middle: go to previous row
			editor.exec('goUp');
			this.setCursorToPrevRow(editor, cellIndex);
			setTimeout(() => {
				if (this.isPositionInTable(editor)) {
					this.moveToBottomVisualLineOfCell(editor);
				}
			}, 0);
		}
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
	moveToBottomVisualLineOfCell(editor: Editor) {
		const startLine  = editor.getCursor().line;
		const originalPos = editor.getCursor();
		const line = editor.getLine(startLine);

		const closingPipeRegex = /(?<!\\)\|/g;
		closingPipeRegex.lastIndex = originalPos.ch;
		const pipeMatch = closingPipeRegex.exec(line);
		const closingPipeIndex = pipeMatch ? pipeMatch.index : -1;
		const cellEnd = closingPipeIndex !== -1 ? closingPipeIndex : line.length;
		const endOfCellContent = line.slice(0, cellEnd).trimEnd().length;

		editor.exec('goRight');
		if (editor.getCursor().line !== startLine) {
			editor.setCursor(originalPos);
			return;
		}
		editor.exec('goLeft');

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
		const cm  = editor.cm;
		const pos = editor.posToOffset({ line, ch });
		cm.dispatch({ selection: { anchor: pos, head: pos } });
		cm.focus();
	}


	isLivePreviewMode(): boolean {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return false;

		const mode = view.getMode();
		if (mode !== "source") return false;

		return !view.getState().source;
	}

}
