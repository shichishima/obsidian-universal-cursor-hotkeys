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
})
