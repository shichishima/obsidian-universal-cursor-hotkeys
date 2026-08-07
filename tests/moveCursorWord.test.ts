import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// Alt-F/Alt-B (word-right/word-left). moveCursorWordPlainText is exercised
// against real getWordSpans/findWordSpanOnLine (no mocking needed — it's
// pure line-text scanning). moveCursorWordInTable's own in-cell/in-segment
// search is likewise exercised for real; only crossTableRowForWord (a
// separate, already-tested piece of machinery shared with Vim's w/b/e) is
// mocked, to isolate the caret "+1" correction this file's own code adds on
// top of it (see main.ts's own comment on why: crossTableRowForWord lands
// using vim's block-cursor word-end convention, one char short of where an
// Emacs caret should rest).

function makeEditor(lines: string[], cursorLine: number, cursorCh: number, inTableCell = false) {
	return {
		getCursor: vi.fn(() => ({ line: cursorLine, ch: cursorCh })),
		getLine: vi.fn((n: number) => lines[n] ?? ''),
		lineCount: vi.fn(() => lines.length),
		inTableCell,
	}
}

describe('moveCursorWord — dispatcher', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.moveCursorWordInTable = vi.fn()
		plugin.moveCursorWordPlainText = vi.fn()
	})

	it('routes to moveCursorWordInTable when inTableCell', () => {
		const editor = makeEditor(['foo'], 0, 0, true)
		plugin.moveCursorWord(editor, true)
		expect(plugin.moveCursorWordInTable).toHaveBeenCalledWith(editor, true)
		expect(plugin.moveCursorWordPlainText).not.toHaveBeenCalled()
	})

	it('routes to moveCursorWordPlainText otherwise', () => {
		const editor = makeEditor(['foo'], 0, 0, false)
		plugin.moveCursorWord(editor, false)
		expect(plugin.moveCursorWordPlainText).toHaveBeenCalledWith(editor, false)
		expect(plugin.moveCursorWordInTable).not.toHaveBeenCalled()
	})
})

describe('moveCursorWordPlainText', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.setCursorViaCm = vi.fn()
	})

	it('forward: from a word start, lands right after that word', () => {
		const editor = makeEditor(['foo bar'], 0, 0)
		plugin.moveCursorWordPlainText(editor, true)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 3)
	})

	it('forward: from right after a word, skips to the end of the next word', () => {
		const editor = makeEditor(['foo bar'], 0, 3)
		plugin.moveCursorWordPlainText(editor, true)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 7)
	})

	it('backward: from end of buffer, lands at the start of the nearest word', () => {
		const editor = makeEditor(['foo bar'], 0, 7)
		plugin.moveCursorWordPlainText(editor, false)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 4)
	})

	it('backward: from a word start, skips to the start of the previous word', () => {
		const editor = makeEditor(['foo bar'], 0, 4)
		plugin.moveCursorWordPlainText(editor, false)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 0)
	})

	it('forward: no more words on this line, crosses to the next line', () => {
		const editor = makeEditor(['foo', 'bar'], 0, 3)
		plugin.moveCursorWordPlainText(editor, true)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 1, 3)
	})

	it('backward: no more words on this line, crosses to the previous line', () => {
		const editor = makeEditor(['foo', 'bar'], 1, 0)
		plugin.moveCursorWordPlainText(editor, false)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 0)
	})

	it('forward: at the document end with no further word, stays put', () => {
		const editor = makeEditor(['foo bar'], 0, 7)
		plugin.moveCursorWordPlainText(editor, true)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
	})

	it('backward: at the document start with no earlier word, stays put', () => {
		const editor = makeEditor(['foo bar'], 0, 0)
		plugin.moveCursorWordPlainText(editor, false)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
	})

	it('skips blank lines while crossing forward', () => {
		const editor = makeEditor(['foo', '', '', 'bar'], 0, 3)
		plugin.moveCursorWordPlainText(editor, true)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 3, 3)
	})
})

describe('moveCursorWordInTable — same-cell search', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.setCursorViaCm = vi.fn()
		plugin.crossTableRowForWord = vi.fn()
	})

	// '| foo bar |'
	//  0123456789 0
	//  cell content 'foo bar' at [2,9)
	const LINE = '| foo bar |'

	it('forward: from cell start, lands right after the first word', () => {
		const editor = makeEditor([LINE], 0, 2)
		plugin.moveCursorWordInTable(editor, true)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 5)
		expect(plugin.crossTableRowForWord).not.toHaveBeenCalled()
	})

	it('forward: from right after the first word, lands after the second word', () => {
		const editor = makeEditor([LINE], 0, 5)
		plugin.moveCursorWordInTable(editor, true)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 9)
		expect(plugin.crossTableRowForWord).not.toHaveBeenCalled()
	})

	it('backward: from cell end, lands at the start of the last word', () => {
		const editor = makeEditor([LINE], 0, 9)
		plugin.moveCursorWordInTable(editor, false)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 6)
		expect(plugin.crossTableRowForWord).not.toHaveBeenCalled()
	})

	// '| foo<br>bar |' — one cell, two <br>-segments: "foo" at [2,5), "bar" at [9,12)
	const BR_LINE = '| foo<br>bar |'

	it('forward: exhausts the first segment, walks to the next segment in the same cell', () => {
		const editor = makeEditor([BR_LINE], 0, 5) // right after "foo", at the <br> boundary
		plugin.moveCursorWordInTable(editor, true)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 12)
		expect(plugin.crossTableRowForWord).not.toHaveBeenCalled()
	})

	it('backward: exhausts the last segment, walks back to the previous segment in the same cell', () => {
		const editor = makeEditor([BR_LINE], 0, 9) // start of "bar"
		plugin.moveCursorWordInTable(editor, false)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 2)
		expect(plugin.crossTableRowForWord).not.toHaveBeenCalled()
	})
})

describe('moveCursorWordInTable — cell/row crossing', () => {
	let plugin: any

	// '| foo |' — single-segment cell, content "foo" at [2,5).
	const LINE = '| foo |'

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.setCursorViaCm = vi.fn()
	})

	it('forward: applies a +1 caret correction on top of crossTableRowForWord\'s landing', () => {
		plugin.crossTableRowForWord = vi.fn().mockReturnValue({ line: 1, ch: 3 })
		const editor = makeEditor([LINE, '| next row here |'], 0, 5)
		plugin.moveCursorWordInTable(editor, true)
		expect(plugin.crossTableRowForWord).toHaveBeenCalledWith(editor, 0, true, false, true)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 1, 4)
	})

	it('backward: no correction — crossTableRowForWord\'s own landing is used as-is', () => {
		plugin.crossTableRowForWord = vi.fn().mockReturnValue({ line: 1, ch: 5 })
		const editor = makeEditor([LINE, '| prev row here |'], 0, 2)
		plugin.moveCursorWordInTable(editor, false)
		expect(plugin.crossTableRowForWord).toHaveBeenCalledWith(editor, 0, false, false, false)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
	})

	it('a failed crossing (null landing) does not crash and issues no correction', () => {
		plugin.crossTableRowForWord = vi.fn().mockReturnValue(null)
		const editor = makeEditor([LINE], 0, 5)
		expect(() => plugin.moveCursorWordInTable(editor, true)).not.toThrow()
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
	})
})
