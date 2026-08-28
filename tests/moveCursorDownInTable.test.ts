import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// Line layout:
//   LINE_2SEG = '| line1<br>line2 |'
//     pipes at 0, 17
//     'line1' at ch 2-6  → type='first'
//     'line2' at ch 11-15 → type='last'
//     endOfCellContent = 16  (open+1+len(' line1<br>line2'.trimEnd())=0+1+15=16)
//
//   LINE_3SEG = '| a<br>b<br>c |'
//     pipes at 0, 14
//     'a' at ch 2   → type='first'
//     'b' at ch 7   → type='middle'
//     'c' at ch 12  → type='last'
//     endOfCellContent = 13  (open+1+len(' a<br>b<br>c'.trimEnd())=0+1+12=13)
//
//   LINE_SINGLE = '| content |'
//     no <br> → type='single'
//     endOfCellContent = 9  (open+1+len(' content'.trimEnd())=0+1+8=9)
//
//   LINE_DELIM = '| --- |'

const LINE_2SEG   = '| line1<br>line2 |'
const LINE_3SEG   = '| a<br>b<br>c |'
const LINE_SINGLE = '| content |'
const LINE_EMPTY  = '|  |'
const LINE_DELIM  = '| --- |'

describe('moveCursorDownInTable', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.setCursorToNextRow = vi.fn()
		plugin.setCursorViaCm    = vi.fn()
		plugin.getNextRowLine    = vi.fn().mockReturnValue(-1)
		// Row-crossing goal-column helpers: stubbed so tests exercise only
		// moveCursorDownInTable's own threading, not these helpers' own logic
		// (covered separately in rowCrossGoalColumn.test.ts). Fixed sentinel
		// value lets assertions confirm the exact value is threaded through.
		plugin.computeRowCrossPixelGoal = vi.fn().mockReturnValue(999)
		plugin.applyRowCrossGoalColumn  = vi.fn()
	})

	// Build editor mock with explicit getCursor return sequence.
	// cursors: returned in order; last value repeats.
	const makeEditorSeq = (lineText: string, cursors: {line: number, ch: number}[], lineMap?: Record<number, string>) => {
		const mock = vi.fn()
		cursors.forEach((c, i) => {
			if (i < cursors.length - 1) mock.mockReturnValueOnce(c)
			else mock.mockReturnValue(c)
		})
		return {
			getCursor: mock,
			getLine: vi.fn().mockImplementation((n: number) => lineMap?.[n] ?? lineText),
			exec: vi.fn(),
		}
	}

	const makeEditor = (line: string, ch: number, sameLine = false, afterCh?: number) =>
		makeEditorSeq(line, [
			{ line: 1, ch },
			{ line: sameLine ? 1 : 2, ch: afterCh ?? ch },
		])

	// Build a minimal inner view mock.
	// docText uses '\n' as sub-line separator (mirrors LP inner doc).
	// head: cursor position in inner doc.
	// headTop / endTop: optional y-coords for coordsAtPos (enables VL clip tests).
	//   coordsAtPos(head) returns headTop; all other positions return endTop.
	//   When omitted, coordsAtPos returns null (isOnLastVL falls back to true).
	function makeInner(docText: string, head: number, headTop?: number, endTop?: number) {
		const parts = docText.split('\n')
		const lineByNumber = (n: number) => {
			let offset = 0
			for (let i = 0; i < n - 1; i++) offset += parts[i].length + 1
			return { number: n, from: offset, to: offset + parts[n - 1].length, text: parts[n - 1] }
		}
		const coordsAtPos = headTop !== undefined && endTop !== undefined
			? vi.fn((pos: number) => {
				const top = pos === head ? headTop : endTop
				return { top, bottom: top + 18, left: 100, right: 200 }
			})
			: vi.fn(() => null)
		return {
			state: {
				doc: {
					lines: parts.length,
					line: lineByNumber,
					lineAt: (pos: number) => {
						let offset = 0
						for (let i = 0; i < parts.length; i++) {
							const to = offset + parts[i].length
							if (pos <= to) return { number: i + 1, from: offset, to }
							offset = to + 1
						}
						const last = parts[parts.length - 1]
						return { number: parts.length, from: offset - last.length, to: offset }
					},
				},
				selection: { main: { head } },
			},
			coordsAtPos,
		}
	}

	// Attach inner view to an editor mock (activeCM ≠ cm signals LP table cell).
	function withInner<T extends object>(editor: T, inner: object): T & { activeCM: object; cm: object } {
		return Object.assign(editor, { activeCM: inner, cm: {} })
	}

	// ===========================================================================
	// inner view path — not last sub-line → early goDown
	// ===========================================================================

	describe('inner view: not last sub-line → early goDown', () => {
		it('2-segment cell, cursor on sub-line 1 → goDown, no setCursorToNextRow', () => {
			// inner doc ' line1\nline2', head=3 (sub-line 1)
			const inner  = makeInner(' line1\nline2', 3)
			const editor = withInner(makeEditor(LINE_2SEG, 3), inner)
			plugin.moveCursorDownInTable(editor)
			expect(editor.exec).toHaveBeenCalledTimes(1)
			expect(plugin.setCursorToNextRow).not.toHaveBeenCalled()
		})

		it('3-segment cell, cursor on sub-line 2 (middle) → goDown, no setCursorToNextRow', () => {
			// inner doc ' a\nb\nc', head=4 (sub-line 2)
			const inner  = makeInner(' a\nb\nc', 4)
			const editor = withInner(makeEditor(LINE_3SEG, 7), inner)
			plugin.moveCursorDownInTable(editor)
			expect(editor.exec).toHaveBeenCalledTimes(1)
			expect(plugin.setCursorToNextRow).not.toHaveBeenCalled()
		})
	})

	// ===========================================================================
	// inner view path — last sub-line → falls through to eoc / probe checks
	// ===========================================================================

	describe('inner view: last sub-line → falls through to eoc check', () => {
		it('single sub-line, ch=eoc → no goDown, setCursorToNextRow called', () => {
			// inner doc ' content' (1 line), head=8
			// outer LINE_SINGLE eoc=9; cursor ch=9
			const inner  = makeInner(' content', 8)
			const editor = withInner(makeEditor(LINE_SINGLE, 9), inner)
			plugin.moveCursorDownInTable(editor)
			expect(editor.exec).not.toHaveBeenCalled()
			expect(plugin.setCursorToNextRow).toHaveBeenCalled()
		})

		it('2-segment cell, cursor on last sub-line (sub-line 2), ch<eoc → goDown probe runs', () => {
			// inner doc ' line1\nline2', head=8 (sub-line 2); outer LINE_2SEG eoc=16, ch=13<16
			// After goDown: exits to line 2 (not delim) → setCursorToNextRow NOT called
			const inner  = makeInner(' line1\nline2', 8)
			const editor = withInner(makeEditorSeq(LINE_2SEG,
				[{ line: 1, ch: 13 }, { line: 2, ch: 13 }],
				{ 1: LINE_2SEG, 2: 'normal line' }
			), inner)
			plugin.moveCursorDownInTable(editor)
			expect(editor.exec).toHaveBeenCalledTimes(1)
			expect(plugin.setCursorToNextRow).not.toHaveBeenCalled()
		})
	})

	// ===========================================================================
	// first / middle: early return after single goDown
	// ===========================================================================

	it('type=first: goDown called once, setCursorToNextRow NOT called', () => {
		const editor = makeEditor(LINE_2SEG, 3)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).toHaveBeenCalledTimes(1)
		expect(plugin.setCursorToNextRow).not.toHaveBeenCalled()
		expect(plugin.applyRowCrossGoalColumn).not.toHaveBeenCalled()
	})

	it('type=middle: goDown called once, setCursorToNextRow NOT called', () => {
		const editor = makeEditor(LINE_3SEG, 7)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).toHaveBeenCalledTimes(1)
		expect(plugin.setCursorToNextRow).not.toHaveBeenCalled()
	})

	// ===========================================================================
	// empty cell: bypass goDown entirely (goDown unreliable on cm.dispatch cursor)
	// ===========================================================================

	it('empty cell: no goDown, setCursorToNextRow called', () => {
		// LINE_EMPTY = '|  |'  open=0 close=3  eoc=1  start=1  start===eoc
		const editor = makeEditor(LINE_EMPTY, 1)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).not.toHaveBeenCalled()
		expect(plugin.setCursorToNextRow).toHaveBeenCalled()
		expect(plugin.applyRowCrossGoalColumn).toHaveBeenCalledWith(editor, 999)
	})

	// ===========================================================================
	// pre-eoc check: cursor.ch >= eoc → no goDown, exit directly
	// ===========================================================================

	it('type=single, ch=eoc: no goDown, setCursorToNextRow called', () => {
		// LINE_SINGLE eoc=9
		const editor = makeEditor(LINE_SINGLE, 9)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).not.toHaveBeenCalled()
		expect(plugin.setCursorToNextRow).toHaveBeenCalled()
		expect(plugin.applyRowCrossGoalColumn).toHaveBeenCalledWith(editor, 999)
	})

	it('type=single, ch>eoc: no goDown, setCursorToNextRow called', () => {
		// ch=10 is past eoc=9
		const editor = makeEditor(LINE_SINGLE, 10)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).not.toHaveBeenCalled()
		expect(plugin.setCursorToNextRow).toHaveBeenCalled()
	})

	it('type=last, ch=eoc: no goDown, setCursorToNextRow called', () => {
		// LINE_2SEG eoc=16
		const editor = makeEditor(LINE_2SEG, 16)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).not.toHaveBeenCalled()
		expect(plugin.setCursorToNextRow).toHaveBeenCalled()
	})

	// ===========================================================================
	// 1st goDown: exits to different line
	// ===========================================================================

	it('1st goDown exits to delimiter row → setCursorToNextRow called', () => {
		const editor = makeEditorSeq(LINE_SINGLE, [
			{ line: 1, ch: 3 },
			{ line: 2, ch: 0 },
		], { 1: LINE_SINGLE, 2: LINE_DELIM })
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).toHaveBeenCalledTimes(1)
		expect(plugin.setCursorToNextRow).toHaveBeenCalled()
		expect(plugin.applyRowCrossGoalColumn).toHaveBeenCalledWith(editor, 999)
	})

	it('1st goDown exits to normal line → setCursorToNextRow NOT called', () => {
		const editor = makeEditorSeq(LINE_SINGLE, [
			{ line: 1, ch: 3 },
			{ line: 2, ch: 3 },
		], { 1: LINE_SINGLE, 2: 'text below table' })
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).toHaveBeenCalledTimes(1)
		expect(plugin.setCursorToNextRow).not.toHaveBeenCalled()
	})

	// ===========================================================================
	// 1st goDown: same line, ch unchanged (complete no-op → file-end)
	// ===========================================================================

	it('type=single: 1st goDown no-op → setCursorToNextRow called', () => {
		const editor = makeEditor(LINE_SINGLE, 3, true)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).toHaveBeenCalledTimes(1)
		expect(plugin.setCursorToNextRow).toHaveBeenCalled()
		expect(plugin.applyRowCrossGoalColumn).toHaveBeenCalledWith(editor, 999)
	})

	it('type=last: 1st goDown no-op → setCursorToNextRow called', () => {
		const editor = makeEditor(LINE_2SEG, 13, true)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).toHaveBeenCalledTimes(1)
		expect(plugin.setCursorToNextRow).toHaveBeenCalled()
	})

	// ===========================================================================
	// 1st goDown: same line, ch moves within cell (< eoc) → soft-wrap VL advance
	// ===========================================================================

	it('type=single: ch moves within cell → no exit, setCursorToNextRow NOT called', () => {
		// LINE_SINGLE eoc=9; afterCh=6 < 9
		const editor = makeEditor(LINE_SINGLE, 3, true, 6)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).toHaveBeenCalledTimes(1)
		expect(plugin.setCursorToNextRow).not.toHaveBeenCalled()
	})

	it('type=last: ch moves within cell → no exit, setCursorToNextRow NOT called', () => {
		// LINE_2SEG eoc=16; afterCh=14 < 16 and != cursor.ch(13)
		const editor = makeEditor(LINE_2SEG, 13, true, 14)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).toHaveBeenCalledTimes(1)
		expect(plugin.setCursorToNextRow).not.toHaveBeenCalled()
	})

	// ===========================================================================
	// 1st goDown: same line, ch >= eoc (clip = VL_N indicator) → exit
	// ===========================================================================

	it('clip: ch = eoc after goDown → setCursorToNextRow called', () => {
		// after goDown: ch=9 == eoc=9 for LINE_SINGLE
		const editor = makeEditor(LINE_SINGLE, 3, true, 9)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).toHaveBeenCalledTimes(1)
		expect(plugin.setCursorToNextRow).toHaveBeenCalled()
	})

	it('clip: ch > eoc after goDown → setCursorToNextRow called', () => {
		// after goDown: ch=10 > eoc=9 for LINE_SINGLE
		const editor = makeEditor(LINE_SINGLE, 3, true, 10)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).toHaveBeenCalledTimes(1)
		expect(plugin.setCursorToNextRow).toHaveBeenCalled()
	})

	// ===========================================================================
	// coordsAtPos VL disambiguation — VL_N-1 clip stays, VL_N clip exits
	//
	// LINE_SINGLE = '| content |'  eoc=9
	// inner doc = ' content' (trimEnd len=8, contentEnd=8), head=3
	// goDown: same line, afterCh=9 >= eoc=9 (clip)
	// ===========================================================================

	it('clip from VL_N-1 (headTop < endTop) → stays in cell', () => {
		// head.top=100, end.top=120 → diff=20 → not last VL → stay
		const inner  = makeInner(' content', 3, 100, 120)
		const editor = withInner(makeEditor(LINE_SINGLE, 3, true, 9), inner)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).toHaveBeenCalledTimes(1)
		expect(plugin.setCursorToNextRow).not.toHaveBeenCalled()
	})

	it('clip from VL_N (headTop === endTop) → exits to next row', () => {
		// head.top=120, end.top=120 → diff=0 → last VL → exit
		const inner  = makeInner(' content', 3, 120, 120)
		const editor = withInner(makeEditor(LINE_SINGLE, 3, true, 9), inner)
		plugin.moveCursorDownInTable(editor)
		expect(editor.exec).toHaveBeenCalledTimes(1)
		expect(plugin.setCursorToNextRow).toHaveBeenCalled()
		expect(plugin.applyRowCrossGoalColumn).toHaveBeenCalledWith(editor, 999)
	})
})
