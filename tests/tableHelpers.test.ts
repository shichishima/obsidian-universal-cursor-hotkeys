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
})
