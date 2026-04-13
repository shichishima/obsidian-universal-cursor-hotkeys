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
	})

	// -------------------------------------------------------------------------
	// cm あり: moveToLineBoundary の結果をそのまま dispatch する
	// -------------------------------------------------------------------------

	describe('cm が利用可能な場合', () => {
		it('moveToLineBoundary(main, true, true) で呼ばれる', () => {
			const { editor, mockMoveToLineBoundary } = makeEditorWithCm({ head: 10, assoc: -1 }, 5)
			plugin.moveCursorEndNonTable(editor)
			expect(mockMoveToLineBoundary).toHaveBeenCalledWith(
				editor.cm.state.selection.main, true, true
			)
		})

		it('通常テキスト: dispatch に head と assoc が渡される', () => {
			// 例: "hello world" (offset 0-10) の行末 offset=11, assoc=-1
			const { editor, mockDispatch } = makeEditorWithCm({ head: 11, assoc: -1 }, 0)
			plugin.moveCursorEndNonTable(editor)
			expect(mockDispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.cursor(11, -1)]),
				scrollIntoView: true,
				userEvent: 'move',
			})
		})

		it('soft-wrap: VL1 末尾の assoc=-1 がそのまま dispatch される', () => {
			// soft-wrap で VL1 末尾 offset=40, assoc=-1 を moveToLineBoundary が返す想定
			const { editor, mockDispatch } = makeEditorWithCm({ head: 40, assoc: -1 }, 0)
			plugin.moveCursorEndNonTable(editor)
			expect(mockDispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.cursor(40, -1)]),
				scrollIntoView: true,
				userEvent: 'move',
			})
		})

		it('hidden markdown (assoc=0): dispatch に head と assoc=0 が渡される', () => {
			// `[[link]]` のような hidden markdown が行末にある場合
			const { editor, mockDispatch } = makeEditorWithCm({ head: 20, assoc: 0 }, 5)
			plugin.moveCursorEndNonTable(editor)
			expect(mockDispatch).toHaveBeenCalledWith({
				selection: EditorSelection.create([EditorSelection.cursor(20, 0)]),
				scrollIntoView: true,
				userEvent: 'move',
			})
		})

		it('すでに VL 末尾にいる場合は dispatch されず setCursor で論理行末へ (2-step)', () => {
			// moveToLineBoundary が currentHead と同じ head を返す = すでに VL 末尾
			// → フォールスルーして論理行末へ setCursor
			const { editor } = makeEditorWithCm({ head: 11, assoc: -1 }, 11)
			// getLine / getCursor が必要なので設定
			editor.getLine = vi.fn().mockReturnValue('hello world')  // length=11
			editor.getCursor = vi.fn().mockReturnValue({ line: 0, ch: 8 })  // ch < length
			plugin.moveCursorEndNonTable(editor)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 11 })
		})

		it('setCursor は呼ばれない', () => {
			const { editor } = makeEditorWithCm({ head: 11, assoc: -1 }, 0)
			plugin.moveCursorEndNonTable(editor)
			expect(editor.setCursor).not.toHaveBeenCalled()
		})
	})

	// -------------------------------------------------------------------------
	// cm なし: 論理行末への setCursor フォールバック
	// -------------------------------------------------------------------------

	describe('cm がない場合 (fallback)', () => {
		it('通常テキスト: カーソルが中間にある場合、行末に setCursor が呼ばれる', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('hello world', 3)
			plugin.moveCursorEndNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 11 })
		})

		it('カーソルが行頭 (ch=0) にある場合、行末に setCursor が呼ばれる', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('hello', 0)
			plugin.moveCursorEndNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 5 })
		})

		it('カーソルがすでに行末にある場合、setCursor は呼ばれない', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('hello', 5)
			plugin.moveCursorEndNonTable(editor)
			expect(mockSetCursor).not.toHaveBeenCalled()
		})

		it('空行: カーソルが ch=0 かつ line.length=0 なので setCursor は呼ばれない', () => {
			const { editor, mockSetCursor } = makeEditorWithoutCm('', 0)
			plugin.moveCursorEndNonTable(editor)
			expect(mockSetCursor).not.toHaveBeenCalled()
		})

		it('マルチバイト文字の行: ch が文字数未満なら行末に移動する', () => {
			// 'あいう' は JS 上 length=3
			const { editor, mockSetCursor } = makeEditorWithoutCm('あいう', 1)
			plugin.moveCursorEndNonTable(editor)
			expect(mockSetCursor).toHaveBeenCalledWith({ line: 0, ch: 3 })
		})
	})
})
