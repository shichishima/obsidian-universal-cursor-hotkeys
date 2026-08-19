import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'
import { installVimWindow, uninstallVimWindow } from './__helpers__/vimWindow'

// Vim leader-key table navigation commands (tx/tX/th/tj/tk/tl) — pure cursor
// movement, distinct from the table-structure command family (see this
// branch's own design notes). Covers exitTable/jumpAdjacentCell's own logic,
// registration mechanics, and the shared-leak-guard interaction with
// table-structure (both features register `<Space>t...` sequences and must
// not tear down each other's shared machinery while the sibling is still on).

const ALL_NAVIGATION_COMMANDS: ReadonlyArray<{ action: string; leaderSuffix: string }> = [
	{ action: 'uchTableExitDown', leaderSuffix: 'tx' },
	{ action: 'uchTableExitUp', leaderSuffix: 'tX' },
	{ action: 'uchTableCellLeft', leaderSuffix: 'th' },
	{ action: 'uchTableCellDown', leaderSuffix: 'tj' },
	{ action: 'uchTableCellUp', leaderSuffix: 'tk' },
	{ action: 'uchTableCellRight', leaderSuffix: 'tl' },
]

const makeSettings = (overrides: Partial<VimSupportHost['settings']> = {}): VimSupportHost['settings'] => ({
	vimHlSupport: false,
	vimJkSupport: false,
	vimJoinSupport: false,
	vimCaretSupport: false,
	vimWordSupport: false,
	vimGgSupport: false,
	vimDisplayLineSupport: false,
	vimEolSupport: false,
	vimTableStructureSupport: false,
	vimTableNavigationSupport: false,
	vimLeaderUseBackslash: false,
	smartJoin: false,
	smartHomeStandard: false,
	...overrides,
})

const makeHost = (settings: VimSupportHost['settings'] = makeSettings()): VimSupportHost => ({
	settings,
	saveSettings: vi.fn().mockResolvedValue(undefined),
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
})

// exitTable/jumpAdjacentCell's own logic is tested directly against
// table-navigation.ts in tests/tableNavigation.test.ts (no vim/CM6
// involvement there at all) — this file covers only the Vim-side wiring:
// registration, leader-key remapping, and the shared-leak-guard interaction
// with table-structure.

describe('Vim table navigation registration (setTableNavigationEnabled)', () => {
	let mapCommand: ReturnType<typeof vi.fn>
	let unmap: ReturnType<typeof vi.fn>
	let defineAction: ReturnType<typeof vi.fn>
	let multiSelectHandleKey: ReturnType<typeof vi.fn>

	beforeEach(() => {
		installVimWindow()
		mapCommand = vi.fn()
		unmap = vi.fn().mockReturnValue(true)
		defineAction = vi.fn()
		multiSelectHandleKey = vi.fn().mockReturnValue(undefined)
		;(globalThis as any).window.CodeMirrorAdapter = {
			Vim: { defineMotion: vi.fn(), defineAction, mapCommand, unmap, multiSelectHandleKey, exitVisualMode: vi.fn() },
		}
	})

	afterEach(() => uninstallVimWindow())

	for (const cmd of ALL_NAVIGATION_COMMANDS) {
		it(`registers ${cmd.action} and maps "<Space>${cmd.leaderSuffix}" to it`, () => {
			const vim = new VimSupport(makeHost())
			vim.setTableNavigationEnabled(true)
			expect(defineAction).toHaveBeenCalledWith(cmd.action, expect.any(Function))
			expect(mapCommand).toHaveBeenCalledWith(`<Space>${cmd.leaderSuffix}`, 'action', cmd.action)
		})
	}

	it('unmaps Space\'s native binding on enable, and every command\'s leader sequence on disable', () => {
		const vim = new VimSupport(makeHost(makeSettings({ vimTableNavigationSupport: true })))
		vim.setTableNavigationEnabled(false)
		for (const cmd of ALL_NAVIGATION_COMMANDS) {
			expect(unmap).toHaveBeenCalledWith(`<Space>${cmd.leaderSuffix}`, undefined)
		}
	})

	it('flags needsRestart on disable', () => {
		const vim = new VimSupport(makeHost(makeSettings({ vimTableNavigationSupport: true })))
		vim.setTableNavigationEnabled(false)
		expect(vim.needsRestart).toBe(true)
	})

	describe('shared leak-guard/native-binding machinery with table structure', () => {
		it('disabling navigation while structure is still on does NOT restore multiSelectHandleKey', () => {
			const vim = new VimSupport(makeHost())
			vim.setTableStructureEnabled(true)
			vim.setTableNavigationEnabled(true)
			vim.setTableNavigationEnabled(false)
			expect((globalThis as any).window.CodeMirrorAdapter.Vim.multiSelectHandleKey).not.toBe(multiSelectHandleKey)
		})

		it('disabling structure while navigation is still on does NOT restore multiSelectHandleKey', () => {
			const vim = new VimSupport(makeHost())
			vim.setTableStructureEnabled(true)
			vim.setTableNavigationEnabled(true)
			vim.setTableStructureEnabled(false)
			expect((globalThis as any).window.CodeMirrorAdapter.Vim.multiSelectHandleKey).not.toBe(multiSelectHandleKey)
		})

		it('disabling both restores multiSelectHandleKey', () => {
			const vim = new VimSupport(makeHost())
			vim.setTableStructureEnabled(true)
			vim.setTableNavigationEnabled(true)
			vim.setTableStructureEnabled(false)
			vim.setTableNavigationEnabled(false)
			expect((globalThis as any).window.CodeMirrorAdapter.Vim.multiSelectHandleKey).toBe(multiSelectHandleKey)
		})
	})

	describe('setLeaderUseBackslash with both features on', () => {
		it('remaps both table-structure and table-navigation leader sequences', () => {
			const vim = new VimSupport(makeHost())
			vim.setTableStructureEnabled(true)
			vim.setTableNavigationEnabled(true)
			mapCommand.mockClear()
			unmap.mockClear()
			vim.setLeaderUseBackslash(true)
			expect(mapCommand).toHaveBeenCalledWith('\\tx', 'action', 'uchTableExitDown')
			expect(mapCommand).toHaveBeenCalledWith('\\to', 'action', 'uchTableRowAfter')
			expect(unmap).toHaveBeenCalledWith('<Space>tx', undefined)
			expect(unmap).toHaveBeenCalledWith('<Space>to', undefined)
		})
	})
})
