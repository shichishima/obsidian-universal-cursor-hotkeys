import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'
import { installVimWindow, uninstallVimWindow } from './__helpers__/vimWindow'
import type { FakeEditor } from './__helpers__/vimWindow'

// Vim's w/b/e (moveByWords) — faithful port of vim.js's own findWord/moveToWord.
// motionArgs.repeat defaults to 1 for a plain keystroke unless a test says otherwise.
// moveByWords always calls getActiveEditor() (to check inTableCell), so every
// test needs a window installed even when plain-text (not a table cell).

const makeHost = (overrides: Partial<VimSupportHost> = {}): VimSupportHost => ({
	settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, vimGgSupport: false, smartJoin: false, smartHomeStandard: false },
	saveSettings: async () => {},
	crossTableRowForCell: vi.fn().mockReturnValue(null),
	crossTableRowForWord: vi.fn().mockReturnValue(null),
	jumpToDocumentLine: vi.fn().mockReturnValue(null),
	isLinePartOfTable: vi.fn().mockReturnValue(false),
	enterTableAtLine: vi.fn().mockReturnValue(null),
	getBeginningOfLinePosition: vi.fn().mockReturnValue(0),
	...overrides,
})

const cm = (lines: string[]) => ({
	getLine: (n: number) => lines[n] ?? '',
	lastLine: () => lines.length - 1,
})

describe('Vim w/b/e (moveByWords)', () => {
	afterEach(() => {
		uninstallVimWindow()
	})

	describe('plain text, no table involved', () => {
		beforeEach(() => {
			installVimWindow({ inTableCell: false, getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '' })
		})

		it('w moves to the start of the next word', () => {
			const vim = new VimSupport(makeHost()) as any
			const result = vim.moveByWords(cm(['hello world']), { line: 0, ch: 0 }, { forward: true, repeat: 1 })
			expect(result).toEqual({ line: 0, ch: 6 })
		})

		it('b moves back to the start of the previous word', () => {
			const vim = new VimSupport(makeHost()) as any
			const result = vim.moveByWords(cm(['hello world']), { line: 0, ch: 6 }, { forward: false, repeat: 1 })
			expect(result).toEqual({ line: 0, ch: 0 })
		})

		it('e moves to the end of the current/next word', () => {
			const vim = new VimSupport(makeHost()) as any
			const result = vim.moveByWords(cm(['hello world']), { line: 0, ch: 0 }, { forward: true, repeat: 1, wordEnd: true })
			expect(result).toEqual({ line: 0, ch: 4 }) // the 'o' in hello
		})

		it('w treats punctuation as its own word (small word, not bigWord)', () => {
			const vim = new VimSupport(makeHost()) as any
			const result = vim.moveByWords(cm(['foo-bar baz']), { line: 0, ch: 0 }, { forward: true, repeat: 1 })
			expect(result).toEqual({ line: 0, ch: 3 }) // lands on '-', not 'bar'
		})

		it('W (bigWord) treats punctuation-joined text as one word', () => {
			const vim = new VimSupport(makeHost()) as any
			const result = vim.moveByWords(cm(['foo-bar baz']), { line: 0, ch: 0 }, { forward: true, repeat: 1, bigWord: true })
			expect(result).toEqual({ line: 0, ch: 8 }) // skips straight to 'baz'
		})

		it('w crosses lines within the same view (e.g. in-cell <br>-segments)', () => {
			const vim = new VimSupport(makeHost()) as any
			const result = vim.moveByWords(cm(['hello', 'world']), { line: 0, ch: 0 }, { forward: true, repeat: 1 })
			expect(result).toEqual({ line: 1, ch: 0 })
		})

		it('repeat=2 skips two words forward', () => {
			const vim = new VimSupport(makeHost()) as any
			const result = vim.moveByWords(cm(['one two three']), { line: 0, ch: 0 }, { forward: true, repeat: 2 })
			expect(result).toEqual({ line: 0, ch: 8 }) // 'three'
		})

		it('hitting the buffer end in plain text (not a table cell) does not trigger a crossing', () => {
			const host = makeHost()
			const vim = new VimSupport(host) as any
			const result = vim.moveByWords(cm(['hello']), { line: 0, ch: 5 }, { forward: true, repeat: 1 })
			expect(result).toEqual({ line: 0, ch: 5 }) // clamped to the buffer's own end, vim-native
			expect(host.crossTableRowForWord).not.toHaveBeenCalled()
		})
	})

	describe('table-cell boundary crossing', () => {
		it('hitting the cell boundary forward schedules a crossing via crossTableRowForWord', () => {
			const host = makeHost()
			const vim = new VimSupport(host) as any
			const editor: FakeEditor = { inTableCell: true, getCursor: () => ({ line: 0, ch: 5 }), getLine: (n) => ['hello'][n] ?? '' }
			const win = installVimWindow(editor)
			const result = vim.moveByWords(cm(['hello']), { line: 0, ch: 5 }, { forward: true, repeat: 1 })
			expect(result).toEqual({ line: 0, ch: 5 }) // synchronous return is just the clamped placeholder
			expect(host.crossTableRowForWord).not.toHaveBeenCalled() // deferred, not yet run
			win.flush()
			expect(host.crossTableRowForWord).toHaveBeenCalledWith(editor, expect.anything(), true, false, false)
		})

		it('hitting the cell boundary backward schedules a crossing with forward=false', () => {
			const host = makeHost()
			const vim = new VimSupport(host) as any
			const editor: FakeEditor = { inTableCell: true, getCursor: () => ({ line: 0, ch: 0 }), getLine: (n) => ['hello'][n] ?? '' }
			const win = installVimWindow(editor)
			vim.moveByWords(cm(['hello']), { line: 0, ch: 0 }, { forward: false, repeat: 1 })
			win.flush()
			expect(host.crossTableRowForWord).toHaveBeenCalledWith(editor, expect.anything(), false, false, false)
		})

		it('passes bigWord through to the crossing call', () => {
			const host = makeHost()
			const vim = new VimSupport(host) as any
			const editor: FakeEditor = { inTableCell: true, getCursor: () => ({ line: 0, ch: 5 }), getLine: (n) => ['hello'][n] ?? '' }
			const win = installVimWindow(editor)
			vim.moveByWords(cm(['hello']), { line: 0, ch: 5 }, { forward: true, repeat: 1, bigWord: true })
			win.flush()
			expect(host.crossTableRowForWord).toHaveBeenCalledWith(editor, expect.anything(), true, true, false)
		})

		it('passes wordEnd through to the crossing call (e at a cell boundary)', () => {
			const host = makeHost()
			const vim = new VimSupport(host) as any
			const editor: FakeEditor = { inTableCell: true, getCursor: () => ({ line: 0, ch: 4 }), getLine: (n) => ['hello'][n] ?? '' }
			const win = installVimWindow(editor)
			vim.moveByWords(cm(['hello']), { line: 0, ch: 4 }, { forward: true, repeat: 1, wordEnd: true })
			win.flush()
			expect(host.crossTableRowForWord).toHaveBeenCalledWith(editor, expect.anything(), true, false, true)
		})
	})

	describe('restore target (VIM_DEFAULT_MOVE_BY_WORDS)', () => {
		it('never triggers a crossing, even inside a table cell (vim-native, unenhanced)', () => {
			const vim = VimSupport as any
			const editor: FakeEditor = { inTableCell: true, getCursor: () => ({ line: 0, ch: 5 }), getLine: (n) => ['hello'][n] ?? '' }
			installVimWindow(editor)
			const result = vim.VIM_DEFAULT_MOVE_BY_WORDS(cm(['hello']), { line: 0, ch: 5 }, { forward: true, repeat: 1 })
			expect(result).toEqual({ line: 0, ch: 5 }) // clamped, vim's own native boundary behavior
		})
	})
})
