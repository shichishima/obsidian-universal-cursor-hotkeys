import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'
import { installVimWindow, uninstallVimWindow } from './__helpers__/vimWindow'

// Vim leader-key table structure commands — the full 16-command family (the
// ceiling of what Obsidian exposes as invokable table commands; see this
// branch's own design notes for what was excluded and why). Covers the
// registration mechanics (setTableStructureEnabled, setLeaderUseBackslash)
// and each action itself.

// The full 16-command family (18 leader sequences — tiJ/tiK are aliases of
// to/tO, sharing the same action name) — action name / leader suffix /
// Obsidian command ID, all source-confirmed (see this branch's own design
// notes). Shared by several describe blocks below.
const ALL_TABLE_COMMANDS: ReadonlyArray<{ action: string; leaderSuffix: string; commandId: string }> = [
	{ action: 'uchTableRowAfter', leaderSuffix: 'to', commandId: 'editor:table-row-after' },
	{ action: 'uchTableRowBefore', leaderSuffix: 'tO', commandId: 'editor:table-row-before' },
	{ action: 'uchTableRowUp', leaderSuffix: 'tK', commandId: 'editor:table-row-up' },
	{ action: 'uchTableRowDown', leaderSuffix: 'tJ', commandId: 'editor:table-row-down' },
	{ action: 'uchTableRowDelete', leaderSuffix: 'tdd', commandId: 'editor:table-row-delete' },
	{ action: 'uchTableRowCopy', leaderSuffix: 'tyyp', commandId: 'editor:table-row-copy' },
	{ action: 'uchTableColBefore', leaderSuffix: 'tiH', commandId: 'editor:table-col-before' },
	{ action: 'uchTableColAfter', leaderSuffix: 'tiL', commandId: 'editor:table-col-after' },
	{ action: 'uchTableRowAfter', leaderSuffix: 'tiJ', commandId: 'editor:table-row-after' },
	{ action: 'uchTableRowBefore', leaderSuffix: 'tiK', commandId: 'editor:table-row-before' },
	{ action: 'uchTableColLeft', leaderSuffix: 'tH', commandId: 'editor:table-col-left' },
	{ action: 'uchTableColRight', leaderSuffix: 'tL', commandId: 'editor:table-col-right' },
	{ action: 'uchTableColDelete', leaderSuffix: 'tdc', commandId: 'editor:table-col-delete' },
	{ action: 'uchTableColCopy', leaderSuffix: 'tyc', commandId: 'editor:table-col-copy' },
	{ action: 'uchTableColAlignLeft', leaderSuffix: 'tal', commandId: 'editor:table-col-align-left' },
	{ action: 'uchTableColAlignCenter', leaderSuffix: 'tac', commandId: 'editor:table-col-align-center' },
	{ action: 'uchTableColAlignRight', leaderSuffix: 'tar', commandId: 'editor:table-col-align-right' },
	{ action: 'uchTableInsert', leaderSuffix: 'tm', commandId: 'editor:insert-table' },
]

// action-fn method names, gated commands only (all but tableInsert, whose
// whole point is to work outside a table cell — covered separately below;
// and tableRowDelete/the 3 align commands, whose own cursor-preserving logic
// needs a richer editor mock than the plain-gate shape this loop shares —
// covered in their own describe blocks instead).
const GATED_ACTION_METHODS: ReadonlyArray<{ method: string; commandId: string }> = [
	{ method: 'tableRowAfter', commandId: 'editor:table-row-after' },
	{ method: 'tableRowBefore', commandId: 'editor:table-row-before' },
	{ method: 'tableRowUp', commandId: 'editor:table-row-up' },
	{ method: 'tableRowDown', commandId: 'editor:table-row-down' },
	{ method: 'tableRowCopy', commandId: 'editor:table-row-copy' },
	{ method: 'tableColBefore', commandId: 'editor:table-col-before' },
	{ method: 'tableColAfter', commandId: 'editor:table-col-after' },
	{ method: 'tableColLeft', commandId: 'editor:table-col-left' },
	{ method: 'tableColRight', commandId: 'editor:table-col-right' },
	{ method: 'tableColDelete', commandId: 'editor:table-col-delete' },
	{ method: 'tableColCopy', commandId: 'editor:table-col-copy' },
]

// The 3 align commands share tableColPreservingCommandAction — action-fn
// method name / Obsidian command ID. Shared by the dedicated describe block
// below.
const COL_PRESERVING_ACTION_METHODS: ReadonlyArray<{ method: string; commandId: string }> = [
	{ method: 'tableColAlignLeft', commandId: 'editor:table-col-align-left' },
	{ method: 'tableColAlignCenter', commandId: 'editor:table-col-align-center' },
	{ method: 'tableColAlignRight', commandId: 'editor:table-col-align-right' },
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
	vimTableStructureSupport: false, vimTableNavigationSupport: false,
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
	getAdjacentRowLine: vi.fn().mockReturnValue(0),
	setCursorAcrossTableBoundary: vi.fn(),
	appendBlankLineAndLand: vi.fn(),
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
			// The CM5-compat namespace itself (not .Vim) — see getVimCommands's own
			// comment for why undo/redo live here, not on the vim cm adapter object.
			commands: { undo: vi.fn(), redo: vi.fn() },
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

	describe('full command family (all 16 commands, 18 leader sequences incl. 2 aliases) registration', () => {
		for (const cmd of ALL_TABLE_COMMANDS) {
			it(`registers ${cmd.action} and maps "<Space>${cmd.leaderSuffix}" to it`, () => {
				const vim = new VimSupport(makeHost())
				vim.setTableStructureEnabled(true)
				expect(defineAction).toHaveBeenCalledWith(cmd.action, expect.any(Function))
				expect(mapCommand).toHaveBeenCalledWith(`<Space>${cmd.leaderSuffix}`, 'action', cmd.action)
			})
		}

		it('unmaps Space\'s native binding exactly once regardless of command count', () => {
			const vim = new VimSupport(makeHost())
			vim.setTableStructureEnabled(true)
			expect(unmap).toHaveBeenCalledWith('<Space>', undefined)
			expect(unmap).toHaveBeenCalledTimes(1)
		})

		it('turning off unmaps every command\'s leader sequence', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimTableStructureSupport: true })))
			vim.setTableStructureEnabled(false)
			for (const cmd of ALL_TABLE_COMMANDS) {
				expect(unmap).toHaveBeenCalledWith(`<Space>${cmd.leaderSuffix}`, undefined)
			}
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

	describe('gated table-command actions (require inTableCell)', () => {
		for (const { method, commandId } of GATED_ACTION_METHODS) {
			it(`${method} calls executeObsidianCommand("${commandId}") inside a table cell, no-ops outside and with no active editor`, () => {
				const executeObsidianCommand = vi.fn().mockReturnValue(true)
				const host = makeHost(makeSettings(), executeObsidianCommand)
				const vim = new VimSupport(host) as any

				;(globalThis as any).window.app.workspace.activeEditor = { editor: { inTableCell: true } }
				vim[method]({}, { repeat: 1 })
				expect(executeObsidianCommand).toHaveBeenCalledWith(commandId)

				executeObsidianCommand.mockClear()
				;(globalThis as any).window.app.workspace.activeEditor = { editor: { inTableCell: false } }
				vim[method]({}, { repeat: 1 })
				expect(executeObsidianCommand).not.toHaveBeenCalled()

				executeObsidianCommand.mockClear()
				;(globalThis as any).window.app.workspace.activeEditor = undefined
				vim[method]({}, { repeat: 1 })
				expect(executeObsidianCommand).not.toHaveBeenCalled()
			})
		}
	})

	describe('tableRowDelete action (preserves cursor cell/row index — dd\'s own convention)', () => {
		const makeEditor = (overrides: Record<string, unknown> = {}) => ({
			inTableCell: true,
			getCursor: vi.fn().mockReturnValue({ line: 5, ch: 6 }), // "| a | b |" — cellIndex 1
			getLine: vi.fn().mockReturnValue('| a | b |'),
			setCursor: vi.fn(),
			...overrides,
		})

		it('no-ops outside a table cell or with no active editor (executeObsidianCommand never called)', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			const vim = new VimSupport(host) as any

			;(globalThis as any).window.app.workspace.activeEditor = { editor: { inTableCell: false } }
			vim.tableRowDelete({}, { repeat: 1 })
			expect(executeObsidianCommand).not.toHaveBeenCalled()

			;(globalThis as any).window.app.workspace.activeEditor = undefined
			vim.tableRowDelete({}, { repeat: 1 })
			expect(executeObsidianCommand).not.toHaveBeenCalled()
		})

		it('a row shifted up into the deleted row\'s line: cursor lands on that same line, same cell', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			host.isLinePartOfTable = vi.fn().mockReturnValue(true) // still a table row at line 5 post-delete
			const vim = new VimSupport(host) as any
			const editor = makeEditor()
			;(globalThis as any).window.app.workspace.activeEditor = { editor }

			vim.tableRowDelete({}, { repeat: 1 })

			expect(executeObsidianCommand).toHaveBeenCalledWith('editor:table-row-delete')
			expect(host.isLinePartOfTable).toHaveBeenCalledWith(editor, 5, 1)
			// cellIndex 1 ("b") on '| a | b |' -> ch 6
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 5, ch: 6 })
		})

		it('deleting the last row of the table: falls back to the new last row (one line up)', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			// line 5 is no longer a table row post-delete (table ended there);
			// line 4 still is.
			host.isLinePartOfTable = vi.fn((_editor: unknown, line: number) => line === 4)
			const vim = new VimSupport(host) as any
			const editor = makeEditor()
			;(globalThis as any).window.app.workspace.activeEditor = { editor }

			vim.tableRowDelete({}, { repeat: 1 })

			expect(editor.setCursor).toHaveBeenCalledWith({ line: 4, ch: 6 })
		})

		it('neither the same line nor one line up is still a table row: leaves the cursor wherever Obsidian\'s own command put it', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			host.isLinePartOfTable = vi.fn().mockReturnValue(false)
			const vim = new VimSupport(host) as any
			const editor = makeEditor()
			;(globalThis as any).window.app.workspace.activeEditor = { editor }

			vim.tableRowDelete({}, { repeat: 1 })

			expect(editor.setCursor).not.toHaveBeenCalled()
		})

		it('getChByCellIndex can\'t resolve the landing cell at all (degenerate line content): leaves the cursor untouched', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			host.isLinePartOfTable = vi.fn().mockReturnValue(true)
			const vim = new VimSupport(host) as any
			// cellIndex 1 is captured from the pre-delete line ('| a | b |'), but the
			// post-delete line at that same position is degenerate (no pipes at
			// all) — getChByCellIndex returns -1 (cellIndex >= pipes.length) rather
			// than a wrong guess.
			const editor = makeEditor({ getLine: vi.fn().mockReturnValueOnce('| a | b |').mockReturnValue('') })
			;(globalThis as any).window.app.workspace.activeEditor = { editor }

			vim.tableRowDelete({}, { repeat: 1 })

			expect(editor.setCursor).not.toHaveBeenCalled()
		})
	})

	describe('align actions (tableColAlignLeft/Center/Right — preserve cursor cell on the same line)', () => {
		const makeEditor = (overrides: Record<string, unknown> = {}) => ({
			inTableCell: true,
			getCursor: vi.fn().mockReturnValue({ line: 5, ch: 6 }), // "| a | b |" — cellIndex 1
			getLine: vi.fn().mockReturnValue('| a | b |'),
			setCursor: vi.fn(),
			focus: vi.fn(),
			...overrides,
		})

		for (const { method, commandId } of COL_PRESERVING_ACTION_METHODS) {
			it(`${method} no-ops outside a table cell or with no active editor`, () => {
				const executeObsidianCommand = vi.fn().mockReturnValue(true)
				const host = makeHost(makeSettings(), executeObsidianCommand)
				const vim = new VimSupport(host) as any

				;(globalThis as any).window.app.workspace.activeEditor = { editor: { inTableCell: false } }
				vim[method]({}, { repeat: 1 })
				expect(executeObsidianCommand).not.toHaveBeenCalled()

				;(globalThis as any).window.app.workspace.activeEditor = undefined
				vim[method]({}, { repeat: 1 })
				expect(executeObsidianCommand).not.toHaveBeenCalled()
			})

			it(`${method} calls executeObsidianCommand("${commandId}") and restores the cursor to the same line/cell afterward`, () => {
				const executeObsidianCommand = vi.fn().mockReturnValue(true)
				const host = makeHost(makeSettings(), executeObsidianCommand)
				const vim = new VimSupport(host) as any
				// Re-padding shifted "b"'s own ch position on the same line.
				const editor = makeEditor({ getLine: vi.fn().mockReturnValueOnce('| a | b |').mockReturnValue('| a  |  b |') })
				;(globalThis as any).window.app.workspace.activeEditor = { editor }

				vim[method]({}, { repeat: 1 })

				expect(executeObsidianCommand).toHaveBeenCalledWith(commandId)
				// cellIndex 1 ("b") on '| a  |  b |' -> ch 8
				expect(editor.setCursor).toHaveBeenCalledWith({ line: 5, ch: 8 })
				// Align tears down the cell's own inline editor (confirmed live) —
				// setCursor() alone leaves DOM focus nowhere; focus() restores it.
				expect(editor.focus).toHaveBeenCalled()
			})
		}

		it('leaves the cursor untouched if the cell can no longer be resolved on the same line', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			const vim = new VimSupport(host) as any
			const editor = makeEditor({ getLine: vi.fn().mockReturnValueOnce('| a | b |').mockReturnValue('') })
			;(globalThis as any).window.app.workspace.activeEditor = { editor }

			vim.tableColAlignLeft({}, { repeat: 1 })

			expect(editor.setCursor).not.toHaveBeenCalled()
		})
	})

	describe('tableInsert action (not gated — must work outside a table)', () => {
		it('calls executeObsidianCommand("editor:insert-table") outside a table cell', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			const vim = new VimSupport(host) as any
			;(globalThis as any).window.app.workspace.activeEditor = { editor: { inTableCell: false } }
			vim.tableInsert({}, { repeat: 1 })
			expect(executeObsidianCommand).toHaveBeenCalledWith('editor:insert-table')
		})

		it('also works inside a table cell', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			const vim = new VimSupport(host) as any
			;(globalThis as any).window.app.workspace.activeEditor = { editor: { inTableCell: true } }
			vim.tableInsert({}, { repeat: 1 })
			expect(executeObsidianCommand).toHaveBeenCalledWith('editor:insert-table')
		})

		it('works even with no active editor at all', () => {
			const executeObsidianCommand = vi.fn().mockReturnValue(true)
			const host = makeHost(makeSettings(), executeObsidianCommand)
			const vim = new VimSupport(host) as any
			vim.tableInsert({}, { repeat: 1 })
			expect(executeObsidianCommand).toHaveBeenCalledWith('editor:insert-table')
		})
	})

	describe('setTableStructureEnabled also overrides undo/redo (table-cell undo gap fix)', () => {
		it('registers tableUndo/tableRedo under the real \'undo\'/\'redo\' action names on enable', () => {
			const vim = new VimSupport(makeHost()) as any
			vim.setTableStructureEnabled(true)
			expect(defineAction).toHaveBeenCalledWith('undo', vim.tableUndo)
			expect(defineAction).toHaveBeenCalledWith('redo', vim.tableRedo)
		})

		it('restores the hardcoded vim.js-equivalent undo/redo defaults on disable', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimTableStructureSupport: true }))) as any
			vim.setTableStructureEnabled(false)
			expect(defineAction).toHaveBeenCalledWith('undo', (VimSupport as any).VIM_DEFAULT_UNDO)
			expect(defineAction).toHaveBeenCalledWith('redo', (VimSupport as any).VIM_DEFAULT_REDO)
		})
	})

	describe('tableUndo/tableRedo actions', () => {
		// A minimal fake of the vim cm adapter (VimCm's own subset) — used only
		// for the "not inTableCell" fallback path. Real undo/redo don't live on
		// this object itself (see getVimCommands's own comment) — that's the
		// shared window.CodeMirrorAdapter.commands mock from beforeEach instead.
		const makeFakeCm = () => ({
			operation: vi.fn((fn: () => void) => fn()),
			getCursor: vi.fn().mockReturnValue({ line: 0, ch: 5 }),
			getLine: vi.fn().mockReturnValue('hello'),
			lastLine: vi.fn().mockReturnValue(0),
			setCursor: vi.fn(),
		})

		const commandsMock = (): { undo: ReturnType<typeof vi.fn>; redo: ReturnType<typeof vi.fn> } =>
			(globalThis as any).window.CodeMirrorAdapter.commands

		it('tableUndo, inside a table cell: calls editor.undo() (repeat times), then collapses to the *start* (\'from\') of any selection undo() left behind (see comment on tableUndo)', () => {
			const editorUndo = vi.fn()
			const editorSetCursor = vi.fn()
			const fromCursor = { line: 3, ch: 1 }
			const toCursor = { line: 4, ch: 0 }
			const editorGetCursor = vi.fn((side?: string) => (side === 'from' ? fromCursor : toCursor))
			;(globalThis as any).window.app.workspace.activeEditor = {
				editor: { inTableCell: true, undo: editorUndo, getCursor: editorGetCursor, setCursor: editorSetCursor },
			}
			const vim = new VimSupport(makeHost()) as any
			const cm = makeFakeCm()
			vim.tableUndo(cm, { repeat: 3 })
			expect(editorUndo).toHaveBeenCalledTimes(3)
			expect(editorGetCursor).toHaveBeenCalledWith('from')
			expect(editorSetCursor).toHaveBeenCalledWith(fromCursor)
			expect(commandsMock().undo).not.toHaveBeenCalled()
			expect(cm.operation).not.toHaveBeenCalled()
		})

		it('tableRedo, inside a table cell: calls editor.redo() (repeat times), then collapses to the *start* (\'from\') of any selection redo() left behind', () => {
			const editorRedo = vi.fn()
			const editorSetCursor = vi.fn()
			const fromCursor = { line: 5, ch: 2 }
			const toCursor = { line: 6, ch: 0 }
			const editorGetCursor = vi.fn((side?: string) => (side === 'from' ? fromCursor : toCursor))
			;(globalThis as any).window.app.workspace.activeEditor = {
				editor: { inTableCell: true, redo: editorRedo, getCursor: editorGetCursor, setCursor: editorSetCursor },
			}
			const vim = new VimSupport(makeHost()) as any
			const cm = makeFakeCm()
			vim.tableRedo(cm, { repeat: 2 })
			expect(editorRedo).toHaveBeenCalledTimes(2)
			expect(editorGetCursor).toHaveBeenCalledWith('from')
			expect(editorSetCursor).toHaveBeenCalledWith(fromCursor)
			expect(commandsMock().redo).not.toHaveBeenCalled()
		})

		it('tableUndo, outside a table cell: falls back to the native vim cm undo, clamped cursor', () => {
			;(globalThis as any).window.app.workspace.activeEditor = { editor: { inTableCell: false } }
			const vim = new VimSupport(makeHost()) as any
			const cm = makeFakeCm()
			vim.tableUndo(cm, { repeat: 2 })
			expect(cm.operation).toHaveBeenCalled()
			expect(commandsMock().undo).toHaveBeenCalledTimes(2)
			expect(commandsMock().undo).toHaveBeenCalledWith(cm)
			// 'hello'.length - 1 === 4, so the ch:5 cursor gets clamped to 4.
			expect(cm.setCursor).toHaveBeenCalledWith({ line: 0, ch: 4 })
		})

		it('tableRedo, outside a table cell: falls back to the native vim cm redo, no cursor clamp', () => {
			;(globalThis as any).window.app.workspace.activeEditor = { editor: { inTableCell: false } }
			const vim = new VimSupport(makeHost()) as any
			const cm = makeFakeCm()
			vim.tableRedo(cm, { repeat: 2 })
			expect(cm.operation).toHaveBeenCalled()
			expect(commandsMock().redo).toHaveBeenCalledTimes(2)
			expect(cm.setCursor).not.toHaveBeenCalled()
		})

		it('tableUndo, no active editor at all: falls back to the native vim cm undo', () => {
			;(globalThis as any).window.app.workspace.activeEditor = undefined
			const vim = new VimSupport(makeHost()) as any
			const cm = makeFakeCm()
			vim.tableUndo(cm, { repeat: 1 })
			expect(commandsMock().undo).toHaveBeenCalledTimes(1)
		})
	})
})
