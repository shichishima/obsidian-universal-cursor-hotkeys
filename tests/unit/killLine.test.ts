import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorSelection, ChangeSet } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../../src/main.ts'

// Multi-cursor-safe: each range kills from its own head independently,
// joined with '\n' into one kill-cache entry (same convention as Kill
// Region/Yank). The selection-vs-table-row choice (resolveKillLineRangeOuter)
// is made per range, not once for the whole command based on primary
// alone — a Source Mode table row and a plain-text line can coexist in
// the same multi-cursor dispatch.
//
// The old single-cursor killLineInTableSourceMode's own setLine +
// setTimeoutOnActiveWindow-deferred setCursorViaCm mechanism is gone:
// the new implementation dispatches changes and the resulting selection
// together in one synchronous cm.dispatch, same as every other
// multi-range command in this file — no fake timers needed here anymore.
//
// cm.state.changes uses the REAL ChangeSet.of (not a stub) — see
// killRegion.test.ts's own identical note on why this matters for
// multi-range dispatches with non-length-preserving changes.

function makeMultiSelectionPlainEditor(
	lines: string[],
	ranges: { from: { line: number; ch: number }; to: { line: number; ch: number } }[],
	mainIndex: number,
) {
	const buf = [...lines]
	const lineStarts: number[] = []
	let acc = 0
	for (const line of lines) { lineStarts.push(acc); acc += line.length + 1 }
	const totalLength = acc > 0 ? acc - 1 : 0
	const posToOffset = (pos: { line: number; ch: number }) => lineStarts[pos.line] + pos.ch
	const offsetToPos = (offset: number) => {
		let line = 0
		while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++
		return { line, ch: offset - lineStarts[line] }
	}
	const selection = EditorSelection.create(
		ranges.map(r => EditorSelection.range(posToOffset(r.from), posToOffset(r.to))),
		mainIndex,
	)
	return {
		getLine: vi.fn((line: number) => buf[line] ?? ''),
		lineCount: vi.fn(() => buf.length),
		posToOffset: vi.fn(posToOffset),
		offsetToPos: vi.fn(offsetToPos),
		inTableCell: false,
		cm: {
			state: {
				selection,
				changes: (spec: any) => ChangeSet.of(spec, totalLength),
			},
			dispatch: vi.fn(),
			scrollDOM: { scrollTop: 0 },
		},
		activeCM: undefined,
		_buf: buf,
	}
}

// Single-cursor convenience wrapper: builds a one-range editor at
// {line, ch} and returns both the editor and that range's own starting
// offset (for computing expected post-change positions by hand).
function makeSingleCursorEditor(lines: string[], line: number, ch: number) {
	return makeMultiSelectionPlainEditor(lines, [{ from: { line, ch }, to: { line, ch } }], 0)
}


describe('killLine', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, smartJoin: false, visualLineMovement: true, crossRowNavigation: true }
		plugin.isKillChaining    = false
		plugin.isDispatchingKill = false
		plugin.killCache         = ''

		plugin.isLivePreviewMode = vi.fn().mockReturnValue(false)

		vi.stubGlobal('navigator', {
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})


	describe('plain text — cursor before line end', () => {
		// [lineText, cursorCh, expectedKillCache]
		const cases: [string, number, string][] = [
			['hello world', 6, 'world'],
			['hello world', 0, 'hello world'],
			['hello',       2, 'llo'],
		]

		for (const [lineText, ch, expectedCache] of cases) {
			it(`"${lineText}" ch=${ch} -> kills "${expectedCache}"`, () => {
				const editor = makeSingleCursorEditor([lineText], 0, ch)
				plugin.killLineOuter(editor)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: ch, to: lineText.length, insert: '' }],
					selection: EditorSelection.create([EditorSelection.cursor(ch)], 0),
					userEvent: 'delete',
				})
				expect(plugin.killCache).toBe(expectedCache)
				expect(plugin.isKillChaining).toBe(true)
			})
		}
	})


	describe('plain text — cursor at line end (join next line)', () => {
		describe('smartJoin: OFF (default) — preserves leading syntax', () => {
			it('joins next line without trimming', () => {
				const editor = makeSingleCursorEditor(['hello', '  world'], 0, 5)
				plugin.killLineOuter(editor)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 5, to: 6, insert: '' }],
					selection: EditorSelection.create([EditorSelection.cursor(5)], 0),
					userEvent: 'delete',
				})
				expect(plugin.killCache).toBe('\n')
				expect(plugin.isKillChaining).toBe(true)
			})

			it('joins next line with no leading whitespace', () => {
				const editor = makeSingleCursorEditor(['hello', 'world'], 0, 5)
				plugin.killLineOuter(editor)
				expect(plugin.killCache).toBe('\n')
			})
		})

		describe('smartJoin: ON — trims to smart home position', () => {
			beforeEach(() => {
				plugin.settings = { ...plugin.settings, smartJoin: true }
			})

			it('joins next line, stripping leading whitespace to content start', () => {
				const editor = makeSingleCursorEditor(['hello', '  world'], 0, 5)
				plugin.killLineOuter(editor)
				// 'hello'.length=5, next line '  world' trims 2 leading spaces -> to=6+2=8
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 5, to: 8, insert: '' }],
					selection: EditorSelection.create([EditorSelection.cursor(5)], 0),
					userEvent: 'delete',
				})
				// The stripped leading whitespace is deleted from the document
				// too, so it must be in the kill cache alongside the newline.
				expect(plugin.killCache).toBe('\n  ')
			})

			it('joins next line with list marker stripped', () => {
				const editor = makeSingleCursorEditor(['hello', '- item'], 0, 5)
				plugin.killLineOuter(editor)
				expect(plugin.killCache).toBe('\n- ')
			})

			it('joins next line with no leading syntax -- unchanged', () => {
				const editor = makeSingleCursorEditor(['hello', 'world'], 0, 5)
				plugin.killLineOuter(editor)
				expect(plugin.killCache).toBe('\n')
			})
		})

		it('does nothing at last line', () => {
			const editor = makeSingleCursorEditor(['only line'], 0, 9)
			plugin.killLineOuter(editor)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
			expect(plugin.isKillChaining).toBe(false)
		})
	})


	it('consecutive kills accumulate killCache (chaining is never reset by this command itself)', () => {
		const editor = makeSingleCursorEditor(['hello world'], 0, 6)
		plugin.killLineOuter(editor)
		expect(plugin.killCache).toBe('world')
		expect(plugin.isKillChaining).toBe(true)

		// Second kill: cursor now at end of a different line -> joins with
		// nothing (no next line) in THIS mock, but isKillChaining being
		// true from the first kill still makes it append via updateKillCache.
		const editor2 = makeSingleCursorEditor(['first ', 'second'], 0, 6)
		plugin.killLineOuter(editor2)
		expect(plugin.killCache).toBe('world\n')
	})


	describe('Source Mode table row — cursor before in-cell line end', () => {
		// Line: '| hello |'  pipes at 0, 8  cellStart=1, cellEnd=8
		// startOfInCellLine=2  endOfInCellLine=7
		const cases: [string, number, string, string][] = [
			['| hello |',   2, '| |',   'hello'],
			['| hello |',   4, '| he |', 'llo'],
			['| x |',       2, '| |',   'x'],
			['| a \\| b |', 2, '| |',   'a | b'],
		]

		for (const [lineText, ch, _unused, expectedNormCache] of cases) {
			it(`"${lineText}" ch=${ch} -> normalized cache="${expectedNormCache}"`, () => {
				const editor = makeSingleCursorEditor([lineText], 0, ch)
				plugin.killLineOuter(editor)
				expect(editor.cm.dispatch).toHaveBeenCalled()
				expect(plugin.killCache).toBe(expectedNormCache)
				expect(plugin.isKillChaining).toBe(true)
			})
		}
	})


	describe('Source Mode table row — kill <br> at in-cell line end', () => {
		it('removes <br> in one dispatch', () => {
			// '| line1<br>line2 |' -- pipes at 0 and 17; first segment ' line1'
			// (1..7), <br> at 7, endOfSeg0=7 (lineType 'first').
			const lineText = '| line1<br>line2 |'
			const editor = makeSingleCursorEditor([lineText], 0, 7)
			plugin.killLineOuter(editor)
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 7, to: 11, insert: '' }], // '<br>' is 4 chars
				selection: EditorSelection.create([EditorSelection.cursor(7)], 0),
				userEvent: 'delete',
			})
			expect(plugin.killCache).toBe('\n')
			expect(plugin.isKillChaining).toBe(true)
		})

		it('removes <br> but keeps trailing spaces when smartJoin is OFF', () => {
			// '| a<br>   b |'
			const lineText = '| a<br>   b |'
			const editor = makeSingleCursorEditor([lineText], 0, 3)
			plugin.killLineOuter(editor)
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 3, to: 7, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(3)], 0),
				userEvent: 'delete',
			})
			expect(plugin.killCache).toBe('\n')
		})

		it('removes <br> with trailing spaces when smartJoin is ON', () => {
			plugin.settings = { ...plugin.settings, smartJoin: true }
			const lineText = '| a<br>   b |'
			const editor = makeSingleCursorEditor([lineText], 0, 3)
			plugin.killLineOuter(editor)
			// <br>(4) + '   '(3 spaces) removed: to = 3+4+3 = 10
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 3, to: 10, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(3)], 0),
				userEvent: 'delete',
			})
			// The trimmed spaces are deleted from the cell too, so they must
			// be in the kill cache alongside the newline.
			expect(plugin.killCache).toBe('\n   ')
		})

		it('removes <br> with list marker when smartJoin is ON', () => {
			plugin.settings = { ...plugin.settings, smartJoin: true }
			// '| a<br>   - item |'
			const lineText = '| a<br>   - item |'
			const editor = makeSingleCursorEditor([lineText], 0, 3)
			plugin.killLineOuter(editor)
			expect(plugin.killCache).toBe('\n   - ')
		})
	})


	describe('Source Mode table row — no-op cases', () => {
		it('no-op at last in-cell line end (cell boundary, lineType last)', () => {
			const lineText = '| line1<br>line2 |'
			const editor = makeSingleCursorEditor([lineText], 0, 16)
			plugin.killLineOuter(editor)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
			expect(plugin.isKillChaining).toBe(false)
		})

		it('no-op at end of single in-cell line', () => {
			const lineText = '| hello |'
			const editor = makeSingleCursorEditor([lineText], 0, 7)
			plugin.killLineOuter(editor)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
		})
	})


	describe('multi-cursor', () => {
		it("each range kills its own line-end independently, joined with \\n -- secondary's resulting cursor is shifted by the primary's earlier deletion", () => {
			// 'foo bar\nbaz qux' (length 15). range1's own deletion start
			// (11) comes after range0's own 4-char deletion [3,7), so its
			// post-change position is 11-4=7, not the stale pre-change 11.
			const editor = makeMultiSelectionPlainEditor(
				['foo bar', 'baz qux'],
				[
					{ from: { line: 0, ch: 3 }, to: { line: 0, ch: 3 } },
					{ from: { line: 1, ch: 3 }, to: { line: 1, ch: 3 } },
				],
				0,
			)
			plugin.killLineOuter(editor)
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 3, to: 7, insert: '' }, { from: 11, to: 15, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(7)], 0),
				userEvent: 'delete',
			})
			expect(plugin.killCache).toBe(' bar\n qux')
		})

		it('a no-op secondary (at the very last line) is left in place (shifted by the earlier deletion, not removed); primary still kills', () => {
			const editor = makeMultiSelectionPlainEditor(
				['foo bar', 'baz'],
				[
					{ from: { line: 0, ch: 3 }, to: { line: 0, ch: 3 } },
					{ from: { line: 1, ch: 3 }, to: { line: 1, ch: 3 } }, // last line, already at its own end
				],
				0,
			)
			plugin.killLineOuter(editor)
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 3, to: 7, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(7)], 0),
				userEvent: 'delete',
			})
		})

		it('a Source Mode table row and a plain-text line coexist in the same dispatch', () => {
			const editor = makeMultiSelectionPlainEditor(
				['foo bar', '| hello |'],
				[
					{ from: { line: 0, ch: 3 }, to: { line: 0, ch: 3 } },
					{ from: { line: 1, ch: 2 }, to: { line: 1, ch: 2 } },
				],
				0,
			)
			plugin.killLineOuter(editor)
			expect(plugin.killCache).toBe(' bar\nhello')
		})
	})
})
