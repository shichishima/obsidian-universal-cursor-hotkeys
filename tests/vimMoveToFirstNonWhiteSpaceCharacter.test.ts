import { describe, it, expect, vi } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'

// Vim's `^` (moveToFirstNonWhiteSpaceCharacter). Unlike J's smartJoin, off
// does NOT route through getBeginningOfLinePosition (that hardcodes 0 when
// smartHomeStandard is off, matching the physical Home key's own off-state —
// which is vim's `0`, not `^`) — off must leave vim's own native
// whitespace-only-skip behavior untouched instead.

const makeHost = (overrides: Partial<VimSupportHost> = {}): VimSupportHost => ({
	settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, vimGgSupport: false, vimDisplayLineSupport: false, vimEolSupport: false, vimTableStructureSupport: false, vimLeaderUseBackslash: false, smartJoin: false, smartHomeStandard: false },
	saveSettings: async () => {},
	crossTableRowForCell: vi.fn().mockReturnValue(null),
	crossTableRowForWord: vi.fn().mockReturnValue(null),
	jumpToDocumentLine: vi.fn().mockReturnValue(null),
	isLinePartOfTable: vi.fn().mockReturnValue(false),
	enterTableAtLine: vi.fn().mockReturnValue(null),
	refineDisplayLineColumn: vi.fn().mockReturnValue(null),
	getBeginningOfLinePosition: vi.fn().mockReturnValue(0),
	executeObsidianCommand: vi.fn().mockReturnValue(true),
	...overrides,
})

const cm = (lineText: string) => ({ getLine: (_n: number) => lineText })

describe('Vim ^ (moveToFirstNonWhiteSpaceCharacter)', () => {
	describe('smartHomeStandard off — vim\'s own native behavior, untouched', () => {
		it('lands on the first non-whitespace character', () => {
			const vim = new VimSupport(makeHost()) as any
			const result = vim.moveToFirstNonWhiteSpaceCharacter(cm('  hello'), { line: 0, ch: 5 })
			expect(result).toEqual({ line: 0, ch: 2 })
		})

		it('does not skip past a list marker (whitespace-only skip, not Markdown-aware)', () => {
			const vim = new VimSupport(makeHost()) as any
			const result = vim.moveToFirstNonWhiteSpaceCharacter(cm('- item'), { line: 0, ch: 4 })
			expect(result).toEqual({ line: 0, ch: 0 }) // lands on '-', not past '- '
		})

		it('lands at line end when the line is entirely whitespace', () => {
			const vim = new VimSupport(makeHost()) as any
			const result = vim.moveToFirstNonWhiteSpaceCharacter(cm('   '), { line: 0, ch: 1 })
			expect(result).toEqual({ line: 0, ch: 3 })
		})

		it('does not call getBeginningOfLinePosition when off', () => {
			const host = makeHost()
			const vim = new VimSupport(host) as any
			vim.moveToFirstNonWhiteSpaceCharacter(cm('- item'), { line: 0, ch: 4 })
			expect(host.getBeginningOfLinePosition).not.toHaveBeenCalled()
		})
	})

	describe('smartHomeStandard on — Markdown-aware, via getBeginningOfLinePosition', () => {
		it('strips a list marker via getBeginningOfLinePosition', () => {
			const host = makeHost({
				settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, vimGgSupport: false, vimDisplayLineSupport: false, vimEolSupport: false, vimTableStructureSupport: false, vimLeaderUseBackslash: false, smartJoin: false, smartHomeStandard: true },
				getBeginningOfLinePosition: () => 2,
			})
			const vim = new VimSupport(host) as any
			const result = vim.moveToFirstNonWhiteSpaceCharacter(cm('- item'), { line: 0, ch: 4 })
			expect(result).toEqual({ line: 0, ch: 2 })
		})

		it('calls getBeginningOfLinePosition non-togglingly (ch = line.length, not the cursor\'s own ch)', () => {
			const getBeginningOfLinePosition = vi.fn().mockReturnValue(2)
			const host = makeHost({
				settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, vimGgSupport: false, vimDisplayLineSupport: false, vimEolSupport: false, vimTableStructureSupport: false, vimLeaderUseBackslash: false, smartJoin: false, smartHomeStandard: true },
				getBeginningOfLinePosition,
			})
			const vim = new VimSupport(host) as any
			// Cursor already at ch=0 — a toggling Home key would stay put; `^` must
			// still resolve to the content start regardless of the cursor's own ch.
			vim.moveToFirstNonWhiteSpaceCharacter(cm('- item'), { line: 0, ch: 0 })
			expect(getBeginningOfLinePosition).toHaveBeenCalledWith('- item', 6)
		})

		it('passes ch=1 (not 0) for an empty line, to keep the non-toggling contract', () => {
			const getBeginningOfLinePosition = vi.fn().mockReturnValue(0)
			const host = makeHost({
				settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, vimGgSupport: false, vimDisplayLineSupport: false, vimEolSupport: false, vimTableStructureSupport: false, vimLeaderUseBackslash: false, smartJoin: false, smartHomeStandard: true },
				getBeginningOfLinePosition,
			})
			const vim = new VimSupport(host) as any
			vim.moveToFirstNonWhiteSpaceCharacter(cm(''), { line: 0, ch: 0 })
			expect(getBeginningOfLinePosition).toHaveBeenCalledWith('', 1)
		})
	})
})
