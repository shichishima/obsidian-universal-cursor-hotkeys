import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorSelection } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../../src/main.ts'

// Add cursor above/below. Native Obsidian's own 'editor:add-cursor-below'/
// '-above' were confirmed (live, via E2E) to mis-step vertically, so this
// reuses CM6's own view.moveVertically directly instead — the same
// primitive extendMarkVertically already uses for Set-mark's Ctrl-N/P
// extend (see tests/unit/setMark.test.ts for that function's own tests;
// this file mirrors its mocking convention).

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

describe('addCursorVertically', () => {
	let plugin: any

	beforeEach(() => {
		plugin = makePlugin()
	})

	describe('outer (plain text)', () => {
		it('adds exactly one new cursor at the moveVertically result, keeping the original range, and makes the new one primary', () => {
			const cm = makeView([{ anchor: 10, head: 10 }], 0, { head: 25, goalColumn: 3 })
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.addCursorVertically(editor, true)

			expect(cm.moveVertically).toHaveBeenCalledWith(expect.objectContaining({ anchor: 10, head: 10 }), true)
			expect(cm.dispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([
					EditorSelection.range(10, 10),
					EditorSelection.cursor(25, undefined, undefined, 3),
				], 1),
				userEvent: 'select.uch',
				scrollIntoView: true,
			})
		})

		it('a new cursor added above an existing one is inserted in sorted position and still becomes primary', () => {
			const cm = makeView([{ anchor: 20, head: 20 }], 0, { head: 5 })
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.addCursorVertically(editor, false)

			const dispatched = cm.dispatch.mock.calls[0][0]
			expect(dispatched.selection.ranges.map((r: any) => r.head)).toEqual([5, 20])
			expect(dispatched.selection.mainIndex).toBe(0) // the new cursor, now first after sorting
		})

		it('computes from the primary only; an existing secondary is left completely untouched', () => {
			const cm = makeView(
				[{ anchor: 10, head: 10 }, { anchor: 50, head: 50 }],
				0, // primary is the first range (offset 10)
				{ head: 25 },
			)
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.addCursorVertically(editor, true)

			expect(cm.moveVertically).toHaveBeenCalledTimes(1)
			expect(cm.moveVertically).toHaveBeenCalledWith(expect.objectContaining({ head: 10 }), true)
			const dispatched = cm.dispatch.mock.calls[0][0]
			expect(dispatched.selection.ranges.map((r: any) => r.head)).toEqual([10, 25, 50])
		})

		it('no-op (no dispatch) when moveVertically reports no further line in that direction', () => {
			const cm = makeView([{ anchor: 10, head: 10 }], 0, { head: 10 })
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.addCursorVertically(editor, true)

			expect(cm.dispatch).not.toHaveBeenCalled()
		})

		// Same mouse-drag artifact as extendMarkVertically — see its own test
		// for the full rationale (a genuine pixel goalColumn is never negative).
		it('strips a negative goalColumn before calling moveVertically (mouse-drag artifact)', () => {
			const dispatch = vi.fn()
			const moveVertically = vi.fn().mockReturnValue({ head: 20 })
			const dragSelection = EditorSelection.create([EditorSelection.range(0, 10, -1, undefined, -1)], 0)
			const cm: any = { state: { selection: dragSelection }, moveVertically, dispatch }
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.addCursorVertically(editor, true)

			const passedRange = moveVertically.mock.calls[0][0]
			expect(passedRange.anchor).toBe(0)
			expect(passedRange.head).toBe(10)
			expect(passedRange.goalColumn).toBeUndefined() // stripped, not the native -1
		})

		it('does not touch markActive — leaves an already-active mark armed for the new cursor to extend from next', () => {
			plugin.markActive = true
			const cm = makeView([{ anchor: 10, head: 10 }], 0, { head: 25 })
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.addCursorVertically(editor, true)

			expect(plugin.markActive).toBe(true)
		})
	})

	// Deliberately deferred by 2 animation frames before doing anything —
	// confirmed live that ANY preceding command run against a table cell's
	// own inner view (even a no-op add-cursor-above) can leave an async
	// Obsidian-internal resync pending that silently clobbers whatever
	// selection we dispatch next if we don't wait it out first (same race
	// category as exitCellWithSelection's own 2-RAF-frame deferral
	// elsewhere in this file). A manual requestAnimationFrame queue (not
	// vitest's fake timers) gives precise control over exactly how many
	// frames have fired, mirroring rowCrossGoalColumn.test.ts's own
	// convention for the identical kind of deferred-correction function.
	describe('LP table cell', () => {
		let rafQueue: Array<() => void>

		function flushFrame() {
			const due = rafQueue
			rafQueue = []
			due.forEach(cb => cb())
		}

		beforeEach(() => {
			rafQueue = []
			const win = { requestAnimationFrame: (cb: () => void) => { rafQueue.push(cb); return rafQueue.length } }
			vi.stubGlobal('window', win)
			vi.stubGlobal('activeWindow', win)
		})

		afterEach(() => {
			vi.unstubAllGlobals()
		})

		it('defers by 2 frames, then uses the inner (table cell) view instead of the outer one', () => {
			const outerCm = { state: {}, dispatch: vi.fn(), moveVertically: vi.fn() }
			const inner = makeView([{ anchor: 4, head: 4 }], 0, { head: 9 })
			const editor: any = { cm: outerCm, activeCM: inner, inTableCell: true }

			plugin.addCursorVertically(editor, false)
			expect(inner.dispatch).not.toHaveBeenCalled() // not yet — still waiting out the settle window

			flushFrame()
			expect(inner.dispatch).not.toHaveBeenCalled() // only 1 of 2 frames elapsed
			flushFrame()

			expect(inner.moveVertically).toHaveBeenCalledWith(expect.objectContaining({ anchor: 4, head: 4 }), false)
			expect(inner.dispatch).toHaveBeenCalled()
			expect(outerCm.dispatch).not.toHaveBeenCalled()
			expect(outerCm.moveVertically).not.toHaveBeenCalled()
		})

		it('no-op at the cell\'s own first/last sub-line boundary — same "unchanged head" signal as outer', () => {
			const inner = makeView([{ anchor: 6, head: 6 }], 0, { head: 6 }) // already at the cell's own last sub-line
			const editor: any = { cm: {}, activeCM: inner, inTableCell: true }

			plugin.addCursorVertically(editor, true)
			flushFrame()
			flushFrame()

			expect(inner.dispatch).not.toHaveBeenCalled()
		})
	})
})
