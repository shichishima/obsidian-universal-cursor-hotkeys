import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// Copy Region (Alt-W) — the non-destructive sibling of Kill Region, sharing
// its selection-validation/normalization logic (getValidatedRegionText) but
// never mutating the editor. Structured to mirror killRegion.test.ts, minus
// the deletion-dispatch assertions (replaced with "never mutates" checks).

function makeEditor(
	lines: string[],
	from: { line: number; ch: number },
	to:   { line: number; ch: number },
	inTableCell = false
) {
	const buf = [...lines]
	const sel = (from.line === to.line)
		? (buf[from.line] ?? '').slice(from.ch, to.ch)
		: ''
	return {
		getCursor:    vi.fn((s?: string) => s === 'to' ? { ...to } : { ...from }),
		getLine:      vi.fn((n: number) => buf[n] ?? ''),
		getSelection: vi.fn(() => sel),
		replaceRange: vi.fn(),
		setLine:      vi.fn(),
		_buf: buf,
		cm: {
			dispatch: vi.fn(),
			focus:    vi.fn(),
		},
		inTableCell,
	}
}


describe('copyRegion', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.isKillChaining    = false
		plugin.isDispatchingKill = false
		plugin.killCache         = ''

		plugin.isLivePreviewMode = vi.fn().mockReturnValue(false)

		vi.stubGlobal('navigator', {
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})


	// ===========================================================================
	// no-op guards
	// ===========================================================================

	describe('no-op', () => {
		it('empty selection (from === to)', () => {
			const pos = { line: 0, ch: 3 }
			const editor = makeEditor(['hello world'], pos, pos)
			plugin.copyRegion(editor)
			expect(plugin.killCache).toBe('')
			expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
		})

		it('LP table — multi-line selection', () => {
			plugin.isLivePreviewMode.mockReturnValue(true)
			const editor = makeEditor(
				['| a | b |', '| c | d |'],
				{ line: 0, ch: 2 },
				{ line: 1, ch: 2 },
				true
			)
			plugin.copyRegion(editor)
			expect(plugin.killCache).toBe('')
		})

		it('LP table — cross-cell selection (fromBounds.open !== toBounds.open)', () => {
			plugin.isLivePreviewMode.mockReturnValue(true)
			const editor = makeEditor(
				['| cell1 | cell2 |'],
				{ line: 0, ch: 2 },
				{ line: 0, ch: 12 },
				true
			)
			plugin.copyRegion(editor)
			expect(plugin.killCache).toBe('')
		})

		it('Source table — multi-line selection', () => {
			const editor = makeEditor(
				['| a | b |', '| c | d |'],
				{ line: 0, ch: 2 },
				{ line: 1, ch: 2 }
			)
			plugin.copyRegion(editor)
			expect(plugin.killCache).toBe('')
		})
	})


	// ===========================================================================
	// non-destructive: never touches the editor
	// ===========================================================================

	describe('never mutates the editor', () => {
		it('plain text: no replaceRange, no cm.dispatch', () => {
			const editor = makeEditor(['hello world'], { line: 0, ch: 0 }, { line: 0, ch: 5 })
			plugin.copyRegion(editor)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(editor.setLine).not.toHaveBeenCalled()
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
		})

		it('LP table single-cell: no replaceRange, no cm.dispatch', () => {
			plugin.isLivePreviewMode.mockReturnValue(true)
			const line = '| hello world |'
			const editor = makeEditor([line], { line: 0, ch: 2 }, { line: 0, ch: 8 }, true)
			plugin.copyRegion(editor)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
		})
	})


	// ===========================================================================
	// non-table copy
	// ===========================================================================

	describe('non-table copy', () => {
		it('stores raw selected text in killCache without normalization', () => {
			const editor = makeEditor(['a | b<br>c end'], { line: 0, ch: 0 }, { line: 0, ch: 14 })
			plugin.copyRegion(editor)
			expect(plugin.killCache).toBe('a | b<br>c end')
		})

		it('writes killCache to clipboard', () => {
			const editor = makeEditor(['hello world'], { line: 0, ch: 0 }, { line: 0, ch: 5 })
			plugin.copyRegion(editor)
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
		})

		it('resets isKillChaining to false, breaking a pending Kill Line chain', () => {
			plugin.isKillChaining = true
			plugin.killCache = 'previously killed text'
			const editor = makeEditor(['hello world'], { line: 0, ch: 0 }, { line: 0, ch: 5 })
			plugin.copyRegion(editor)
			expect(plugin.isKillChaining).toBe(false)
			expect(plugin.killCache).toBe('hello') // replaced, not appended
		})
	})


	// ===========================================================================
	// LP table — single-cell copy
	// ===========================================================================

	describe('LP table — single-cell copy', () => {
		beforeEach(() => {
			plugin.isLivePreviewMode.mockReturnValue(true)
		})

		it('applies normalizeKillText: <br> -> \\n in killCache', () => {
			// '| ab<br>cd |': from=2, to=10 -> selection='ab<br>cd' -> normalized='ab\ncd'
			const line = '| ab<br>cd |'
			const editor = makeEditor([line], { line: 0, ch: 2 }, { line: 0, ch: 10 }, true)
			plugin.copyRegion(editor)
			expect(plugin.killCache).toBe('ab\ncd')
		})

		it('applies normalizeKillText: \\| -> | in killCache', () => {
			const line = '| a\\|b |'
			const editor = makeEditor([line], { line: 0, ch: 2 }, { line: 0, ch: 6 }, true)
			plugin.copyRegion(editor)
			expect(plugin.killCache).toBe('a|b')
		})

		it('writes killCache to clipboard', () => {
			const line = '| hello |'
			const editor = makeEditor([line], { line: 0, ch: 2 }, { line: 0, ch: 7 }, true)
			plugin.copyRegion(editor)
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
		})
	})


	// ===========================================================================
	// Source table — single-cell copy
	// ===========================================================================

	describe('Source table — single-cell copy', () => {
		it('applies normalizeKillText: <br> -> \\n in killCache', () => {
			const line = '| ab<br>cd |'
			const editor = makeEditor([line], { line: 0, ch: 2 }, { line: 0, ch: 10 })
			plugin.copyRegion(editor)
			expect(plugin.killCache).toBe('ab\ncd')
		})

		it('does not mutate the editor', () => {
			const line = '| hello world |'
			const editor = makeEditor([line], { line: 0, ch: 2 }, { line: 0, ch: 8 })
			plugin.copyRegion(editor)
			expect(editor.replaceRange).not.toHaveBeenCalled()
		})
	})
})
