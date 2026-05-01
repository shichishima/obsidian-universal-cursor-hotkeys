import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorSelection } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEditorWithCm(opts: {
	currentHead: number
	lineFrom: number
	vlStartHead: number
	vlStartAssoc: number
	lineText: string
	cursorCh: number
}) {
	const mockDispatch   = vi.fn()
	const mockSetCursor  = vi.fn()
	const mockMoveToLineBoundary = vi.fn().mockReturnValue({
		head: opts.vlStartHead,
		assoc: opts.vlStartAssoc,
	})

	return {
		editor: {
			cm: {
				state: { selection: { main: { head: opts.currentHead, assoc: 0 } } },
				moveToLineBoundary: mockMoveToLineBoundary,
				dispatch: mockDispatch,
			},
			getCursor:   vi.fn().mockReturnValue({ line: 0, ch: opts.cursorCh }),
			getLine:     vi.fn().mockReturnValue(opts.lineText),
			posToOffset: vi.fn().mockReturnValue(opts.lineFrom),
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
// Each row defines one scenario and expected outcomes under two settings:
//   vlTrue  = visualLineMovement: true  (smartHomeStandard: true, smartHomeAdvanced: true)
//   vlFalse = visualLineMovement: false (smartHomeStandard: true, smartHomeAdvanced: true)
//
// dispatch: { head, assoc } → cm.dispatch called with that cursor
// dispatch: null            → cm.dispatch NOT called
// setCursor: number         → editor.setCursor called with { line:0, ch }
// setCursor: null           → editor.setCursor NOT called
// ---------------------------------------------------------------------------

type CmOpts = {
	currentHead: number; lineFrom: number
	vlStartHead: number; vlStartAssoc: number
	lineText: string; cursorCh: number
}

type HomeRow = {
	desc: string
	cm?: CmOpts
	noCm?: { lineText: string; ch: number }
	vlTrue:  { dispatch?: { head: number; assoc: number } | null; setCursor?: number | null }
	vlFalse: { dispatch?: null; setCursor?: number | null }
}

const matrix: HomeRow[] = [
	// =========================================================================
	// Case (1a): cm, VL2+, cursor not at VL left edge, vlCh > lineSmartHomePos
	//            → dispatch to VL left edge
	// =========================================================================
	{
		desc: 'cm, VL2+ middle of plain line — dispatch to VL left edge',
		cm: { currentHead: 15, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
		      lineText: 'hello world this is a long line', cursorCh: 15 },
		vlTrue:  { dispatch: { head: 10, assoc: 1 }, setCursor: null },
		vlFalse: { dispatch: null, setCursor: 0 },
	},
	{
		desc: 'cm, VL2+ middle: moveToLineBoundary called with (main, false, true)',
		cm: { currentHead: 15, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
		      lineText: 'hello world this is a long line', cursorCh: 15 },
		vlTrue:  { dispatch: { head: 10, assoc: 1 }, setCursor: null },
		vlFalse: { dispatch: null, setCursor: 0 },
	},

	// =========================================================================
	// Case (1b): cm, VL2+ but already at VL left edge
	//            → fall through to smart home
	// =========================================================================
	{
		desc: 'cm, already at VL left edge (vlStart.head === currentHead) — smart home',
		cm: { currentHead: 10, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
		      lineText: '## hello', cursorCh: 10 },
		vlTrue:  { dispatch: null, setCursor: 3 },
		vlFalse: { dispatch: null, setCursor: 3 },
	},

	// =========================================================================
	// Case (2): cm, VL1 (vlCh === 0 relative to lineFrom)
	//           → fall through to smart home (no VL dispatch)
	// =========================================================================
	{
		desc: 'cm, VL1 — no dispatch, smart home applied',
		cm: { currentHead: 5, lineFrom: 0, vlStartHead: 0, vlStartAssoc: 0,
		      lineText: '## hello', cursorCh: 5 },
		vlTrue:  { dispatch: null, setCursor: 3 },
		vlFalse: { dispatch: null, setCursor: 3 },
	},
	{
		desc: 'cm, VL1 plain line — no dispatch, setCursor to ch=0',
		cm: { currentHead: 5, lineFrom: 0, vlStartHead: 0, vlStartAssoc: 0,
		      lineText: 'hello', cursorCh: 5 },
		vlTrue:  { dispatch: null, setCursor: 0 },
		vlFalse: { dispatch: null, setCursor: 0 },
	},

	// =========================================================================
	// Smart home 2-step toggle (heading line)
	// 1st press: cursor past content start → content start
	// 2nd press: cursor at content start → ch=0
	// =========================================================================
	{
		desc: 'cm, heading: 1st press (cursor past ##) — moves to content start',
		cm: { currentHead: 7, lineFrom: 0, vlStartHead: 7, vlStartAssoc: 0,
		      lineText: '## hello', cursorCh: 7 },
		vlTrue:  { dispatch: null, setCursor: 3 },
		vlFalse: { dispatch: null, setCursor: 3 },
	},
	{
		desc: 'cm, heading: 2nd press (cursor at content start) — toggles to ch=0',
		cm: { currentHead: 3, lineFrom: 0, vlStartHead: 0, vlStartAssoc: 0,
		      lineText: '## hello', cursorCh: 3 },
		vlTrue:  { dispatch: null, setCursor: 0 },
		vlFalse: { dispatch: null, setCursor: 0 },
	},

	// =========================================================================
	// Footnote regression: widget decoration makes vlCh=2 even on VL1.
	// Guard (vlCh > lineSmartHomePos) must prevent false VL dispatch.
	// =========================================================================
	{
		desc: 'cm, footnote [^1]: — vlCh=2 < lineSmartHomePos=6, no VL dispatch',
		cm: { currentHead: 12, lineFrom: 0, vlStartHead: 2, vlStartAssoc: 1,
		      lineText: '[^1]: note', cursorCh: 8 },
		vlTrue:  { dispatch: null, setCursor: 6 },
		vlFalse: { dispatch: null, setCursor: 6 },
	},

	// =========================================================================
	// No cm: smart home only (no VL step regardless of visualLineMovement)
	// =========================================================================
	{
		desc: 'no cm, plain text — setCursor to ch=0',
		noCm: { lineText: 'hello', ch: 3 },
		vlTrue:  { dispatch: null, setCursor: 0 },
		vlFalse: { dispatch: null, setCursor: 0 },
	},
	{
		desc: 'no cm, heading line — setCursor to content start',
		noCm: { lineText: '## hello', ch: 7 },
		vlTrue:  { dispatch: null, setCursor: 3 },
		vlFalse: { dispatch: null, setCursor: 3 },
	},
	{
		desc: 'no cm, already at line start (ch=0) — setCursor still called with ch=0',
		noCm: { lineText: 'hello', ch: 0 },
		vlTrue:  { dispatch: null, setCursor: 0 },
		vlFalse: { dispatch: null, setCursor: 0 },
	},
]

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

describe('moveCursorHomeNonTable', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
	})

	for (const row of matrix) {
		for (const [label, vl] of [['vl=true', true], ['vl=false', false]] as const) {
			const expected = vl ? row.vlTrue : row.vlFalse

			it(`[${label}] ${row.desc}`, () => {
				plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: vl }

				let editor: any
				let dispatchMock: ReturnType<typeof vi.fn> | undefined
				let setCursorMock: ReturnType<typeof vi.fn>

				if (row.cm) {
					const built = makeEditorWithCm(row.cm)
					editor       = built.editor
					dispatchMock = built.mockDispatch
					setCursorMock = built.mockSetCursor
				} else {
					const { noCm } = row as { noCm: { lineText: string; ch: number } }
					const built = makeEditorWithoutCm(noCm.lineText, noCm.ch)
					editor       = built.editor
					setCursorMock = built.mockSetCursor
				}

				plugin.moveCursorHomeNonTable(editor)

				// dispatch assertion
				if (dispatchMock) {
					if (expected.dispatch) {
						const { head, assoc } = expected.dispatch
						expect(dispatchMock).toHaveBeenCalledWith({
							selection: EditorSelection.create([EditorSelection.cursor(head, assoc)]),
							scrollIntoView: true,
							userEvent: 'move',
						})
					} else {
						expect(dispatchMock).not.toHaveBeenCalled()
					}
				}

				// setCursor assertion
				if (expected.setCursor !== undefined) {
					if (expected.setCursor === null) {
						expect(setCursorMock).not.toHaveBeenCalled()
					} else {
						expect(setCursorMock).toHaveBeenCalledWith({ line: 0, ch: expected.setCursor })
					}
				}
			})
		}
	}

	// -------------------------------------------------------------------------
	// smartHomeStandard = false: always go to ch=0, no markdown prefix awareness
	// -------------------------------------------------------------------------

	describe('smartHomeStandard = false', () => {
		it('cm, heading line — setCursor to ch=0 (no smart home)', () => {
			plugin.settings = { smartHomeStandard: false, smartHomeAdvanced: false, visualLineMovement: false }
			const { editor, mockDispatch, mockSetCursor } = makeEditorWithCm({
				currentHead: 15, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
				lineText: '## hello world this is long', cursorCh: 15,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockDispatch).not.toHaveBeenCalled()
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 0 })
		})
	})
})
