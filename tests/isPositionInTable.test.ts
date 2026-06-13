import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import { syntaxTree } from '@codemirror/language'
import UniversalCursorHotkeysPlugin from '../main.ts'

describe('isPositionInTable', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		vi.mocked(syntaxTree).mockReset()
	})

	// ===========================================================================
	// alreadyInTable = true  (fast path: string check, no syntax tree walk)
	// ===========================================================================

	describe('alreadyInTable = true', () => {
		it('table line returns true', () => {
			const editor = { getLine: vi.fn(() => '| cell1 | cell2 |') }
			expect(plugin.isPositionInTable(editor, 0, 1, true)).toBe(true)
		})

		it('non-table line returns false', () => {
			const editor = { getLine: vi.fn(() => 'plain text') }
			expect(plugin.isPositionInTable(editor, 0, 1, true)).toBe(false)
		})

		it('leading spaces before pipe returns true', () => {
			const editor = { getLine: vi.fn(() => '  | cell |') }
			expect(plugin.isPositionInTable(editor, 0, 1, true)).toBe(true)
		})

		it('pipe not at start returns false', () => {
			const editor = { getLine: vi.fn(() => 'text | more') }
			expect(plugin.isPositionInTable(editor, 0, 1, true)).toBe(false)
		})

		it('does not call syntaxTree', () => {
			const editor = { getLine: vi.fn(() => '| cell |') }
			plugin.isPositionInTable(editor, 0, 1, true)
			expect(syntaxTree).not.toHaveBeenCalled()
		})
	})

	// ===========================================================================
	// alreadyInTable = false (default: syntax tree walk)
	// ===========================================================================

	describe('alreadyInTable = false (default)', () => {
		it('returns false when editor.cm is absent', () => {
			const editor = { posToOffset: vi.fn(), cm: null }
			expect(plugin.isPositionInTable(editor, 0, 1)).toBe(false)
			expect(syntaxTree).not.toHaveBeenCalled()
		})

		it('returns true when resolved node name includes "Table"', () => {
			const node = { name: 'HyperMD-table-row', parent: null }
			vi.mocked(syntaxTree).mockReturnValue({ resolveInner: vi.fn(() => node) } as any)
			const editor = { posToOffset: vi.fn(() => 10), cm: { state: {} } }
			expect(plugin.isPositionInTable(editor, 0, 1)).toBe(true)
		})

		it('returns true when ancestor node name includes "table" (lowercase)', () => {
			const parent = { name: 'table_something', parent: null }
			const child  = { name: 'leaf', parent }
			vi.mocked(syntaxTree).mockReturnValue({ resolveInner: vi.fn(() => child) } as any)
			const editor = { posToOffset: vi.fn(() => 5), cm: { state: {} } }
			expect(plugin.isPositionInTable(editor, 0, 1)).toBe(true)
		})

		it('returns false when no node in ancestry matches table', () => {
			const node = { name: 'paragraph', parent: { name: 'document', parent: null } }
			vi.mocked(syntaxTree).mockReturnValue({ resolveInner: vi.fn(() => node) } as any)
			const editor = { posToOffset: vi.fn(() => 5), cm: { state: {} } }
			expect(plugin.isPositionInTable(editor, 0, 1)).toBe(false)
		})
	})
})
