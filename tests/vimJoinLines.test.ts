import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'
import { installVimWindow, uninstallVimWindow } from './__helpers__/vimWindow'

// Vim's J (joinLines action). Structure mirrors vim.js's own joinLines
// (traced from its source): normal-mode (repeat-based) and visual-mode
// (anchor..head) paths share one per-line join loop, differing only in the
// per-join whitespace-vs-Markdown-stripping decision (smartJoin).

function makeVimCm(lines: string[], cursor: { line: number; ch: number }, visual?: { anchor: { line: number; ch: number }; head: { line: number; ch: number } }) {
	const buf = [...lines]
	let cur = cursor
	return {
		getLine: (n: number) => buf[n] ?? '',
		lastLine: () => buf.length - 1,
		getCursor: (mode?: string) => {
			if (mode === 'anchor' && visual) return visual.anchor
			if (mode === 'head' && visual) return visual.head
			return cur
		},
		setCursor: (pos: { line: number; ch: number }) => { cur = pos },
		replaceRange: (text: string, from: { line: number; ch: number }, to: { line: number; ch: number }) => {
			if (from.line === to.line) {
				buf[from.line] = buf[from.line].slice(0, from.ch) + text + buf[from.line].slice(to.ch)
			} else {
				const merged = buf[from.line].slice(0, from.ch) + text + buf[to.line].slice(to.ch)
				buf.splice(from.line, to.line - from.line + 1, merged)
			}
		},
		_buf: buf,
		_getCursor: () => cur,
	}
}

const makeHost = (overrides: Partial<VimSupportHost> = {}): VimSupportHost => ({
	settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, vimGgSupport: false, vimDisplayLineSupport: false, vimEolSupport: false, smartJoin: false, smartHomeStandard: false },
	saveSettings: async () => {},
	crossTableRowForCell: vi.fn().mockReturnValue(null),
	crossTableRowForWord: vi.fn().mockReturnValue(null),
	jumpToDocumentLine: vi.fn().mockReturnValue(null),
	isLinePartOfTable: vi.fn().mockReturnValue(false),
	enterTableAtLine: vi.fn().mockReturnValue(null),
	refineDisplayLineColumn: vi.fn().mockReturnValue(null),
	getBeginningOfLinePosition: vi.fn().mockReturnValue(0),
	...overrides,
})

describe('Vim J (joinLines)', () => {
	describe('smartJoin off — matches vim.js default', () => {
		it('strips the next line\'s leading whitespace and inserts one space', () => {
			const vim = new VimSupport(makeHost()) as any
			const cm = makeVimCm(['hello', '  world'], { line: 0, ch: 0 })
			vim.joinLines(cm, { repeat: 1 }, undefined)
			expect(cm._buf).toEqual(['hello world'])
			expect(cm._getCursor()).toEqual({ line: 0, ch: 5 })
		})

		it('joins with nothing (no space) when the next line is entirely whitespace', () => {
			const vim = new VimSupport(makeHost()) as any
			const cm = makeVimCm(['hello', '   '], { line: 0, ch: 0 })
			vim.joinLines(cm, { repeat: 1 }, undefined)
			expect(cm._buf).toEqual(['hello'])
		})

		it('does not call getBeginningOfLinePosition (Markdown stripping) when off', () => {
			const host = makeHost()
			const vim = new VimSupport(host) as any
			const cm = makeVimCm(['hello', '- item'], { line: 0, ch: 0 })
			vim.joinLines(cm, { repeat: 1 }, undefined)
			expect(host.getBeginningOfLinePosition).not.toHaveBeenCalled()
			expect(cm._buf).toEqual(['hello - item']) // only whitespace stripped, list marker kept
		})
	})

	describe('smartJoin on — Markdown-aware stripping, still space-joined', () => {
		it('strips the next line\'s leading Markdown syntax via getBeginningOfLinePosition', () => {
			// '- item' -> strip 2 chars ('- ') to reach 'item'.
			const host = makeHost({ settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, vimGgSupport: false, vimDisplayLineSupport: false, vimEolSupport: false, smartJoin: true, smartHomeStandard: false }, getBeginningOfLinePosition: () => 2 })
			const vim = new VimSupport(host) as any
			const cm = makeVimCm(['hello', '- item'], { line: 0, ch: 0 })
			vim.joinLines(cm, { repeat: 1 }, undefined)
			expect(cm._buf).toEqual(['hello item'])
		})

		it('still inserts a space even when the stripped remainder is empty', () => {
			// Unlike the off path, on always inserts the space — regardless of
			// whether anything is left after stripping.
			const host = makeHost({ settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, vimGgSupport: false, vimDisplayLineSupport: false, vimEolSupport: false, smartJoin: true, smartHomeStandard: false }, getBeginningOfLinePosition: () => 2 })
			const vim = new VimSupport(host) as any
			const cm = makeVimCm(['hello', '- '], { line: 0, ch: 0 })
			vim.joinLines(cm, { repeat: 1 }, undefined)
			expect(cm._buf).toEqual(['hello '])
		})

		it('applies inside a table cell\'s <br>-segment lines the same way', () => {
			const host = makeHost({ settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, vimGgSupport: false, vimDisplayLineSupport: false, vimEolSupport: false, smartJoin: true, smartHomeStandard: false }, getBeginningOfLinePosition: () => 2 })
			const vim = new VimSupport(host) as any
			// Inner view already models <br>-segments as separate lines (established
			// elsewhere) — same join logic applies with no table-specific branch.
			const cm = makeVimCm(['AAA', '- BBB'], { line: 0, ch: 0 })
			vim.joinLines(cm, { repeat: 1 }, undefined)
			expect(cm._buf).toEqual(['AAA BBB'])
		})
	})

	describe('count-prefixed join (repeat)', () => {
		it('plain J (repeat=1) still joins exactly 2 lines (vim\'s own repeat<2 minimum)', () => {
			const vim = new VimSupport(makeHost()) as any
			const cm = makeVimCm(['a', 'b', 'c'], { line: 0, ch: 0 })
			vim.joinLines(cm, { repeat: 1 }, undefined)
			expect(cm._buf).toEqual(['a b', 'c'])
		})

		it('"2J" behaves identically to plain J (both join 2 lines — vim\'s own well-known quirk)', () => {
			const vim = new VimSupport(makeHost()) as any
			const cm = makeVimCm(['a', 'b', 'c'], { line: 0, ch: 0 })
			vim.joinLines(cm, { repeat: 2 }, undefined)
			expect(cm._buf).toEqual(['a b', 'c'])
		})

		it('"3J" joins 3 lines, re-reading the growing line length each iteration', () => {
			const vim = new VimSupport(makeHost()) as any
			const cm = makeVimCm(['a', 'b', 'c', 'd'], { line: 0, ch: 0 })
			vim.joinLines(cm, { repeat: 3 }, undefined)
			expect(cm._buf).toEqual(['a b c', 'd'])
			expect(cm._getCursor()).toEqual({ line: 0, ch: 3 }) // join point of the last merge
		})

		it('clamps to the last available line rather than joining past it', () => {
			const vim = new VimSupport(makeHost()) as any
			const cm = makeVimCm(['a', 'b'], { line: 0, ch: 0 })
			vim.joinLines(cm, { repeat: 10 }, undefined)
			expect(cm._buf).toEqual(['a b'])
		})
	})

	describe('visual mode', () => {
		let exitVisualMode: ReturnType<typeof vi.fn>

		beforeEach(() => {
			const win = installVimWindow()
			exitVisualMode = vi.fn()
			;(globalThis as any).window.CodeMirrorAdapter = { Vim: { exitVisualMode } }
			void win
		})

		afterEach(() => {
			uninstallVimWindow()
		})

		it('joins the anchor..head range when anchor comes before head', () => {
			const vim = new VimSupport(makeHost()) as any
			const cm = makeVimCm(['a', 'b', 'c'], { line: 0, ch: 0 }, {
				anchor: { line: 0, ch: 0 }, head: { line: 2, ch: 0 },
			})
			vim.joinLines(cm, { repeat: 1 }, { visualMode: true })
			expect(cm._buf).toEqual(['a b c'])
		})

		it('joins the same range when the selection is reversed (anchor after head)', () => {
			const vim = new VimSupport(makeHost()) as any
			const cm = makeVimCm(['a', 'b', 'c'], { line: 0, ch: 0 }, {
				anchor: { line: 2, ch: 0 }, head: { line: 0, ch: 0 },
			})
			vim.joinLines(cm, { repeat: 1 }, { visualMode: true })
			expect(cm._buf).toEqual(['a b c'])
		})

		it('exits visual mode after joining (regression: otherwise "u" means lowercase-selection, not undo)', () => {
			const vim = new VimSupport(makeHost()) as any
			const cm = makeVimCm(['a', 'b', 'c'], { line: 0, ch: 0 }, {
				anchor: { line: 0, ch: 0 }, head: { line: 2, ch: 0 },
			})
			vim.joinLines(cm, { repeat: 1 }, { visualMode: true })
			expect(exitVisualMode).toHaveBeenCalledWith(cm, false)
		})

		it('does not call exitVisualMode in normal mode', () => {
			const vim = new VimSupport(makeHost()) as any
			const cm = makeVimCm(['a', 'b', 'c'], { line: 0, ch: 0 })
			vim.joinLines(cm, { repeat: 1 }, undefined)
			expect(exitVisualMode).not.toHaveBeenCalled()
		})
	})
})
