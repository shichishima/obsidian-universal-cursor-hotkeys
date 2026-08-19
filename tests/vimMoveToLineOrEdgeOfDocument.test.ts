import { describe, it, expect, vi, afterEach } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'
import { installVimWindow, uninstallVimWindow } from './__helpers__/vimWindow'

// Vim's gg/G (moveToLineOrEdgeOfDocument). Unlike moveByWords, this always
// schedules a host round-trip (jumpToDocumentLine) rather than only on a
// boundary hit — even an already-correct plain-text landing still needs the
// host's table-membership check (the target line might itself be a table row).

const makeHost = (overrides: Partial<VimSupportHost> = {}): VimSupportHost => ({
	settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, vimGgSupport: false, vimDisplayLineSupport: false, vimEolSupport: false, vimTableStructureSupport: false, vimTableNavigationSupport: false, vimLeaderUseBackslash: false, smartJoin: false, smartHomeStandard: false },
	saveSettings: async () => {},
	crossTableRowForCell: vi.fn().mockReturnValue(null),
	getAdjacentRowLine: vi.fn().mockReturnValue(0),
	setCursorAcrossTableBoundary: vi.fn(),
	appendBlankLineAndLand: vi.fn(),
	crossTableRowForWord: vi.fn().mockReturnValue(null),
	jumpToDocumentLine: vi.fn().mockReturnValue(null),
	isLinePartOfTable: vi.fn().mockReturnValue(false),
	enterTableAtLine: vi.fn().mockReturnValue(null),
	refineDisplayLineColumn: vi.fn().mockReturnValue(null),
	getBeginningOfLinePosition: vi.fn().mockReturnValue(0),
	executeObsidianCommand: vi.fn().mockReturnValue(true),
	...overrides,
})

const cm = (lines: string[]) => ({
	getLine: (n: number) => lines[n] ?? '',
	lastLine: () => lines.length - 1,
})

describe('Vim gg/G (moveToLineOrEdgeOfDocument)', () => {
	afterEach(() => {
		uninstallVimWindow()
	})

	it('gg (forward=false) lands on the first line, first non-blank', () => {
		installVimWindow({ inTableCell: false, getCursor: () => ({ line: 3, ch: 0 }), getLine: () => '' })
		const vim = new VimSupport(makeHost()) as any
		const result = vim.moveToLineOrEdgeOfDocument(cm(['  hello', 'world', 'last']), { line: 3, ch: 2 }, { forward: false, repeat: 1 })
		expect(result).toEqual({ line: 0, ch: 2 }) // first non-whitespace of '  hello'
	})

	it('stays at the unchanged head (does not land there synchronously) when the target line looks like a table row', () => {
		// Regression: vim.js's own synchronous dispatch landing directly on
		// table markdown text triggers Obsidian's own auto-creation of that
		// cell's inner view — racing the deferred jumpToDocumentLine call a
		// tick later and corrupting vim's internal state (crashed in
		// exitInsertMode). Deferring the *entire* landing avoids that race.
		installVimWindow({ inTableCell: false, getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '' })
		const vim = new VimSupport(makeHost()) as any
		const head = { line: 0, ch: 3 }
		const result = vim.moveToLineOrEdgeOfDocument(cm(['first', '| a | b |', 'last']), head, { forward: true, repeat: 2, repeatIsExplicit: true })
		expect(result).toEqual(head)
	})

	it('G (forward=true) lands on the last line, first non-blank', () => {
		installVimWindow({ inTableCell: false, getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '' })
		const vim = new VimSupport(makeHost()) as any
		const result = vim.moveToLineOrEdgeOfDocument(cm(['first', 'middle', '  last']), { line: 0, ch: 0 }, { forward: true, repeat: 1 })
		expect(result).toEqual({ line: 2, ch: 2 })
	})

	it('"5gg" (repeatIsExplicit) lands on line 4 (0-indexed)', () => {
		installVimWindow({ inTableCell: false, getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '' })
		const vim = new VimSupport(makeHost()) as any
		const result = vim.moveToLineOrEdgeOfDocument(
			cm(['a', 'b', 'c', 'd', 'e', 'f']), { line: 0, ch: 0 }, { forward: true, repeat: 5, repeatIsExplicit: true },
		)
		expect(result).toEqual({ line: 4, ch: 0 })
	})

	it('clamps an explicit repeat beyond the buffer to the last line', () => {
		installVimWindow({ inTableCell: false, getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '' })
		const vim = new VimSupport(makeHost()) as any
		const result = vim.moveToLineOrEdgeOfDocument(cm(['a', 'b']), { line: 0, ch: 0 }, { forward: true, repeat: 99, repeatIsExplicit: true })
		expect(result).toEqual({ line: 1, ch: 0 })
	})

	it('defers the jumpToDocumentLine call until flush, with explicitLine=null for plain G', () => {
		const host = makeHost()
		const winHandle = installVimWindow({ inTableCell: true, getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '' })
		const vim = new VimSupport(host) as any
		vim.moveToLineOrEdgeOfDocument(cm(['a', 'b', 'c']), { line: 0, ch: 0 }, { forward: true, repeat: 1 })
		expect(host.jumpToDocumentLine).not.toHaveBeenCalled()
		winHandle.flush()
		expect(host.jumpToDocumentLine).toHaveBeenCalledWith(expect.anything(), true, null)
	})

	it('passes the resolved explicitLine through for "5gg"', () => {
		const host = makeHost()
		const winHandle = installVimWindow({ inTableCell: false, getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '' })
		const vim = new VimSupport(host) as any
		vim.moveToLineOrEdgeOfDocument(cm(['a', 'b', 'c', 'd', 'e']), { line: 0, ch: 0 }, { forward: false, repeat: 5, repeatIsExplicit: true })
		winHandle.flush()
		expect(host.jumpToDocumentLine).toHaveBeenCalledWith(expect.anything(), false, 4)
	})

	it('does not schedule a jump when an operator is pending (e.g. "dgg")', () => {
		const host = makeHost()
		const winHandle = installVimWindow({ inTableCell: false, getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '' })
		const vim = new VimSupport(host) as any
		vim.moveToLineOrEdgeOfDocument(cm(['a', 'b', 'c']), { line: 0, ch: 0 }, { forward: false, repeat: 1 }, {}, { operator: 'delete' })
		winHandle.flush()
		expect(host.jumpToDocumentLine).not.toHaveBeenCalled()
	})
})

describe('restore target (VIM_DEFAULT_MOVE_TO_LINE_OR_EDGE)', () => {
	it('matches vim-native behavior with no table-awareness', () => {
		installVimWindow({ inTableCell: false, getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '' })
		const vim = VimSupport as any
		const result = vim.VIM_DEFAULT_MOVE_TO_LINE_OR_EDGE(cm(['a', '  b', 'c']), { line: 0, ch: 0 }, { forward: true, repeat: 1 })
		expect(result).toEqual({ line: 2, ch: 0 })
	})
})
