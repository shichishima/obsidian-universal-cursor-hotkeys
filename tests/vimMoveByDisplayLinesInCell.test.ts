import { describe, it, expect, vi, afterEach } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'
import { installVimWindow, uninstallVimWindow, type FakeEditor } from './__helpers__/vimWindow'

// moveByDisplayLines' in-cell branch (editor.inTableCell === true) — third
// design. Unlike the first two (discarded) attempts, which deferred *every*
// in-cell keystroke to a host round-trip (reusing Ctrl-N/P's own
// moveCursorUpInTable/DownInTable engine, then a separate raw
// EditorView.dispatch to pixel-correct — traced to a real, repeated vim.js
// key-dispatch corruption during live testing), this version computes the
// common (same-cell) case *synchronously*, via direct coordsAtPos/posAtCoords
// calls on the current (already-rendered) inner view — no dispatch, no defer,
// exactly like any other motion. Only a genuine cell-boundary crossing still
// defers, and even then only dispatches through the same setCursorViaCm
// function j/k's own crossing already uses safely (crossTableRowForCell for
// the rough landing, refineDisplayLineColumn for the pixel refinement).

const makeHost = (overrides: Partial<VimSupportHost> = {}): VimSupportHost => ({
	settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, vimGgSupport: false, vimDisplayLineSupport: false, vimEolSupport: false, vimTableStructureSupport: false, vimTableNavigationSupport: false, vimLeaderUseBackslash: false, smartJoin: false, smartHomeStandard: false },
	getBeginningOfLinePosition: () => 0,
	saveSettings: async () => {},
	crossTableRowForCell: vi.fn().mockReturnValue(null),
	getAdjacentRowLine: vi.fn().mockReturnValue(0),
	crossTableRowForWord: vi.fn().mockReturnValue(null),
	jumpToDocumentLine: vi.fn().mockReturnValue(null),
	isLinePartOfTable: vi.fn().mockReturnValue(false),
	enterTableAtLine: vi.fn().mockReturnValue(null),
	refineDisplayLineColumn: vi.fn().mockReturnValue(null),
	executeObsidianCommand: vi.fn().mockReturnValue(true),
	...overrides,
})

const LINE_HEIGHT = 18
const PX_PER_CH = 10

// Simulates a rendered inner view: `lines` are the cell's own <br>-segments
// (each one doc line, matching Obsidian's inner-view convention), each
// exactly LINE_HEIGHT px tall, PX_PER_CH px per character horizontally.
function makeInner(lines: string[], headOffset: number) {
	const starts: number[] = []
	let acc = 0
	for (const l of lines) { starts.push(acc); acc += l.length + 1 }
	const lineAt = (pos: number) => {
		let idx = lines.length - 1
		for (let i = 0; i < lines.length; i++) {
			const end = starts[i] + lines[i].length
			if (pos <= end) { idx = i; break }
		}
		return { number: idx + 1, from: starts[idx], length: lines[idx].length }
	}
	return {
		state: {
			doc: {
				lineAt,
				line: (n: number) => ({ from: starts[n - 1] }),
			},
			selection: { main: { head: headOffset } },
		},
		coordsAtPos: (pos: number) => {
			const l = lineAt(pos)
			const top = (l.number - 1) * LINE_HEIGHT
			const left = (pos - l.from) * PX_PER_CH
			return { top, bottom: top + LINE_HEIGHT, left, right: 999 }
		},
		posAtCoords: ({ x, y }: { x: number; y: number }) => {
			const idx = Math.floor(y / LINE_HEIGHT)
			if (idx < 0 || idx >= lines.length) return null
			const ch = Math.min(Math.round(x / PX_PER_CH), lines[idx].length)
			return starts[idx] + ch
		},
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

describe('moveByDisplayLines: inside a table cell', () => {
	let win: ReturnType<typeof installVimWindow>
	afterEach(() => uninstallVimWindow())

	it('steps to the next visual line synchronously, with no host calls, when it stays within the cell', () => {
		const inner = makeInner(['aaa', 'bbb', 'ccc'], 1) // head offset 1 = 'aaa'[1]
		const host = makeHost()
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeCellEditor({ line: 5, ch: 9 }, inner))
		const cm = { getLine: () => 'bbb', lastLine: () => 0, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		const result = vim.moveByDisplayLines(cm, { line: 0, ch: 1 }, { forward: true, repeat: 1 })
		expect(result).toEqual({ line: 1, ch: 1 }) // 'bbb'[round(10/10)=1]
		win.flush()
		expect(host.crossTableRowForCell).not.toHaveBeenCalled()
		expect(host.refineDisplayLineColumn).not.toHaveBeenCalled()
	})

	it('steps upward synchronously', () => {
		const inner = makeInner(['aaa', 'bbb', 'ccc'], 5) // head offset 5 = 'bbb'[1] (from=4)
		const host = makeHost()
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeCellEditor({ line: 5, ch: 9 }, inner))
		const cm = { getLine: () => 'bbb', lastLine: () => 1, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		const result = vim.moveByDisplayLines(cm, { line: 1, ch: 1 }, { forward: false, repeat: 1 })
		expect(result).toEqual({ line: 0, ch: 1 })
	})

	it('threads repeat through multiple in-cell steps synchronously', () => {
		const inner = makeInner(['aaa', 'bbb', 'ccc'], 0)
		const host = makeHost()
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeCellEditor({ line: 5, ch: 9 }, inner))
		const cm = { getLine: () => 'aaa', lastLine: () => 2, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		const result = vim.moveByDisplayLines(cm, { line: 0, ch: 0 }, { forward: true, repeat: 2 })
		expect(result).toEqual({ line: 2, ch: 0 })
		win.flush()
		expect(host.crossTableRowForCell).not.toHaveBeenCalled()
	})

	it('schedules a crossing (rough landing + refinement) when posAtCoords resolves outside the cell (bottom boundary)', () => {
		const inner = makeInner(['aaa'], 1) // only one line — any forward step exits
		const host = makeHost({
			crossTableRowForCell: vi.fn().mockReturnValue({ line: 6, ch: 2 }),
			refineDisplayLineColumn: vi.fn().mockReturnValue({ line: 6, ch: 3 }),
		})
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeCellEditor({ line: 5, ch: 9 }, inner))
		const cm = { getLine: () => 'aaa', lastLine: () => 0, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		const result = vim.moveByDisplayLines(cm, { line: 0, ch: 1 }, { forward: true, repeat: 1 })
		// Synchronous return stays at the furthest safely-reached position —
		// here, no step was possible at all, so it's just head, unchanged.
		expect(result).toEqual({ line: 0, ch: 1 })
		expect(host.crossTableRowForCell).not.toHaveBeenCalled() // not yet — deferred
		win.flush()
		expect(host.crossTableRowForCell).toHaveBeenCalledWith(
			expect.anything(), 1 /* cellIndex for 'bbb' */, true, 0 /* forward: land at the segment's own start */, 1 /* single row only */,
		)
		expect(host.refineDisplayLineColumn).toHaveBeenCalledWith(expect.anything(), 10 /* goalHSPos = ch1 * 10 */)
	})

	it('regression: crossing backward (gk) lands at the target segment\'s own end, not its start — needed so refineDisplayLineColumn (column-only, never changes lines) corrects the right (last) visual line of a wrapped target segment', () => {
		const inner = makeInner(['aaa'], 1)
		const host = makeHost({
			crossTableRowForCell: vi.fn().mockReturnValue({ line: 6, ch: 2 }),
			refineDisplayLineColumn: vi.fn().mockReturnValue({ line: 6, ch: 3 }),
		})
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeCellEditor({ line: 5, ch: 9 }, inner))
		const cm = { getLine: () => 'aaa', lastLine: () => 0, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		vim.moveByDisplayLines(cm, { line: 0, ch: 1 }, { forward: false, repeat: 1 })
		win.flush()
		expect(host.crossTableRowForCell).toHaveBeenCalledWith(
			expect.anything(), 1, false, Number.MAX_SAFE_INTEGER /* backward: clamp to the segment's own end */, 1,
		)
	})

	it('treats the absence of an inner view (e.g. an empty cell) as an immediate crossing', () => {
		const host = makeHost({
			crossTableRowForCell: vi.fn().mockReturnValue({ line: 6, ch: 0 }),
			refineDisplayLineColumn: vi.fn().mockReturnValue({ line: 6, ch: 0 }),
		})
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeCellEditor({ line: 5, ch: 9 })) // no activeCM
		const cm = { getLine: () => 'bbb', lastLine: () => 0, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		const result = vim.moveByDisplayLines(cm, { line: 0, ch: 1 }, { forward: true, repeat: 1 })
		expect(result).toEqual({ line: 0, ch: 1 })
		win.flush()
		expect(host.crossTableRowForCell).toHaveBeenCalled()
	})

	it('regression: preserves goalHSPos (does not null it out) when the no-inner landing is still genuinely a table row (an empty cell), not a real exit', () => {
		// isLinePartOfTable (ground truth on the landed line's own content) is
		// what distinguishes "empty cell, still in the table" from "genuine
		// exit" now — not editor.inTableCell, which was confirmed live to
		// still read true right after an actual exit at this exact tick (see
		// the dedicated exit regression test below for why that check was
		// replaced).
		const host = makeHost({
			isLinePartOfTable: vi.fn().mockReturnValue(true), // still a table row
			crossTableRowForCell: vi.fn().mockReturnValue({ line: 6, ch: 0 }),
			refineDisplayLineColumn: vi.fn().mockReturnValue({ line: 6, ch: 0 }),
		})
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeCellEditor({ line: 5, ch: 9 })) // no activeCM — empty cell
		const cm = { getLine: () => 'bbb', lastLine: () => 0, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		vim.moveByDisplayLines(cm, { line: 0, ch: 1 }, { forward: true, repeat: 1 })
		win.flush()
		expect(vim.goalHSPos).toBe(10) // ch1 * 10 — preserved, not nulled
	})

	it('regression: still calls refineDisplayLineColumn when the rough landing already exited the table entirely, so the plain-text column gets pixel-corrected too (not just left at exitTableWithColumn\'s own hardcoded ch)', () => {
		const editor = makeCellEditor({ line: 5, ch: 9 }, makeInner(['aaa'], 1))
		const host = makeHost({
			crossTableRowForCell: vi.fn(() => {
				editor.inTableCell = false
				return { line: 6, ch: 0 }
			}),
			refineDisplayLineColumn: vi.fn().mockReturnValue({ line: 6, ch: 4 }),
		})
		const vim = new VimSupport(host) as any
		win = installVimWindow(editor)
		const cm = { getLine: () => 'aaa', lastLine: () => 0, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		vim.moveByDisplayLines(cm, { line: 0, ch: 1 }, { forward: true, repeat: 1 })
		win.flush()
		expect(host.refineDisplayLineColumn).toHaveBeenCalledWith(expect.anything(), 10 /* goalHSPos = ch1 * 10 */)
	})

	it('regression: exiting the table preserves the viewport-relative pixel goal (not discarded, not left unconverted) — a later gj/gk continuing in plain text converts it via a same-reference-point offset, using *that* call\'s own guaranteed-valid vcm', () => {
		// Reported live: right after exiting a table, the column was correct,
		// but a *second* gj/gk continuing in plain text lost the column badly
		// (landed at ch 67 instead of ~7). Root causes, all confirmed via
		// dedicated diagnostic logs (not guessed):
		// (1) resyncAfterDeferredMove used to seed goalHSPos with whatever was
		//     passed in (viewport-relative, from crossTableRowForCell's own
		//     posAtCoords-based rough landing/refinement) even when the
		//     landing turned out to be a genuine exit — findPosV needs
		//     vim.js's own div-relative charCoords space instead.
		// (2) A first fix for (1) never actually ran: resyncAfterDeferredMove's
		//     own `if (inner)` check used editor.activeCM's bare truthiness,
		//     but activeCM was confirmed live to still equal editor.cm itself
		//     right after a genuine exit (activeCM falls back to cm when
		//     there's no genuine inner focus) — needs the identical
		//     `inner !== e.cm` guard refineDisplayLineColumn (main.ts) has.
		// (3) A second fix for (1) — nulling goalHSPos out so the next call
		//     recomputes it "fresh from head" — broke curswant-style
		//     preservation whenever the exit landed on a too-short/empty line
		//     (confirmed live via direct comparison: moveByLines' own ch-based
		//     goalHPos *does* survive an identical empty-line crossing, since
		//     it needs no space conversion at all). The real fix: preserve the
		//     original viewport-relative value and convert it on demand via a
		//     same-reference-point offset, which works regardless of the
		//     current line's own length.
		let cursor = { line: 5, ch: 9 }
		const outerCm: any = {
			state: { doc: { line: (_n: number) => ({ from: 0 }) } },
			coordsAtPos: vi.fn().mockReturnValue({ left: 50 }), // head's own viewport-relative x
		}
		const editor: any = {
			inTableCell: true,
			getCursor: () => cursor,
			getLine: () => ROW,
			activeCM: makeInner(['aaa'], 1),
			cm: outerCm,
		}
		const host = makeHost({
			crossTableRowForCell: vi.fn(() => {
				editor.inTableCell = false
				editor.activeCM = outerCm // genuine exit — activeCM falls back to cm itself
				cursor = { line: 6, ch: 3 } // simulates the actual exit landing
				return { line: 6, ch: 3 }
			}),
			refineDisplayLineColumn: vi.fn().mockReturnValue({ line: 6, ch: 3 }),
		})
		const vim = new VimSupport(host) as any
		win = installVimWindow(editor)
		const cm1 = { getLine: () => 'aaa', lastLine: () => 0, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		vim.moveByDisplayLines(cm1, { line: 0, ch: 1 }, { forward: true, repeat: 1 })
		win.flush()
		// Preserved as-is (10 = ch1 * 10, cm1's own viewport-relative scale),
		// not discarded — flagged as still needing conversion instead.
		expect(vim.goalHSPos).toBe(10)
		expect(vim.goalHSPosNeedsDivConversion).toBe(true)

		// Second gj, continuing in plain text (editor.getCursor() now matches
		// the exit landing above) — vim.js hands a *fresh* vcm for this call,
		// distinct scale (x100) from cm1's own (x10) to disambiguate which one
		// actually gets used. Also passes a real vim.js vim state with
		// nativeContinuing true (lastMotion already ours, matching what
		// vim.js sets automatically after any motion call) and a stale
		// lastHSPos (-1, vim.js's own default/never-set value) — confirming
		// goalHSPosNeedsDivConversion still wins over both external and
		// native continuity.
		const outerCharCoords = vi.fn((pos: { ch: number }) => ({ left: pos.ch * 100 }))
		const findPosV = vi.fn((cur: { line: number; ch: number }, dir: number) => ({ line: cur.line + dir, ch: 30, hitSide: false }))
		const cm2 = { getLine: () => 'plain text line', lastLine: () => 99, charCoords: outerCharCoords, findPosV }
		const vimState: any = { lastHPos: 3, lastHSPos: -1, lastMotion: vim.moveByDisplayLines }
		vim.moveByDisplayLines(cm2, { line: 6, ch: 3 }, { forward: true, repeat: 1 }, vimState)
		// divAtHead = cm2.charCoords({line:6,ch:3},'div').left = 3*100 = 300.
		// viewportAtHead = outerCm.coordsAtPos(...).left = 50 (fixed).
		// offset = 300 - 50 = 250; converted goal = 10 (preserved) + 250 = 260.
		expect(outerCharCoords).toHaveBeenCalledWith({ line: 6, ch: 3 }, 'div')
		expect(outerCm.coordsAtPos).toHaveBeenCalled()
		expect(findPosV).toHaveBeenCalledWith({ line: 6, ch: 3 }, 1, 'line', 260)
		expect(vim.goalHSPosNeedsDivConversion).toBe(false)
	})

	it('regression: the preserved viewport-relative goal survives crossing a too-short/empty plain-text line entirely — recovering the original wide column once a longer line is reached, matching moveByLines\' own ch-based curswant', () => {
		// The precise scenario reported live: gk exits a table upward onto a
		// genuinely empty plain-text line (nothing to test a pixel goal
		// against at all — refineDisplayLineColumn's own outer branch
		// necessarily gives up, landing at that line's only possible
		// position, ch 0). A second gk then reaches a longer line — the wide
		// goal must still be honored there, not permanently lost to the
		// intervening empty line's own ch 0.
		let cursor = { line: 5, ch: 9 }
		const outerCm: any = {
			state: { doc: { line: (_n: number) => ({ from: 0 }) } },
			coordsAtPos: vi.fn().mockReturnValue({ left: 20 }),
		}
		const editor: any = {
			inTableCell: true,
			getCursor: () => cursor,
			getLine: () => ROW,
			activeCM: makeInner(['aaa'], 1),
			cm: outerCm,
		}
		const host = makeHost({
			crossTableRowForCell: vi.fn(() => {
				editor.inTableCell = false
				editor.activeCM = outerCm
				cursor = { line: 10, ch: 0 } // landed on the empty line
				return { line: 10, ch: 0 }
			}),
			// The empty line has nothing to refine against — outer branch
			// gives up, returning the unrefined landing (ch 0) unchanged.
			refineDisplayLineColumn: vi.fn().mockReturnValue({ line: 10, ch: 0 }),
		})
		const vim = new VimSupport(host) as any
		win = installVimWindow(editor)
		const cm1 = { getLine: () => 'aaa', lastLine: () => 0, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		vim.moveByDisplayLines(cm1, { line: 0, ch: 4 }, { forward: false, repeat: 1 })
		win.flush()
		expect(vim.goalHSPos).toBe(40) // ch4 * 10, preserved as-is
		expect(vim.goalHSPosNeedsDivConversion).toBe(true)

		// gk again, still on the empty line (head matches the landing above) —
		// findPosV steps to the next (longer) line; goalColumn must reflect
		// the *converted original* goal (40 + offset), not the empty line's
		// own ch 0.
		const charCoords2 = vi.fn((pos: { ch: number }) => ({ left: pos.ch * 5 }))
		const findPosV = vi.fn((cur: { line: number; ch: number }, dir: number) => ({ line: cur.line + dir, ch: 12, hitSide: false }))
		const cm2 = { getLine: () => 'a longer plain-text line here', lastLine: () => 99, charCoords: charCoords2, findPosV }
		vim.moveByDisplayLines(cm2, { line: 10, ch: 0 }, { forward: false, repeat: 1 })
		// divAtHead = charCoords2({ch:0},'div').left = 0. viewportAtHead = 20.
		// offset = 0 - 20 = -20; converted goal = 40 + (-20) = 20.
		expect(findPosV).toHaveBeenCalledWith({ line: 10, ch: 0 }, -1, 'line', 20)
	})

	it('does not schedule any host call when an operator is pending (falls back to logical-line arithmetic)', () => {
		const inner = makeInner(['aaa'], 1)
		const host = makeHost()
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeCellEditor({ line: 5, ch: 9 }, inner))
		const cmMulti = { getLine: (n: number) => (n === 0 ? 'aaa' : 'bbb'), lastLine: () => 1, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		const result = vim.moveByDisplayLines(cmMulti, { line: 0, ch: 1 }, { forward: true, repeat: 1 }, undefined, { operator: 'delete' })
		win.flush()
		expect(host.crossTableRowForCell).not.toHaveBeenCalled()
		expect(result).toEqual({ line: 1, ch: 1 })
	})

	it('resyncs external state from refineDisplayLineColumn\'s own landing', () => {
		const landedInner = makeInner(['zz'], 1)
		const inner = makeInner(['aaa'], 1)
		const host = makeHost({
			crossTableRowForCell: vi.fn().mockReturnValue({ line: 6, ch: 1 }),
			refineDisplayLineColumn: vi.fn().mockReturnValue({ line: 6, ch: 1 }),
		})
		const vim = new VimSupport(host) as any
		const editor = makeCellEditor({ line: 5, ch: 9 }, inner)
		win = installVimWindow(editor)
		const cm = { getLine: () => 'aaa', lastLine: () => 0, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		vim.moveByDisplayLines(cm, { line: 0, ch: 5 }, { forward: true, repeat: 1 })
		// Swap in the "landed" inner view before the deferred callbacks run,
		// mirroring how editor.activeCM would report the newly-entered cell.
		editor.activeCM = landedInner as any
		win.flush()

		expect(vim.lastCm).toBe(landedInner)
		expect(vim.lastReturnedPos).toEqual({ line: 0, ch: 1 })
		expect(vim.lastOuterPos).toEqual({ line: 6, ch: 1 })
		expect(vim.goalHPos).toBe(1)
		expect(vim.goalHSPos).toBe(50) // fresh charCoords-equivalent: ch5 * 10
	})

	it('seeds the landed inner view\'s own native vim.lastHPos AND vim.lastHSPos when its vim state already exists', () => {
		const landedInner: any = makeInner(['zz'], 1)
		landedInner.state.vim = { lastHPos: -1, lastHSPos: -1, lastMotion: null }
		const inner = makeInner(['aaa'], 1)
		const host = makeHost({
			crossTableRowForCell: vi.fn().mockReturnValue({ line: 6, ch: 1 }),
			refineDisplayLineColumn: vi.fn().mockReturnValue({ line: 6, ch: 1 }),
		})
		const vim = new VimSupport(host) as any
		const editor = makeCellEditor({ line: 5, ch: 9 }, inner)
		win = installVimWindow(editor)
		const cm = { getLine: () => 'aaa', lastLine: () => 0, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		vim.moveByDisplayLines(cm, { line: 0, ch: 5 }, { forward: true, repeat: 1 })
		editor.activeCM = landedInner
		win.flush()

		expect(landedInner.state.vim.lastHPos).toBe(1)
		expect(landedInner.state.vim.lastHSPos).toBe(50)
	})

	it('a crossing that returns null (e.g. genuinely impossible) leaves state at the synchronous fallback, untouched by resync', () => {
		const inner = makeInner(['aaa'], 1)
		const host = makeHost({ crossTableRowForCell: vi.fn().mockReturnValue(null) })
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeCellEditor({ line: 5, ch: 9 }, inner))
		const cm = { getLine: () => 'aaa', lastLine: () => 0, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
		const result = vim.moveByDisplayLines(cm, { line: 0, ch: 2 }, { forward: true, repeat: 1 })
		win.flush()
		// resyncAfterDeferredMove's `if (!landedOuter) return` fires — state
		// stays exactly what moveByDisplayLines' own synchronous tail end set
		// (the always-run placeholder, matching moveByLines' own precedent),
		// not further touched (lastOuterPos, only ever set by resync, stays null).
		expect(vim.lastCm).toBe(cm)
		expect(vim.lastReturnedPos).toEqual(result)
		expect(vim.lastOuterPos).toBeNull()
		expect(host.refineDisplayLineColumn).not.toHaveBeenCalled()
	})
})
