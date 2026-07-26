import { describe, it, expect, vi, afterEach } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'
import { installVimWindow, uninstallVimWindow, type FakeEditor } from './__helpers__/vimWindow'

// moveByLines' in-cell branch (editor.inTableCell === true): cm is the inner
// EditorView for the current table cell. Covers within-cell movement (which
// needs no special code — see the comment on moveByLines itself), crossing
// detection/overshoot, resync after a deferred crossing, and the two
// continuity-tracking bugs found and fixed during development (empty-cell
// ephemeral inner views, and Tab-jump coincidental {line,ch} matches).

const makeHost = (overrides: Partial<VimSupportHost> = {}): VimSupportHost => ({
	settings: { vimHlSupport: false, smartJoin: false },
	getBeginningOfLinePosition: () => 0,
	saveSettings: async () => {},
	crossTableRowForCell: vi.fn().mockReturnValue(null),
	isLinePartOfTable: vi.fn().mockReturnValue(false),
	enterTableAtLine: vi.fn().mockReturnValue(null),
	...overrides,
})

// A single-line inner view (one <br>-segment / no wrap) — head is an offset
// into `text`. Doubles as a VimCm (getLine/lastLine) so the same object can be
// passed both as editor.activeCM (for resync) and as a subsequent motion
// call's own `cm` argument, matching how vim.js would hand back the same view.
function makeInnerCm(text: string, head: number) {
	return {
		state: {
			doc: { lineAt: (_pos: number) => ({ number: 1, from: 0 }) },
			selection: { main: { head } },
		},
		getLine: (_n: number) => text,
		lastLine: () => 0,
	}
}

const ROW = '| aaa | bbb |' // cellIndex 0 = 'aaa' (ch 2-4), cellIndex 1 = 'bbb' (ch 9-11)

function makeCellEditor(cursor: { line: number; ch: number }, activeCM?: any, outerCm: any = {}): FakeEditor {
	return {
		inTableCell: true,
		getCursor: () => cursor,
		getLine: (_n: number) => ROW,
		activeCM,
		cm: outerCm,
	}
}

describe('moveByLines: inside a table cell', () => {
	let win: ReturnType<typeof installVimWindow>
	afterEach(() => uninstallVimWindow())

	it('moves within the cell without crossing (no host call)', () => {
		const host = makeHost()
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeCellEditor({ line: 5, ch: 9 })) // inside 'bbb'
		// single-segment cell, only line 0 exists — moving "down" within it isn't
		// possible, so use a cell with lastLine>0 to show non-crossing movement.
		const cmMulti = { getLine: (n: number) => (n === 0 ? 'bbb' : 'ccc'), lastLine: () => 1 }
		const result = vim.moveByLines(cmMulti, { line: 0, ch: 1 }, { forward: true, repeat: 1 })
		expect(result).toEqual({ line: 1, ch: 1 })
		expect(host.crossTableRowForCell).not.toHaveBeenCalled()
	})

	it('crossing: computes overshoot and calls crossTableRowForCell with the derived cellIndex/goalCh', () => {
		const host = makeHost({ crossTableRowForCell: vi.fn().mockReturnValue(null) })
		const vim = new VimSupport(host) as any
		// Outer cursor sits inside cellIndex 1 ('bbb'), ch=9 (start of 'bbb').
		win = installVimWindow(makeCellEditor({ line: 5, ch: 9 }))
		const cm = { getLine: () => 'bbb', lastLine: () => 0 } // single segment
		vim.moveByLines(cm, { line: 0, ch: 2 }, { forward: true, repeat: 1 })
		win.flush()
		expect(host.crossTableRowForCell).toHaveBeenCalledWith(
			expect.anything(), 1 /* cellIndex for 'bbb' */, true, 2 /* goalCh */, 1 /* overshoot */,
		)
	})

	it('a crossing that returns null (e.g. genuinely impossible) leaves state at the synchronous fallback, untouched by resync', () => {
		const host = makeHost({ crossTableRowForCell: vi.fn().mockReturnValue(null) })
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeCellEditor({ line: 5, ch: 9 }))
		const cm = { getLine: () => 'bbb', lastLine: () => 0 }
		const result = vim.moveByLines(cm, { line: 0, ch: 2 }, { forward: true, repeat: 1 })
		win.flush()
		// resyncAfterDeferredMove's `if (!landedOuter) return` fires — state
		// stays exactly what moveByLines' own synchronous tail end set.
		expect(vim.goalCh).toBe(2)
		expect(vim.lastCm).toBe(cm)
		expect(vim.lastReturnedPos).toEqual(result)
		expect(vim.lastOuterPos).toBeNull()
	})

	it('backward crossing computes overshoot from a negative rawTargetLine', () => {
		const host = makeHost({ crossTableRowForCell: vi.fn().mockReturnValue(null) })
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeCellEditor({ line: 5, ch: 2 })) // cellIndex 0 ('aaa')
		const cm = { getLine: () => 'aaa', lastLine: () => 0 }
		vim.moveByLines(cm, { line: 0, ch: 1 }, { forward: false, repeat: 3 })
		win.flush()
		expect(host.crossTableRowForCell).toHaveBeenCalledWith(
			expect.anything(), 0, false, 1, 3 /* overshoot = -rawTargetLine = -(-3) */,
		)
	})

	it('resyncs lastReturnedPos/lastCm/goalCh from the landed inner view, preserving the wide goal despite a clamped landing', () => {
		// Landing cell is only 2 chars ('zz') — a wide goalCh of 5 clamps to 1
		// there, but the *true* goal (5) must survive for the next crossing.
		const landedInner = makeInnerCm('zz', 1)
		const host = makeHost({
			crossTableRowForCell: vi.fn().mockReturnValue({ line: 6, ch: 1 }),
		})
		const vim = new VimSupport(host) as any
		const editor = makeCellEditor({ line: 5, ch: 9 }, landedInner)
		win = installVimWindow(editor)
		const wideCm = { getLine: () => 'cccccc', lastLine: () => 0 } // 6-char cell
		vim.moveByLines(wideCm, { line: 0, ch: 5 }, { forward: true, repeat: 1 }) // goalCh=5
		win.flush()

		expect(vim.goalCh).toBe(5)
		expect(vim.lastCm).toBe(landedInner)
		expect(vim.lastReturnedPos).toEqual({ line: 0, ch: 1 })
		expect(vim.lastOuterPos).toEqual({ line: 6, ch: 1 })

		// Continuing the chain (cm/head match what resync just cached) must
		// reuse goalCh=5 for the next crossing, not the clamped 1.
		vim.moveByLines(landedInner, { line: 0, ch: 1 }, { forward: true, repeat: 1 })
		win.flush()
		expect(host.crossTableRowForCell).toHaveBeenLastCalledWith(
			expect.anything(), expect.anything(), true, 5, expect.anything(),
		)
	})

	it('regression: empty cell (no inner view) resyncs against outer coordinates, still preserving the wide goal', () => {
		// editor.activeCM is undefined even though inTableCell is true — observed
		// for empty table cells (Obsidian doesn't create an inner view for one).
		// Without the outer-coordinate fallback, this would silently leave
		// lastReturnedPos/lastCm stale instead of tracking the real landing.
		const host = makeHost({
			crossTableRowForCell: vi.fn().mockReturnValue({ line: 6, ch: 0 }),
		})
		const vim = new VimSupport(host) as any
		const outerCm = { getLine: () => '', lastLine: () => 0 }
		const editor = makeCellEditor({ line: 5, ch: 9 }, undefined, outerCm)
		win = installVimWindow(editor)
		const wideCm = { getLine: () => 'cccccc', lastLine: () => 0 }
		vim.moveByLines(wideCm, { line: 0, ch: 5 }, { forward: true, repeat: 1 }) // goalCh=5
		win.flush()

		expect(vim.goalCh).toBe(5)
		expect(vim.lastCm).toBe(outerCm)
		expect(vim.lastReturnedPos).toEqual({ line: 6, ch: 0 })
		expect(vim.lastOuterPos).toEqual({ line: 6, ch: 0 })

		vim.moveByLines(outerCm, { line: 6, ch: 0 }, { forward: true, repeat: 1 })
		win.flush()
		expect(host.crossTableRowForCell).toHaveBeenLastCalledWith(
			expect.anything(), expect.anything(), true, 5, expect.anything(),
		)
	})

	it('regression: does not corrupt the caller\'s goalCh/cellIndex when a crossing lands clamped short', () => {
		// crossTableRowForCell simulates landing on a short row (clamped ch).
		const host = makeHost({
			crossTableRowForCell: vi.fn().mockReturnValue({ line: 6, ch: 0 }), // clamped short
		})
		const vim = new VimSupport(host) as any
		const landedInner = makeInnerCm('x', 0)
		const editor = makeCellEditor({ line: 5, ch: 9 }, landedInner)
		win = installVimWindow(editor)
		const cm = { getLine: () => 'bbb', lastLine: () => 0 }
		vim.moveByLines(cm, { line: 0, ch: 5 }, { forward: true, repeat: 1 }) // goalCh=5, clamped landing ch=0
		win.flush()

		// crossTableRowForCell must still have been called with the *original*
		// goalCh (5), not something derived from the clamped landing.
		expect(host.crossTableRowForCell).toHaveBeenCalledWith(expect.anything(), expect.anything(), true, 5, expect.anything())
	})

	it('regression: a coincidental {line, ch} match against a *different* cm (e.g. after Tab) is not treated as continuing', () => {
		const host = makeHost()
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeCellEditor({ line: 5, ch: 9 }))
		const cmA = { getLine: () => 'bbb', lastLine: () => 0 }
		const firstResult = vim.moveByLines(cmA, { line: 0, ch: 1 }, { forward: true, repeat: 1 })

		// A different cell's inner view can coincidentally report the exact same
		// {line, ch} (every single-segment cell numbers from {line:0, ch:0}).
		const cmB = { getLine: () => 'zzzzzzzzzz', lastLine: () => 0 }
		win.setEditor(makeCellEditor({ line: 8, ch: 2 })) // a genuinely different cell
		const secondResult = vim.moveByLines(cmB, firstResult, { forward: true, repeat: 1 })
		// Fresh goal column = head.ch from firstResult, not a stale wide value —
		// this is what "not continuing" should look like. We assert it via the
		// clamp: cmB's line is long (10 chars), so if a bogus wide goal from an
		// unrelated earlier chain had leaked through, the result would differ
		// from simply clamping firstResult.ch against cmB's own line.
		expect(secondResult.ch).toBe(Math.min(firstResult.ch, 9))
	})
})
