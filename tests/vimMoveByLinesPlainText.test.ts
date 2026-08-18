import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'
import { installVimWindow, uninstallVimWindow, type FakeEditor } from './__helpers__/vimWindow'

// moveByLines' plain-text branch (editor.inTableCell === false): no table
// anywhere in the walked path. Covers goal-column memory and the
// continuing-chain check, independent of any table-crossing/entry concerns
// (see vimMoveByLinesInCell.test.ts / vimMoveByLinesEntry.test.ts for those).

const makeHost = (overrides: Partial<VimSupportHost> = {}): VimSupportHost => ({
	settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, vimGgSupport: false, vimDisplayLineSupport: false, vimEolSupport: false, vimTableStructureSupport: false, vimLeaderUseBackslash: false, smartJoin: false, smartHomeStandard: false },
	getBeginningOfLinePosition: () => 0,
	saveSettings: async () => {},
	crossTableRowForCell: vi.fn().mockReturnValue(null),
	crossTableRowForWord: vi.fn().mockReturnValue(null),
	jumpToDocumentLine: vi.fn().mockReturnValue(null),
	isLinePartOfTable: vi.fn().mockReturnValue(false),
	enterTableAtLine: vi.fn().mockReturnValue(null),
	refineDisplayLineColumn: vi.fn().mockReturnValue(null),
	executeObsidianCommand: vi.fn().mockReturnValue(true),
	...overrides,
})

// A plain document, no table anywhere. `|` prefilter never matches, so these
// tests never risk touching scheduleTableEntry.
const LINES = ['aaaaaaaaaa', 'bb', 'cccccccccc', 'dd', 'eeeeeeeeee']

function makeCmAndEditor() {
	const getLine = (n: number) => LINES[n] ?? ''
	const lastLine = () => LINES.length - 1
	const cm = { getLine, lastLine }
	let cursor = { line: 0, ch: 0 }
	const editor: FakeEditor = {
		inTableCell: false,
		getCursor: () => cursor,
		getLine,
	}
	return { cm, editor, setCursor: (c: { line: number; ch: number }) => { cursor = c } }
}

describe('moveByLines: plain text', () => {
	let vim: any
	let win: ReturnType<typeof installVimWindow>

	beforeEach(() => {
		vim = new VimSupport(makeHost()) as any
		win = installVimWindow()
	})
	afterEach(() => uninstallVimWindow())

	it('moves forward by repeat, landing at maxNormalModeCh when goal column exceeds the line', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		const result = vim.moveByLines(cm, { line: 0, ch: 5 }, { forward: true, repeat: 1 })
		// line 1 = 'bb' (len 2) -> maxNormalModeCh = 1
		expect(result).toEqual({ line: 1, ch: 1 })
	})

	it('moves backward by repeat', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		const result = vim.moveByLines(cm, { line: 2, ch: 3 }, { forward: false, repeat: 2 })
		expect(result).toEqual({ line: 0, ch: 3 })
	})

	it('clamps to document start/end', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		const down = vim.moveByLines(cm, { line: 4, ch: 0 }, { forward: true, repeat: 3 })
		expect(down.line).toBe(4)
		const up = vim.moveByLines(cm, { line: 0, ch: 0 }, { forward: false, repeat: 3 })
		expect(up.line).toBe(0)
	})

	it('preserves goal column across a short line when the chain continues', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		// Start at line 0 ch 8 (wide column). Step onto line 1 ('bb', len 2) —
		// clamped to ch 1, but the *true* goal (8) must be remembered.
		const step1 = vim.moveByLines(cm, { line: 0, ch: 8 }, { forward: true, repeat: 1 })
		expect(step1).toEqual({ line: 1, ch: 1 })
		// Continuing (head matches what we just returned) onto line 2
		// ('cccccccccc', len 10) should restore the original column 8.
		const step2 = vim.moveByLines(cm, step1, { forward: true, repeat: 1 })
		expect(step2).toEqual({ line: 2, ch: 8 })
	})

	it('does not preserve goal column when the chain is broken (head does not match last returned pos)', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		vim.moveByLines(cm, { line: 0, ch: 8 }, { forward: true, repeat: 1 }) // caches goalCh=8
		// Simulate an intervening action (e.g. h/l, a click) by passing a head
		// that doesn't match what was last returned.
		const result = vim.moveByLines(cm, { line: 1, ch: 0 }, { forward: true, repeat: 1 })
		// Fresh goal column = head.ch = 0, not the stale 8.
		expect(result).toEqual({ line: 2, ch: 0 })
	})

	it('count-prefixed motion ("3j"-equivalent) preserves the original column in one jump', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		// Single call with repeat=3 jumps straight to the final line, so no
		// intermediate short-line clamp ever has a chance to corrupt the goal.
		const result = vim.moveByLines(cm, { line: 0, ch: 8 }, { forward: true, repeat: 3 })
		expect(result).toEqual({ line: 3, ch: 1 }) // 'dd' len 2 -> clamp to 1
	})

	it('currentCellIndex() stays null in plain text (not inside a table cell)', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		vim.moveByLines(cm, { line: 0, ch: 0 }, { forward: true, repeat: 1 })
		expect(vim.goalCellIndex).toBeNull()
	})

	// vim.js curswant integration: same-view continuity delegates to the
	// caller's own vim state (lastHPos/lastMotion) instead of UCH's external
	// tracking, matching vim.js's own moveByLines tail exactly. See
	// vim-support.ts's own comment on `nativeContinuing`.
	describe('vim.js native curswant integration', () => {
		it('uses vim.lastHPos instead of head.ch when vim.lastMotion === this.moveByLines', () => {
			const { cm, editor } = makeCmAndEditor()
			win.setEditor(editor)
			const cmWithCoords = { ...cm, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
			// head.ch (1) reflects a clamped landing on the short 'bb' line, but
			// vim.lastHPos (8) is the true, wider goal from before that clamp —
			// nativeContinuing must prefer it over head.ch.
			const vimState: any = { lastHPos: 8, lastHSPos: -1, lastMotion: vim.moveByLines }
			const result = vim.moveByLines(cmWithCoords, { line: 1, ch: 1 }, { forward: true, repeat: 1 }, vimState)
			expect(result).toEqual({ line: 2, ch: 8 })
		})

		it('falls back to head.ch when vim.lastMotion is not this.moveByLines', () => {
			const { cm, editor } = makeCmAndEditor()
			win.setEditor(editor)
			const cmWithCoords = { ...cm, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
			const vimState: any = { lastHPos: 8, lastHSPos: -1, lastMotion: null }
			const result = vim.moveByLines(cmWithCoords, { line: 1, ch: 1 }, { forward: true, repeat: 1 }, vimState)
			expect(result).toEqual({ line: 2, ch: 1 })
		})

		it('writes vim.lastHPos/vim.lastHSPos back on return, matching vim.js\'s own tail — lastHPos stays wide/unclamped (curswant), but lastHSPos is clamped to the landed line\'s own length first', () => {
			const { cm, editor } = makeCmAndEditor()
			win.setEditor(editor)
			const cmWithCoords = { ...cm, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 7 }) }
			const vimState: any = { lastHPos: -1, lastHSPos: -1, lastMotion: null }
			// line 1 = 'bb' (len 2) -> maxNormalModeCh = 1, so the *returned*
			// position clamps to ch 1 — lastHPos must still reflect the wide,
			// unclamped goal (5, the starting ch on a fresh motion), matching
			// vim.js's own tail: it only narrows lastHPos on a fresh motion (to
			// the pre-move ch, not the post-clamp one), and never re-narrows it
			// while continuing. lastHSPos/goalHSPos, however, are derived via a
			// coordsAtPos-style pixel lookup and must be computed from the
			// *clamped* ch (1, not 5) — passing the wide, unclamped ch straight
			// through crashed real coordsAtPos ("No tile at position N") once it
			// genuinely exceeded the landed line's own length; a plain ch
			// comparison (lastHPos's own use) has no such requirement.
			const result = vim.moveByLines(cmWithCoords, { line: 0, ch: 5 }, { forward: true, repeat: 1 }, vimState)
			expect(result).toEqual({ line: 1, ch: 1 })
			expect(vimState.lastHPos).toBe(5)
			expect(vimState.lastHSPos).toBe(7)
			expect(vim.goalHSPos).toBe(7)
		})

		it('regression: external continuity wins over native when both agree it is continuing, even if native was clobbered by a stale/racy vim.lastHPos', () => {
			// Simulates the real, observed race: Obsidian's own async settling
			// after a row-crossing can fire another cursorActivity after our own
			// resync already seeded vim.lastHPos correctly, silently re-narrowing
			// it to the landing ch — while vim.lastMotion (never touched by that
			// path) stays stale-true. External tracking (this.goalHPos, set by
			// our own tail every call) isn't exposed to that race at all, so it
			// must win whenever both continuity signals agree the chain continues.
			const { cm, editor } = makeCmAndEditor()
			win.setEditor(editor)
			const cmWithCoords = { ...cm, charCoords: (pos: { ch: number }) => ({ left: pos.ch * 10 }) }
			const vimState: any = { lastHPos: -1, lastHSPos: -1, lastMotion: null }
			const first = vim.moveByLines(cmWithCoords, { line: 0, ch: 8 }, { forward: true, repeat: 1 }, vimState)
			expect(first).toEqual({ line: 1, ch: 1 }) // clamped landing; true goal (8) carried externally
			expect(vim.goalHPos).toBe(8)

			// Corrupt native state as the race would: lastHPos reset to the
			// clamped landing ch, but lastMotion left pointing at our own
			// override (both continuity checks would independently say "yes").
			vimState.lastHPos = 0
			vimState.lastMotion = vim.moveByLines
			const second = vim.moveByLines(cmWithCoords, first, { forward: true, repeat: 1 }, vimState)
			// line 2 = 'cccccccccc' (len 10) — wide enough that native's
			// corrupted 0 and external's correct 8 land on visibly different ch.
			expect(second).toEqual({ line: 2, ch: 8 })
		})

		it('does not touch vim state or goalHSPos when no vim state is passed (native override not yet active)', () => {
			const { cm, editor } = makeCmAndEditor()
			win.setEditor(editor)
			expect(() => vim.moveByLines(cm, { line: 0, ch: 5 }, { forward: true, repeat: 1 })).not.toThrow()
			expect(vim.goalHSPos).toBeNull()
		})
	})
})
