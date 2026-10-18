import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorSelection } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../../src/main.ts'

// Copy Region (Alt-W) — the non-destructive sibling of Kill Region, sharing
// its per-range validation (isValidRegionRangeOuter) and multi-cursor
// looping, but never dispatching any change. Structured to mirror
// killRegion.test.ts, minus the deletion-dispatch assertions.

function makeMultiSelectionPlainEditor(
	lines: string[],
	ranges: { from: { line: number; ch: number }; to: { line: number; ch: number } }[],
	mainIndex: number,
) {
	const buf = [...lines]
	const posToOffset = (pos: { line: number; ch: number }) => pos.line * 1000 + pos.ch
	const offsetToPos = (offset: number) => ({ line: Math.floor(offset / 1000), ch: offset % 1000 })
	const selection = EditorSelection.create(
		ranges.map(r => EditorSelection.range(posToOffset(r.from), posToOffset(r.to))),
		mainIndex,
	)
	return {
		getLine: vi.fn((line: number) => buf[line] ?? ''),
		lineCount: vi.fn(() => buf.length),
		getRange: vi.fn((f: any, t: any) => buf[f.line].slice(f.ch, t.ch)),
		posToOffset: vi.fn(posToOffset),
		offsetToPos: vi.fn(offsetToPos),
		inTableCell: false,
		cm: {
			state: { selection },
			dispatch: vi.fn(),
			scrollDOM: { scrollTop: 0 },
		},
		activeCM: undefined,
		_buf: buf,
	}
}

function makeMultiSelectionLPEditor(innerText: string, ranges: { from: number; to: number }[], mainIndex: number) {
	const dispatch = vi.fn()
	const inner = {
		state: {
			doc: { sliceString: (from: number, to?: number) => innerText.slice(from, to) },
			selection: EditorSelection.create(ranges.map(r => EditorSelection.range(r.from, r.to)), mainIndex),
		},
		dispatch,
	}
	return {
		activeCM: inner,
		cm: { scrollDOM: { scrollTop: 0 } },
		inTableCell: true,
		_innerDispatch: dispatch,
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


	describe('outer (plain text / Source Mode)', () => {
		it('empty selection: no-op', () => {
			const editor = makeMultiSelectionPlainEditor(['hello world'], [{ from: { line: 0, ch: 3 }, to: { line: 0, ch: 3 } }], 0)
			plugin.copyRegion(editor)
			expect(plugin.killCache).toBe('')
			expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
		})

		it('Source table — cross-cell selection: no-op', () => {
			const editor = makeMultiSelectionPlainEditor(['| cell1 | cell2 |'], [{ from: { line: 0, ch: 2 }, to: { line: 0, ch: 12 } }], 0)
			plugin.copyRegion(editor)
			expect(plugin.killCache).toBe('')
		})

		it('never dispatches a change', () => {
			const editor = makeMultiSelectionPlainEditor(['hello world'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } }], 0)
			plugin.copyRegion(editor)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
		})

		it('stores raw selected text in killCache without normalization (plain text)', () => {
			const editor = makeMultiSelectionPlainEditor(['a | b<br>c end'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 14 } }], 0)
			plugin.copyRegion(editor)
			expect(plugin.killCache).toBe('a | b<br>c end')
		})

		it('applies normalizeKillText in Source Mode: <br> -> \\n, \\| -> |', () => {
			const editor = makeMultiSelectionPlainEditor(['| ab<br>cd |'], [{ from: { line: 0, ch: 2 }, to: { line: 0, ch: 10 } }], 0)
			plugin.copyRegion(editor)
			expect(plugin.killCache).toBe('ab\ncd')
		})

		it('writes killCache to clipboard', () => {
			const editor = makeMultiSelectionPlainEditor(['hello world'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } }], 0)
			plugin.copyRegion(editor)
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
		})

		it('resets isKillChaining to false, breaking a pending Kill Line chain, and does NOT re-enable chaining', () => {
			plugin.isKillChaining = true
			plugin.killCache = 'previously killed text'
			const editor = makeMultiSelectionPlainEditor(['hello world'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } }], 0)
			plugin.copyRegion(editor)
			expect(plugin.isKillChaining).toBe(false)
			expect(plugin.killCache).toBe('hello') // replaced, not appended
		})

		// Set-mark category A: an operation that consumes/destroys the
		// active selection deactivates the mark.
		it('deactivates Set-mark (markActive)', () => {
			plugin.markActive = true
			const editor = makeMultiSelectionPlainEditor(['hello world'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } }], 0)
			plugin.copyRegion(editor)
			expect(plugin.markActive).toBe(false)
		})

		describe('multi-cursor', () => {
			it('each non-empty range copies its own selection independently, joined with \\n', () => {
				const editor = makeMultiSelectionPlainEditor(
					['foo bar', 'baz qux'],
					[
						{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 } },
						{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 3 } },
					],
					0,
				)
				plugin.copyRegion(editor)
				expect(plugin.killCache).toBe('foo\nbaz')
				expect(editor.cm.dispatch).not.toHaveBeenCalled()
			})

			it('a secondary selection crossing a Source Mode table boundary is excluded; primary still copied', () => {
				const editor = makeMultiSelectionPlainEditor(
					['foo bar', '| cell1 | cell2 |'],
					[
						{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 } },
						{ from: { line: 1, ch: 2 }, to: { line: 1, ch: 12 } },
					],
					0,
				)
				plugin.copyRegion(editor)
				expect(plugin.killCache).toBe('foo')
			})

			it("primary's own invalid selection no longer blocks a valid secondary from being copied", () => {
				const editor = makeMultiSelectionPlainEditor(
					['| cell1 | cell2 |', 'foo bar'],
					[
						{ from: { line: 0, ch: 2 }, to: { line: 0, ch: 12 } }, // main — invalid
						{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 3 } },  // secondary — valid
					],
					0,
				)
				plugin.copyRegion(editor)
				expect(plugin.killCache).toBe('foo')
			})
		})
	})


	describe('LP table cell', () => {
		it('no-op when not inside a table cell (activeCM === cm)', () => {
			const editor = { activeCM: {}, cm: {}, inTableCell: true } as any
			editor.activeCM = editor.cm
			expect(() => plugin.copyRegion(editor)).not.toThrow()
		})

		it('copies the selected range within the cell, never dispatching', () => {
			const editor = makeMultiSelectionLPEditor('hello world', [{ from: 2, to: 7 }], 0)
			plugin.copyRegion(editor)
			expect(plugin.killCache).toBe('llo w')
			expect(editor._innerDispatch).not.toHaveBeenCalled()
		})

		it('writes killCache to clipboard', () => {
			const editor = makeMultiSelectionLPEditor('hello', [{ from: 0, to: 5 }], 0)
			plugin.copyRegion(editor)
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
		})

		it('deactivates Set-mark (markActive)', () => {
			plugin.markActive = true
			const editor = makeMultiSelectionLPEditor('hello', [{ from: 0, to: 5 }], 0)
			plugin.copyRegion(editor)
			expect(plugin.markActive).toBe(false)
		})

		describe('multi-cursor', () => {
			it('each non-empty range within the cell copies its own selection independently, joined with \\n', () => {
				const editor = makeMultiSelectionLPEditor('foo bar', [{ from: 0, to: 3 }, { from: 4, to: 7 }], 0)
				plugin.copyRegion(editor)
				expect(plugin.killCache).toBe('foo\nbar')
			})

			it('an empty secondary range is excluded; non-empty primary still copied', () => {
				const editor = makeMultiSelectionLPEditor('foo bar', [{ from: 0, to: 3 }, { from: 5, to: 5 }], 0)
				plugin.copyRegion(editor)
				expect(plugin.killCache).toBe('foo')
			})
		})
	})
})
