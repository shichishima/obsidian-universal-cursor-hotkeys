import { Editor, Plugin, MarkdownView } from 'obsidian';
import { UniversalCursorHotkeysSettingTab, DisplacedCommand } from './settings';
import { VimSupport } from './vim-support';
import { InCellLineInfo, getCellBounds, getStartOfCellContent, getEndOfCellContent,
	getEndOfCellContentByCellIndex, getRightmostCellIndex, getCellIndex, getChByCellIndex,
	getInCellLineInfo } from './table-cell-utils';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from "@codemirror/view";
import { EditorSelection, Transaction, findClusterBreak } from '@codemirror/state';
import { deleteCharForward, cursorPageDown, cursorPageUp, transposeChars as cmTransposeChars } from '@codemirror/commands';
import { getWordSpans, getBigWordSpans, findWordSpanOnLine } from './word-segmentation';
import { exitTable, jumpAdjacentCell } from './table-navigation';
import { cjkWordSelectionStyle } from './cjk-word-select';

// Extend the Obsidian Editor interface to include the internal CodeMirror 6 instance (EditorView)
declare module "obsidian" {
	interface Editor {
		cm: EditorView;
		inTableCell: boolean;
		// Active CM view: the inner EditorView when inTableCell is true, otherwise editor.cm.
		activeCM: EditorView;
	}
}


interface UniversalCursorHotkeysSettings {
	visualLineMovement: boolean;
	smartHomeStandard: boolean;
	smartHomeAdvanced: boolean;
	smartJoin: boolean;
	crossRowNavigation: boolean;
	// Double-click word selection, CJK-aware (Intl.Segmenter, same engine as
	// word-right/left and Vim w/b/e) — only intervenes when the click lands
	// on a Hiragana/Katakana/CJK-Ideograph character; every other case falls
	// through to CM6's own default. On by default: this corrects an
	// objectively broken native result (an entire unbroken CJK run selected
	// as one "word") rather than introducing an opinionated new behavior —
	// same category as Smart home (standard)/Visual line movement/Cross-row
	// navigation above, not Smart join (which stays opt-in precisely because
	// it makes a markdown-aware judgment call). Latin-only text is
	// unaffected either way.
	cjkDoubleClickWordSelect: boolean;
	qsaDisplacedCommands: DisplacedCommand[];
	qsaIndividualVisible: boolean;
	// Every block under Hotkey settings is collapsible now (uniform ▶/▼
	// affordance signaling "this is a child of Hotkey settings"), but the
	// default open/closed state per block is unchanged from before that:
	// the 3 core command blocks and Displaced commands stay open by
	// default; Table structure/Table navigation stay closed (secondary,
	// supplementary sections not owned by this plugin).
	qsaCursorMovementVisible: boolean;
	qsaEditingVisible: boolean;
	qsaOtherHotkeysVisible: boolean;
	qsaTableStructureVisible: boolean;
	qsaTableNavVisible: boolean;
	qsaDisplacedVisible: boolean;
	vimHlSupport: boolean;
	vimJkSupport: boolean;
	vimJoinSupport: boolean;
	vimCaretSupport: boolean;
	vimWordSupport: boolean;
	vimGgSupport: boolean;
	vimDisplayLineSupport: boolean;
	vimEolSupport: boolean;
	// Bundles the leader-key table-structure commands (currently just
	// insert-row-below — more follow the same wiring later). Off by
	// default like every other Vim feature.
	vimTableStructureSupport: boolean;
	// Pure cursor movement (exit table, jump to adjacent cell) — see
	// vim-support.ts's own doc comment for how this differs from
	// vimTableStructureSupport above.
	vimTableNavigationSupport: boolean;
	// Leader key for table-structure/table-navigation commands. false
	// (default) = Space; true = backslash. Only has an effect once one of
	// those is on — a preference, not an on/off feature of its own.
	vimLeaderUseBackslash: boolean;
	// Always-visible 3-tab bar (settings.ts's renderQsaFrame) — this selects
	// which one is currently showing. 'general' = For everyone (no Vim/Emacs
	// knowledge needed), 'vim' = Vim mode, 'emacs' = macOS (Emacs) style.
	activeSettingsTab: 'general' | 'vim' | 'emacs';
	// Whether the settings tab has already auto-switched to the Vim tab, on
	// the theory that a Vim-mode user wants to land there first, in response
	// to Obsidian's own "Vim key bindings" core setting being on. Fires at
	// most once ever, so it never fights a user's own subsequent manual tab
	// choice.
	vimAutoExpandDone: boolean;
}

const DEFAULT_SETTINGS: UniversalCursorHotkeysSettings = {
	visualLineMovement: true,
	smartHomeStandard: true,
	smartHomeAdvanced: true,
	smartJoin: false,
	crossRowNavigation: true,
	cjkDoubleClickWordSelect: true,
	qsaDisplacedCommands: [],
	qsaIndividualVisible: false,
	qsaCursorMovementVisible: true,
	qsaEditingVisible: true,
	qsaOtherHotkeysVisible: true,
	qsaTableStructureVisible: false,
	qsaTableNavVisible: false,
	qsaDisplacedVisible: true,
	vimHlSupport: true,
	vimJkSupport: true,
	vimJoinSupport: true,
	vimCaretSupport: true,
	vimWordSupport: true,
	vimGgSupport: true,
	vimDisplayLineSupport: true,
	vimEolSupport: true,
	vimTableStructureSupport: false,
	vimTableNavigationSupport: false,
	vimLeaderUseBackslash: false,
	activeSettingsTab: 'general',
	vimAutoExpandDone: false,
};


export default class universalCursorHotkeysPlugin extends Plugin {

	settings: UniversalCursorHotkeysSettings;

	private readonly TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/;
	// Lines of margin above/below cursor for recenter-top-bottom top/bottom positions.
	private readonly RECENTER_TOP_BOTTOM_MARGIN_LINES = 2;

	vimSupport: VimSupport;

	private isKillChaining: boolean = false;
	private isDispatchingKill: boolean = false;
	private killCache: string = '';
	private _recenterStep = 0; // 0=center, 1=top, 2=bottom

	async onload() {
		await this.loadSettings();
		this.vimSupport = new VimSupport(this);
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
			id: 'cursor-top',
			name: 'TOP',
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.jumpToBufferEdge(editor, false)
			}
		});

		this.addCommand({
			id: 'cursor-bottom',
			name: 'BOTTOM',
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.jumpToBufferEdge(editor, true)
			}
		});

		this.addCommand({
			id: 'word-right',
			name: 'Word right',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveCursorWord(editor, true)
			}
		});

		this.addCommand({
			id: 'word-left',
			name: 'Word left',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveCursorWord(editor, false)
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
			id: 'transpose-chars',
			name: 'Transpose chars',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				this.transposeChars(editor);
			}
		});

		this.addCommand({
			id: 'undo',
			name: 'Undo',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				editor.undo();
			}
		});

		this.addCommand({
			id: 'redo',
			name: 'Redo',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				editor.redo();
			}
		});

		// Table navigation — shares its implementation with the Vim leader-key
		// commands of the same name (tx/tX/th/tj/tk/tl, see table-navigation.ts)
		// rather than duplicating the logic; this file already implements
		// TableNavHost (isLinePartOfTable/getBeginningOfLinePosition/
		// crossTableRowForCell are all defined below), so `this` is passed
		// directly. No recommended hotkey, same as Redo above — these are
		// opt-in via Settings → Hotkeys / the Quick setup assistant, not bound
		// by default.
		this.addCommand({
			id: 'table-cell-left',
			name: 'Move to cell left',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (editor.inTableCell) jumpAdjacentCell(editor, this, 'h');
			}
		});

		this.addCommand({
			id: 'table-cell-right',
			name: 'Move to cell right',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (editor.inTableCell) jumpAdjacentCell(editor, this, 'l');
			}
		});

		this.addCommand({
			id: 'table-cell-down',
			name: 'Move to cell below',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (editor.inTableCell) jumpAdjacentCell(editor, this, 'j');
			}
		});

		this.addCommand({
			id: 'table-cell-up',
			name: 'Move to cell above',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (editor.inTableCell) jumpAdjacentCell(editor, this, 'k');
			}
		});

		this.addCommand({
			id: 'table-exit-down',
			name: 'Exit table below',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (editor.inTableCell) exitTable(editor, this, true);
			}
		});

		this.addCommand({
			id: 'table-exit-up',
			name: 'Exit table above',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (editor.inTableCell) exitTable(editor, this, false);
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
			id: 'copy-region',
			name: 'Copy region',
			editorCallback: (editor: Editor) => {
				this.copyRegion(editor);
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
			id: 'kill-word-left',
			name: 'Kill word left',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.killWord(editor, false);
			}
		});

		this.addCommand({
			id: 'kill-word-right',
			name: 'Kill word right',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.killWord(editor, true);
			}
		});

		this.addCommand({
			id: 'uppercase-word',
			name: 'Uppercase word',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.transformWord(editor, s => s.toUpperCase());
			}
		});

		this.addCommand({
			id: 'lowercase-word',
			name: 'Lowercase word',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.transformWord(editor, s => s.toLowerCase());
			}
		});

		this.addCommand({
			id: 'capitalize-word',
			name: 'Capitalize word',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.transformWord(editor, s => universalCursorHotkeysPlugin.capitalizeText(s));
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
				if (!update.docChanged && !update.selectionSet) return;
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
			})
		);

		this.registerEditorExtension(
			EditorView.mouseSelectionStyle.of(
				cjkWordSelectionStyle(() => this.settings.cjkDoubleClickWordSelect)
			)
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

		this.vimSupport.setup();
	}

	onunload() {
		this.vimSupport.teardown();
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
			const startOfCell = getStartOfCellContent(line, cursor.ch);
			const endOfCell = getEndOfCellContent(line, cursor.ch);
			if (startOfCell === endOfCell || cursor.ch <= startOfCell) {
				this.moveToLeftCellEnd(editor);
			} else {
				editor.exec('goLeft');
			}
			return;
		}

		if (this.isLivePreviewMode() && cursor.ch === 0 && cursor.line > 0
				&& this.isPositionInTable(editor, cursor.line - 1, 1)) {
			const targetLine = cursor.line - 1;
			const lineText   = editor.getLine(targetLine);
			const lastCell   = getRightmostCellIndex(lineText);
			const endCh      = getEndOfCellContentByCellIndex(lineText, lastCell);
			this.setCursorViaCm(editor, targetLine, endCh);
			return;
		}
		editor.exec('goLeft');
	}


	private moveCursorRight(editor: Editor) {
		const cursor = editor.getCursor();

		if (editor.inTableCell) {
			const line = editor.getLine(cursor.line);
			const endOfCell = getEndOfCellContent(line, cursor.ch);
			if (cursor.ch >= endOfCell) {
				this.moveToRightCellStart(editor);
			} else {
				editor.exec('goRight');
			}
			return;
		}

		if (this.isLivePreviewMode() && cursor.ch >= editor.getLine(cursor.line).length
				&& this.isPositionInTable(editor, cursor.line + 1, 1)) {
			this.moveCursorDownIntoTable(editor);
			return;
		}
		editor.exec('goRight');
	}


	// Alt-F / Alt-B — forward-word/backward-word. forward=true lands the caret
	// right after the found word's last character (mirroring Emacs's own
	// "forward-word always stops at a word end" convention); forward=false
	// lands right before the found word's first character. See
	// moveCursorWordInTable/moveCursorWordPlainText further below for the two
	// underlying search strategies (table cell vs. everything else).
	private moveCursorWord(editor: Editor, forward: boolean) {
		if (editor.inTableCell) {
			this.moveCursorWordInTable(editor, forward);
			return;
		}
		this.moveCursorWordPlainText(editor, forward);
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
		const info = getInCellLineInfo(line, cursor.ch);
		if (!info) return;

		if (info.isEmpty || cursor.ch <= info.startOfInCellLine) {
			if (info.lineType === 'single' || info.lineType === 'first') {
				this.moveToLeftCellEndSourceMode(editor);
			}
			return;
		}

		const bounds = getCellBounds(line, cursor.ch);
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
			const targetCh = getChByCellIndex(line, 0);
			if (targetCh !== -1) editor.setCursor({ line: cursor.line, ch: targetCh });
			return;
		}

		const info = getInCellLineInfo(line, cursor.ch);
		if (!info) return;

		if (info.isEmpty || cursor.ch >= info.endOfInCellLine) {
			if (info.lineType === 'single' || info.lineType === 'last') {
				this.moveToRightCellStartSourceMode(editor);
			} else if (cursor.ch > info.endOfInCellLine) {
				// 'first' or 'middle' with cursor strictly inside <br> text: skip to next segment's end.
				const brLen = line.slice(info.endOfInCellLine).match(/^<[bB][rR]>([ \t]*)/)?.[0].length ?? 0;
				if (brLen > 0) {
					const nextInfo = getInCellLineInfo(line, info.endOfInCellLine + brLen);
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

	// Bare native goUp/goDown can silently drop the live SelectionRange.goalColumn
	// when clamped at a document boundary (cursor already on the first/last
	// line, so the command can't actually move it) — @codemirror/commands still
	// returns a fresh selection for the identical position, but without the
	// goalColumn field, discarding the column a later table re-entry depends on
	// (computeRowCrossPixelGoal reads it straight off this same field). Confirmed
	// via direct logging: pressing goDown at EOF measured goalColumn going from
	// a real pixel value to undefined despite the cursor not moving at all.
	// Restores the pre-call goalColumn onto the post-call selection whenever the
	// position provably didn't change and the command itself didn't set its own.
	private execPreservingGoalColumn(editor: Editor, command: 'goUp' | 'goDown'): void {
		const cm = editor.cm;
		const beforeCursor = editor.getCursor();
		const beforeGoal = cm?.state?.selection?.main?.goalColumn;
		editor.exec(command);
		if (beforeGoal === undefined || !cm?.state) return;
		const afterCursor = editor.getCursor();
		if (afterCursor.line !== beforeCursor.line || afterCursor.ch !== beforeCursor.ch) return;
		const main = cm.state.selection.main;
		if (main.goalColumn !== undefined) return;
		cm.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(main.head, main.assoc, undefined, beforeGoal)]) });
	}

	private moveCursorUp(editor: Editor) {
		const cursor = editor.getCursor();

		if (cursor.line === 0 || !this.isLivePreviewMode()) {
			this.execPreservingGoalColumn(editor, 'goUp');
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

		if (this.isLineSkippableWidget(editor.getLine(cursor.line - 1))) {
			this.setCursorViaCm(editor, cursor.line - 1, 0);
			return;
		}

		this.execPreservingGoalColumn(editor, 'goUp');
	}


	private moveCursorDown(editor: Editor) {
		const cursor = editor.getCursor();

		if (!this.isLivePreviewMode()) {
			this.execPreservingGoalColumn(editor, 'goDown');
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

		if (nextIdx < editor.lineCount() && this.isLineSkippableWidget(editor.getLine(nextIdx))) {
			this.setCursorViaCm(editor, nextIdx, 0);
			return;
		}

		this.execPreservingGoalColumn(editor, 'goDown');
	}


	//===========================================================================
	// Ctrl-P/N table entry helpers
	//===========================================================================

	// Handles goUp when the cursor is inside a table cell in Live Preview mode.
	private moveCursorUpInTable(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const startOfCellContent = getStartOfCellContent(line, cursor.ch);
		const cellIndex = getCellIndex(line, cursor.ch);
		const eoc = getEndOfCellContent(line, cursor.ch);
		// Captured once, before anything below crosses a row — see
		// computeRowCrossPixelGoal's own doc comment.
		const pixelGoal = this.computeRowCrossPixelGoal(editor);

		// Empty cell: no navigable content, so go directly to the previous row.
		if (startOfCellContent === eoc) {
			this.setCursorToPrevRow(editor, cellIndex);
			this.placeAtBottomVL(editor, pixelGoal);
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
					// Carry the live goalColumn through — EditorSelection.cursor's
					// own 4th param, dropped if omitted (confirmed via
					// @codemirror/state's own type: cursor(pos, assoc?, bidiLevel?,
					// goalColumn?)). Without this, the very next editor.exec('goUp')
					// below (CM6's native cursorLineUp) sees no goalColumn on this
					// fresh selection and computes a brand-new one from wherever
					// this dispatch's own position happens to be — silently
					// resetting whatever wide goal the up/down chain was carrying.
					// This fix condition (VL wrap-point left edge) is true on
					// essentially every visit to a blank in-cell sub-line (no
					// content to be anywhere but the edge), which is why the loss
					// showed up specifically when crossing blank lines within a
					// cell, not on plain-text blank lines or row crossings (which
					// go through a different goal-tracking path entirely).
					const goalColumn = innerBeforeGoUp.state.selection.main.goalColumn;
					innerBeforeGoUp.dispatch({
						selection: EditorSelection.create([EditorSelection.cursor(h, 1, undefined, goalColumn)]),
					});
				}
			}
		}

		editor.exec('goUp');

		const cursorAfter = editor.getCursor();
		if (cursorAfter.line !== cursor.line) {
			// goUp moved to a different logical line (previous table row or outside table).
			if (editor.inTableCell) {
				const targetCh = getChByCellIndex(editor.getLine(cursorAfter.line), cellIndex);
				if (targetCh !== -1) {
					this.setCursorViaCm(editor, cursorAfter.line, targetCh);
				}
			}
			this.placeAtBottomVL(editor, pixelGoal);
			return;
		}

		// goUp stayed on the same logical line.
		if (cursor.ch <= startOfCellContent) {
			// Was at cell start -> go to previous row.
			this.setCursorToPrevRow(editor, cellIndex);
			this.placeAtBottomVL(editor, pixelGoal);
			return;
		}

		if (cursorAfter.ch === startOfCellContent) {
			// goDown from VL1 start in a non-wrapped cell lands at VL1 end (= originalCh),
			// which causes the goDown probe in handleCellStartSnap to give a false case-b.
			// Detect this directly: if cursor was at end of cell content, it's VL1 end
			// of a non-wrapped cell -> go to previous row without probing.
			const endOfCellContent = getEndOfCellContent(line, cursor.ch);
			if (cursor.ch >= endOfCellContent) {
				// VL1 end of non-wrapped cell -> go to previous row.
				this.setCursorToPrevRow(editor, cellIndex);
				this.placeAtBottomVL(editor, pixelGoal);
			} else {
				this.handleCellStartSnap(editor, cursor.line, cursor.ch, cellIndex, pixelGoal, innerHeadBeforeGoUp);
			}
		}
		// else: goUp moved within the cell to the visual line above - done.
	}


	// Handles goUp when the cursor is on the line directly below a table in Live Preview mode.
	//
	// Always lands in the leftmost cell (cellIndex 0) — like Vim's own gj/gk
	// table entry (scheduleDisplayLineEntry), no pixel-to-cell resolution is
	// attempted (Obsidian's Live Preview table widget gives the outer view no
	// per-character position info for an unfocused row, so there's no way to
	// tell which cell a column falls under before landing in one). Once
	// landed, though, the column *within* that cell is preserved — same
	// gj/gk-mirroring shape as the rest of this feature: a rough landing at
	// cellIndex 0 first, then placeAtBottomVL's own pixelGoal threading
	// refines the horizontal position against the now-mounted, now-real
	// inner view (see computeRowCrossPixelGoal's own doc comment).
	private moveCursorUpIntoTable(editor: Editor) {
		const cursor = editor.getCursor();
		// Captured before crossing, while editor.activeCM is still the outer
		// (plain-text) view.
		const pixelGoal = this.computeRowCrossPixelGoal(editor);
		// Only enter the table if on VL1; if on VL2+, a regular goUp suffices.
		editor.exec('goUp');
		if (editor.getCursor().line === cursor.line) {
			// VL2+: goUp moved within visual lines, result already applied.
			return;
		}
		// VL1: goUp moved to the table's last row; reposition to the bottom-left cell.
		const targetLine = cursor.line - 1;
		const targetCh = getChByCellIndex(editor.getLine(targetLine), 0);
		if (targetCh !== -1) {
			editor.setCursor({ line: targetLine, ch: targetCh });
		}
		this.placeAtBottomVL(editor, pixelGoal);
	}


	// Handles goDown when the cursor is inside a table cell in Live Preview mode.
	private moveCursorDownInTable(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = getCellIndex(line, cursor.ch);
		const eoc = getEndOfCellContent(line, cursor.ch);
		// Captured once, before anything below crosses a row — see
		// computeRowCrossPixelGoal's own doc comment.
		const pixelGoal = this.computeRowCrossPixelGoal(editor);

		// Empty cell: no navigable content, so go directly to the next row.
		if (getStartOfCellContent(line, cursor.ch) === eoc) {
			this.setCursorToNextRow(editor, cellIndex);
			this.applyRowCrossGoalColumn(editor, pixelGoal);
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
					// Carry the live goalColumn through — see moveCursorUpInTable's
					// own identical fix and doc comment for why.
					const goalColumn = inner.state.selection.main.goalColumn;
					inner.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(head, 1, undefined, goalColumn)]) });
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
			this.applyRowCrossGoalColumn(editor, pixelGoal);
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
				this.applyRowCrossGoalColumn(editor, pixelGoal);
			}
			return;
		}

		if (after.ch === cursor.ch) {
			// Complete no-op: nothing below (file-end).
			this.setCursorToNextRow(editor, cellIndex);
			this.applyRowCrossGoalColumn(editor, pixelGoal);
			return;
		}

		const eocAfter = getEndOfCellContent(line, after.ch);
		if (after.ch >= eocAfter) {
			if (isOnLastVL) {
				// Was already on VL_N: goDown clipped in place → exit to next row.
				this.setCursorToNextRow(editor, cellIndex);
				this.applyRowCrossGoalColumn(editor, pixelGoal);
			}
			// Was on VL_N-1: goDown moved to VL_N and clipped to eoc → VL advance, stay.
			return;
		}

		// ch moved within cell: soft-wrap VL advance.
	}


	// Handles goDown when the cursor is on the line directly above a table in Live Preview mode.
	//
	// Always lands in the leftmost cell (cellIndex 0) — confirmed live
	// (2026-08-27/28) that the outer CM6 view has no per-character position
	// info for an unfocused table row (fully replaced by the Live Preview
	// table widget: posAtCoords at varying x all resolved to the identical
	// offset), so there's no way to tell which cell a column falls under
	// before landing in one — same as Vim's own gj/gk table entry
	// (scheduleDisplayLineEntry), which has the identical restriction for
	// the identical reason. Once landed, though, the column *within* that
	// cell is preserved via applyRowCrossGoalColumn's own pixelGoal
	// threading, refined against the now-mounted, now-real inner view —
	// mirroring gj/gk's own "rough landing, then refine" two-step shape.
	private moveCursorDownIntoTable(editor: Editor) {
		const cursor = editor.getCursor();
		// Captured before crossing, while editor.activeCM is still the outer
		// (plain-text) view.
		const pixelGoal = this.computeRowCrossPixelGoal(editor);
		const targetCh = getChByCellIndex(editor.getLine(cursor.line + 1), 0);
		editor.setCursor({ line: cursor.line + 1, ch: targetCh });
		this.applyRowCrossGoalColumn(editor, pixelGoal);
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
		const cellIndex = getCellIndex(line, cursor.ch);

		if (cellIndex > 0) {
			// Same row: move to left cell's end
			const targetCh = getEndOfCellContentByCellIndex(line, cellIndex - 1);
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
		const rightmostIndex = getRightmostCellIndex(targetLineText);
		const targetCh = getEndOfCellContentByCellIndex(targetLineText, rightmostIndex);
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
		const cellIndex = getCellIndex(line, cursor.ch);
		const lastCellIndex = getRightmostCellIndex(line);

		if (cellIndex < lastCellIndex) {
			// Same row: move to right cell's start
			const targetCh = getChByCellIndex(line, cellIndex + 1);
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
			while (exitLine < editor.lineCount() && this.isPositionInTable(editor, exitLine, 1, true)) {
				exitLine++;
			}
			if (exitLine >= editor.lineCount()) {
				editor.replaceRange('\n', { line: exitLine - 1, ch: editor.getLine(exitLine - 1).length });
			}
			this.setCursorViaCm(editor, exitLine, 0);
			return;
		}
		// Next row: leftmost cell start
		const targetCh = getChByCellIndex(editor.getLine(targetLine), 0);
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
		const cellIndex = getCellIndex(line, cursor.ch);

		if (cellIndex > 0) {
			const targetCh = getEndOfCellContentByCellIndex(line, cellIndex - 1);
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
		const rightmostIndex = getRightmostCellIndex(targetLineText);
		const targetCh = getEndOfCellContentByCellIndex(targetLineText, rightmostIndex);
		if (targetCh !== -1) {
			editor.setCursor({ line: targetLine, ch: targetCh });
		}
	}


	private moveToRightCellStartSourceMode(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = getCellIndex(line, cursor.ch);
		const lastCellIndex = getRightmostCellIndex(line);

		if (cellIndex < lastCellIndex) {
			const targetCh = getChByCellIndex(line, cellIndex + 1);
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
		const targetCh = getChByCellIndex(editor.getLine(targetLine), 0);
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
	// fromLine defaults to the live cursor (all existing Ctrl-P callers); Vim's
	// multi-row crossing passes an explicit line to walk multiple rows without
	// moving the real cursor between steps.
	private getPrevRowLine(editor: Editor, fromLine: number = editor.getCursor().line): number {
		// fromLine - 1 doesn't exist when the table's own header row is the
		// document's first line — same bounds guard getPrevRowLineSourceMode
		// already has. Without it, isPositionInTable/getLine(-1) throws
		// ("Invalid line number 0 in N-line document", CM6's own 1-indexed
		// line() call underneath) — a real, reproducible crash pressing k on
		// such a header row.
		if (fromLine <= 0) return -1;
		return this.computePrevRowLine(
			fromLine,
			this.isPositionInTable(editor, fromLine - 1, 1, true),
			editor.getLine(fromLine - 1),
		);
	}


	// Returns the line number of the next table data row.
	// Returns -1 when the current row is the last row (caller should go outside the table).
	// fromLine defaults to the live cursor — see getPrevRowLine's own note.
	private getNextRowLine(editor: Editor, fromLine: number = editor.getCursor().line): number {
		const nextLineExists = fromLine + 1 < editor.lineCount();
		const lineAfterNextInTable = fromLine + 2 < editor.lineCount()
			&& this.isPositionInTable(editor, fromLine + 2, 1, true);
		return this.computeNextRowLine(
			fromLine,
			nextLineExists && this.isPositionInTable(editor, fromLine + 1, 1, true),
			editor.getLine(fromLine + 1),
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
	// fromLine defaults to the live cursor (all existing Ctrl-P callers); Vim's
	// multi-row crossing passes its own walked-to line, since by the time this
	// runs the real cursor hasn't moved yet (see crossTableRowForCell).
	private setCursorToPrevRow(editor: Editor, cellIndex: number, fromLine: number = editor.getCursor().line) {
		const targetLine = this.getPrevRowLine(editor, fromLine);

		if (targetLine === -1) {
			// Header row: go outside table — but only if there's a line above to
			// go to. When the table's own header row is the document's first
			// line, fromLine - 1 doesn't exist; unlike setCursorToNextRow's own
			// "append a blank line at EOF" symmetric fix for the last-row case,
			// there's no equivalent "prepend a line" convention here, so this
			// just stays put (matches real vim: k on the document's first line
			// is a no-op) instead of dispatching to an invalid negative line
			// (previously landed the cursor at an unrelated position).
			if (fromLine > 0) this.setCursorViaCm(editor, fromLine - 1, 0);
			return;
		}
		const targetCh = getChByCellIndex(editor.getLine(targetLine), cellIndex);
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
	// fromLine defaults to the live cursor — see setCursorToPrevRow's own note.
	private setCursorToNextRow(editor: Editor, cellIndex: number, fromLine: number = editor.getCursor().line) {
		const targetLine = this.getNextRowLine(editor, fromLine);

		if (targetLine === -1) {
			// Last data row: exit below, skipping any remaining table rows (e.g. delimiter).
			let exitLine = fromLine + 1;
			while (exitLine < editor.lineCount() && this.isPositionInTable(editor, exitLine, 1, true)) {
				exitLine++;
			}
			if (exitLine >= editor.lineCount()) {
				editor.replaceRange('\n', { line: exitLine - 1, ch: editor.getLine(exitLine - 1).length });
			}
			this.setCursorViaCm(editor, exitLine, 0);
			return;
		}
		const targetCh = getChByCellIndex(editor.getLine(targetLine), cellIndex);
		if (targetCh !== -1) {
			this.setCursorViaCm(editor, targetLine, targetCh);
		}
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
		pixelGoal: number | null,
		innerHeadBeforeGoUp?: number,
	) {
		const inner = editor.activeCM;
		if (innerHeadBeforeGoUp !== undefined && inner && inner !== editor.cm) {
			const vl1Coords = inner.coordsAtPos(inner.state.selection.main.head);
			// side=-1: innerHeadBeforeGoUp may sit exactly on a VL wrap boundary
			// (the right edge of VL1 is the same raw offset as the left edge of
			// VL2). Without forcing a side, coordsAtPos falls back to its own
			// default (the start of the line *after* the boundary, i.e. VL2),
			// silently misreporting a genuine VL1-right-edge position as VL2 —
			// confirmed live (2026-08-28, via direct coordsAtPos logging): a
			// same-offset query returned VL2's own y instead of VL1's, causing
			// this to wrongly conclude "already VL2+, stay" for a cursor that
			// was actually on VL1 and should cross to the row above. -1
			// matches "the end of the line this position terminates" — the
			// correct interpretation for the right-edge case this originalCh
			// capture is meant to represent (mirrors the same assoc<0 "already
			// correctly placed at VL_N's own right edge" reasoning the
			// assoc-correction block right above this function's own call site
			// already relies on).
			const originalCoords = inner.coordsAtPos(innerHeadBeforeGoUp, -1);
			if (vl1Coords && originalCoords) {
				if (originalCoords.top > vl1Coords.top + 2) {
					// VL2+ left edge: cursor already at VL1 start — nothing to do.
					return;
				}
				// VL1 middle: go to previous row.
				this.setCursorToPrevRow(editor, cellIndex);
				this.placeAtBottomVL(editor, pixelGoal);
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
			this.placeAtBottomVL(editor, pixelGoal);
		}
	}


	// Move to the bottom visual line synchronously if the inner view is already
	// mounted, otherwise defer via scheduleBottomVisualLine. `pixelGoal`
	// (moveCursorUpInTable's row-crossing goal column, or null/omitted for the
	// unrelated moveCursorUpIntoTable caller) is applied right after each of
	// this function's own two completion points, rather than polled
	// independently, so it can't race against them.
	private placeAtBottomVL(editor: Editor, pixelGoal: number | null = null) {
		const inner = editor.activeCM;
		if (inner && inner !== editor.cm) {
			// Check cursor position (not content end) for on-screen detection:
			// when entering a cell from an adjacent row, the cursor start (ch=cellStart)
			// is always on-screen even if the cell content end is off-screen.
			// moveToBottomVisualLineOfCell handles the off-screen content end via goDown fallback.
			if (inner.coordsAtPos(inner.state.selection.main.head)) {
				this.moveToBottomVisualLineOfCell(editor);
				this.applyRowCrossGoalColumnSync(editor, pixelGoal);
				return;
			}
			this.scheduleBottomVisualLine(editor, pixelGoal);
			return;
		}
		// No distinct inner view: the crossing exited the table entirely (not
		// "not yet mounted" — the outer document view is always already
		// mounted). moveToBottomVisualLineOfCell is cell-specific and doesn't
		// apply here; just re-seed the preserved column directly against the
		// now-current outer-view landing (refineDisplayLineColumn's own
		// outer-view branch handles this — see its doc comment).
		this.applyRowCrossGoalColumnSync(editor, pixelGoal);
	}


	// Schedules moveToBottomVisualLineOfCell for the next event loop tick.
	// Used after synchronous cursor placement to let the DOM settle first.
	private scheduleBottomVisualLine(editor: Editor, pixelGoal: number | null = null) {
		if (this._inScrollPage) return;
		activeWindow.setTimeout(() => {
			if (editor.inTableCell) {
				this.moveToBottomVisualLineOfCell(editor);
				this.applyRowCrossGoalColumnSync(editor, pixelGoal);
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
		const endOfCellContent = getEndOfCellContent(line, cursor.ch);

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


	// Reads the pixel-x "goal column" to preserve across a table row-crossing
	// (or table entry from plain text), straight off CM6's own native
	// SelectionRange.goalColumn — the same field @codemirror/commands'
	// cursorLineUp/cursorLineDown maintain, which is why intra-cell goUp/
	// goDown already preserve column "for free" (see handleCellStartSnap's
	// own "CM6 goal-column memory" comment). No new plugin-owned tracking:
	// typing/clicking dispatch a fresh selection with no goalColumn set, so a
	// later read here naturally falls back to the live coordsAtPos position —
	// the same reset-for-free behavior real Vim/Emacs curswant semantics
	// need. Must be called BEFORE the crossing happens, while the source view
	// (an inner cell view, or the outer plain-text view when entering a
	// table fresh — see moveCursorUpIntoTable/moveCursorDownIntoTable) is
	// still the active one. editor.activeCM already resolves to whichever of
	// those is current, so no inner-vs-outer branching is needed here.
	private computeRowCrossPixelGoal(editor: Editor): number | null {
		const view = editor.activeCM;
		const goalColumn = view.state.selection.main.goalColumn;
		const rect = view.contentDOM.getBoundingClientRect();
		if (goalColumn !== undefined) return rect.left + goalColumn;
		// side=-1: head may sit exactly on a visual-line wrap boundary (e.g.
		// right after a trailing space that wraps) — without it, CM6 defaults
		// to reporting the *next* visual line's start (x = rect.left) instead
		// of the true end of the line the cursor is visually on.
		const coords = view.coordsAtPos(view.state.selection.main.head, -1);
		return coords ? coords.left : null;
	}

	// Re-seeds the destination cell's own inner view with the preserved goal
	// column, once the row-crossing has already landed. Reuses
	// refineDisplayLineColumn (vim-mode gj/gk's own step-2 primitive)
	// unmodified for the horizontal correction itself, then re-reads
	// editor.activeCM afterward — refineDisplayLineColumn dispatches via
	// setCursorViaCm, which can trigger Obsidian's own inner-view (re)focus —
	// and writes goalColumn onto that settled view's own selection, same
	// same-position-dispatch-for-metadata idiom the assoc-fix blocks in
	// moveCursorUpInTable/moveCursorDownInTable already use. Assumes the
	// destination inner view is already mounted; callers that aren't sure
	// (moveCursorDownInTable has no existing placement step to piggyback on)
	// go through applyRowCrossGoalColumn instead. No-op if there's no goal to
	// preserve. Re-seeds onto editor.activeCM — the inner cell view, or the
	// outer document view if the crossing exited the table entirely — since
	// goalColumn still matters in plain text: without writing it here, a
	// landing on a blank line (content-less, so refineDisplayLineColumn can
	// only place the cursor at ch 0) would otherwise leave nothing for a
	// later native goDown/goUp to inherit, silently forgetting the preserved
	// column the moment the crossing passes through any zero-width line.
	//
	// The actual correction is deferred two animation frames past whatever
	// tick this is called on. Confirmed live (2026-08-28, via a dedicated
	// frame-by-frame diagnostic, not guessed) that entering a table cell from
	// plain text triggers an Obsidian-internal cell-focus reconciliation that
	// silently resets the cursor back to that cell's own line-start,
	// asynchronously, one animation frame after the frame this function's
	// own (otherwise-correct) dispatches land on — i.e. calling this
	// synchronously wins the position for exactly one frame and then loses
	// it to that reset. Landed empirically on two frames of deferral (the
	// reset was fully settled by the second frame in every observed run);
	// there is no public Obsidian API to await that reconciliation directly.
	private applyRowCrossGoalColumnSync(editor: Editor, pixelGoal: number | null) {
		if (pixelGoal === null) return;
		activeWindow.requestAnimationFrame(() => {
			activeWindow.requestAnimationFrame(() => {
				this.refineDisplayLineColumn(editor, pixelGoal, true);
				const view = editor.activeCM;
				const head = view.state.selection.main.head;
				const rect = view.contentDOM.getBoundingClientRect();
				// assoc=-1: head may sit exactly on a visual-line wrap boundary —
				// this function's own result always represents "the rightmost
				// point of the line being refined that still fits pixelGoal", so
				// it must always render as that line's own right edge, never as
				// the start of the next visual line. Confirmed live (2026-08-28):
				// reusing whatever assoc the selection already carried defaulted
				// to rendering a same-cell row-crossing's clamped landing as the
				// destination's *second* visual line's left edge instead of its
				// first (intended) visual line's right edge.
				view.dispatch({
					selection: EditorSelection.create([
						EditorSelection.cursor(head, -1, undefined, pixelGoal - rect.left),
					]),
				});
			});
		});
	}

	// Sync-or-deferred wrapper for moveCursorDownInTable's row-crossings,
	// mirroring scheduleBottomVisualLine's own "mounted? apply now : defer one
	// tick" idiom (moveCursorUpInTable's own crossings instead piggyback on
	// placeAtBottomVL's existing split — see its own call sites below).
	private applyRowCrossGoalColumn(editor: Editor, pixelGoal: number | null) {
		if (pixelGoal === null) return;
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) {
			// Exited the table entirely — the outer document view is always
			// already mounted (no "not yet mounted" concern like a fresh
			// inner cell view), so this applies immediately, no defer needed.
			this.applyRowCrossGoalColumnSync(editor, pixelGoal);
			return;
		}
		if (inner.coordsAtPos(inner.state.selection.main.head)) {
			this.applyRowCrossGoalColumnSync(editor, pixelGoal);
			return;
		}
		if (this._inScrollPage) return;
		activeWindow.setTimeout(() => {
			if (editor.inTableCell) {
				this.applyRowCrossGoalColumnSync(editor, pixelGoal);
			}
		}, 0);
	}


	//===========================================================================
	// Infrastructure
	//===========================================================================

	private isPositionInTable(editor: Editor, line: number, ch: number, alreadyInTable = false): boolean {
		if (alreadyInTable) return editor.getLine(line).trimStart().startsWith('|');
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


	//===========================================================================
	// Page down / Page up
	//===========================================================================

	private pageDown(editor: Editor) { this.scrollPage(editor,  1); }
	private pageUp  (editor: Editor) { this.scrollPage(editor, -1); }

	// Returns the viewport-relative Y coordinate of the current browser cursor.
	// Works inside LP table cells (unlike cm.coordsAtPos). Returns null when off-screen.
	// view: when provided, used as a precise fallback via coordsAtPos when the selection
	// rect has zero height (e.g. cursor at ch=0 of the first line).
	private getCursorScreenY(view?: EditorView): number | null {
		const sel = activeWindow.getSelection();
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

	// Page down/up: move cursor one screen, then restore cursor screen position.
	// Uses moveCursorDown/Up to traverse tables and callouts correctly.
	private _inScrollPage    = false;
	private _scrollPageGenId = 0;

	// scrollPage operates in four phases:
	//   1. Record prevScreenY — cursor's Y within the scroll area before any movement.
	//   2. Loop — advance cursor one page via moveCursorDown/Up, measuring real pixel progress.
	//   3. Scroll — call scrollToCursorAtY to restore the cursor to prevScreenY on screen.
	//   4. Watch — detect LP cursor normalization and re-run scrollToCursorAtY after it settles.
	private scrollPage(editor: Editor, direction: 1 | -1) {
		const cm = editor.cm;
		if (!cm) return;

		const target = cm.scrollDOM.clientHeight;

		// Phase 1: record cursor's scroll-area-relative Y (viewport Y minus scrollRect.top).
		// Used by phase 3 to restore the cursor to the same on-screen position after scrolling.
		const scrollRect  = cm.scrollDOM.getBoundingClientRect();
		const rawY        = this.getCursorScreenY(cm);
		const prevScreenY = rawY !== null ? rawY - scrollRect.top : cm.scrollDOM.clientHeight / 2;

		// Phase 1.5: scan the traversal range for special content that needs the step loop.
		// Tables and callouts require moveCursorDown/Up for correct cell/line navigation.
		// Embeds can have unpredictable heights that confuse delta tracking.
		// Scan from the cursor to ~1 page ahead (not just cm.viewport) so that tables just
		// outside the rendered viewport but within the scroll distance are also detected.
		const estimatedLines = Math.ceil(target / cm.defaultLineHeight) + 5;
		const curLine  = editor.getCursor().line;
		const docLines = cm.state.doc.lines;
		const scanFrom = direction > 0
			? cm.state.selection.main.head
			: cm.state.doc.line(Math.max(1, curLine - estimatedLines)).from;
		const scanTo   = direction > 0
			? cm.state.doc.line(Math.min(docLines, curLine + estimatedLines)).to
			: cm.state.selection.main.head;
		let hasSpecialInView = false;
		syntaxTree(cm.state).iterate({
			from: scanFrom, to: scanTo,
			enter: (node) => {
				if (hasSpecialInView) return false;
				if (node.name.includes('HyperMD-table') || node.name.includes('HyperMD-quote')) {
					hasSpecialInView = true; return false;
				}
			},
		});
		// String-based fallback: syntax tree node names vary by Obsidian version/mode.
		if (!hasSpecialInView) {
			const scanText = cm.state.doc.sliceString(scanFrom, scanTo);
			hasSpecialInView = /^\|/m.test(scanText)           // table rows
				|| /^>/m.test(scanText)                        // blockquotes / callouts
				|| /^!(?:\[\[|\[)/m.test(scanText);            // embeds
		}
		// Phase 2: move cursor one page.
		if (!hasSpecialInView) {
			// Fast path: single CM6 native command (no intermediate scrollIntoView calls).
			if (direction > 0) {
				cursorPageDown(cm);
			} else {
				cursorPageUp(cm);
			}
		} else {
			// Slow path: step loop handles tables, callouts, and variable-height widgets.
			// scrollIntoView each step keeps the cursor on-screen so table navigation
			// functions (which rely on coordsAtPos) work correctly.
			const getDocY = (): number | null => {
				const y = this.getCursorScreenY(cm);
				return y !== null ? y + cm.scrollDOM.scrollTop : null;
			};
			const moveCursor = direction > 0
				? (e: Editor) => this.moveCursorDown(e)
				: (e: Editor) => this.moveCursorUp(e);
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
				activeWindow.setTimeout(() => {
					if (this._scrollPageGenId !== genId) return;
					cm.dispatch({ selection: { anchor: savedHead, head: savedHead } });
					this.scrollToCursorAtY(editor, prevScreenY);
				}, 100);
				return;
			}
			if (++frames < 5) activeWindow.requestAnimationFrame(watchNormalization);
		};
		activeWindow.requestAnimationFrame(watchNormalization);
	}


	// preserveActiveSelection (default false, unchanged behavior for every
	// existing caller): when true and the live selection is currently
	// non-empty (anchor !== head — e.g. Vim's Visual/Visual Line mode),
	// keeps that anchor and only moves head to the new position, instead of
	// collapsing to a bare point. A collapsed-point dispatch reads to Vim as
	// "the user cleared the selection externally", silently dropping back
	// to Normal mode — this is what gg/G's own jumpToDocumentLine opts into
	// (see its own call site) to fix that without changing this method's
	// behavior for its many other callers (Ctrl-N/P, row/cell crossings,
	// etc.), none of which are expected to run mid-selection today.
	private setCursorViaCm(editor: Editor, line: number, ch: number, preserveActiveSelection = false) {
		const targetInTable = this.isPositionInTable(editor, line, ch);
		const cm = editor.cm;
		const pos = editor.posToOffset({ line, ch });
		// Short-circuits before touching cm.state at all when
		// preserveActiveSelection is false (the default) — every other
		// caller's own test mocks only stub what setCursorViaCm actually
		// used to read.
		const current = preserveActiveSelection ? cm.state.selection.main : null;
		const anchor = current && current.anchor !== current.head ? current.anchor : pos;
		cm.dispatch({ selection: { anchor, head: pos }, userEvent: 'move' });
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
				activeWindow.requestAnimationFrame(() => {
					const inner = editor.activeCM;
					if (inner && inner !== cm && !inner.hasFocus) {
						inner.focus();
					}
				});
			}
		}
	}

	// Explicit scroll-into-view follow-up, same idiom jumpToDocumentLine/
	// jumpToBufferEdge already use for their own big jumps: setCursorViaCm
	// itself never requests one (left as-is to avoid changing behavior for
	// its many other, already-working callers, which are all short,
	// already-on-screen hops). A cross-line word jump can travel arbitrarily
	// far — skipping many blank lines, or exiting a table into more blank
	// lines beyond it — and can land outside the current viewport, so it
	// needs its own separate follow-up dispatch to the position it already
	// landed on (read back from the live selection rather than recomputed,
	// since setCursorViaCm may have already applied a further correction on
	// top of the original landing).
	private scrollCursorIntoView(editor: Editor) {
		const cm = editor.cm;
		const pos = cm.state.selection.main.head;
		cm.dispatch({ selection: { anchor: pos }, scrollIntoView: true, userEvent: 'move' });
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
	// Public: also used by vim-support.ts's Vim J (joinLines) override, via the
	// VimSupportHost bridge.
	getBeginningOfLinePosition(line: string, ch: number): number {

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
			if (result === null) result = line.match(/^\[\^.+?\]:\s*/); // Footnotes (Adv.)
		}
		if (result === null) result = line.match(/^\s*\d+[.)]\s/); // Ordered lists
		if (result === null) result = line.match(/^\s*([-+*]\s(\[.\]\s)?)?/); // Indents, Unordered lists, Task lists

		if (result !== null && result[0].length < ch) return bqEnd + result[0].length;
		return 0;
	}


	private isTableLineSourceMode(line: string): boolean {
		const trimmed = line.trimEnd();
		return trimmed.startsWith('|') && trimmed.endsWith('|');
	}


	private isLineSkippableWidget(lineText: string): boolean {
		// Obsidian embed ![[...]] or Markdown image ![...](...) starting at column 0
		if (/^!(\[\[|\[)/.test(lineText)) return true;
		// Thematic break --- / *** / ___ (3+ identical chars, optional trailing spaces)
		return /^[-*_]{3,}\s*$/.test(lineText);
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
			const start = getStartOfCellContent(line, cursor.ch);
			const end   = getEndOfCellContent(line, cursor.ch);
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
		if (editor.inTableCell) {
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
		const bounds = getCellBounds(lineText, cursor.ch);

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
	// Transpose chars
	//===========================================================================

	// Swaps the two grapheme clusters immediately before [from, to). Cluster
	// boundaries are found via findClusterBreak — the same primitive CM6's own
	// transposeChars uses internally — so this stays surrogate-pair/grapheme
	// safe without needing our own Unicode logic. No-op if fewer than two
	// clusters are available. Cursor stays at `to` (unlike the mid-content
	// case, there's nothing further right to advance into).
	private swapLastTwoInRange(view: EditorView, from: number, to: number) {
		const text = view.state.doc.sliceString(from, to);
		const localEnd = text.length;
		const localMid = findClusterBreak(text, localEnd, false);
		const localFrom = findClusterBreak(text, localMid, false);
		if (localFrom === localMid) return; // fewer than two clusters

		const insert = text.slice(localMid, localEnd) + text.slice(localFrom, localMid);
		view.dispatch({
			changes: { from: from + localFrom, to: from + localEnd, insert },
			selection: { anchor: from + localEnd },
			userEvent: 'move.character',
		});
	}

	// Table-aware wrapper around CM6's own transposeChars: cell/<br>-segment
	// boundaries are hard stops (unlike Word right/case conversion) since
	// transpose swaps arbitrary adjacent characters — if either one happened to
	// be `|` or part of a `<br>` tag, the swap would corrupt table structure.
	// At a segment's own end, falls back to swapLastTwoInRange instead of a
	// plain no-op, matching real Emacs's end-of-line special case.
	private transposeChars(editor: Editor) {
		if (editor.inTableCell) {
			this.transposeCharsInTableLP(editor);
			return;
		}

		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		const inSourceTable = !this.isLivePreviewMode() && this.isTableLineSourceMode(lineText);
		if (inSourceTable) {
			const info = getInCellLineInfo(lineText, cursor.ch);
			if (info) {
				this.transposeCharsInTableSource(editor, info);
				return;
			}
		}

		const cm = editor.cm;
		if (!cm) return;
		if (cursor.ch === lineText.length) {
			const cmLine = cm.state.doc.line(cursor.line + 1);
			this.swapLastTwoInRange(cm, cmLine.from, cmLine.to);
			return;
		}
		cmTransposeChars(cm);
	}

	private transposeCharsInTableLP(editor: Editor) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) return;

		const head = inner.state.selection.main.head;
		const subLine = inner.state.doc.lineAt(head);

		if (head === subLine.from) return; // segment start: no-op, no special case here
		if (head === subLine.to) {
			this.swapLastTwoInRange(inner, subLine.from, subLine.to);
			return;
		}
		cmTransposeChars(inner);
	}

	private transposeCharsInTableSource(editor: Editor, info: InCellLineInfo) {
		const cursor = editor.getCursor();
		if (info.isEmpty || cursor.ch <= info.startOfInCellLine) return; // segment start: no-op

		const cm = editor.cm;
		if (!cm) return;

		if (cursor.ch >= info.endOfInCellLine) {
			const cmLine = cm.state.doc.line(cursor.line + 1);
			this.swapLastTwoInRange(cm, cmLine.from + info.startOfInCellLine, cmLine.from + info.endOfInCellLine);
			return;
		}
		cmTransposeChars(cm);
	}


	//===========================================================================
	// Kill line (Ctrl-K)
	//===========================================================================

	private killLine(editor: Editor) {
		const lineText = editor.getLine(editor.getCursor().line);
		const inSourceTable = !this.isLivePreviewMode() && this.isTableLineSourceMode(lineText);

		if (editor.inTableCell) {
			this.killLineInTableLP(editor);
			return;
		}

		if (inSourceTable) {
			const info = getInCellLineInfo(lineText, editor.getCursor().ch);
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
			activeWindow.setTimeout(() => {
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
			activeWindow.setTimeout(() => {
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


	//===========================================================================
	// Kill word left / right (Emacs Alt-Backspace / Alt-D)
	//===========================================================================

	// The boundary that matters is the CELL (a different cell/row is a
	// different document), not the <br>-segment (that's just how one cell's
	// own single continuous piece of text represents a line break — the
	// in-cell equivalent of a plain-text newline). So killWordInTableLP/
	// SourceMode below cross <br>-segments freely within the same cell
	// (mirroring killWordNonTable's own free line-crossing, and mirroring
	// moveCursorWordInTable's own walkSegments-based in-cell walk), and only
	// no-op once genuinely at the cell's own first/last segment edge. Word-
	// boundary lookup reuses the same findWordSpanOnLine primitive Word
	// right/left (moveCursorWord) already use.
	private killWord(editor: Editor, forward: boolean) {
		const lineText = editor.getLine(editor.getCursor().line);
		const inSourceTable = !this.isLivePreviewMode() && this.isTableLineSourceMode(lineText);

		if (editor.inTableCell) {
			this.killWordInTableLP(editor, forward);
			return;
		}

		if (inSourceTable) {
			const info = getInCellLineInfo(lineText, editor.getCursor().ch);
			if (info) {
				this.killWordInTableSourceMode(editor, forward, info);
				return;
			}
		}

		this.killWordNonTable(editor, forward);
	}

	// Plain text: unlike the table branches below, free to cross line
	// boundaries (mirroring moveCursorWordPlainText's own plain-text search)
	// — a plain-text document has no structural segment boundary to respect,
	// and real Emacs's own kill-word/backward-kill-word don't stop at line
	// breaks either. Bug fixed here: the search itself doesn't know what a
	// table is, so without the isPositionInTable guard below it would happily
	// treat an adjacent table row's raw Markdown (e.g. a leading `|`) as
	// ordinary word/punctuation text — corrupting the table by killing into
	// it. Stop at the boundary instead, matching every other kill command in
	// this file (same "isPositionInTable(..., 1)" check moveCursorRight/Left
	// already use for the identical plain-text-to-table edge).
	private killWordNonTable(editor: Editor, forward: boolean) {
		const cursor = editor.getCursor();
		let lineNum = cursor.line;
		let ch = cursor.ch;
		let target: { line: number; ch: number } | null = null;
		for (;;) {
			const lt = editor.getLine(lineNum);
			const span = findWordSpanOnLine(lt, ch, forward);
			if (span) {
				target = { line: lineNum, ch: forward ? span.to : span.from };
				break;
			}
			const nextLine = forward ? lineNum + 1 : lineNum - 1;
			if (nextLine < 0 || nextLine >= editor.lineCount()) break;
			if (this.isPositionInTable(editor, nextLine, 1)) break;
			lineNum = nextLine;
			ch = forward ? 0 : editor.getLine(lineNum).length;
		}
		if (!target) return;

		const from = forward ? cursor : target;
		const to   = forward ? target : cursor;
		const text = editor.getRange(from, to);

		this.updateKillCache(text, !forward);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		this.isDispatchingKill = true;
		editor.replaceRange('', from, to);
		this.isDispatchingKill = false;
		this.isKillChaining = true;
	}

	// LP table cell: mirrors killLineInTableLP's own inner-view-coordinate
	// approach (each <br>-segment is its own doc line there). Unlike the old
	// version of this method, walks forward/backward across further
	// in-cell doc lines (via inner.state.doc.line — the inner-view
	// equivalent of killWordNonTable's own editor.getLine walk) whenever the
	// current segment has no word left, only stopping once nextLineNum falls
	// outside [1, inner.state.doc.lines] — i.e. genuinely at the cell's own
	// first/last segment, not just any segment edge. The final deletion
	// range can span the \n between segments (the inner view's own <br>
	// representation — see moveByWords' identical comment elsewhere in this
	// codebase), so no separate <br>-stripping step is needed here the way
	// Kill Line's own <br>-removal branch requires.
	private killWordInTableLP(editor: Editor, forward: boolean) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) return;

		const head = inner.state.selection.main.head;
		let subLine = inner.state.doc.lineAt(head);
		let localHead = head - subLine.from;
		let target: number | null = null;

		for (;;) {
			const span = findWordSpanOnLine(subLine.text, localHead, forward);
			if (span) {
				target = subLine.from + (forward ? span.to : span.from);
				break;
			}
			const nextLineNum = forward ? subLine.number + 1 : subLine.number - 1;
			if (nextLineNum < 1 || nextLineNum > inner.state.doc.lines) break;
			subLine = inner.state.doc.line(nextLineNum);
			localHead = forward ? 0 : subLine.text.length;
		}
		if (target === null) return;

		const from = forward ? head : target;
		const to   = forward ? target : head;
		const text = inner.state.doc.sliceString(from, to);

		this.updateKillCache(text, !forward);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		this.isDispatchingKill = true;
		inner.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from }, userEvent: 'delete' });
		this.isDispatchingKill = false;
		this.isKillChaining = true;
	}

	// Source Mode table cell: mirrors killLineInTableSourceMode's own
	// getInCellLineInfo-scoped approach, but — like the LP branch above —
	// walks further in-cell lines via walkSegments (the same primitive
	// moveCursorWordInTable already uses for its own in-cell walk) whenever
	// the current segment has no word left, stopping only once walkSegments
	// reports steps===0 (genuinely the cell's own first/last segment).
	// Reads/writes outer (raw markdown) coordinates, so — unlike the LP
	// branch above — normalizeKillText is needed (escaped \| in the raw
	// source); a crossed <br> tag is included in the raw slice and
	// normalized to \n the same way a crossed-segment kill already handles
	// it elsewhere in this file.
	private killWordInTableSourceMode(editor: Editor, forward: boolean, info: InCellLineInfo) {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);

		let segInfo = info;
		let localCh = cursor.ch - segInfo.startOfInCellLine;
		let target: number | null = null;

		for (;;) {
			const scopedText = lineText.slice(segInfo.startOfInCellLine, segInfo.endOfInCellLine);
			const span = findWordSpanOnLine(scopedText, localCh, forward);
			if (span) {
				target = segInfo.startOfInCellLine + (forward ? span.to : span.from);
				break;
			}
			const { segInfo: nextSeg, steps } = this.walkSegments(lineText, segInfo, forward, 1);
			if (steps === 0) break;
			segInfo = nextSeg;
			localCh = forward ? 0 : segInfo.endOfInCellLine - segInfo.startOfInCellLine;
		}
		if (target === null) return;

		const from = forward ? cursor.ch : target;
		const to   = forward ? target : cursor.ch;
		const text = this.normalizeKillText(lineText.slice(from, to));

		this.updateKillCache(text, !forward);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		this.isDispatchingKill = true;
		editor.replaceRange('', { line: cursor.line, ch: from }, { line: cursor.line, ch: to });
		this.isDispatchingKill = false;
		this.isKillChaining = true;
	}


	//===========================================================================
	// Uppercase word / Lowercase word / Capitalize word (Emacs Alt-U/L/C)
	//===========================================================================

	// DWIM (do-what-i-mean): a non-empty selection transforms the whole
	// selection (same validation as Copy/Kill Region — table-aware,
	// single-cell only); otherwise transforms the WHOLE word at the cursor.
	// Deliberately diverges from real Emacs's own upcase-word/downcase-word/
	// capitalize-word, which only transform from point to the word's own end
	// (e.g. "he|llo" -> "heLLO", leaving "he" untouched) — mid-word partial
	// transforms are unintuitive, and the divergence matters most visibly
	// for capitalize-word, where a partially-capitalized word looks broken.
	// Table-aware: unlike Kill word, crosses into an adjacent cell/row when
	// the current one has no further word (matching Word right/left) rather
	// than stopping — case transformation never touches non-letter
	// characters, so there's no `|`/`<br>` corruption risk the way a kill
	// has, and the design principle established for Kill word ("cell is a
	// document boundary") only exists to guard against that risk.
	private transformWord(editor: Editor, transform: (s: string) => string) {
		const from = editor.getCursor('from');
		const to = editor.getCursor('to');
		if (from.line !== to.line || from.ch !== to.ch) {
			this.transformSelection(editor, transform);
			return;
		}

		if (editor.inTableCell) {
			this.transformWordInTableLP(editor, transform);
			return;
		}

		const lineText = editor.getLine(from.line);
		const inSourceTable = !this.isLivePreviewMode() && this.isTableLineSourceMode(lineText);
		if (inSourceTable) {
			const info = getInCellLineInfo(lineText, from.ch);
			if (info) {
				this.transformWordInTableSourceMode(editor, transform, info);
				return;
			}
		}

		this.transformWordNonTable(editor, transform);
	}

	// Reuses Copy/Kill Region's own selection validation (getValidatedRegionText)
	// purely as a validity check here — its own return value is the
	// kill-cache-normalized text (<br> -> \n, \| -> |), which is exactly
	// what must NOT be written back into the document, so the actual
	// transform works off the raw, unnormalized selection text instead.
	private transformSelection(editor: Editor, transform: (s: string) => string) {
		const from = editor.getCursor('from');
		const to = editor.getCursor('to');
		if (this.getValidatedRegionText(editor) === null) return;

		if (editor.inTableCell) {
			const inner = editor.activeCM;
			if (!inner || inner === editor.cm) return;
			const innerSel = inner.state.selection.main;
			const original = inner.state.doc.sliceString(innerSel.from, innerSel.to);
			inner.dispatch({ changes: { from: innerSel.from, to: innerSel.to, insert: transform(original) }, selection: { anchor: innerSel.to }, userEvent: 'input' });
			return;
		}

		const original = editor.getRange(from, to);
		editor.replaceRange(transform(original), from, to);
		// See transformWordNonTable's identical comment: replaceRange has no
		// cursor-positioning parameter, defaults to the replaced range's own
		// start rather than its end.
		this.setCursorViaCm(editor, to.line, to.ch);
	}

	// Plain text: like moveCursorWordPlainText/killWordNonTable, crosses line
	// boundaries (including blank lines) freely, and hands off into a table
	// row reached this way instead of stopping there.
	private transformWordNonTable(editor: Editor, transform: (s: string) => string) {
		const cursor = editor.getCursor();
		let lineNum = cursor.line;
		let ch = cursor.ch;
		for (;;) {
			const lt = editor.getLine(lineNum);
			const span = findWordSpanOnLine(lt, ch, true);
			if (span) {
				const from = { line: lineNum, ch: span.from };
				const to = { line: lineNum, ch: span.to };
				const original = editor.getRange(from, to);
				editor.replaceRange(transform(original), from, to);
				// Bug fixed here: editor.replaceRange has no cursor-positioning
				// parameter of its own, so it defaults to the replaced range's
				// own start — unlike the LP-table branches below, which land
				// correctly because their raw dispatch specifies
				// selection: { anchor: to } as part of the same change. Kill
				// Line never needed this follow-up since deleting to an empty
				// string collapses from/to to the same point either way; a
				// same-length (or near enough) replace has a genuine
				// start-vs-end ambiguity replaceRange doesn't resolve on its own.
				this.setCursorViaCm(editor, lineNum, span.to);
				return;
			}
			const nextLine = lineNum + 1;
			if (nextLine >= editor.lineCount()) return;
			if (this.isPositionInTable(editor, nextLine, 1)) {
				this.continueWordTransformAfterLanding(editor, this.landInRowEdgeCellForWord(editor, nextLine, true, false, false), transform);
				return;
			}
			lineNum = nextLine;
			ch = 0;
		}
	}

	// LP table cell: like moveCursorWordInTable/killWordInTableLP, crosses
	// <br>-segments freely within the same cell, then crosses into the
	// adjacent cell/row once the cell itself is exhausted.
	private transformWordInTableLP(editor: Editor, transform: (s: string) => string) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) return;

		let head = inner.state.selection.main.head;
		let subLine = inner.state.doc.lineAt(head);
		let localHead = head - subLine.from;

		for (;;) {
			const span = findWordSpanOnLine(subLine.text, localHead, true);
			if (span) {
				const from = subLine.from + span.from;
				const to = subLine.from + span.to;
				const original = inner.state.doc.sliceString(from, to);
				inner.dispatch({ changes: { from, to, insert: transform(original) }, selection: { anchor: to }, userEvent: 'input' });
				return;
			}
			const nextLineNum = subLine.number + 1;
			if (nextLineNum > inner.state.doc.lines) break;
			subLine = inner.state.doc.line(nextLineNum);
			localHead = 0;
			head = subLine.from;
		}

		const outerCursor = editor.getCursor();
		const outerLineText = editor.getLine(outerCursor.line);
		const cellIndex = getCellIndex(outerLineText, outerCursor.ch);
		this.continueWordTransformAfterLanding(editor, this.crossTableRowForWord(editor, cellIndex, true, false, false), transform);
	}

	// Source Mode table cell: like moveCursorWordInTable/killWordInTableSourceMode
	// (the Source Mode side), walks further in-cell lines via walkSegments,
	// then crosses into the adjacent cell/row once the cell is exhausted.
	private transformWordInTableSourceMode(editor: Editor, transform: (s: string) => string, info: InCellLineInfo) {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);

		let segInfo = info;
		let localCh = cursor.ch - segInfo.startOfInCellLine;

		for (;;) {
			const scopedText = lineText.slice(segInfo.startOfInCellLine, segInfo.endOfInCellLine);
			const span = findWordSpanOnLine(scopedText, localCh, true);
			if (span) {
				const from = { line: cursor.line, ch: segInfo.startOfInCellLine + span.from };
				const to = { line: cursor.line, ch: segInfo.startOfInCellLine + span.to };
				const original = editor.getRange(from, to);
				editor.replaceRange(transform(original), from, to);
				// See transformWordNonTable's identical comment: replaceRange
				// has no cursor-positioning parameter, defaults to the
				// replaced range's own start.
				this.setCursorViaCm(editor, cursor.line, to.ch);
				return;
			}
			const { segInfo: nextSeg, steps } = this.walkSegments(lineText, segInfo, true, 1);
			if (steps === 0) break;
			segInfo = nextSeg;
			localCh = 0;
		}

		const cellIndex = getCellIndex(lineText, cursor.ch);
		this.continueWordTransformAfterLanding(editor, this.crossTableRowForWord(editor, cellIndex, true, false, false), transform);
	}

	// Shared tail for transformWordNonTable's table-entry case and
	// transformWordInTableLP/SourceMode's own cell-exhausted case: landed is
	// already sitting exactly at the target word's own start (forward=true,
	// wordEnd=false — the crossing functions' own word-START convention, no
	// +1 caret correction needed since there's no word-END involved here
	// the way Word right/left needs). Hands off to whichever branch matches
	// where the crossing actually landed — including handing back to
	// transformWordNonTable if it exited the table entirely, so a wordless
	// exit line doesn't just strand the search the way it used to for Word
	// right/left before that was fixed.
	private continueWordTransformAfterLanding(editor: Editor, landed: { line: number; ch: number } | null, transform: (s: string) => string) {
		if (!landed) return;
		if (editor.inTableCell) {
			this.transformWordInTableLP(editor, transform);
			return;
		}
		const lineText = editor.getLine(landed.line);
		const info = getInCellLineInfo(lineText, landed.ch);
		if (info) {
			this.transformWordInTableSourceMode(editor, transform, info);
		} else {
			this.transformWordNonTable(editor, transform);
		}
	}

	// CJK-aware (via getWordSpans): capitalizes each word independently
	// (first character upper, rest lower), leaving whitespace/punctuation
	// between words untouched — matches real Emacs's own capitalize-region
	// behavior for multi-word text, and naturally handles both the
	// single-word (no-selection) and multi-word (selection) cases with the
	// same function.
	private static capitalizeText(text: string): string {
		const spans = getWordSpans(text);
		let result = '';
		let last = 0;
		for (const span of spans) {
			result += text.slice(last, span.from);
			const word = text.slice(span.from, span.to);
			result += word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
			last = span.to;
		}
		result += text.slice(last);
		return result;
	}


	private normalizeKillText(text: string): string {
		return text.replace(/<[bB][rR]>/g, '\n').replace(/\\\|/g, '|');
	}


	// prepend is for backward kills (Kill word left): consecutive backward
	// kills must build the cache in the same order the text appeared in the
	// buffer, so newly killed text goes in front of what's already cached,
	// not after it — the reverse of every other (forward) kill in this file.
	private updateKillCache(text: string, prepend = false): void {
		if (!this.isKillChaining) { this.killCache = text; return; }
		this.killCache = prepend ? text + this.killCache : this.killCache + text;
	}


	// Shared by Kill Region (Ctrl-W) and Copy Region: validates the current
	// selection (non-empty; inside a table, single-cell/single-line only —
	// same constraint both commands share, see their own README docs) and
	// returns its table-normalized text, or null if the selection is empty
	// or spans something invalid (multi-row/cross-cell).
	private getValidatedRegionText(editor: Editor): string | null {
		const from = editor.getCursor('from');
		const to   = editor.getCursor('to');
		if (from.line === to.line && from.ch === to.ch) return null;

		const fromLine = editor.getLine(from.line);
		const toLine   = editor.getLine(to.line);

		const inLPTable = editor.inTableCell;
		const inSourceTable = !this.isLivePreviewMode() && (
			this.isTableLineSourceMode(fromLine) ||
			this.isTableLineSourceMode(toLine)
		);

		if (inLPTable || inSourceTable) {
			if (from.line !== to.line) return null;

			const line        = fromLine;
			const fromBounds  = getCellBounds(line, from.ch);
			const toBounds    = getCellBounds(line, to.ch);
			if (!fromBounds || !toBounds || fromBounds.open !== toBounds.open) return null;
		}

		const rawText = editor.getSelection();
		return (inLPTable || inSourceTable) ? this.normalizeKillText(rawText) : rawText;
	}


	//===========================================================================
	// Copy region (Alt-W)
	//===========================================================================

	// Non-destructive kill-ring-save: same validation/normalization as Kill
	// Region, breaks any in-progress Kill Line chain the same way Kill Region
	// does (a copy is not a "kill", so it shouldn't silently append to a
	// pending kill-line sequence), but never mutates the editor — the
	// selection stays exactly as the user left it, matching a plain Copy.
	private copyRegion(editor: Editor) {
		const text = this.getValidatedRegionText(editor);
		if (text === null) return;

		this.isKillChaining = false;
		this.updateKillCache(text);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
	}


	//===========================================================================
	// Kill region (Ctrl-W)
	//===========================================================================

	private killRegion(editor: Editor) {
		const from = editor.getCursor('from');
		const to   = editor.getCursor('to');
		const text = this.getValidatedRegionText(editor);
		if (text === null) return;

		const inLPTable = editor.inTableCell;
		const fromLine  = editor.getLine(from.line);

		this.isKillChaining = false;
		this.updateKillCache(text);
		navigator.clipboard.writeText(this.killCache).catch(() => {});

		if (!inLPTable) {
			editor.replaceRange('', from, to);
			return;
		}

		const line = fromLine;
		let prefix = line.slice(0, from.ch);
		let suffix = line.slice(to.ch);
		const bounds = getCellBounds(line, from.ch);
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
			activeWindow.setTimeout(() => {
				if (scrollEl && savedScroll !== undefined) scrollEl.scrollTop = savedScroll;
				this.setCursorViaCm(editor, targetLine, targetCh);
			}, 0);
		} else {
			editor.replaceSelection(text);
		}
	}


	//===========================================================================
	// VimSupportHost bridge implementation
	//
	// Methods vim-support.ts calls through the VimSupportHost duck-typed interface,
	// grouped here (rather than scattered near whichever existing method each one
	// happens to reuse) since more are expected as table-entry/multi-row-crossing
	// support is added. These exist only because vim-support.ts deliberately does
	// not import main.ts (file-split risk-isolation) but still needs to reuse
	// private, stateful methods below (setCursorViaCm depends on this._inScrollPage
	// and dispatches to CM6 directly) that can't be pure-function-extracted the way
	// table-cell-utils.ts's string helpers were.
	//===========================================================================

	// See vim-support.ts's scheduleRowCrossing. Reuses the same row-finding logic
	// Ctrl-N/P rely on (getNextRowLine/getPrevRowLine), but lands on the target
	// cell's first/last <br>-segment at goalCh, rather than always at
	// cell-content-start — Vim's j/k need the column preserved across the row
	// boundary, which Ctrl-N/P's own setCursorToNextRow/PrevRow don't do.
	// Returns the outer {line, ch} landed on (or null if it couldn't compute one),
	// so vim-support.ts can re-sync its own goal-column continuity cache against
	// the actual post-crossing position — see scheduleRowCrossing's own comment
	// for why that resync is necessary.
	// overshoot is how many logical lines (row-crossings and/or <br>-segments
	// combined) still need to be consumed beyond the current cell's own range —
	// see vim-support.ts's moveByLines for how it's computed. Walks row by row
	// (via getNextRowLine/PrevRowLine, so delimiter rows stay invisible exactly
	// as they are for Ctrl-N/P), consuming each row's cellIndex's own <br>-segment
	// count, until the remainder fits within one row — then lands there via
	// landInCellSegment. All reads only; no view is touched until that final landing.
	crossTableRowForCell(editor: unknown, cellIndex: number, forward: boolean, goalCh: number, overshoot: number): { line: number; ch: number } | null {
		const e = editor as Editor;
		const startLine = forward ? this.getNextRowLine(e) : this.getPrevRowLine(e);
		if (startLine === -1) {
			// Exiting the table entirely without crossing any row first (the
			// current cell is already the last/first row). fromLine = the live
			// cursor, since no walk has happened yet.
			return this.exitTableWithColumn(e, cellIndex, forward, goalCh, e.getCursor().line, overshoot);
		}
		return this.walkTableRows(e, cellIndex, forward, startLine, overshoot, goalCh);
	}

	// See vim-support.ts's own VimSupportHost.getAdjacentRowLine doc comment
	// for why this exists as its own read-only check, separate from
	// crossTableRowForCell above.
	getAdjacentRowLine(editor: unknown, forward: boolean): number {
		const e = editor as Editor;
		return forward ? this.getNextRowLine(e) : this.getPrevRowLine(e);
	}

	// See vim-support.ts's own VimSupportHost.setCursorAcrossTableBoundary doc
	// comment for why table-navigation.ts's own exitTable needs this instead
	// of the plain EditorBridge setCursor used elsewhere. exitTable's own
	// jumps can cross arbitrarily many lines (the whole height of a table) —
	// unlike setCursorViaCm's other, already-onscreen-range callers, this
	// needs the same explicit scroll-into-view follow-up
	// exitTableWithColumn/jumpToDocumentLine already use for their own
	// long-distance jumps (confirmed live: without it, the cursor can land
	// off-screen with no visible scroll).
	setCursorAcrossTableBoundary(editor: unknown, line: number, ch: number): void {
		const e = editor as Editor;
		this.setCursorViaCm(e, line, ch);
		const cm = e.cm;
		const pos = e.posToOffset({ line, ch });
		cm.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true, userEvent: 'move' });
	}

	// See vim-support.ts's own VimSupportHost.appendBlankLineAndLand doc
	// comment — mirrors setCursorToNextRow's own identical EOF fix.
	// preserveActiveSelection (default false, unchanged behavior for the
	// no-selection caller): same idiom as setCursorViaCm's own param — when
	// true, keeps the live selection's existing anchor and only extends head
	// through the newly inserted line, instead of collapsing to a point. See
	// jumpToDocumentLine's own call site for why this matters for gg/G.
	appendBlankLineAndLand(editor: unknown, preserveActiveSelection = false): void {
		const e = editor as Editor;
		const cm = e.cm;
		const current = preserveActiveSelection ? cm.state.selection.main : null;
		const hadActiveSelection = current !== null && current.anchor !== current.head;
		const lastLine = e.lastLine();
		e.replaceRange('\n', { line: lastLine, ch: e.getLine(lastLine).length });
		const pos = e.posToOffset({ line: lastLine + 1, ch: 0 });
		if (hadActiveSelection) {
			// Single dispatch, no setCursorViaCm call — its own default
			// collapsed-point dispatch would drop Visual mode here too.
			cm.dispatch({ selection: { anchor: current.anchor, head: pos }, scrollIntoView: true, userEvent: 'move' });
			// This dispatch is external to vim.js's own cm.operation(), so its
			// own cursorActivity handler (handleExternalSelection) reinterprets
			// it as if it came from a mouse drag: it shifts vim's own internal
			// selection model (vim.sel — a *separate* {anchor, head} vim.js
			// keeps for Visual mode, read by every operator: y/d/c/p all derive
			// their range from vim.sel, not this dispatch's own CM6 selection)
			// back by one character. Left alone, that stale vim.sel would still
			// point at the table's own last row, one line short of what's
			// actually highlighted — so a y/d/c run immediately after this
			// landing would silently miss the blank line just inserted (and a
			// delete would leave it behind, unremoved). Same technique
			// vim-support.ts's own resyncAfterDeferredMove already uses for
			// vim.state.lastHPos/lastHSPos after its own deferred moves — vim.js
			// assigns its per-view state directly onto cm.state.vim (not a
			// proper StateField), so it's writable from here too. Silently
			// skipped if vim.state.vim isn't there (defensive only — same
			// optional-chaining posture as that other call site).
			const vimState = (cm.state as unknown as { vim?: { visualMode?: boolean; sel?: { anchor: unknown; head: unknown } } }).vim;
			if (vimState?.visualMode && vimState.sel) {
				vimState.sel.anchor = e.offsetToPos(current.anchor);
				vimState.sel.head = e.offsetToPos(pos);
			}
		} else {
			this.setCursorViaCm(e, lastLine + 1, 0);
			// Same explicit scroll-into-view follow-up as
			// setCursorAcrossTableBoundary — see its own doc comment.
			cm.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true, userEvent: 'move' });
		}
	}

	// See vim-support.ts's own VimSupportHost.enterTableRowSmartHome doc
	// comment — the same enterTableAtLine + refineTableLandingForSmartHome
	// combo jumpToDocumentLine (gg/G) already uses below, including its own
	// explicit scroll-into-view follow-up (see jumpToDocumentLine's own doc
	// comment on why setCursorViaCm's underlying dispatches don't request one
	// on their own).
	enterTableRowSmartHome(editor: unknown, targetLine: number): { line: number; ch: number } | null {
		const e = editor as Editor;
		let result = this.enterTableAtLine(e, targetLine, 0, true, 0, 0);
		if (result) result = this.refineTableLandingForSmartHome(e, result);
		if (result) {
			const cm = e.cm;
			const pos = e.posToOffset(result);
			cm.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true, userEvent: 'move' });
		}
		return result;
	}

	// See vim-support.ts's own VimSupportHost.refineDisplayLineColumn doc
	// comment for the full rationale (step 2 of gj/gk's own row-crossing,
	// always preceded by a crossTableRowForCell(..., 0, 1) rough landing).
	// Re-finds the actual x=pixelGoal position on the cell's own newly-landed
	// visual line via coordsAtPos/posAtCoords (the same idiom
	// moveCursorUpInTable's/moveCursorDownInTable's own assoc-correction
	// already uses — see their own comments for why a small +9 y-offset
	// reliably samples a point within the line's own visual band), and
	// re-dispatches via setCursorViaCm — never a raw EditorView.dispatch — if
	// it differs from the rough landing. Never lets the correction change
	// which (inner) line the cursor is on; its job is purely horizontal.
	// allowLineEnd: Vim's gj/gk (the only other caller) needs Normal-mode-legal
	// clamping — the cursor may never rest past a line's last character. The
	// new Emacs Ctrl-N/P row-crossing (main.ts's own
	// applyRowCrossGoalColumnSync) is not modal and must be able to land one
	// past the last character (e.g. "shortcuts|"), so it passes true here.
	refineDisplayLineColumn(editor: unknown, pixelGoal: number, allowLineEnd = false): { line: number; ch: number } | null {
		const e = editor as Editor;
		const inner = e.activeCM;
		if (inner && inner !== e.cm) {
			const head = inner.state.selection.main.head;
			const resolved = universalCursorHotkeysPlugin.resolveSameLineOffset(inner, head, pixelGoal, allowLineEnd);
			if (resolved === null) return e.getCursor();

			// Convert the (confirmed same-line) refined inner ch back into an
			// outer {line, ch} — setCursorViaCm dispatches via the *outer*
			// document, same as every other table-cell landing in this file.
			const headLine = inner.state.doc.lineAt(head);
			const outerCursor = e.getCursor();
			const outerLineText = e.getLine(outerCursor.line);
			const segInfo = getInCellLineInfo(outerLineText, outerCursor.ch);
			if (!segInfo) return e.getCursor(); // shouldn't happen — we're inside a cell
			const targetOuterCh = segInfo.startOfInCellLine + (resolved - headLine.from);
			this.setCursorViaCm(e, outerCursor.line, targetOuterCh);
			return e.getCursor();
		}

		// No distinct inner view — either an empty cell, or (more commonly
		// here) the rough landing already exited the table entirely into
		// plain text, where there's no cell view left to refine against.
		// Correct directly against the outer view instead — same idiom, no
		// inner-to-outer ch conversion needed since outer ch is already real.
		const outer = e.cm;
		const outerCursor = e.getCursor();
		const head = e.posToOffset(outerCursor);
		const resolved = universalCursorHotkeysPlugin.resolveSameLineOffset(outer, head, pixelGoal, allowLineEnd);
		if (resolved === null) return outerCursor;
		const headLine = outer.state.doc.lineAt(head);
		this.setCursorViaCm(e, outerCursor.line, resolved - headLine.from);
		return e.getCursor();
	}

	// Obsidian internal API (not in obsidian.d.ts) — narrower than
	// settings.ts's own like-named ObsidianInternals, which also needs
	// hotkeyManager/setting/vault; this file only ever touches commands.
	executeObsidianCommand(commandId: string): boolean {
		return (this.app as unknown as { commands?: { executeCommandById?(id: string): boolean } })
			.commands?.executeCommandById?.(commandId) ?? false;
	}

	// Shared by both branches of refineDisplayLineColumn above: finds the
	// pixel-correct, same-line, offset on `view` by sampling within the
	// current line's own visual band (see refineDisplayLineColumn's own
	// comment for the +9 y-offset rationale). Returns null if no correction
	// should be applied (unresolvable, would cross a line, or unchanged).
	private static resolveSameLineOffset(view: EditorView, head: number, pixelGoal: number, allowLineEnd = false): number | null {
		const coords = view.coordsAtPos(head);
		if (!coords) return null;
		const targetPos = view.posAtCoords({ x: pixelGoal, y: coords.top + 9 }, false);
		if (targetPos === null) return null;
		const headLine = view.state.doc.lineAt(head);
		const targetLine = view.state.doc.lineAt(targetPos);
		if (targetLine.number !== headLine.number) return null;
		const maxCh = Math.max(0, headLine.length - (allowLineEnd ? 0 : 1));
		const clamped = Math.min(targetPos, headLine.from + maxCh);
		return clamped === head ? null : clamped;
	}

	// Vim's w/b/e cell-crossing. Unlike Ctrl-N/P and Vim's own j/k (which move
	// between *rows*, same column), w/b/e read a table row the same way vim
	// reads any line — linearly, left to right through the row's raw markdown
	// text. So the adjacent cell in the *same row* comes first; only once
	// that row's own leftmost/rightmost cell is exhausted does this move to
	// the next/prev row at all (landing on that row's opposite edge cell —
	// forward wraps to the next row's leftmost cell, backward to the prev
	// row's rightmost, mirroring how the raw text would read one row into the
	// next). Single cell/row crossing only (no multi-cell count precision),
	// mirroring crossTableRowForCell's own "known gap" scope cut.
	crossTableRowForWord(editor: unknown, cellIndex: number, forward: boolean, bigWord: boolean, wordEnd: boolean): { line: number; ch: number } | null {
		const e = editor as Editor;
		const currentLine = e.getCursor().line;
		const lineText = e.getLine(currentLine);
		const rightmostCellIndex = getRightmostCellIndex(lineText);

		if (forward && cellIndex < rightmostCellIndex) {
			const landed = this.landInCellSegment(e, currentLine, cellIndex + 1, true, 0, 0);
			if (!landed) return null;
			return this.refineWordLanding(e, landed, forward, bigWord, wordEnd);
		}
		if (!forward && cellIndex > 0) {
			const landed = this.landInCellSegment(e, currentLine, cellIndex - 1, false, 0, Number.MAX_SAFE_INTEGER);
			if (!landed) return null;
			return this.refineWordLanding(e, landed, forward, bigWord, wordEnd);
		}

		// Already at this row's own edge cell — cross to the next/prev row's
		// opposite edge cell (or exit the table if there is no next/prev row).
		const startLine = forward ? this.getNextRowLine(e) : this.getPrevRowLine(e);
		if (startLine === -1) {
			return this.exitTableWithWord(e, cellIndex, forward, bigWord, wordEnd, currentLine);
		}
		return this.landInRowEdgeCellForWord(e, startLine, forward, bigWord, wordEnd);
	}

	// Shared by crossTableRowForWord's own row-to-row crossing (above) and
	// moveCursorWordPlainText's table-entry case (Emacs Word right/left
	// reaching an adjacent table row from plain text) — both need the exact
	// same landing: forward enters the target row's leftmost cell (its first
	// segment), backward enters the rightmost cell (its last segment), then
	// refines to the nearest actual word boundary. targetLine is assumed
	// already known to be a real table row (crossTableRowForWord finds it via
	// getNextRowLine/PrevRowLine; the plain-text case confirms it via
	// isPositionInTable before ever calling this).
	private landInRowEdgeCellForWord(editor: Editor, targetLine: number, forward: boolean, bigWord: boolean, wordEnd: boolean): { line: number; ch: number } | null {
		const rowText = editor.getLine(targetLine);
		const targetCellIndex = forward ? 0 : getRightmostCellIndex(rowText);
		// goalCh: 0 lands at the first segment's own start (forward); a large
		// sentinel clamps to the last segment's own end (backward) — landInCellSegment's
		// own maxOffset clamp handles that, same as exitTableWithColumn's goalCh does.
		const landed = this.landInCellSegment(editor, targetLine, targetCellIndex, forward, 0, forward ? 0 : Number.MAX_SAFE_INTEGER);
		if (!landed) return null;
		return this.refineWordLanding(editor, landed, forward, bigWord, wordEnd);
	}

	// Vim's gg/G (and count-prefixed "5gg"/"5G"). explicitLine is the
	// 0-indexed absolute target line for a count-prefixed jump; null targets
	// the document's own first/last line. Checks whether the target is itself
	// a table row and, if so, reuses enterTableAtLine to land inside that
	// row's leftmost cell rather than on its raw markdown text.
	jumpToDocumentLine(editor: unknown, forward: boolean, explicitLine: number | null): { line: number; ch: number } | null {
		const e = editor as Editor;
		const cm = e.cm;
		const lastLine = e.lineCount() - 1;
		const targetLine = explicitLine !== null
			? Math.max(0, Math.min(explicitLine, lastLine))
			: (forward ? lastLine : 0);

		// Vim's own synchronous motion (moveToLineOrEdgeOfDocument, run inside
		// vim.js's own cm.operation()) already sets the CM6 selection correctly
		// for an active Visual/Visual Line selection, using vim.js's own
		// line/char-mode selection conventions (e.g. Visual Line's head at
		// end-of-line, not column 0). Any *external* dispatch we make below
		// (this method's own raw cm.dispatch calls, running outside that
		// operation) gets reinterpreted by vim.js's handleExternalSelection as
		// if it came from a mouse drag: it shifts the forward-direction
		// endpoint back by one character to match its own mouse-selection
		// convention. Since our own targetCh below targets column ~0 (not
		// Visual Line's end-of-line convention), that shift crosses the line
		// boundary backward — landing one line short of the true target. So
		// once there's an active selection to preserve, we must not
		// re-dispatch a selection at all here; only scroll (see the bottom of
		// this method) — vim.js's own already-correct state is left standing.
		const hadActiveSelection = cm.state.selection.main.anchor !== cm.state.selection.main.head;

		// Bare G (not count-prefixed — see below) landing on a table that runs
		// all the way to the document's own last line: mirror tx's own EOF fix
		// (appendBlankLineAndLand, already used for exiting a table that hits
		// EOF) instead of landing inside the table's own last row — G means
		// "reach the real end", and a table swallowing that end is the same
		// problem tx already solves. Deliberately asymmetric with gg (kept
		// as-is, no "prepend a line" equivalent, matching tx/tX's own
		// precedent) and with count-prefixed jumps ("5G"), which target a
		// specific line the user named explicitly, not "the very end" — those
		// still land inside the table normally, even if that line happens to
		// also be the document's last line.
		//
		// Also runs while a Vim selection is active (hadActiveSelection), by
		// design — confirmed against Obsidian's own native Vim mode (UCH's
		// table handling bypassed): V/v+G onto a table at true EOF selects the
		// table and moves the cursor past it, but there's no
		// real line there to land on, so Live Preview renders a glitchy,
		// full-table-height caret off to the side of the widget instead of a
		// normal one. Actually creating that trailing line (same mutation as
		// the no-selection case) gives the caret a real place to render —
		// appendBlankLineAndLand's own preserveActiveSelection param keeps the
		// selection extended through it instead of collapsing it.
		if (explicitLine === null && forward && this.isPositionInTable(e, targetLine, 1)) {
			this.appendBlankLineAndLand(e, hadActiveSelection);
			return { line: lastLine + 1, ch: 0 };
		}

		let result: { line: number; ch: number } | null;
		if (!hadActiveSelection && this.isPositionInTable(e, targetLine, 1)) {
			// gg/G always land at the *start* of the target line's content
			// (first non-blank), regardless of forward/backward — so an
			// explicit-count jump ("2gg"/"2G") landing on the same target
			// line must land identically either way. enterTableAtLine's own
			// forward param controls its delimiter-row redirect direction
			// (and which <br>-segment to land on) — hardcoding true here
			// (not the keystroke's own forward) keeps that landing consistent
			// regardless of which key was actually pressed. Skipped while a
			// Vim selection is active — see hadActiveSelection's own comment
			// above and the identical reasoning just above this block: cell-
			// precision landing is a Normal-mode-only concern (Visual Line
			// selects whole lines regardless of column; Visual mode is better
			// served by vim.js's own native selection extension across the
			// table's raw text, matching Obsidian's own native Vim mode with no
			// table-precision handling involved at all).
			result = this.enterTableAtLine(e, targetLine, 0, true, 0, 0);
			if (result) result = this.refineTableLandingForSmartHome(e, result);
		} else {
			const lineText = e.getLine(targetLine);
			// Same std/adv-aware position `^` itself uses when Smart home
			// (standard) is on; vim's own native whitespace-only skip otherwise —
			// matches moveToFirstNonWhiteSpaceCharacter's own two-path design
			// (getBeginningOfLinePosition hardcodes 0, not whitespace-skip, when
			// smartHomeStandard is off, so it can't be used unconditionally here).
			const targetCh = this.settings.smartHomeStandard
				? this.getBeginningOfLinePosition(lineText, lineText.length || 1)
				: (lineText.search(/\S/) === -1 ? lineText.length : lineText.search(/\S/));
			// See hadActiveSelection's own comment above: skip this dispatch
			// entirely while Vim's own Visual/Visual Line selection is active,
			// to avoid corrupting the state vim.js already set correctly.
			if (!hadActiveSelection) {
				this.setCursorViaCm(e, targetLine, targetCh, true);
			}
			result = { line: targetLine, ch: targetCh };
		}

		// gg/G can jump across the whole document — unlike the short,
		// already-on-screen hops setCursorViaCm's other callers make (row/
		// cell crossings), this one needs an explicit scroll-into-view.
		// setCursorViaCm itself doesn't request one (left as-is to avoid
		// changing behavior for its other, already-working callers); done as
		// its own follow-up dispatch to the same (already landed-on) position
		// instead. When there's an active selection to preserve, this dispatch
		// carries no `selection` field at all — scrollIntoView is a pure
		// StateEffect, so it can't itself trigger vim.js's
		// handleExternalSelection (which only reacts to an actual selection
		// change) the way re-asserting {anchor, head} would (see
		// hadActiveSelection's own comment above).
		if (result) {
			const pos = e.posToOffset(result);
			if (hadActiveSelection) {
				cm.dispatch({ effects: EditorView.scrollIntoView(pos), userEvent: 'move' });
			} else {
				cm.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true, userEvent: 'move' });
			}
		}
		return result;
	}

	// gg/G's own table-landing refinement: enterTableAtLine's shared landing
	// (via landInCellSegment) only ever skips leading whitespace
	// (getInCellLineInfo's own startOfInCellLine) — never Smart Home, unlike
	// gg/G's plain-text landing just above, which respects it. landInCellSegment
	// is also shared by crossTableRowForCell (Ctrl-N/P and Vim j/k's own
	// goal-column-preserving row crossing), which must NOT gain Smart Home, so
	// this can't be baked into that shared primitive itself — mirrors
	// refineWordLanding's own "land roughly via the shared primitive, then
	// refine for this caller's own needs" shape instead. No-op when Smart Home
	// (standard) is off; when it's on but the segment's own content has
	// nothing for it to skip past (the common case — table cells rarely start
	// with list/checkbox/blockquote/heading syntax), targetCh just comes back
	// equal to landed.ch and no re-dispatch happens.
	private refineTableLandingForSmartHome(editor: Editor, landed: { line: number; ch: number }): { line: number; ch: number } {
		if (!this.settings.smartHomeStandard) return landed;
		const lineText = editor.getLine(landed.line);
		const segInfo = getInCellLineInfo(lineText, landed.ch);
		if (!segInfo) return landed;
		const segmentText = lineText.slice(segInfo.startOfInCellLine, segInfo.endOfInCellLine);
		const targetCh = segInfo.startOfInCellLine + this.getBeginningOfLinePosition(segmentText, segmentText.length || 1);
		if (targetCh !== landed.ch) {
			this.setCursorViaCm(editor, landed.line, targetCh);
		}
		return { line: landed.line, ch: targetCh };
	}

	// Alt-Shift-,/. (Emacs beginning-of-buffer/end-of-buffer). Deliberately
	// separate from jumpToDocumentLine (Vim's gg/G, left untouched) — real
	// vim's gg/G always land at a line's own first non-blank character
	// (optionally Smart-Home-enhanced), but real Emacs has no such concept
	// for buffer edges: it's the true edge of the buffer, full stop. So
	// forward=false (TOP) lands at literal ch=0 of the first line, no skip
	// of any kind; forward=true (BOTTOM) lands at the end of the last line.
	// Table-aware, but asymmetrically so, matching the same "true edge"
	// framing: TOP lands in the leftmost cell's own content start (there's
	// no position "before" that inside a rendered cell — already the true
	// edge there), while BOTTOM lands in the *rightmost* cell's own content
	// *end* (the actual end of that row's raw text) — unlike gg/G, which
	// always targets the leftmost cell regardless of direction.
	jumpToBufferEdge(editor: unknown, forward: boolean): { line: number; ch: number } | null {
		const e = editor as Editor;
		const targetLine = forward ? e.lineCount() - 1 : 0;

		let result: { line: number; ch: number } | null;
		if (this.isPositionInTable(e, targetLine, 1)) {
			result = forward
				? this.enterTableAtLine(e, targetLine, getRightmostCellIndex(e.getLine(targetLine)), false, Number.MAX_SAFE_INTEGER, 0)
				: this.enterTableAtLine(e, targetLine, 0, true, 0, 0);
		} else {
			const lineText = e.getLine(targetLine);
			const targetCh = forward ? lineText.length : 0;
			this.setCursorViaCm(e, targetLine, targetCh);
			result = { line: targetLine, ch: targetCh };
		}

		// Same reasoning as jumpToDocumentLine's own identical follow-up: a
		// buffer-edge jump can land far outside the current viewport.
		if (result) {
			const cm = e.cm;
			const pos = e.posToOffset(result);
			cm.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true, userEvent: 'move' });
		}
		return result;
	}

	// Full (syntax-tree-based) table-membership check, same one Ctrl-N/P's own
	// moveCursorUpIntoTable/DownIntoTable use to detect table *entry* specifically
	// (as opposed to the cheap text-based shortcut used elsewhere for "already
	// confirmed inside a table"). Exposed as-is for vim-support.ts's
	// scheduleTableEntry to confirm its own cheap pre-filter before committing to
	// an entry landing.
	isLinePartOfTable(editor: unknown, line: number, ch: number): boolean {
		return this.isPositionInTable(editor as Editor, line, ch);
	}

	// Lands on cellIndex's <br>-segment at goalCh, remaining logical lines in from
	// targetLine's own first/last segment — used when vim-support.ts's
	// moveByLines' plain-text walk reaches a table row (remaining is however much
	// of the original repeat count is left to consume from there). cellIndex is
	// vim-support.ts's goalCellIndex (falls back to 0, matching Ctrl-N/P's own
	// moveCursorUpIntoTable/DownIntoTable convention, when there's no remembered
	// cell to return to).
	enterTableAtLine(editor: unknown, targetLine: number, cellIndex: number, forward: boolean, goalCh: number, remaining: number): { line: number; ch: number } | null {
		const e = editor as Editor;
		let line = targetLine;
		if (this.TABLE_DELIMITER_REGEX.test(e.getLine(line))) {
			// Shouldn't be reachable now that moveByLines' plain-text walk moves
			// one line at a time (it always reaches the header/last-data-row
			// before it could reach a delimiter) — kept as a defensive fallback
			// in case some other path still lands here directly. Without this
			// redirect, landInCellSegment would treat the delimiter's "---" text
			// as if it were real cell content. Redirect to the nearest real row
			// instead: forward → the first data row (line + 1); backward → the
			// header row (line - 1).
			line = forward ? line + 1 : line - 1;
			if (line < 0 || line >= e.lineCount() || !this.isPositionInTable(e, line, 1, true)) return null;
		}
		return this.walkTableRows(e, cellIndex, forward, line, remaining, goalCh);
	}

	// Shared by crossTableRowForCell and enterTableAtLine: starting at startLine
	// (a row already known to be part of the table, whose own cellIndex segments
	// haven't been consumed yet), consumes `remaining` logical lines — first
	// against startLine's own <br>-segment count, then (if that's not enough)
	// walking further rows via getNextRowLine/PrevRowLine — landing via
	// landInCellSegment once remaining fits within one row's segments. All reads
	// only until that final landing; exits the table via exitTableWithColumn if
	// it runs out of rows first, deferring to exitTableWithColumn — which
	// itself falls back to landing on this walk's own last-reached row
	// (fromLine) when even that exit hits a genuine dead end (the table's own
	// edge row is also the document's own edge, e.g. a table starting at the
	// document's very first line).
	private walkTableRows(editor: Editor, cellIndex: number, forward: boolean, startLine: number, remaining: number, goalCh: number): { line: number; ch: number } | null {
		let targetLine = startLine;
		let fromLine = startLine;
		for (;;) {
			const segCount = this.countCellSegments(editor.getLine(targetLine), cellIndex);
			if (remaining <= segCount) {
				return this.landInCellSegment(editor, targetLine, cellIndex, forward, remaining - 1, goalCh);
			}
			remaining -= segCount;
			fromLine = targetLine;
			const nextLine = forward ? this.getNextRowLine(editor, fromLine) : this.getPrevRowLine(editor, fromLine);
			if (nextLine === -1) {
				return this.exitTableWithColumn(editor, cellIndex, forward, goalCh, fromLine, remaining);
			}
			targetLine = nextLine;
		}
	}

	// Exits the table entirely (fromLine's next/prev row doesn't exist). Reuses
	// the existing exit logic (line-finding, delimiter-row skipping, EOF newline
	// insertion) as-is via setCursorToNextRow/PrevRow, then separately corrects
	// the column — those hardcode ch=0, which is fine for Ctrl-N/P but loses
	// goalCh for Vim. This follow-up move stays within the (now plain-text) line
	// just landed on, so it doesn't cross any view boundary and carries none of
	// the row-crossing crash risk. fromLine is passed explicitly rather than
	// relying on setCursorToNextRow/PrevRow's own live-cursor default, since the
	// real cursor hasn't moved from its original (pre-walk) position yet.
	//
	// setCursorToPrevRow (backward) can itself be a genuine no-op — when
	// fromLine is the document's own first line, there's no line above the
	// table to exit to at all, so it deliberately stays put (see its own
	// comment) rather than dispatching to an invalid negative line. Comparing
	// against the position from *before* calling setCursorToPrevRow/NextRow
	// detects that case.
	//
	// Bug fixed here: when detected, this used to return null unconditionally
	// — correct for a plain (non-walked) call, since fromLine there already
	// equals the live cursor's own row (before === landed for that reason
	// alone; see the still-passing regression test below). But
	// walkTableRows' own multi-row callers never move the real cursor while
	// walking (fromLine is a purely local variable) — so on that path,
	// fromLine can be several rows away from the real (stale) cursor, which
	// the walk had already legitimately reached before hitting this dead end.
	// Returning null there silently discarded that progress instead of
	// landing where the walk had actually gotten to. Only fall back to
	// landing on fromLine's own edge segment (the same "no further walk"
	// convention landInCellSegment already uses elsewhere) when fromLine
	// differs from where the walk started (`before`) — a genuine multi-row
	// walk that dead-ended, matching real vim's own "count overshoots past
	// the document's edge, land at the edge" behavior. When fromLine equals
	// before.line (no walk happened), preserve the exact old no-op untouched.
	//
	// remaining is the total logical-line count this exit itself must
	// consume, matching landInCellSegment's own "remaining=1 lands on this
	// very edge, no further walk" convention: landing on the immediate exit
	// line consumes 1, and any leftover (remaining > 1) continues as
	// ordinary plain-text lines beyond the table, clamped at the document's
	// own edge if it runs out first. Bug fixed here: a count-prefixed
	// crossing/entry that outlived the table's own rows used to silently
	// drop this leftover the moment exitTableWithColumn took over — walking
	// the *table's* own rows respected the count, but the plain-text
	// continuation beyond the table's own exit line did not.
	private exitTableWithColumn(editor: Editor, cellIndex: number, forward: boolean, goalCh: number, fromLine: number, remaining: number): { line: number; ch: number } | null {
		const before = editor.getCursor();
		if (forward) this.setCursorToNextRow(editor, cellIndex, fromLine);
		else this.setCursorToPrevRow(editor, cellIndex, fromLine);
		const landed = editor.getCursor();
		if (landed.line === before.line && landed.ch === before.ch) {
			if (fromLine !== before.line) {
				return this.landInCellSegment(editor, fromLine, cellIndex, forward, 0, goalCh);
			}
			return null;
		}
		let line = landed.line;
		let stepsLeft = remaining - 1;
		while (stepsLeft > 0) {
			const nextLine = forward ? line + 1 : line - 1;
			if (nextLine < 0 || nextLine >= editor.lineCount()) break;
			line = nextLine;
			stepsLeft -= 1;
		}
		const landedLineText = editor.getLine(line);
		const targetCh = Math.min(goalCh, Math.max(0, landedLineText.length - 1));
		if (line !== landed.line || targetCh !== landed.ch) {
			this.setCursorViaCm(editor, line, targetCh);
		}
		// A table's own last/first row can itself sit right at the screen's
		// edge, with the plain-text line just beyond it entirely off-screen —
		// unlike crossing *between* rows (movement that stays within an
		// already-onscreen table), exiting can land the cursor somewhere the
		// viewport was never scrolled to show. setCursorViaCm (used just above
		// and by setCursorToNextRow/PrevRow themselves) deliberately doesn't
		// request a scroll — see jumpToDocumentLine's own identical comment on
		// why — so this follows the same pattern it uses: an explicit
		// follow-up dispatch to the already-landed (and possibly just-
		// corrected) position, requesting scrollIntoView only here.
		const cm = editor.cm;
		const pos = editor.posToOffset({ line, ch: targetCh });
		cm.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true, userEvent: 'move' });
		return { line, ch: targetCh };
	}

	// Word-motion's own table-exit — same setCursorToNextRow/PrevRow reuse as
	// exitTableWithColumn, but refines to the nearest word afterward instead
	// of clamping to a remembered goal column (Vim's w/b/e have no goal-column
	// concept; landing at the cell's own content-start/end isn't precise
	// enough since real vim always lands exactly on a word).
	private exitTableWithWord(editor: Editor, cellIndex: number, forward: boolean, bigWord: boolean, wordEnd: boolean, fromLine: number): { line: number; ch: number } | null {
		if (forward) this.setCursorToNextRow(editor, cellIndex, fromLine);
		else this.setCursorToPrevRow(editor, cellIndex, fromLine);
		return this.refineWordLanding(editor, editor.getCursor(), forward, bigWord, wordEnd);
	}

	// Narrows a landing at a cell's/line's own content-start/end (from
	// crossTableRowForWord/exitTableWithWord) down to the actual nearest word
	// on that line, re-dispatching only if the refined position differs.
	// Bug fixed here: scanning the *whole* raw row line (rather than just the
	// landed <br>-segment) always found the leftmost cell's first word,
	// regardless of which cell was actually landed on — getInCellLineInfo
	// scopes the scan to the landed cell/segment's own [start, end) range;
	// null (plain text, not a table row at all) falls back to the whole line.
	// wordEnd (Vim's `e`/`ge`) lands on the first/last word's own *end*,
	// matching w/b's own word-*start* convention only when wordEnd is false.
	private refineWordLanding(editor: Editor, landed: { line: number; ch: number }, forward: boolean, bigWord: boolean, wordEnd: boolean): { line: number; ch: number } {
		const lineText = editor.getLine(landed.line);
		const segInfo = getInCellLineInfo(lineText, landed.ch);
		const scopeStart = segInfo ? segInfo.startOfInCellLine : 0;
		const scopeEnd = segInfo ? segInfo.endOfInCellLine : lineText.length;
		const scopedText = lineText.slice(scopeStart, scopeEnd);
		const targetCh = scopeStart + this.findWordBoundaryOnLine(scopedText, forward, bigWord, wordEnd);
		if (targetCh !== landed.ch) {
			this.setCursorViaCm(editor, landed.line, targetCh);
		}
		return { line: landed.line, ch: targetCh };
	}

	// A from-a-clean-edge-only scan (always starts at this scoped segment's
	// own start or end, never mid-word — refineWordLanding always hands it a
	// fresh landing position), so unlike vim-support.ts's own w/b/e port
	// (which must resolve from an arbitrary mid-line position, and needs a
	// char-by-char scan for that), this can just take the first/last span
	// directly from the shared word-segmentation.ts module.
	private findWordBoundaryOnLine(lineText: string, forward: boolean, bigWord: boolean, wordEnd: boolean): number {
		const spans = bigWord ? getBigWordSpans(lineText) : getWordSpans(lineText);
		if (forward) {
			const first = spans[0];
			if (!first) return 0; // entirely whitespace — vim's own "empty line is a word" convention
			return wordEnd ? first.to - 1 : first.from;
		}
		const last = spans[spans.length - 1];
		if (!last) return Math.max(0, lineText.length - 1);
		return wordEnd ? last.to - 1 : last.from;
	}

	// Alt-F/Alt-B in plain text (raw table Markdown text in Source Mode is
	// still deliberately untouched here, same as Ctrl-B/F's own goLeft/
	// goRight, which never special-cases Source Mode tables either — Source
	// Mode table rows read as plain text either way). Walks line by line via
	// getWordSpans until a word is found, a Live Preview table row is
	// reached (see landInRowEdgeCellForWord below), or the document's own
	// start/end is reached (a real Emacs buffer would signal "End/Beginning
	// of buffer" and simply not move further — same here, via the early
	// return once there's no further line to try).
	private moveCursorWordPlainText(editor: Editor, forward: boolean) {
		const cursor = editor.getCursor();
		let lineNum = cursor.line;
		let ch = cursor.ch;
		for (;;) {
			const lineText = editor.getLine(lineNum);
			const span = findWordSpanOnLine(lineText, ch, forward);
			if (span) {
				const targetCh = forward ? span.to : span.from;
				if (lineNum !== cursor.line || targetCh !== cursor.ch) {
					this.setCursorViaCm(editor, lineNum, targetCh);
					if (lineNum !== cursor.line) this.scrollCursorIntoView(editor);
				}
				return;
			}
			const nextLine = forward ? lineNum + 1 : lineNum - 1;
			if (nextLine < 0 || nextLine >= editor.lineCount()) return; // document edge — stay put
			if (this.isPositionInTable(editor, nextLine, 1)) {
				// Reaching a Live Preview table row: enter it the same way
				// crossTableRowForWord's own row-crossing does (leftmost
				// cell forward, rightmost cell backward), then apply the
				// same +1 caret correction moveCursorWordInTable's own
				// crossing already needs (landInRowEdgeCellForWord/
				// refineWordLanding land using vim's block-cursor word-end
				// convention, one char short of where Emacs's own caret
				// should rest — see moveCursorWordInTable's identical
				// comment).
				const landed = this.landInRowEdgeCellForWord(editor, nextLine, forward, false, forward);
				if (landed && forward) {
					const landedLineText = editor.getLine(landed.line);
					const targetCh = Math.min(landed.ch + 1, landedLineText.length);
					if (targetCh !== landed.ch) this.setCursorViaCm(editor, landed.line, targetCh);
				}
				if (landed) this.scrollCursorIntoView(editor);
				return;
			}
			lineNum = nextLine;
			ch = forward ? 0 : editor.getLine(lineNum).length;
		}
	}

	// Alt-F/Alt-B inside a Live Preview table cell. First searches the
	// cursor's own <br>-segment, then walks further segments within the SAME
	// cell (walkSegments — mirrors how vim.js's own inner-view line iteration
	// covers in-cell segments for free, since each <br>-segment is its own
	// doc line there); only once the whole cell is exhausted does it cross
	// into the next/prev cell or row via crossTableRowForWord — single
	// cell/row crossing only, matching that function's own documented "no
	// multi-cell count precision" scope (see its own comment).
	// crossTableRowForWord/refineWordLanding land using vim's block-cursor
	// word-end convention (wordEnd -> last char's own index); this caret
	// cursor needs one further to the right, hence the +1 correction applied
	// only on the forward landing.
	private moveCursorWordInTable(editor: Editor, forward: boolean) {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		let segInfo = getInCellLineInfo(lineText, cursor.ch);
		if (!segInfo) return;

		let localCh = cursor.ch - segInfo.startOfInCellLine;
		for (;;) {
			const scopeStart = segInfo.startOfInCellLine;
			const scopedText = lineText.slice(scopeStart, segInfo.endOfInCellLine);
			const fromCh = Math.max(0, Math.min(localCh, scopedText.length));
			const span = findWordSpanOnLine(scopedText, fromCh, forward);
			if (span) {
				const targetCh = scopeStart + (forward ? span.to : span.from);
				if (targetCh !== cursor.ch) this.setCursorViaCm(editor, cursor.line, targetCh);
				return;
			}
			const { segInfo: nextSeg, steps } = this.walkSegments(lineText, segInfo, forward, 1);
			if (steps === 0) break; // no further segment in this cell
			segInfo = nextSeg;
			localCh = forward ? 0 : segInfo.endOfInCellLine - segInfo.startOfInCellLine;
		}

		const cellIndex = getCellIndex(lineText, cursor.ch);
		const landed = this.crossTableRowForWord(editor, cellIndex, forward, false, forward);
		if (landed && forward) {
			const landedLineText = editor.getLine(landed.line);
			const targetCh = Math.min(landed.ch + 1, landedLineText.length);
			if (targetCh !== landed.ch) this.setCursorViaCm(editor, landed.line, targetCh);
		}

		// crossTableRowForWord/exitTableWithWord are shared with Vim's own
		// w/b/e, and real vim's own word motion treats a blank line as a
		// word in its own right — correct for Vim, so that shared code is
		// deliberately left alone. Real Emacs has no such convention: its
		// own word motion skips blank lines entirely (moveCursorWordPlainText
		// already does this for the all-plain-text case). So when exiting
		// the table lands on a genuinely wordless line — the exact situation
		// where the shared code's own "stop here" fallback kicks in — hand
		// off to moveCursorWordPlainText to keep searching from here, purely
		// as a post-processing step on top of the untouched shared landing
		// (the real cursor is already sitting there; crossTableRowForWord's
		// own setCursorToPrevRow/NextRow dispatch already moved it).
		if (landed && !this.isPositionInTable(editor, landed.line, 1)
				&& getWordSpans(editor.getLine(landed.line)).length === 0) {
			this.moveCursorWordPlainText(editor, forward);
		}
	}

	// Shared by crossTableRowForCell and enterTableAtLine: given a target row
	// already known to exist, lands on the specified cell's <br>-segment at
	// segmentOffset steps in from the entry edge (first segment if forward, last
	// segment if backward; segmentOffset=0 is that edge segment itself — the
	// single-row-crossing/entry case). A segmentOffset > 0 is only reached via
	// crossTableRowForCell's multi-row walk, when a single row-boundary jump
	// doesn't consume the whole repeat count. cellIndex is clamped to the row's
	// rightmost cell — the caller may be remembering a wider goal cell index from
	// a table with more columns, which this row doesn't have; clamping only
	// affects this landing, not whatever goal value the caller keeps.
	private landInCellSegment(editor: Editor, targetLine: number, cellIndex: number, forward: boolean, segmentOffset: number, goalCh: number): { line: number; ch: number } | null {
		const lineText = editor.getLine(targetLine);
		const clampedCellIndex = Math.min(cellIndex, getRightmostCellIndex(lineText));
		const cellStartCh = getChByCellIndex(lineText, clampedCellIndex);
		if (cellStartCh === -1) return null;

		// cellStartCh already lands in the cell's first <br>-segment.
		let segInfo = getInCellLineInfo(lineText, cellStartCh);
		if (!segInfo) return null;
		// Landing backward (up) starts from the LAST segment instead of the first —
		// reaching it always means walking *toward* increasing segment indices
		// (true), regardless of the outer crossing's own direction. (Bug fixed
		// here: this previously passed `forward` itself, which is false for a
		// backward landing — walking "backward" from the already-first segment
		// is a no-op, so it silently stayed on the first segment instead of the last.)
		if (!forward) {
			segInfo = this.walkSegments(lineText, segInfo, true, Infinity).segInfo;
		}
		// Walk segmentOffset further steps toward the opposite edge.
		segInfo = this.walkSegments(lineText, segInfo, forward, segmentOffset).segInfo;

		// Same normal-mode "can't rest past last char" clamp as vim-support.ts's
		// maxNormalModeCh — this position is read back as vim's next head once
		// focus moves to the new inner view, so it must already be vim-legal.
		const segLen = segInfo.endOfInCellLine - segInfo.startOfInCellLine;
		const maxOffset = Math.max(0, segLen - 1);
		const targetCh = segInfo.startOfInCellLine + Math.min(goalCh, maxOffset);
		this.setCursorViaCm(editor, targetLine, targetCh);
		return { line: targetLine, ch: targetCh };
	}

	// Walks from segInfo toward the next segment (forward) or previous segment
	// (backward) up to maxSteps times, stopping early if there's no further
	// segment. Returns the resulting segment and how many steps were actually
	// taken (steps < maxSteps only when it ran out of segments).
	private walkSegments(lineText: string, segInfo: InCellLineInfo, forward: boolean, maxSteps: number): { segInfo: InCellLineInfo; steps: number } {
		let current = segInfo;
		let steps = 0;
		while (steps < maxSteps) {
			if (forward) {
				if (current.lineType === 'last' || current.lineType === 'single') break;
				const brLen = lineText.slice(current.endOfInCellLine).match(/^<[bB][rR]>/)?.[0].length ?? 0;
				if (brLen === 0) break;
				const next = getInCellLineInfo(lineText, current.endOfInCellLine + brLen);
				if (!next) break;
				current = next;
			} else {
				if (current.lineType === 'first' || current.lineType === 'single') break;
				const prev = getInCellLineInfo(lineText, current.startOfInCellLine - 1);
				if (!prev) break;
				current = prev;
			}
			steps++;
		}
		return { segInfo: current, steps };
	}

	// Total <br>-segment count of the given cell (clamped to the row's rightmost
	// cell, matching landInCellSegment's own clamping) — used by
	// crossTableRowForCell's multi-row walk to know how much of the remaining
	// overshoot each row's cell can consume.
	private countCellSegments(lineText: string, cellIndex: number): number {
		const clampedCellIndex = Math.min(cellIndex, getRightmostCellIndex(lineText));
		const cellStartCh = getChByCellIndex(lineText, clampedCellIndex);
		if (cellStartCh === -1) return 0;
		const segInfo = getInCellLineInfo(lineText, cellStartCh);
		if (!segInfo) return 0;
		return 1 + this.walkSegments(lineText, segInfo, true, Infinity).steps;
	}

}
