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
})
