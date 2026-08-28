import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

const LINE_TABLE = '| a | b |'

describe('moveCursorDownIntoTable', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.computeRowCrossPixelGoal = vi.fn().mockReturnValue(999)
		plugin.applyRowCrossGoalColumn  = vi.fn()
	})

	it('captures pixelGoal before crossing, lands in the leftmost cell (unchanged), then threads pixelGoal through', () => {
		const editor = {
			getCursor: vi.fn().mockReturnValue({ line: 0, ch: 5 }),
			getLine: vi.fn().mockReturnValue(LINE_TABLE),
			setCursor: vi.fn(),
		}
		plugin.moveCursorDownIntoTable(editor)
		expect(plugin.computeRowCrossPixelGoal).toHaveBeenCalledWith(editor)
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 1, ch: 2 }) // leftmost cell content start
		expect(plugin.applyRowCrossGoalColumn).toHaveBeenCalledWith(editor, 999)
		// pixelGoal captured before the crossing dispatch, not after.
		const goalOrder  = plugin.computeRowCrossPixelGoal.mock.invocationCallOrder[0]
		const applyOrder = plugin.applyRowCrossGoalColumn.mock.invocationCallOrder[0]
		expect(goalOrder).toBeLessThan(applyOrder)
	})
})


describe('moveCursorUpIntoTable', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.computeRowCrossPixelGoal = vi.fn().mockReturnValue(999)
		plugin.placeAtBottomVL         = vi.fn()
	})

	it('VL2+: goUp stays on the same line (no table entry) → placeAtBottomVL not called', () => {
		const editor = {
			getCursor: vi.fn().mockReturnValue({ line: 1, ch: 3 }), // unchanged after exec('goUp')
			getLine: vi.fn().mockReturnValue(LINE_TABLE),
			exec: vi.fn(),
			setCursor: vi.fn(),
		}
		plugin.moveCursorUpIntoTable(editor)
		expect(plugin.computeRowCrossPixelGoal).toHaveBeenCalledWith(editor)
		expect(plugin.placeAtBottomVL).not.toHaveBeenCalled()
	})

	it('VL1: goUp exits to the table above → lands in the leftmost cell, placeAtBottomVL(editor, pixelGoal)', () => {
		const cursorSeq = [{ line: 1, ch: 3 }, { line: 0, ch: 0 }]
		let call = 0
		const editor = {
			getCursor: vi.fn(() => cursorSeq[Math.min(call++, cursorSeq.length - 1)]),
			getLine: vi.fn().mockReturnValue(LINE_TABLE),
			exec: vi.fn(),
			setCursor: vi.fn(),
		}
		plugin.moveCursorUpIntoTable(editor)
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 2 }) // leftmost cell content start
		expect(plugin.placeAtBottomVL).toHaveBeenCalledWith(editor, 999)
	})
})
