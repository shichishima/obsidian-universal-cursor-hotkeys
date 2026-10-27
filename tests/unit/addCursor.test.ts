import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../../src/main.ts'

// Add cursor above/below. Native Obsidian's own 'editor:add-cursor-below'/
// '-above' step by LOGICAL line + character column (confirmed live: it
// jumps straight to the next logical line, skipping every remaining visual
// sub-line of a word-wrapped current one — not visual/pixel-based the way
// plain arrow-key Up/Down and this plugin's own Ctrl-N/P are), but native's
// own line-index arithmetic has a genuine off-by-one bug that skips an
// extra logical line every press. This file's own addCursorOnView
// re-implements the intended behavior directly: next/previous logical line
// via CM6's own Text.lineAt/Text.line, column clamped by character count
// (not a pixel goal-column) against that line's own length, no memory of
// any "original" column kept across presses (confirmed explicitly
// acceptable — each press just clamps whatever the current primary's own
// column actually is). A real EditorState (not a stub) backs `view.state`
// in every test here so `state.doc.lineAt`/`.line` behave exactly as the
// production code depends on — a stub couldn't verify the actual line
// lookup/clamping logic at all.

function makePlugin() {
	const plugin: any = Object.create(UniversalCursorHotkeysPlugin.prototype)
	return plugin
}

// A minimal EditorView-like mock: a real EditorState (so state.doc.lineAt/
// .line are the genuine CM6 implementation) and a captured dispatch.
// EditorState.allowMultipleSelections must be explicitly turned on — without
// it, EditorState.create silently collapses a multi-range selection down to
// just its own main range (confirmed live; a real EditorView always enables
// this itself).
function makeView(text: string, ranges: { anchor: number; head: number }[], mainIndex: number) {
	const dispatch = vi.fn()
	const state = EditorState.create({
		doc: text,
		selection: EditorSelection.create(ranges.map(r => EditorSelection.range(r.anchor, r.head)), mainIndex),
		extensions: [EditorState.allowMultipleSelections.of(true)],
	})
	return { state, dispatch }
}

describe('addCursorVertically', () => {
	let plugin: any

	beforeEach(() => {
		plugin = makePlugin()
	})

	describe('outer (plain text)', () => {
		it('adds exactly one new cursor on the next logical line, character-clamped, keeping the original range, and makes the new one primary', () => {
			// line0: 10 chars, line1: "bb" (2 chars) — primary at line0 ch8
			// clamps to line1's own end (ch2).
			const text = 'aaaaaaaaaa\nbb\ncccccccccc'
			const cm = makeView(text, [{ anchor: 8, head: 8 }], 0)
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.addCursorVertically(editor, true)

			expect(cm.dispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([
					EditorSelection.range(8, 8),
					EditorSelection.cursor(13), // line1 start (11) + min(8, 2) = 13
				], 1),
				userEvent: 'select.uch',
				scrollIntoView: true,
			})
		})

		it('a new cursor added above an existing one is inserted in sorted position and still becomes primary', () => {
			// line0: "aaaaaaaaaa" (10), line1: "bb" (2) — primary on line1 at ch1, going up clamps to line0 ch1.
			const text = 'aaaaaaaaaa\nbb'
			const cm = makeView(text, [{ anchor: 12, head: 12 }], 0) // line1 ch1 (offset 11 + 1)
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.addCursorVertically(editor, false)

			const dispatched = cm.dispatch.mock.calls[0][0]
			expect(dispatched.selection.ranges.map((r: any) => r.head)).toEqual([1, 12])
			expect(dispatched.selection.mainIndex).toBe(0) // the new cursor, now first after sorting
		})

		it('computes from the primary only; an existing secondary is left completely untouched', () => {
			const text = 'aaaaaaaaaa\nbb\ncccccccccc'
			const cm = makeView(
				text,
				[{ anchor: 8, head: 8 }, { anchor: 20, head: 20 }],
				0, // primary is the first range (line0 ch8)
			)
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.addCursorVertically(editor, true)

			const dispatched = cm.dispatch.mock.calls[0][0]
			expect(dispatched.selection.ranges.map((r: any) => r.head)).toEqual([8, 13, 20])
		})

		it('clamps within the current line at the buffer end, and no-ops on a second press once already there', () => {
			const text = 'short\nlast line is longer'
			const cm = makeView(text, [{ anchor: 8, head: 8 }], 0) // line1 ch2
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.addCursorVertically(editor, true)
			const dispatched = cm.dispatch.mock.calls[0][0]
			expect(dispatched.selection.ranges.map((r: any) => r.head)).toEqual([8, 6 + 'last line is longer'.length])

			// Apply that dispatch's own resulting selection, then press again — no further line below, already at this line's own end.
			const cm2 = makeView(text, [{ anchor: 8, head: 8 }, { anchor: 6 + 'last line is longer'.length, head: 6 + 'last line is longer'.length }], 1)
			const editor2: any = { cm: cm2, activeCM: cm2, inTableCell: false }
			plugin.addCursorVertically(editor2, true)
			expect(cm2.dispatch).not.toHaveBeenCalled()
		})

		it('no-op (no dispatch) when already at the buffer start, pressing above', () => {
			const cm = makeView('hello\nworld', [{ anchor: 0, head: 0 }], 0)
			const editor: any = { cm, activeCM: cm, inTableCell: false }

			plugin.addCursorVertically(editor, false)

			expect(cm.dispatch).not.toHaveBeenCalled()
		})

		it('does not touch markActive — leaves an already-active mark armed for the new cursor to extend from next', () => {
			plugin.markActive = true
			const cm = makeView('aaaaaaaaaa\nbb', [{ anchor: 8, head: 8 }], 0)
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

		it('defers by 2 frames, then uses the inner (table cell) view instead of the outer one, stepping by the cell\'s own real lines (<br> as real newlines)', () => {
			const outerCm = { state: EditorState.create({ doc: 'outer text' }), dispatch: vi.fn() }
			// Cell with 2 real sub-lines (as a real <br>-backed inner doc would be): "foo" / "bar"
			const inner = makeView('foo\nbar', [{ anchor: 1, head: 1 }], 0)
			const editor: any = { cm: outerCm, activeCM: inner, inTableCell: true }

			plugin.addCursorVertically(editor, true)
			expect(inner.dispatch).not.toHaveBeenCalled() // not yet — still waiting out the settle window

			flushFrame()
			expect(inner.dispatch).not.toHaveBeenCalled() // only 1 of 2 frames elapsed
			flushFrame()

			const dispatched = inner.dispatch.mock.calls[0][0]
			expect(dispatched.selection.ranges.map((r: any) => r.head)).toEqual([1, 5]) // line1 ("bar") start (4) + min(1, 3)
			expect(outerCm.dispatch).not.toHaveBeenCalled()
		})

		it('no-op at the cell\'s own first/last sub-line boundary — same "unchanged head" signal as outer', () => {
			const inner = makeView('foo\nbar', [{ anchor: 7, head: 7 }], 0) // already at the end of the cell's own last sub-line ("bar")
			const editor: any = { cm: { state: EditorState.create({ doc: '' }), dispatch: vi.fn() }, activeCM: inner, inTableCell: true }

			plugin.addCursorVertically(editor, true)
			flushFrame()
			flushFrame()

			expect(inner.dispatch).not.toHaveBeenCalled()
		})
	})
})
