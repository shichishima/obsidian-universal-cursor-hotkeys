import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// ---------------------------------------------------------------------------
// Minimal editor mock
// ---------------------------------------------------------------------------

function makeEditor(lines: string[], cursorLine: number, cursorCh: number) {
	const setCursor = vi.fn()
	return {
		getCursor: vi.fn(() => ({ line: cursorLine, ch: cursorCh })),
		getLine:   vi.fn((line: number) => lines[line] ?? ''),
		lineCount: vi.fn(() => lines.length),
		setCursor,
		replaceRange: vi.fn(),
	}
}


describe('Source Mode HOME/END table navigation', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.settings = {
			smartHomeStandard: true,
			smartHomeAdvanced: true,
			visualLineMovement: true,
			crossRowNavigation: true,
		}
	})

	// ===========================================================================
	// getPrevRowLineSourceMode
	// ===========================================================================

	describe('getPrevRowLineSourceMode', () => {
		// [lines, cursorLine, expected]
		const cases: [string[], number, number][] = [
			// at line 0 → always -1
			[['| a |'],                                    0, -1],
			// previous line is a regular data row → currentLine-1
			[['| h |', '| --- |', '| d1 |', '| d2 |'],   3, 2],
			// previous line is delimiter → skip 2 (currentLine-2)
			[['| h |', '| --- |', '| d |'],               2, 0],
			// header row (prev is not a table line) → -1
			[['not a table', '| header |'],               1, -1],
		]

		for (const [lines, cursorLine, expected] of cases) {
			it(`lines[${cursorLine}]="${lines[cursorLine]}" → ${expected}`, () => {
				const editor = makeEditor(lines, cursorLine, 2)
				expect(plugin.getPrevRowLineSourceMode(editor)).toBe(expected)
			})
		}
	})

	// ===========================================================================
	// getNextRowLineSourceMode
	// ===========================================================================

	describe('getNextRowLineSourceMode', () => {
		// [lines, cursorLine, expected]
		const cases: [string[], number, number][] = [
			// next line is regular data row
			[['| h |', '| --- |', '| d |', '| d2 |'], 2, 3],
			// next line is delimiter + line after exists → skip 2
			[['| h |', '| --- |', '| d |'],            0, 2],
			// next line is delimiter + no line after → -1 (header-only table)
			[['| h |', '| --- |'],                     0, -1],
			// last data row → -1
			[['| h |', '| --- |', '| d |'],            2, -1],
		]

		for (const [lines, cursorLine, expected] of cases) {
			it(`lines[${cursorLine}]="${lines[cursorLine]}" → ${expected}`, () => {
				const editor = makeEditor(lines, cursorLine, 2)
				expect(plugin.getNextRowLineSourceMode(editor)).toBe(expected)
			})
		}
	})

	// ===========================================================================
	// moveCursorHomeInTableSourceMode
	// ===========================================================================

	describe('moveCursorHomeInTableSourceMode', () => {
		// Table: '| hello |'  pipes at 0,8  startOfInCellLine=2  endOfInCellLine=7

		it('cursor past content start → moves to content start', () => {
			const editor = makeEditor(['| hello |'], 0, 5)
			plugin.moveCursorHomeInTableSourceMode(editor)
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 2 })
		})

		it('cursor at content start → moves to cell start (startOfInCellLine)', () => {
			// startOfInCellLine = 2, same as content start for plain text → cross-row
			// Use a list cell to have distinct smart-home and cell-start positions
			// '| - item |': pipes at 0,9  startOfInCellLine=2  smartHomePos=4 (after '- ')
			const editor = makeEditor(['| - item |'], 0, 4)
			plugin.moveCursorHomeInTableSourceMode(editor)
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 2 })
		})

		it('cursor at cell start (no smart home step remaining) → cross-row', () => {
			// '| a |' startOfInCellLine=2, cursor at 2 → cross-row
			const lines = ['| prev |', '| --- |', '| a |']
			const editor = makeEditor(lines, 2, 2)
			// Stub moveToLeftCellEndSourceMode to verify it's called
			plugin.moveToLeftCellEndSourceMode = vi.fn()
			plugin.moveCursorHomeInTableSourceMode(editor)
			expect(plugin.moveToLeftCellEndSourceMode).toHaveBeenCalledWith(editor)
		})
	})

	// ===========================================================================
	// moveCursorEndInTableSourceMode
	// ===========================================================================

	describe('moveCursorEndInTableSourceMode', () => {
		// '| hello |'  endOfInCellLine=7

		it('cursor at ch=0 (before first pipe) → snaps to cell 0 content start', () => {
			const editor = makeEditor(['| hello |'], 0, 0)
			plugin.moveCursorEndInTableSourceMode(editor)
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 2 })
		})

		it('cursor before content end → moves to content end', () => {
			const editor = makeEditor(['| hello |'], 0, 3)
			plugin.moveCursorEndInTableSourceMode(editor)
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 7 })
		})

		it('cursor at content end (single) → cross-row', () => {
			const lines = ['| a |', '| --- |', '| b |']
			const editor = makeEditor(lines, 0, 3)
			plugin.moveToRightCellStartSourceMode = vi.fn()
			plugin.moveCursorEndInTableSourceMode(editor)
			expect(plugin.moveToRightCellStartSourceMode).toHaveBeenCalledWith(editor)
		})

		// '| line1<br>line2 |'
		// pipes at 0,17  seg0: start=2,end=7  <br> at 7  seg1: start=11,end=16
		describe('<br> — Source Mode cursor inside <br> skips to next segment end', () => {
			const line = '| line1<br>line2 |'

			it('cursor at endOfInCellLine of first segment (br.start) → does nothing', () => {
				const editor = makeEditor([line], 0, 7)
				plugin.moveCursorEndInTableSourceMode(editor)
				expect(editor.setCursor).not.toHaveBeenCalled()
			})

			it('cursor inside <br> → jumps to next segment end', () => {
				const editor = makeEditor([line], 0, 9)  // inside '<br>'
				plugin.moveCursorEndInTableSourceMode(editor)
				expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 16 })
			})

			it('cursor at end of last segment → cross-row (no more segments)', () => {
				const lines = [line, 'after']
				const editor = makeEditor(lines, 0, 16)
				plugin.moveToRightCellStartSourceMode = vi.fn()
				plugin.moveCursorEndInTableSourceMode(editor)
				expect(plugin.moveToRightCellStartSourceMode).toHaveBeenCalledWith(editor)
			})
		})
	})

	// ===========================================================================
	// moveToLeftCellEndSourceMode — same-row and cross-row
	// ===========================================================================

	describe('moveToLeftCellEndSourceMode', () => {
		it('non-leftmost cell → moves to left cell end (same row)', () => {
			// '| a | bb |'  pipes at 0,4,9  cell0 end=3  cell1 start=6
			const editor = makeEditor(['| a | bb |'], 0, 6)
			plugin.moveToLeftCellEndSourceMode(editor)
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 3 })
		})

		it('leftmost cell, crossRowNavigation OFF → no move', () => {
			plugin.settings.crossRowNavigation = false
			const editor = makeEditor(['| a | b |'], 0, 2)
			plugin.moveToLeftCellEndSourceMode(editor)
			expect(editor.setCursor).not.toHaveBeenCalled()
		})

		it('leftmost cell (data row), crossRowNavigation ON → previous row rightmost cell end', () => {
			// line 0: header, line 1: delimiter, line 2: data
			const lines = ['| hdr |', '| --- |', '| dat |']
			const editor = makeEditor(lines, 2, 2)
			plugin.moveToLeftCellEndSourceMode(editor)
			// line 0 '| hdr |' rightmost cell end = 5
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 5 })
		})

		it('header row leftmost cell → exits table above', () => {
			const lines = ['above', '| hdr |', '| --- |', '| dat |']
			const editor = makeEditor(lines, 1, 2)
			plugin.moveToLeftCellEndSourceMode(editor)
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 0 })
		})
	})

	// ===========================================================================
	// moveToRightCellStartSourceMode — same-row and cross-row
	// ===========================================================================

	describe('moveToRightCellStartSourceMode', () => {
		it('non-rightmost cell → moves to right cell start (same row)', () => {
			// '| a | bb |'  pipes at 0,4,9  cell1 content start=6
			const editor = makeEditor(['| a | bb |'], 0, 2)
			plugin.moveToRightCellStartSourceMode(editor)
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 6 })
		})

		it('rightmost cell, crossRowNavigation OFF → no move', () => {
			plugin.settings.crossRowNavigation = false
			const editor = makeEditor(['| a | b |'], 0, 6)
			plugin.moveToRightCellStartSourceMode(editor)
			expect(editor.setCursor).not.toHaveBeenCalled()
		})

		it('rightmost cell (non-last row), crossRowNavigation ON → next row leftmost cell start', () => {
			const lines = ['| hdr |', '| --- |', '| dat |']
			const editor = makeEditor(lines, 0, 5)
			plugin.moveToRightCellStartSourceMode(editor)
			// line 2 '| dat |' leftmost cell content start = 2
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 2, ch: 2 })
		})

		it('rightmost cell (last row) → exits table below', () => {
			const lines = ['| hdr |', '| --- |', '| dat |', 'after']
			const editor = makeEditor(lines, 2, 5)
			plugin.moveToRightCellStartSourceMode(editor)
			expect(editor.setCursor).toHaveBeenCalledWith({ line: 3, ch: 0 })
		})
	})
})
