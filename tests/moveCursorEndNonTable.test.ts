import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorSelection } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// Helper: build a mock editor with cm
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

// Helper: build a mock editor without cm
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

describe('moveCursorEndNonTable', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: true }
	})

	// -------------------------------------------------------------------------
	// with cm: dispatch the result of moveToLineBoundary as-is
	// -------------------------------------------------------------------------

	describe('with cm available', () => {
		it('calls moveToLineBoundary(main, true, true)', () => {
			const { editor, mockMoveToLineBoundary } = makeEditorWithCm({ head: 10, assoc: -1 }, 5)
			plugin.moveCursorEndNonTable(editor)
			expect(mockMoveToLineBoundary).toHaveBeenCalledWith(
				editor.cm.state.selection.main, true, true
			)
		})

		it('plain text: dispatch receives head and assoc', () => {
			// e.g. "hello world" (offset 0-10), line end offset=11, assoc=-1
			const { editor, mockDispatch } = makeEditorWithCm({ head: 11, assoc: -1 }, 0)
			plugin.moveCursorEndNonTable(editor)
			expect(mockDispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.cursor(11, -1)]),
				scrollIntoView: true,
				userEvent: 'move',
			})
		})

		it('soft-wrap: VL1 end assoc=-1 is dispatched as-is', () => {
			// moveToLineBoundary returns offset=40, assoc=-1 for soft-wrapped VL1 end
			const { editor, mockDispatch } = makeEditorWithCm({ head: 40, assoc: -1 }, 0)
			plugin.moveCursorEndNonTable(editor)
			expect(mockDispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.cursor(40, -1)]),
				scrollIntoView: true,
				userEvent: 'move',
			})
		})

		it('hidden markdown (assoc=0): dispatch receives head and assoc=0', () => {
			// e.g. `[[link]]` hidden markdown at end of line
			const { editor, mockDispatch } = makeEditorWithCm({ head: 20, assoc: 0 }, 5)
			plugin.moveCursorEndNonTable(editor)
			expect(mockDispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.cursor(20, 0)]),
				scrollIntoView: true,
				userEvent: 'move',
			})
		})

		it('already at VL end: dispatch not called, setCursor moves to logical line end (2-step)', () => {
			// moveToLineBoundary returns same head as currentHead = already at VL end
			// -> fall through to logical line end via setCursor
			const { editor } = makeEditorWithCm({ head: 11, assoc: -1 }, 11)
			editor.getLine = vi.fn().mockReturnValue('hello world')  // length=11
			editor.getCursor = vi.fn().mockReturnValue({ line: 0, ch: 8 })  // ch < length
			plugin.moveCursorEndNonTable(editor)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 11 })
		})

		it('setCursor is not called', () => {
			const { editor } = makeEditorWithCm({ head: 11, assoc: -1 }, 0)
			plugin.moveCursorEndNonTable(editor)
			expect(editor.setCursor).not.toHaveBeenCalled()
		})
	})

	// -------------------------------------------------------------------------
	// without cm: setCursor fallback to logical line end
	// -------------------------------------------------------------------------

	describe('without cm (fallback)', () => {
		it('plain text: cursor at middle — setCursor called at line end', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('hello world', 3)
			plugin.moveCursorEndNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 11 })
		})

		it('cursor at line start (ch=0) — setCursor called at line end', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('hello', 0)
			plugin.moveCursorEndNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 5 })
		})

		it('cursor already at line end — setCursor is not called', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('hello', 5)
			plugin.moveCursorEndNonTable(editor)
			expect(mockSetCursor).not.toHaveBeenCalled()
		})

		it('empty line: ch=0 and line.length=0 — setCursor is not called', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('', 0)
			plugin.moveCursorEndNonTable(editor)
			expect(mockSetCursor).not.toHaveBeenCalled()
		})

		it('multibyte characters: ch < line.length — setCursor moves to line end', () => {
			// 'あいう' has JS length=3
			const { editor, mockSetCursor } = makeEditorWithoutCm('あいう', 1)
			plugin.moveCursorEndNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 3 })
		})
	})

	// -------------------------------------------------------------------------
	// visualLineMovement = false: skip VL step, go directly to logical line end
	// -------------------------------------------------------------------------

	describe('visualLineMovement = false', () => {
		beforeEach(() => {
			plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: false }
		})

		it('with cm, cursor at VL middle: dispatch is not called', () => {
			const { editor, mockDispatch } = makeEditorWithCm({ head: 40, assoc: -1 }, 0)
			editor.getCursor = vi.fn().mockReturnValue({ line: 0, ch: 0 })
			editor.getLine = vi.fn().mockReturnValue('hello world')
			plugin.moveCursorEndNonTable(editor)
			expect(mockDispatch).not.toHaveBeenCalled()
		})

		it('with cm, cursor at line start: setCursor moves to logical line end', () => {
			const { editor } = makeEditorWithCm({ head: 11, assoc: -1 }, 0)
			editor.getCursor = vi.fn().mockReturnValue({ line: 0, ch: 0 })
			editor.getLine = vi.fn().mockReturnValue('hello world')
			plugin.moveCursorEndNonTable(editor)
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 11 })
		})

		it('with cm, cursor at line middle: setCursor moves to logical line end', () => {
			const { editor } = makeEditorWithCm({ head: 11, assoc: -1 }, 5)
			editor.getCursor = vi.fn().mockReturnValue({ line: 0, ch: 5 })
			editor.getLine = vi.fn().mockReturnValue('hello world')
			plugin.moveCursorEndNonTable(editor)
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 11 })
		})

		it('with cm, cursor already at line end: setCursor is not called', () => {
			const { editor } = makeEditorWithCm({ head: 11, assoc: -1 }, 11)
			editor.getCursor = vi.fn().mockReturnValue({ line: 0, ch: 11 })
			editor.getLine = vi.fn().mockReturnValue('hello world')
			plugin.moveCursorEndNonTable(editor)
			expect(editor.setCursor).not.toHaveBeenCalled()
		})

		it('without cm, cursor at line middle: setCursor moves to logical line end', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('hello world', 3)
			plugin.moveCursorEndNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 11 })
		})

		it('without cm, cursor already at line end: setCursor is not called', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('hello', 5)
			plugin.moveCursorEndNonTable(editor)
			expect(mockSetCursor).not.toHaveBeenCalled()
		})
	})
})
