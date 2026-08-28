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

	it('no distinct inner view (activeCM === cm, i.e. still in plain text) → reads the outer view directly, same as an inner cell view', () => {
		// Table entry (moveCursorUpIntoTable/moveCursorDownIntoTable) calls
		// this while still in plain text, before any cell exists to focus —
		// editor.activeCM already resolves to the outer view in that case, so
		// no special-casing is needed here.
		const cm = makeInner({ goalColumn: 15, rectLeft: 40 })
		const editor = { activeCM: cm, cm }
		expect(plugin.computeRowCrossPixelGoal(editor)).toBe(55)
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
		// side=-1: head may sit exactly on a visual-line wrap boundary — without
		// it, CM6 defaults to reporting the *next* visual line's start instead
		// of the true end of the line the cursor is visually on.
		expect(inner.coordsAtPos).toHaveBeenCalledWith(42, -1)
	})

	it('goalColumn undefined, coordsAtPos also returns null → null', () => {
		const inner = makeInner({ goalColumn: undefined, coords: null })
		const editor = { activeCM: inner, cm: {} }
		expect(plugin.computeRowCrossPixelGoal(editor)).toBeNull()
	})
})


describe('applyRowCrossGoalColumnSync', () => {
	let plugin: any
	let rafQueue: Array<() => void>

	// Manual requestAnimationFrame queue (not vitest's fake timers): this
	// environment is plain 'node' (no requestAnimationFrame global at all),
	// and we need precise control over exactly how many frames have fired —
	// applyRowCrossGoalColumnSync defers its real work two frames deep (see
	// its own doc comment: confirmed live that Obsidian's own cell-focus
	// reconciliation resets the cursor one frame after a synchronous
	// correction, so the fix must land strictly after that settles).
	function flushFrame() {
		const due = rafQueue
		rafQueue = []
		due.forEach(cb => cb())
	}

	beforeEach(() => {
		rafQueue = []
		vi.stubGlobal('window', { requestAnimationFrame: (cb: () => void) => { rafQueue.push(cb); return rafQueue.length } })
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.refineDisplayLineColumn = vi.fn()
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	function makeInner(head: number, assoc: number, rectLeft: number) {
		return {
			state: { selection: { main: { head, assoc } } },
			contentDOM: { getBoundingClientRect: vi.fn(() => ({ left: rectLeft })) },
			dispatch: vi.fn(),
		}
	}

	it('pixelGoal === null → no-op, refineDisplayLineColumn not called, nothing scheduled', () => {
		const inner = makeInner(10, 1, 0)
		const editor = { activeCM: inner, cm: {} }
		plugin.applyRowCrossGoalColumnSync(editor, null)
		expect(rafQueue).toHaveLength(0)
		flushFrame(); flushFrame()
		expect(plugin.refineDisplayLineColumn).not.toHaveBeenCalled()
		expect(inner.dispatch).not.toHaveBeenCalled()
	})

	it('pixelGoal given → does nothing for one frame, then (on the second) calls refineDisplayLineColumn and re-reads activeCM to write goalColumn onto the settled view', () => {
		// Simulate refineDisplayLineColumn dispatching and shifting activeCM to
		// a "settled" view distinct from the one current when this was called —
		// re-seeding must use the *settled* view, not the pre-refinement one.
		const staleInner   = makeInner(5, 1, 50)
		const settledInner = makeInner(20, 1, 90)
		const editor: any = { activeCM: staleInner, cm: {} }
		plugin.refineDisplayLineColumn = vi.fn(() => { editor.activeCM = settledInner })

		plugin.applyRowCrossGoalColumnSync(editor, 130)
		expect(plugin.refineDisplayLineColumn).not.toHaveBeenCalled()

		flushFrame() // 1st deferred frame — still nothing yet
		expect(plugin.refineDisplayLineColumn).not.toHaveBeenCalled()

		flushFrame() // 2nd deferred frame — the real correction runs now
		// allowLineEnd=true: unlike vim's gj/gk (Normal-mode-legal clamping),
		// Emacs Ctrl-N/P is not modal and must be able to land past the last
		// character (e.g. "shortcuts|").
		expect(plugin.refineDisplayLineColumn).toHaveBeenCalledWith(editor, 130, true)
		expect(staleInner.dispatch).not.toHaveBeenCalled()
		expect(settledInner.dispatch).toHaveBeenCalledTimes(1)
		const call = settledInner.dispatch.mock.calls[0][0]
		expect(call.selection.main.head).toBe(20)
		// assoc is always forced to -1, regardless of what the settled view's
		// own selection carried (1, here) — see this function's own comment.
		expect(call.selection.main.assoc).toBe(-1)
		// goalColumn is content-relative to the settled view's own rect (130 - 90 = 40).
		expect(call.selection.main.goalColumn).toBe(40)
	})

	it('landing exited the table entirely (no distinct inner view after refinement) → still re-seeds goalColumn, onto the outer view', () => {
		// A blank/short exit line has no content for refineDisplayLineColumn to
		// place the cursor beyond ch 0 — goalColumn must still be written onto
		// the outer view itself, or a later native goDown/goUp through that
		// line would have nothing to inherit and would silently forget the
		// preserved column (this is the real bug this test guards against).
		const cm = makeInner(0, 1, 60)
		const editor: any = { activeCM: cm, cm }
		plugin.applyRowCrossGoalColumnSync(editor, 100)
		flushFrame(); flushFrame()
		expect(plugin.refineDisplayLineColumn).toHaveBeenCalledWith(editor, 100, true)
		expect(cm.dispatch).toHaveBeenCalledTimes(1)
		const call = cm.dispatch.mock.calls[0][0]
		expect(call.selection.main.head).toBe(0)
		expect(call.selection.main.assoc).toBe(-1)
		expect(call.selection.main.goalColumn).toBe(40) // 100 - 60
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

	it('no distinct inner view (activeCM === cm) → exited the table entirely: applies synchronously, no defer', () => {
		const cm = {}
		const editor = { activeCM: cm, cm, inTableCell: false }
		plugin.applyRowCrossGoalColumn(editor, 200)
		expect(plugin.applyRowCrossGoalColumnSync).toHaveBeenCalledWith(editor, 200)
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
