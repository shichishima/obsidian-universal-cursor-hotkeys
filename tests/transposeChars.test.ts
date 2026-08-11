import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

vi.mock('@codemirror/commands', () => ({
	deleteCharForward: vi.fn(),
	cursorPageDown: vi.fn(),
	cursorPageUp: vi.fn(),
	transposeChars: vi.fn(),
}))

import { transposeChars as cmTransposeChars } from '@codemirror/commands'
import UniversalCursorHotkeysPlugin from '../main.ts'

function makeLineAt(text: string) {
	return (pos: number) => {
		const parts = text.split('\n')
		let offset = 0
		for (let i = 0; i < parts.length; i++) {
			const to = offset + parts[i].length
			if (pos <= to) {
				return { from: offset, to, text: parts[i], number: i + 1 }
			}
			offset = to + 1
		}
		const last = parts[parts.length - 1]
		return { from: text.length - last.length, to: text.length, text: last, number: parts.length }
	}
}

function makeView(text: string) {
	const dispatch = vi.fn()
	return {
		state: {
			doc: {
				toString: () => text,
				sliceString: (from: number, to: number) => text.slice(from, to),
				lineAt: makeLineAt(text),
				line: (n: number) => {
					const parts = text.split('\n')
					let offset = 0
					for (let i = 0; i < n - 1; i++) offset += parts[i].length + 1
					return { from: offset, to: offset + parts[n - 1].length, text: parts[n - 1], number: n }
				},
				lines: text.split('\n').length,
			},
			selection: { main: { head: 0 } },
		},
		dispatch,
	}
}

function makeEditorWithInnerView(innerText: string, head: number) {
	const inner = makeView(innerText)
	inner.state.selection = { main: { head } }
	return {
		activeCM: inner,
		cm: {} as any,
		_innerDispatch: inner.dispatch,
	}
}

function makeEditor(lines: string[], cursorLine: number, cursorCh: number, cmText?: string) {
	const buf = [...lines]
	const cmView = makeView(cmText ?? buf[cursorLine] ?? '')
	return {
		getCursor:  vi.fn(() => ({ line: cursorLine, ch: cursorCh })),
		getLine:    vi.fn((line: number) => buf[line] ?? ''),
		lineCount:  vi.fn(() => buf.length),
		inTableCell: false,
		cm:         cmView,
		_dispatch:  cmView.dispatch,
	}
}


describe('swapLastTwoInRange', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
	})

	it('swaps the last two ASCII characters', () => {
		// 'abc': last two clusters are 'b','c' (indices 1,2) — only that
		// sub-range is replaced, not the whole string.
		const view = makeView('abc')
		plugin.swapLastTwoInRange(view, 0, 3)
		expect(view.dispatch).toHaveBeenCalledWith({
			changes: { from: 1, to: 3, insert: 'cb' },
			selection: { anchor: 3 },
			userEvent: 'move.character',
		})
	})

	it('no-op when the range has fewer than two characters', () => {
		const view = makeView('a')
		plugin.swapLastTwoInRange(view, 0, 1)
		expect(view.dispatch).not.toHaveBeenCalled()
	})

	it('no-op on an empty range', () => {
		const view = makeView('')
		plugin.swapLastTwoInRange(view, 0, 0)
		expect(view.dispatch).not.toHaveBeenCalled()
	})

	it('treats a surrogate-pair emoji as a single cluster (does not split it)', () => {
		// 'a' + 😀 (U+1F600, surrogate pair) — swapping the last two clusters
		// should move the whole emoji, never an unpaired surrogate half.
		const text = 'a😀'
		const view = makeView(text)
		plugin.swapLastTwoInRange(view, 0, text.length)
		const call = view.dispatch.mock.calls[0][0]
		expect(call.changes.insert).toBe('😀a')
		// Sanity: no lone surrogate in the result (a well-formed string round-trips through Array.from cleanly)
		expect(Array.from(call.changes.insert).length).toBe(2)
	})

	it('operates within an offset sub-range, not the whole document', () => {
		const view = makeView('xx' + 'abc')
		plugin.swapLastTwoInRange(view, 2, 5)
		expect(view.dispatch).toHaveBeenCalledWith({
			changes: { from: 3, to: 5, insert: 'cb' },
			selection: { anchor: 5 },
			userEvent: 'move.character',
		})
	})
})


describe('transposeChars (plain text dispatcher)', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.isLivePreviewMode = vi.fn().mockReturnValue(true)
		vi.mocked(cmTransposeChars).mockClear()
	})

	it('mid-line: delegates to CM6 transposeChars', () => {
		const editor = makeEditor(['abcdef'], 0, 3)
		plugin.transposeChars(editor)
		expect(cmTransposeChars).toHaveBeenCalledWith(editor.cm)
		expect(editor._dispatch).not.toHaveBeenCalled()
	})

	it('at line start (non-empty line): still delegates to CM6 transposeChars (no override)', () => {
		const editor = makeEditor(['abc'], 0, 0)
		plugin.transposeChars(editor)
		expect(cmTransposeChars).toHaveBeenCalledWith(editor.cm)
	})

	it('at line end: swaps the last two characters directly, does not call CM6 transposeChars', () => {
		const editor = makeEditor(['abc'], 0, 3)
		plugin.transposeChars(editor)
		expect(cmTransposeChars).not.toHaveBeenCalled()
		expect(editor._dispatch).toHaveBeenCalledWith({
			changes: { from: 1, to: 3, insert: 'cb' },
			selection: { anchor: 3 },
			userEvent: 'move.character',
		})
	})

	it('at line end with fewer than two characters: no-op', () => {
		const editor = makeEditor(['a'], 0, 1)
		plugin.transposeChars(editor)
		expect(cmTransposeChars).not.toHaveBeenCalled()
		expect(editor._dispatch).not.toHaveBeenCalled()
	})

	it('empty line: no-op', () => {
		const editor = makeEditor([''], 0, 0)
		plugin.transposeChars(editor)
		expect(cmTransposeChars).not.toHaveBeenCalled()
		expect(editor._dispatch).not.toHaveBeenCalled()
	})

	it('routes to the LP table handler when inTableCell is true', () => {
		const editor: any = makeEditorWithInnerView(' hello ', 3)
		editor.inTableCell = true
		plugin.transposeChars(editor)
		expect(cmTransposeChars).toHaveBeenCalledWith(editor.activeCM)
	})

	it('routes to the Source Mode table handler on a table line in Source Mode', () => {
		plugin.isLivePreviewMode = vi.fn().mockReturnValue(false)
		const lineText = '| hello |'
		const editor = makeEditor([lineText], 0, 4, lineText)
		plugin.transposeChars(editor)
		expect(cmTransposeChars).toHaveBeenCalledWith(editor.cm)
	})
})


describe('transposeCharsInTableLP', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		vi.mocked(cmTransposeChars).mockClear()
	})

	type Row = {
		desc: string
		innerText: string
		head: number
		expectDispatch?: { changes: { from: number; to: number; insert: string }; selection: { anchor: number }; userEvent: string }
		expectTranspose?: true
		// neither = no-op
	}

	const matrix: Row[] = [
		{ desc: 'single segment: mid-content → CM6 transposeChars', innerText: ' hello ', head: 3, expectTranspose: true },
		{ desc: 'single segment: at start → no-op',                 innerText: ' hello ', head: 0 },
		{ desc: 'single segment: at end → swap last two',           innerText: ' hello ', head: 7,
			expectDispatch: { changes: { from: 5, to: 7, insert: ' o' }, selection: { anchor: 7 }, userEvent: 'move.character' } },

		{ desc: 'multi segment: mid first segment → CM6 transposeChars', innerText: 'ab\ncd', head: 1, expectTranspose: true },
		{ desc: 'multi segment: at first segment start → no-op',         innerText: 'ab\ncd', head: 0 },
		{ desc: 'multi segment: at first segment end (before <br>) → swap last two, does not cross into next segment',
			innerText: 'ab\ncd', head: 2,
			expectDispatch: { changes: { from: 0, to: 2, insert: 'ba' }, selection: { anchor: 2 }, userEvent: 'move.character' } },
		{ desc: 'multi segment: at second segment start (after <br>) → no-op', innerText: 'ab\ncd', head: 3 },
		{ desc: 'multi segment: mid second segment → CM6 transposeChars',      innerText: 'ab\ncd', head: 4, expectTranspose: true },
		{ desc: 'multi segment: at last segment end → swap last two',         innerText: 'ab\ncd', head: 5,
			expectDispatch: { changes: { from: 3, to: 5, insert: 'dc' }, selection: { anchor: 5 }, userEvent: 'move.character' } },
	]

	for (const row of matrix) {
		it(row.desc, () => {
			const editor = makeEditorWithInnerView(row.innerText, row.head)
			plugin.transposeCharsInTableLP(editor)

			if (row.expectDispatch) {
				expect(editor._innerDispatch).toHaveBeenCalledWith(row.expectDispatch)
				expect(cmTransposeChars).not.toHaveBeenCalled()
			} else if (row.expectTranspose) {
				expect(cmTransposeChars).toHaveBeenCalledWith(editor.activeCM)
				expect(editor._innerDispatch).not.toHaveBeenCalled()
			} else {
				expect(editor._innerDispatch).not.toHaveBeenCalled()
				expect(cmTransposeChars).not.toHaveBeenCalled()
			}
		})
	}

	it('no-op when editor.activeCM is unavailable (not actually in a table cell)', () => {
		const editor = { activeCM: undefined, cm: {} as any }
		plugin.transposeCharsInTableLP(editor)
		expect(cmTransposeChars).not.toHaveBeenCalled()
	})
})


describe('transposeCharsInTableSource', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		vi.mocked(cmTransposeChars).mockClear()
	})

	it('mid-cell: delegates to CM6 transposeChars', () => {
		const lineText = '| hello |'
		const editor = makeEditor([lineText], 0, 4, lineText)
		const info = { startOfInCellLine: 2, endOfInCellLine: 7, isEmpty: false }
		plugin.transposeCharsInTableSource(editor, info)
		expect(cmTransposeChars).toHaveBeenCalledWith(editor.cm)
	})

	it('at cell content start → no-op', () => {
		const lineText = '| hello |'
		const editor = makeEditor([lineText], 0, 2, lineText)
		const info = { startOfInCellLine: 2, endOfInCellLine: 7, isEmpty: false }
		plugin.transposeCharsInTableSource(editor, info)
		expect(cmTransposeChars).not.toHaveBeenCalled()
		expect(editor._dispatch).not.toHaveBeenCalled()
	})

	it('at cell content end → swaps the last two characters within the cell only', () => {
		// '| hello |': cell content is 'hello' at [2,7). Last two clusters are
		// 'l','o' (indices 5,6 in the line) — only that sub-range is replaced.
		const lineText = '| hello |'
		const editor = makeEditor([lineText], 0, 7, lineText)
		const info = { startOfInCellLine: 2, endOfInCellLine: 7, isEmpty: false }
		plugin.transposeCharsInTableSource(editor, info)
		expect(cmTransposeChars).not.toHaveBeenCalled()
		expect(editor._dispatch).toHaveBeenCalledWith({
			changes: { from: 5, to: 7, insert: 'ol' },
			selection: { anchor: 7 },
			userEvent: 'move.character',
		})
	})

	it('empty cell → no-op', () => {
		const lineText = '|  |'
		const editor = makeEditor([lineText], 0, 1, lineText)
		const info = { startOfInCellLine: 2, endOfInCellLine: 2, isEmpty: true }
		plugin.transposeCharsInTableSource(editor, info)
		expect(cmTransposeChars).not.toHaveBeenCalled()
		expect(editor._dispatch).not.toHaveBeenCalled()
	})

	it('<br> sub-line end → swaps last two within that sub-line only, not crossing into the next one', () => {
		const lineText = '| ab<br>cd |'
		const editor = makeEditor([lineText], 0, 4, lineText)
		const info = { startOfInCellLine: 2, endOfInCellLine: 4, isEmpty: false }
		plugin.transposeCharsInTableSource(editor, info)
		expect(editor._dispatch).toHaveBeenCalledWith({
			changes: { from: 2, to: 4, insert: 'ba' },
			selection: { anchor: 4 },
			userEvent: 'move.character',
		})
	})
})
