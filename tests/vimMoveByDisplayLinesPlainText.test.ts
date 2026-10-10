import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VimSupport } from '../src/vim-support'
import type { VimSupportHost } from '../src/vim-support'
import { installVimWindow, uninstallVimWindow, type FakeEditor } from './__helpers__/vimWindow'

// moveByDisplayLines' plain-text branch (editor.inTableCell === false): delegates
// straight to findPosV (a real, public method on vim.js's own cm adapter — unlike
// moveByScroll/moveToColumn/moveToEol, it isn't part of the private, unexposed
// `motions` table), mirroring real vim.js's own moveByDisplayLines tail exactly.
// This branch is unaffected by this branch's own table-cell redesign — no table
// anywhere in the walked path here. See vimMoveByLinesPlainText.test.ts for the
// j/k analogue this mirrors.

const makeHost = (overrides: Partial<VimSupportHost> = {}): VimSupportHost => ({
	settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, vimGgSupport: false, vimDisplayLineSupport: false, vimEolSupport: false, vimTableStructureSupport: false, vimTableNavigationSupport: false, vimLeaderUseBackslash: false, smartJoin: false, smartHomeStandard: false },
	getBeginningOfLinePosition: () => 0,
	saveSettings: async () => {},
	crossTableRowForCell: vi.fn().mockReturnValue(null),
	getAdjacentRowLine: vi.fn().mockReturnValue(0),
	setCursorAcrossTableBoundary: vi.fn(),
	appendBlankLineAndLand: vi.fn(),
	enterTableRowSmartHome: vi.fn().mockReturnValue(null),
	crossTableRowForWord: vi.fn().mockReturnValue(null),
	jumpToDocumentLine: vi.fn().mockReturnValue(null),
	isLinePartOfTable: vi.fn().mockReturnValue(false),
	isSourceModeTableLine: vi.fn().mockReturnValue(false),
	enterTableAtLine: vi.fn().mockReturnValue(null),
	refineDisplayLineColumn: vi.fn().mockReturnValue(null),
	executeObsidianCommand: vi.fn().mockReturnValue(true),
	...overrides,
})

// A plain document, no table anywhere — 10px per character, so ch = pixel / 10
// (clamped to the target line's own length) mimics a monospace-enough model for
// deterministic assertions without needing a real renderer.
const LINES = ['aaaaaaaaaa', 'bb', 'cccccccccc', 'dd', 'eeeeeeeeee']
const PX_PER_CH = 10

function makeCmAndEditor() {
	const getLine = (n: number) => LINES[n] ?? ''
	const lastLine = () => LINES.length - 1
	const charCoords = (pos: { ch: number }) => ({ left: pos.ch * PX_PER_CH })
	const findPosV = (cur: { line: number; ch: number }, dir: number, _unit: 'line', goalColumn: number) => {
		const targetLine = cur.line + dir
		if (targetLine < 0 || targetLine > lastLine()) return { line: cur.line, ch: cur.ch, hitSide: true }
		const lineLen = getLine(targetLine).length
		return { line: targetLine, ch: Math.min(Math.round(goalColumn / PX_PER_CH), lineLen) }
	}
	const cm = { getLine, lastLine, charCoords, findPosV }
	let cursor = { line: 0, ch: 0 }
	const editor: FakeEditor = {
		inTableCell: false,
		getCursor: () => cursor,
		getLine,
	}
	return { cm, editor, setCursor: (c: { line: number; ch: number }) => { cursor = c } }
}

describe('moveByDisplayLines: plain text', () => {
	let vim: any
	let win: ReturnType<typeof installVimWindow>

	beforeEach(() => {
		vim = new VimSupport(makeHost()) as any
		win = installVimWindow()
	})
	afterEach(() => uninstallVimWindow())

	it('moves down by repeat via findPosV, landing at the pixel-derived column', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		// head.ch=5 -> fresh goal = charCoords(head).left = 50 -> line1 'bb' (len2)
		// clamps findPosV's own result to 2, then maxNormalModeCh clamps to 1.
		const result = vim.moveByDisplayLines(cm, { line: 0, ch: 5 }, { forward: true, repeat: 1 })
		expect(result).toEqual({ line: 1, ch: 1 })
	})

	it('moves up by repeat', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		const result = vim.moveByDisplayLines(cm, { line: 2, ch: 3 }, { forward: false, repeat: 2 })
		expect(result).toEqual({ line: 0, ch: 3 })
	})

	it('hitting a document boundary is a no-op, matching real vim.js\'s own hitSide break', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		const result = vim.moveByDisplayLines(cm, { line: 4, ch: 0 }, { forward: true, repeat: 3 })
		expect(result).toEqual({ line: 4, ch: 0 })
	})

	it('preserves the pixel goal across a short line when the chain continues externally', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		const step1 = vim.moveByDisplayLines(cm, { line: 0, ch: 8 }, { forward: true, repeat: 1 })
		expect(step1).toEqual({ line: 1, ch: 1 }) // maxNormalModeCh('bb') = 1
		const step2 = vim.moveByDisplayLines(cm, step1, { forward: true, repeat: 1 })
		expect(step2).toEqual({ line: 2, ch: 8 })
	})

	it('does not preserve the goal when the chain is broken (head does not match last returned pos)', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		vim.moveByDisplayLines(cm, { line: 0, ch: 8 }, { forward: true, repeat: 1 })
		const result = vim.moveByDisplayLines(cm, { line: 1, ch: 0 }, { forward: true, repeat: 1 })
		expect(result).toEqual({ line: 2, ch: 0 })
	})

	it('currentCellIndex() stays null in plain text (not inside a table cell)', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		vim.moveByDisplayLines(cm, { line: 0, ch: 0 }, { forward: true, repeat: 1 })
		expect(vim.goalCellIndex).toBeNull()
	})

	describe('entering a table row from plain text', () => {
		const TABLE_LINES = ['111', '222', '| AAA | 123456 |', '| ---- | ------ |', '| xxx | yyy |']

		function makeTableCmAndEditor() {
			const getLine = (n: number) => TABLE_LINES[n] ?? ''
			const lastLine = () => TABLE_LINES.length - 1
			const charCoords = (pos: { ch: number }) => ({ left: pos.ch * PX_PER_CH })
			const findPosV = (cur: { line: number; ch: number }, dir: number, _unit: 'line', goalColumn: number) => {
				const targetLine = cur.line + dir
				if (targetLine < 0 || targetLine > lastLine()) return { line: cur.line, ch: cur.ch, hitSide: true }
				return { line: targetLine, ch: Math.min(Math.round(goalColumn / PX_PER_CH), getLine(targetLine).length) }
			}
			const cm = { getLine, lastLine, charCoords, findPosV }
			const editor: FakeEditor = { inTableCell: false, getCursor: () => ({ line: 0, ch: 0 }), getLine }
			return { cm, editor }
		}

		it('stops before landing on raw table markdown text and schedules a deferred entry', () => {
			const host = makeHost({ isLinePartOfTable: vi.fn().mockReturnValue(true) })
			const vimLocal = new VimSupport(host) as any
			const { cm, editor } = makeTableCmAndEditor()
			win.setEditor(editor)
			const result = vimLocal.moveByDisplayLines(cm, { line: 1, ch: 0 }, { forward: true, repeat: 1 })
			expect(result.line).toBe(1)
			win.flush()
			// forward -> goalCh=0 (segment start); single-row precision only,
			// so remaining is always 0 (see scheduleDisplayLineEntry's own scope
			// cut, matching crossTableRowForCell's identical one).
			expect(host.enterTableAtLine).toHaveBeenCalledWith(
				expect.anything(), 2 /* table row line */, 0 /* cellIndex fallback */, true, 0 /* forward: segment start */, 0 /* remaining */,
			)
		})

		it('`$` sticky goal ($, then gj, into a table) enters the RIGHTMOST cell, not the usual leftmost fallback', () => {
			// Simulates `$` having just run: vim.js's own native lastHPos
			// sentinel (Infinity) carried over via the same nativeContinuing
			// check this function already uses for its own goalHSPos/
			// goalCellIndex fields — see moveByDisplayLines' own
			// chGoalIsStickyEol doc comment. Unlike goalHSPos (this motion's
			// own pixel goal, never Infinity even right after `$` — see
			// moveToEol's own doc comment), this only matters as a one-time
			// signal at the exact moment of entry.
			const host = makeHost({ isLinePartOfTable: vi.fn().mockReturnValue(true) })
			const vimLocal = new VimSupport(host) as any
			const { cm, editor } = makeTableCmAndEditor()
			win.setEditor(editor)
			const vimState: any = { lastHPos: Infinity, lastHSPos: 0, lastMotion: vimLocal.moveToEol }
			vimLocal.moveByDisplayLines(cm, { line: 1, ch: 0 }, { forward: true, repeat: 1 }, vimState)
			win.flush()
			// cellIndex 1 (rightmost — the table row has 2 cells), not 0.
			expect(host.enterTableAtLine).toHaveBeenCalledWith(
				expect.anything(), 2, 1 /* rightmost cellIndex */, true, 0, 0,
			)
		})

		it('`$` sticky goal entry skips the pixel-refinement step entirely — the rough landing (already at this segment\'s own exact end) is final', () => {
			// Regression: pixel-refining a sticky `$` entry against goalHSPos
			// (the stale pixel position of the ORIGINAL, now-abandoned
			// plain-text line) can clamp the cursor to a position in the
			// entered cell nearest that unrelated value — observed live
			// snapping all the way back to the cell's own first character,
			// since the entered cell's own rendered width has nothing to do
			// with how far right the original plain-text line happened to
			// extend. For a sticky goal, the rough landing (enterTableAtLine
			// with goalCh=MAX_SAFE_INTEGER) is already correct and final, so
			// refineDisplayLineColumn must never be called for this case.
			const host = makeHost({
				isLinePartOfTable: vi.fn().mockReturnValue(true),
				enterTableAtLine: vi.fn().mockReturnValue({ line: 2, ch: 12 }),
			})
			const vimLocal = new VimSupport(host) as any
			const { cm, editor } = makeTableCmAndEditor()
			win.setEditor(editor)
			const vimState: any = { lastHPos: Infinity, lastHSPos: 0, lastMotion: vimLocal.moveToEol }
			vimLocal.moveByDisplayLines(cm, { line: 1, ch: 0 }, { forward: true, repeat: 1 }, vimState)
			win.flush()
			expect(host.refineDisplayLineColumn).not.toHaveBeenCalled()
		})

		it('`$` sticky goal entry re-seeds BOTH goalHPos (Infinity) and goalHSPos/vim.lastHSPos (the pixel sentinel) — not the rough landing\'s own concrete ch, and not null — so stickiness survives into whatever gj/gk OR a plain j/k does next inside the table', () => {
			// Regression (pixel side): passing null does NOT make a later
			// gj/gk recompute a fresh pixel goal on its own — vim.js's own
			// external-selection handling (triggered by this landing's own
			// dispatch) silently re-seeds vim.lastHSPos with a concrete
			// measurement of wherever the cursor actually landed instead,
			// which only coincidentally happened to still exceed one short
			// intermediate segment's own width before failing outright on a
			// longer one.
			// Regression (ch side): passing the rough landing's own
			// concrete ch (not Infinity) broke a later PLAIN j/k switching
			// away from gj/gk right after this entry (e.g.
			// $ -> gk -> gk -> k) — it read that concretized ch instead of
			// Infinity, clamping against a small number left over from an
			// earlier, shorter segment rather than the next segment's own
			// true end. Confirmed live both ways — see
			// scheduleDisplayLineEntry's own doc comment for the full trace.
			const host = makeHost({
				isLinePartOfTable: vi.fn().mockReturnValue(true),
				enterTableAtLine: vi.fn().mockReturnValue({ line: 2, ch: 12 }),
			})
			const vimLocal = new VimSupport(host) as any
			const resyncSpy = vi.spyOn(vimLocal, 'resyncAfterDeferredMove')
			const { cm, editor } = makeTableCmAndEditor()
			win.setEditor(editor)
			const vimState: any = { lastHPos: Infinity, lastHSPos: 0, lastMotion: vimLocal.moveToEol }
			vimLocal.moveByDisplayLines(cm, { line: 1, ch: 0 }, { forward: true, repeat: 1 }, vimState)
			win.flush()
			expect(resyncSpy).toHaveBeenCalledWith(
				expect.anything(), { line: 2, ch: 12 }, Infinity, (VimSupport as any).STICKY_EOL_PIXEL_SENTINEL, 1,
			)
		})

		it('regression: entering backward (gk) lands at the target segment\'s own end, matching the crossing case\'s identical wrapped-segment fix', () => {
			const host = makeHost({ isLinePartOfTable: vi.fn().mockReturnValue(true) })
			const vimLocal = new VimSupport(host) as any
			const TABLE_LINES_BACK = ['| AAA | 123456 |', '| ---- | ------ |', '| xxx | yyy |', '111', '222']
			const getLine = (n: number) => TABLE_LINES_BACK[n] ?? ''
			const lastLine = () => TABLE_LINES_BACK.length - 1
			const charCoords = (pos: { ch: number }) => ({ left: pos.ch * PX_PER_CH })
			const findPosV = (cur: { line: number; ch: number }, dir: number, _unit: 'line', goalColumn: number) => {
				const targetLine = cur.line + dir
				if (targetLine < 0 || targetLine > lastLine()) return { line: cur.line, ch: cur.ch, hitSide: true }
				return { line: targetLine, ch: Math.min(Math.round(goalColumn / PX_PER_CH), getLine(targetLine).length) }
			}
			const cm = { getLine, lastLine, charCoords, findPosV }
			const editor: FakeEditor = { inTableCell: false, getCursor: () => ({ line: 3, ch: 0 }), getLine }
			win.setEditor(editor)
			vimLocal.moveByDisplayLines(cm, { line: 3, ch: 0 }, { forward: false, repeat: 1 })
			win.flush()
			expect(host.enterTableAtLine).toHaveBeenCalledWith(
				expect.anything(), 2, 0, false, Number.MAX_SAFE_INTEGER /* backward: segment end */, 0,
			)
		})

		it('regression: entry pixel-goal is recomputed via the outer view\'s own viewport-relative coordsAtPos, not vim.js\'s div-relative charCoords, so the follow-up refinement (raw CM6 on the newly-entered inner view) reads the same coordinate space as the crossing case', () => {
			const outerCoordsAtPos = vi.fn().mockReturnValue({ top: 0, bottom: 18, left: 999 })
			const host = makeHost({
				isLinePartOfTable: vi.fn().mockReturnValue(true),
				enterTableAtLine: vi.fn().mockImplementation((editorArg: any) => {
					editorArg.inTableCell = true
					return { line: 2, ch: 0 }
				}),
			})
			const vimLocal = new VimSupport(host) as any
			const { cm, editor } = makeTableCmAndEditor()
			editor.cm = { coordsAtPos: outerCoordsAtPos, state: { doc: { line: (_n: number) => ({ from: 0 }) } } }
			win.setEditor(editor)
			vimLocal.moveByDisplayLines(cm, { line: 1, ch: 0 }, { forward: true, repeat: 1 })
			win.flush()
			expect(outerCoordsAtPos).toHaveBeenCalled()
			// The buggy 'div'-relative value here would be 0 (charCoords({ch:0}).left);
			// the fixed value is the outer view's own viewport-relative left (999).
			expect(host.refineDisplayLineColumn).toHaveBeenCalledWith(expect.anything(), 999)
		})

		it('regression: entry pixel-goal converts the already-correct (preserved, continuing) goalHSPos, rather than reading cur\'s own position directly — cur stays degenerate (ch 0) when the entry is detected on the very first findPosV step, e.g. right after landing on a too-short/empty preceding line', () => {
			// Reported live: gj entering a table from plain text landed at
			// ch 0 inside the cell, discarding the real (wide) goal — the
			// entry-detection loop's own convention is that cur never
			// advances past head on the step where enteredAt is found (see
			// its own "remaining is not decremented" comment), so cur is
			// whatever ch head already had — here, deliberately 0, as if
			// landed on an empty line one step earlier. The *previous* fix
			// read cur's own viewport-relative position directly
			// (charCoordsLeft(vcm, cur, editor.cm)) — silently 0-ish exactly
			// because cur itself is degenerate. Converting the
			// already-established (continuing) goalHSPos instead is immune
			// to cur's own degeneracy, using cur only as the reference point
			// for the space-conversion offset, not as the value's own source.
			const host = makeHost({
				isLinePartOfTable: vi.fn().mockReturnValue(true),
				enterTableAtLine: vi.fn().mockReturnValue({ line: 2, ch: 2 }),
			})
			const vimLocal = new VimSupport(host) as any
			const { cm, editor } = makeTableCmAndEditor()
			// Distinct, offset-only viewport measurement (ignores its own
			// input position) — simulates the outer view's own wrapper
			// sitting away from the viewport's origin.
			editor.cm = { coordsAtPos: vi.fn().mockReturnValue({ left: 5 }), state: { doc: { line: (_n: number) => ({ from: 0 }) } } }
			win.setEditor(editor)
			// Establish a continuing chain carrying a wide, already-correct
			// goalHSPos (40, div-relative) from before this call.
			vimLocal.goalHSPos = 40
			vimLocal.lastCm = cm
			vimLocal.lastReturnedPos = { line: 1, ch: 0 }
			vimLocal.moveByDisplayLines(cm, { line: 1, ch: 0 }, { forward: true, repeat: 1 })
			win.flush()
			// offset = viewportAtCur(5) - divAtCur(charCoords({ch:0}).left=0) = 5.
			// entryPixelGoal = goalHSPos(40) + offset(5) = 45 — not 5 (the bug:
			// reading cur's own degenerate position directly) and not 40
			// (unconverted, wrong space for the entered cell's own posAtCoords).
			expect(host.refineDisplayLineColumn).toHaveBeenCalledWith(expect.anything(), 45)
		})

		it('does not schedule entry when isLinePartOfTable rejects the cheap pre-filter match', () => {
			const host = makeHost({ isLinePartOfTable: vi.fn().mockReturnValue(false) })
			const vimLocal = new VimSupport(host) as any
			const { cm, editor } = makeTableCmAndEditor()
			win.setEditor(editor)
			vimLocal.moveByDisplayLines(cm, { line: 1, ch: 0 }, { forward: true, repeat: 1 })
			win.flush()
			expect(host.enterTableAtLine).not.toHaveBeenCalled()
		})
	})

	describe('vim.js native curswant integration', () => {
		it('uses vim.lastHSPos instead of a fresh charCoords(head) when nativeContinuing (via moveByDisplayLines)', () => {
			const { cm, editor } = makeCmAndEditor()
			win.setEditor(editor)
			const vimState: any = { lastHPos: -1, lastHSPos: 80, lastMotion: vim.moveByDisplayLines }
			const result = vim.moveByDisplayLines(cm, { line: 1, ch: 1 }, { forward: true, repeat: 1 }, vimState)
			expect(result).toEqual({ line: 2, ch: 8 })
		})

		it('recognizes j/k\'s own moveByLines as the same continuity family (nativeContinuing via cross-motion)', () => {
			const { cm, editor } = makeCmAndEditor()
			win.setEditor(editor)
			const vimState: any = { lastHPos: 8, lastHSPos: 80, lastMotion: vim.moveByLines }
			const result = vim.moveByDisplayLines(cm, { line: 1, ch: 1 }, { forward: true, repeat: 1 }, vimState)
			expect(result).toEqual({ line: 2, ch: 8 })
		})

		it('falls back to a fresh charCoords(head) when lastMotion is neither moveByLines nor moveByDisplayLines', () => {
			const { cm, editor } = makeCmAndEditor()
			win.setEditor(editor)
			const vimState: any = { lastHPos: -1, lastHSPos: 80, lastMotion: null }
			const result = vim.moveByDisplayLines(cm, { line: 1, ch: 1 }, { forward: true, repeat: 1 }, vimState)
			expect(result).toEqual({ line: 2, ch: 1 })
		})

		it('writes vim.lastHPos unconditionally to the landed ch, and vim.lastHSPos only when fresh', () => {
			const { cm, editor } = makeCmAndEditor()
			win.setEditor(editor)
			const vimState: any = { lastHPos: -1, lastHSPos: -1, lastMotion: null }
			const result = vim.moveByDisplayLines(cm, { line: 0, ch: 5 }, { forward: true, repeat: 1 }, vimState)
			expect(result).toEqual({ line: 1, ch: 1 })
			expect(vimState.lastHPos).toBe(1)
			expect(vimState.lastHSPos).toBe(50)
			expect(vim.goalHSPos).toBe(50)
		})

		it('leaves vim.lastHSPos untouched while continuing (contrast with moveByLines\' own inverse rule)', () => {
			const { cm, editor } = makeCmAndEditor()
			win.setEditor(editor)
			const vimState: any = { lastHPos: -1, lastHSPos: 80, lastMotion: vim.moveByDisplayLines }
			vim.moveByDisplayLines(cm, { line: 1, ch: 1 }, { forward: true, repeat: 1 }, vimState)
			expect(vimState.lastHSPos).toBe(80)
		})

		it('does not overwrite vim.lastHPos on a boundary no-op (result equals head)', () => {
			const { cm, editor } = makeCmAndEditor()
			win.setEditor(editor)
			const vimState: any = { lastHPos: 42, lastHSPos: -1, lastMotion: null }
			const result = vim.moveByDisplayLines(cm, { line: 4, ch: 0 }, { forward: true, repeat: 1 }, vimState)
			expect(result).toEqual({ line: 4, ch: 0 })
			expect(vimState.lastHPos).toBe(42)
		})

		it('does not touch vim state or goalHSPos when no vim state is passed (native override not yet active)', () => {
			const { cm, editor } = makeCmAndEditor()
			win.setEditor(editor)
			expect(() => vim.moveByDisplayLines(cm, { line: 0, ch: 5 }, { forward: true, repeat: 1 })).not.toThrow()
			expect(vim.goalHSPos).toBe(50)
		})

		it('regression: external continuity wins over native when both agree it is continuing, even if native was clobbered by a stale/racy vim.lastHSPos', () => {
			const { cm, editor } = makeCmAndEditor()
			win.setEditor(editor)
			const vimState: any = { lastHPos: -1, lastHSPos: -1, lastMotion: null }
			const first = vim.moveByDisplayLines(cm, { line: 0, ch: 8 }, { forward: true, repeat: 1 }, vimState)
			expect(first).toEqual({ line: 1, ch: 1 })
			expect(vim.goalHSPos).toBe(80)

			vimState.lastHSPos = 0
			vimState.lastMotion = vim.moveByDisplayLines
			const second = vim.moveByDisplayLines(cm, first, { forward: true, repeat: 1 }, vimState)
			expect(second).toEqual({ line: 2, ch: 8 })
		})
	})
})
