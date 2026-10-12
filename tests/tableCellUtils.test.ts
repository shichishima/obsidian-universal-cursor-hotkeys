import { describe, it, expect } from 'vitest'

import {
	getCellBounds,
	getStartOfCellContent,
	getEndOfCellContent,
	getEndOfCellContentByCellIndex,
	getRightmostCellIndex,
	getCellIndex,
	getChByCellIndex,
} from '../src/table-cell-utils.ts'

// Four edge-pipe variants of the same 3-cell row "a | b | c". GFM requires
// both edge pipes to be omitted together — a row with only one omitted isn't
// recognized as a table row at all (confirmed live) — but every function
// under test is written to stay correct regardless of which combination it's
// given, so the asymmetric cases are exercised here too as cheap insurance
// against a future caller passing one in, not because Obsidian can ever
// produce one itself.
const BOTH_EDGES    = '| a | b | c |'
const LEADING_ONLY   = '| a | b | c'
const TRAILING_ONLY  = 'a | b | c |'
const NO_EDGES       = 'a | b | c'

describe('table-cell-utils: edge-pipe omission', () => {
	describe.each([
		['both edges present', BOTH_EDGES],
		['leading pipe omitted', LEADING_ONLY],
		['trailing pipe omitted', TRAILING_ONLY],
		['both edges omitted', NO_EDGES],
	])('%s (%j)', (_label, line) => {
		it('getRightmostCellIndex is always 2 (3 cells)', () => {
			expect(getRightmostCellIndex(line)).toBe(2)
		})

		it('getChByCellIndex lands each cell index at its own "a"/"b"/"c"', () => {
			const chA = getChByCellIndex(line, 0)
			const chB = getChByCellIndex(line, 1)
			const chC = getChByCellIndex(line, 2)
			expect(line[chA]).toBe('a')
			expect(line[chB]).toBe('b')
			expect(line[chC]).toBe('c')
		})

		it('getCellIndex agrees with getChByCellIndex (round-trip)', () => {
			expect(getCellIndex(line, getChByCellIndex(line, 0))).toBe(0)
			expect(getCellIndex(line, getChByCellIndex(line, 1))).toBe(1)
			expect(getCellIndex(line, getChByCellIndex(line, 2))).toBe(2)
		})

		it('getStartOfCellContent/getEndOfCellContent bound each cell\'s own letter', () => {
			const chB = getChByCellIndex(line, 1)
			expect(line[getStartOfCellContent(line, chB)]).toBe('b')
			// endOfCellContent is one past the last non-space char.
			expect(line[getEndOfCellContent(line, chB) - 1]).toBe('b')
		})

		it('getEndOfCellContentByCellIndex matches getEndOfCellContent for the same cell', () => {
			const chC = getChByCellIndex(line, 2)
			expect(getEndOfCellContentByCellIndex(line, 2)).toBe(getEndOfCellContent(line, chC))
		})
	})

	it('getChByCellIndex(line, 0) lands in cell 0, not cell 1, when the leading pipe is omitted', () => {
		// The regression this fix targets: pipes[0] used to be read as cell 0's
		// own left boundary, but with no leading pipe it's actually the
		// separator between cell 0 and cell 1.
		const ch = getChByCellIndex(TRAILING_ONLY, 0)
		expect(TRAILING_ONLY.slice(ch, ch + 1)).toBe('a')
	})

	it('getCellBounds returns null outside any cell (before the leading pipe)', () => {
		expect(getCellBounds(BOTH_EDGES, 0)).toBeNull()
	})

	it('getCellBounds returns an open: -1 boundary for cell 0 when the leading pipe is omitted', () => {
		const bounds = getCellBounds(TRAILING_ONLY, 0)
		expect(bounds).not.toBeNull()
		expect(bounds!.open).toBe(-1)
	})

	it('a line with zero pipes is not a table row (defensive defaults unchanged, no virtual cell synthesized)', () => {
		const line = 'just text'
		expect(getCellBounds(line, 4)).toBeNull()
		// Matches the original pre-fix defensive fallback (0), not a claim
		// that this line actually has a resolvable cell.
		expect(getRightmostCellIndex(line)).toBe(0)
		expect(getCellIndex(line, 4)).toBe(0)
	})
})
