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
	// computePrevRowLine
	// ===========================================================================

	describe('computePrevRowLine(currentLine, prevLineInTable, prevLineText)', () => {
		it('prevLineInTable: false — returns -1 (cursor is at top of table or above)', () => {
			expect(plugin.computePrevRowLine(5, false, '| some row |')).toBe(-1)
		})

		it('prevLineInTable: true, regular row — returns currentLine - 1', () => {
			expect(plugin.computePrevRowLine(5, true, '| data |')).toBe(4)
		})

		it('prevLineInTable: true, delimiter row | --- | — returns currentLine - 2', () => {
			expect(plugin.computePrevRowLine(5, true, '| --- |')).toBe(3)
		})

		it('prevLineInTable: true, delimiter with alignment | :---: | — returns currentLine - 2', () => {
			expect(plugin.computePrevRowLine(5, true, '| :---: |')).toBe(3)
		})

		// Regression: before the fix, /[:\s-]+/ matched spaces-only cells as delimiters,
		// causing getPrevRowLine to skip two lines instead of one.
		it('prevLineInTable: true, spaces-only |     | — NOT a delimiter, returns currentLine - 1', () => {
			expect(plugin.computePrevRowLine(5, true, '|     |')).toBe(4)
		})

		it('prevLineInTable: true, text content | abc | — NOT a delimiter, returns currentLine - 1', () => {
			expect(plugin.computePrevRowLine(5, true, '| abc |')).toBe(4)
		})
	})

	// ===========================================================================
	// computeNextRowLine
	// ===========================================================================

	describe('computeNextRowLine(currentLine, nextLineInTable, nextLineText, lineAfterNextInTable)', () => {
		it('nextLineInTable: false — returns -1 (cursor is at bottom of table or below)', () => {
			expect(plugin.computeNextRowLine(5, false, '| some row |', false)).toBe(-1)
		})

		it('nextLineInTable: true, regular row — returns currentLine + 1', () => {
			expect(plugin.computeNextRowLine(5, true, '| data |', false)).toBe(6)
		})

		it('nextLineInTable: true, delimiter row, lineAfterNextInTable: true — returns currentLine + 2', () => {
			expect(plugin.computeNextRowLine(5, true, '| --- |', true)).toBe(7)
		})

		// Header-only table: delimiter is line+1, but line+2 is outside the table or does not exist.
		// Without this guard, navigation from the header would land on a non-table line.
		it('nextLineInTable: true, delimiter row, lineAfterNextInTable: false — returns -1 (header-only table)', () => {
			expect(plugin.computeNextRowLine(5, true, '| --- |', false)).toBe(-1)
		})

		it('nextLineInTable: true, delimiter with alignment | :--- |, lineAfterNextInTable: true — returns currentLine + 2', () => {
			expect(plugin.computeNextRowLine(5, true, '| :--- |', true)).toBe(7)
		})

		// Regression: same root cause as computePrevRowLine — spaces-only cells must not
		// be treated as delimiter rows.
		it('nextLineInTable: true, spaces-only |     | — NOT a delimiter, returns currentLine + 1', () => {
			expect(plugin.computeNextRowLine(5, true, '|     |', false)).toBe(6)
		})

		it('nextLineInTable: true, text content | abc | — NOT a delimiter, returns currentLine + 1', () => {
			expect(plugin.computeNextRowLine(5, true, '| abc |', false)).toBe(6)
		})
	})
})
