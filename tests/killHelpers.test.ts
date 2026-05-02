import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

describe('killHelpers', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.isKillChaining = false
		plugin.killCache = ''
	})

	// ===========================================================================
	// normalizeKillText
	// ===========================================================================

	describe('normalizeKillText', () => {
		const cases: [string, string][] = [
			// plain text unchanged
			['hello world',           'hello world'],
			// <br> → \n
			['line1<br>line2',        'line1\nline2'],
			// case-insensitive <BR>
			['line1<BR>line2',        'line1\nline2'],
			// mixed case <bR>
			['line1<bR>line2',        'line1\nline2'],
			// multiple <br>
			['a<br>b<br>c',           'a\nb\nc'],
			// escaped pipe → plain pipe
			['cell \\| content',      'cell | content'],
			// multiple escaped pipes
			['a \\| b \\| c',         'a | b | c'],
			// combined <br> and \|
			['a<br>b \\| c',          'a\nb | c'],
			// no special chars
			['',                      ''],
		]

		for (const [input, expected] of cases) {
			it(`"${input}" → "${expected}"`, () => {
				expect(plugin.normalizeKillText(input)).toBe(expected)
			})
		}
	})

	// ===========================================================================
	// updateKillCache
	// ===========================================================================

	describe('updateKillCache', () => {
		it('overwrites cache when not chaining', () => {
			plugin.killCache = 'old'
			plugin.isKillChaining = false
			plugin.updateKillCache('new')
			expect(plugin.killCache).toBe('new')
		})

		it('appends to cache when chaining', () => {
			plugin.killCache = 'first'
			plugin.isKillChaining = true
			plugin.updateKillCache(' second')
			expect(plugin.killCache).toBe('first second')
		})

		it('appends newline during chained kill at line end', () => {
			plugin.killCache = 'line1'
			plugin.isKillChaining = true
			plugin.updateKillCache('\n')
			expect(plugin.killCache).toBe('line1\n')
		})

		it('appends further text after newline accumulation', () => {
			plugin.killCache = 'line1\n'
			plugin.isKillChaining = true
			plugin.updateKillCache('line2')
			expect(plugin.killCache).toBe('line1\nline2')
		})

		it('replaces when cache is non-empty but not chaining', () => {
			plugin.killCache = 'stale'
			plugin.isKillChaining = false
			plugin.updateKillCache('fresh')
			expect(plugin.killCache).toBe('fresh')
		})
	})

	// ===========================================================================
	// isTableLineSourceMode
	// ===========================================================================

	describe('isTableLineSourceMode', () => {
		const trueCases: string[] = [
			'| a | b |',
			'| header |',
			'| --- |',
			'|a|',
			'| a |  ',            // trailing spaces trimmed
		]
		const falseCases: string[] = [
			'no pipes here',
			'| starts but no end',
			'ends but no start |',
			'',
			'  | indented |',     // starts with spaces, not |
		]

		for (const line of trueCases) {
			it(`true: "${line}"`, () => {
				expect(plugin.isTableLineSourceMode(line)).toBe(true)
			})
		}
		for (const line of falseCases) {
			it(`false: "${line}"`, () => {
				expect(plugin.isTableLineSourceMode(line)).toBe(false)
			})
		}
	})
})
