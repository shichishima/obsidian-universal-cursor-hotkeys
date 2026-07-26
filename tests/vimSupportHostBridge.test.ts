import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// main.ts's VimSupportHost bridge implementation (crossTableRowForCell,
// enterTableAtLine, and the walkTableRows/exitTableWithColumn/
// landInCellSegment/walkSegments/countCellSegments helpers they share), plus
// the getNextRowLine/PrevRowLine/setCursorToNextRow/PrevRow fromLine
// parameterization that makes the multi-row walk possible.

function makeStatefulEditor(lines: string[], initialCursor: { line: number; ch: number }) {
	const buf = [...lines]
	let cursor = initialCursor
	return {
		getCursor: vi.fn(() => cursor),
		getLine: vi.fn((n: number) => buf[n] ?? ''),
		lineCount: vi.fn(() => buf.length),
		replaceRange: vi.fn((_text: string, from: any) => {
			buf.splice(from.line + 1, 0, '')
		}),
		// Only used directly by jumpToDocumentLine's own scroll-into-view
		// follow-up dispatch — every other landing goes through
		// plugin.setCursorViaCm, which is itself mocked out below.
		posToOffset: vi.fn((pos: { line: number; ch: number }) => pos.line * 1000 + pos.ch),
		cm: { dispatch: vi.fn() },
		_setCursor: (c: { line: number; ch: number }) => { cursor = c },
		_buf: buf,
	}
}

describe('VimSupportHost bridge (main.ts)', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.setCursorViaCm = vi.fn((editor: any, line: number, ch: number) => editor._setCursor({ line, ch }))
	})

	// ===========================================================================
	// walkSegments (pure)
	// ===========================================================================

	describe('walkSegments', () => {
		const LINE = '| a<br>b<br>c |'

		it('walks forward through all segments, capped by maxSteps', () => {
			const seg0 = { lineType: 'first', startOfInCellLine: 2, endOfInCellLine: 3, isEmpty: false }
			const result = plugin.walkSegments(LINE, seg0, true, 1)
			expect(result.steps).toBe(1)
			expect(result.segInfo.lineType).toBe('middle')
		})

		it('stops early when it runs out of segments (steps < maxSteps)', () => {
			const seg0 = { lineType: 'first', startOfInCellLine: 2, endOfInCellLine: 3, isEmpty: false }
			const result = plugin.walkSegments(LINE, seg0, true, Infinity)
			expect(result.steps).toBe(2) // first -> middle -> last
			expect(result.segInfo.lineType).toBe('last')
		})

		it('walks backward toward the first segment', () => {
			const segLast = { lineType: 'last', startOfInCellLine: 12, endOfInCellLine: 13, isEmpty: false }
			const result = plugin.walkSegments(LINE, segLast, false, Infinity)
			expect(result.steps).toBe(2)
			expect(result.segInfo.lineType).toBe('first')
		})

		it('a single-segment cell cannot walk in either direction', () => {
			const seg = { lineType: 'single', startOfInCellLine: 2, endOfInCellLine: 7, isEmpty: false }
			expect(plugin.walkSegments('| hello |', seg, true, Infinity).steps).toBe(0)
			expect(plugin.walkSegments('| hello |', seg, false, Infinity).steps).toBe(0)
		})
	})

	// ===========================================================================
	// countCellSegments (pure)
	// ===========================================================================

	describe('countCellSegments', () => {
		it('counts 1 for a single-segment cell', () => {
			expect(plugin.countCellSegments('| hello | world |', 0)).toBe(1)
		})

		it('counts <br>-segments correctly', () => {
			expect(plugin.countCellSegments('| a<br>b<br>c | x |', 0)).toBe(3)
			expect(plugin.countCellSegments('| a<br>b | x |', 0)).toBe(2)
		})

		it('clamps cellIndex to the rightmost column', () => {
			// Only 2 columns (index 0-1); asking for index 5 clamps to 1.
			expect(plugin.countCellSegments('| a<br>b | c<br>d<br>e |', 5)).toBe(3)
		})

		it('returns 0 when the cell cannot be found', () => {
			expect(plugin.countCellSegments('no pipes here', 0)).toBe(0)
		})
	})

	// ===========================================================================
	// landInCellSegment
	// ===========================================================================

	describe('landInCellSegment', () => {
		it('forward (segmentOffset=0) lands on the first segment', () => {
			const editor = makeStatefulEditor(['| a<br>b<br>c |'], { line: 0, ch: 0 })
			const result = plugin.landInCellSegment(editor, 0, 0, true, 0, 0)
			expect(result).toEqual({ line: 0, ch: 2 }) // 'a' at ch 2
		})

		it('backward (segmentOffset=0) lands on the last segment', () => {
			const editor = makeStatefulEditor(['| a<br>b<br>c |'], { line: 0, ch: 0 })
			const result = plugin.landInCellSegment(editor, 0, 0, false, 0, 0)
			expect(result).toEqual({ line: 0, ch: 12 }) // 'c'
		})

		it('walks segmentOffset further steps toward the opposite edge', () => {
			const editor = makeStatefulEditor(['| a<br>b<br>c |'], { line: 0, ch: 0 })
			const forward1 = plugin.landInCellSegment(editor, 0, 0, true, 1, 0)
			expect(forward1).toEqual({ line: 0, ch: 7 }) // 'b'
			const backward1 = plugin.landInCellSegment(editor, 0, 0, false, 1, 0)
			expect(backward1).toEqual({ line: 0, ch: 7 }) // 'b', walking back from 'c'
		})

		it('clamps the requested cellIndex to the row\'s rightmost cell without touching the caller\'s value', () => {
			// Only 1 column; cellIndex 3 clamps to 0.
			const editor = makeStatefulEditor(['| only |'], { line: 0, ch: 0 })
			const result = plugin.landInCellSegment(editor, 0, 3, true, 0, 0)
			expect(result).toEqual({ line: 0, ch: 2 })
		})

		it('clamps goalCh to the segment\'s own normal-mode-legal max (length - 1)', () => {
			const editor = makeStatefulEditor(['| ab |'], { line: 0, ch: 0 })
			const result = plugin.landInCellSegment(editor, 0, 0, true, 0, 99)
			expect(result).toEqual({ line: 0, ch: 3 }) // 'ab' -> max offset 1 -> ch 2+1=3
		})

		it('returns null when the cell cannot be found', () => {
			const editor = makeStatefulEditor(['no pipes'], { line: 0, ch: 0 })
			expect(plugin.landInCellSegment(editor, 0, 0, true, 0, 0)).toBeNull()
		})
	})

	// ===========================================================================
	// getNextRowLine / getPrevRowLine / setCursorToNextRow / setCursorToPrevRow —
	// fromLine parameterization regression. Bug: multi-row crossing computed a
	// walked-to position (fromLine) but the exit-table fallback ignored it,
	// re-deriving "next row" from the *live* cursor (which hadn't moved yet),
	// collapsing any multi-row walk back into a single-row one.
	// ===========================================================================

	describe('fromLine parameterization', () => {
		const ROWS = ['| row0 |', '| row1 |', '| row2 |']

		it('getNextRowLine defaults to the live cursor when fromLine is omitted', () => {
			const editor = makeStatefulEditor(ROWS, { line: 0, ch: 0 })
			expect(plugin.getNextRowLine(editor)).toBe(1)
		})

		it('getNextRowLine uses an explicit fromLine instead of the live cursor', () => {
			// Live cursor is still at line 0, but the walk has conceptually
			// already advanced to line 1 — fromLine must be respected.
			const editor = makeStatefulEditor(ROWS, { line: 0, ch: 0 })
			expect(plugin.getNextRowLine(editor, 1)).toBe(2)
		})

		it('getPrevRowLine uses an explicit fromLine instead of the live cursor', () => {
			const editor = makeStatefulEditor(ROWS, { line: 2, ch: 0 })
			expect(plugin.getPrevRowLine(editor, 1)).toBe(0)
		})

		it('setCursorToNextRow\'s exit branch uses fromLine, not the live cursor, to find the exit line', () => {
			// Live cursor sits at line 0 (as if the real cursor never moved during
			// a multi-row walk), but fromLine says we've conceptually reached the
			// last row (line 2) — exit should happen from there, landing on line 3.
			const editor = makeStatefulEditor([...ROWS, 'plain text after'], { line: 0, ch: 0 })
			plugin.setCursorToNextRow(editor, 0, 2)
			expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 3, 0)
		})

		it('setCursorToPrevRow\'s exit branch uses fromLine, not the live cursor', () => {
			const editor = makeStatefulEditor(['plain text before', ...ROWS], { line: 3, ch: 0 })
			plugin.setCursorToPrevRow(editor, 0, 1) // fromLine=1 is the header (first) row
			expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 0)
		})
	})

	// ===========================================================================
	// exitTableWithColumn
	// ===========================================================================

	describe('exitTableWithColumn', () => {
		it('exits below and corrects the column to goalCh (clamped to the exit line\'s length)', () => {
			const editor = makeStatefulEditor(['| row |', 'short'], { line: 0, ch: 0 })
			const result = plugin.exitTableWithColumn(editor, 0, true, 3, 0)
			// setCursorToNextRow's own exit lands at ch=0; exitTableWithColumn then
			// corrects it to goalCh=3, clamped to 'short'.length-1=4 (no clamp needed).
			expect(result).toEqual({ line: 1, ch: 3 })
		})

		it('clamps goalCh to the exit line\'s own max when it\'s shorter', () => {
			const editor = makeStatefulEditor(['| row |', 'ab'], { line: 0, ch: 0 })
			const result = plugin.exitTableWithColumn(editor, 0, true, 10, 0)
			expect(result).toEqual({ line: 1, ch: 1 }) // 'ab'.length-1 = 1
		})

		it('exits above via setCursorToPrevRow when forward=false', () => {
			const editor = makeStatefulEditor(['above', '| row |'], { line: 1, ch: 0 })
			const result = plugin.exitTableWithColumn(editor, 0, false, 2, 1)
			expect(result).toEqual({ line: 0, ch: 2 })
		})
	})

	// ===========================================================================
	// walkTableRows (shared multi-row walk)
	// ===========================================================================

	describe('walkTableRows', () => {
		it('lands within the starting row when remaining fits its own segment count', () => {
			const editor = makeStatefulEditor(['| a<br>b<br>c |'], { line: 0, ch: 0 })
			const result = plugin.walkTableRows(editor, 0, true, 0, 2, 0)
			expect(result).toEqual({ line: 0, ch: 7 }) // segment 'b' (offset 1)
		})

		it('walks across multiple rows with differing segment counts', () => {
			const editor = makeStatefulEditor(
				['| a<br>b |', '| c |', '| d<br>e<br>f |'],
				{ line: 0, ch: 0 },
			)
			// remaining=4: row0 has 2 segments (consumes 2, remaining=2),
			// row1 has 1 segment (consumes 1, remaining=1), row2 (3 segments)
			// gets the final remaining=1 -> lands on its first segment 'd'.
			const result = plugin.walkTableRows(editor, 0, true, 0, 4, 0)
			expect(result).toEqual({ line: 2, ch: 2 })
		})

		it('exits the table via exitTableWithColumn when it runs out of rows', () => {
			const editor = makeStatefulEditor(['| only |', 'plain after'], { line: 0, ch: 0 })
			const result = plugin.walkTableRows(editor, 0, true, 0, 5, 3)
			expect(result).toEqual({ line: 1, ch: 3 })
		})
	})

	// ===========================================================================
	// crossTableRowForCell
	// ===========================================================================

	describe('crossTableRowForCell', () => {
		it('crosses into the next row directly (single-row crossing)', () => {
			const editor = makeStatefulEditor(['| a |', '| b |'], { line: 0, ch: 0 })
			const result = plugin.crossTableRowForCell(editor, 0, true, 0, 1)
			expect(result).toEqual({ line: 1, ch: 2 })
		})

		it('exits immediately when there is no next row at all', () => {
			const editor = makeStatefulEditor(['| only |', 'after'], { line: 0, ch: 0 })
			const result = plugin.crossTableRowForCell(editor, 0, true, 1, 1)
			expect(result).toEqual({ line: 1, ch: 1 })
		})

		it('multi-row crossing (overshoot > 1) walks through multiple rows', () => {
			const editor = makeStatefulEditor(['| a |', '| b |', '| c |'], { line: 0, ch: 0 })
			const result = plugin.crossTableRowForCell(editor, 0, true, 0, 2)
			expect(result).toEqual({ line: 2, ch: 2 })
		})
	})

	// ===========================================================================
	// enterTableAtLine
	// ===========================================================================

	describe('enterTableAtLine', () => {
		it('lands on the target line\'s own segment per remaining', () => {
			const editor = makeStatefulEditor(['| a<br>b |'], { line: 0, ch: 0 })
			const result = plugin.enterTableAtLine(editor, 0, 0, true, 0, 2)
			expect(result).toEqual({ line: 0, ch: 7 }) // 'b' (remaining=2 -> segmentOffset=1)
		})

		it('walks into subsequent rows when remaining exceeds the target row\'s own segments', () => {
			const editor = makeStatefulEditor(['| a |', '| b<br>c |'], { line: 0, ch: 0 })
			const result = plugin.enterTableAtLine(editor, 0, 0, true, 0, 2)
			expect(result).toEqual({ line: 1, ch: 2 }) // row0 consumes 1, row1 lands on 'b'
		})

		it('defensive fallback: redirects off a delimiter row (forward -> next line)', () => {
			const editor = makeStatefulEditor(['| --- |', '| data |'], { line: 0, ch: 0 })
			const result = plugin.enterTableAtLine(editor, 0, 0, true, 0, 1)
			expect(result).toEqual({ line: 1, ch: 2 })
		})

		it('defensive fallback: redirects off a delimiter row (backward -> previous line)', () => {
			const editor = makeStatefulEditor(['| header |', '| --- |'], { line: 1, ch: 0 })
			const result = plugin.enterTableAtLine(editor, 1, 0, false, 0, 1)
			expect(result).toEqual({ line: 0, ch: 2 })
		})

		it('returns null when the delimiter redirect has nowhere valid to land', () => {
			const editor = makeStatefulEditor(['| --- |'], { line: 0, ch: 0 })
			expect(plugin.enterTableAtLine(editor, 0, 0, false, 0, 1)).toBeNull()
		})
	})

	// ===========================================================================
	// isLinePartOfTable
	// ===========================================================================

	describe('isLinePartOfTable', () => {
		it('delegates to isPositionInTable', () => {
			plugin.isPositionInTable = vi.fn().mockReturnValue(true)
			const editor = {}
			expect(plugin.isLinePartOfTable(editor, 3, 1)).toBe(true)
			expect(plugin.isPositionInTable).toHaveBeenCalledWith(editor, 3, 1)
		})
	})

	// ===========================================================================
	// jumpToDocumentLine (Vim gg/G)
	// ===========================================================================

	describe('jumpToDocumentLine', () => {
		beforeEach(() => {
			plugin.settings = { smartHomeStandard: false }
		})

		it('lands at the smart position on a non-table target line (smartHomeStandard off -> vim-native whitespace skip)', () => {
			const editor = makeStatefulEditor(['first', '  middle', 'last'], { line: 0, ch: 0 })
			plugin.isPositionInTable = vi.fn().mockReturnValue(false)
			const result = plugin.jumpToDocumentLine(editor, true, 1)
			expect(result).toEqual({ line: 1, ch: 2 })
		})

		it('uses getBeginningOfLinePosition when smartHomeStandard is on', () => {
			plugin.settings = { smartHomeStandard: true }
			plugin.getBeginningOfLinePosition = vi.fn().mockReturnValue(4)
			const editor = makeStatefulEditor(['first', '- list item', 'last'], { line: 0, ch: 0 })
			plugin.isPositionInTable = vi.fn().mockReturnValue(false)
			const result = plugin.jumpToDocumentLine(editor, true, 1)
			expect(plugin.getBeginningOfLinePosition).toHaveBeenCalledWith('- list item', '- list item'.length)
			expect(result).toEqual({ line: 1, ch: 4 })
		})

		it('follows up with a scrollIntoView dispatch after landing', () => {
			const editor = makeStatefulEditor(['first', '  middle', 'last'], { line: 0, ch: 0 })
			plugin.isPositionInTable = vi.fn().mockReturnValue(false)
			plugin.jumpToDocumentLine(editor, true, 1)
			expect(editor.cm.dispatch).toHaveBeenCalledWith(
				expect.objectContaining({ scrollIntoView: true }),
			)
		})

		it('reuses enterTableAtLine when the target line is a table row', () => {
			const editor = makeStatefulEditor(['plain', '| a |'], { line: 0, ch: 0 })
			plugin.isPositionInTable = vi.fn().mockReturnValue(true)
			const result = plugin.jumpToDocumentLine(editor, true, 1)
			expect(result).toEqual({ line: 1, ch: 2 })
		})

		it('"2G" and "2gg" land identically when the target is a delimiter row', () => {
			// Regression: enterTableAtLine's own forward param controls which
			// way a delimiter-row landing redirects (next row vs previous) —
			// jumpToDocumentLine used to pass the *keystroke's* own forward
			// (G=true, gg=false) straight through, so "2G"/"2gg" (which target
			// the identical absolute line) landed in different places. gg/G's
			// own landing is always "start of content" regardless of
			// direction, so this must always redirect forward regardless of
			// which key was actually pressed.
			plugin.isPositionInTable = vi.fn().mockReturnValue(true)
			const editorForG = makeStatefulEditor(['| header |', '| --- |', '| data |'], { line: 0, ch: 0 })
			const resultG = plugin.jumpToDocumentLine(editorForG, true, 1) // "2G"
			const editorForGg = makeStatefulEditor(['| header |', '| --- |', '| data |'], { line: 0, ch: 0 })
			const resultGg = plugin.jumpToDocumentLine(editorForGg, false, 1) // "2gg"
			expect(resultG).toEqual({ line: 2, ch: 2 }) // redirected to the data row
			expect(resultGg).toEqual(resultG)
		})
	})
})
