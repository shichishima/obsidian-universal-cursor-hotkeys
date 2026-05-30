import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

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
	const lineStarts = lines.reduce((acc, _, i) => {
		acc.push(i === 0 ? 0 : acc[i - 1] + lines[i - 1].length + 1)
		return acc
	}, [] as number[])
	return {
		getCursor:    vi.fn((s?: string) => s === 'to' ? { ...to } : { ...from }),
		getLine:      vi.fn((n: number) => buf[n] ?? ''),
		getSelection: vi.fn(() => sel),
		replaceRange: vi.fn(),
		setLine:      vi.fn(),
		_buf: buf,
		cm: {
			state: {
				doc: {
					line: vi.fn((n: number) => {
						const idx  = n - 1
						const from = lineStarts[idx] ?? 0
						return { from, to: from + (lines[idx]?.length ?? 0) }
					}),
				},
			},
			scrollDOM: { scrollTop: 0 },
			dispatch:  vi.fn(),
			focus:     vi.fn(),
		},
		inTableCell,
	}
}


describe('killRegion', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: true, crossRowNavigation: true }
		plugin.isKillChaining    = false
		plugin.isDispatchingKill = false
		plugin.killCache         = ''

		plugin.isLivePreviewMode = vi.fn().mockReturnValue(false)
		plugin.setCursorViaCm    = vi.fn()

		vi.stubGlobal('navigator', {
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
		})
		vi.stubGlobal('window', globalThis)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})


	// ===========================================================================
	// no-op guards
	// ===========================================================================

	describe('no-op', () => {
		it('empty selection (from === to)', () => {
			const pos = { line: 0, ch: 3 }
			const editor = makeEditor(['hello world'], pos, pos)
			plugin.killRegion(editor)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(editor.setLine).not.toHaveBeenCalled()
		})

		it('LP table — multi-line selection', () => {
			plugin.isLivePreviewMode.mockReturnValue(true)
			const editor = makeEditor(
				['| a | b |', '| c | d |'],
				{ line: 0, ch: 2 },
				{ line: 1, ch: 2 },
				true
			)
			plugin.killRegion(editor)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(editor.setLine).not.toHaveBeenCalled()
		})

		it('LP table — cross-cell selection (fromBounds.open !== toBounds.open)', () => {
			plugin.isLivePreviewMode.mockReturnValue(true)
			// | cell1 | cell2 | — ch=2 in cell1 (open=0), ch=12 in cell2 (open=8)
			const editor = makeEditor(
				['| cell1 | cell2 |'],
				{ line: 0, ch: 2 },
				{ line: 0, ch: 12 },
				true
			)
			plugin.killRegion(editor)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(editor.setLine).not.toHaveBeenCalled()
		})

		it('Source table — multi-line selection', () => {
			const editor = makeEditor(
				['| a | b |', '| c | d |'],
				{ line: 0, ch: 2 },
				{ line: 1, ch: 2 }
			)
			plugin.killRegion(editor)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(editor.setLine).not.toHaveBeenCalled()
		})

		it('Source table — cross-cell selection', () => {
			// isTableLineSourceMode returns true for lines starting/ending with |
			const editor = makeEditor(
				['| cell1 | cell2 |'],
				{ line: 0, ch: 2 },
				{ line: 0, ch: 12 }
			)
			plugin.killRegion(editor)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(editor.setLine).not.toHaveBeenCalled()
		})
	})


	// ===========================================================================
	// Non-table deletion
	// ===========================================================================

	describe('non-table deletion', () => {
		it('calls replaceRange with empty string for the selected range', () => {
			const from = { line: 0, ch: 2 }
			const to   = { line: 0, ch: 7 }
			const editor = makeEditor(['hello world'], from, to)
			plugin.killRegion(editor)
			expect(editor.replaceRange).toHaveBeenCalledWith('', from, to)
			expect(editor.setLine).not.toHaveBeenCalled()
		})

		it('stores raw selected text in killCache without normalization', () => {
			// Pipes and <br> must NOT be escaped/normalized outside a table
			const from = { line: 0, ch: 0 }
			const to   = { line: 0, ch: 14 }
			const editor = makeEditor(['a | b<br>c end'], from, to)
			plugin.killRegion(editor)
			expect(plugin.killCache).toBe('a | b<br>c end')
		})

		it('writes killCache to clipboard', () => {
			const from = { line: 0, ch: 0 }
			const to   = { line: 0, ch: 5 }
			const editor = makeEditor(['hello world'], from, to)
			plugin.killRegion(editor)
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
		})

		it('resets isKillChaining to false', () => {
			plugin.isKillChaining = true
			const from = { line: 0, ch: 0 }
			const to   = { line: 0, ch: 5 }
			const editor = makeEditor(['hello world'], from, to)
			plugin.killRegion(editor)
			expect(plugin.isKillChaining).toBe(false)
		})
	})


	// ===========================================================================
	// LP table — single-cell deletion
	// ===========================================================================

	describe('LP table — single-cell deletion', () => {
		beforeEach(() => {
			plugin.isLivePreviewMode.mockReturnValue(true)
		})

		it('dispatches changes with prefix + suffix', () => {
			// '| hello world |' — delete 'hello ' (ch=2..8) → '| world |'
			const line = '| hello world |'
			const editor = makeEditor([line], { line: 0, ch: 2 }, { line: 0, ch: 8 }, true)
			plugin.killRegion(editor)
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes:   { from: 0, to: line.length, insert: '| world |' },
				selection: { anchor: 2 },
			})
			expect(editor.replaceRange).not.toHaveBeenCalled()
		})

		it('dispatches selection anchor at prefix.length', () => {
			const line = '| hello world |'
			const editor = makeEditor([line], { line: 0, ch: 2 }, { line: 0, ch: 8 }, true)
			plugin.killRegion(editor)
			const call = editor.cm.dispatch.mock.calls[0][0]
			expect(call.selection.anchor).toBe(2)
		})

		it('applies normalizeKillText: <br> → \\n in killCache', () => {
			// '| ab<br>cd |': from=2, to=10 → selection='ab<br>cd' → normalized='ab\ncd'
			// |=0 ' '=1 a=2 b=3 <=4 b=5 r=6 >=7 c=8 d=9 ' '=10 |=11
			const line = '| ab<br>cd |'
			const editor = makeEditor([line], { line: 0, ch: 2 }, { line: 0, ch: 10 }, true)
			plugin.killRegion(editor)
			expect(plugin.killCache).toBe('ab\ncd')
		})

		it('applies normalizeKillText: \\| → | in killCache', () => {
			// '| a\\|b |': from=2, to=6 → selection='a\\|b' → normalized='a|b'
			const line = '| a\\|b |'
			const editor = makeEditor([line], { line: 0, ch: 2 }, { line: 0, ch: 6 }, true)
			plugin.killRegion(editor)
			expect(plugin.killCache).toBe('a|b')
		})

		it('writes killCache to clipboard', () => {
			const line = '| hello |'
			const editor = makeEditor([line], { line: 0, ch: 2 }, { line: 0, ch: 7 }, true)
			plugin.killRegion(editor)
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
		})

		it('resets isKillChaining to false', () => {
			plugin.isKillChaining = true
			const line = '| hello |'
			const editor = makeEditor([line], { line: 0, ch: 2 }, { line: 0, ch: 7 }, true)
			plugin.killRegion(editor)
			expect(plugin.isKillChaining).toBe(false)
		})
	})


	// ===========================================================================
	// LP table — <br> handling
	// ===========================================================================

	describe('LP table — <br> handling', () => {
		// '| first<br>second |'
		// |=0 ' '=1 f=2 i=3 r=4 s=5 t=6 <=7 b=8 r=9 >=10 s=11 e=12 c=13 o=14 n=15 d=16 ' '=17 |=18
		// brStart=7 (position of '<'), brEnd=11 (position of 's' in 'second')
		const LINE = '| first<br>second |'

		beforeEach(() => {
			plugin.isLivePreviewMode.mockReturnValue(true)
		})

		it('selection spanning <br>: <br> absent from dispatch result', () => {
			// from=3 (within 'first'), to=14 (within 'second' past brEnd=11)
			// prefix='| f', suffix='ond |' → '| fond |'
			const editor = makeEditor([LINE], { line: 0, ch: 3 }, { line: 0, ch: 14 }, true)
			plugin.killRegion(editor)
			expect(editor.cm.dispatch.mock.calls[0][0].changes.insert).toBe('| fond |')
		})

		it('to.ch = brStart, prefix has no cell content → strip <br> from suffix', () => {
			// from=2 (cell content start), to=7 (brStart)
			// cellContentBefore = line.slice(1,2).trim() = '' → strip
			// prefix='| ', suffix='second |' → '| second |'
			const editor = makeEditor([LINE], { line: 0, ch: 2 }, { line: 0, ch: 7 }, true)
			plugin.killRegion(editor)
			expect(editor.cm.dispatch.mock.calls[0][0].changes.insert).toBe('| second |')
		})

		it('to.ch = brStart, prefix HAS cell content → keep <br> in suffix', () => {
			// from=3 ('i'), to=7 (brStart)
			// cellContentBefore = line.slice(1,3).trim() = 'f' → no strip
			// prefix='| f', suffix='<br>second |' → '| f<br>second |'
			const editor = makeEditor([LINE], { line: 0, ch: 3 }, { line: 0, ch: 7 }, true)
			plugin.killRegion(editor)
			expect(editor.cm.dispatch.mock.calls[0][0].changes.insert).toBe('| f<br>second |')
		})

		it('from.ch = brEnd, suffix has no cell content → strip <br> from prefix', () => {
			// from=11 (brEnd), to=17 (space before '|')
			// cellContentAfter = line.slice(17,18).trim() = '' → strip
			// prefix='| first' (after strip), suffix=' |' → '| first |'
			const editor = makeEditor([LINE], { line: 0, ch: 11 }, { line: 0, ch: 17 }, true)
			plugin.killRegion(editor)
			expect(editor.cm.dispatch.mock.calls[0][0].changes.insert).toBe('| first |')
		})

		it('from.ch = brEnd, suffix HAS cell content → keep <br> in prefix', () => {
			// from=11 (brEnd), to=14 (after 'sec')
			// cellContentAfter = line.slice(14,18).trim() = 'ond' → no strip
			// prefix='| first<br>', suffix='ond |' → '| first<br>ond |'
			const editor = makeEditor([LINE], { line: 0, ch: 11 }, { line: 0, ch: 14 }, true)
			plugin.killRegion(editor)
			expect(editor.cm.dispatch.mock.calls[0][0].changes.insert).toBe('| first<br>ond |')
		})
	})


	// ===========================================================================
	// Source table — single-cell deletion
	// ===========================================================================

	describe('Source table — single-cell deletion', () => {
		it('calls replaceRange for single-cell selection', () => {
			const line = '| hello world |'
			const from = { line: 0, ch: 2 }
			const to   = { line: 0, ch: 8 }
			const editor = makeEditor([line], from, to)
			plugin.killRegion(editor)
			expect(editor.replaceRange).toHaveBeenCalledWith('', from, to)
			expect(editor.setLine).not.toHaveBeenCalled()
		})

		it('applies normalizeKillText: <br> → \\n in killCache', () => {
			// Source cell with literal <br> tag; from=2, to=10 → 'ab<br>cd' → 'ab\ncd'
			const line = '| ab<br>cd |'
			const editor = makeEditor([line], { line: 0, ch: 2 }, { line: 0, ch: 10 })
			plugin.killRegion(editor)
			expect(plugin.killCache).toBe('ab\ncd')
		})
	})
})
