import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorSelection } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEditorWithCm(
	moveToLineBoundaryResult: { head: number; assoc: number },
	currentHead: number,
) {
	const mockDispatch = vi.fn()
	const mockMoveToLineBoundary = vi.fn().mockReturnValue(moveToLineBoundaryResult)
	return {
		editor: {
			cm: {
				state: { selection: { main: { head: currentHead, assoc: 0 } } },
				moveToLineBoundary: mockMoveToLineBoundary,
				dispatch: mockDispatch,
			},
			getCursor: vi.fn(),
			getLine: vi.fn(),
			setCursor: vi.fn(),
		},
		mockDispatch,
		mockMoveToLineBoundary,
	}
}

function makeEditorWithoutCm(line: string, ch: number) {
	const mockSetCursor = vi.fn()
	return {
		editor: {
			cm: undefined,
			getCursor: vi.fn().mockReturnValue({ line: 0, ch }),
			getLine: vi.fn().mockReturnValue(line),
			setCursor: mockSetCursor,
		},
		mockSetCursor,
	}
}

// ---------------------------------------------------------------------------
// Matrix
//
// Each row defines one scenario and the expected outcome under two settings:
//   vlTrue  = visualLineMovement: true
//   vlFalse = visualLineMovement: false
//
// dispatch: number   → cm.dispatch called with that cursor offset
// dispatch: null     → cm.dispatch NOT called
// setCursor: number  → editor.setCursor called with { line:0, ch }
// setCursor: null    → editor.setCursor NOT called
// ---------------------------------------------------------------------------

type CmOpts = { vlHead: number; vlAssoc: number; currentHead: number }
type NoCmOpts = { line: string; ch: number }

type EndRow = {
	desc: string
	// provide either cm or noCm (not both)
	cm?: CmOpts & { cursorCh: number; lineText: string }
	noCm?: NoCmOpts
	vlTrue:  { dispatch?: { head: number; assoc: number } | null; setCursor?: number | null }
	vlFalse: { dispatch?: null; setCursor?: number | null }
}

const matrix: EndRow[] = [
	// --- cm available ---

	{
		desc: 'cm: cursor before VL end — dispatch to VL end',
		cm: { vlHead: 11, vlAssoc: -1, currentHead: 0, cursorCh: 0, lineText: 'hello world' },
		vlTrue:  { dispatch: { head: 11, assoc: -1 }, setCursor: null },
		vlFalse: { dispatch: null, setCursor: 11 },
	},
	{
		desc: 'cm: soft-wrap VL1 end — dispatch with assoc=-1',
		cm: { vlHead: 40, vlAssoc: -1, currentHead: 0, cursorCh: 0, lineText: 'hello world' },
		vlTrue:  { dispatch: { head: 40, assoc: -1 }, setCursor: null },
		vlFalse: { dispatch: null, setCursor: 11 },
	},
	{
		desc: 'cm: hidden markdown at line end (assoc=0) — dispatch with assoc=0',
		cm: { vlHead: 20, vlAssoc: 0, currentHead: 5, cursorCh: 5, lineText: 'hello world extra' },
		vlTrue:  { dispatch: { head: 20, assoc: 0 }, setCursor: null },
		vlFalse: { dispatch: null, setCursor: 17 },
	},
	{
		desc: 'cm: already at VL end (2-step) — no dispatch, setCursor to logical end',
		cm: { vlHead: 11, vlAssoc: -1, currentHead: 11, cursorCh: 8, lineText: 'hello world' },
		vlTrue:  { dispatch: null, setCursor: 11 },
		vlFalse: { dispatch: null, setCursor: 11 },
	},
	{
		desc: 'cm: cursor already at logical end — setCursor not called',
		cm: { vlHead: 11, vlAssoc: -1, currentHead: 11, cursorCh: 11, lineText: 'hello world' },
		vlTrue:  { dispatch: null, setCursor: null },
		vlFalse: { dispatch: null, setCursor: null },
	},

	// --- no cm ---

	{
		desc: 'no cm: cursor at middle — setCursor to line end',
		noCm: { line: 'hello world', ch: 3 },
		vlTrue:  { dispatch: null, setCursor: 11 },
		vlFalse: { dispatch: null, setCursor: 11 },
	},
	{
		desc: 'no cm: cursor at line start (ch=0) — setCursor to line end',
		noCm: { line: 'hello', ch: 0 },
		vlTrue:  { dispatch: null, setCursor: 5 },
		vlFalse: { dispatch: null, setCursor: 5 },
	},
	{
		desc: 'no cm: cursor already at line end — setCursor not called',
		noCm: { line: 'hello', ch: 5 },
		vlTrue:  { dispatch: null, setCursor: null },
		vlFalse: { dispatch: null, setCursor: null },
	},
	{
		desc: 'no cm: empty line — setCursor not called',
		noCm: { line: '', ch: 0 },
		vlTrue:  { dispatch: null, setCursor: null },
		vlFalse: { dispatch: null, setCursor: null },
	},
	{
		desc: 'no cm: multibyte characters — setCursor to line end',
		noCm: { line: 'あいう', ch: 1 },
		vlTrue:  { dispatch: null, setCursor: 3 },
		vlFalse: { dispatch: null, setCursor: 3 },
	},
]

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

describe('moveCursorEndNonTable', () => {
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

				if (row.cm) {
					const { cm } = row
					const built = makeEditorWithCm(
						{ head: cm.vlHead, assoc: cm.vlAssoc },
						cm.currentHead,
					)
					built.editor.getCursor = vi.fn().mockReturnValue({ line: 0, ch: cm.cursorCh })
					built.editor.getLine   = vi.fn().mockReturnValue(cm.lineText)
					editor      = built.editor
					dispatchMock = built.mockDispatch
				} else {
					const { noCm } = row as { noCm: NoCmOpts }
					const built = makeEditorWithoutCm(noCm.line, noCm.ch)
					editor = built.editor
				}

				plugin.moveCursorEndNonTable(editor)

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
						expect(editor.setCursor).not.toHaveBeenCalled()
					} else {
						expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: expected.setCursor })
					}
				}
			})
		}
	}
})
