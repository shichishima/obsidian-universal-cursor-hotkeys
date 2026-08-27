import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

describe('computeRowCrossPixelGoal', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
	})

	function makeInner(opts: {
		goalColumn?: number
		rectLeft?: number
		coords?: { left: number } | null
	}) {
		return {
			state: { selection: { main: { head: 42, goalColumn: opts.goalColumn } } },
			contentDOM: { getBoundingClientRect: vi.fn(() => ({ left: opts.rectLeft ?? 0 })) },
			coordsAtPos: vi.fn(() => opts.coords ?? null),
		}
	}

	it('no distinct inner view (activeCM === cm) → null', () => {
		const cm = {}
		const editor = { activeCM: cm, cm }
		expect(plugin.computeRowCrossPixelGoal(editor)).toBeNull()
	})

	it('goalColumn defined → rect.left + goalColumn (screen-absolute), coordsAtPos not consulted', () => {
		const inner = makeInner({ goalColumn: 30, rectLeft: 100 })
		const editor = { activeCM: inner, cm: {} }
		expect(plugin.computeRowCrossPixelGoal(editor)).toBe(130)
		expect(inner.coordsAtPos).not.toHaveBeenCalled()
	})

	it('goalColumn undefined, coordsAtPos resolves → falls back to coords.left', () => {
		const inner = makeInner({ goalColumn: undefined, coords: { left: 77 } })
		const editor = { activeCM: inner, cm: {} }
		expect(plugin.computeRowCrossPixelGoal(editor)).toBe(77)
		expect(inner.coordsAtPos).toHaveBeenCalledWith(42)
	})

	it('goalColumn undefined, coordsAtPos also returns null → null', () => {
		const inner = makeInner({ goalColumn: undefined, coords: null })
		const editor = { activeCM: inner, cm: {} }
		expect(plugin.computeRowCrossPixelGoal(editor)).toBeNull()
	})
})


describe('applyRowCrossGoalColumnSync', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.refineDisplayLineColumn = vi.fn()
	})

	function makeInner(head: number, assoc: number, rectLeft: number) {
		return {
			state: { selection: { main: { head, assoc } } },
			contentDOM: { getBoundingClientRect: vi.fn(() => ({ left: rectLeft })) },
			dispatch: vi.fn(),
		}
	}

	it('pixelGoal === null → no-op, refineDisplayLineColumn not called', () => {
		const inner = makeInner(10, 1, 0)
		const editor = { activeCM: inner, cm: {} }
		plugin.applyRowCrossGoalColumnSync(editor, null)
		expect(plugin.refineDisplayLineColumn).not.toHaveBeenCalled()
		expect(inner.dispatch).not.toHaveBeenCalled()
	})

	it('pixelGoal given → calls refineDisplayLineColumn, then re-reads activeCM and writes goalColumn onto the settled view', () => {
		// Simulate refineDisplayLineColumn dispatching and shifting activeCM to
		// a "settled" view distinct from the one current when this was called —
		// re-seeding must use the *settled* view, not the pre-refinement one.
		const staleInner   = makeInner(5, 1, 50)
		const settledInner = makeInner(20, -1, 90)
		const editor: any = { activeCM: staleInner, cm: {} }
		plugin.refineDisplayLineColumn = vi.fn(() => { editor.activeCM = settledInner })

		plugin.applyRowCrossGoalColumnSync(editor, 130)

		expect(plugin.refineDisplayLineColumn).toHaveBeenCalledWith(editor, 130)
		expect(staleInner.dispatch).not.toHaveBeenCalled()
		expect(settledInner.dispatch).toHaveBeenCalledTimes(1)
		const call = settledInner.dispatch.mock.calls[0][0]
		expect(call.selection.main.head).toBe(20)
		expect(call.selection.main.assoc).toBe(-1)
		// goalColumn is content-relative to the settled view's own rect (130 - 90 = 40).
		expect(call.selection.main.goalColumn).toBe(40)
	})

	it('landing exited the table entirely (no distinct inner view after refinement) → refineDisplayLineColumn called, no dispatch attempted', () => {
		const cm = {}
		const editor: any = { activeCM: cm, cm }
		plugin.applyRowCrossGoalColumnSync(editor, 100)
		expect(plugin.refineDisplayLineColumn).toHaveBeenCalledWith(editor, 100)
		// No inner view to dispatch onto — must not throw, must not call anything further.
	})
})


describe('applyRowCrossGoalColumn', () => {
	let plugin: any

	beforeEach(() => {
		vi.stubGlobal('window', globalThis)
		vi.useFakeTimers()
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin._inScrollPage = false
		plugin.applyRowCrossGoalColumnSync = vi.fn()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it('pixelGoal === null → no-op entirely, no scheduling', () => {
		const editor = { activeCM: {}, cm: {}, inTableCell: true }
		plugin.applyRowCrossGoalColumn(editor, null)
		vi.advanceTimersByTime(0)
		expect(plugin.applyRowCrossGoalColumnSync).not.toHaveBeenCalled()
	})

	it('destination inner view already mounted (coordsAtPos resolves) → applies synchronously', () => {
		const inner = {
			state: { selection: { main: { head: 5 } } },
			coordsAtPos: vi.fn(() => ({ left: 10 })),
		}
		const editor = { activeCM: inner, cm: {}, inTableCell: true }
		plugin.applyRowCrossGoalColumn(editor, 200)
		expect(plugin.applyRowCrossGoalColumnSync).toHaveBeenCalledWith(editor, 200)
	})

	it('destination inner view not yet mounted (coordsAtPos null) → defers one tick, retries once mounted', () => {
		const inner = {
			state: { selection: { main: { head: 5 } } },
			coordsAtPos: vi.fn(() => null),
		}
		const editor = { activeCM: inner, cm: {}, inTableCell: true }
		plugin.applyRowCrossGoalColumn(editor, 200)
		expect(plugin.applyRowCrossGoalColumnSync).not.toHaveBeenCalled()
		vi.advanceTimersByTime(0)
		expect(plugin.applyRowCrossGoalColumnSync).toHaveBeenCalledWith(editor, 200)
	})

	it('no longer in a table cell by the time the deferred timer fires → does not apply', () => {
		const inner = {
			state: { selection: { main: { head: 5 } } },
			coordsAtPos: vi.fn(() => null),
		}
		const editor = { activeCM: inner, cm: {}, inTableCell: false }
		plugin.applyRowCrossGoalColumn(editor, 200)
		vi.advanceTimersByTime(0)
		expect(plugin.applyRowCrossGoalColumnSync).not.toHaveBeenCalled()
	})

	it('_inScrollPage true → does not schedule at all', () => {
		plugin._inScrollPage = true
		const inner = {
			state: { selection: { main: { head: 5 } } },
			coordsAtPos: vi.fn(() => null),
		}
		const editor = { activeCM: inner, cm: {}, inTableCell: true }
		plugin.applyRowCrossGoalColumn(editor, 200)
		vi.advanceTimersByTime(0)
		expect(plugin.applyRowCrossGoalColumnSync).not.toHaveBeenCalled()
	})
})
