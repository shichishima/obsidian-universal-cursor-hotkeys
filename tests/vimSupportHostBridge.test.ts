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
	// findWordBoundaryOnLine (pure) — used by refineWordLanding to narrow a
	// table-crossing landing down to the nearest word. Regression: real vim
	// classifies every non-whitespace character as either a "word" char or its
	// own "punctuation" class (a punctuation run like "&" or "!!!" is its own
	// word) — the bug was treating punctuation the same as whitespace, so w
	// crossing into a cell starting with "&" skipped straight past it to the
	// next actual word instead of landing on the "&" itself.
	// ===========================================================================

	describe('findWordBoundaryOnLine', () => {
		it('forward (w): lands on a leading punctuation run, not the word after it', () => {
			expect(plugin.findWordBoundaryOnLine('&foo bar', true, false, false)).toBe(0)
		})

		it('forward (w): skips leading whitespace to land on a word', () => {
			expect(plugin.findWordBoundaryOnLine('  foo', true, false, false)).toBe(2)
		})

		it('forward (e): lands on the end of a leading punctuation run, not the word after it', () => {
			expect(plugin.findWordBoundaryOnLine('&&foo bar', true, false, true)).toBe(1)
		})

		it('forward (e): word char immediately followed by punctuation stops at the class change', () => {
			expect(plugin.findWordBoundaryOnLine('foo&bar', true, false, true)).toBe(2)
		})

		it('forward: an entirely whitespace line returns 0 (empty line is a word)', () => {
			expect(plugin.findWordBoundaryOnLine('   ', true, false, false)).toBe(0)
		})

		it('backward (b): lands on the start of a trailing punctuation run, not the word before it', () => {
			expect(plugin.findWordBoundaryOnLine('foo bar&&', false, false, false)).toBe(7)
		})

		it('backward (ge): lands on the end of the line\'s own last run, even if it\'s punctuation', () => {
			expect(plugin.findWordBoundaryOnLine('foo bar&&', false, false, true)).toBe(8)
		})

		it('bigWord (W/E/B) treats a mixed word+punctuation run as a single class', () => {
			expect(plugin.findWordBoundaryOnLine('foo&bar baz', true, true, true)).toBe(6) // e: whole "foo&bar" is one WORD
			expect(plugin.findWordBoundaryOnLine('foo&bar baz', false, true, false)).toBe(8) // b: start of "baz"
		})

		it('does not regress a plain word landing (no punctuation involved)', () => {
			expect(plugin.findWordBoundaryOnLine('foo bar', true, false, false)).toBe(0)
			expect(plugin.findWordBoundaryOnLine('foo bar', false, false, false)).toBe(4)
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

		// Regression: a real, reproducible crash — pressing k on a table's own
		// header row when that row is the document's first line. getPrevRowLine
		// unconditionally called isPositionInTable/getLine(fromLine - 1) without
		// checking fromLine > 0 first; fromLine=0 makes that -1, and
		// editor.getLine(-1) throws ("Invalid line number 0 in N-line document" —
		// CM6's own 1-indexed line() call underneath 0-indexed getLine(-1)).
		it('getPrevRowLine returns -1 (not a crash) when fromLine is the document\'s first line', () => {
			// getLine(-1) throws for real (CM6's own 1-indexed line() call
			// underneath) — mirrored here (makeStatefulEditor's own getLine just
			// returns '' out of range, which wouldn't actually exercise the guard).
			const editor = {
				getLine: vi.fn((n: number) => { if (n < 0) throw new RangeError(`Invalid line number ${n + 1} in 1-line document`); return ROWS[n] ?? '' }),
				lineCount: () => ROWS.length,
			}
			expect(() => plugin.getPrevRowLine(editor, 0)).not.toThrow()
			expect(plugin.getPrevRowLine(editor, 0)).toBe(-1)
			expect(editor.getLine).not.toHaveBeenCalledWith(-1)
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

		// Regression: pressing k/Ctrl-P on a table's own header row when that row
		// is the document's own first line (fromLine=0) landed the cursor at an
		// unrelated position — setCursorToPrevRow's "header row: go outside
		// table" branch unconditionally dispatched to fromLine-1 (=-1) with no
		// bounds check, unlike setCursorToNextRow's own symmetric "append a
		// blank line at EOF" handling for the last-row case. Fixed to just stay
		// put (matching real vim: k on the document's first line is a no-op).
		it('setCursorToPrevRow does not dispatch anywhere when fromLine is the document\'s first line', () => {
			const editor = makeStatefulEditor(ROWS, { line: 0, ch: 0 })
			plugin.setCursorToPrevRow(editor, 0, 0)
			expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		})
	})

	// ===========================================================================
	// exitTableWithColumn
	// ===========================================================================

	describe('exitTableWithColumn', () => {
		it('exits below and corrects the column to goalCh (clamped to the exit line\'s length)', () => {
			const editor = makeStatefulEditor(['| row |', 'short'], { line: 0, ch: 0 })
			const result = plugin.exitTableWithColumn(editor, 0, true, 3, 0, 1)
			// setCursorToNextRow's own exit lands at ch=0; exitTableWithColumn then
			// corrects it to goalCh=3, clamped to 'short'.length-1=4 (no clamp needed).
			expect(result).toEqual({ line: 1, ch: 3 })
		})

		it('clamps goalCh to the exit line\'s own max when it\'s shorter', () => {
			const editor = makeStatefulEditor(['| row |', 'ab'], { line: 0, ch: 0 })
			const result = plugin.exitTableWithColumn(editor, 0, true, 10, 0, 1)
			expect(result).toEqual({ line: 1, ch: 1 }) // 'ab'.length-1 = 1
		})

		it('exits above via setCursorToPrevRow when forward=false', () => {
			const editor = makeStatefulEditor(['above', '| row |'], { line: 1, ch: 0 })
			const result = plugin.exitTableWithColumn(editor, 0, false, 2, 1, 1)
			expect(result).toEqual({ line: 0, ch: 2 })
		})

		// Regression: setCursorToPrevRow correctly stays put (no-op) when
		// fromLine=0 (a header row that's the document's own first line — no
		// line above it to exit to). This unconditionally "corrected" the
		// column to goalCh afterward anyway, moving ch even though nothing was
		// actually supposed to happen (k on such a header row should be a
		// complete no-op, matching real vim's own "k on the first line does
		// nothing"). Fixed by detecting the no-op (cursor unchanged) and
		// returning null before ever attempting the column correction.
		it('returns null (no column correction) when setCursorToPrevRow was a genuine no-op (header row = document\'s first line)', () => {
			const editor = makeStatefulEditor(['| row |'], { line: 0, ch: 4 })
			const result = plugin.exitTableWithColumn(editor, 0, false, 1, 0, 1)
			expect(result).toBeNull()
			expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
			expect(editor.getCursor()).toEqual({ line: 0, ch: 4 }) // completely untouched
		})

		// Regression: reported live — a table sitting at the edge of the
		// viewport left the cursor invisible off-screen after exiting via j/gj
		// or k/gk, in both directions. setCursorViaCm (used for the exit
		// landing and the column correction above) deliberately never requests
		// a scroll (see jumpToDocumentLine's own identical comment on why) —
		// exiting the table can land somewhere the viewport was never scrolled
		// to show, unlike crossing between rows that stay within an
		// already-onscreen table. Follows jumpToDocumentLine's own pattern: an
		// explicit follow-up dispatch with scrollIntoView, to the same
		// (already landed-on) final position.
		it('follows up with a scrollIntoView dispatch to the final landed position, both when the column needed correcting and when it didn\'t', () => {
			const editorForward = makeStatefulEditor(['| row |', 'short'], { line: 0, ch: 0 })
			plugin.exitTableWithColumn(editorForward, 0, true, 3, 0, 1)
			expect(editorForward.cm.dispatch).toHaveBeenCalledWith(
				expect.objectContaining({ scrollIntoView: true, selection: { anchor: 1003, head: 1003 } }),
			)

			const editorBackward = makeStatefulEditor(['above', '| row |'], { line: 1, ch: 0 })
			plugin.exitTableWithColumn(editorBackward, 0, false, 2, 1, 1)
			expect(editorBackward.cm.dispatch).toHaveBeenCalledWith(
				expect.objectContaining({ scrollIntoView: true }),
			)
		})

		it('does not dispatch a scrollIntoView follow-up on the no-op (already-first-line) case', () => {
			const editor = makeStatefulEditor(['| row |'], { line: 0, ch: 4 })
			plugin.exitTableWithColumn(editor, 0, false, 1, 0, 1)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
		})

		// Fixed: a count-prefixed crossing/entry that outlives the table's own
		// rows used to silently drop the leftover count the moment this
		// function took over — landing on the immediate exit line regardless
		// of how much repeat was actually left. remaining > 1 now continues
		// walking ordinary plain-text lines beyond that exit line (remaining=1
		// means "land right here, no further walk", matching
		// landInCellSegment's own identical convention).
		it('continues walking leftover remaining as plain-text lines beyond the immediate exit line (forward)', () => {
			const editor = makeStatefulEditor(['| row |', 'line1', 'line2', 'line3', 'line4'], { line: 0, ch: 0 })
			const result = plugin.exitTableWithColumn(editor, 0, true, 0, 0, 3)
			expect(result).toEqual({ line: 3, ch: 0 }) // exit lands on line1; 2 more steps -> line3
		})

		it('continues walking leftover remaining as plain-text lines beyond the immediate exit line (backward)', () => {
			const editor = makeStatefulEditor(['line0', 'line1', 'line2', 'line3', '| row |'], { line: 4, ch: 0 })
			const result = plugin.exitTableWithColumn(editor, 0, false, 0, 4, 3)
			expect(result).toEqual({ line: 1, ch: 0 }) // exit lands on line3; 2 more steps -> line1
		})

		it('clamps at the document\'s own edge when the leftover remaining overshoots past the last/first line', () => {
			const editor = makeStatefulEditor(['| row |', 'line1', 'line2'], { line: 0, ch: 0 })
			const result = plugin.exitTableWithColumn(editor, 0, true, 0, 0, 99)
			expect(result).toEqual({ line: 2, ch: 0 }) // stops at the document's own last line
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

		// Investigating count-prefixed j/k crossing multiple *actual* table rows
		// (e.g. "5j") — this test documents *current* behavior, not necessarily
		// desired behavior. remaining=4 against a table with only 1 segment
		// (1 consumed, 3 left over) should, for a fully-precise "5j", continue
		// 3 *more* plain-text lines past the table's own exit — instead,
		// exitTableWithColumn's own single-line landing is used verbatim, and
		// the leftover remaining (3) is silently discarded. Confirms the
		// known gap suspected from reading the code: overshoot only reaches
		// as far as *table* rows go; it does not hand off any leftover count
		// to further plain-text lines once the table itself runs out.
		it('fixed: leftover remaining now continues past exitTableWithColumn into plain text — a count-prefixed crossing that outlives the table lands the correct number of lines past the exit', () => {
			const editor = makeStatefulEditor(
				['| only |', 'line1', 'line2', 'line3', 'line4'],
				{ line: 0, ch: 0 },
			)
			// 1 segment consumed, remaining=4-1=3 left over — exit lands on
			// line1 (1 of the 3), then 2 more steps -> line3.
			const result = plugin.walkTableRows(editor, 0, true, 0, 4, 0)
			expect(result).toEqual({ line: 3, ch: 0 })
		})

		it('fixed: same leftover continuation backward (k direction)', () => {
			const editor = makeStatefulEditor(
				['line0', 'line1', 'line2', 'line3', '| only |'],
				{ line: 4, ch: 0 },
			)
			// Table's own single row is at line 4; walking backward from there.
			const result = plugin.walkTableRows(editor, 0, false, 4, 4, 0)
			expect(result).toEqual({ line: 1, ch: 0 })
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

	// ===========================================================================
	// refineDisplayLineColumn — gj/gk's own step 2, run one tick after a
	// crossTableRowForCell(..., 0, 1) rough landing (see vim-support.ts's own
	// VimSupportHost doc comment). Explicit pixel-based re-correction via
	// coordsAtPos/posAtCoords on the *inner* view, converted back to an outer
	// {line, ch} via getInCellLineInfo, and re-dispatched only through
	// setCursorViaCm — never a raw EditorView.dispatch.
	// ===========================================================================

	describe('refineDisplayLineColumn', () => {
		const LINE_3SEG = '| a<br>b<br>c |' // 'a' at ch 2, 'b' at ch 7, 'c' at ch 12 (segment starts)

		beforeEach(() => {
			plugin.setCursorViaCm = vi.fn()
		})

		function makeInner(head: number, lineLength: number, coordsTop = 100) {
			return {
				state: {
					selection: { main: { head } },
					doc: { lineAt: (_pos: number) => ({ from: 0, to: lineLength, number: 1, length: lineLength }) },
				},
				coordsAtPos: vi.fn().mockReturnValue({ top: coordsTop, bottom: coordsTop + 18, left: 0, right: 100 }),
				posAtCoords: vi.fn(),
			}
		}

		it('dispatches via setCursorViaCm to the pixel-derived outer position when it differs from the current head', () => {
			const inner = makeInner(2, 5) // head offset 2 on a 5-char inner line
			inner.posAtCoords.mockReturnValue(4) // resolves to offset 4, same line
			const editor = {
				activeCM: inner, cm: {},
				getCursor: () => ({ line: 3, ch: 2 }), // outer: cellIndex 0's 'a' segment (start=2)
				getLine: () => LINE_3SEG,
			}
			const result = plugin.refineDisplayLineColumn(editor, 999)
			expect(inner.posAtCoords).toHaveBeenCalledWith({ x: 999, y: 109 }, false)
			// targetOuterCh = segment start (2) + clampedInnerCh (4) = 6
			expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 3, 6)
			expect(result).toEqual({ line: 3, ch: 2 })
		})

		it('does not dispatch when the pixel-derived position already matches the current head', () => {
			const inner = makeInner(2, 5)
			inner.posAtCoords.mockReturnValue(2) // resolves back to the same offset
			const editor = {
				activeCM: inner, cm: {},
				getCursor: () => ({ line: 3, ch: 2 }),
				getLine: () => LINE_3SEG,
			}
			plugin.refineDisplayLineColumn(editor, 999)
			expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		})

		it('clamps to the segment\'s own Normal-mode-legal bound (length - 1), matching maxNormalModeCh', () => {
			const inner = makeInner(0, 2) // 2-char inner line -> max legal offset = 1
			inner.posAtCoords.mockReturnValue(2) // resolves to the line's own end, past the legal bound
			const editor = {
				activeCM: inner, cm: {},
				getCursor: () => ({ line: 3, ch: 2 }),
				getLine: () => LINE_3SEG,
			}
			plugin.refineDisplayLineColumn(editor, 999)
			// clampedInnerCh = min(2, 1) = 1 -> targetOuterCh = 2 + 1 = 3
			expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 3, 3)
		})

		it('regression: never lets the correction change lines — returns the unchanged landing when posAtCoords resolves onto an adjacent line', () => {
			const head = 2
			const inner = {
				state: {
					selection: { main: { head } },
					doc: {
						lineAt: (pos: number) => pos === head
							? { from: 0, to: 5, number: 1, length: 5 }
							: { from: 10, to: 15, number: 2, length: 5 },
					},
				},
				coordsAtPos: vi.fn().mockReturnValue({ top: 100, bottom: 118, left: 0, right: 100 }),
				posAtCoords: vi.fn().mockReturnValue(12), // a position on a *different* inner line
			}
			const editor = { activeCM: inner, cm: {}, getCursor: () => ({ line: 3, ch: 2 }), getLine: () => LINE_3SEG }
			const result = plugin.refineDisplayLineColumn(editor, 999)
			expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
			expect(result).toEqual({ line: 3, ch: 2 })
		})

		it('returns the live cursor unchanged when there is no distinct inner view and the outer view cannot resolve a correction (e.g. an empty cell)', () => {
			const outerCm = {
				state: { doc: { lineAt: (_pos: number) => ({ from: 0, to: 5, number: 1, length: 5 }) } },
				coordsAtPos: vi.fn().mockReturnValue(null),
				posAtCoords: vi.fn(),
			}
			const editor = {
				activeCM: outerCm, cm: outerCm,
				getCursor: () => ({ line: 3, ch: 3 }),
				getLine: () => LINE_3SEG,
				posToOffset: (_pos: { line: number; ch: number }) => 3,
			}
			const result = plugin.refineDisplayLineColumn(editor, 999)
			expect(result).toEqual({ line: 3, ch: 3 })
			expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		})

		it('corrects directly against the outer view when the rough landing already exited the table into plain text', () => {
			const outerCm = {
				state: { doc: { lineAt: (_pos: number) => ({ from: 10, to: 20, number: 5, length: 10 }) } },
				coordsAtPos: vi.fn().mockReturnValue({ top: 100, bottom: 118, left: 0, right: 100 }),
				posAtCoords: vi.fn().mockReturnValue(15), // resolves to offset 15, same outer line
			}
			const editor = {
				activeCM: outerCm, cm: outerCm,
				getCursor: () => ({ line: 5, ch: 0 }), // rough landing left us at ch 0
				getLine: () => 'plain text line below the table',
				posToOffset: (_pos: { line: number; ch: number }) => 10,
			}
			const result = plugin.refineDisplayLineColumn(editor, 999)
			expect(outerCm.posAtCoords).toHaveBeenCalledWith({ x: 999, y: 109 }, false)
			// targetCh = resolved (15) - headLine.from (10) = 5
			expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 5, 5)
			expect(result).toEqual({ line: 5, ch: 0 })
		})

		it('does not dispatch against the outer view when the pixel-derived position already matches the current head', () => {
			const outerCm = {
				state: { doc: { lineAt: (_pos: number) => ({ from: 10, to: 20, number: 5, length: 10 }) } },
				coordsAtPos: vi.fn().mockReturnValue({ top: 100, bottom: 118, left: 0, right: 100 }),
				posAtCoords: vi.fn().mockReturnValue(10), // resolves back to the same offset
			}
			const editor = {
				activeCM: outerCm, cm: outerCm,
				getCursor: () => ({ line: 5, ch: 0 }),
				getLine: () => 'plain text line below the table',
				posToOffset: (_pos: { line: number; ch: number }) => 10,
			}
			plugin.refineDisplayLineColumn(editor, 999)
			expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		})

		it('returns the live cursor unchanged when coordsAtPos returns null', () => {
			const inner = makeInner(2, 5)
			inner.coordsAtPos.mockReturnValue(null)
			const editor = { activeCM: inner, cm: {}, getCursor: () => ({ line: 3, ch: 2 }), getLine: () => LINE_3SEG }
			const result = plugin.refineDisplayLineColumn(editor, 999)
			expect(result).toEqual({ line: 3, ch: 2 })
			expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		})

		it('returns the live cursor unchanged when posAtCoords returns null', () => {
			const inner = makeInner(2, 5)
			inner.posAtCoords.mockReturnValue(null)
			const editor = { activeCM: inner, cm: {}, getCursor: () => ({ line: 3, ch: 2 }), getLine: () => LINE_3SEG }
			const result = plugin.refineDisplayLineColumn(editor, 999)
			expect(result).toEqual({ line: 3, ch: 2 })
			expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		})
	})
})
