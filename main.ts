import { Editor, Plugin, MarkdownView } from 'obsidian';
import { syntaxTree } from '@codemirror/language';

export default class universalCursorHotkeysPlugin extends Plugin {

	CELL_SEPARATOR_REGEX = /(?<!\\)\|/g;

	onload() {

		this.addCommand({
			id: 'cursor-home',
			name: 'HOME',
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveCursorHome(editor)
			}
		});

		this.addCommand({
			id: 'cursor-end',
			name: 'END',
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveCursorEnd(editor)
			}
		});

		this.addCommand({
			id: 'cursor-up',
			name: 'UP',
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveCursorUp(editor)
			}
		});

		this.addCommand({
			id: 'cursor-down',
			name: 'DOWN',
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveCursorDown(editor)
			}
		});

		this.addCommand({
			id: 'cursor-left',
			name: 'LEFT',
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveCursorLeft(editor)
			}
		});

		this.addCommand({
			id: 'cursor-right',
			name: 'RIGHT',
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
		if (position == 0) return;

		const line = editor.getLine(cursor.line);
		if (this.isLivePreviewMode(MarkdownView) && this.isPositionInTable(editor)) {
			// LivePreviewMode & In the table
			({ pos: position } = this.getBeginningOfCellPosition(line, position));
		} else {
			// Out of table
			position = this.getBeginningOfLinePosition(line, position);
		}
		editor.setCursor({ line: cursor.line, ch: position });
	}


	isPositionInTable(editor: Editor, line?: number, ch?: number): boolean {
		const cm = (editor as any).cm;
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
			node = node.parent;
		}

		return false;
	}


	isLivePreviewMode() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (view) {
			const mode = view.getMode(); // "preview" または "source"

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
		if (lastPipeIndex === -1) return 0;

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
		// Headings
		// # or ## or... ###### (heading 1 to 6)
		let result = line.match(/^#{1,6}\s/);

		if (result === null) {
			// Footnotes
			// [^1]: (not only number)
			result = line.match(/^\[\^.+\]:\s*/);
		}

		if (result === null) {
			// Ordered lists
			// 1. or 1)
			result = line.match(/^\s*\d+[\.\)]\s/);
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

		if (this.isLivePreviewMode(MarkdownView) && this.isPositionInTable(editor)) {
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
			if (ch == length) {
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
		if (cursor.line == 0) {
			// If it is the first line of the file, goUP is OK even if it is in a table.
			editor.exec('goUp');
			return;
		}

		if (this.isLivePreviewMode(MarkdownView)) {
			if (this.isPositionInTable(editor)) {
				// LivePreviewMode & In the table
				const line = editor.getLine(cursor.line);
				const ch = cursor.ch;
				const lastPipeIndex = line.lastIndexOf('|', ch - 1);
				if (lastPipeIndex === -1) return;

				// Locate the first non-space character in the current cell
				const startOffset = line.slice(lastPipeIndex + 1).search(/\S|$/);
				const startOfCellContent = lastPipeIndex + 1 + startOffset;

				if (ch !== startOfCellContent) {
					// In cell goUP
					editor.exec('goUp');
					return;
				} else {
					// At the beginning of the text in a cell, move to the beginning of the same cell one row above
					const cellIndex = this.getCellIndex(line, ch);
					this.setCursorToPrevRow(editor, cellIndex);
					return;
				}
			} else {
				// Out of table

				if (this.isPositionInTable(editor, cursor.line - 1, 1)) {
					// Line directly below the table, move the cursor to -1 row instead of goUP.
					const targetCh = this.getChByCellIndex(editor, cursor.line - 1, 0);
					editor.setCursor({ line: cursor.line - 1, ch: targetCh });
					return;
				}
			}
		}

		editor.exec('goUp');
		return;
	}


	getCellIndex(line: string, ch: number): number {
		const textBeforeCursor = line.substring(0, ch);
		const matches = textBeforeCursor.match(this.CELL_SEPARATOR_REGEX);

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
		if (targetCh != -1) {
			// Use cm directly to avoid interference with the table editor
			const cm = (editor as any).cm;
			const pos = editor.posToOffset({ line: targetLine, ch: targetCh });
			cm.dispatch({
			        selection: { anchor: pos, head: pos }
			});
			cm.focus();
		}
	}


	getChByCellIndex(editor: Editor, line: number, cellIndex: number): number {
		const lineText = editor.getLine(line);
		const matches = [...lineText.matchAll(this.CELL_SEPARATOR_REGEX)];

		if (cellIndex >= 0 && cellIndex < matches.length) {
			const pipeIndex = matches[cellIndex].index!;
			const afterPipe = lineText.substring(pipeIndex + 1);
			const firstNonSpaceMatch = afterPipe.search(/\S/);

			return pipeIndex + 1 + (firstNonSpaceMatch !== -1 ? firstNonSpaceMatch : 0);
		}

		return -1;
	}


	moveCursorDown(editor: Editor) {
		const cursor = editor.getCursor();

		// Bottom of file
		if (cursor.line == editor.lineCount() - 1) {
			editor.exec('goDown');
			return;
		}

		if (this.isLivePreviewMode(MarkdownView)) {
			if (this.isPositionInTable(editor)) {
				// LivePreviewMode & In the table

				// Move to the BEGINNING of the same cell one row blow
				const line = editor.getLine(cursor.line);
				const ch = cursor.ch;
				const cellIndex = this.getCellIndex(line, ch);
				this.setCursorToNextRow(editor, cellIndex);
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
		if (targetCh != -1) {
			// Use cm directly to avoid interference with the table editor
			const cm = (editor as any).cm;
			const pos = editor.posToOffset({ line: targetLine, ch: targetCh });
			cm.dispatch({
			        selection: { anchor: pos, head: pos }
			});
			cm.focus();
		}
	}


	moveCursorLeft(editor: Editor) {
		const cursor = editor.getCursor();

		if (this.isLivePreviewMode(MarkdownView) && this.isPositionInTable(editor)) {
			// LivePreviewMode & In the table

			// Check whether left edge of cell text
			const { pos: startOfCellContent, isOnLeftEdge } = this.getBeginningOfCellPosition(editor.getLine(cursor.line), cursor.ch);

			if (isOnLeftEdge) {
				// Move to the left cell
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

		if (this.isLivePreviewMode(MarkdownView) && this.isPositionInTable(editor)) {
			// LivePreviewMode & In the table

			// Check whether left edge of cell text
			const { pos: endOfCellContent, isOnRightEdge } = this.getEndOfCellPosition(editor.getLine(cursor.line), cursor.ch);

			if (isOnRightEdge) {
				// Move to the left cell
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
