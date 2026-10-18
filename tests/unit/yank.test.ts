import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorSelection, ChangeSet } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../../src/main.ts'

// Multi-cursor-safe: splitYankTextForCursors decides, once per call, how
// the clipboard's own line count maps onto the current cursor count — if
// they match, one line is distributed per cursor (document order, VS
// Code/Sublime-style); otherwise the whole clipboard string is duplicated
// at every cursor (today's single-cursor-equivalent behavior, matching
// native Obsidian's own observed Cmd-V fallback). Which cursor count
// originally produced a kill is never tracked anywhere.
//
// The old single-cursor implementation's own setLine + deferred
// setCursorViaCm path (for inserting text containing <br> into an LP
// cell) was dead code even before this rewrite: editor.inTableCell===true
// always implies a real distinct activeCM (this plugin's own Editor type
// augmentation), so that branch could never actually be reached — the
// genuinely-reachable LP path always went through activeCM directly,
// which already uses real '\n' for in-cell line breaks (no <br> at all).
//
// cm.state.changes uses the REAL ChangeSet.of (not a stub), since an
// insertion's own length is never guaranteed to match what it replaces —
// see killRegion.test.ts's own identical note on why this matters for
// multi-range dispatches.

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
	}
}

function makeMultiSelectionLPEditor(innerText: string, ranges: { from: number; to: number }[], mainIndex: number) {
	const dispatch = vi.fn()
	const inner = {
		state: {
			selection: EditorSelection.create(ranges.map(r => EditorSelection.range(r.from, r.to)), mainIndex),
			changes: (spec: any) => ChangeSet.of(spec, innerText.length),
		},
		dispatch,
	}
	return {
		activeCM: inner,
		cm: { scrollDOM: { scrollTop: 0 } },
		inTableCell: true,
		_innerDispatch: dispatch,
	}
}


describe('yank', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.killCache = ''
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	function mockClipboard(value: string | null) {
		vi.stubGlobal('navigator', {
			clipboard: {
				readText: value === null
					? vi.fn().mockRejectedValue(new Error('denied'))
					: vi.fn().mockResolvedValue(value),
			},
		})
	}


	describe('splitYankTextForCursors', () => {
		it('cursor count matches line count: splits one line per cursor', () => {
			expect(plugin.splitYankTextForCursors('a\nb\nc', 3)).toEqual(['a', 'b', 'c'])
		})

		it('cursor count does not match: duplicates the whole string at every cursor', () => {
			expect(plugin.splitYankTextForCursors('a\nb', 3)).toEqual(['a\nb', 'a\nb', 'a\nb'])
			expect(plugin.splitYankTextForCursors('a\nb\nc', 2)).toEqual(['a\nb\nc', 'a\nb\nc'])
		})

		it('single cursor, single-line clipboard: trivially one piece, unchanged', () => {
			expect(plugin.splitYankTextForCursors('hello', 1)).toEqual(['hello'])
		})
	})


	describe('outer (plain text / Source Mode)', () => {
		it('does nothing when clipboard is empty', async () => {
			mockClipboard('')
			const editor = makeMultiSelectionPlainEditor(['some text'], [{ from: { line: 0, ch: 4 }, to: { line: 0, ch: 4 } }], 0)
			await plugin.yank(editor)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
		})

		it('deactivates Set-mark (markActive)', async () => {
			plugin.markActive = true
			mockClipboard('hello')
			const editor = makeMultiSelectionPlainEditor(['some text'], [{ from: { line: 0, ch: 4 }, to: { line: 0, ch: 4 } }], 0)
			await plugin.yank(editor)
			expect(plugin.markActive).toBe(false)
		})

		it('resets isKillChaining', async () => {
			plugin.isKillChaining = true
			mockClipboard('hello')
			const editor = makeMultiSelectionPlainEditor(['some text'], [{ from: { line: 0, ch: 4 }, to: { line: 0, ch: 4 } }], 0)
			await plugin.yank(editor)
			expect(plugin.isKillChaining).toBe(false)
		})

		it('pastes plain text as-is, cursor lands after the inserted text', async () => {
			mockClipboard('hello')
			const editor = makeMultiSelectionPlainEditor(['some text'], [{ from: { line: 0, ch: 4 }, to: { line: 0, ch: 4 } }], 0)
			await plugin.yank(editor)
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 4, to: 4, insert: 'hello' }],
				selection: EditorSelection.create([EditorSelection.cursor(9)], 0),
				userEvent: 'input',
			})
		})

		it('pipes not escaped outside a table', async () => {
			mockClipboard('a | b')
			const editor = makeMultiSelectionPlainEditor(['xx'], [{ from: { line: 0, ch: 2 }, to: { line: 0, ch: 2 } }], 0)
			await plugin.yank(editor)
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 2, to: 2, insert: 'a | b' }],
				selection: EditorSelection.create([EditorSelection.cursor(7)], 0),
				userEvent: 'input',
			})
		})

		it('Source Mode table row: escapes | and converts \\n to <br>', async () => {
			mockClipboard('a | b\nc | d')
			// isTableLineSourceMode reads getLine() for that range's own line.
			const editor = makeMultiSelectionPlainEditor(['| cell |'], [{ from: { line: 0, ch: 3 }, to: { line: 0, ch: 3 } }], 0)
			await plugin.yank(editor)
			const expectedText = 'a \\| b<br>c \\| d'
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 3, to: 3, insert: expectedText }],
				selection: EditorSelection.create([EditorSelection.cursor(3 + expectedText.length)], 0),
				userEvent: 'input',
			})
		})

		it('replaces a non-empty selection, cursor lands right after the inserted text', async () => {
			mockClipboard('X')
			const editor = makeMultiSelectionPlainEditor(['hello world'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } }], 0)
			await plugin.yank(editor)
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 0, to: 5, insert: 'X' }],
				selection: EditorSelection.create([EditorSelection.cursor(1)], 0),
				userEvent: 'input',
			})
		})

		describe('clipboard fallback to killCache', () => {
			it('uses killCache when clipboard read throws', async () => {
				mockClipboard(null)
				plugin.killCache = 'cached'
				const editor = makeMultiSelectionPlainEditor(['xx'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }], 0)
				await plugin.yank(editor)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 0, insert: 'cached' }],
					selection: EditorSelection.create([EditorSelection.cursor(6)], 0),
					userEvent: 'input',
				})
			})

			it('does nothing when clipboard throws and killCache is empty', async () => {
				mockClipboard(null)
				plugin.killCache = ''
				const editor = makeMultiSelectionPlainEditor(['xx'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }], 0)
				await plugin.yank(editor)
				expect(editor.cm.dispatch).not.toHaveBeenCalled()
			})
		})

		describe('multi-cursor', () => {
			it('line count matches cursor count: distributes one line per cursor, in document order', async () => {
				// 'foo\nbar' (length 7). Cursors at 0 and 4 (line starts).
				mockClipboard('X\nY')
				const editor = makeMultiSelectionPlainEditor(
					['foo', 'bar'],
					[
						{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } },
						{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 0 } },
					],
					0,
				)
				await plugin.yank(editor)
				// Insert 'X' at 0 (len 1, was 0 -> +1 shift); second range's
				// original offset 4 shifts to 5 before its own insert of 'Y'.
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 0, insert: 'X' }, { from: 4, to: 4, insert: 'Y' }],
					selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(6)], 0),
					userEvent: 'input',
				})
			})

			it('line count does not match cursor count: duplicates the whole clipboard text at every cursor', async () => {
				mockClipboard('X\nY\nZ') // 3 lines, but only 2 cursors
				const editor = makeMultiSelectionPlainEditor(
					['foo', 'bar'],
					[
						{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } },
						{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 0 } },
					],
					0,
				)
				await plugin.yank(editor)
				const whole = 'X\nY\nZ'
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 0, insert: whole }, { from: 4, to: 4, insert: whole }],
					selection: EditorSelection.create([EditorSelection.cursor(whole.length), EditorSelection.cursor(4 + whole.length * 2)], 0),
					userEvent: 'input',
				})
			})

			it('each range escapes for its own line independently (mixed table/non-table)', async () => {
				mockClipboard('a|b') // single line -> no split, duplicated per cursor
				const editor = makeMultiSelectionPlainEditor(
					['foo', '| cell |'],
					[
						{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } },
						{ from: { line: 1, ch: 3 }, to: { line: 1, ch: 3 } },
					],
					0,
				)
				await plugin.yank(editor)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 0, insert: 'a|b' }, { from: 7, to: 7, insert: 'a\\|b' }],
					selection: expect.anything(),
					userEvent: 'input',
				})
			})
		})
	})


	describe('LP table cell', () => {
		it('no-op when not inside a table cell (activeCM === cm)', async () => {
			mockClipboard('hello')
			const editor = { activeCM: {}, cm: {}, inTableCell: true } as any
			editor.activeCM = editor.cm
			await expect(plugin.yank(editor)).resolves.not.toThrow()
		})

		it('inserts raw text directly (no <br> conversion), cursor after inserted text', async () => {
			mockClipboard('line1\nline2')
			const editor = makeMultiSelectionLPEditor('hello', [{ from: 2, to: 2 }], 0)
			await plugin.yank(editor)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: [{ from: 2, to: 2, insert: 'line1\nline2' }],
				selection: EditorSelection.create([EditorSelection.cursor(2 + 'line1\nline2'.length)], 0),
				userEvent: 'input',
			})
		})

		it('escapes pipe but keeps real \\n (inner view has no <br> concept)', async () => {
			mockClipboard('a | b')
			const editor = makeMultiSelectionLPEditor('hello', [{ from: 0, to: 0 }], 0)
			await plugin.yank(editor)
			// Inner view coordinates are never Source-Mode-escaped — only the
			// outer/Source-Mode branch does \| escaping; the LP cell's own
			// inner document already stores pipes and newlines literally.
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: [{ from: 0, to: 0, insert: 'a | b' }],
				selection: EditorSelection.create([EditorSelection.cursor(5)], 0),
				userEvent: 'input',
			})
		})

		describe('multi-cursor', () => {
			it('line count matches cursor count: distributes one line per cursor', async () => {
				mockClipboard('X\nY')
				// 'foo bar': cursors at 0 and 4.
				const editor = makeMultiSelectionLPEditor('foo bar', [{ from: 0, to: 0 }, { from: 4, to: 4 }], 0)
				await plugin.yank(editor)
				expect(editor._innerDispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 0, insert: 'X' }, { from: 4, to: 4, insert: 'Y' }],
					selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(6)], 0),
					userEvent: 'input',
				})
			})

			it('line count does not match: duplicates the whole text at every cursor', async () => {
				mockClipboard('XY')
				const editor = makeMultiSelectionLPEditor('foo bar', [{ from: 0, to: 0 }, { from: 4, to: 4 }], 0)
				await plugin.yank(editor)
				expect(editor._innerDispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 0, insert: 'XY' }, { from: 4, to: 4, insert: 'XY' }],
					selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(8)], 0),
					userEvent: 'input',
				})
			})
		})
	})
})
