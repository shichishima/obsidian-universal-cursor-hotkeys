import { App, Editor, Plugin, PluginSettingTab, Setting, MarkdownView, ToggleComponent, sanitizeHTMLToDom } from 'obsidian';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from "@codemirror/view";
import { EditorSelection, Transaction } from '@codemirror/state';
import { deleteCharForward } from '@codemirror/commands';

// Extend the Obsidian Editor interface to include the internal CodeMirror 6 instance (EditorView)
declare module "obsidian" {
	interface Editor {
		cm: EditorView;
		// Inner CM view active when cursor is in a Live Preview table cell.
		// Points to editor.cm when no table cell is focused.
		activeCM: EditorView;
		inTableCell: boolean;
	}
}


interface UniversalCursorHotkeysSettings {
	smartHomeStandard: boolean;
	smartHomeAdvanced: boolean;
	smartJoin: boolean;
	visualLineMovement: boolean;
	crossRowNavigation: boolean;
}

const DEFAULT_SETTINGS: UniversalCursorHotkeysSettings = {
	smartHomeStandard: true,
	smartHomeAdvanced: true,
	smartJoin: false,
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
	// Lines of overlap between successive page-down/up screens (Emacs next-screen-context-lines).
	private readonly NEXT_SCREEN_CONTEXT_LINES = 0;
	// Lines of margin above/below cursor for recenter-top-bottom top/bottom positions.
	private readonly RECENTER_TOP_BOTTOM_MARGIN_LINES = 2;

	private isKillChaining: boolean = false;
	private isDispatchingKill: boolean = false;
	private killCache: string = '';
	private _recenterStep = 0; // 0=center, 1=top, 2=bottom

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
				this.selectAll(editor);
			},
		});

		this.addCommand({
			id: 'delete-char',
			name: 'Delete char',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				this.deleteChar(editor);
			}
		});

		this.addCommand({
			id: 'kill-region',
			name: 'Kill region',
			editorCallback: (editor: Editor) => {
				this.killRegion(editor);
			}
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
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				void this.yank(editor);
			}
		});

		this.addCommand({
			id: 'page-down',
			name: 'Page down',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				this.pageDown(editor);
			}
		});

		this.addCommand({
			id: 'page-up',
			name: 'Page up',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				this.pageUp(editor);
			}
		});

		this.addCommand({
			id: 'recenter',
			name: 'Recenter',
			editorCallback: (editor: Editor) => {
				this.recenter(editor);
			}
		});

		this.addCommand({
			id: 'recenter-top-bottom',
			name: 'Recenter top-bottom',
			editorCallback: (editor: Editor) => {
				this.recenterTopBottom(editor);
			}
		});

		this.registerEditorExtension(
			EditorView.updateListener.of((update) => {
				if (!this.isKillChaining && this._recenterStep === 0) return;
				if (update.docChanged || update.selectionSet) {
					// Only reset on genuine user actions (keystrokes, arrow keys, etc.).
					// Programmatic dispatches (our own, Obsidian's table editor re-dispatches)
					// carry no Transaction.userEvent annotation and are ignored here.
					const isUserAction = update.transactions.some(
						tr => tr.annotation(Transaction.userEvent) !== undefined
					);
					if (isUserAction && !this.isDispatchingKill) {
						this.isKillChaining = false;
						this._recenterStep = 0;
					}
				}
			})
		);

		this.registerDomEvent(activeDocument, 'mousedown', () => {
			this.isKillChaining = false;
			this._recenterStep = 0;
		});

		this.registerDomEvent(activeDocument, 'copy', () => {
			this.killCache = '';
		});

		this.registerDomEvent(activeDocument, 'cut', () => {
			this.killCache = '';
		});

	}

	onunload() {

	}


	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as UniversalCursorHotkeysSettings;
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

		if (editor.inTableCell) {
			this.moveCursorHomeInTable(editor);
			return;
		}

		if (!this.isLivePreviewMode() && this.isTableLineSourceMode(editor.getLine(cursor.line))) {
			this.moveCursorHomeInTableSourceMode(editor);
			return;
		}

		this.moveCursorHomeNonTable(editor);
	}


	private moveCursorEnd(editor: Editor) {
		if (editor.inTableCell) {
			this.moveCursorEndInTable(editor);
			return;
		}

		if (!this.isLivePreviewMode() && this.isTableLineSourceMode(editor.getLine(editor.getCursor().line))) {
			this.moveCursorEndInTableSourceMode(editor);
			return;
		}

		this.moveCursorEndNonTable(editor);
	}


	private moveCursorLeft(editor: Editor) {
		const cursor = editor.getCursor();

		if (editor.inTableCell) {
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

		if (editor.inTableCell) {
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
	// Ctrl-A — Home helpers
	//===========================================================================

	// In-cell Home: VL edge (if visualLineMovement) → smart home → sub-line start → left cell.
	private moveCursorHomeInTable(editor: Editor) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) {
			// Fallback: no-op if inner view is unavailable (cursor not in LP table cell).
			return;
		}

		// Inner view path: use sub-line boundaries directly.
		const head    = inner.state.selection.main.head;
		const subLine = inner.state.doc.lineAt(head);

		// First sub-line: skip leading whitespace to reach content start.
		// Middle/last sub-lines: content starts right after the \n boundary.
		const isFirstSubLine = subLine.number === 1;
		const startOfSubLine = isFirstSubLine
			? subLine.from + subLine.text.search(/\S|$/)
			: subLine.from;

		if (head <= startOfSubLine) {
			if (subLine.number === 1) this.moveToLeftCellEnd(editor);
			return;
		}

		// VL step: when on VL2+ within a sub-line, move to the VL left edge first.
		if (this.settings.visualLineMovement) {
			// Use assoc to pick the correct side at wrap points: assoc=-1 means the cursor
			// is visually at the right end of VL_N, so coordsAtPos with side=-1 returns VL_N
			// coords. Without this, default side=1 would return VL_N+1 coords and make the
			// VL step appear to be a no-op (vlStartPos === head).
			const assoc = inner.state.selection.main.assoc;
			const coords = inner.coordsAtPos(head, assoc < 0 ? -1 : 1);
			if (coords) {
				// x=0 is left of all inner-view content; posAtCoords snaps to the leftmost
				// character on the current visual line. y = midpoint of that line (height ≈ 18 px).
				const vlStartPos = inner.posAtCoords({ x: 0, y: coords.top + 9 }, false);
				if (vlStartPos !== null && vlStartPos > startOfSubLine && head > vlStartPos) {
					inner.dispatch({ selection: { anchor: vlStartPos }, userEvent: 'move' });
					return;
				}
			}
		}

		// Smart home: apply prefix detection on content slice (from startOfSubLine).
		const contentText    = subLine.text.slice(startOfSubLine - subLine.from);
		const smartHomeInner = startOfSubLine + this.getBeginningOfLinePosition(contentText, head - startOfSubLine);

		if (head > smartHomeInner) {
			inner.dispatch({ selection: { anchor: smartHomeInner }, userEvent: 'move' });
			return;
		}
		inner.dispatch({ selection: { anchor: startOfSubLine }, userEvent: 'move' });
	}


	private moveCursorHomeInTableSourceMode(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const info = this.getInCellLineInfo(line, cursor.ch);
		if (!info) return;

		if (info.isEmpty || cursor.ch <= info.startOfInCellLine) {
			if (info.lineType === 'single' || info.lineType === 'first') {
				this.moveToLeftCellEndSourceMode(editor);
			}
			return;
		}

		const bounds = this.getCellBounds(line, cursor.ch);
		if (!bounds) return;
		const cellContent = line.slice(info.startOfInCellLine, bounds.close);
		const smartHomePos = info.startOfInCellLine + this.getBeginningOfLinePosition(cellContent, cursor.ch - info.startOfInCellLine);

		if (cursor.ch > smartHomePos) {
			editor.setCursor({ line: cursor.line, ch: smartHomePos });
			return;
		}
		editor.setCursor({ line: cursor.line, ch: info.startOfInCellLine });
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


	//===========================================================================
	// Ctrl-E — End helpers
	//===========================================================================

	// In-cell End: VL edge (if visualLineMovement) → sub-line end → right cell.
	private moveCursorEndInTable(editor: Editor) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) {
			// Fallback: no-op if inner view is unavailable (cursor not in LP table cell).
			return;
		}

		// Inner view path: use sub-line boundaries directly.
		const head    = inner.state.selection.main.head;
		const subLine = inner.state.doc.lineAt(head);

		// Last sub-line: trim trailing whitespace; non-last: end is at \n boundary.
		const isLastSubLine = subLine.number === inner.state.doc.lines;
		const endOfSubLine  = isLastSubLine
			? subLine.from + subLine.text.trimEnd().length
			: subLine.to;

		if (head >= endOfSubLine) {
			if (isLastSubLine) this.moveToRightCellStart(editor);
			// first/middle at end: no-op
			return;
		}

		// VL step: when on a non-last VL within the sub-line, move to the VL right edge first.
		if (this.settings.visualLineMovement) {
			const vlEnd = inner.moveToLineBoundary(inner.state.selection.main, true, true);
			if (vlEnd.head !== head && vlEnd.head < endOfSubLine) {
				inner.dispatch({
					selection: EditorSelection.create([EditorSelection.cursor(vlEnd.head, vlEnd.assoc)]),
					userEvent: 'move',
				});
				return;
			}
		}

		inner.dispatch({ selection: { anchor: endOfSubLine }, userEvent: 'move' });
	}


	private moveCursorEndInTableSourceMode(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		// Cursor is before the first pipe (outside any cell): snap to cell 0 content start.
		if (cursor.ch === 0) {
			const targetCh = this.getChByCellIndex(line, 0);
			if (targetCh !== -1) editor.setCursor({ line: cursor.line, ch: targetCh });
			return;
		}

		const info = this.getInCellLineInfo(line, cursor.ch);
		if (!info) return;

		if (info.isEmpty || cursor.ch >= info.endOfInCellLine) {
			if (info.lineType === 'single' || info.lineType === 'last') {
				this.moveToRightCellStartSourceMode(editor);
			} else if (cursor.ch > info.endOfInCellLine) {
				// 'first' or 'middle' with cursor strictly inside <br> text: skip to next segment's end.
				const brLen = line.slice(info.endOfInCellLine).match(/^<[bB][rR]>([ \t]*)/)?.[0].length ?? 0;
				if (brLen > 0) {
					const nextInfo = this.getInCellLineInfo(line, info.endOfInCellLine + brLen);
					if (nextInfo) editor.setCursor({ line: cursor.line, ch: nextInfo.endOfInCellLine });
				}
			}
			// 'first' or 'middle' at exactly endOfInCellLine: do nothing.
			return;
		}
		editor.setCursor({ line: cursor.line, ch: info.endOfInCellLine });
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

		if (cursor.line === 0 || !this.isLivePreviewMode()) {
			editor.exec('goUp');
			return;
		}

		if (editor.inTableCell) {
			this.moveCursorUpInTable(editor);
			return;
		}
		if (this.isPositionInTable(editor, cursor.line - 1, 1)) {
			this.moveCursorUpIntoTable(editor);
			return;
		}

		// Enter a blockquote/callout from the empty line directly below it.
		// goUp skips over the collapsed widget; setCursor triggers LP expansion (same mechanism as goLeft).
		// Precondition: current line is empty or whitespace-only.
		// Detection: syntax tree at end of prevLine has HyperMD-quote (covers > lines and lazy continuation).
		if (editor.getLine(cursor.line).trim() === '' &&
			this.isLineInQuote(editor, cursor.line - 1)) {
			const prevLine = cursor.line - 1;
			const prevLen  = editor.getLine(prevLine).length;
			editor.setCursor({ line: prevLine, ch: Math.min(cursor.ch, prevLen) });
			return;
		}

		editor.exec('goUp');
	}


	private moveCursorDown(editor: Editor) {
		const cursor = editor.getCursor();

		if (!this.isLivePreviewMode()) {
			editor.exec('goDown');
			return;
		}

		if (editor.inTableCell) {
			this.moveCursorDownInTable(editor);
			return;
		}
		if (this.isPositionInTable(editor, cursor.line + 1, 1)) {
			this.moveCursorDownIntoTable(editor);
			return;
		}

		// Enter a callout from the line directly above it.
		// goDown skips over the collapsed callout widget; setCursor triggers LP expansion.
		// Plain blockquotes are already handled by goDown; only callout headers need this.
		// Callout header pattern: > [!type], > [!type]+, > [!type]-, > [!type]+ Title, etc.
		const nextIdx = cursor.line + 1;
		if (nextIdx < editor.lineCount() &&
			/^\s*>\s*\[![^\]]+\]([+-]?(\s|$))/.test(editor.getLine(nextIdx))) {
			const nextLen = editor.getLine(nextIdx).length;
			editor.setCursor({ line: nextIdx, ch: Math.min(cursor.ch, nextLen) });
			return;
		}

		editor.exec('goDown');
	}


	// Returns the viewport-relative Y coordinate of the current browser cursor.
	// Works inside LP table cells (unlike cm.coordsAtPos). Returns null when off-screen.
	// view: when provided, used as a precise fallback via coordsAtPos when the selection
	// rect has zero height (e.g. cursor at ch=0 of the first line).
	private getCursorScreenY(view?: EditorView): number | null {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return null;
		const range = sel.getRangeAt(0);
		const rect  = range.getBoundingClientRect();
		if (rect.height > 0) return rect.top;
		// Collapsed range with zero height: try coordsAtPos for accurate line top.
		if (view) {
			const coords = view.coordsAtPos(view.state.selection.main.head);
			if (coords) return coords.top;
		}
		const node = range.startContainer;
		const el   = node.instanceOf(Element) ? node : node.parentElement;
		return el?.getBoundingClientRect().top ?? null;
	}

	// Page down/up: move cursor one screen minus NEXT_SCREEN_CONTEXT_LINES of overlap.
	// Uses moveCursorDown/Up to traverse tables and callouts correctly.
	//
	// Measurement: docY = getCursorScreenY() + cm.scrollDOM.scrollTop.
	// docY is the cursor's absolute document-space Y and is invariant under any
	// scrollIntoView — even if the outer CM head points to VL1 instead of the actual
	// inner cursor (LP wrapped cell), screenY and scrollTop adjust symmetrically so
	// their sum is always correct. No caching or estimation is needed.
	private _inScrollPage    = false;
	private _scrollPageGenId = 0;

	private pageDown(editor: Editor) { this.scrollPage(editor,  1); }
	private pageUp  (editor: Editor) { this.scrollPage(editor, -1); }

	// scrollPage operates in four phases:
	//   1. Record prevScreenY — cursor's Y within the scroll area before any movement.
	//   2. Loop — advance cursor one page via moveCursorDown/Up, measuring real pixel progress.
	//   3. Scroll — call scrollToCursorAtY to restore the cursor to prevScreenY on screen.
	//   4. Watch — detect LP cursor normalization and re-run scrollToCursorAtY after it settles.
	private scrollPage(editor: Editor, direction: 1 | -1) {
		const cm = editor.cm;
		if (!cm) return;

		const moveCursor = direction > 0
			? (e: Editor) => this.moveCursorDown(e)
			: (e: Editor) => this.moveCursorUp(e);

		const target = cm.scrollDOM.clientHeight
		             - this.NEXT_SCREEN_CONTEXT_LINES * cm.defaultLineHeight;

		const getDocY = (): number | null => {
			const y = this.getCursorScreenY(cm);
			return y !== null ? y + cm.scrollDOM.scrollTop : null;
		};

		// Phase 1: record cursor's scroll-area-relative Y (viewport Y minus scrollRect.top).
		// Used by phase 3 to restore the cursor to the same on-screen position after scrolling.
		const scrollRect  = cm.scrollDOM.getBoundingClientRect();
		const rawY        = this.getCursorScreenY(cm);
		const prevScreenY = rawY !== null ? rawY - scrollRect.top : cm.scrollDOM.clientHeight / 2;

		// Phase 2: step through one page via moveCursorDown/Up (handles tables and callouts).
		// scrollIntoView keeps the cursor on-screen each step so getDocY() stays accurate.
		// delta measures the real pixel distance moved; accumulated in consumed until >= target.
		let prev     = editor.getCursor();
		let consumed = 0;

		this._inScrollPage = true;
		try {
			while (consumed < target) {
				const prevDocY = getDocY();

				moveCursor(editor);
				const cur = editor.getCursor();
				if (cur.line === prev.line && cur.ch === prev.ch) break;
				prev = cur;

				cm.dispatch({
					effects: EditorView.scrollIntoView(cm.state.selection.main.head, { y: 'nearest' }),
				});

				const curDocY = getDocY();
				const delta   = (prevDocY !== null && curDocY !== null)
				              ? (curDocY - prevDocY) * direction : null;

				let step: number;
				if (delta !== null && delta >= 1) {
					step = delta;
				} else if (delta !== null) {
					// |delta| < 1: horizontal movement on the same visual line, no vertical progress.
					step = 0;
				} else {
					step = cm.defaultLineHeight;
				}

				consumed += step;
			}
		} finally {
			this._inScrollPage = false;
		}

		// Phase 3: scrollIntoView only guarantees the cursor is visible, not at prevScreenY.
		// scrollToCursorAtY adjusts scrollTop so the cursor lands at the recorded position.
		this.scrollToCursorAtY(editor, prevScreenY);

		const savedHead = cm.state.selection.main.head;
		const genId     = ++this._scrollPageGenId;

		// Phase 4: Obsidian's LP normalizer fires in the first rAF (~20ms) after the loop's
		// scrollIntoView calls, moving the cursor to an invalid position. LP widget heights
		// also shift during the transition, so savedScrollTop would place the cursor at the
		// wrong Y — re-run scrollToCursorAtY instead once LP has stabilized (~100ms later).
		// genId cancels a stale watcher when a new scrollPage call arrives first.
		let frames = 0;
		const watchNormalization = () => {
			if (this._scrollPageGenId !== genId) return;
			if (cm.state.selection.main.head !== savedHead) {
				window.setTimeout(() => {
					if (this._scrollPageGenId !== genId) return;
					cm.dispatch({ selection: { anchor: savedHead, head: savedHead } });
					this.scrollToCursorAtY(editor, prevScreenY);
				}, 100);
				return;
			}
			if (++frames < 5) requestAnimationFrame(watchNormalization);
		};
		requestAnimationFrame(watchNormalization);
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

		// Empty cell: no navigable content, so go directly to the previous row.
		if (startOfCellContent === this.getEndOfCellContent(line, cursor.ch)) {
			this.setCursorToPrevRow(editor, cellIndex);
			this.placeAtBottomVL(editor);
			return;
		}

		const innerBeforeGoUp = editor.activeCM;
		const innerHeadBeforeGoUp = (innerBeforeGoUp && innerBeforeGoUp !== editor.cm)
			? innerBeforeGoUp.state.selection.main.head
			: undefined;

		// At VL wrap-point edges, assoc may misidentify which VL the cursor is on,
		// causing goUp to skip an extra visual line. Fix assoc before goUp:
		//   left edge  → assoc=1  (start of this VL, not end of the line above)
		//   right edge → assoc=-1 (end of this VL, not start of the line below)
		if (innerBeforeGoUp && innerBeforeGoUp !== editor.cm && innerHeadBeforeGoUp !== undefined) {
			const h = innerHeadBeforeGoUp;
			const currentAssoc = innerBeforeGoUp.state.selection.main.assoc;
			const coords = innerBeforeGoUp.coordsAtPos(h);
			// Fix only when assoc >= 0: assoc=-1 means the cursor is already correctly
			// placed at the right edge of VL_N (end-of-VL), so goUp works as expected.
			// Firing for assoc=-1 would incorrectly flip the cursor to the left edge of
			// VL_N+1 and cause goUp to skip the wrong number of visual lines.
			if (coords && currentAssoc >= 0) {
				const vlStartPos = innerBeforeGoUp.posAtCoords({ x: 0, y: coords.top + 9 }, false);
				if (vlStartPos !== null && vlStartPos === h) {
					innerBeforeGoUp.dispatch({
						selection: EditorSelection.create([EditorSelection.cursor(h, 1)]),
					});
				}
			}
		}

		editor.exec('goUp');

		const cursorAfter = editor.getCursor();
		if (cursorAfter.line !== cursor.line) {
			// goUp moved to a different logical line (previous table row or outside table).
			if (editor.inTableCell) {
				const targetCh = this.getChByCellIndex(editor.getLine(cursorAfter.line), cellIndex);
				if (targetCh !== -1) {
					this.setCursorViaCm(editor, cursorAfter.line, targetCh);
				}
			}
			this.placeAtBottomVL(editor);
			return;
		}

		// goUp stayed on the same logical line.
		if (cursor.ch <= startOfCellContent) {
			// Was at cell start -> go to previous row.
			this.setCursorToPrevRow(editor, cellIndex);
			this.placeAtBottomVL(editor);
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
				this.placeAtBottomVL(editor);
			} else {
				this.handleCellStartSnap(editor, cursor.line, cursor.ch, cellIndex, innerHeadBeforeGoUp);
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
		this.placeAtBottomVL(editor);
	}


	// Handles goDown when the cursor is inside a table cell in Live Preview mode.
	private moveCursorDownInTable(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = this.getCellIndex(line, cursor.ch);
		const eoc = this.getEndOfCellContent(line, cursor.ch);

		// Empty cell: no navigable content, so go directly to the next row.
		if (this.getStartOfCellContent(line, cursor.ch) === eoc) {
			this.setCursorToNextRow(editor, cellIndex);
			return;
		}

		// Not on the last sub-line (inner doc has more lines below) → goDown navigates
		// within the cell.  No post-check needed — we never exit the row here.
		const inner = editor.activeCM;
		if (inner && inner !== editor.cm) {
			const head = inner.state.selection.main.head;
			const subLine = inner.state.doc.lineAt(head);

			// At VL wrap-point edges, assoc may misidentify which VL the cursor is on,
			// causing goDown to skip an extra visual line. Fix assoc before any goDown:
			//   left edge  → assoc=1  (start of this VL, not end of the line above)
			//   right edge → assoc=-1 (end of this VL, not start of the line below)
			const currentAssoc = inner.state.selection.main.assoc;
			const coords = inner.coordsAtPos(head);
			// Fix only when assoc >= 0 (same rationale as moveCursorUpInTable).
			if (coords && currentAssoc >= 0) {
				const vlStartPos = inner.posAtCoords({ x: 0, y: coords.top + 9 }, false);
				if (vlStartPos !== null && vlStartPos === head) {
					inner.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(head, 1)]) });
				}
			}

			if (subLine.number < inner.state.doc.lines) {
				editor.exec('goDown');
				return;
			}
		}

		// type is 'single' or 'last'.
		// If cursor is already at/past cell content end, we are at VL_N end.
		// goDown from this position is unreliable (no-op in LP even when a row exists
		// below).  Navigate to the next row directly.
		if (cursor.ch >= eoc) {
			this.setCursorToNextRow(editor, cellIndex);
			return;
		}

		// Determine whether the cursor is already on the last visual line (VL_N).
		// Used below to resolve the VL_N-1 vs VL_N clip ambiguity after goDown:
		//   VL_N-1 clip → goDown moved into VL_N and clipped to eoc → stay in cell.
		//   VL_N   clip → goDown could not move further → exit to next row.
		// Default true: safe fallback to old clip→exit when inner view is unavailable.
		let isOnLastVL = true;
		if (inner && inner !== editor.cm) {
			const head = inner.state.selection.main.head;
			const lastSubLine = inner.state.doc.line(inner.state.doc.lines);
			const contentEnd = lastSubLine.from + lastSubLine.text.trimEnd().length;
			// Use assoc to pick the correct side at wrap points: assoc=-1 means the cursor is
			// visually at the right end of VL_N-1, so coordsAtPos with side=-1 returns VL_N-1
			// coords. Without this, default side=1 returns VL_N coords (= same as contentEnd's
			// VL), causing isOnLastVL to be true even when we are still on VL_N-1.
			const assoc = inner.state.selection.main.assoc;
			const headCoords = inner.coordsAtPos(head, assoc < 0 ? -1 : 1);
			const endCoords  = inner.coordsAtPos(contentEnd);
			if (headCoords && endCoords) {
				// 4 px: same-VL diff is always 0.0; adjacent-VL diff is ≥ line-height (~18 px).
				isOnLastVL = Math.abs(headCoords.top - endCoords.top) < 4;
			}
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
			if (isOnLastVL) {
				// Was already on VL_N: goDown clipped in place → exit to next row.
				this.setCursorToNextRow(editor, cellIndex);
			}
			// Was on VL_N-1: goDown moved to VL_N and clipped to eoc → VL advance, stay.
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
	// Ctrl-B/F — cell boundary helpers — Source Mode
	//===========================================================================

	private moveToLeftCellEndSourceMode(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = this.getCellIndex(line, cursor.ch);

		if (cellIndex > 0) {
			const targetCh = this.getEndOfCellContentByCellIndex(line, cellIndex - 1);
			if (targetCh !== -1) {
				editor.setCursor({ line: cursor.line, ch: targetCh });
			}
			return;
		}

		if (!this.settings.crossRowNavigation) return;

		const targetLine = this.getPrevRowLineSourceMode(editor);
		if (targetLine === -1) {
			if (cursor.line > 0) {
				editor.setCursor({ line: cursor.line - 1, ch: 0 });
			}
			return;
		}
		const targetLineText = editor.getLine(targetLine);
		const rightmostIndex = this.getRightmostCellIndex(targetLineText);
		const targetCh = this.getEndOfCellContentByCellIndex(targetLineText, rightmostIndex);
		if (targetCh !== -1) {
			editor.setCursor({ line: targetLine, ch: targetCh });
		}
	}


	private moveToRightCellStartSourceMode(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = this.getCellIndex(line, cursor.ch);
		const lastCellIndex = this.getRightmostCellIndex(line);

		if (cellIndex < lastCellIndex) {
			const targetCh = this.getChByCellIndex(line, cellIndex + 1);
			if (targetCh !== -1) {
				editor.setCursor({ line: cursor.line, ch: targetCh });
			}
			return;
		}

		if (!this.settings.crossRowNavigation) return;

		const targetLine = this.getNextRowLineSourceMode(editor);
		if (targetLine === -1) {
			let exitLine = cursor.line + 1;
			while (exitLine < editor.lineCount() && this.isTableLineSourceMode(editor.getLine(exitLine))) {
				exitLine++;
			}
			if (exitLine >= editor.lineCount()) {
				editor.replaceRange('\n', { line: exitLine - 1, ch: editor.getLine(exitLine - 1).length });
			}
			editor.setCursor({ line: exitLine, ch: 0 });
			return;
		}
		const targetCh = this.getChByCellIndex(editor.getLine(targetLine), 0);
		if (targetCh !== -1) {
			editor.setCursor({ line: targetLine, ch: targetCh });
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


	private getPrevRowLineSourceMode(editor: Editor): number {
		const cursor = editor.getCursor();
		if (cursor.line === 0) return -1;
		const prevLineText = editor.getLine(cursor.line - 1);
		return this.computePrevRowLine(
			cursor.line,
			this.isTableLineSourceMode(prevLineText),
			prevLineText,
		);
	}


	private getNextRowLineSourceMode(editor: Editor): number {
		const cursor = editor.getCursor();
		const nextLineExists = cursor.line + 1 < editor.lineCount();
		const nextLineText = nextLineExists ? editor.getLine(cursor.line + 1) : '';
		const lineAfterNextInTable = cursor.line + 2 < editor.lineCount()
			&& this.isTableLineSourceMode(editor.getLine(cursor.line + 2));
		return this.computeNextRowLine(
			cursor.line,
			nextLineExists && this.isTableLineSourceMode(nextLineText),
			nextLineText,
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
	// Distinguishes VL1-middle (→ go to previous row) from VL2+ left edge (→ stay).
	//
	// Primary: compare y-coordinates via coordsAtPos — no cursor side-effects.
	//   originalHead was on VL2+  →  its y > VL1-start y  →  stay
	//   originalHead was on VL1   →  its y ≈ VL1-start y  →  previous row
	//
	// Fallback: goDown probe using CM6's goal-column memory.
	private handleCellStartSnap(
		editor: Editor,
		originalLine: number,
		originalCh: number,
		cellIndex: number,
		innerHeadBeforeGoUp?: number,
	) {
		const inner = editor.activeCM;
		if (innerHeadBeforeGoUp !== undefined && inner && inner !== editor.cm) {
			const vl1Coords      = inner.coordsAtPos(inner.state.selection.main.head);
			const originalCoords = inner.coordsAtPos(innerHeadBeforeGoUp);
			if (vl1Coords && originalCoords) {
				if (originalCoords.top > vl1Coords.top + 2) {
					// VL2+ left edge: cursor already at VL1 start — nothing to do.
					return;
				}
				// VL1 middle: go to previous row.
				this.setCursorToPrevRow(editor, cellIndex);
				this.placeAtBottomVL(editor);
				return;
			}
		}

		// Fallback: goDown probe (exploits CM6 goal-column to tell VL1 from VL2+).
		editor.exec('goDown');
		const backTest = editor.getCursor();
		if (backTest.line === originalLine && backTest.ch === originalCh) {
			// VL2+ left edge: undo probe, stay at VL1 start.
			editor.exec('goUp');
		} else {
			// VL1 middle: undo probe, go to previous row.
			editor.exec('goUp');
			this.setCursorToPrevRow(editor, cellIndex);
			this.placeAtBottomVL(editor);
		}
	}


	// Move to the bottom visual line synchronously if the inner view is already
	// mounted, otherwise defer via scheduleBottomVisualLine.
	private placeAtBottomVL(editor: Editor) {
		const inner = editor.activeCM;
		if (inner && inner !== editor.cm) {
			// Check cursor position (not content end) for on-screen detection:
			// when entering a cell from an adjacent row, the cursor start (ch=cellStart)
			// is always on-screen even if the cell content end is off-screen.
			// moveToBottomVisualLineOfCell handles the off-screen content end via goDown fallback.
			if (inner.coordsAtPos(inner.state.selection.main.head)) {
				this.moveToBottomVisualLineOfCell(editor);
				return;
			}
		}
		this.scheduleBottomVisualLine(editor);
	}


	// Schedules moveToBottomVisualLineOfCell for the next event loop tick.
	// Used after synchronous cursor placement to let the DOM settle first.
	private scheduleBottomVisualLine(editor: Editor) {
		if (this._inScrollPage) return;
		window.setTimeout(() => {
			if (editor.inTableCell) {
				this.moveToBottomVisualLineOfCell(editor);
			}
		}, 0);
	}


	// Move to the bottom visual line of the current table cell.
	// Primary: use coordsAtPos + posAtCoords on the inner EditorView to jump directly.
	// Fallback: goDown loop for cases where the inner view or coordinates are unavailable.
	private moveToBottomVisualLineOfCell(editor: Editor) {
		const cursor = editor.getCursor();
		const startLine = cursor.line;
		const line = editor.getLine(startLine);
		const endOfCellContent = this.getEndOfCellContent(line, cursor.ch);

		const inner = editor.activeCM;
		if (inner && inner !== editor.cm) {
			const lastSubLine = inner.state.doc.line(inner.state.doc.lines);
			const contentEnd  = lastSubLine.from + lastSubLine.text.trimEnd().length;
			const endCoords   = inner.coordsAtPos(contentEnd);
			if (endCoords) {
				// x=0 is left of all inner-view content; posAtCoords snaps to the leftmost
				// character on the bottom visual line. y = midpoint of that line (height ≈ 18 px).
				const pos = inner.posAtCoords({ x: 0, y: endCoords.top + 9 }, false);
				if (pos !== null) {
					inner.dispatch({ selection: { anchor: pos } });
					return;
				}
			}
		}

		// Fallback: goDown loop.
		// goRight works around a Live Preview issue where goDown from the leftmost
		// cell position (placed by cm.dispatch) exits the table immediately.
		editor.exec('goRight');
		if (editor.getCursor().line !== startLine) {
			editor.setCursor(cursor);
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
			// Move back to lastPos using goLeft while the inner view is still active.
			// Dispatching to the outer CM view (setCursorViaCm) would destroy the inner
			// view, causing native-cursor to lose coordsAtPos and drop the cursor display.
			let pos = editor.getCursor();
			for (let step = 0; step < 64 && pos.ch > lastPos.ch; step++) {
				editor.exec('goLeft');
				const newP = editor.getCursor();
				if (newP.ch >= pos.ch) break;
				pos = newP;
			}
			return;
		}

		if (breakReason === 'exitedLine') {
			editor.exec('goUp');
		}
	}


	//===========================================================================
	// Infrastructure
	//===========================================================================

	private isPositionInTable(editor: Editor, line: number, ch: number): boolean {
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


	// Returns true if the given line is part of a blockquote or callout block,
	// including lazy continuation lines (HyperMD-quote-lazy).
	private isLineInQuote(editor: Editor, line: number): boolean {
		const cm = editor.cm;
		if (!cm) return false;

		const lineText = editor.getLine(line);
		const pos = editor.posToOffset({ line, ch: lineText.length });

		let node = syntaxTree(cm.state).resolveInner(pos, -1);
		while (node) {
			if (node.name.includes('HyperMD-quote')) return true;
			node = node.parent!;
		}
		return false;
	}


	// Scroll the view so the cursor appears at targetScreenY pixels from the top of the
	// scroll area. Works for both regular text and LP table cells: uses getCursorScreenY()
	// (window.getSelection) rather than cm.state.selection.main.head, so the result is
	// correct even when the outer CM head points to the row start (VL1) instead of the
	// actual inner cursor position in a wrapped cell.
	private scrollToCursorAtY(editor: Editor, targetScreenY: number) {
		const cm = editor.cm;
		if (!cm) return;
		const cursorTop = this.getCursorScreenY(cm);
		if (cursorTop === null) return;
		const scrollRect = cm.scrollDOM.getBoundingClientRect();
		const docY = cursorTop - scrollRect.top + cm.scrollDOM.scrollTop;
		cm.scrollDOM.scrollTop = Math.max(0, docY - targetScreenY);
	}

	// Use cm.dispatch directly to avoid triggering Obsidian's table editor
	// interference that occurs when moving the cursor within a Live Preview table.
	private recenter(editor: Editor) {
		const cm = editor.cm;
		if (!cm) return;
		this.scrollToCursorAtY(editor, cm.scrollDOM.clientHeight / 2);
	}

	// Cycles center → top → bottom on successive presses; resets on any other action.
	private recenterTopBottom(editor: Editor) {
		const cm = editor.cm;
		if (!cm) return;
		const h      = cm.scrollDOM.clientHeight;
		const margin = this.RECENTER_TOP_BOTTOM_MARGIN_LINES * cm.defaultLineHeight;

		const targetY = this._recenterStep === 0 ? h / 2
		              : this._recenterStep === 1 ? margin
		              :                            h - margin - cm.defaultLineHeight;

		this.scrollToCursorAtY(editor, targetY);
		this._recenterStep = (this._recenterStep + 1) % 3;
	}


	private setCursorViaCm(editor: Editor, line: number, ch: number) {
		const targetInTable = this.isPositionInTable(editor, line, ch);
		const cm = editor.cm;
		const pos = editor.posToOffset({ line, ch });
		cm.dispatch({ selection: { anchor: pos, head: pos }, userEvent: 'move' });
		if (!targetInTable) {
			// Exiting the table: outer CM must receive keyboard events.
			cm.focus();
		} else {
			// Navigating to a table cell: do NOT call cm.focus().
			// Normally Obsidian auto-creates and auto-focuses the inner view when
			// cm.dispatch places the cursor in a table cell.  However, if the outer
			// CM already held DOM focus before the dispatch (e.g. after editor.setLine
			// in Kill Line), Obsidian skips auto-focus.  Transfer focus explicitly in
			// the next frame to cover that case without risking destroying the inner view.
			if (!this._inScrollPage) {
				window.requestAnimationFrame(() => {
					const inner = editor.activeCM;
					if (inner && inner !== cm && !inner.hasFocus) {
						inner.focus();
					}
				});
			}
		}
	}


	// Navigate to (targetLine, targetCh) via editor.exec goLeft/goRight, keeping the
	// inner CM view active. Dispatching to the outer CM view (setCursorViaCm) causes
	// Obsidian to destroy and recreate the inner view, which breaks native-cursor's
	// coordsAtPos. Falls back to setCursorViaCm if the loop cannot reach the target.

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

		// Strip blockquote prefix so the downstream pattern checks run on the content.
		// bqEnd is 0 for non-blockquote lines and added back to every return value.
		let bqEnd = 0;
		const bqMatch = line.match(/^(\s*>)+\s*/);
		if (bqMatch) {
			bqEnd = bqMatch[0].length;
			line = line.slice(bqEnd);
			ch -= bqEnd;
		}

		let result: RegExpMatchArray | null = null;
		if (this.settings.smartHomeAdvanced) {
			// Callout type marker: > [!type] Title → stop before Title (blockquote lines only)
			if (bqEnd > 0) {
				result = line.match(/^\[![^\]]+\][+-]?\s*/);
				if (result !== null && result[0].length < ch) return bqEnd + result[0].length;
			}
			// Headings in an unordered list (Adv.)
			// `- # heading-text`, 1st after `# `, 2nd after `- `
			result = line.match(/^(\s*[-+*]\s)?#+\s/);
			if (result !== null && result[0].length < ch) return bqEnd + result[0].length;
			result = line.match(/^#{1,6}\s/); // Headings (Adv.)
			if (result === null) result = line.match(/^\[\^.+\]:\s*/); // Footnotes (Adv.)
		}
		if (result === null) result = line.match(/^\s*\d+[.)]\s/); // Ordered lists
		if (result === null) result = line.match(/^\s*([-+*]\s(\[.\]\s)?)?/); // Indents, Unordered lists, Task lists

		if (result !== null && result[0].length < ch) return bqEnd + result[0].length;
		return 0;
	}


	private getPipePositions(line: string): number[] {
		return [...line.matchAll(this.CELL_SEPARATOR_REGEX)].map(m => m.index);
	}


	private isTableLineSourceMode(line: string): boolean {
		const trimmed = line.trimEnd();
		return trimmed.startsWith('|') && trimmed.endsWith('|');
	}


	//===========================================================================
	// Select all
	//===========================================================================

	private selectAll(editor: Editor) {
		const cursor   = editor.getCursor();
		const line     = editor.getLine(cursor.line);
		const inTable  = (editor.inTableCell)
		              || (!this.isLivePreviewMode() && this.isTableLineSourceMode(line));

		if (inTable) {
			const start = this.getStartOfCellContent(line, cursor.ch);
			const end   = this.getEndOfCellContent(line, cursor.ch);
			if (start === end) return;
			editor.setSelection({ line: cursor.line, ch: start }, { line: cursor.line, ch: end });
			return;
		}

		editor.setSelection(
			{ line: 0, ch: 0 },
			{ line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length }
		);
	}


	//===========================================================================
	// Delete char (Ctrl-D)
	//===========================================================================

	private deleteChar(editor: Editor) {
		const inLPTable = editor.inTableCell;
		if (inLPTable) {
			this.deleteCharInTableLP(editor);
			return;
		}

		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		const inSourceTable = !this.isLivePreviewMode() && this.isTableLineSourceMode(lineText);
		if (inSourceTable) {
			this.deleteCharInTableSource(editor);
			return;
		}

		const cm = editor.cm;
		if (cm) deleteCharForward(cm);
	}


	private deleteCharInTableLP(editor: Editor) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) {
			// Fallback: no-op if inner view is unavailable (cursor not in LP table cell).
			return;
		}

		// Inner view path: use sub-line boundaries directly.
		const head    = inner.state.selection.main.head;
		const subLine = inner.state.doc.lineAt(head);
		const isLastSubLine = subLine.number === inner.state.doc.lines;

		if (isLastSubLine) {
			const endOfSubLine = subLine.from + subLine.text.trimEnd().length;
			if (head >= endOfSubLine) return;  // cell boundary: no-op
		} else if (head >= subLine.to) {
			// At \n boundary: delete the \n to join sub-lines.
			inner.dispatch({ changes: { from: subLine.to, to: subLine.to + 1, insert: '' }, selection: { anchor: subLine.to }, userEvent: 'delete' });
			return;
		}

		const cm = editor.cm;
		if (cm) deleteCharForward(cm);
	}


	private deleteCharInTableSource(editor: Editor) {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		const bounds = this.getCellBounds(lineText, cursor.ch);

		if (!bounds) {
			const cm = editor.cm;
			if (cm) deleteCharForward(cm);
			return;
		}

		// At or past trailing whitespace before closing pipe: no-op (cell boundary)
		const cellEnd = bounds.open + 1 + lineText.slice(bounds.open + 1, bounds.close).trimEnd().length;
		if (cursor.ch >= cellEnd) return;

		// Within cell: delete one character forward (no HTML-tag awareness in Source Mode)
		const cm = editor.cm;
		if (cm) deleteCharForward(cm);
	}


	//===========================================================================
	// Kill line (Ctrl-K)
	//===========================================================================

	private killLine(editor: Editor) {
		const lineText = editor.getLine(editor.getCursor().line);
		const inLPTable = editor.inTableCell;
		const inSourceTable = !this.isLivePreviewMode() && this.isTableLineSourceMode(lineText);

		if (inLPTable) {
			this.killLineInTableLP(editor);
			return;
		}

		if (inSourceTable) {
			const info = this.getInCellLineInfo(lineText, editor.getCursor().ch);
			if (info) {
				this.killLineInTableSourceMode(editor, info);
				return;
			}
		}

		this.killLineNonTable(editor);
	}


	private killLineInTableLP(editor: Editor) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) {
			// Fallback: no-op if inner view is unavailable (cursor not in LP table cell).
			return;
		}

		// Inner view path: use sub-line boundaries directly.
		const head          = inner.state.selection.main.head;
		const subLine       = inner.state.doc.lineAt(head);
		const isLastSubLine = subLine.number === inner.state.doc.lines;
		const endOfSubLine  = isLastSubLine
			? subLine.from + subLine.text.trimEnd().length
			: subLine.to;

		if (head < endOfSubLine) {
			const text = inner.state.doc.sliceString(head, endOfSubLine);
			this.updateKillCache(text);
			navigator.clipboard.writeText(this.killCache).catch(() => {});
			this.isDispatchingKill = true;
			inner.dispatch({ changes: { from: head, to: endOfSubLine, insert: '' }, selection: { anchor: head }, userEvent: 'delete' });
			this.isDispatchingKill = false;
			this.isKillChaining = true;
			return;
		}

		if (!isLastSubLine) {
			const afterNl = inner.state.doc.sliceString(subLine.to + 1);
			const trimLen = this.settings.smartJoin
				? this.getBeginningOfLinePosition(afterNl, afterNl.length || 1)
				: 0;
			this.updateKillCache('\n');
			navigator.clipboard.writeText(this.killCache).catch(() => {});
			this.isDispatchingKill = true;
			inner.dispatch({ changes: { from: subLine.to, to: subLine.to + 1 + trimLen, insert: '' }, selection: { anchor: subLine.to }, userEvent: 'delete' });
			this.isDispatchingKill = false;
			this.isKillChaining = true;
			return;
		}
	}


	private killLineInTableSourceMode(editor: Editor, info: InCellLineInfo) {
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

		// kill <br> forward from endOfInCellLine (only possible when lineType is 'first'/'middle')
		const brMatch = lineText.slice(info.endOfInCellLine).match(/^<[bB][rR]>([ \t]*)/);
		if (brMatch) {
			const brLen      = '<br>'.length;
			const afterBr    = lineText.slice(info.endOfInCellLine + brLen);
			const trimLen    = this.settings.smartJoin
				? this.getBeginningOfLinePosition(afterBr, afterBr.length || 1)
				: 0;
			const toCh       = info.endOfInCellLine + brLen + trimLen;
			const targetCh   = info.endOfInCellLine;
			const targetLine = cursor.line;
			this.updateKillCache('\n');
			navigator.clipboard.writeText(this.killCache).catch(() => {});
			this.isDispatchingKill = true;
			editor.setLine(targetLine, lineText.slice(0, targetCh) + lineText.slice(toCh));
			this.isDispatchingKill = false;
			window.setTimeout(() => {
				this.isDispatchingKill = true;
				this.setCursorViaCm(editor, targetLine, targetCh);
				this.isDispatchingKill = false;
				this.isKillChaining = true;
			}, 0);
			return;
		}

		// cursor snap: cursor may land at br.end (= startOfInCellLine of 'middle'/'last')
		// rather than br.start. Kill the <br> that ends at cursor.ch.
		const brSnapMatch = lineText.slice(0, cursor.ch).match(/<[bB][rR]>([ \t]*)$/);
		if (brSnapMatch && cursor.ch === info.startOfInCellLine) {
			const brStart    = cursor.ch - brSnapMatch[0].length;
			const targetLine = cursor.line;
			this.updateKillCache('\n');
			navigator.clipboard.writeText(this.killCache).catch(() => {});
			this.isDispatchingKill = true;
			editor.setLine(targetLine, lineText.slice(0, brStart) + lineText.slice(cursor.ch));
			this.isDispatchingKill = false;
			window.setTimeout(() => {
				this.isDispatchingKill = true;
				this.setCursorViaCm(editor, targetLine, brStart);
				this.isDispatchingKill = false;
				this.isKillChaining = true;
			}, 0);
			return;
		}
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
		const joinTrimLen = (this.settings.smartJoin && lineText.length > 0)
			? this.getBeginningOfLinePosition(nextLineText, nextLineText.length || 1)
			: 0;
		this.updateKillCache('\n');
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		this.isDispatchingKill = true;
		editor.replaceRange('', { line: cursor.line, ch: lineText.length }, { line: cursor.line + 1, ch: joinTrimLen });
		this.isDispatchingKill = false;
		this.isKillChaining = true;
	}


	private normalizeKillText(text: string): string {
		return text.replace(/<[bB][rR]>/g, '\n').replace(/\\\|/g, '|');
	}


	private updateKillCache(text: string): void {
		this.killCache = this.isKillChaining ? this.killCache + text : text;
	}


	//===========================================================================
	// Kill region (Ctrl-W)
	//===========================================================================

	private killRegion(editor: Editor) {
		const from = editor.getCursor('from');
		const to   = editor.getCursor('to');
		if (from.line === to.line && from.ch === to.ch) return;

		const fromLine = editor.getLine(from.line);
		const toLine   = editor.getLine(to.line);

		const inLPTable = editor.inTableCell;
		const inSourceTable = !this.isLivePreviewMode() && (
			this.isTableLineSourceMode(fromLine) ||
			this.isTableLineSourceMode(toLine)
		);

		if (inLPTable || inSourceTable) {
			if (from.line !== to.line) return;

			const line        = fromLine;
			const fromBounds  = this.getCellBounds(line, from.ch);
			const toBounds    = this.getCellBounds(line, to.ch);
			if (!fromBounds || !toBounds || fromBounds.open !== toBounds.open) return;
		}

		const rawText = editor.getSelection();
		const text = (inLPTable || inSourceTable)
			? this.normalizeKillText(rawText)
			: rawText;

		this.isKillChaining = false;
		this.updateKillCache(text);
		navigator.clipboard.writeText(this.killCache).catch(() => {});

		if (inLPTable) {
			const line = fromLine;
			let prefix = line.slice(0, from.ch);
			let suffix = line.slice(to.ch);
			const bounds = this.getCellBounds(line, from.ch);
			if (bounds) {
				if (/^<[bB][rR]>/.test(suffix)) {
					const cellContentBefore = line.slice(bounds.open + 1, from.ch).trim();
					if (!cellContentBefore) suffix = suffix.replace(/^<[bB][rR]>([ \t]*)/, '');
				} else if (/<[bB][rR]>$/.test(prefix)) {
					const cellContentAfter = line.slice(to.ch, bounds.close).trim();
					if (!cellContentAfter) prefix = prefix.replace(/<[bB][rR]>$/, '');
				}
			}
			const targetLine  = from.line;
			const cm          = editor.cm;
			const lineObj     = cm.state.doc.line(targetLine + 1);
			const savedScroll = cm.scrollDOM?.scrollTop;
			const inner       = editor.activeCM;
			if (inner && inner !== cm) {
				const innerSel    = inner.state.selection.main;
				const innerDoc    = inner.state.doc.toString();
				let delFrom       = innerSel.from;
				let delTo         = innerSel.to;
				const innerSuffix = innerDoc.slice(innerSel.to);
				const innerPrefix = innerDoc.slice(0, innerSel.from);
				// Inner view uses \n (not <br>) for in-cell line breaks
				if (innerSuffix.startsWith('\n')) {
					if (!innerPrefix.trim()) {
						const wsLen = innerSuffix.match(/^\n([ \t]*)/)?.[1].length ?? 0;
						delTo += 1 + wsLen;
					}
				} else {
					const trimmedPrefix = innerPrefix.trimEnd();
					if (trimmedPrefix.endsWith('\n') && !innerSuffix.trim()) {
						delFrom -= innerPrefix.length - trimmedPrefix.length + 1;
					}
				}
				inner.dispatch({
					changes:   { from: delFrom, to: delTo, insert: '' },
					selection: { anchor: delFrom },
				});
			} else {
				cm.dispatch({
					changes:   { from: lineObj.from, to: lineObj.to, insert: prefix + suffix },
					selection: { anchor: lineObj.from + prefix.length },
				});
				cm.focus();
			}
			if (savedScroll !== undefined) cm.scrollDOM.scrollTop = savedScroll;
		} else {
			editor.replaceRange('', from, to);
		}

		this.isKillChaining = false;
	}


	//===========================================================================
	// Yank (Ctrl-Y)
	//===========================================================================

	private async yank(editor: Editor) {
		this.isKillChaining = false;
		let raw: string;
		try {
			raw = await navigator.clipboard.readText();
		} catch {
			raw = this.killCache;
		}
		if (!raw) return;

		const lineText = editor.getLine(editor.getCursor().line);
		const inLPTable = editor.inTableCell;
		const inTable = inLPTable || this.isTableLineSourceMode(lineText);

		// LP table with active inner view: insert raw text directly.
		// The inner view uses \n for in-cell line breaks — no <br> conversion needed.
		if (inLPTable) {
			const inner = editor.activeCM;
			if (inner && inner !== editor.cm) {
				const scrollEl    = editor.cm?.scrollDOM;
				const savedScroll = scrollEl?.scrollTop;
				const innerSel    = inner.state.selection.main;
				inner.dispatch({
					changes:   { from: innerSel.from, to: innerSel.to, insert: raw },
					selection: { anchor: innerSel.from + raw.length },
					userEvent: 'input',
				});
				if (scrollEl && savedScroll !== undefined) scrollEl.scrollTop = savedScroll;
				return;
			}
		}

		const text = inTable
			? raw.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
			: raw;

		if (inLPTable && text.includes('<br>')) {
			const from        = editor.getCursor('from');
			const to          = editor.getCursor('to');
			const currentLine = editor.getLine(from.line);
			const prefix      = currentLine.slice(0, from.ch);
			const suffix      = currentLine.slice(to.ch);
			const targetLine  = from.line;
			const textForCursor = text.replace(/<[bB][rR]>$/, '');
			const targetCh      = prefix.length + textForCursor.length;
			const scrollEl      = editor.cm?.scrollDOM;
			const savedScroll   = scrollEl?.scrollTop;
			editor.setLine(targetLine, prefix + text + suffix);
			window.setTimeout(() => {
				if (scrollEl && savedScroll !== undefined) scrollEl.scrollTop = savedScroll;
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
		let smartJoinEl: HTMLElement;
		let smartJoinToggle: ToggleComponent;
		const setStandardDisabled = (disabled: boolean) => {
			advancedEl.style.opacity       = disabled ? '0.4' : '';
			advancedEl.style.pointerEvents = disabled ? 'none' : '';
			smartJoinEl.style.opacity       = disabled ? '0.4' : '';
			smartJoinEl.style.pointerEvents = disabled ? 'none' : '';
			if (disabled && this.plugin.settings.smartHomeAdvanced) {
				this.plugin.settings.smartHomeAdvanced = false;
				advancedToggle.setValue(false);
				void this.plugin.saveSettings();
			}
			if (disabled && this.plugin.settings.smartJoin) {
				this.plugin.settings.smartJoin = false;
				smartJoinToggle.setValue(false);
				void this.plugin.saveSettings();
			}
		};

		new Setting(containerEl)
			.setName('Smart home (standard)')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> HOME skips leading Markdown syntax (lists, checkboxes, indents, etc.) to reach content start — Windows Home / macOS Cmd+← style.<br>' +
				'<b>OFF:</b> HOME moves directly to the start of the line — macOS / Emacs Ctrl+A style.'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.smartHomeStandard)
				.onChange(async (value) => {
					this.plugin.settings.smartHomeStandard = value;
					setStandardDisabled(!value);
					await this.plugin.saveSettings();
				}));

		advancedEl = new Setting(containerEl)
			.setName('Smart home (advanced)')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> Also skips past headings (<code>#</code>) and footnotes (<code>[^1]:</code>).<br>' +
				'<i>Requires <b>Smart home (standard)</b> to be enabled.</i>'))
			.addToggle(toggle => {
				advancedToggle = toggle;
				toggle.setValue(this.plugin.settings.smartHomeAdvanced)
					.onChange(async (value) => {
						this.plugin.settings.smartHomeAdvanced = value;
						await this.plugin.saveSettings();
					});
			})
			.settingEl;

		smartJoinEl = new Setting(containerEl)
			.setName('Smart join')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> Kill Line join lands at the next line\'s content start, removing blockquote markers, list markers, and indentation. Pairs with Smart home (advanced) for headings and footnotes.<br>' +
				'<b>OFF:</b> Joins the next line as-is.<br>' +
				'<i>Requires <b>Smart home (standard)</b> to be enabled.</i>'))
			.addToggle(toggle => {
				smartJoinToggle = toggle;
				toggle.setValue(this.plugin.settings.smartJoin)
					.onChange(async (value) => {
						this.plugin.settings.smartJoin = value;
						await this.plugin.saveSettings();
					});
			})
			.settingEl;

		setStandardDisabled(!this.plugin.settings.smartHomeStandard);

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
