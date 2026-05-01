import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

describe('crossRowNavigation', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.setCursorViaCm = vi.fn()
	})

	// Line layout for '| a | b |':
	//   pipes at  ch = 0,  4,  8
	//   cell 0: content 'a' at ch 2,  endOfContent = 3
	//   cell 1: content 'b' at ch 6,  endOfContent = 7
	const LINE = '| a | b |'
	const makeEditor = (ch: number, getLine?: (n: number) => string) => ({
		getCursor: () => ({ line: 1, ch }),
		getLine:   getLine ?? (() => LINE),
	})

	// ===========================================================================
	// moveToLeftCellEnd
	// ===========================================================================

	describe('moveToLeftCellEnd', () => {
		describe('crossRowNavigation: OFF', () => {
			beforeEach(() => { plugin.settings = { crossRowNavigation: false } })

			it('leftmost cell: does not move', () => {
				plugin.moveToLeftCellEnd(makeEditor(2))
				expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
			})

			it('non-leftmost cell: moves to left cell end (same row)', () => {
				plugin.moveToLeftCellEnd(makeEditor(6))
				expect(plugin.setCursorViaCm).toHaveBeenCalledWith(expect.anything(), 1, 3)
			})
		})

		describe('crossRowNavigation: ON', () => {
			beforeEach(() => {
				plugin.settings = { crossRowNavigation: true }
				plugin.getPrevRowLine = vi.fn().mockReturnValue(0)
			})

			it('leftmost cell (data row): moves to previous row rightmost cell end', () => {
				plugin.moveToLeftCellEnd(makeEditor(2))
				expect(plugin.setCursorViaCm).toHaveBeenCalledWith(expect.anything(), 0, 7)
			})
		})
	})

	// ===========================================================================
	// moveToRightCellStart
	// ===========================================================================

	describe('moveToRightCellStart', () => {
		describe('crossRowNavigation: OFF', () => {
			beforeEach(() => { plugin.settings = { crossRowNavigation: false } })

			it('rightmost cell: does not move', () => {
				plugin.moveToRightCellStart(makeEditor(6))
				expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
			})

			it('non-rightmost cell: moves to right cell start (same row)', () => {
				plugin.moveToRightCellStart(makeEditor(2))
				expect(plugin.setCursorViaCm).toHaveBeenCalledWith(expect.anything(), 1, 6)
			})
		})

		describe('crossRowNavigation: ON', () => {
			beforeEach(() => {
				plugin.settings = { crossRowNavigation: true }
				plugin.getNextRowLine = vi.fn().mockReturnValue(2)
			})

			it('rightmost cell (non-last row): moves to next row leftmost cell start', () => {
				plugin.moveToRightCellStart(makeEditor(6))
				expect(plugin.setCursorViaCm).toHaveBeenCalledWith(expect.anything(), 2, 2)
			})
		})
	})
})
