import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

describe('tableHelpers', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		// Class fields are instance properties, not on the prototype.
		// Initialize them manually so methods that reference `this.*REGEX` work.
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
	})

	// ===========================================================================
	// TABLE_DELIMITER_REGEX
	// ===========================================================================

	describe('TABLE_DELIMITER_REGEX', () => {
		const matches = (s: string) => expect(plugin.TABLE_DELIMITER_REGEX.test(s)).toBe(true)
		const noMatch = (s: string) => expect(plugin.TABLE_DELIMITER_REGEX.test(s)).toBe(false)

		it('| --- | matches', () => matches('| --- |'))
		it('| :---: | matches', () => matches('| :---: |'))
		it('| :--- | matches',  () => matches('| :--- |'))
		it('| ---: | matches',  () => matches('| ---: |'))
		it('| - | (single dash) matches', () => matches('| - |'))
		it('multi-cell | --- | --- | matches', () => matches('| --- | --- |'))
		it('leading whitespace  --- | matches', () => matches('  --- |'))

		// regressions: these must NOT match
		it('spaces-only |     | does NOT match', () => noMatch('|     |'))
		it('text content | abc | does NOT match', () => noMatch('| abc |'))
		it('number content | 123 | does NOT match', () => noMatch('| 123 |'))
		it('empty || does NOT match', () => noMatch('||'))
	})

	// ===========================================================================
	// getCellBounds
	// ===========================================================================

	describe('getCellBounds', () => {
		// | hello |
		//  0123456 78   (pipe at 0, 8; length=9)
		const line1 = '| hello |'

		it('ch inside cell returns correct open/close', () => {
			// ch=3 ('e'): open=0, close=8
			expect(plugin.getCellBounds(line1, 3)).toEqual({ open: 0, close: 8 })
		})

		it('ch just after open pipe returns correct bounds', () => {
			// ch=1 (' '): open=0, close=8
			expect(plugin.getCellBounds(line1, 1)).toEqual({ open: 0, close: 8 })
		})

		// Regression: before the p >= ch fix, ch on the closing pipe used p > ch and
		// returned close = line.length (9) instead of 8, including the pipe in the slice.
		it('ch exactly on closing pipe is treated as right edge of left cell', () => {
			expect(plugin.getCellBounds(line1, 8)).toEqual({ open: 0, close: 8 })
		})

		it('ch on the opening pipe (position 0) returns null — no pipe to the left', () => {
			expect(plugin.getCellBounds(line1, 0)).toBeNull()
		})

		it('line with no pipes returns null', () => {
			expect(plugin.getCellBounds('hello world', 3)).toBeNull()
		})

		it('second cell in multi-cell row', () => {
			// | a | b |  →  pipes at 0, 4, 8
			//  01234567 8
			// ch=5 (' ' after second pipe): open=4, close=8
			expect(plugin.getCellBounds('| a | b |', 5)).toEqual({ open: 4, close: 8 })
		})

		it('escaped pipe \\| is not treated as a cell boundary', () => {
			// '| a \\| b |'  →  unescaped pipes at 0 and 9 only
			// ch=5 (inside the only cell): open=0, close=9
			expect(plugin.getCellBounds('| a \\| b |', 5)).toEqual({ open: 0, close: 9 })
		})
	})

	// ===========================================================================
	// getStartOfCellContent
	// ===========================================================================

	describe('getStartOfCellContent', () => {
		it('normal cell: returns position of first non-space character', () => {
			// | hello |  pipes at 0, 8
			// slice(1,8)=" hello ", firstNonSpace=1 → 0+1+1=2
			expect(plugin.getStartOfCellContent('| hello |', 3)).toBe(2)
		})

		it('leading spaces: skips them to reach first non-space', () => {
			// |  hello |  pipes at 0, 9
			// slice(1,9)="  hello ", firstNonSpace=2 → 0+1+2=3
			expect(plugin.getStartOfCellContent('|  hello |', 4)).toBe(3)
		})

		it('trailing spaces do not affect start', () => {
			// | hello  |  pipes at 0, 9
			// slice(1,9)=" hello  ", firstNonSpace=1 → 0+1+1=2
			expect(plugin.getStartOfCellContent('| hello  |', 3)).toBe(2)
		})

		// Regression: spaces-only cell was misidentified as a delimiter row, causing wrong
		// row navigation. start === end is the isEmpty signal used by moveCursorUpInTable.
		it('spaces-only cell: start === end (isEmpty)', () => {
			const line  = '|     |'
			const start = plugin.getStartOfCellContent(line, 3)
			const end   = plugin.getEndOfCellContent(line, 3)
			expect(start).toBe(end)
		})

		it('empty cell ||: start === end', () => {
			const line  = '||'
			const start = plugin.getStartOfCellContent(line, 1)
			const end   = plugin.getEndOfCellContent(line, 1)
			expect(start).toBe(end)
		})

		it('no pipe to the left of ch: returns 0 (fallback)', () => {
			expect(plugin.getStartOfCellContent('| hello |', 0)).toBe(0)
		})
	})

	// ===========================================================================
	// getEndOfCellContent
	// ===========================================================================

	describe('getEndOfCellContent', () => {
		it('normal cell: returns position after last non-space character', () => {
			// | hello |  pipes at 0, 8
			// slice(1,8)=" hello ", trimEnd=" hello" (len=6) → 0+1+6=7
			expect(plugin.getEndOfCellContent('| hello |', 3)).toBe(7)
		})

		it('trailing spaces: trims them', () => {
			// | hello  |  pipes at 0, 9
			// slice(1,9)=" hello  ", trimEnd=" hello" (len=6) → 0+1+6=7
			expect(plugin.getEndOfCellContent('| hello  |', 3)).toBe(7)
		})

		it('leading spaces do not affect end', () => {
			// |  hello |  pipes at 0, 9
			// slice(1,9)="  hello ", trimEnd="  hello" (len=7) → 0+1+7=8
			expect(plugin.getEndOfCellContent('|  hello |', 4)).toBe(8)
		})

		it('spaces-only cell: end === start (isEmpty)', () => {
			const line  = '|     |'
			const start = plugin.getStartOfCellContent(line, 3)
			const end   = plugin.getEndOfCellContent(line, 3)
			expect(end).toBe(start)
		})

		// Regression: with the old p > ch bug in getCellBounds, ch on the closing pipe
		// caused close = line.length, including the pipe character in the trimEnd slice.
		it('ch on closing pipe: pipe is NOT included in the content slice', () => {
			// | hello |  close pipe at 8
			// old code: close=9, slice(1,9)=" hello |", trimEnd=" hello |" (len=8) → 9 (wrong)
			// new code: close=8, slice(1,8)=" hello ", trimEnd=" hello" (len=6)  → 7 (correct)
			expect(plugin.getEndOfCellContent('| hello |', 8)).toBe(7)
		})

		it('second cell in multi-cell row', () => {
			// | a | bb |  pipes at 0, 4, 9
			// ch=6 ('b'): open=4, close=9
			// slice(5,9)=" bb ", trimEnd=" bb" (len=3) → 4+1+3=8
			expect(plugin.getEndOfCellContent('| a | bb |', 6)).toBe(8)
		})

		it('no pipe to the left of ch: returns 0 (fallback)', () => {
			expect(plugin.getEndOfCellContent('| hello |', 0)).toBe(0)
		})
	})

	// ===========================================================================
	// getPipePositions
	// ===========================================================================

	describe('getPipePositions(line)', () => {
		it('multi-cell row returns all pipe indices', () => {
			// | a | b | c |  →  pipes at 0, 4, 8, 12
			expect(plugin.getPipePositions('| a | b | c |')).toEqual([0, 4, 8, 12])
		})

		it('escaped pipe \\| is excluded', () => {
			// '| a \\| b |'  →  unescaped pipes at 0 and 9
			expect(plugin.getPipePositions('| a \\| b |')).toEqual([0, 9])
		})

		it('line with no pipes returns []', () => {
			expect(plugin.getPipePositions('hello world')).toEqual([])
		})
	})

	// ===========================================================================
	// getRightmostCellIndex
	// ===========================================================================

	describe('getRightmostCellIndex(line)', () => {
		it('three cells | a | b | c | — returns 2', () => {
			// 4 pipes → Math.max(0, 4-2) = 2
			expect(plugin.getRightmostCellIndex('| a | b | c |')).toBe(2)
		})

		it('single cell | a | — returns 0', () => {
			// 2 pipes → Math.max(0, 2-2) = 0
			expect(plugin.getRightmostCellIndex('| a |')).toBe(0)
		})
	})

	// ===========================================================================
	// getCellIndex
	// ===========================================================================

	describe('getCellIndex(line, ch)', () => {
		// | a | b |  →  pipes at 0, 4, 8
		const line = '| a | b |'

		it('ch in first cell — returns 0', () => {
			// substring(0, 2) = "| " → 1 pipe → max(0, 1-1) = 0
			expect(plugin.getCellIndex(line, 2)).toBe(0)
		})

		it('ch in second cell — returns 1', () => {
			// substring(0, 6) = "| a | " → 2 pipes → max(0, 2-1) = 1
			expect(plugin.getCellIndex(line, 6)).toBe(1)
		})

		it('ch before any pipe (ch=0) — clamped to 0', () => {
			// substring(0, 0) = "" → 0 pipes → max(0, 0-1) = 0
			expect(plugin.getCellIndex(line, 0)).toBe(0)
		})
	})

	// ===========================================================================
	// getEndOfCellContentByCellIndex
	// ===========================================================================

	describe('getEndOfCellContentByCellIndex(line, cellIndex)', () => {
		// | hello | world |  →  pipes at 0, 8, 16
		const line = '| hello | world |'

		it('cellIndex=0 — returns end of first cell content', () => {
			// slice(1,8)=" hello ", trimEnd=" hello" (len=6) → 0+1+6=7
			expect(plugin.getEndOfCellContentByCellIndex(line, 0)).toBe(7)
		})

		it('cellIndex=1 — returns end of second cell content', () => {
			// slice(9,16)=" world ", trimEnd=" world" (len=6) → 8+1+6=15
			expect(plugin.getEndOfCellContentByCellIndex(line, 1)).toBe(15)
		})

		it('cellIndex out of range (too high) — returns -1', () => {
			expect(plugin.getEndOfCellContentByCellIndex(line, 2)).toBe(-1)
		})

		it('cellIndex negative — returns -1', () => {
			expect(plugin.getEndOfCellContentByCellIndex(line, -1)).toBe(-1)
		})
	})

	// ===========================================================================
	// getInCellLineInfo
	// ===========================================================================

	describe('getInCellLineInfo(line, ch)', () => {
		it('no <br>: lineType single, correct start/end, isEmpty false', () => {
			// | hello |  pipes at 0, 8
			// seg={start:1,end:8}, segContent=" hello "
			// startOfInCellLine=2 (skip leading space), endOfInCellLine=7 (trimEnd)
			expect(plugin.getInCellLineInfo('| hello |', 3)).toEqual({
				lineType: 'single',
				startOfInCellLine: 2,
				endOfInCellLine: 7,
				isEmpty: false,
			})
		})

		it('spaces-only cell: lineType single, isEmpty true', () => {
			// |   |  pipes at 0, 4; seg={start:1,end:4}
			// no non-space → startOfInCellLine=seg.start=1, endOfInCellLine=1+0=1
			expect(plugin.getInCellLineInfo('|   |', 2)).toEqual({
				lineType: 'single',
				startOfInCellLine: 1,
				endOfInCellLine: 1,
				isEmpty: true,
			})
		})

		it('ch before any pipe — returns null', () => {
			expect(plugin.getInCellLineInfo('| hello |', 0)).toBeNull()
		})

		it('one <br>: ch in first segment — lineType first, endOfInCellLine at <br> start', () => {
			// | hello<br>world |  pipes at 0, 17
			// <br> at positions 7-10 (in line)
			// seg[0]={start:1,end:7}: startOfInCellLine=2, endOfInCellLine=7
			expect(plugin.getInCellLineInfo('| hello<br>world |', 3)).toEqual({
				lineType: 'first',
				startOfInCellLine: 2,
				endOfInCellLine: 7,
				isEmpty: false,
			})
		})

		it('one <br>: ch in last segment — lineType last, startOfInCellLine right after <br>', () => {
			// | hello<br>world |
			// seg[1]={start:11,end:17}: startOfInCellLine=11, endOfInCellLine=16 (trimEnd "world")
			expect(plugin.getInCellLineInfo('| hello<br>world |', 13)).toEqual({
				lineType: 'last',
				startOfInCellLine: 11,
				endOfInCellLine: 16,
				isEmpty: false,
			})
		})

		it('two <br>: ch in middle segment — lineType middle', () => {
			// | a<br>b<br>c |  pipes at 0, 14
			// brPositions: {start:3,end:7}, {start:8,end:12}
			// segments: [{1,3},{7,8},{12,14}]
			// ch=7 ('b' in middle): segIndex=1, lineType='middle'
			// startOfInCellLine=7, endOfInCellLine=8
			expect(plugin.getInCellLineInfo('| a<br>b<br>c |', 7)).toEqual({
				lineType: 'middle',
				startOfInCellLine: 7,
				endOfInCellLine: 8,
				isEmpty: false,
			})
		})

		it('ch inside a <br> tag — assigned to preceding segment', () => {
			// | hello<br>world |, ch=9 is inside <br> (positions 7-10)
			// brPositions: {start:7,end:11}
			// segIndex fallback: ch=9 > 7 && < 11 → segIndex=0 (preceding segment)
			// seg[0]={start:1,end:7}: lineType='first'
			expect(plugin.getInCellLineInfo('| hello<br>world |', 9)).toEqual({
				lineType: 'first',
				startOfInCellLine: 2,
				endOfInCellLine: 7,
				isEmpty: false,
			})
		})

		it('<BR> uppercase is also recognized', () => {
			expect(plugin.getInCellLineInfo('| a<BR>b |', 3)).toMatchObject({
				lineType: 'first',
			})
		})
	})
})
