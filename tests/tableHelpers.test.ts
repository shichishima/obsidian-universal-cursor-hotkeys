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
		const matchCases = [
			'| --- |',
			'| :---: |',
			'| :--- |',
			'| ---: |',
			'| - |',
			'| --- | --- |',
			'  --- |',
		]
		const noMatchCases = [
			'|     |',
			'| abc |',
			'| 123 |',
			'||',
		]

		for (const s of matchCases) {
			it(`matches: "${s}"`, () => expect(plugin.TABLE_DELIMITER_REGEX.test(s)).toBe(true))
		}
		for (const s of noMatchCases) {
			it(`no match: "${s}"`, () => expect(plugin.TABLE_DELIMITER_REGEX.test(s)).toBe(false))
		}
	})

	// ===========================================================================
	// getCellBounds
	// ===========================================================================

	describe('getCellBounds', () => {
		// [line, ch, expected]  null = no cell found
		const cases: [string, number, { open: number; close: number } | null][] = [
			// basic: ch inside cell
			['| hello |',    3,  { open: 0, close: 8 }],
			// ch just after open pipe
			['| hello |',    1,  { open: 0, close: 8 }],
			// regression: ch exactly on closing pipe → treated as right edge of left cell
			['| hello |',    8,  { open: 0, close: 8 }],
			// ch on opening pipe (no pipe to the left) → null
			['| hello |',    0,  null],
			// no pipes → null
			['hello world',  3,  null],
			// second cell in multi-cell row
			['| a | b |',    5,  { open: 4, close: 8 }],
			// escaped pipe is not a boundary
			['| a \\| b |',  5,  { open: 0, close: 9 }],
		]

		for (const [line, ch, expected] of cases) {
			it(`"${line}" ch=${ch} → ${JSON.stringify(expected)}`, () => {
				expect(plugin.getCellBounds(line, ch)).toEqual(expected)
			})
		}
	})

	// ===========================================================================
	// getStartOfCellContent / getEndOfCellContent
	// Combined: same inputs, verify both start and end in one table.
	// null start/end means isEmpty (start === end).
	// ===========================================================================

	describe('getStartOfCellContent & getEndOfCellContent', () => {
		// [line, ch, expectedStart, expectedEnd]
		// expectedStart===expectedEnd means isEmpty
		const cases: [string, number, number, number][] = [
			// normal cell
			//0 23   7
			['| hello |',   3,  2,  7],
			// leading spaces
			//0  34   8
			['|  hello |',  4,  3,  8],
			// trailing spaces
			//0 23   7
			['| hello  |',  3,  2,  7],
			// spaces-only: isEmpty (start === end)
			//01 3
			['|     |',     3,  1,  1],
			// empty cell ||: isEmpty
			//01
			['||',          1,  1,  1],
			// regression: ch on closing pipe — pipe NOT included in content slice
			//0 2    78
			['| hello |',   8,  2,  7],
			// second cell
			//0     6 8
			['| a | bb |',  6,  6,  8],
			// no pipe to left of ch: returns 0 (fallback)
			//0
			['| hello |',   0,  0,  0],
		]

		for (const [line, ch, start, end] of cases) {
			it(`"${line}" ch=${ch} → start=${start}, end=${end}`, () => {
				expect(plugin.getStartOfCellContent(line, ch)).toBe(start)
				expect(plugin.getEndOfCellContent(line, ch)).toBe(end)
			})
		}
	})

	// ===========================================================================
	// getPipePositions
	// ===========================================================================

	describe('getPipePositions(line)', () => {
		const cases: [string, number[]][] = [
			['| a | b | c |',   [0, 4, 8, 12]],
			['| a \\| b |',     [0, 9]],          // escaped pipe excluded
			['hello world',     []],               // no pipes
		]

		for (const [line, expected] of cases) {
			it(`"${line}" → [${expected}]`, () => {
				expect(plugin.getPipePositions(line)).toEqual(expected)
			})
		}
	})

	// ===========================================================================
	// getRightmostCellIndex
	// ===========================================================================

	describe('getRightmostCellIndex(line)', () => {
		const cases: [string, number][] = [
			['| a | b | c |',  2],   // 4 pipes → Math.max(0, 4-2) = 2
			['| a |',          0],   // 2 pipes → Math.max(0, 2-2) = 0
		]

		for (const [line, expected] of cases) {
			it(`"${line}" → ${expected}`, () => {
				expect(plugin.getRightmostCellIndex(line)).toBe(expected)
			})
		}
	})

	// ===========================================================================
	// getCellIndex
	// ===========================================================================

	describe('getCellIndex(line, ch)', () => {
		// pipes at   0   4   8
		const line = '| a | b |'
		// expect       0   1
		const cases: [number, number][] = [
			[2, 0],   // ch in first cell
			[6, 1],   // ch in second cell
			[0, 0],   // ch before any pipe → clamped to 0
		]

		for (const [ch, expected] of cases) {
			it(`ch=${ch} → ${expected}`, () => {
				expect(plugin.getCellIndex(line, ch)).toBe(expected)
			})
		}
	})

	// ===========================================================================
	// getEndOfCellContentByCellIndex
	// ===========================================================================

	describe('getEndOfCellContentByCellIndex(line, cellIndex)', () => {
		// pipes at   0       8       16
		const line = '| hello | world |'
		// cell no        0       1
		// end               7       15
		const cases: [number, number][] = [
			[0,   7],   // first cell: slice(1,8)=" hello ", trimEnd→len=6, 0+1+6=7
			[1,  15],   // second cell: slice(9,16)=" world ", trimEnd→len=6, 8+1+6=15
			[2,  -1],   // out of range
			[-1, -1],   // negative index
		]

		for (const [cellIndex, expected] of cases) {
			it(`cellIndex=${cellIndex} → ${expected}`, () => {
				expect(plugin.getEndOfCellContentByCellIndex(line, cellIndex)).toBe(expected)
			})
		}
	})

	// ===========================================================================
	// getInCellLineInfo
	// ===========================================================================

	describe('getInCellLineInfo(line, ch)', () => {
		it('no <br>: lineType single, correct start/end, isEmpty false', () => {
			expect(plugin.getInCellLineInfo('| hello |', 3)).toEqual({
				lineType: 'single',
				startOfInCellLine: 2,
				endOfInCellLine: 7,
				isEmpty: false,
			})
		})

		it('spaces-only cell: lineType single, isEmpty true', () => {
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

		it('one <br>: ch in first segment — lineType first', () => {
			expect(plugin.getInCellLineInfo('| hello<br>world |', 3)).toEqual({
				lineType: 'first',
				startOfInCellLine: 2,
				endOfInCellLine: 7,
				isEmpty: false,
			})
		})

		it('one <br>: ch in last segment — lineType last', () => {
			expect(plugin.getInCellLineInfo('| hello<br>world |', 13)).toEqual({
				lineType: 'last',
				startOfInCellLine: 11,
				endOfInCellLine: 16,
				isEmpty: false,
			})
		})

		it('two <br>: ch in middle segment — lineType middle', () => {
			expect(plugin.getInCellLineInfo('| a<br>b<br>c |', 7)).toEqual({
				lineType: 'middle',
				startOfInCellLine: 7,
				endOfInCellLine: 8,
				isEmpty: false,
			})
		})

		it('ch inside a <br> tag — assigned to preceding segment', () => {
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
