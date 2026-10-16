import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorSelection } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../../src/main.ts'

// Emacs-style Set-mark (Ctrl-Space to arm, Ctrl-G to clear), first
// increment: Ctrl-N/P (UP/DOWN) extension only. markActive is a plain
// session-only flag — no separate mark position is ever stored, a range's
// own anchor already serves that role once extension begins.

function makePlugin() {
	const plugin: any = Object.create(UniversalCursorHotkeysPlugin.prototype)
	return plugin
}

// A minimal EditorView-like mock: real ranges/EditorSelection, a fake
// moveVertically returning a fixed head/goalColumn per call, and dispatch
// captured for assertions.
function makeView(ranges: { anchor: number; head: number }[], mainIndex: number, moveVerticallyResult: { head: number; goalColumn?: number }) {
	const dispatch = vi.fn()
	const selection = EditorSelection.create(
		ranges.map(r => EditorSelection.range(r.anchor, r.head)),
		mainIndex,
	)
	return {
		state: { selection },
		moveVertically: vi.fn().mockReturnValue(moveVerticallyResult),
		dispatch,
	}
}

describe('Set-mark', () => {
	let plugin: any

	beforeEach(() => {
		plugin = makePlugin()
	})

	describe('setMark', () => {
		it('arms markActive; a no-op on the selection when nothing is selected yet', () => {
			const cm = makeView([{ anchor: 7, head: 7 }], 0, { head: -1 })
			const editor: any = { cm, activeCM: cm }

			plugin.setMark(editor)

			expect(plugin.markActive).toBe(true)
			expect(cm.dispatch).not.toHaveBeenCalled()
		})

		it('re-set semantics: pressing it again while a region is already active abandons the current selection and re-anchors at the current head', () => {
			plugin.markActive = true
			const cm = makeView([{ anchor: 3, head: 10 }], 0, { head: -1 })
			const editor: any = { cm, activeCM: cm }

			plugin.setMark(editor)

			expect(plugin.markActive).toBe(true)
			expect(cm.dispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.cursor(10)], 0),
				userEvent: 'select',
			})
		})
	})

	describe('keyboardQuit', () => {
		it('disarms markActive and collapses an active selection to its head', () => {
			plugin.markActive = true
			const cm = makeView([{ anchor: 3, head: 10 }], 0, { head: -1 })
			const editor: any = { cm, activeCM: cm }

			plugin.keyboardQuit(editor)

			expect(plugin.markActive).toBe(false)
			expect(cm.dispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.cursor(10)], 0),
				userEvent: 'select',
			})
		})

		it('no-ops the dispatch when every range is already collapsed', () => {
			plugin.markActive = true
			const cm = makeView([{ anchor: 5, head: 5 }], 0, { head: -1 })
			const editor: any = { cm, activeCM: cm }

			plugin.keyboardQuit(editor)

			expect(plugin.markActive).toBe(false)
			expect(cm.dispatch).not.toHaveBeenCalled()
		})

		it('collapses the inner (table cell) view when that is where the selection lives', () => {
			plugin.markActive = true
			const outerCm = { state: {}, dispatch: vi.fn() }
			const inner = makeView([{ anchor: 2, head: 8 }], 0, { head: -1 })
			const editor: any = { cm: outerCm, activeCM: inner }

			plugin.keyboardQuit(editor)

			expect(inner.dispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.cursor(8)], 0),
				userEvent: 'select',
			})
			expect(outerCm.dispatch).not.toHaveBeenCalled()
		})

		// Mirrors CM6's own simplifySelection (bound to bare Escape by
		// default): multiple ranges collapse to the main range ONLY, in one
		// step — even if that main range is itself a non-empty selection,
		// it is NOT also collapsed to a cursor in the same press (that's a
		// second, separate press's job, matching native Escape's own
		// step-wise "first drop extra cursors, then collapse the
		// selection" cascade). See keyboardQuit's own doc comment for why
		// this matters: a future bare-ESC Key Upgrade targeting this
		// command must not quietly remove the "Escape clears multi-cursor"
		// capability users already have today.
		it('collapses a multi-range selection to the main range only, in one step, even when main is itself non-empty', () => {
			plugin.markActive = true
			const dispatch = vi.fn()
			const selection = EditorSelection.create(
				[EditorSelection.range(0, 2), EditorSelection.range(10, 15)],
				1, // main is the second range, itself non-empty
			)
			const cm: any = { state: { selection }, dispatch }
			const editor: any = { cm, activeCM: cm }

			plugin.keyboardQuit(editor)

			expect(plugin.markActive).toBe(false)
			expect(dispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.range(10, 15)]),
				userEvent: 'select',
			})
		})
	})

	describe('moveCursorUp/moveCursorDown — markActive branch', () => {
		it('moveCursorDown calls extendMarkVertically(editor, true) and skips the plain-motion path entirely when markActive', () => {
			plugin.markActive = true
			plugin.extendMarkVertically = vi.fn()
			plugin.moveCursorDownImpl = vi.fn()
			plugin.reconcileSecondaryRangesAfterTableCrossing = vi.fn()
			const editor: any = { inTableCell: false }

			plugin.moveCursorDown(editor)

			expect(plugin.extendMarkVertically).toHaveBeenCalledWith(editor, true)
			expect(plugin.moveCursorDownImpl).not.toHaveBeenCalled()
			expect(plugin.reconcileSecondaryRangesAfterTableCrossing).not.toHaveBeenCalled()
		})

		it('moveCursorUp calls extendMarkVertically(editor, false) and skips the plain-motion path entirely when markActive', () => {
			plugin.markActive = true
			plugin.extendMarkVertically = vi.fn()
			plugin.moveCursorUpImpl = vi.fn()
			plugin.reconcileSecondaryRangesAfterTableCrossing = vi.fn()
			const editor: any = { inTableCell: false }

			plugin.moveCursorUp(editor)

			expect(plugin.extendMarkVertically).toHaveBeenCalledWith(editor, false)
			expect(plugin.moveCursorUpImpl).not.toHaveBeenCalled()
			expect(plugin.reconcileSecondaryRangesAfterTableCrossing).not.toHaveBeenCalled()
		})

		it('moveCursorDown takes the existing plain-motion path, unchanged, when markActive is false', () => {
			plugin.markActive = false
			plugin.extendMarkVertically = vi.fn()
			plugin.moveCursorDownImpl = vi.fn()
			plugin.reconcileSecondaryRangesAfterTableCrossing = vi.fn()
			const editor: any = { inTableCell: false }

			plugin.moveCursorDown(editor)

			expect(plugin.extendMarkVertically).not.toHaveBeenCalled()
			expect(plugin.moveCursorDownImpl).toHaveBeenCalledWith(editor)
			expect(plugin.reconcileSecondaryRangesAfterTableCrossing).toHaveBeenCalledWith(editor)
		})
	})

	describe('extendMarkVertically', () => {
		it('extends every range from its own anchor to the native moveVertically result, in one dispatch (outer view)', () => {
			const cm = makeView(
				[{ anchor: 0, head: 0 }, { anchor: 20, head: 20 }],
				0,
				{ head: 5, goalColumn: 3 },
			)
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.extendMarkVertically(editor, true)

			expect(cm.moveVertically).toHaveBeenCalledTimes(2)
			expect(cm.dispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([
					EditorSelection.range(0, 5, 3),
					EditorSelection.range(20, 5, 3),
				], 0),
				userEvent: 'select',
				scrollIntoView: true,
			})
		})

		it('uses the inner (table cell) view instead of the outer one when inTableCell', () => {
			const outerCm = { state: {}, dispatch: vi.fn(), moveVertically: vi.fn() }
			const inner = makeView([{ anchor: 4, head: 4 }], 0, { head: 9 })
			const editor: any = { cm: outerCm, activeCM: inner, inTableCell: true }

			plugin.extendMarkVertically(editor, false)

			expect(inner.moveVertically).toHaveBeenCalledWith(expect.objectContaining({ anchor: 4, head: 4 }), false)
			expect(inner.dispatch).toHaveBeenCalled()
			expect(outerCm.dispatch).not.toHaveBeenCalled()
			expect(outerCm.moveVertically).not.toHaveBeenCalled()
		})

		it('clamping in-cell (moveVertically returns the unchanged head) is just whatever the native call reports — no extra logic needed', () => {
			const inner = makeView([{ anchor: 2, head: 6 }], 0, { head: 6 }) // already at the cell's own last sub-line
			const editor: any = { cm: {}, activeCM: inner, inTableCell: true }

			plugin.extendMarkVertically(editor, true)

			expect(inner.dispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.range(2, 6)], 0),
				userEvent: 'select',
				scrollIntoView: true,
			})
		})

		describe('moveCursorLeft/moveCursorRight — markActive branch', () => {
			it('moveCursorRight calls extendMarkHorizontalChar(editor, true) and skips the plain-motion path entirely when markActive', () => {
				plugin.markActive = true
				plugin.extendMarkHorizontalChar = vi.fn()
				plugin.moveCursorRightImpl = vi.fn()
				plugin.reconcileSecondaryRangesAfterTableCrossing = vi.fn()
				const editor: any = { inTableCell: false }

				plugin.moveCursorRight(editor)

				expect(plugin.extendMarkHorizontalChar).toHaveBeenCalledWith(editor, true)
				expect(plugin.moveCursorRightImpl).not.toHaveBeenCalled()
				expect(plugin.reconcileSecondaryRangesAfterTableCrossing).not.toHaveBeenCalled()
			})

			it('moveCursorLeft calls extendMarkHorizontalChar(editor, false) and skips the plain-motion path entirely when markActive', () => {
				plugin.markActive = true
				plugin.extendMarkHorizontalChar = vi.fn()
				plugin.moveCursorLeftImpl = vi.fn()
				plugin.reconcileSecondaryRangesAfterTableCrossing = vi.fn()
				const editor: any = { inTableCell: false }

				plugin.moveCursorLeft(editor)

				expect(plugin.extendMarkHorizontalChar).toHaveBeenCalledWith(editor, false)
				expect(plugin.moveCursorLeftImpl).not.toHaveBeenCalled()
				expect(plugin.reconcileSecondaryRangesAfterTableCrossing).not.toHaveBeenCalled()
			})

			it('moveCursorRight takes the existing plain-motion path, unchanged, when markActive is false', () => {
				plugin.markActive = false
				plugin.extendMarkHorizontalChar = vi.fn()
				plugin.moveCursorRightImpl = vi.fn()
				plugin.reconcileSecondaryRangesAfterTableCrossing = vi.fn()
				const editor: any = { inTableCell: false }

				plugin.moveCursorRight(editor)

				expect(plugin.extendMarkHorizontalChar).not.toHaveBeenCalled()
				expect(plugin.moveCursorRightImpl).toHaveBeenCalledWith(editor)
				expect(plugin.reconcileSecondaryRangesAfterTableCrossing).toHaveBeenCalledWith(editor)
			})
		})

		describe('moveCursorHome/moveCursorEnd — markActive branch', () => {
			it('moveCursorHome calls extendMarkHome(editor) and skips the plain-motion path entirely when markActive', () => {
				plugin.markActive = true
				plugin.extendMarkHome = vi.fn()
				plugin.moveCursorHomeInTable = vi.fn()
				plugin.moveCursorHomeNonTable = vi.fn()
				const editor: any = { inTableCell: false, getCursor: () => ({ line: 0, ch: 0 }) }

				plugin.moveCursorHome(editor)

				expect(plugin.extendMarkHome).toHaveBeenCalledWith(editor)
				expect(plugin.moveCursorHomeInTable).not.toHaveBeenCalled()
				expect(plugin.moveCursorHomeNonTable).not.toHaveBeenCalled()
			})

			it('moveCursorEnd calls extendMarkEnd(editor) and skips the plain-motion path entirely when markActive', () => {
				plugin.markActive = true
				plugin.extendMarkEnd = vi.fn()
				plugin.moveCursorEndInTable = vi.fn()
				plugin.moveCursorEndNonTable = vi.fn()
				const editor: any = { inTableCell: false, getCursor: () => ({ line: 0, ch: 0 }) }

				plugin.moveCursorEnd(editor)

				expect(plugin.extendMarkEnd).toHaveBeenCalledWith(editor)
				expect(plugin.moveCursorEndInTable).not.toHaveBeenCalled()
				expect(plugin.moveCursorEndNonTable).not.toHaveBeenCalled()
			})
		})

		// Regression: a real mouse-drag selection's own resulting range
		// carries a native goalColumn of -1 (confirmed live, directly off
		// cm.state.selection.main — not undefined/no-goal, and not
		// something this plugin's own code ever sets). moveVertically
		// trusts a present goalColumn as-is, so blindly forwarding -1 made
		// every first Ctrl-N/P extend after a drag land at column 0
		// regardless of where the drag's own head actually was. A
		// non-negative goalColumn (the product of a real previous vertical
		// move, chaining consecutive extends through varying line lengths)
		// must still be forwarded as-is.
		it('strips a negative goalColumn before calling moveVertically (mouse-drag artifact), but forwards a real one unchanged', () => {
			const dispatch = vi.fn()
			const moveVertically = vi.fn().mockReturnValue({ head: 20, goalColumn: 7 })
			const dragSelection = EditorSelection.create([EditorSelection.range(0, 10, -1, undefined, -1)], 0)
			const cm: any = { state: { selection: dragSelection }, moveVertically, dispatch }
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.extendMarkVertically(editor, true)

			const passedRange = moveVertically.mock.calls[0][0]
			expect(passedRange.anchor).toBe(0)
			expect(passedRange.head).toBe(10)
			expect(passedRange.goalColumn).toBeUndefined() // stripped, not the native -1

			moveVertically.mockClear()
			const realGoalSelection = EditorSelection.create([EditorSelection.range(0, 10, 7)], 0)
			cm.state.selection = realGoalSelection
			plugin.extendMarkVertically(editor, true)
			expect(moveVertically.mock.calls[0][0].goalColumn).toBe(7) // forwarded unchanged
		})
	})

	describe('extendMarkHorizontalChar', () => {
		it('extends every range via the native moveByChar result, in one dispatch (outer view, plain text)', () => {
			plugin.isLivePreviewMode = vi.fn().mockReturnValue(false)
			const cm: any = {
				state: { selection: EditorSelection.create([EditorSelection.range(0, 0), EditorSelection.range(20, 20)], 0) },
				moveByChar: vi.fn().mockReturnValue({ head: 5, assoc: 1 }),
				dispatch: vi.fn(),
			}
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.extendMarkHorizontalChar(editor, true)

			expect(cm.moveByChar).toHaveBeenCalledTimes(2)
			expect(cm.dispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([
					EditorSelection.range(0, 5, undefined, undefined, 1),
					EditorSelection.range(20, 5, undefined, undefined, 1),
				], 0),
				userEvent: 'select',
				scrollIntoView: true,
			})
		})

		it('uses the inner (table cell) view instead of the outer one when inTableCell, and never checks for a table-skip there', () => {
			const outerCm: any = { state: {}, dispatch: vi.fn(), moveByChar: vi.fn() }
			const inner: any = {
				state: { selection: EditorSelection.create([EditorSelection.range(4, 4)], 0) },
				moveByChar: vi.fn().mockReturnValue({ head: 9, assoc: 1 }),
				dispatch: vi.fn(),
			}
			plugin.isLivePreviewMode = vi.fn().mockReturnValue(true) // must be ignored for the in-cell branch
			const editor: any = { cm: outerCm, activeCM: inner, inTableCell: true }

			plugin.extendMarkHorizontalChar(editor, false)

			expect(inner.moveByChar).toHaveBeenCalledWith(expect.objectContaining({ anchor: 4, head: 4 }), false)
			expect(inner.dispatch).toHaveBeenCalled()
			expect(outerCm.dispatch).not.toHaveBeenCalled()
			expect(outerCm.moveByChar).not.toHaveBeenCalled()
		})

		it('skips the whole table when the adjacent line is part of one, landing via findOffsetPastWholeTableHorizontal instead of moveByChar', () => {
			plugin.isLivePreviewMode = vi.fn().mockReturnValue(true)
			plugin.isPositionInTable = vi.fn().mockReturnValue(true) // adjacent line IS a table
			plugin.findOffsetPastWholeTableHorizontal = vi.fn().mockReturnValue(999)
			const cm: any = {
				state: { selection: EditorSelection.create([EditorSelection.range(0, 10)], 0) },
				moveByChar: vi.fn(),
				dispatch: vi.fn(),
			}
			const editor: any = {
				cm, activeCM: cm, inTableCell: false,
				offsetToPos: vi.fn().mockReturnValue({ line: 2, ch: 5 }), // at the line's own end
				getLine: vi.fn().mockReturnValue('abcde'), // length 5, matches ch -> at line edge going forward
				lastLine: vi.fn().mockReturnValue(10),
			}

			plugin.extendMarkHorizontalChar(editor, true)

			expect(plugin.findOffsetPastWholeTableHorizontal).toHaveBeenCalledWith(editor, 2, true)
			expect(cm.moveByChar).not.toHaveBeenCalled()
			expect(cm.dispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.range(0, 999)], 0),
				userEvent: 'select',
				scrollIntoView: true,
			})
		})

		it('clamps (leaves the range unchanged) when the table runs all the way to the document edge', () => {
			plugin.isLivePreviewMode = vi.fn().mockReturnValue(true)
			plugin.isPositionInTable = vi.fn().mockReturnValue(true)
			plugin.findOffsetPastWholeTableHorizontal = vi.fn().mockReturnValue(null)
			const cm: any = {
				state: { selection: EditorSelection.create([EditorSelection.range(0, 10)], 0) },
				moveByChar: vi.fn(),
				dispatch: vi.fn(),
			}
			const editor: any = {
				cm, activeCM: cm, inTableCell: false,
				offsetToPos: vi.fn().mockReturnValue({ line: 2, ch: 5 }),
				getLine: vi.fn().mockReturnValue('abcde'),
				lastLine: vi.fn().mockReturnValue(10),
			}

			plugin.extendMarkHorizontalChar(editor, true)

			expect(cm.dispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.range(0, 10)], 0),
				userEvent: 'select',
				scrollIntoView: true,
			})
		})
	})

	describe('findOffsetPastWholeTableHorizontal', () => {
		it("scans forward past a whole table block, landing at the far line's own content start (ch=0)", () => {
			const lines = ['before', '| a | b |', '| - | - |', '| c | d |', 'after']
			const posToOffset = vi.fn().mockReturnValue(42)
			const editor: any = {
				lastLine: () => lines.length - 1,
				getLine: (n: number) => lines[n],
				posToOffset,
			}
			plugin.isPositionInTable = vi.fn((_e: any, line: number) => line >= 1 && line <= 3)

			const result = plugin.findOffsetPastWholeTableHorizontal(editor, 0, true)

			expect(posToOffset).toHaveBeenCalledWith({ line: 4, ch: 0 })
			expect(result).toBe(42)
		})

		it("scans backward past a whole table block, landing at the near line's own end (ch=line.length)", () => {
			const lines = ['before', '| a | b |', '| - | - |', '| c | d |', 'after']
			const posToOffset = vi.fn().mockReturnValue(7)
			const editor: any = {
				lastLine: () => lines.length - 1,
				getLine: (n: number) => lines[n],
				posToOffset,
			}
			plugin.isPositionInTable = vi.fn((_e: any, line: number) => line >= 1 && line <= 3)

			const result = plugin.findOffsetPastWholeTableHorizontal(editor, 4, false)

			expect(posToOffset).toHaveBeenCalledWith({ line: 0, ch: 'before'.length })
			expect(result).toBe(7)
		})

		it("returns null when the table runs all the way to the document's own edge", () => {
			const lines = ['| a | b |', '| - | - |', 'after']
			const editor: any = {
				lastLine: () => lines.length - 1,
				getLine: (n: number) => lines[n],
				posToOffset: vi.fn(),
			}
			plugin.isPositionInTable = vi.fn((_e: any, line: number) => line === 0 || line === 1)

			const result = plugin.findOffsetPastWholeTableHorizontal(editor, 1, false)

			expect(result).toBeNull()
		})
	})

	describe('extendMarkHome/extendMarkEnd', () => {
		it("extendMarkHome extends every outer range to its own computeHomeTargetNonTable result, in one dispatch", () => {
			const cm: any = {
				state: { selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(20, 23)], 0) },
				dispatch: vi.fn(),
			}
			const editor: any = { cm, inTableCell: false }
			plugin.computeHomeTargetNonTable = vi.fn().mockReturnValue({ pos: 0, assoc: 1 })

			plugin.extendMarkHome(editor)

			expect(plugin.computeHomeTargetNonTable).toHaveBeenCalledTimes(2)
			expect(cm.dispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([
					EditorSelection.range(0, 0, undefined, undefined, 1),
					EditorSelection.range(20, 0, undefined, undefined, 1),
				], 0),
				userEvent: 'select',
				scrollIntoView: true,
			})
		})

		it('extendMarkEnd skips the dispatch entirely when every range is already at its End target (null)', () => {
			const cm: any = {
				state: { selection: EditorSelection.create([EditorSelection.range(0, 5)], 0) },
				dispatch: vi.fn(),
			}
			const editor: any = { cm, inTableCell: false }
			plugin.computeEndTargetNonTable = vi.fn().mockReturnValue(null)

			plugin.extendMarkEnd(editor)

			expect(cm.dispatch).not.toHaveBeenCalled()
		})

		it("extendMarkHome delegates to the inner view when inTableCell, clamping a range already at the cell's own edge instead of exiting", () => {
			const inner: any = {
				state: { selection: EditorSelection.create([EditorSelection.range(2, 2), EditorSelection.range(2, 8)], 1) },
				dispatch: vi.fn(),
			}
			const outerCm: any = { dispatch: vi.fn() }
			const editor: any = { cm: outerCm, activeCM: inner, inTableCell: true }
			plugin.computeHomeTargetInCell = vi.fn()
				.mockReturnValueOnce({ kind: 'exit' }) // first range: already at the cell's own first sub-line start
				.mockReturnValueOnce({ kind: 'stay', pos: 5 }) // second range: moves to 5

			plugin.extendMarkHome(editor)

			expect(inner.dispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([
					EditorSelection.range(2, 2), // unchanged (clamped, not exited)
					EditorSelection.range(2, 5),
				], 1),
				userEvent: 'select',
				scrollIntoView: true,
			})
			expect(outerCm.dispatch).not.toHaveBeenCalled()
		})
	})
})
