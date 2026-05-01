import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

describe('rowNavigation', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
	})

	// ===========================================================================
	// computePrevRowLine(currentLine, prevLineInTable, prevLineText)
	// ===========================================================================

	describe('computePrevRowLine', () => {
		// [prevLineInTable, prevLineText, expected]
		const cases: [boolean, string, number][] = [
			// not in table
			[false, '| some row |',  -1],
			// regular rows -> currentLine - 1
			[true,  '| data |',       4],
			[true,  '| abc |',        4],
			// delimiter row -> skip to currentLine - 2
			[true,  '| --- |',        3],
			[true,  '| :---: |',      3],
			[true,  '| ---: |',       3],
			// regression: spaces-only cell must NOT be treated as a delimiter
			[true,  '|     |',        4],
		]

		for (const [prevInTable, text, expected] of cases) {
			it(`(prevInTable=${prevInTable}, "${text}") → ${expected}`, () => {
				expect(plugin.computePrevRowLine(5, prevInTable, text)).toBe(expected)
			})
		}
	})

	// ===========================================================================
	// computeNextRowLine(currentLine, nextLineInTable, nextLineText, lineAfterNextInTable)
	// ===========================================================================

	describe('computeNextRowLine', () => {
		// [nextLineInTable, nextLineText, lineAfterNextInTable, expected]
		const cases: [boolean, string, boolean, number][] = [
			// not in table
			[false, '| some row |', false, -1],
			// regular rows -> currentLine + 1
			[true,  '| data |',     false,  6],
			[true,  '| abc |',      false,  6],
			// delimiter row + next row exists -> currentLine + 2
			[true,  '| --- |',      true,   7],
			[true,  '| :--- |',     true,   7],
			// delimiter row + no row after (header-only table) -> -1
			[true,  '| --- |',      false, -1],
			// regression: spaces-only cell must NOT be treated as a delimiter
			[true,  '|     |',      false,  6],
		]

		for (const [nextInTable, text, afterNext, expected] of cases) {
			it(`(nextInTable=${nextInTable}, "${text}", afterNext=${afterNext}) → ${expected}`, () => {
				expect(plugin.computeNextRowLine(5, nextInTable, text, afterNext)).toBe(expected)
			})
		}
	})
})
