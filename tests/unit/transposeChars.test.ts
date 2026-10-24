import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../../src/main.ts'

// fix/transpose-chars-multicursor: previously, only the mid-line case was
// multi-cursor-safe (via delegating straight to CM6's own stock
// transposeChars, which uses state.changeByRange internally) — the
// at-line-end override (swapLastTwoInRange) and both table branches only
// ever looked at the PRIMARY cursor/range, silently ignoring every other
// one whenever the primary happened to land in one of those branches.
// Rewritten as pure per-range resolve functions (same shape as Kill line's
// own resolveKillLineRangeOuter/InCell/SourceMode) so every range resolves
// independently and all changes dispatch together in one transaction.
//
// resolveTransposeCharsRangeInView mirrors CM6's own stock transposeChars
// formula exactly for mid-line and line-start cases (see
// @codemirror/commands' own source) — shared by both the plain-text
// (outer) and Live Preview table-cell (inner) cases, since both are a
// real, complete EditorView of their own with identical line-boundary
// math. Only the line-end override (never crossing into the next line,
// matching real Emacs's own end-of-line special case) and the Source Mode
// table's own <br>-atomic-unit handling are plugin-specific.
//
// A real EditorState (not a stub) backs every view here, same precedent
// as addCursor.test.ts — state.doc.lineAt/sliceDoc and state.changes (for
// mapSelectionAfterChanges) are the genuine CM6 implementation, not
// something a hand-rolled mock could verify faithfully.

function makeView(text: string, ranges: { anchor: number; head: number }[], mainIndex = 0) {
	const dispatch = vi.fn()
	const state = EditorState.create({
		doc: text,
		selection: EditorSelection.create(ranges.map(r => EditorSelection.range(r.anchor, r.head)), mainIndex),
		extensions: [EditorState.allowMultipleSelections.of(true)],
	})
	return { state, dispatch }
}

function makePlugin() {
	const plugin: any = Object.create(UniversalCursorHotkeysPlugin.prototype)
	plugin.settings = { tableAwareSourceModeEditing: true }
	plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
	plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
	plugin.isLivePreviewMode = vi.fn().mockReturnValue(true)
	return plugin
}

// getLine/posToOffset/offsetToPos are all derived from the same real
// cm.state.doc the resolve functions themselves read, so they can never
// drift out of sync with it.
function makeOuterEditor(text: string, ranges: { anchor: number; head: number }[], mainIndex = 0) {
	const cm = makeView(text, ranges, mainIndex)
	const doc = cm.state.doc
	return {
		cm,
		activeCM: undefined,
		inTableCell: false,
		getLine: (line: number) => doc.line(line + 1).text,
		lineCount: () => doc.lines,
		posToOffset: (pos: { line: number; ch: number }) => doc.line(pos.line + 1).from + pos.ch,
		offsetToPos: (offset: number) => {
			const l = doc.lineAt(offset)
			return { line: l.number - 1, ch: offset - l.from }
		},
	}
}

function makeInnerEditor(innerText: string, ranges: { anchor: number; head: number }[], mainIndex = 0) {
	const inner = makeView(innerText, ranges, mainIndex)
	return { cm: {} as any, activeCM: inner, inTableCell: true, _inner: inner }
}


describe('resolveTransposeCharsRangeInView', () => {
	let plugin: any
	beforeEach(() => { plugin = makePlugin() })

	it('mid-line: swaps the cluster before and at the cursor, lands just after the swapped pair', () => {
		const view = makeView('abcdef', [{ anchor: 3, head: 3 }])
		expect(plugin.resolveTransposeCharsRangeInView(view, 3)).toEqual(
			{ kind: 'found', from: 2, to: 4, insert: 'dc', resultPos: 4 })
	})

	it('at line end: swaps the line\'s own last two clusters, never crossing into the next line', () => {
		const view = makeView('abc', [{ anchor: 3, head: 3 }])
		expect(plugin.resolveTransposeCharsRangeInView(view, 3)).toEqual(
			{ kind: 'found', from: 1, to: 3, insert: 'cb', resultPos: 3 })
	})

	it('at line end with fewer than two clusters: no-op', () => {
		const view = makeView('a', [{ anchor: 1, head: 1 }])
		expect(plugin.resolveTransposeCharsRangeInView(view, 1)).toEqual({ kind: 'noop' })
	})

	it('empty line: no-op', () => {
		const view = makeView('', [{ anchor: 0, head: 0 }])
		expect(plugin.resolveTransposeCharsRangeInView(view, 0)).toEqual({ kind: 'noop' })
	})

	it('at a non-first line\'s own start: swaps with the previous line\'s own line break, dragging the first character up (matches CM6 stock)', () => {
		// 'ab\ncd' -> 'abc\nd': the 'c' is absorbed into the line above.
		const view = makeView('ab\ncd', [{ anchor: 3, head: 3 }])
		expect(plugin.resolveTransposeCharsRangeInView(view, 3)).toEqual(
			{ kind: 'found', from: 2, to: 4, insert: 'c\n', resultPos: 4 })
	})

	it('at the absolute document/view start: no-op (nothing precedes it)', () => {
		const view = makeView('abc', [{ anchor: 0, head: 0 }])
		expect(plugin.resolveTransposeCharsRangeInView(view, 0)).toEqual({ kind: 'noop' })
	})

	it('treats a surrogate-pair emoji as a single cluster when swapping at line end', () => {
		const text = 'a😀'
		const view = makeView(text, [{ anchor: text.length, head: text.length }])
		const result = plugin.resolveTransposeCharsRangeInView(view, text.length)
		expect(result.kind).toBe('found')
		expect(result.insert).toBe('😀a')
		expect(Array.from(result.insert).length).toBe(2) // well-formed, no lone surrogate
	})
})


describe('resolveTransposeCharsRangeSourceMode', () => {
	let plugin: any
	beforeEach(() => { plugin = makePlugin() })

	it('mid-cell: swaps the cluster before and at the cursor', () => {
		const lineText = '| hello |'
		const editor = makeOuterEditor(lineText, [{ anchor: 4, head: 4 }])
		const info = { lineType: 'single', startOfInCellLine: 2, endOfInCellLine: 7, isEmpty: false } as any
		expect(plugin.resolveTransposeCharsRangeSourceMode(editor, { line: 0, ch: 4 }, lineText, info)).toEqual(
			{ kind: 'found', from: 3, to: 5, insert: 'le', resultPos: 5 })
	})

	it('at cell content start ("single" line type, no preceding <br>): no-op (true cell boundary)', () => {
		const lineText = '| hello |'
		const editor = makeOuterEditor(lineText, [{ anchor: 2, head: 2 }])
		const info = { lineType: 'single', startOfInCellLine: 2, endOfInCellLine: 7, isEmpty: false } as any
		expect(plugin.resolveTransposeCharsRangeSourceMode(editor, { line: 0, ch: 2 }, lineText, info)).toEqual({ kind: 'noop' })
	})

	it('at cell content end: swaps the last two characters within the cell only', () => {
		const lineText = '| hello |'
		const editor = makeOuterEditor(lineText, [{ anchor: 7, head: 7 }])
		const info = { lineType: 'single', startOfInCellLine: 2, endOfInCellLine: 7, isEmpty: false } as any
		expect(plugin.resolveTransposeCharsRangeSourceMode(editor, { line: 0, ch: 7 }, lineText, info)).toEqual(
			{ kind: 'found', from: 5, to: 7, insert: 'ol', resultPos: 7 })
	})

	it('empty cell: no-op', () => {
		const lineText = '|  |'
		const editor = makeOuterEditor(lineText, [{ anchor: 1, head: 1 }])
		const info = { lineType: 'single', startOfInCellLine: 2, endOfInCellLine: 2, isEmpty: true } as any
		expect(plugin.resolveTransposeCharsRangeSourceMode(editor, { line: 0, ch: 1 }, lineText, info)).toEqual({ kind: 'noop' })
	})

	it('<br> sub-line end: swaps last two within that sub-line only, not crossing into the next one', () => {
		const lineText = '| ab<br>cd |'
		const editor = makeOuterEditor(lineText, [{ anchor: 4, head: 4 }])
		const info = { lineType: 'first', startOfInCellLine: 2, endOfInCellLine: 4, isEmpty: false } as any
		expect(plugin.resolveTransposeCharsRangeSourceMode(editor, { line: 0, ch: 4 }, lineText, info)).toEqual(
			{ kind: 'found', from: 2, to: 4, insert: 'ba', resultPos: 4 })
	})

	it('at a "last" in-cell line start (right after <br>): swaps the whole <br> tag with the following character', () => {
		// '| ab<br>cd |': the <br> spans [4,8); "cd" (lineType 'last') starts
		// at 8. Crossing here swaps the 4-char <br> tag with 'c', giving
		// "| abc<br>d |".
		const lineText = '| ab<br>cd |'
		const editor = makeOuterEditor(lineText, [{ anchor: 8, head: 8 }])
		const info = { lineType: 'last', startOfInCellLine: 8, endOfInCellLine: 10, isEmpty: false } as any
		expect(plugin.resolveTransposeCharsRangeSourceMode(editor, { line: 0, ch: 8 }, lineText, info)).toEqual(
			{ kind: 'found', from: 4, to: 9, insert: 'c<br>', resultPos: 9 })
	})

	it('at a "middle" in-cell line start (right after <br>): swaps the whole <br> tag with the following character', () => {
		// '| a<br>b<br>c |': the first <br> spans [3,7); "b" (lineType
		// 'middle') starts at 7 -> "| ab<br><br>c |" (same pattern as
		// crossing a real newline in plain text: A<br>B<br>C -> AB<br><br>C).
		const lineText = '| a<br>b<br>c |'
		const editor = makeOuterEditor(lineText, [{ anchor: 7, head: 7 }])
		const info = { lineType: 'middle', startOfInCellLine: 7, endOfInCellLine: 8, isEmpty: false } as any
		expect(plugin.resolveTransposeCharsRangeSourceMode(editor, { line: 0, ch: 7 }, lineText, info)).toEqual(
			{ kind: 'found', from: 3, to: 8, insert: 'b<br>', resultPos: 8 })
	})
})


describe('transposeChars (dispatcher)', () => {
	let plugin: any
	beforeEach(() => { plugin = makePlugin() })

	it('mid-line, single cursor: dispatches the swap and lands just after it', () => {
		const editor: any = makeOuterEditor('abcdef', [{ anchor: 3, head: 3 }])
		plugin.transposeChars(editor)
		expect(editor.cm.dispatch).toHaveBeenCalledWith({
			changes: [{ from: 2, to: 4, insert: 'dc' }],
			selection: EditorSelection.create([EditorSelection.cursor(4)], 0),
			userEvent: 'move.character',
		})
	})

	it('deactivates Set-mark (markActive) unconditionally', () => {
		plugin.markActive = true
		const editor: any = makeOuterEditor('abcdef', [{ anchor: 3, head: 3 }])
		plugin.transposeChars(editor)
		expect(plugin.markActive).toBe(false)
	})

	it('a true no-op (document start) does not dispatch at all', () => {
		const editor: any = makeOuterEditor('abc', [{ anchor: 0, head: 0 }])
		plugin.transposeChars(editor)
		expect(editor.cm.dispatch).not.toHaveBeenCalled()
	})

	it('multi-cursor: each range resolves independently (one mid-line, one at line end), both in one dispatch', () => {
		// 'abcdef\nxy': range0 head=3 (mid first line), range1 head=9 (end of
		// second line "xy"). Primary is range1.
		const editor: any = makeOuterEditor('abcdef\nxy', [{ anchor: 3, head: 3 }, { anchor: 9, head: 9 }], 1)
		plugin.transposeChars(editor)
		const dispatched = editor.cm.dispatch.mock.calls[0][0]
		expect(dispatched.changes).toEqual([
			{ from: 2, to: 4, insert: 'dc' },
			{ from: 7, to: 9, insert: 'yx' },
		])
		expect(dispatched.selection.ranges.map((r: any) => r.head)).toEqual([4, 9])
		expect(dispatched.selection.mainIndex).toBe(1)
	})

	it('multi-cursor: a no-op range is left untouched while the other still transposes', () => {
		// range0 at document start (hard no-op), range1 mid-line.
		const editor: any = makeOuterEditor('abcdef', [{ anchor: 0, head: 0 }, { anchor: 3, head: 3 }], 1)
		plugin.transposeChars(editor)
		const dispatched = editor.cm.dispatch.mock.calls[0][0]
		expect(dispatched.changes).toEqual([{ from: 2, to: 4, insert: 'dc' }])
		expect(dispatched.selection.ranges.map((r: any) => r.head)).toEqual([0, 4])
	})

	it('multi-cursor: a secondary\'s own position shifts correctly after an earlier range\'s own edit (real ChangeSet remapping)', () => {
		// 'ab\ncd\nef': range0 head=2 (end of 'ab', swaps to 'ba', net length
		// unchanged) is irrelevant to length; use a source-mode-less plain
		// case where range0's edit changes length to verify remapping:
		// range0 at line-start (head=3, 'ab\ncd\nef' -> drags 'c' up,
		// 'abc\nd\nef', net length unchanged too) — transposeChars never
		// changes length, so remapping here just confirms the SECOND
		// range's own offset is read in POST-first-edit coordinates, not
		// pre-edit ones, even though both edits happen to be length-neutral.
		const editor: any = makeOuterEditor('ab\ncd\nef', [{ anchor: 3, head: 3 }, { anchor: 8, head: 8 }], 1)
		plugin.transposeChars(editor)
		const dispatched = editor.cm.dispatch.mock.calls[0][0]
		// range1 (head=8, end of 'ef') swaps to 'fe', lands at 8 regardless.
		expect(dispatched.changes[1]).toEqual({ from: 6, to: 8, insert: 'fe' })
		expect(dispatched.selection.ranges.map((r: any) => r.head)).toEqual([4, 8])
	})

	it('routes to the LP table handler when inTableCell is true', () => {
		const editor = makeInnerEditor('abcdef', [{ anchor: 3, head: 3 }])
		plugin.transposeChars(editor)
		expect(editor._inner.dispatch).toHaveBeenCalled()
	})

	it('routes to the Source Mode table handler on a table line in Source Mode', () => {
		plugin.isLivePreviewMode = vi.fn().mockReturnValue(false)
		const lineText = '| hello |'
		const editor: any = makeOuterEditor(lineText, [{ anchor: 4, head: 4 }])
		plugin.transposeChars(editor)
		expect(editor.cm.dispatch).toHaveBeenCalledWith({
			changes: [{ from: 3, to: 5, insert: 'le' }],
			selection: EditorSelection.create([EditorSelection.cursor(5)], 0),
			userEvent: 'move.character',
		})
	})
})


describe('transposeCharsInTableLP (dispatcher)', () => {
	let plugin: any
	beforeEach(() => { plugin = makePlugin() })

	it('single cursor, mid segment: dispatches the swap', () => {
		const editor = makeInnerEditor(' hello ', [{ anchor: 3, head: 3 }])
		plugin.transposeChars(editor)
		expect(editor._inner.dispatch).toHaveBeenCalledWith({
			changes: [{ from: 2, to: 4, insert: 'le' }],
			selection: EditorSelection.create([EditorSelection.cursor(4)], 0),
			userEvent: 'move.character',
		})
	})

	it('single cursor, at the cell\'s own first segment start: no-op', () => {
		const editor = makeInnerEditor(' hello ', [{ anchor: 0, head: 0 }])
		plugin.transposeChars(editor)
		expect(editor._inner.dispatch).not.toHaveBeenCalled()
	})

	it('single cursor, at a segment end crossing a <br> boundary: drags the next segment\'s own first character up (matches plain-text line-start precedent)', () => {
		// 'ab\ncd': head=3 is the start of the second <br>-segment -> 'abc\nd'.
		const editor = makeInnerEditor('ab\ncd', [{ anchor: 3, head: 3 }])
		plugin.transposeChars(editor)
		expect(editor._inner.dispatch).toHaveBeenCalledWith({
			changes: [{ from: 2, to: 4, insert: 'c\n' }],
			selection: EditorSelection.create([EditorSelection.cursor(4)], 0),
			userEvent: 'move.character',
		})
	})

	it('multi-cursor: two ranges in the same cell (one mid-segment, one at a segment end) both transpose in one dispatch', () => {
		// 'ab\ncd': range0 head=1 (mid "ab"), range1 head=5 (end of "cd").
		const editor = makeInnerEditor('ab\ncd', [{ anchor: 1, head: 1 }, { anchor: 5, head: 5 }], 0)
		plugin.transposeChars(editor)
		const dispatched = editor._inner.dispatch.mock.calls[0][0]
		expect(dispatched.changes).toEqual([
			{ from: 0, to: 2, insert: 'ba' },
			{ from: 3, to: 5, insert: 'dc' },
		])
		expect(dispatched.selection.ranges.map((r: any) => r.head)).toEqual([2, 5])
	})

	it('no-op when editor.activeCM is unavailable (not actually in a table cell)', () => {
		const editor: any = { activeCM: undefined, cm: {} as any }
		plugin.transposeCharsInTableLP(editor)
		// nothing to assert a dispatch against — just confirms no throw
	})
})
