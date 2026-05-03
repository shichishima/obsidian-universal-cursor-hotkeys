import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// ---------------------------------------------------------------------------
// Minimal editor mock
// ---------------------------------------------------------------------------

function makeEditor(lineText: string, cursorCh: number) {
	const cursor = { line: 0, ch: cursorCh }
	return {
		getCursor:        vi.fn((_sel?: string) => ({ ...cursor })),
		getLine:          vi.fn(() => lineText),
		lineCount:        vi.fn(() => 1),
		replaceSelection: vi.fn(),
		setLine:          vi.fn(),
	}
}


describe('yank', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: true, crossRowNavigation: true }
		plugin.killCache = ''

		plugin.isLivePreviewMode = vi.fn().mockReturnValue(false)
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)
		plugin.setCursorViaCm    = vi.fn()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	// Helper: set up clipboard with a given value (or throw to simulate denial)
	function mockClipboard(value: string | null) {
		vi.stubGlobal('navigator', {
			clipboard: {
				readText: value === null
					? vi.fn().mockRejectedValue(new Error('denied'))
					: vi.fn().mockResolvedValue(value),
			},
		})
	}

	// ===========================================================================
	// Outside table — plain paste
	// ===========================================================================

	describe('outside table', () => {
		const cases: [string, string][] = [
			// [clipboard, expectedPasted]
			['hello',          'hello'],
			['line1\nline2',   'line1\nline2'],
			['a | b',          'a | b'],          // pipes not escaped outside table
		]

		for (const [clipboard, expected] of cases) {
			it(`pastes "${clipboard}" as-is`, async () => {
				mockClipboard(clipboard)
				const editor = makeEditor('some text', 4)
				await plugin.yank(editor)
				expect(editor.replaceSelection).toHaveBeenCalledWith(expected)
			})
		}

		it('does nothing when clipboard is empty', async () => {
			mockClipboard('')
			const editor = makeEditor('some text', 4)
			await plugin.yank(editor)
			expect(editor.replaceSelection).not.toHaveBeenCalled()
		})
	})

	// ===========================================================================
	// Source mode table — conversion applied
	// ===========================================================================

	describe('source mode table (isTableLineSourceMode)', () => {
		const cases: [string, string][] = [
			// [clipboard, expectedPasted]
			['hello',           'hello'],
			['line1\nline2',    'line1<br>line2'],   // \n → <br>
			['a | b',           'a \\| b'],           // | → \|
			['a | b\nc | d',    'a \\| b<br>c \\| d'],
		]

		for (const [clipboard, expected] of cases) {
			it(`pastes "${clipboard}" → "${expected}"`, async () => {
				mockClipboard(clipboard)
				// isTableLineSourceMode returns true when line starts and ends with |
				const editor = makeEditor('| cell |', 3)
				plugin.isLivePreviewMode.mockReturnValue(false)
				// isTableLineSourceMode is a real method — it reads getLine result
				await plugin.yank(editor)
				expect(editor.replaceSelection).toHaveBeenCalledWith(expected)
			})
		}
	})

	// ===========================================================================
	// Live Preview table — conversion applied, simple (no <br> in result)
	// ===========================================================================

	describe('LP table — no <br> in pasted text', () => {
		beforeEach(() => {
			plugin.isLivePreviewMode.mockReturnValue(true)
			plugin.isPositionInTable.mockReturnValue(true)
		})

		it('pastes plain text without setTimeout path', async () => {
			mockClipboard('hello')
			const editor = makeEditor('| cell |', 3)
			await plugin.yank(editor)
			expect(editor.replaceSelection).toHaveBeenCalledWith('hello')
			expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		})

		it('escapes pipe but no <br> → uses replaceSelection directly', async () => {
			mockClipboard('a | b')
			const editor = makeEditor('| cell |', 3)
			await plugin.yank(editor)
			expect(editor.replaceSelection).toHaveBeenCalledWith('a \\| b')
			expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		})
	})

	// ===========================================================================
	// Live Preview table — <br> in pasted text → deferred cursor restore
	// ===========================================================================

	describe('LP table — <br> in pasted text (deferred cursor)', () => {
		beforeEach(() => {
			vi.useFakeTimers()
			plugin.isLivePreviewMode.mockReturnValue(true)
			plugin.isPositionInTable.mockReturnValue(true)
		})

		it('calls replaceSelection then defers setCursorViaCm to after insert', async () => {
			// clipboard: 'line1\nline2' → converted to 'line1<br>line2' (length 14)
			mockClipboard('line1\nline2')
			const editor = makeEditor('| cell |', 3)
			// cursor at ch=3; text becomes 'line1<br>line2' (14 chars) → targetCh = 3+14 = 17
			await plugin.yank(editor)

			expect(editor.replaceSelection).toHaveBeenCalledWith('line1<br>line2')
			// setCursorViaCm not yet called
			expect(plugin.setCursorViaCm).not.toHaveBeenCalled()

			vi.runAllTimers()
			expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 17)
		})

		it('combined pipe escape + newline: correct deferred position', async () => {
			// clipboard: 'a | b\nc' → 'a \\| b<br>c' (length 11)
			mockClipboard('a | b\nc')
			const editor = makeEditor('| cell |', 2)
			await plugin.yank(editor)

			expect(editor.replaceSelection).toHaveBeenCalledWith('a \\| b<br>c')

			vi.runAllTimers()
			expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 13)
		})
	})

	// ===========================================================================
	// Clipboard read failure → falls back to killCache
	// ===========================================================================

	describe('clipboard fallback to killCache', () => {
		it('uses killCache when clipboard read throws', async () => {
			mockClipboard(null)
			plugin.killCache = 'cached text'
			const editor = makeEditor('normal line', 0)
			await plugin.yank(editor)
			expect(editor.replaceSelection).toHaveBeenCalledWith('cached text')
		})

		it('does nothing when clipboard throws and killCache is empty', async () => {
			mockClipboard(null)
			plugin.killCache = ''
			const editor = makeEditor('normal line', 0)
			await plugin.yank(editor)
			expect(editor.replaceSelection).not.toHaveBeenCalled()
		})
	})
})
