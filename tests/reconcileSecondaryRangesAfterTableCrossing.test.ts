import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorSelection } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../src/main.ts'

// reconcileSecondaryRangesAfterTableCrossing — the multi-cursor + table-
// boundary policy shared by moveCursorUp/Down/Left/Right's own wrappers.
//
// Policy: a table cell is rendered through a separate inner EditorView from
// the outer document, and only one view can hold DOM focus at a time — so
// once the PRIMARY range settles on one side (in a table cell or not), any
// OTHER range on the opposite side is dropped from the selection. The
// primary itself is never dropped.

function makeEditor(opts: {
	lines: number[]        // one line number per range (offset === line, ch always 0)
	mainIndex: number
	// Which lines isPositionInTable should report true for.
	tableLines: number[]
}) {
	const mockDispatch = vi.fn()
	const selection = EditorSelection.create(
		opts.lines.map(line => EditorSelection.cursor(line)),
		opts.mainIndex,
	)
	return {
		editor: {
			cm: { state: { selection }, dispatch: mockDispatch },
			offsetToPos: vi.fn((offset: number) => ({ line: offset, ch: 0 })),
		},
		mockDispatch,
		tableLines: opts.tableLines,
	}
}

describe('reconcileSecondaryRangesAfterTableCrossing', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
	})

	it('single range (common case): no-op, no dispatch', () => {
		const { editor, mockDispatch } = makeEditor({ lines: [5], mainIndex: 0, tableLines: [] })
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)

		plugin.reconcileSecondaryRangesAfterTableCrossing(editor)

		expect(mockDispatch).not.toHaveBeenCalled()
	})

	it('all ranges match the primary\'s table-status: no-op, no dispatch', () => {
		const { editor, mockDispatch } = makeEditor({ lines: [5, 20, 35], mainIndex: 0, tableLines: [] })
		plugin.isPositionInTable = vi.fn().mockReturnValue(false) // every position: not in table

		plugin.reconcileSecondaryRangesAfterTableCrossing(editor)

		expect(mockDispatch).not.toHaveBeenCalled()
	})

	it('secondary alone crosses into a table while primary stays out: secondary dropped', () => {
		// main (index 0) on line 5 stays in plain text; secondary on line 20 entered a table.
		const { editor, mockDispatch, tableLines } = makeEditor({ lines: [5, 20], mainIndex: 0, tableLines: [20] })
		plugin.isPositionInTable = vi.fn((_e: unknown, line: number) => tableLines.includes(line))

		plugin.reconcileSecondaryRangesAfterTableCrossing(editor)

		expect(mockDispatch).toHaveBeenCalledWith({
			selection: EditorSelection.create([EditorSelection.cursor(5)], 0),
			userEvent: 'move',
		})
	})

	it('primary itself crosses into a table while a secondary stays out: secondary dropped, primary kept', () => {
		// main (index 1) on line 20 is now in the table; secondary on line 5 stayed in plain text.
		const { editor, mockDispatch, tableLines } = makeEditor({ lines: [5, 20], mainIndex: 1, tableLines: [20] })
		plugin.isPositionInTable = vi.fn((_e: unknown, line: number) => tableLines.includes(line))

		plugin.reconcileSecondaryRangesAfterTableCrossing(editor)

		expect(mockDispatch).toHaveBeenCalledWith({
			selection: EditorSelection.create([EditorSelection.cursor(20)], 0),
			userEvent: 'move',
		})
	})

	it('multiple secondaries, only the mismatched one is dropped — others survive', () => {
		// main (index 0) on line 5: plain text. line 10: plain text (kept). line 20: table (dropped).
		const { editor, mockDispatch, tableLines } = makeEditor({ lines: [5, 10, 20], mainIndex: 0, tableLines: [20] })
		plugin.isPositionInTable = vi.fn((_e: unknown, line: number) => tableLines.includes(line))

		plugin.reconcileSecondaryRangesAfterTableCrossing(editor)

		expect(mockDispatch).toHaveBeenCalledWith({
			selection: EditorSelection.create([EditorSelection.cursor(5), EditorSelection.cursor(10)], 0),
			userEvent: 'move',
		})
	})

	it('probes with ch=1 rather than the range\'s own ch (avoids the left-edge-of-table resolution bug)', () => {
		// Confirmed live (2026-10-14): a secondary landing exactly at ch=0 of
		// a table's own first line read as "not in table" via the syntax
		// tree's side=-1 resolution at that exact boundary, one motion step
		// later than it should have. isPositionInTable must always be
		// probed with ch=1 (matching every other call site in main.ts), not
		// the range's actual ch, regardless of what that happens to be.
		const { editor, mockDispatch } = makeEditor({ lines: [5, 20], mainIndex: 0, tableLines: [20] })
		plugin.isPositionInTable = vi.fn((_e: unknown, line: number, ch: number) => ch === 1 && line === 20)

		plugin.reconcileSecondaryRangesAfterTableCrossing(editor)

		expect(mockDispatch).toHaveBeenCalledWith({
			selection: EditorSelection.create([EditorSelection.cursor(5)], 0),
			userEvent: 'move',
		})
	})

	it('no cm: no-op (defensive)', () => {
		const editor: any = { cm: undefined }
		plugin.isPositionInTable = vi.fn()

		expect(() => plugin.reconcileSecondaryRangesAfterTableCrossing(editor)).not.toThrow()
	})
})

// ---------------------------------------------------------------------------
// Integration: moveCursorDown's own wrapper calls reconcile after the move.
// ---------------------------------------------------------------------------

describe('moveCursorDown wrapper — reconciles secondary ranges after the move', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
	})

	it('drops a secondary that ended up in a table while the primary stayed in plain text', () => {
		plugin.isLivePreviewMode = vi.fn().mockReturnValue(true)
		plugin.moveCursorDownInTable = vi.fn()
		plugin.moveCursorDownIntoTable = vi.fn()

		// goDown is a no-op spy here — the selection below already represents
		// its post-move result (main stayed on line 0, plain text; the
		// secondary landed on line 5, which isPositionInTable reports as a
		// table line for this test). Offsets double as line numbers (ch
		// always 0) to match isPositionInTable's own real call convention
		// of always probing with ch=1 regardless of the range's actual ch.
		const exec = vi.fn()
		const mockDispatch = vi.fn()
		const selection = EditorSelection.create([
			EditorSelection.cursor(0),
			EditorSelection.cursor(5),
		], 0)
		const editor: any = {
			inTableCell: false,
			getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
			getLine: vi.fn().mockReturnValue('plain text'),
			lineCount: vi.fn().mockReturnValue(10),
			exec,
			cm: { state: { selection }, dispatch: mockDispatch },
			offsetToPos: vi.fn((offset: number) => ({ line: offset, ch: 0 })),
		}
		plugin.isPositionInTable = vi.fn((_e: unknown, line: number) => line === 5)
		plugin.isLineSkippableWidget = vi.fn().mockReturnValue(false)

		plugin.moveCursorDown(editor)

		expect(exec).toHaveBeenCalledWith('goDown')
		expect(mockDispatch).toHaveBeenCalledWith({
			selection: EditorSelection.create([EditorSelection.cursor(0)], 0),
			userEvent: 'move',
		})
	})

	it('started inside a table cell: reconcile is skipped entirely', () => {
		plugin.isLivePreviewMode = vi.fn().mockReturnValue(true)
		plugin.moveCursorDownInTable = vi.fn()
		plugin.reconcileSecondaryRangesAfterTableCrossing = vi.fn()
		const editor: any = { inTableCell: true, getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }) }

		plugin.moveCursorDown(editor)

		expect(plugin.moveCursorDownInTable).toHaveBeenCalledWith(editor)
		expect(plugin.reconcileSecondaryRangesAfterTableCrossing).not.toHaveBeenCalled()
	})
})

// ---------------------------------------------------------------------------
// dropSecondariesAboutToCrossTableBoundary — called from
// execPreservingGoalColumn's own generic UP/DOWN fast path BEFORE
// editor.exec('goUp'/'goDown') runs. Confirmed live (2026-10-14): without
// this, a secondary range sitting right at a table's edge gets skipped
// clean over the entire table by the native exec call (since only main-only
// helpers know how to land inside a table row), landing on the far side
// with a table-status that happens to match main's — which
// reconcileSecondaryRangesAfterTableCrossing's own after-the-fact check
// can't catch, since it only compares final positions. This has to run
// BEFORE exec instead.
// ---------------------------------------------------------------------------

describe('dropSecondariesAboutToCrossTableBoundary', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
	})

	// Treats each range's offset as a line number directly (ch always 0) —
	// this function's own check is purely line-based (pos.line + direction).
	function makeLineEditor(opts: { lines: number[]; mainIndex: number }) {
		const mockDispatch = vi.fn()
		const selection = EditorSelection.create(
			opts.lines.map(line => EditorSelection.cursor(line)),
			opts.mainIndex,
		)
		return {
			editor: {
				cm: { state: { selection }, dispatch: mockDispatch },
				offsetToPos: vi.fn((offset: number) => ({ line: offset, ch: 0 })),
			},
			mockDispatch,
		}
	}

	function stubIsPositionInTable(tableLines: number[]) {
		plugin.isPositionInTable = vi.fn((_e: unknown, line: number) => tableLines.includes(line))
	}

	it('single range: no-op, no dispatch', () => {
		const { editor, mockDispatch } = makeLineEditor({ lines: [5], mainIndex: 0 })
		stubIsPositionInTable([])

		plugin.dropSecondariesAboutToCrossTableBoundary(editor, 1)

		expect(mockDispatch).not.toHaveBeenCalled()
	})

	it('secondary alone is about to cross into a table going down while main is not: secondary dropped', () => {
		// The exact live-confirmed bug scenario: main (line 5) has a plain
		// next line; secondary (line 9) is right before a table (line 10).
		const { editor, mockDispatch } = makeLineEditor({ lines: [5, 9], mainIndex: 0 })
		stubIsPositionInTable([10])

		plugin.dropSecondariesAboutToCrossTableBoundary(editor, 1)

		expect(mockDispatch).toHaveBeenCalledWith({
			selection: EditorSelection.create([EditorSelection.cursor(5)], 0),
			userEvent: 'move',
		})
	})

	it('main is about to cross into a table going down while a secondary is not: secondary dropped', () => {
		const { editor, mockDispatch } = makeLineEditor({ lines: [20, 5], mainIndex: 1 })
		stubIsPositionInTable([6])

		plugin.dropSecondariesAboutToCrossTableBoundary(editor, 1)

		expect(mockDispatch).toHaveBeenCalledWith({
			selection: EditorSelection.create([EditorSelection.cursor(5)], 0),
			userEvent: 'move',
		})
	})

	it('both main and secondary are about to cross into the same table: nothing dropped', () => {
		const { editor, mockDispatch } = makeLineEditor({ lines: [9, 9], mainIndex: 0 })
		stubIsPositionInTable([10])

		plugin.dropSecondariesAboutToCrossTableBoundary(editor, 1)

		expect(mockDispatch).not.toHaveBeenCalled()
	})

	it('going up (verticalDirection=-1): checks the line above instead', () => {
		// main (line 5): line above (4) is plain. secondary (line 11): line
		// above (10) is a table -> dropped.
		const { editor, mockDispatch } = makeLineEditor({ lines: [5, 11], mainIndex: 0 })
		stubIsPositionInTable([10])

		plugin.dropSecondariesAboutToCrossTableBoundary(editor, -1)

		expect(mockDispatch).toHaveBeenCalledWith({
			selection: EditorSelection.create([EditorSelection.cursor(5)], 0),
			userEvent: 'move',
		})
	})

	it('no cm: no-op (defensive)', () => {
		const editor: any = { cm: undefined }
		plugin.isPositionInTable = vi.fn()

		expect(() => plugin.dropSecondariesAboutToCrossTableBoundary(editor, 1)).not.toThrow()
	})
})

// ---------------------------------------------------------------------------
// execPreservingGoalColumn — the goalColumn-restoration dispatch (hit when
// exec clamps at a document boundary) used to unconditionally collapse to a
// single range regardless of how many were active.
// ---------------------------------------------------------------------------

describe('execPreservingGoalColumn — multi-cursor goalColumn restoration', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)
	})

	it('restores goalColumn onto main only, keeping other ranges untouched', () => {
		const mockDispatch = vi.fn()
		const exec = vi.fn()
		// Before exec: main (index 0) at offset 0 already has goalColumn=42;
		// secondary at offset 20.
		const beforeSelection = EditorSelection.create([
			EditorSelection.cursor(0, undefined, undefined, 42),
			EditorSelection.cursor(20),
		], 0)
		const editor: any = {
			getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
			exec,
			cm: { state: { selection: beforeSelection }, dispatch: mockDispatch },
			offsetToPos: vi.fn((offset: number) => ({ line: 0, ch: offset })),
		}
		// Simulate exec('goDown') clamping at a boundary: position
		// unchanged, but the goalColumn field is gone afterward — the exact
		// scenario this function exists to repair.
		exec.mockImplementation(() => {
			editor.cm.state = {
				selection: EditorSelection.create([
					EditorSelection.cursor(0),
					EditorSelection.cursor(20),
				], 0),
			}
		})

		plugin.execPreservingGoalColumn(editor, 'goDown')

		expect(mockDispatch).toHaveBeenCalledWith({
			selection: EditorSelection.create([
				EditorSelection.cursor(0, undefined, undefined, 42),
				EditorSelection.cursor(20),
			], 0),
		})
	})
})
