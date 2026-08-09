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
		cm: { state: { selection: { main: { head: 0 } } }, dispatch: vi.fn() },
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
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)
	})

	it('forward: from a word start, lands right after that word', () => {
		const editor = makeEditor(['foo bar'], 0, 0)
		plugin.moveCursorWordPlainText(editor, true)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 3)
	})

	it('same-line landing does not request a scroll (already on-screen)', () => {
		const editor = makeEditor(['foo bar'], 0, 0)
		plugin.moveCursorWordPlainText(editor, true)
		expect(editor.cm.dispatch).not.toHaveBeenCalled()
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

	it('a cross-line landing requests a scroll-into-view follow-up (may land off-screen)', () => {
		const editor = makeEditor(['foo', 'bar'], 0, 3)
		plugin.moveCursorWordPlainText(editor, true)
		expect(editor.cm.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ scrollIntoView: true }),
		)
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

	it('forward: reaches a table row — enters it via landInRowEdgeCellForWord, applying the +1 caret correction', () => {
		plugin.isPositionInTable = vi.fn((_e: any, line: number) => line === 1)
		plugin.landInRowEdgeCellForWord = vi.fn().mockReturnValue({ line: 1, ch: 3 })
		const editor = makeEditor(['foo', '| bar |'], 0, 3)
		plugin.moveCursorWordPlainText(editor, true)
		expect(plugin.landInRowEdgeCellForWord).toHaveBeenCalledWith(editor, 1, true, false, true)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 1, 4)
		expect(editor.cm.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ scrollIntoView: true }),
		)
	})

	it('backward: reaches a table row — enters it via landInRowEdgeCellForWord, no correction', () => {
		plugin.isPositionInTable = vi.fn((_e: any, line: number) => line === 0)
		plugin.landInRowEdgeCellForWord = vi.fn().mockReturnValue({ line: 0, ch: 5 })
		const editor = makeEditor(['| foo |', 'bar'], 1, 0)
		plugin.moveCursorWordPlainText(editor, false)
		expect(plugin.landInRowEdgeCellForWord).toHaveBeenCalledWith(editor, 0, false, false, false)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
	})

	it('forward: a failed table-entry landing (null) does not crash and issues no correction', () => {
		plugin.isPositionInTable = vi.fn((_e: any, line: number) => line === 1)
		plugin.landInRowEdgeCellForWord = vi.fn().mockReturnValue(null)
		const editor = makeEditor(['foo', '| bar |'], 0, 3)
		expect(() => plugin.moveCursorWordPlainText(editor, true)).not.toThrow()
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
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
		plugin.isPositionInTable = vi.fn().mockReturnValue(true) // landing stays inside the table by default
		plugin.moveCursorWordPlainText = vi.fn()
	})

	it('forward: applies a +1 caret correction on top of crossTableRowForWord\'s landing', () => {
		plugin.crossTableRowForWord = vi.fn().mockReturnValue({ line: 1, ch: 3 })
		const editor = makeEditor([LINE, '| next row here |'], 0, 5)
		plugin.moveCursorWordInTable(editor, true)
		expect(plugin.crossTableRowForWord).toHaveBeenCalledWith(editor, 0, true, false, true)
		expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 1, 4)
		expect(plugin.moveCursorWordPlainText).not.toHaveBeenCalled()
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
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)
		plugin.moveCursorWordPlainText = vi.fn()
		const editor = makeEditor([LINE], 0, 5)
		expect(() => plugin.moveCursorWordInTable(editor, true)).not.toThrow()
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		expect(plugin.moveCursorWordPlainText).not.toHaveBeenCalled()
	})

	// Vim's own w/b/e (crossTableRowForWord/exitTableWithWord/refineWordLanding)
	// deliberately stay untouched — real vim treats a blank line as a word in
	// its own right, so stopping there is correct for Vim. Real Emacs has no
	// such convention, so moveCursorWordInTable hands off to
	// moveCursorWordPlainText's own continuation search as a purely additive
	// post-processing step, only when the shared landing exited the table
	// onto a genuinely wordless line.
	describe('exiting onto a blank line — Emacs-only continuation (Vim\'s own w/b/e is untouched)', () => {
		it('forward: continues the search via moveCursorWordPlainText', () => {
			plugin.crossTableRowForWord = vi.fn().mockReturnValue({ line: 1, ch: 0 })
			plugin.isPositionInTable = vi.fn().mockReturnValue(false)
			plugin.moveCursorWordPlainText = vi.fn()
			const editor = makeEditor([LINE, ''], 0, 5)
			plugin.moveCursorWordInTable(editor, true)
			expect(plugin.moveCursorWordPlainText).toHaveBeenCalledWith(editor, true)
		})

		it('backward: continues the search via moveCursorWordPlainText', () => {
			plugin.crossTableRowForWord = vi.fn().mockReturnValue({ line: 0, ch: 0 })
			plugin.isPositionInTable = vi.fn().mockReturnValue(false)
			plugin.moveCursorWordPlainText = vi.fn()
			const editor = makeEditor(['', LINE], 1, 2)
			plugin.moveCursorWordInTable(editor, false)
			expect(plugin.moveCursorWordPlainText).toHaveBeenCalledWith(editor, false)
		})

		it('does not continue when the exited-to line already has real content', () => {
			plugin.crossTableRowForWord = vi.fn().mockReturnValue({ line: 1, ch: 0 })
			plugin.isPositionInTable = vi.fn().mockReturnValue(false)
			plugin.moveCursorWordPlainText = vi.fn()
			const editor = makeEditor([LINE, 'plain text here'], 0, 5)
			plugin.moveCursorWordInTable(editor, true)
			expect(plugin.moveCursorWordPlainText).not.toHaveBeenCalled()
		})

		it('does not continue when the landing is still inside the table', () => {
			plugin.crossTableRowForWord = vi.fn().mockReturnValue({ line: 1, ch: 3 })
			plugin.isPositionInTable = vi.fn().mockReturnValue(true)
			plugin.moveCursorWordPlainText = vi.fn()
			const editor = makeEditor([LINE, '| next row here |'], 0, 5)
			plugin.moveCursorWordInTable(editor, true)
			expect(plugin.moveCursorWordPlainText).not.toHaveBeenCalled()
		})

		// Real-world confirmed cases (manually verified in-app): a table
		// sitting at the very start/end of the document, and two tables
		// separated only by blank lines.

		it('table at the document start: backward exit is itself a no-op (setCursorToPrevRow has nowhere to go) — stays put, no continuation', () => {
			// setCursorToPrevRow's own no-op leaves the cursor exactly where it
			// started, still inside the table — crossTableRowForWord's landing
			// reflects that unchanged position.
			plugin.crossTableRowForWord = vi.fn().mockReturnValue({ line: 0, ch: 2 })
			plugin.isPositionInTable = vi.fn().mockReturnValue(true)
			plugin.moveCursorWordPlainText = vi.fn()
			const editor = makeEditor([LINE], 0, 2)
			plugin.moveCursorWordInTable(editor, false)
			expect(plugin.moveCursorWordPlainText).not.toHaveBeenCalled()
		})

		it('table at the document end: forward exit lands on a freshly-inserted blank EOF line — hands off the same as any other wordless exit', () => {
			// setCursorToNextRow's own EOF-newline-insertion is what produces
			// this blank last line in the first place; from moveCursorWordInTable's
			// own perspective it's indistinguishable from any other wordless
			// exit landing, so the same hand-off applies. moveCursorWordPlainText's
			// own behavior when there's truly nothing further (document end) is
			// covered separately by its own "at the document end" test above.
			plugin.crossTableRowForWord = vi.fn().mockReturnValue({ line: 1, ch: 0 })
			plugin.isPositionInTable = vi.fn().mockReturnValue(false)
			plugin.moveCursorWordPlainText = vi.fn()
			const editor = makeEditor([LINE, ''], 0, 5)
			plugin.moveCursorWordInTable(editor, true)
			expect(plugin.moveCursorWordPlainText).toHaveBeenCalledWith(editor, true)
		})

		// Note: moveCursorWordPlainText is mocked here (rather than letting the
		// real implementation run a second hop to the far table) because this
		// lightweight editor mock's getCursor() is static — it can't reflect
		// the real post-exit cursor position the way the live app does. The
		// far table's own landing logic is already covered by
		// moveCursorWordPlainText's own "reaches a table row" tests above;
		// what matters here is only that moveCursorWordInTable hands off
		// correctly on this exact table~blank~table shape.
		it('table ~ blank line(s) ~ table: hands off on the near table\'s exit — the far table\'s own landing is moveCursorWordPlainText\'s job', () => {
			plugin.crossTableRowForWord = vi.fn().mockReturnValue({ line: 1, ch: 0 }) // exits table 1 onto the blank line
			plugin.isPositionInTable = vi.fn().mockReturnValue(false) // the immediate landing (blank line) is not a table
			plugin.moveCursorWordPlainText = vi.fn()
			const editor = makeEditor([LINE, '', '| table two |'], 0, 5)
			plugin.moveCursorWordInTable(editor, true)
			expect(plugin.moveCursorWordPlainText).toHaveBeenCalledWith(editor, true)
		})
	})
})
