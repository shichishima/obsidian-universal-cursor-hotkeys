import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'
import { getStartOfCellContent, getEndOfCellContent, getCellIndex } from '../table-cell-utils.ts'

// LINE_SINGLE = '| content |'  (no <br>)
// LINE_EMPTY  = '|  |'         (empty cell, startOfCellContent === eoc)
const LINE_SINGLE = '| content |'
const LINE_EMPTY  = '|  |'

const START_SINGLE = getStartOfCellContent(LINE_SINGLE, 3)
const EOC_SINGLE    = getEndOfCellContent(LINE_SINGLE, 3)
const CELL_INDEX    = getCellIndex(LINE_SINGLE, 3)

describe('moveCursorUpInTable', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.setCursorToPrevRow          = vi.fn()
		plugin.setCursorViaCm              = vi.fn()
		plugin.placeAtBottomVL             = vi.fn()
		plugin.handleCellStartSnap         = vi.fn()
		// Fixed sentinel so assertions can confirm the exact value threads
		// through unchanged into every call site below.
		plugin.computeRowCrossPixelGoal     = vi.fn().mockReturnValue(999)
	})

	// getCursor returns values in sequence; the last value repeats for any
	// further calls. No inner view attached (activeCM left undefined) unless
	// a test explicitly needs one — moveCursorUpInTable's assoc-correction
	// block already no-ops safely when there's no distinct inner view.
	function makeEditor(lineText: string, cursors: { line: number; ch: number }[], lineMap?: Record<number, string>) {
		const mock = vi.fn()
		cursors.forEach((c, i) => {
			if (i < cursors.length - 1) mock.mockReturnValueOnce(c)
			else mock.mockReturnValue(c)
		})
		return {
			getCursor: mock,
			getLine: vi.fn().mockImplementation((n: number) => lineMap?.[n] ?? lineText),
			exec: vi.fn(),
			inTableCell: true,
		}
	}

	it('empty cell: setCursorToPrevRow + placeAtBottomVL(editor, pixelGoal), computeRowCrossPixelGoal called before crossing', () => {
		const editor = makeEditor(LINE_EMPTY, [{ line: 1, ch: 1 }])
		plugin.moveCursorUpInTable(editor)
		expect(plugin.computeRowCrossPixelGoal).toHaveBeenCalledWith(editor)
		expect(plugin.setCursorToPrevRow).toHaveBeenCalledWith(editor, 0)
		expect(plugin.placeAtBottomVL).toHaveBeenCalledWith(editor, 999)
		// Captured before any crossing helper ran.
		const goalCallOrder  = plugin.computeRowCrossPixelGoal.mock.invocationCallOrder[0]
		const crossCallOrder = plugin.setCursorToPrevRow.mock.invocationCallOrder[0]
		expect(goalCallOrder).toBeLessThan(crossCallOrder)
	})

	it('goUp exits to a different logical line (previous row) → placeAtBottomVL(editor, pixelGoal)', () => {
		const editor = makeEditor(LINE_SINGLE, [
			{ line: 1, ch: 5 },
			{ line: 0, ch: 3 },
		], { 0: LINE_SINGLE, 1: LINE_SINGLE })
		plugin.moveCursorUpInTable(editor)
		expect(plugin.setCursorViaCm).toHaveBeenCalled()
		expect(plugin.placeAtBottomVL).toHaveBeenCalledWith(editor, 999)
	})

	it('goUp stayed on the same line, cursor was at/before cell start → setCursorToPrevRow + placeAtBottomVL(editor, pixelGoal)', () => {
		const editor = makeEditor(LINE_SINGLE, [
			{ line: 1, ch: START_SINGLE },
			{ line: 1, ch: START_SINGLE },
		])
		plugin.moveCursorUpInTable(editor)
		expect(plugin.setCursorToPrevRow).toHaveBeenCalledWith(editor, CELL_INDEX)
		expect(plugin.placeAtBottomVL).toHaveBeenCalledWith(editor, 999)
	})

	it('goUp snapped to cell start, original cursor was at VL1 end (non-wrapped cell) → setCursorToPrevRow + placeAtBottomVL(editor, pixelGoal), no handleCellStartSnap', () => {
		const editor = makeEditor(LINE_SINGLE, [
			{ line: 1, ch: EOC_SINGLE },
			{ line: 1, ch: START_SINGLE },
		])
		plugin.moveCursorUpInTable(editor)
		expect(plugin.setCursorToPrevRow).toHaveBeenCalledWith(editor, CELL_INDEX)
		expect(plugin.placeAtBottomVL).toHaveBeenCalledWith(editor, 999)
		expect(plugin.handleCellStartSnap).not.toHaveBeenCalled()
	})

	it('goUp snapped to cell start, ambiguous VL1-middle-vs-VL2+ case → handleCellStartSnap called with pixelGoal threaded through', () => {
		// cursor.ch strictly between start and eoc, and end result snaps to start.
		const midCh = START_SINGLE + 1
		const editor = makeEditor(LINE_SINGLE, [
			{ line: 1, ch: midCh },
			{ line: 1, ch: START_SINGLE },
		])
		plugin.moveCursorUpInTable(editor)
		expect(plugin.handleCellStartSnap).toHaveBeenCalledWith(editor, 1, midCh, CELL_INDEX, 999, undefined)
		expect(plugin.setCursorToPrevRow).not.toHaveBeenCalled()
	})

	it('goUp moved within the cell to the VL above (no crossing) → no placement helper called', () => {
		const midCh = START_SINGLE + 2
		const editor = makeEditor(LINE_SINGLE, [
			{ line: 1, ch: midCh },
			{ line: 1, ch: midCh - 1 },
		])
		plugin.moveCursorUpInTable(editor)
		expect(plugin.setCursorToPrevRow).not.toHaveBeenCalled()
		expect(plugin.placeAtBottomVL).not.toHaveBeenCalled()
		expect(plugin.handleCellStartSnap).not.toHaveBeenCalled()
	})

	// Regression: the VL-wrap-point assoc-fix dispatch used to build a fresh
	// selection via EditorSelection.cursor(head, 1) with no 4th (goalColumn)
	// argument, silently dropping whatever wide goal the up/down chain was
	// carrying — the very next editor.exec('goUp') (CM6's native
	// cursorLineUp) would then compute a brand-new goalColumn from this
	// dispatch's own position instead of continuing the carried-over one.
	// The fix's own condition (VL wrap-point left edge) is true on
	// essentially every visit to a blank in-cell sub-line (no content to be
	// anywhere but the edge), which is why the loss showed up specifically
	// when crossing blank lines within a cell. Mirrors the identical test in
	// moveCursorDownInTable.test.ts.
	it('assoc-fix dispatch (VL wrap-point) carries the live goalColumn through, not just assoc', () => {
		const midCh = START_SINGLE + 2
		const head = midCh
		const dispatch = vi.fn()
		const inner = {
			state: {
				selection: { main: { head, assoc: 0, goalColumn: 42 } },
			},
			coordsAtPos: vi.fn((pos: number) => (pos === head ? { top: 100, bottom: 118, left: 10, right: 20 } : null)),
			// VL-start check succeeds (returns the same head) -> fix dispatch fires.
			posAtCoords: vi.fn(() => head),
			dispatch,
		}
		const editor = Object.assign(makeEditor(LINE_SINGLE, [
			{ line: 1, ch: midCh },
			{ line: 1, ch: midCh - 1 },
		]), { activeCM: inner, cm: {} })
		plugin.moveCursorUpInTable(editor)
		expect(dispatch).toHaveBeenCalledTimes(1)
		const dispatchedSelection = dispatch.mock.calls[0][0].selection
		expect(dispatchedSelection.main.goalColumn).toBe(42)
	})
})
