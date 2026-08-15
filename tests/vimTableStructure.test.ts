import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'
import { installVimWindow, uninstallVimWindow } from './__helpers__/vimWindow'

// Vim leader-key table structure commands — MVP commands #1/#2 (insert row
// below/above). Covers the registration mechanics (setTableStructureEnabled,
// setLeaderUseBackslash) and each action itself.

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
	vimLeaderUseBackslash: false,
	smartJoin: false,
	smartHomeStandard: false,
	...overrides,
})

const makeHost = (
	settings: VimSupportHost['settings'] = makeSettings(),
	executeObsidianCommand: (commandId: string) => boolean = vi.fn().mockReturnValue(true),
): VimSupportHost => ({
	settings,
	saveSettings: vi.fn().mockResolvedValue(undefined),
	crossTableRowForCell: vi.fn().mockReturnValue(null),
	crossTableRowForWord: vi.fn().mockReturnValue(null),
	jumpToDocumentLine: vi.fn().mockReturnValue(null),
	isLinePartOfTable: vi.fn().mockReturnValue(false),
	enterTableAtLine: vi.fn().mockReturnValue(null),
	refineDisplayLineColumn: vi.fn().mockReturnValue(null),
	getBeginningOfLinePosition: vi.fn().mockReturnValue(0),
	executeObsidianCommand,
})

describe('Vim table structure (insert row above/below)', () => {
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

	describe('setTableStructureEnabled', () => {
		it('registers uchTableRowAfter/uchTableRowBefore under UCH-unique names (not tableRowAfter/tableRowBefore — collision guard)', () => {
			const vim = new VimSupport(makeHost())
			vim.setTableStructureEnabled(true)
			expect(defineAction).toHaveBeenCalledWith('uchTableRowAfter', expect.any(Function))
			expect(defineAction).toHaveBeenCalledWith('uchTableRowBefore', expect.any(Function))
			expect(defineAction.mock.calls.some(c => c[0] === 'tableRowAfter' || c[0] === 'tableRowBefore')).toBe(false)
		})

		it('unmaps Space\'s native binding once (context undefined) and maps "<Space>to"/"<Space>tO" by default', () => {
			const vim = new VimSupport(makeHost())
			vim.setTableStructureEnabled(true)
			expect(unmap).toHaveBeenCalledWith('<Space>', undefined)
			expect(unmap).toHaveBeenCalledTimes(1)
			expect(mapCommand).toHaveBeenCalledWith('<Space>to', 'action', 'uchTableRowAfter')
			expect(mapCommand).toHaveBeenCalledWith('<Space>tO', 'action', 'uchTableRowBefore')
		})

		it('maps "\\to"/"\\tO" with no native-binding unmap when the backslash leader is chosen', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimLeaderUseBackslash: true })))
			vim.setTableStructureEnabled(true)
			expect(unmap).not.toHaveBeenCalled()
			expect(mapCommand).toHaveBeenCalledWith('\\to', 'action', 'uchTableRowAfter')
			expect(mapCommand).toHaveBeenCalledWith('\\tO', 'action', 'uchTableRowBefore')
		})

		it('turning off unmaps both leader sequences (context undefined) and flags needsRestart', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimTableStructureSupport: true })))
			vim.setTableStructureEnabled(false)
			expect(unmap).toHaveBeenCalledWith('<Space>to', undefined)
			expect(unmap).toHaveBeenCalledWith('<Space>tO', undefined)
			expect(vim.needsRestart).toBe(true)
		})
	})

	describe('setLeaderUseBackslash', () => {
		it('does nothing to the vim API when the feature is off (persists only)', () => {
			const host = makeHost()
			const vim = new VimSupport(host)
			vim.setLeaderUseBackslash(true)
			expect(host.settings.vimLeaderUseBackslash).toBe(true)
			expect(mapCommand).not.toHaveBeenCalled()
			expect(unmap).not.toHaveBeenCalled()
			expect(vim.needsRestart).toBe(false)
		})

		it('remaps live when the feature is already on: unmaps old lhs\'s, maps new lhs\'s, no restart needed (fully reversible)', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimTableStructureSupport: true })))
			vim.setLeaderUseBackslash(true)
			expect(unmap).toHaveBeenCalledWith('<Space>to', undefined)
			expect(unmap).toHaveBeenCalledWith('<Space>tO', undefined)
			expect(mapCommand).toHaveBeenCalledWith('\\to', 'action', 'uchTableRowAfter')
			expect(mapCommand).toHaveBeenCalledWith('\\tO', 'action', 'uchTableRowBefore')
			expect(vim.needsRestart).toBe(false)
		})
	})

	describe('Space insertion-leak guard (multiSelectHandleKey wrap)', () => {
		const getWrapped = (): (cm: unknown, key: string, origin?: string) => unknown =>
			(globalThis as any).window.CodeMirrorAdapter.Vim.multiSelectHandleKey

		it('wraps multiSelectHandleKey when the feature is enabled', () => {
			const vim = new VimSupport(makeHost())
			vim.setTableStructureEnabled(true)
			expect(getWrapped()).not.toBe(multiSelectHandleKey)
		})

		it('passes through the original result unchanged when it is truthy', () => {
			multiSelectHandleKey.mockReturnValue(true)
			const vim = new VimSupport(makeHost())
			vim.setTableStructureEnabled(true)
			const cm = { state: { vim: { insertMode: false } } }
			expect(getWrapped()(cm, '<Space>')).toBe(true)
			expect(multiSelectHandleKey).toHaveBeenCalledWith(cm, '<Space>', undefined)
		})

		it('swallows an unmatched <Space> outside Insert mode (original falsy)', () => {
			multiSelectHandleKey.mockReturnValue(undefined)
			const vim = new VimSupport(makeHost())
			vim.setTableStructureEnabled(true)
			const cm = { state: { vim: { insertMode: false } } }
			expect(getWrapped()(cm, '<Space>')).toBe(true)
		})

		it('does not swallow an unmatched key other than <Space>', () => {
			multiSelectHandleKey.mockReturnValue(undefined)
			const vim = new VimSupport(makeHost())
			vim.setTableStructureEnabled(true)
			const cm = { state: { vim: { insertMode: false } } }
			expect(getWrapped()(cm, 'q')).toBe(undefined)
		})

		it('does not swallow <Space> while in Insert mode (real typing must still work)', () => {
			multiSelectHandleKey.mockReturnValue(undefined)
			const vim = new VimSupport(makeHost())
			vim.setTableStructureEnabled(true)
			const cm = { state: { vim: { insertMode: true } } }
			expect(getWrapped()(cm, '<Space>')).toBe(undefined)
		})

		it('restores the original multiSelectHandleKey when disabled', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimTableStructureSupport: true })))
			vim.setTableStructureEnabled(false)
			expect(getWrapped()).toBe(multiSelectHandleKey)
		})
	})

	describe('tableRowAfter action', () => {
		it('calls executeObsidianCommand("editor:table-row-after") when inside a table cell', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			const vim = new VimSupport(host) as any
			;(globalThis as any).window.app.workspace.activeEditor = { editor: { inTableCell: true } }
			vim.tableRowAfter({}, { repeat: 1 })
			expect(executeObsidianCommand).toHaveBeenCalledWith('editor:table-row-after')
		})

		it('no-ops outside a table cell', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			const vim = new VimSupport(host) as any
			;(globalThis as any).window.app.workspace.activeEditor = { editor: { inTableCell: false } }
			vim.tableRowAfter({}, { repeat: 1 })
			expect(executeObsidianCommand).not.toHaveBeenCalled()
		})

		it('no-ops when there is no active editor at all', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			const vim = new VimSupport(host) as any
			vim.tableRowAfter({}, { repeat: 1 })
			expect(executeObsidianCommand).not.toHaveBeenCalled()
		})
	})

	describe('tableRowBefore action', () => {
		it('calls executeObsidianCommand("editor:table-row-before") when inside a table cell', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			const vim = new VimSupport(host) as any
			;(globalThis as any).window.app.workspace.activeEditor = { editor: { inTableCell: true } }
			vim.tableRowBefore({}, { repeat: 1 })
			expect(executeObsidianCommand).toHaveBeenCalledWith('editor:table-row-before')
		})

		it('no-ops outside a table cell', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			const vim = new VimSupport(host) as any
			;(globalThis as any).window.app.workspace.activeEditor = { editor: { inTableCell: false } }
			vim.tableRowBefore({}, { repeat: 1 })
			expect(executeObsidianCommand).not.toHaveBeenCalled()
		})

		it('no-ops when there is no active editor at all', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			const vim = new VimSupport(host) as any
			vim.tableRowBefore({}, { repeat: 1 })
			expect(executeObsidianCommand).not.toHaveBeenCalled()
		})
	})
})
