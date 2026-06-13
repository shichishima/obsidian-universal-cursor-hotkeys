import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// Table line used in tests:
//   '| cell1 | cell2 |'
//    0123456789012345678
//   pipes at 0, 8, 17
//   cell2 content end: openPipe=8, closePipe=17
//     slice(9,17)=' cell2 ', trimEnd()=' cell2' (len=6) → endCh = 8+1+6 = 15
const TABLE_LINE = '| cell1 | cell2 |'
const TABLE_LINE_END_CH = 15  // end of cell2 content


describe('moveCursorRight — table entry from above (LP)', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.isLivePreviewMode    = vi.fn().mockReturnValue(true)
		plugin.isPositionInTable    = vi.fn().mockReturnValue(false)
		plugin.moveCursorDownIntoTable = vi.fn()
		plugin.moveToRightCellStart    = vi.fn()
	})

	function makeEditor(lineText: string, ch: number, inTableCell = false, nextLineText = TABLE_LINE) {
		return {
			getCursor: vi.fn(() => ({ line: 0, ch })),
			getLine:   vi.fn((n: number) => n === 0 ? lineText : nextLineText),
			exec:      vi.fn(),
			inTableCell,
		}
	}

	it('at line end above table → calls moveCursorDownIntoTable', () => {
		const line = 'text above'
		plugin.isPositionInTable.mockImplementation((_e: any, l: number) => l === 1)
		const editor = makeEditor(line, line.length)
		plugin.moveCursorRight(editor)
		expect(plugin.moveCursorDownIntoTable).toHaveBeenCalledWith(editor)
		expect(editor.exec).not.toHaveBeenCalled()
	})

	it('not at line end → falls through to goRight', () => {
		const line = 'text above'
		plugin.isPositionInTable.mockImplementation((_e: any, l: number) => l === 1)
		const editor = makeEditor(line, 3)
		plugin.moveCursorRight(editor)
		expect(plugin.moveCursorDownIntoTable).not.toHaveBeenCalled()
		expect(editor.exec).toHaveBeenCalledWith('goRight')
	})

	it('next line is not a table → falls through to goRight', () => {
		const line = 'text above'
		const editor = makeEditor(line, line.length)
		plugin.moveCursorRight(editor)
		expect(plugin.moveCursorDownIntoTable).not.toHaveBeenCalled()
		expect(editor.exec).toHaveBeenCalledWith('goRight')
	})

	it('source mode → falls through to goRight regardless', () => {
		plugin.isLivePreviewMode.mockReturnValue(false)
		plugin.isPositionInTable.mockImplementation((_e: any, l: number) => l === 1)
		const line = 'text above'
		const editor = makeEditor(line, line.length)
		plugin.moveCursorRight(editor)
		expect(plugin.moveCursorDownIntoTable).not.toHaveBeenCalled()
		expect(editor.exec).toHaveBeenCalledWith('goRight')
	})
})


describe('moveCursorLeft — table entry from below (LP)', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.isLivePreviewMode = vi.fn().mockReturnValue(true)
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)
		plugin.setCursorViaCm    = vi.fn()
		plugin.moveToLeftCellEnd = vi.fn()
	})

	function makeEditor(lines: string[], cursorLine: number, cursorCh: number, inTableCell = false) {
		return {
			getCursor: vi.fn(() => ({ line: cursorLine, ch: cursorCh })),
			getLine:   vi.fn((n: number) => lines[n] ?? ''),
			exec:      vi.fn(),
			inTableCell,
		}
	}

	it('at ch=0 below table → calls setCursorViaCm at rightmost cell end', () => {
		plugin.isPositionInTable.mockImplementation((_e: any, l: number) => l === 0)
		const editor = makeEditor([TABLE_LINE, 'line below'], 1, 0)
		plugin.moveCursorLeft(editor)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, TABLE_LINE_END_CH)
		expect(editor.exec).not.toHaveBeenCalled()
	})

	it('ch > 0 → falls through to goLeft', () => {
		plugin.isPositionInTable.mockImplementation((_e: any, l: number) => l === 0)
		const editor = makeEditor([TABLE_LINE, 'line below'], 1, 3)
		plugin.moveCursorLeft(editor)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		expect(editor.exec).toHaveBeenCalledWith('goLeft')
	})

	it('previous line is not a table → falls through to goLeft', () => {
		const editor = makeEditor(['plain text', 'line below'], 1, 0)
		plugin.moveCursorLeft(editor)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		expect(editor.exec).toHaveBeenCalledWith('goLeft')
	})

	it('cursor on line 0 → falls through to goLeft', () => {
		plugin.isPositionInTable.mockReturnValue(true)
		const editor = makeEditor([TABLE_LINE], 0, 0)
		plugin.moveCursorLeft(editor)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		expect(editor.exec).toHaveBeenCalledWith('goLeft')
	})

	it('source mode → falls through to goLeft regardless', () => {
		plugin.isLivePreviewMode.mockReturnValue(false)
		plugin.isPositionInTable.mockImplementation((_e: any, l: number) => l === 0)
		const editor = makeEditor([TABLE_LINE, 'line below'], 1, 0)
		plugin.moveCursorLeft(editor)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		expect(editor.exec).toHaveBeenCalledWith('goLeft')
	})
})
