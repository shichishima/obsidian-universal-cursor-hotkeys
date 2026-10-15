import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorSelection } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../../src/main.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Builds a real CM6 EditorSelection (single range) around opts.currentHead —
// moveCursorHomeNonTable now goes through setCursorsViaCm, which maps over
// cm.state.selection.ranges and feeds unchanged ranges straight into
// EditorSelection.create, so this needs to be a real SelectionRange, not a
// plain {head, assoc} object.
function makeEditorWithCm(opts: {
	currentHead: number
	vlStartHead: number
	vlStartAssoc: number
	lineText: string
	cursorCh: number
}) {
	const mockDispatch  = vi.fn()
	const mockSetCursor = vi.fn()
	const mockFocus      = vi.fn()
	const selection = EditorSelection.create([EditorSelection.cursor(opts.currentHead)])
	const mockMoveToLineBoundary = vi.fn().mockReturnValue({
		head: opts.vlStartHead,
		assoc: opts.vlStartAssoc,
	})

	return {
		editor: {
			cm: {
				state: { selection },
				moveToLineBoundary: mockMoveToLineBoundary,
				dispatch: mockDispatch,
				focus: mockFocus,
			},
			getCursor:   vi.fn().mockReturnValue({ line: 0, ch: opts.cursorCh }),
			getLine:     vi.fn().mockReturnValue(opts.lineText),
			// All test scenarios are single-line (line 0), so offset === ch.
			posToOffset: vi.fn((pos: { line: number; ch: number }) => pos.ch),
			offsetToPos: vi.fn((offset: number) => ({ line: 0, ch: offset })),
			exec:        vi.fn(),
			setCursor:   mockSetCursor,
		},
		mockDispatch,
		mockSetCursor,
		mockMoveToLineBoundary,
	}
}

function makeEditorWithoutCm(lineText: string, ch: number) {
	const mockSetCursor = vi.fn()
	return {
		editor: {
			cm: undefined,
			getCursor: vi.fn().mockReturnValue({ line: 0, ch }),
			getLine:   vi.fn().mockReturnValue(lineText),
			setCursor: mockSetCursor,
		},
		mockSetCursor,
	}
}

// ---------------------------------------------------------------------------
// Matrix
//
// Each row defines one scenario and the expected final cursor position
// under two settings:
//   vlTrue  = visualLineMovement: true  (smartHomeStandard: true, smartHomeAdvanced: true)
//   vlFalse = visualLineMovement: false (smartHomeStandard: true, smartHomeAdvanced: true)
//
// With cm available, moveCursorHomeNonTable always routes through
// setCursorsViaCm now (even the old "smart home only" cases, which used to
// call editor.setCursor directly) — so every cm row dispatches a single-
// range EditorSelection at the expected {pos, assoc}. Only the "no cm" rows
// still call editor.setCursor directly.
// ---------------------------------------------------------------------------

type CmOpts = {
	currentHead: number
	vlStartHead: number; vlStartAssoc: number
	lineText: string; cursorCh: number
}

type HomeRow = {
	desc: string
	cm?: CmOpts
	noCm?: { lineText: string; ch: number }
	vlTrue:  { pos: number; assoc?: number }
	vlFalse: { pos: number; assoc?: number }
}

const matrix: HomeRow[] = [
	// =========================================================================
	// Case (1a): cm, VL2+, cursor not at VL left edge, vlCh > lineSmartHomePos
	//            → dispatch to VL left edge
	// =========================================================================
	{
		desc: 'cm, VL2+ middle of plain line — dispatch to VL left edge',
		cm: { currentHead: 15, vlStartHead: 10, vlStartAssoc: 1,
		      lineText: 'hello world this is a long line', cursorCh: 15 },
		vlTrue:  { pos: 10, assoc: 1 },
		vlFalse: { pos: 0 },
	},
	{
		desc: 'cm, VL2+ middle: moveToLineBoundary called with the live range',
		cm: { currentHead: 15, vlStartHead: 10, vlStartAssoc: 1,
		      lineText: 'hello world this is a long line', cursorCh: 15 },
		vlTrue:  { pos: 10, assoc: 1 },
		vlFalse: { pos: 0 },
	},

	// =========================================================================
	// Case (1b): cm, VL2+ but already at VL left edge
	//            → fall through to smart home
	// =========================================================================
	{
		desc: 'cm, already at VL left edge (vlStart.head === currentHead) — smart home',
		cm: { currentHead: 10, vlStartHead: 10, vlStartAssoc: 1,
		      lineText: '## hello', cursorCh: 10 },
		vlTrue:  { pos: 3 },
		vlFalse: { pos: 3 },
	},

	// =========================================================================
	// Case (2): cm, VL1 (vlCh === 0 relative to lineFrom)
	//           → fall through to smart home (no VL dispatch)
	// =========================================================================
	{
		desc: 'cm, VL1 — no dispatch, smart home applied',
		cm: { currentHead: 5, vlStartHead: 0, vlStartAssoc: 0,
		      lineText: '## hello', cursorCh: 5 },
		vlTrue:  { pos: 3 },
		vlFalse: { pos: 3 },
	},
	{
		desc: 'cm, VL1 plain line — no dispatch, dispatch to ch=0',
		cm: { currentHead: 5, vlStartHead: 0, vlStartAssoc: 0,
		      lineText: 'hello', cursorCh: 5 },
		vlTrue:  { pos: 0 },
		vlFalse: { pos: 0 },
	},

	// =========================================================================
	// Smart home 2-step toggle (heading line)
	// 1st press: cursor past content start → content start
	// 2nd press: cursor at content start → ch=0
	// =========================================================================
	{
		desc: 'cm, heading: 1st press (cursor past ##) — moves to content start',
		cm: { currentHead: 7, vlStartHead: 7, vlStartAssoc: 0,
		      lineText: '## hello', cursorCh: 7 },
		vlTrue:  { pos: 3 },
		vlFalse: { pos: 3 },
	},
	{
		desc: 'cm, heading: 2nd press (cursor at content start) — toggles to ch=0',
		cm: { currentHead: 3, vlStartHead: 0, vlStartAssoc: 0,
		      lineText: '## hello', cursorCh: 3 },
		vlTrue:  { pos: 0 },
		vlFalse: { pos: 0 },
	},

	// =========================================================================
	// Footnote regression: widget decoration makes vlCh=2 even on VL1.
	// Guard (vlCh > lineSmartHomePos) must prevent false VL dispatch.
	// =========================================================================
	{
		desc: 'cm, footnote [^1]: — vlCh=2 < lineSmartHomePos=6, no VL dispatch',
		cm: { currentHead: 12, vlStartHead: 2, vlStartAssoc: 1,
		      lineText: '[^1]: note', cursorCh: 8 },
		vlTrue:  { pos: 6 },
		vlFalse: { pos: 6 },
	},
]

const noCmMatrix: { desc: string; lineText: string; ch: number; expected: number }[] = [
	{ desc: 'no cm, plain text — setCursor to ch=0', lineText: 'hello', ch: 3, expected: 0 },
	{ desc: 'no cm, heading line — setCursor to content start', lineText: '## hello', ch: 7, expected: 3 },
	{ desc: 'no cm, already at line start (ch=0) — setCursor still called with ch=0', lineText: 'hello', ch: 0, expected: 0 },
]

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

describe('moveCursorHomeNonTable', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		// Focus-transition bookkeeping is a shared concern already covered by
		// setCursorViaCm/setCursorsViaCm's own tests — stub it out here so
		// these tests stay focused on moveCursorHomeNonTable's own target
		// computation (every target in this matrix is non-table anyway).
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)
		plugin._inScrollPage = false
	})

	for (const row of matrix) {
		for (const [label, vl] of [['vl=true', true], ['vl=false', false]] as const) {
			const expected = vl ? row.vlTrue : row.vlFalse

			it(`[${label}] ${row.desc}`, () => {
				plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: vl }
				const { editor, mockDispatch } = makeEditorWithCm(row.cm as CmOpts)

				plugin.moveCursorHomeNonTable(editor)

				expect(mockDispatch).toHaveBeenCalledWith({
					selection: EditorSelection.create([EditorSelection.cursor(expected.pos, expected.assoc)]),
					scrollIntoView: true,
					userEvent: 'move',
				})
			})
		}
	}

	for (const row of noCmMatrix) {
		it(row.desc, () => {
			plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: true }
			const { editor, mockSetCursor } = makeEditorWithoutCm(row.lineText, row.ch)

			plugin.moveCursorHomeNonTable(editor)

			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: row.expected })
		})
	}

	// -------------------------------------------------------------------------
	// Multi-cursor: every existing range gets its own Home target in one
	// dispatch, instead of the selection collapsing to a single cursor.
	// -------------------------------------------------------------------------

	it('multi-cursor: each range moves to its own line Home position in one dispatch', () => {
		plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: false }
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)
		plugin._inScrollPage = false

		// Two lines, each with a cursor sitting past its own content start.
		// Line 0: "## heading" (content start at ch=3), line 1: "plain text".
		const lines = ['## heading', 'plain text']
		const mockDispatch = vi.fn()
		const mockFocus     = vi.fn()
		const selection = EditorSelection.create([
			EditorSelection.cursor(7),   // line 0, ch=7
			EditorSelection.cursor(16),  // line 1, ch=5 (offset = line0.length(10)+1+5 = 16)
		], 1)

		const editor = {
			cm: {
				state: { selection },
				moveToLineBoundary: vi.fn((range: { head: number }) => ({ head: range.head, assoc: 0 })),
				dispatch: mockDispatch,
				focus: mockFocus,
			},
			getCursor: vi.fn(),
			getLine: vi.fn((line: number) => lines[line]),
			posToOffset: vi.fn(({ line, ch }: { line: number; ch: number }) => (line === 0 ? ch : 11 + ch)),
			offsetToPos: vi.fn((offset: number) => (offset <= 10 ? { line: 0, ch: offset } : { line: 1, ch: offset - 11 })),
		}

		plugin.moveCursorHomeNonTable(editor)

		expect(mockDispatch).toHaveBeenCalledWith({
			selection: EditorSelection.create([
				EditorSelection.cursor(3),   // line 0 -> content start (ch=3)
				EditorSelection.cursor(11),  // line 1 -> ch=0 (plain text, no markdown prefix)
			], 1),
			scrollIntoView: true,
			userEvent: 'move',
		})
	})

	// -------------------------------------------------------------------------
	// smartHomeStandard = false: always go to ch=0, no markdown prefix awareness
	// -------------------------------------------------------------------------

	describe('smartHomeStandard = false', () => {
		it('cm, heading line — setCursor to ch=0 (no smart home)', () => {
			plugin.settings = { smartHomeStandard: false, smartHomeAdvanced: false, visualLineMovement: false }
			const { editor, mockDispatch } = makeEditorWithCm({
				currentHead: 15, vlStartHead: 10, vlStartAssoc: 1,
				lineText: '## hello world this is long', cursorCh: 15,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockDispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.cursor(0)]),
				scrollIntoView: true,
				userEvent: 'move',
			})
		})
	})
})
