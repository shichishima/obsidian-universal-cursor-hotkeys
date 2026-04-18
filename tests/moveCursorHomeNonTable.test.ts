import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorSelection } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// Helper: build a mock editor with cm
function makeEditorWithCm(opts: {
	currentHead: number,
	lineFrom: number,
	vlStartHead: number,
	vlStartAssoc: number,
	lineText: string,
	cursorCh: number,
}) {
	const mockDispatch = vi.fn()
	const mockExec = vi.fn()
	const mockSetCursor = vi.fn()

	// moveToLineBoundary returns the VL start
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
			getCursor: vi.fn().mockReturnValue({ line: 0, ch: opts.cursorCh }),
			getLine: vi.fn().mockReturnValue(opts.lineText),
			posToOffset: vi.fn().mockReturnValue(opts.lineFrom),
			exec: mockExec,
			setCursor: mockSetCursor,
		},
		mockDispatch,
		mockExec,
		mockSetCursor,
		mockMoveToLineBoundary,
	}
}

// Helper: build a mock editor without cm
function makeEditorWithoutCm(lineText: string, ch: number) {
	const mockSetCursor = vi.fn()
	return {
		editor: {
			cm: undefined,
			getCursor: vi.fn().mockReturnValue({ line: 0, ch }),
			getLine: vi.fn().mockReturnValue(lineText),
			setCursor: mockSetCursor,
		},
		mockSetCursor,
	}
}

describe('moveCursorHomeNonTable', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: true }
	})

	// -------------------------------------------------------------------------
	// Case (1a): VL2+, not at left edge -> move to VL left edge
	// -------------------------------------------------------------------------

	describe('Case(1a): VL2+ and not at left edge', () => {
		it('calls moveToLineBoundary(main, false, true)', () => {
			// currentHead=15 (VL2 middle), lineFrom=0, vlStart=10 (VL2 left edge, ch>0)
			const { editor, mockMoveToLineBoundary } = makeEditorWithCm({
				currentHead: 15, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
				lineText: 'hello world this is a long line', cursorCh: 15,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockMoveToLineBoundary).toHaveBeenCalledWith(
				editor.cm.state.selection.main, false, true
			)
		})

		it('dispatched via EditorSelection.create preserving assoc', () => {
			const { editor, mockDispatch } = makeEditorWithCm({
				currentHead: 15, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
				lineText: 'hello world this is a long line', cursorCh: 15,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockDispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.cursor(10, 1)]),
				scrollIntoView: true,
				userEvent: 'move',
			})
		})

		it('goRight/goLeft are not called', () => {
			const { editor, mockExec } = makeEditorWithCm({
				currentHead: 15, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
				lineText: 'hello world this is a long line', cursorCh: 15,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockExec).not.toHaveBeenCalled()
		})

		it('setCursor is not called', () => {
			const { editor, mockSetCursor } = makeEditorWithCm({
				currentHead: 15, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
				lineText: 'hello world this is a long line', cursorCh: 15,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).not.toHaveBeenCalled()
		})
	})

	// -------------------------------------------------------------------------
	// Case (1b)/(2): already at VL left edge or VL1 -> fall through to smart home
	// -------------------------------------------------------------------------

	describe('Case(1b)/(2): already at VL left edge or VL1 -> smart home', () => {
		it('already at VL left edge (vlStart.head === currentHead): moves to smart home', () => {
			// cursor is at VL left edge: vlStartHead === currentHead
			const { editor, mockSetCursor } = makeEditorWithCm({
				currentHead: 10, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
				lineText: '## hello', cursorCh: 10,
			})
			plugin.moveCursorHomeNonTable(editor)
			// dispatch not called; setCursor moves to smart home position
			expect(mockSetCursor).toHaveBeenCalled()
		})

		it('VL1 (vlCh === 0): moves to smart home', () => {
			// vlStartHead === lineFrom (ch=0), currentHead != vlStartHead
			const { editor, mockSetCursor } = makeEditorWithCm({
				currentHead: 5, lineFrom: 0, vlStartHead: 0, vlStartAssoc: 0,
				lineText: '## hello', cursorCh: 5,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalled()
		})

		it('heading line: moves to content start (after ##)', () => {
			// '## hello', cursorCh=7 (end), smart home -> ch=3
			const { editor, mockSetCursor } = makeEditorWithCm({
				currentHead: 7, lineFrom: 0, vlStartHead: 7, vlStartAssoc: 0,
				lineText: '## hello', cursorCh: 7,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 3 })
		})

		it('dispatch is not called', () => {
			const { editor, mockDispatch } = makeEditorWithCm({
				currentHead: 5, lineFrom: 0, vlStartHead: 0, vlStartAssoc: 0,
				lineText: 'hello', cursorCh: 5,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockDispatch).not.toHaveBeenCalled()
		})
	})

	// -------------------------------------------------------------------------
	// without cm: smart home only
	// -------------------------------------------------------------------------

	describe('without cm (fallback)', () => {
		it('plain text: moves to line start (ch=0)', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('hello', 3)
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 0 })
		})

		it('heading line: moves to content start', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('## hello', 7)
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 3 })
		})

		it('already at line start (ch=0): setCursor is still called with ch=0', () => {
			// getBeginningOfLinePosition returns 0, same as cursor.ch=0 -> setCursor is still called
			// (HomeNonTable always calls setCursor, unlike EndNonTable)
			const { editor, mockSetCursor } = makeEditorWithoutCm('hello', 0)
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 0 })
		})
	})

	// -------------------------------------------------------------------------
	// visualLineMovement = false: skip VL step, go directly to smart home
	// -------------------------------------------------------------------------

	describe('visualLineMovement = false', () => {
		beforeEach(() => {
			plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: false }
		})

		it('with cm, cursor at VL2 middle: dispatch is not called', () => {
			const { editor, mockDispatch } = makeEditorWithCm({
				currentHead: 15, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
				lineText: '## hello world this is long', cursorCh: 15,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockDispatch).not.toHaveBeenCalled()
		})

		it('with cm, cursor at VL2 middle: setCursor jumps directly to smart home position', () => {
			const { editor, mockSetCursor } = makeEditorWithCm({
				currentHead: 15, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
				lineText: '## hello world this is long', cursorCh: 15,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 3 })
		})

		it('with cm, cursor already at smart home position: toggles to ch=0', () => {
			const { editor, mockSetCursor } = makeEditorWithCm({
				currentHead: 3, lineFrom: 0, vlStartHead: 0, vlStartAssoc: 0,
				lineText: '## hello', cursorCh: 3,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 0 })
		})

		it('without cm, heading line: setCursor to smart home position', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('## hello', 7)
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 3 })
		})

		it('without cm, plain text: setCursor to ch=0', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('hello', 5)
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 0 })
		})

		it('smartHomeStandard = false: dispatch not called, setCursor goes directly to ch=0', () => {
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
