import { describe, it, expect, vi, afterEach } from 'vitest'
import { VimSupport } from '../src/vim-support'
import type { VimSupportHost } from '../src/vim-support'
import { installVimWindow, uninstallVimWindow, type FakeEditor } from './__helpers__/vimWindow'

// Vim's `$` (moveToEol) — also D/C's own shared motion. Real vim.js's own
// moveToEol sets vim.lastHPos = Infinity, its own "sticky end of line" goal
// column, explicitly recognized by real vim.js's own moveByLines/
// moveByDisplayLines as part of the same curswant-continuity family as
// moveByScroll/moveToColumn. This plugin overrides `$` specifically so it
// participates in this plugin's own external goalHPos/goalHSPos tracking —
// real vim.js's own per-view lastHPos alone can't survive a table
// row-crossing/entry/exit.

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

const LINES = ['aaaaa', 'bb', 'ccccccccccc']
const PX_PER_CH = 10

function makeCmAndEditor() {
	const getLine = (n: number) => LINES[n] ?? ''
	const lastLine = () => LINES.length - 1
	const charCoords = (pos: { ch: number }) => ({ left: pos.ch * PX_PER_CH })
	// Only needed by moveByDisplayLines' own plain-text branch — mirrors real
	// vim.js's own findPosV closely enough for these tests (goalColumn/PX_PER_CH
	// -> ch, clamped to the target line's own length).
	const findPosV = (cur: { line: number; ch: number }, dir: number, _unit: 'line', goalColumn: number) => {
		const targetLine = cur.line + dir
		if (targetLine < 0 || targetLine > lastLine()) return { line: cur.line, ch: cur.ch, hitSide: true }
		return { line: targetLine, ch: Math.min(Math.round(goalColumn / PX_PER_CH), getLine(targetLine).length) }
	}
	const cm = { getLine, lastLine, charCoords, findPosV }
	const editor: FakeEditor = { inTableCell: false, getCursor: () => ({ line: 0, ch: 0 }), getLine }
	return { cm, editor }
}

describe('Vim $ (moveToEol)', () => {
	let win: ReturnType<typeof installVimWindow>
	afterEach(() => uninstallVimWindow())

	it('lands on the current line\'s own last character', () => {
		const { cm, editor } = makeCmAndEditor()
		win = installVimWindow(editor)
		const vim = new VimSupport(makeHost()) as any
		const result = vim.moveToEol(cm, { line: 0, ch: 2 }, { forward: true, repeat: 1 })
		expect(result).toEqual({ line: 0, ch: 4 }) // 'aaaaa'.length - 1
	})

	it('a count-prefixed "3$" targets line + (repeat - 1)\'s own last character', () => {
		const { cm, editor } = makeCmAndEditor()
		win = installVimWindow(editor)
		const vim = new VimSupport(makeHost()) as any
		const result = vim.moveToEol(cm, { line: 0, ch: 0 }, { forward: true, repeat: 3 })
		expect(result).toEqual({ line: 2, ch: 10 }) // 'ccccccccccc'.length - 1
	})

	it('clamps to the document\'s own last line when repeat overshoots', () => {
		const { cm, editor } = makeCmAndEditor()
		win = installVimWindow(editor)
		const vim = new VimSupport(makeHost()) as any
		const result = vim.moveToEol(cm, { line: 0, ch: 0 }, { forward: true, repeat: 99 })
		expect(result).toEqual({ line: 2, ch: 10 })
	})

	it('sets goalHPos to Infinity and vim.lastHPos to Infinity — the sticky end-of-line sentinel', () => {
		const { cm, editor } = makeCmAndEditor()
		win = installVimWindow(editor)
		const vim = new VimSupport(makeHost()) as any
		const vimState: any = { lastHPos: 0, lastHSPos: 0, lastMotion: null }
		vim.moveToEol(cm, { line: 0, ch: 2 }, { forward: true, repeat: 1 }, vimState)
		expect(vim.goalHPos).toBe(Infinity)
		expect(vimState.lastHPos).toBe(Infinity)
	})

	it('in plain text, sets goalHSPos/vim.lastHSPos to a pixel sentinel (100000) no real line can ever reach, so a later gj/gk re-derives each line\'s own TRUE end dynamically instead of reusing one stale, concrete measurement', () => {
		// Unlike real vim.js's own moveToEol (a one-time, concrete pixel
		// measurement — see project_obsidian_native_gjgk_dollar_stickiness_gap
		// for why that loses $'s stickiness after a single gj/gk press, a
		// real, confirmed gap in Obsidian's own bundled Vim mode), this
		// plugin substitutes an always-too-large sentinel in plain text so
		// vim.js's own findPosV "clamp to nearest" behavior re-derives the
		// true end of whichever line is actually landed on, every time —
		// matching real Vim/Neovim's actual MAXCOL semantics. NOT
		// Number.MAX_SAFE_INTEGER — confirmed live that findPosV doesn't
		// clamp a value that astronomically large the way posAtCoords
		// elsewhere in this codebase does (lands at ch 0 instead); see
		// STICKY_EOL_PIXEL_SENTINEL's own doc comment.
		const { cm, editor } = makeCmAndEditor()
		win = installVimWindow(editor)
		const vim = new VimSupport(makeHost()) as any
		const vimState: any = { lastHPos: 0, lastHSPos: 0, lastMotion: null }
		vim.moveToEol(cm, { line: 0, ch: 2 }, { forward: true, repeat: 1 }, vimState)
		expect(vim.goalHSPos).toBe(100000)
		expect(vimState.lastHSPos).toBe(100000)
		expect(vim.goalHSPosNeedsDivConversion).toBe(false)
	})

	it('inside a table cell, still sets goalHSPos/vim.lastHSPos to the actual concrete pixel measurement (via the inner view) — the sentinel is plain-text only (table-cell gj/gk crossing/entry has its own separate, narrower sticky-goal handling)', () => {
		const { cm } = makeCmAndEditor()
		const innerCoordsAtPos = vi.fn().mockReturnValue({ left: 999 })
		const editor: FakeEditor = {
			inTableCell: true,
			getCursor: () => ({ line: 0, ch: 2 }),
			getLine: (n: number) => LINES[n] ?? '',
			activeCM: { state: { doc: { line: (_n: number) => ({ from: 0 }) } }, coordsAtPos: innerCoordsAtPos } as any,
		}
		win = installVimWindow(editor)
		const vim = new VimSupport(makeHost()) as any
		const vimState: any = { lastHPos: 0, lastHSPos: 0, lastMotion: null }
		vim.moveToEol(cm, { line: 0, ch: 2 }, { forward: true, repeat: 1 }, vimState)
		expect(innerCoordsAtPos).toHaveBeenCalled()
		expect(vim.goalHSPos).toBe(999)
		expect(vimState.lastHSPos).toBe(999)
	})

	it('does not gate its own goal-tracking on an operator being pending (D/C share this motion, and real vim.js\'s own moveToEol never checks it either)', () => {
		const { cm, editor } = makeCmAndEditor()
		win = installVimWindow(editor)
		const vim = new VimSupport(makeHost()) as any
		const vimState: any = { lastHPos: 0, lastHSPos: 0, lastMotion: null }
		vim.moveToEol(cm, { line: 0, ch: 2 }, { forward: true, repeat: 1 }, vimState, { operator: 'delete' })
		expect(vim.goalHPos).toBe(Infinity)
		expect(vimState.lastHPos).toBe(Infinity)
	})

	describe('nativeContinuing integration: "$" then j/k or gj/gk sticks to each line\'s own end', () => {
		it('moveByLines recognizes vim.lastMotion === moveToEol as continuing, using Infinity as the goal', () => {
			const vim = new VimSupport(makeHost()) as any
			const { cm, editor } = makeCmAndEditor()
			win = installVimWindow(editor)
			// Simulates having just pressed "$" on line 0 ('aaaaa', landing ch 4),
			// then "j" — vim.js itself sets lastMotion to whatever just ran.
			const vimState: any = { lastHPos: Infinity, lastHSPos: 40, lastMotion: vim.moveToEol }
			const result = vim.moveByLines(cm, { line: 0, ch: 4 }, { forward: true, repeat: 1 }, vimState)
			// Line 1 is 'bb' (length 2) — sticky Infinity clamps to its own last char.
			expect(result).toEqual({ line: 1, ch: 1 })
		})

		it('moveByLines still recognizes it across two consecutive j presses (Infinity survives a short line, recovering on a longer one)', () => {
			const vim = new VimSupport(makeHost()) as any
			const { cm, editor } = makeCmAndEditor()
			win = installVimWindow(editor)
			const vimState: any = { lastHPos: Infinity, lastHSPos: 40, lastMotion: vim.moveToEol }
			const step1 = vim.moveByLines(cm, { line: 0, ch: 4 }, { forward: true, repeat: 1 }, vimState)
			expect(step1).toEqual({ line: 1, ch: 1 }) // 'bb'
			const step2 = vim.moveByLines(cm, step1, { forward: true, repeat: 1 }, vimState)
			expect(step2).toEqual({ line: 2, ch: 10 }) // 'ccccccccccc' — recovered, not stuck at 'bb'.length
		})

		it('moveByDisplayLines (gj/gk) also recognizes vim.lastMotion === moveToEol as continuing', () => {
			const vim = new VimSupport(makeHost()) as any
			const { cm, editor } = makeCmAndEditor()
			win = installVimWindow(editor)
			const vimState: any = { lastHPos: Infinity, lastHSPos: 40, lastMotion: vim.moveToEol }
			const result = vim.moveByDisplayLines(cm, { line: 0, ch: 4 }, { forward: true, repeat: 1 }, vimState)
			expect(result).toEqual({ line: 1, ch: 1 })
		})

		it('moveByDisplayLines (gj/gk) recovers across two consecutive gk presses using the real pixel sentinel — re-derives each line\'s own TRUE end on every press, rather than getting stuck on a stale concrete value that only happens to still exceed a short intermediate line (see project_obsidian_native_gjgk_dollar_stickiness_gap for the live repro this fixes: UCH used to behave like Obsidian\'s own native Vim mode here, G -> 3 -> c instead of the real-Vim G -> 3 -> n)', () => {
			const vim = new VimSupport(makeHost()) as any
			const { cm, editor } = makeCmAndEditor()
			win = installVimWindow(editor)
			const sentinel = (VimSupport as any).STICKY_EOL_PIXEL_SENTINEL
			const vimState: any = { lastHPos: Infinity, lastHSPos: sentinel, lastMotion: vim.moveToEol }
			const step1 = vim.moveByDisplayLines(cm, { line: 2, ch: 10 }, { forward: false, repeat: 1 }, vimState)
			expect(step1).toEqual({ line: 1, ch: 1 }) // 'bb' — clamped to its own last char
			const step2 = vim.moveByDisplayLines(cm, step1, { forward: false, repeat: 1 }, vimState)
			expect(step2).toEqual({ line: 0, ch: 4 }) // 'aaaaa' — recovered to ITS true end, not stuck at 'bb'.length
		})
	})

	describe('restore target (VIM_DEFAULT_MOVE_TO_EOL) on toggle-off/unload', () => {
		it('lands on the current line\'s own last character, with no goal-column persistence', () => {
			const restored = (VimSupport as any).VIM_DEFAULT_MOVE_TO_EOL
			const { cm } = makeCmAndEditor()
			const result = restored(cm, { line: 0, ch: 2 }, { forward: true, repeat: 1 })
			expect(result).toEqual({ line: 0, ch: 4 })
		})

		it('a count-prefixed "3$" still resolves the same way as the live override', () => {
			const restored = (VimSupport as any).VIM_DEFAULT_MOVE_TO_EOL
			const { cm } = makeCmAndEditor()
			const result = restored(cm, { line: 0, ch: 0 }, { forward: true, repeat: 3 })
			expect(result).toEqual({ line: 2, ch: 10 })
		})
	})
})
