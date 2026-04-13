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
	})

	// -------------------------------------------------------------------------
	// Case (1a): VL2+, 非左端 -> VL左端へ
	// -------------------------------------------------------------------------

	describe('Case(1a): VL2+ かつ非左端', () => {
		it('moveToLineBoundary(main, false, true) で呼ばれる', () => {
			// currentHead=15 (VL2中間), lineFrom=0, vlStart=10 (VL2左端, ch>0)
			const { editor, mockMoveToLineBoundary } = makeEditorWithCm({
				currentHead: 15, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
				lineText: 'hello world this is a long line', cursorCh: 15,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockMoveToLineBoundary).toHaveBeenCalledWith(
				editor.cm.state.selection.main, false, true
			)
		})

		it('EditorSelection.create で assoc を保持して dispatch される', () => {
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

		it('goRight/goLeft は呼ばれない', () => {
			const { editor, mockExec } = makeEditorWithCm({
				currentHead: 15, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
				lineText: 'hello world this is a long line', cursorCh: 15,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockExec).not.toHaveBeenCalled()
		})

		it('setCursor は呼ばれない', () => {
			const { editor, mockSetCursor } = makeEditorWithCm({
				currentHead: 15, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
				lineText: 'hello world this is a long line', cursorCh: 15,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).not.toHaveBeenCalled()
		})
	})

	// -------------------------------------------------------------------------
	// Case (1b)/(2): VL左端 or VL1 -> スマートホームへフォールスルー
	// -------------------------------------------------------------------------

	describe('Case(1b)/(2): すでにVL左端 or VL1 -> スマートホーム', () => {
		it('すでにVL左端 (vlStart.head === currentHead): スマートホームに移動する', () => {
			// カーソルがVL左端にある: vlStartHead === currentHead
			const { editor, mockSetCursor } = makeEditorWithCm({
				currentHead: 10, lineFrom: 0, vlStartHead: 10, vlStartAssoc: 1,
				lineText: '## hello', cursorCh: 10,
			})
			plugin.moveCursorHomeNonTable(editor)
			// dispatch は呼ばれず、setCursor でスマートホーム位置へ
			expect(mockSetCursor).toHaveBeenCalled()
		})

		it('VL1 (vlCh === 0): スマートホームに移動する', () => {
			// vlStartHead === lineFrom (ch=0), currentHead != vlStartHead
			const { editor, mockSetCursor } = makeEditorWithCm({
				currentHead: 5, lineFrom: 0, vlStartHead: 0, vlStartAssoc: 0,
				lineText: '## hello', cursorCh: 5,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalled()
		})

		it('heading行: コンテンツ先頭 (## の後) に移動する', () => {
			// '## hello', cursorCh=7 (末尾), スマートホーム -> ch=3
			const { editor, mockSetCursor } = makeEditorWithCm({
				currentHead: 7, lineFrom: 0, vlStartHead: 7, vlStartAssoc: 0,
				lineText: '## hello', cursorCh: 7,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 3 })
		})

		it('dispatch は呼ばれない', () => {
			const { editor, mockDispatch } = makeEditorWithCm({
				currentHead: 5, lineFrom: 0, vlStartHead: 0, vlStartAssoc: 0,
				lineText: 'hello', cursorCh: 5,
			})
			plugin.moveCursorHomeNonTable(editor)
			expect(mockDispatch).not.toHaveBeenCalled()
		})
	})

	// -------------------------------------------------------------------------
	// cm なし: スマートホームのみ
	// -------------------------------------------------------------------------

	describe('cm がない場合 (fallback)', () => {
		it('通常テキスト: 行頭 (ch=0) に移動する', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('hello', 3)
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 0 })
		})

		it('heading行: コンテンツ先頭に移動する', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('## hello', 7)
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 3 })
		})

		it('すでに行頭 (ch=0): ch=0 のままなので setCursor が呼ばれる', () => {
			// getBeginningOfLinePosition は ch=0 を返し、cursor.ch=0 と同じ -> setCursor は呼ばれる
			// (HomeNonTable は EndNonTable と違い常に setCursor を呼ぶ)
			const { editor, mockSetCursor } = makeEditorWithoutCm('hello', 0)
			plugin.moveCursorHomeNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 0 })
		})
	})
})
