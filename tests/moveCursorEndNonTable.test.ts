import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorSelection } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../src/main.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Builds a real CM6 EditorSelection (single range) around currentHead —
// moveCursorEndNonTable now goes through setCursorsViaCm, which maps over
// cm.state.selection.ranges and feeds unchanged ranges straight into
// EditorSelection.create, so this needs to be a real SelectionRange, not a
// plain {head, assoc} object. Everything (the VL check and the logical-end
// fallback) now reads from this single head value via offsetToPos, so —
// unlike the old single-cursor implementation — there's no separate
// editor.getCursor() value to desync from it.
function makeEditorWithCm(
	moveToLineBoundaryResult: { head: number; assoc: number },
	currentHead: number,
	lineText: string,
) {
	const mockDispatch = vi.fn()
	const mockFocus     = vi.fn()
	const mockMoveToLineBoundary = vi.fn().mockReturnValue(moveToLineBoundaryResult)
	const selection = EditorSelection.create([EditorSelection.cursor(currentHead)])
	return {
		editor: {
			cm: {
				state: { selection },
				moveToLineBoundary: mockMoveToLineBoundary,
				dispatch: mockDispatch,
				focus: mockFocus,
			},
			getLine:     vi.fn().mockReturnValue(lineText),
			// All test scenarios are single-line (line 0), so offset === ch.
			posToOffset: vi.fn((pos: { line: number; ch: number }) => pos.ch),
			offsetToPos: vi.fn((offset: number) => ({ line: 0, ch: offset })),
			setCursor:   vi.fn(),
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
// With cm available, moveCursorEndNonTable always routes through
// setCursorsViaCm now (even the old "logical end only" cases, which used to
// call editor.setCursor directly) — so a dispatch fires whenever the single
// range's target differs from where it already is, and setCursorsViaCm
// skips the dispatch entirely when it doesn't (e.g. already at the line's
// true end). Only the "no cm" rows still call editor.setCursor directly.
// ---------------------------------------------------------------------------

type EndRow = {
	desc: string
	cm?: { vlHead: number; vlAssoc: number; currentHead: number; lineText: string }
	noCm?: { line: string; ch: number }
	vlTrue:  { pos: number; assoc?: number } | null
	vlFalse: { pos: number; assoc?: number } | null
}

const matrix: EndRow[] = [
	// --- cm available ---

	{
		desc: 'cm: cursor before VL end — dispatch to VL end',
		cm: { vlHead: 11, vlAssoc: -1, currentHead: 0, lineText: 'hello world' },
		vlTrue:  { pos: 11, assoc: -1 },
		vlFalse: { pos: 11 },
	},
	{
		desc: 'cm: soft-wrap VL1 end — dispatch with assoc=-1',
		cm: { vlHead: 40, vlAssoc: -1, currentHead: 0, lineText: 'hello world' },
		vlTrue:  { pos: 40, assoc: -1 },
		vlFalse: { pos: 11 },
	},
	{
		desc: 'cm: hidden markdown at line end (assoc=0) — dispatch with assoc=0',
		cm: { vlHead: 20, vlAssoc: 0, currentHead: 5, lineText: 'hello world extra' },
		vlTrue:  { pos: 20, assoc: 0 },
		vlFalse: { pos: 17 },
	},
	{
		desc: 'cm: already at VL end, logical line end differs — dispatch to logical end',
		cm: { vlHead: 11, vlAssoc: -1, currentHead: 11, lineText: 'hello world[^1]' },
		vlTrue:  { pos: 15 },
		vlFalse: { pos: 15 },
	},
	{
		desc: 'cm: cursor already at logical end — no dispatch',
		cm: { vlHead: 11, vlAssoc: -1, currentHead: 11, lineText: 'hello world' },
		vlTrue:  null,
		vlFalse: null,
	},
]

const noCmMatrix: { desc: string; line: string; ch: number; expected: number | null }[] = [
	{ desc: 'no cm: cursor at middle — setCursor to line end', line: 'hello world', ch: 3, expected: 11 },
	{ desc: 'no cm: cursor at line start (ch=0) — setCursor to line end', line: 'hello', ch: 0, expected: 5 },
	{ desc: 'no cm: cursor already at line end — setCursor not called', line: 'hello', ch: 5, expected: null },
	{ desc: 'no cm: empty line — setCursor not called', line: '', ch: 0, expected: null },
	{ desc: 'no cm: multibyte characters — setCursor to line end', line: 'あいう', ch: 1, expected: 3 },
]

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

describe('moveCursorEndNonTable', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		// Focus-transition bookkeeping is a shared concern already covered by
		// setCursorViaCm/setCursorsViaCm's own tests — stub it out here so
		// these tests stay focused on moveCursorEndNonTable's own target
		// computation (every target in this matrix is non-table anyway).
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)
		plugin._inScrollPage = false
	})

	for (const row of matrix) {
		for (const [label, vl] of [['vl=true', true], ['vl=false', false]] as const) {
			const expected = vl ? row.vlTrue : row.vlFalse

			it(`[${label}] ${row.desc}`, () => {
				plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: vl }
				const { cm } = row
				const { editor, mockDispatch } = makeEditorWithCm(
					{ head: cm!.vlHead, assoc: cm!.vlAssoc },
					cm!.currentHead,
					cm!.lineText,
				)

				plugin.moveCursorEndNonTable(editor)

				if (expected) {
					expect(mockDispatch).toHaveBeenCalledWith({
						selection: EditorSelection.create([EditorSelection.cursor(expected.pos, expected.assoc)]),
						scrollIntoView: true,
						userEvent: 'move',
					})
				} else {
					expect(mockDispatch).not.toHaveBeenCalled()
				}
			})
		}
	}

	for (const row of noCmMatrix) {
		it(row.desc, () => {
			plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: true }
			const { editor, mockSetCursor } = makeEditorWithoutCm(row.line, row.ch)

			plugin.moveCursorEndNonTable(editor)

			if (row.expected === null) {
				expect(mockSetCursor).not.toHaveBeenCalled()
			} else {
				expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: row.expected })
			}
		})
	}

	// -------------------------------------------------------------------------
	// Multi-cursor: every existing range gets its own End target in one
	// dispatch, instead of the selection collapsing to a single cursor.
	// -------------------------------------------------------------------------

	it('multi-cursor: each range moves to its own line End position in one dispatch', () => {
		plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: false }
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)
		plugin._inScrollPage = false

		// Line 0: "hi" (len 2), line 1: "hello" (len 5). Cursors start at
		// ch=0 on each line; End should push each one to its own line end.
		const lines = ['hi', 'hello']
		const mockDispatch = vi.fn()
		const mockFocus     = vi.fn()
		const selection = EditorSelection.create([
			EditorSelection.cursor(0),  // line 0, ch=0
			EditorSelection.cursor(3),  // line 1, ch=0 (offset = line0.length(2)+1)
		], 1)

		const editor = {
			cm: {
				state: { selection },
				moveToLineBoundary: vi.fn((range: { head: number }) => ({ head: range.head, assoc: 0 })),
				dispatch: mockDispatch,
				focus: mockFocus,
			},
			getLine: vi.fn((line: number) => lines[line]),
			posToOffset: vi.fn(({ line, ch }: { line: number; ch: number }) => (line === 0 ? ch : 3 + ch)),
			offsetToPos: vi.fn((offset: number) => (offset <= 2 ? { line: 0, ch: offset } : { line: 1, ch: offset - 3 })),
		}

		plugin.moveCursorEndNonTable(editor)

		expect(mockDispatch).toHaveBeenCalledWith({
			selection: EditorSelection.create([
				EditorSelection.cursor(2),  // line 0 -> ch=2 (end of "hi")
				EditorSelection.cursor(8),  // line 1 -> ch=5 (end of "hello", offset 3+5=8)
			], 1),
			scrollIntoView: true,
			userEvent: 'move',
		})
	})
})
