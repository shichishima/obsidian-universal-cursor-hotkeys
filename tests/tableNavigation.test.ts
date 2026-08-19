import { describe, it, expect, vi } from 'vitest'
import { exitTable, jumpAdjacentCell } from '../table-navigation'
import type { TableNavHost } from '../table-navigation'

// table-navigation.ts's own exitTable/jumpAdjacentCell — pure logic, shared
// between the Vim leader-key commands (see vimTableNavigation.test.ts for
// registration/wiring) and the plain Emacs-side commands in main.ts. No
// vim/CM6/EditorView involved here at all, matching table-cell-utils.ts's
// own test style.

const makeHost = (overrides: Partial<TableNavHost> = {}): TableNavHost => ({
	isLinePartOfTable: vi.fn().mockReturnValue(false),
	getBeginningOfLinePosition: vi.fn().mockReturnValue(0),
	crossTableRowForCell: vi.fn().mockReturnValue(null),
	getAdjacentRowLine: vi.fn().mockReturnValue(0),
	setCursorAcrossTableBoundary: vi.fn(),
	appendBlankLineAndLand: vi.fn(),
	...overrides,
})

describe('exitTable', () => {
	const makeEditor = (lines: string[], cursorLine: number, overrides: Record<string, unknown> = {}) => ({
		getCursor: vi.fn().mockReturnValue({ line: cursorLine, ch: 0 }),
		getLine: vi.fn((n: number) => lines[n] ?? ''),
		lastLine: vi.fn().mockReturnValue(lines.length - 1),
		setCursor: vi.fn(),
		...overrides,
	})

	it('forward: scans down to the first non-table line, lands via host.setCursorAcrossTableBoundary + getBeginningOfLinePosition', () => {
		const host = makeHost({ getBeginningOfLinePosition: vi.fn().mockReturnValue(3) })
		const lines = ['| a |', '| b |', '| c |', 'plain text', 'more text']
		const editor = makeEditor(lines, 0)

		exitTable(editor as any, host, true)

		// Leaving the table cell's own inline editor for the outer view needs
		// the host's real CM6 dispatch, not the plain EditorBridge setCursor
		// (confirmed live that setCursor + focus(), in either order, does not
		// reliably transition inTableCell/DOM focus across this boundary).
		expect(host.setCursorAcrossTableBoundary).toHaveBeenCalledWith(editor, 3, 3)
		expect(host.getBeginningOfLinePosition).toHaveBeenCalledWith('plain text', 1)
		expect(editor.setCursor).not.toHaveBeenCalled()
	})

	it('backward: scans up to the first non-table line', () => {
		const host = makeHost()
		const lines = ['intro text', '| a |', '| b |', '| c |']
		const editor = makeEditor(lines, 3)

		exitTable(editor as any, host, false)

		expect(host.setCursorAcrossTableBoundary).toHaveBeenCalledWith(editor, 0, 0)
	})

	it('heuristic false negative (a table row that doesn\'t start with "|"): keeps scanning past it', () => {
		// Line 3 doesn't look like a table row textually, but the host's real
		// (syntax-tree-based) check says it still is one — the scan must not
		// stop there.
		const host = makeHost({ isLinePartOfTable: vi.fn((_e: unknown, line: number) => line === 3) })
		const lines = ['| a |', '| b |', '| c |', 'not-quite-a-pipe-row', 'plain text']
		const editor = makeEditor(lines, 0)

		exitTable(editor as any, host, true)

		expect(host.setCursorAcrossTableBoundary).toHaveBeenCalledWith(editor, 4, 0)
	})

	it('forward, table runs all the way to the document\'s last line: appends a blank line and lands there (mirrors Ctrl-N\'s own EOF fix) instead of no-op', () => {
		const host = makeHost()
		const lines = ['| a |', '| b |', '| c |']
		const editor = makeEditor(lines, 0)

		exitTable(editor as any, host, true)

		expect(host.appendBlankLineAndLand).toHaveBeenCalledWith(editor)
		expect(host.setCursorAcrossTableBoundary).not.toHaveBeenCalled()
	})

	it('backward, table runs all the way to the document\'s first line: no-op (matches real vim\'s own "k at buffer start" — no symmetric "prepend a line" fix)', () => {
		const host = makeHost()
		const lines = ['| a |', '| b |', '| c |']
		const editor = makeEditor(lines, 2)

		exitTable(editor as any, host, false)

		expect(host.appendBlankLineAndLand).not.toHaveBeenCalled()
		expect(host.setCursorAcrossTableBoundary).not.toHaveBeenCalled()
	})
})

describe('jumpAdjacentCell', () => {
	const makeEditor = (line: string, cursorCh: number, overrides: Record<string, unknown> = {}) => ({
		getCursor: vi.fn().mockReturnValue({ line: 5, ch: cursorCh }),
		getLine: vi.fn().mockReturnValue(line),
		setCursor: vi.fn(),
		...overrides,
	})

	it('h: jumps to the previous cell on the same line', () => {
		const editor = makeEditor('| a | b |', 6) // cellIndex 1 ("b")

		jumpAdjacentCell(editor as any, makeHost(), 'h')

		expect(editor.setCursor).toHaveBeenCalledWith({ line: 5, ch: 2 }) // cellIndex 0 ("a")
	})

	it('h: no-ops at the leftmost cell', () => {
		const editor = makeEditor('| a | b |', 2) // cellIndex 0

		jumpAdjacentCell(editor as any, makeHost(), 'h')

		expect(editor.setCursor).not.toHaveBeenCalled()
	})

	it('l: jumps to the next cell on the same line', () => {
		const editor = makeEditor('| a | b |', 2) // cellIndex 0

		jumpAdjacentCell(editor as any, makeHost(), 'l')

		expect(editor.setCursor).toHaveBeenCalledWith({ line: 5, ch: 6 }) // cellIndex 1
	})

	it('l: no-ops at the rightmost cell', () => {
		const editor = makeEditor('| a | b |', 6) // cellIndex 1, rightmost

		jumpAdjacentCell(editor as any, makeHost(), 'l')

		expect(editor.setCursor).not.toHaveBeenCalled()
	})

	it('j: crosses rows via host.crossTableRowForCell (goalCh 0, overshoot 1), then snaps to the landed cell\'s own content start', () => {
		const host = makeHost({ crossTableRowForCell: vi.fn().mockReturnValue({ line: 6, ch: 0 }) })
		const editor = makeEditor('| a | b |', 6, {
			getLine: vi.fn((n: number) => (n === 5 ? '| a | b |' : '| c |  d  |')),
		})

		jumpAdjacentCell(editor as any, host, 'j')

		expect(host.crossTableRowForCell).toHaveBeenCalledWith(editor, 1, true, 0, 1)
		// cellIndex 1 ("d") on '| c |  d  |' -> ch 7
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 6, ch: 7 })
	})

	it('j: no-ops when crossTableRowForCell returns null (no row below)', () => {
		const host = makeHost({ crossTableRowForCell: vi.fn().mockReturnValue(null) })
		const editor = makeEditor('| a | b |', 2)

		jumpAdjacentCell(editor as any, host, 'j')

		expect(editor.setCursor).not.toHaveBeenCalled()
	})

	it('j/k: no-ops at a table boundary (getAdjacentRowLine returns -1) *without* calling crossTableRowForCell at all — confirmed live that crossTableRowForCell itself is not side-effect-free at a boundary (matching Ctrl-P/N/gj/gk\'s own "exit the table" convention, it can move the cursor there before its return value is even inspected)', () => {
		const host = makeHost({
			getAdjacentRowLine: vi.fn().mockReturnValue(-1),
			crossTableRowForCell: vi.fn(),
		})
		const editor = makeEditor('| a | b |', 2)

		jumpAdjacentCell(editor as any, host, 'k')

		expect(host.getAdjacentRowLine).toHaveBeenCalledWith(editor, false)
		expect(host.crossTableRowForCell).not.toHaveBeenCalled()
		expect(editor.setCursor).not.toHaveBeenCalled()
	})

	it('k: crosses rows backward (forward=false)', () => {
		const host = makeHost({ crossTableRowForCell: vi.fn().mockReturnValue({ line: 4, ch: 0 }) })
		const editor = makeEditor('| a | b |', 2)

		jumpAdjacentCell(editor as any, host, 'k')

		expect(host.crossTableRowForCell).toHaveBeenCalledWith(editor, 0, false, 0, 1)
	})

	it('falls back to crossTableRowForCell\'s own landed ch if getChByCellIndex can\'t resolve the cell on the landed line', () => {
		const host = makeHost({ crossTableRowForCell: vi.fn().mockReturnValue({ line: 6, ch: 3 }) })
		const editor = makeEditor('| a | b |', 6, {
			getLine: vi.fn((n: number) => (n === 5 ? '| a | b |' : '')), // degenerate landed line
		})

		jumpAdjacentCell(editor as any, host, 'j')

		expect(editor.setCursor).toHaveBeenCalledWith({ line: 6, ch: 3 })
	})
})
