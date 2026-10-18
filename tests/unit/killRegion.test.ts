import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorSelection, ChangeSet } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../../src/main.ts'

// Multi-cursor-safe: every range independently kills its own selection, or
// is left untouched (not removed) if empty or invalid. Joined with '\n'
// into a single kill-cache entry, matching native Obsidian's own observed
// multi-cut behavior (see Yank's own test file for the distribution side).
//
// The LP-table branch reads/writes the focused cell's own inner EditorView
// directly (editor.activeCM), whose own document already represents
// sub-lines as real '\n' characters — no <br>/\| escaping to undo there,
// unlike the outer/Source-Mode branch's raw-markdown coordinates. The old
// single-cursor implementation's own prefix/suffix <br>-stripping dead
// branch (unreachable: editor.inTableCell===true always implies a real
// distinct activeCM, per this plugin's own Editor type augmentation) is
// gone along with it.
//
// cm.state.changes uses the REAL ChangeSet.of (not a stub) — a deletion
// shrinks the document, so every kept/cursor position after an earlier
// change in document order must be re-expressed in post-change
// coordinates (mapSelectionAfterChanges's own job in main.ts). Using the
// real ChangeSet here means these tests actually exercise that remapping,
// not just echo back whatever pre-change offset main.ts happened to pass.

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
		getRange: vi.fn((f: any, t: any) => buf[f.line].slice(f.ch, t.ch)),
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

function makeMultiSelectionLPEditor(innerText: string, ranges: { from: number; to: number }[], mainIndex: number) {
	const dispatch = vi.fn()
	const inner = {
		state: {
			doc: { sliceString: (from: number, to?: number) => innerText.slice(from, to) },
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


describe('killRegion', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
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


	describe('outer (plain text / Source Mode)', () => {
		it('empty selection: no-op', () => {
			const editor = makeMultiSelectionPlainEditor(['hello world'], [{ from: { line: 0, ch: 3 }, to: { line: 0, ch: 3 } }], 0)
			plugin.killRegion(editor)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
		})

		it('Source table — cross-cell selection: no-op', () => {
			// '| cell1 | cell2 |' — ch=2 in cell1 (open=0), ch=12 in cell2 (open=8)
			const editor = makeMultiSelectionPlainEditor(['| cell1 | cell2 |'], [{ from: { line: 0, ch: 2 }, to: { line: 0, ch: 12 } }], 0)
			plugin.killRegion(editor)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
		})

		it('deletes the selected range via a single range in the dispatch', () => {
			const editor = makeMultiSelectionPlainEditor(['hello world'], [{ from: { line: 0, ch: 2 }, to: { line: 0, ch: 7 } }], 0)
			plugin.killRegion(editor)
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 2, to: 7, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(2)], 0),
				userEvent: 'delete',
			})
		})

		it('stores raw selected text in killCache without normalization (plain text)', () => {
			const editor = makeMultiSelectionPlainEditor(['a | b<br>c end'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 14 } }], 0)
			plugin.killRegion(editor)
			expect(plugin.killCache).toBe('a | b<br>c end')
		})

		it('applies normalizeKillText in Source Mode: <br> -> \\n, \\| -> |', () => {
			const editor = makeMultiSelectionPlainEditor(['| ab<br>cd |'], [{ from: { line: 0, ch: 2 }, to: { line: 0, ch: 10 } }], 0)
			plugin.killRegion(editor)
			expect(plugin.killCache).toBe('ab\ncd')
		})

		it('writes killCache to clipboard', () => {
			const editor = makeMultiSelectionPlainEditor(['hello world'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } }], 0)
			plugin.killRegion(editor)
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
		})

		it('resets isKillChaining to false, then sets it true (chainable afterward)', () => {
			plugin.isKillChaining = true
			const editor = makeMultiSelectionPlainEditor(['hello world'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } }], 0)
			plugin.killRegion(editor)
			expect(plugin.isKillChaining).toBe(true)
		})

		// Set-mark category A: an operation that consumes/destroys the
		// active selection deactivates the mark.
		it('deactivates Set-mark (markActive)', () => {
			plugin.markActive = true
			const editor = makeMultiSelectionPlainEditor(['hello world'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } }], 0)
			plugin.killRegion(editor)
			expect(plugin.markActive).toBe(false)
		})

		describe('multi-cursor', () => {
			it('each non-empty range kills its own selection independently, joined with \\n -- resulting cursors are in POST-change coordinates', () => {
				// 'foo bar\nbaz qux' (length 15): "foo" at [0,3), "baz" at [8,11).
				// Deleting [0,3) first shifts the second range's own position
				// left by 3 -- its resulting cursor must land at 11-3=8-3=5,
				// not at the stale pre-change offset 8.
				const editor = makeMultiSelectionPlainEditor(
					['foo bar', 'baz qux'],
					[
						{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 } },
						{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 3 } },
					],
					0,
				)
				plugin.killRegion(editor)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 3, insert: '' }, { from: 8, to: 11, insert: '' }],
					selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(5)], 0),
					userEvent: 'delete',
				})
				expect(plugin.killCache).toBe('foo\nbaz')
			})

			it('a secondary selection crossing a Source Mode table boundary is left untouched (shifted, not removed); primary still killed', () => {
				// 'foo bar\n| cell1 | cell2 |' -- line 1 starts at offset 8.
				// Secondary spans [10,20) pre-change; after deleting primary's
				// [0,3), it must land at [7,17), not the stale [10,20).
				const editor = makeMultiSelectionPlainEditor(
					['foo bar', '| cell1 | cell2 |'],
					[
						{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 } },
						{ from: { line: 1, ch: 2 }, to: { line: 1, ch: 12 } },
					],
					0,
				)
				plugin.killRegion(editor)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 3, insert: '' }],
					selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.range(7, 17)], 0),
					userEvent: 'delete',
				})
				expect(plugin.killCache).toBe('foo')
			})

			it("primary's own invalid selection no longer blocks a valid secondary from being killed -- primary's own kept range is untouched (no shift, since it comes first)", () => {
				const editor = makeMultiSelectionPlainEditor(
					['| cell1 | cell2 |', 'foo bar'],
					[
						{ from: { line: 0, ch: 2 }, to: { line: 0, ch: 12 } }, // main — invalid
						{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 3 } },  // secondary — valid
					],
					0,
				)
				plugin.killRegion(editor)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 18, to: 21, insert: '' }],
					selection: EditorSelection.create([EditorSelection.range(2, 12), EditorSelection.cursor(18)], 0),
					userEvent: 'delete',
				})
				expect(plugin.killCache).toBe('foo')
			})
		})
	})


	describe('LP table cell', () => {
		it('no-op when not inside a table cell (activeCM === cm)', () => {
			const editor = { activeCM: {}, cm: {}, inTableCell: true } as any
			editor.activeCM = editor.cm
			expect(() => plugin.killRegion(editor)).not.toThrow()
		})

		it('deletes the selected range within the cell', () => {
			const editor = makeMultiSelectionLPEditor('hello world', [{ from: 2, to: 7 }], 0)
			plugin.killRegion(editor)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: [{ from: 2, to: 7, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(2)], 0),
			})
			expect(plugin.killCache).toBe('llo w')
		})

		it('writes killCache to clipboard', () => {
			const editor = makeMultiSelectionLPEditor('hello', [{ from: 0, to: 5 }], 0)
			plugin.killRegion(editor)
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
		})

		it('resets isKillChaining to false, then sets it true', () => {
			plugin.isKillChaining = true
			const editor = makeMultiSelectionLPEditor('hello', [{ from: 0, to: 5 }], 0)
			plugin.killRegion(editor)
			expect(plugin.isKillChaining).toBe(true)
		})

		it('deactivates Set-mark (markActive)', () => {
			plugin.markActive = true
			const editor = makeMultiSelectionLPEditor('hello', [{ from: 0, to: 5 }], 0)
			plugin.killRegion(editor)
			expect(plugin.markActive).toBe(false)
		})

		describe('multi-cursor', () => {
			it('each non-empty range within the cell kills its own selection independently, joined with \\n -- resulting cursors are in POST-change coordinates', () => {
				// 'foo bar': "foo" at [0,3), "bar" at [4,7). Deleting [0,3)
				// first shifts the second range's own position left by 3 --
				// its resulting cursor must land at 4-3=1, not the stale 4.
				const editor = makeMultiSelectionLPEditor('foo bar', [{ from: 0, to: 3 }, { from: 4, to: 7 }], 0)
				plugin.killRegion(editor)
				expect(editor._innerDispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 3, insert: '' }, { from: 4, to: 7, insert: '' }],
					selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(1)], 0),
				})
				expect(plugin.killCache).toBe('foo\nbar')
			})

			it('an empty secondary range is left untouched (shifted, not removed); non-empty primary still killed', () => {
				// 'foo bar': primary [0,3) killed; secondary empty at 5 shifts to 5-3=2.
				const editor = makeMultiSelectionLPEditor('foo bar', [{ from: 0, to: 3 }, { from: 5, to: 5 }], 0)
				plugin.killRegion(editor)
				expect(editor._innerDispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 3, insert: '' }],
					selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(2)], 0),
				})
			})
		})
	})
})
