import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorSelection } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../../src/main.ts'

// Uppercase word / Lowercase word / Capitalize word (Emacs Alt-U/L/C).
// Structured to mirror killWord.test.ts's own multi-branch split (plain
// text, LP table, Source Mode table, selection) — each tested by calling
// the branch method directly.

function makePlainEditor(
	lines: string[],
	from: { line: number; ch: number },
	to: { line: number; ch: number } = from,
	inTableCell = false,
) {
	const buf = [...lines]
	const posToOffset = (pos: { line: number; ch: number }) => pos.line * 1000 + pos.ch
	const offsetToPos = (offset: number) => ({ line: Math.floor(offset / 1000), ch: offset % 1000 })
	const selection = EditorSelection.create([EditorSelection.cursor(posToOffset(from))], 0)
	return {
		getCursor: vi.fn((sel?: string) => (sel === 'to' ? { ...to } : sel === 'from' ? { ...from } : { ...from })),
		getLine: vi.fn((line: number) => buf[line] ?? ''),
		lineCount: vi.fn(() => buf.length),
		getSelection: vi.fn(() => {
			if (from.line === to.line) return buf[from.line].slice(from.ch, to.ch)
			const parts = [buf[from.line].slice(from.ch)]
			for (let i = from.line + 1; i < to.line; i++) parts.push(buf[i])
			parts.push(buf[to.line].slice(0, to.ch))
			return parts.join('\n')
		}),
		getRange: vi.fn((f: any, t: any) => {
			if (f.line === t.line) return buf[f.line].slice(f.ch, t.ch)
			const parts = [buf[f.line].slice(f.ch)]
			for (let i = f.line + 1; i < t.line; i++) parts.push(buf[i])
			parts.push(buf[t.line].slice(0, t.ch))
			return parts.join('\n')
		}),
		replaceRange: vi.fn((replacement: string, f: any, t: any) => {
			if (f.line === t.line) {
				buf[f.line] = buf[f.line].slice(0, f.ch) + replacement + buf[f.line].slice(t.ch)
			} else {
				const merged = buf[f.line].slice(0, f.ch) + replacement + buf[t.line].slice(t.ch)
				buf.splice(f.line, t.line - f.line + 1, merged)
			}
		}),
		inTableCell,
		posToOffset: vi.fn(posToOffset),
		offsetToPos: vi.fn(offsetToPos),
		cm: {
			state: { selection },
			// Applies each change (single line only, matching this mock's
			// line*1000+ch offset encoding) directly to buf, mirroring what a
			// real cm.dispatch({changes}) would do — the multi-cursor rewrite
			// dispatches raw changes instead of going through replaceRange.
			dispatch: vi.fn((spec: { changes?: { from: number; to: number; insert: string } | { from: number; to: number; insert: string }[] }) => {
				const list = spec.changes ? (Array.isArray(spec.changes) ? spec.changes : [spec.changes]) : []
				for (const c of list) {
					const f = offsetToPos(c.from)
					const t = offsetToPos(c.to)
					buf[f.line] = buf[f.line].slice(0, f.ch) + c.insert + buf[t.line].slice(t.ch)
				}
			}),
			focus: vi.fn(),
		},
		activeCM: undefined,
		_buf: buf,
	}
}

function makeLineAt(text: string) {
	return (pos: number) => {
		const parts = text.split('\n')
		let offset = 0
		for (let i = 0; i < parts.length; i++) {
			const to = offset + parts[i].length
			if (pos <= to) return { from: offset, to, text: parts[i], number: i + 1 }
			offset = to + 1
		}
		const last = parts[parts.length - 1]
		return { from: text.length - last.length, to: text.length, text: last, number: parts.length }
	}
}

function makeLine(text: string) {
	const parts = text.split('\n')
	return (n: number) => {
		let offset = 0
		for (let i = 0; i < parts.length; i++) {
			const to = offset + parts[i].length
			if (i + 1 === n) return { from: offset, to, text: parts[i], number: n }
			offset = to + 1
		}
		throw new Error(`line ${n} out of range`)
	}
}

// Multi-cursor variant of makePlainEditor — several independent ranges,
// one of them marked main.
function makeMultiPlainEditor(lines: string[], heads: { line: number; ch: number }[], mainIndex: number) {
	const buf = [...lines]
	const posToOffset = (pos: { line: number; ch: number }) => pos.line * 1000 + pos.ch
	const offsetToPos = (offset: number) => ({ line: Math.floor(offset / 1000), ch: offset % 1000 })
	const selection = EditorSelection.create(heads.map(h => EditorSelection.cursor(posToOffset(h))), mainIndex)
	return {
		getLine: vi.fn((line: number) => buf[line] ?? ''),
		lineCount: vi.fn(() => buf.length),
		getRange: vi.fn((f: any, t: any) => buf[f.line].slice(f.ch, t.ch)),
		posToOffset: vi.fn(posToOffset),
		offsetToPos: vi.fn(offsetToPos),
		cm: {
			state: { selection },
			dispatch: vi.fn(),
			focus: vi.fn(),
		},
		activeCM: undefined,
		_buf: buf,
	}
}

// Multi-cursor variant of makeLPEditor — several independent inner ranges,
// one of them marked main.
function makeMultiLPEditor(innerText: string, heads: number[], mainIndex: number) {
	const dispatch = vi.fn()
	const inner = {
		state: {
			doc: {
				toString: () => innerText,
				lineAt: makeLineAt(innerText),
				line: makeLine(innerText),
				lines: innerText.split('\n').length,
				sliceString: (from: number, to?: number) => innerText.slice(from, to),
			},
			selection: EditorSelection.create(heads.map(h => EditorSelection.cursor(h)), mainIndex),
		},
		dispatch,
	}
	return {
		activeCM: inner,
		cm: {} as any,
		_innerDispatch: dispatch,
	}
}

// Variant of makeMultiPlainEditor for transformWordOrSelectionNonTable's
// own selection-mode ranges — heads there are empty cursor points; ranges
// here are real {from, to} spans (from === to still works, to mix
// selection-mode and word-mode ranges in the same call).
function makeMultiSelectionPlainEditor(
	lines: string[],
	ranges: { from: { line: number; ch: number }; to: { line: number; ch: number } }[],
	mainIndex: number,
) {
	const buf = [...lines]
	const posToOffset = (pos: { line: number; ch: number }) => pos.line * 1000 + pos.ch
	const offsetToPos = (offset: number) => ({ line: Math.floor(offset / 1000), ch: offset % 1000 })
	const selection = EditorSelection.create(
		ranges.map(r => EditorSelection.range(posToOffset(r.from), posToOffset(r.to))),
		mainIndex,
	)
	return {
		getLine: vi.fn((line: number) => buf[line] ?? ''),
		lineCount: vi.fn(() => buf.length),
		getRange: vi.fn((f: any, t: any) => {
			if (f.line === t.line) return buf[f.line].slice(f.ch, t.ch)
			const parts = [buf[f.line].slice(f.ch)]
			for (let i = f.line + 1; i < t.line; i++) parts.push(buf[i])
			parts.push(buf[t.line].slice(0, t.ch))
			return parts.join('\n')
		}),
		replaceRange: vi.fn(),
		posToOffset: vi.fn(posToOffset),
		offsetToPos: vi.fn(offsetToPos),
		cm: {
			state: { selection },
			dispatch: vi.fn(),
			focus: vi.fn(),
		},
		activeCM: undefined,
		_buf: buf,
	}
}

// Variant of makeMultiLPEditor for transformWordOrSelectionInTableLP's own
// selection-mode ranges — heads there are cursor points; ranges here are
// real {from, to} spans in the inner view's own raw offsets (from === to
// still works, to mix selection-mode and word-mode ranges in the same call).
function makeMultiSelectionLPEditor(innerText: string, ranges: { from: number; to: number }[], mainIndex: number) {
	const dispatch = vi.fn()
	const inner = {
		state: {
			doc: {
				toString: () => innerText,
				lineAt: makeLineAt(innerText),
				line: makeLine(innerText),
				lines: innerText.split('\n').length,
				sliceString: (from: number, to?: number) => innerText.slice(from, to),
			},
			selection: EditorSelection.create(ranges.map(r => EditorSelection.range(r.from, r.to)), mainIndex),
		},
		dispatch,
	}
	return {
		activeCM: inner,
		cm: {} as any,
		_innerDispatch: dispatch,
	}
}

function makeLPEditor(innerText: string, head: number, selFrom = head, selTo = head) {
	const dispatch = vi.fn()
	const inner = {
		state: {
			doc: {
				toString: () => innerText,
				lineAt: makeLineAt(innerText),
				line: makeLine(innerText),
				lines: innerText.split('\n').length,
				sliceString: (from: number, to?: number) => innerText.slice(from, to),
			},
			selection: EditorSelection.create([EditorSelection.range(selFrom, selTo)], 0),
		},
		dispatch,
	}
	return {
		activeCM: inner,
		cm: {} as any,
		_innerDispatch: dispatch,
	}
}

const upper = (s: string) => s.toUpperCase()
const lower = (s: string) => s.toLowerCase()
const capitalize = (s: string) => (UniversalCursorHotkeysPlugin as any).capitalizeText(s)


describe('capitalizeText', () => {
	it('capitalizes a single word', () => {
		expect(capitalize('hello')).toBe('Hello')
	})

	it('capitalizes each word independently, lowercasing the rest', () => {
		expect(capitalize('hELLO wORLD')).toBe('Hello World')
	})

	it('leaves whitespace and punctuation between words untouched', () => {
		expect(capitalize('foo-bar baz')).toBe('Foo-Bar Baz')
	})

	it('handles CJK-mixed text: only the Latin word gets capitalized (CJK has no case)', () => {
		expect(capitalize('日本語のａｐｐｌｅです')).toBe('日本語のＡｐｐｌｅです')
	})

	it('returns an empty string unchanged', () => {
		expect(capitalize('')).toBe('')
	})
})


describe('transformWord', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.isLivePreviewMode = vi.fn().mockReturnValue(false)
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)
	})

	describe('dispatcher', () => {
		it('routes to transformWordOrSelectionInTableLP when inTableCell, regardless of selection state', () => {
			plugin.transformWordOrSelectionInTableLP = vi.fn()
			const editor = makePlainEditor(['foo'], { line: 0, ch: 0 }, { line: 0, ch: 0 }, true)
			plugin.transformWord(editor, upper)
			expect(plugin.transformWordOrSelectionInTableLP).toHaveBeenCalledWith(editor, upper)
		})

		it('routes to transformWordInTableSourceMode when collapsed on a Source Mode table row', () => {
			plugin.transformWordInTableSourceMode = vi.fn()
			const editor = makePlainEditor(['| foo |'], { line: 0, ch: 2 })
			plugin.transformWord(editor, upper)
			expect(plugin.transformWordInTableSourceMode).toHaveBeenCalledWith(editor, upper, expect.objectContaining({ lineType: 'single' }))
		})

		it('routes to transformWordOrSelectionNonTable otherwise', () => {
			plugin.transformWordOrSelectionNonTable = vi.fn()
			const editor = makePlainEditor(['foo'], { line: 0, ch: 0 })
			plugin.transformWord(editor, upper)
			expect(plugin.transformWordOrSelectionNonTable).toHaveBeenCalledWith(editor, upper)
		})

		it('a non-empty selection on a Source Mode table row still routes to transformWordOrSelectionNonTable (the selection-vs-word choice is made per range, inside that function, not by this top-level gate)', () => {
			plugin.transformWordInTableSourceMode = vi.fn()
			plugin.transformWordOrSelectionNonTable = vi.fn()
			const editor = makePlainEditor(['| foo |'], { line: 0, ch: 2 }, { line: 0, ch: 5 })
			plugin.transformWord(editor, upper)
			expect(plugin.transformWordInTableSourceMode).not.toHaveBeenCalled()
			expect(plugin.transformWordOrSelectionNonTable).toHaveBeenCalledWith(editor, upper)
		})
	})

	// The selection-vs-word mode choice is made per range inside this
	// function (resolveWordOrSelectionRangeOuter), not once for the whole
	// command based on primary alone. Primary is only special in the one
	// case that structurally requires it: reaching a table row, which
	// collapses the whole selection via a hand-off (continueWordTransform
	// AfterLanding) the same way moveCursorWordPlainText's own
	// primary-crosses case already does.
	describe('transformWordOrSelectionNonTable', () => {
		describe('word mode (empty range)', () => {
			it('cursor mid-word: transforms the WHOLE word, not just from the cursor onward', () => {
				// 'he|llo' — real Emacs would only transform 'llo'; UCH transforms 'hello' whole.
				const editor = makePlainEditor(['hello world'], { line: 0, ch: 2 })
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(editor._buf[0]).toBe('HELLO world')
			})

			it('cursor before a word: transforms that word', () => {
				const editor = makePlainEditor(['  hello'], { line: 0, ch: 0 })
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(editor._buf[0]).toBe('  HELLO')
			})

			it('crosses blank lines to reach the next word', () => {
				const editor = makePlainEditor(['foo', '', '', 'bar'], { line: 0, ch: 3 })
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(editor._buf[3]).toBe('BAR')
			})

			it('at the document end with no further word: no-op', () => {
				const editor = makePlainEditor(['foo'], { line: 0, ch: 3 })
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(editor.replaceRange).not.toHaveBeenCalled()
			})

			it('reaching a table row: hands off via continueWordTransformAfterLanding', () => {
				plugin.landInRowEdgeCellForWord = vi.fn().mockReturnValue({ line: 1, ch: 2 })
				plugin.continueWordTransformAfterLanding = vi.fn()
				plugin.isPositionInTable = vi.fn((_e: any, line: number) => line === 1)
				const editor = makePlainEditor(['foo', '| bar |'], { line: 0, ch: 3 })
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(plugin.landInRowEdgeCellForWord).toHaveBeenCalledWith(editor, 1, true, false, false)
				expect(plugin.continueWordTransformAfterLanding).toHaveBeenCalledWith(editor, { line: 1, ch: 2 }, upper)
			})

			it('multi-cursor: each empty range in plain text transforms its own word search independently', () => {
				const editor = makeMultiPlainEditor(['foo bar', 'baz qux'], [{ line: 0, ch: 0 }, { line: 1, ch: 0 }], 0)
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 3, insert: 'FOO' }, { from: 1000, to: 1003, insert: 'BAZ' }],
					selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(1003)], 0),
					userEvent: 'input',
				})
			})

			it('multi-cursor: a secondary range that alone would reach a table is dropped, primary still transforms', () => {
				plugin.isPositionInTable = vi.fn((_e: any, line: number) => line === 1)
				// secondary at end of line 0 (ch 7) has nothing left on its own line and would reach the table row; main stays in plain text.
				const editor = makeMultiPlainEditor(['foo bar', '| baz |'], [{ line: 0, ch: 0 }, { line: 0, ch: 7 }], 0)
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 3, insert: 'FOO' }],
					selection: EditorSelection.create([EditorSelection.cursor(3)], 0),
					userEvent: 'input',
				})
			})

			it('multi-cursor: primary reaching a table hands off entirely, ignoring any secondary range', () => {
				plugin.isPositionInTable = vi.fn((_e: any, line: number) => line === 1)
				plugin.landInRowEdgeCellForWord = vi.fn().mockReturnValue({ line: 1, ch: 2 })
				plugin.continueWordTransformAfterLanding = vi.fn()
				// secondary at ch 0 would stay in plain text; main at ch 7 reaches the table row.
				const editor = makeMultiPlainEditor(['foo bar', '| baz |'], [{ line: 0, ch: 0 }, { line: 0, ch: 7 }], 1)
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(plugin.landInRowEdgeCellForWord).toHaveBeenCalledWith(editor, 1, true, false, false)
				expect(plugin.continueWordTransformAfterLanding).toHaveBeenCalledWith(editor, { line: 1, ch: 2 }, upper)
				expect(editor.cm.dispatch).not.toHaveBeenCalled()
			})
		})

		describe('selection mode (non-empty range)', () => {
			it('transforms the whole selection', () => {
				const editor = makeMultiSelectionPlainEditor(['hello world'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 11 } }], 0)
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 11, insert: 'HELLO WORLD' }],
					selection: EditorSelection.create([EditorSelection.cursor(11)], 0),
					userEvent: 'input',
				})
			})

			it('lowercase transform applies too (not just uppercase)', () => {
				const editor = makeMultiSelectionPlainEditor(['HELLO WORLD'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 11 } }], 0)
				plugin.transformWordOrSelectionNonTable(editor, lower)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 11, insert: 'hello world' }],
					selection: EditorSelection.create([EditorSelection.cursor(11)], 0),
					userEvent: 'input',
				})
			})

			it('a selection crossing a Source Mode table cell boundary is invalid: no-op when it is the only range', () => {
				// '| cell1 | cell2 |' — ch=2 in cell1 (open=0), ch=12 in cell2 (open=8)
				const editor = makeMultiSelectionPlainEditor(['| cell1 | cell2 |'], [{ from: { line: 0, ch: 2 }, to: { line: 0, ch: 12 } }], 0)
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(editor.cm.dispatch).not.toHaveBeenCalled()
			})

			// Set-mark category A: an operation that consumes/destroys the
			// active selection deactivates the mark.
			it('deactivates Set-mark (markActive)', () => {
				plugin.markActive = true
				const editor = makeMultiSelectionPlainEditor(['hello world'], [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 11 } }], 0)
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(plugin.markActive).toBe(false)
			})
		})

		describe('multi-cursor', () => {
			it('each non-empty range transforms its own selection independently', () => {
				const editor = makeMultiSelectionPlainEditor(
					['foo bar', 'baz qux'],
					[
						{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 } },
						{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 3 } },
					],
					0,
				)
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 3, insert: 'FOO' }, { from: 1000, to: 1003, insert: 'BAZ' }],
					selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(1003)], 0),
					userEvent: 'input',
				})
			})

			it('mixed mode: a selection range and a word-search range both transform in the same dispatch', () => {
				// Range 0 (main) has a real selection over "foo"; range 1 is a
				// plain cursor on line 1 and falls back to a forward word
				// search ("baz") — each range's own mode is resolved
				// independently, not uniformly for the whole command.
				const editor = makeMultiSelectionPlainEditor(
					['foo bar', 'baz qux'],
					[
						{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 } },
						{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 0 } },
					],
					0,
				)
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 3, insert: 'FOO' }, { from: 1000, to: 1003, insert: 'BAZ' }],
					selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(1003)], 0),
					userEvent: 'input',
				})
			})

			it('a secondary selection crossing a Source Mode table boundary is left untouched (not dropped); primary still transforms', () => {
				const editor = makeMultiSelectionPlainEditor(
					['foo bar', '| cell1 | cell2 |'],
					[
						{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 } },
						{ from: { line: 1, ch: 2 }, to: { line: 1, ch: 12 } },
					],
					0,
				)
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 3, insert: 'FOO' }],
					selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.range(1002, 1012)], 0),
					userEvent: 'input',
				})
			})

			it("primary's own selection crossing a Source Mode table boundary no longer blocks the whole command — a valid secondary still transforms", () => {
				const editor = makeMultiSelectionPlainEditor(
					['| cell1 | cell2 |', 'foo bar'],
					[
						{ from: { line: 0, ch: 2 }, to: { line: 0, ch: 12 } }, // main — invalid
						{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 3 } },  // secondary — valid
					],
					0,
				)
				plugin.transformWordOrSelectionNonTable(editor, upper)
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 1000, to: 1003, insert: 'FOO' }],
					selection: EditorSelection.create([EditorSelection.range(2, 12), EditorSelection.cursor(1003)], 0),
					userEvent: 'input',
				})
			})
		})
	})

	// Same shape as transformWordOrSelectionNonTable above; this cell's own
	// word search is already expressed in the INNER view's own
	// coordinates, so no inner/outer bridging is needed. A non-empty range
	// is always a valid selection here — a single cell's own inner view
	// can't span multiple cells/rows to begin with.
	describe('transformWordOrSelectionInTableLP', () => {
		describe('word mode (empty range)', () => {
			it('transforms the word within the current segment', () => {
				const editor = makeLPEditor('foo bar', 1)
				plugin.transformWordOrSelectionInTableLP(editor, upper)
				expect(editor._innerDispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 3, insert: 'FOO' }],
					selection: EditorSelection.create([EditorSelection.cursor(3)], 0),
					userEvent: 'input',
				})
			})

			it('capitalize: applies the transform to the whole matched word', () => {
				const editor = makeLPEditor('hello world', 8) // cursor inside "world"
				plugin.transformWordOrSelectionInTableLP(editor, capitalize)
				expect(editor._innerDispatch).toHaveBeenCalledWith({
					changes: [{ from: 6, to: 11, insert: 'World' }],
					selection: EditorSelection.create([EditorSelection.cursor(11)], 0),
					userEvent: 'input',
				})
			})

			it('crosses a <br> (\\n) to the next segment within the same cell', () => {
				// 'foo\nbar' — two segments; cursor at end of 'foo'
				const editor = makeLPEditor('foo\nbar', 3)
				plugin.transformWordOrSelectionInTableLP(editor, upper)
				expect(editor._innerDispatch).toHaveBeenCalledWith({
					changes: [{ from: 4, to: 7, insert: 'BAR' }],
					selection: EditorSelection.create([EditorSelection.cursor(7)], 0),
					userEvent: 'input',
				})
			})

			it('cell exhausted: hands off via continueWordTransformAfterLanding', () => {
				plugin.crossTableRowForWord = vi.fn().mockReturnValue({ line: 1, ch: 2 })
				plugin.continueWordTransformAfterLanding = vi.fn()
				const editor: any = makeLPEditor('foo', 3) // end of the only segment, nothing further
				// Outer coordinates needed for getCellIndex — reuse makePlainEditor's own getCursor/getLine
				const outer = makePlainEditor(['| foo |'], { line: 0, ch: 5 })
				editor.getCursor = outer.getCursor
				editor.getLine = outer.getLine
				plugin.transformWordOrSelectionInTableLP(editor, upper)
				expect(plugin.crossTableRowForWord).toHaveBeenCalledWith(editor, 0, true, false, false, true)
				expect(plugin.continueWordTransformAfterLanding).toHaveBeenCalledWith(editor, { line: 1, ch: 2 }, upper)
			})

			it('multi-cursor: a secondary range that alone would exit the cell is dropped, primary still transforms', () => {
				// 'foo\nbar' — secondary at the very end has nothing further in this cell; main stays within 'foo'.
				const editor = makeMultiLPEditor('foo\nbar', [1, 7], 0)
				plugin.transformWordOrSelectionInTableLP(editor, upper)
				expect(editor._innerDispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 3, insert: 'FOO' }],
					selection: EditorSelection.create([EditorSelection.cursor(3)], 0),
					userEvent: 'input',
				})
			})

			it('multi-cursor: primary exiting the cell hands off entirely, ignoring any secondary range', () => {
				plugin.crossTableRowForWord = vi.fn().mockReturnValue({ line: 1, ch: 2 })
				plugin.continueWordTransformAfterLanding = vi.fn()
				// main at the end of the only segment (exits); secondary within 'foo' would otherwise stay.
				const editor: any = makeMultiLPEditor('foo', [3, 1], 0)
				const outer = makePlainEditor(['| foo |'], { line: 0, ch: 5 })
				editor.getCursor = outer.getCursor
				editor.getLine = outer.getLine
				plugin.transformWordOrSelectionInTableLP(editor, upper)
				expect(plugin.crossTableRowForWord).toHaveBeenCalledWith(editor, 0, true, false, false, true)
				expect(plugin.continueWordTransformAfterLanding).toHaveBeenCalledWith(editor, { line: 1, ch: 2 }, upper)
				expect(editor._innerDispatch).not.toHaveBeenCalled()
			})

			it('no-op when not inside a table cell (activeCM === cm)', () => {
				const editor = { activeCM: {}, cm: {} }
				editor.activeCM = editor.cm
				expect(() => plugin.transformWordOrSelectionInTableLP(editor, upper)).not.toThrow()
			})
		})

		describe('selection mode (non-empty range)', () => {
			it('transforms the whole selection within the cell', () => {
				const editor = makeMultiSelectionLPEditor('hello world', [{ from: 0, to: 5 }], 0)
				plugin.transformWordOrSelectionInTableLP(editor, upper)
				expect(editor._innerDispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 5, insert: 'HELLO' }],
					selection: EditorSelection.create([EditorSelection.cursor(5)], 0),
					userEvent: 'input',
				})
			})

			it('deactivates Set-mark (markActive)', () => {
				plugin.markActive = true
				const editor = makeMultiSelectionLPEditor('hello world', [{ from: 0, to: 5 }], 0)
				plugin.transformWordOrSelectionInTableLP(editor, upper)
				expect(plugin.markActive).toBe(false)
			})
		})

		describe('multi-cursor', () => {
			it('each non-empty range within the cell transforms its own selection independently', () => {
				const editor = makeMultiSelectionLPEditor('foo bar', [{ from: 0, to: 3 }, { from: 4, to: 7 }], 0)
				plugin.transformWordOrSelectionInTableLP(editor, upper)
				expect(editor._innerDispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 3, insert: 'FOO' }, { from: 4, to: 7, insert: 'BAR' }],
					selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(7)], 0),
					userEvent: 'input',
				})
			})

			it('mixed mode: a selection range and a word-search range both transform in the same dispatch', () => {
				// Range 0 (main) has a real selection over "foo"; range 1 is a
				// plain cursor and falls back to a word search within the cell.
				const editor = makeMultiSelectionLPEditor('foo bar', [{ from: 0, to: 3 }, { from: 5, to: 5 }], 0)
				plugin.transformWordOrSelectionInTableLP(editor, upper)
				expect(editor._innerDispatch).toHaveBeenCalledWith({
					changes: [{ from: 0, to: 3, insert: 'FOO' }, { from: 4, to: 7, insert: 'BAR' }],
					selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(7)], 0),
					userEvent: 'input',
				})
			})
		})
	})

	describe('transformWordInTableSourceMode', () => {
		it('transforms the word within the scoped in-cell line', () => {
			const line = '| foo bar |'
			const editor = makePlainEditor([line], { line: 0, ch: 2 })
			const info = { lineType: 'single', startOfInCellLine: 2, endOfInCellLine: 9, isEmpty: false } as any
			plugin.transformWordInTableSourceMode(editor, upper, info)
			expect(editor._buf[0]).toBe('| FOO bar |')
		})

		it('cell exhausted: hands off via continueWordTransformAfterLanding', () => {
			plugin.crossTableRowForWord = vi.fn().mockReturnValue({ line: 1, ch: 2 })
			plugin.continueWordTransformAfterLanding = vi.fn()
			const line = '| foo |'
			const editor = makePlainEditor([line], { line: 0, ch: 5 }) // end of 'foo'
			const info = { lineType: 'single', startOfInCellLine: 2, endOfInCellLine: 5, isEmpty: false } as any
			plugin.transformWordInTableSourceMode(editor, upper, info)
			expect(plugin.crossTableRowForWord).toHaveBeenCalledWith(editor, 0, true, false, false, true)
			expect(plugin.continueWordTransformAfterLanding).toHaveBeenCalledWith(editor, { line: 1, ch: 2 }, upper)
		})
	})

	describe('continueWordTransformAfterLanding', () => {
		it('no-op when landing is null', () => {
			plugin.transformWordOrSelectionInTableLP = vi.fn()
			plugin.transformWordOrSelectionNonTable = vi.fn()
			const editor = makePlainEditor(['foo'], { line: 0, ch: 0 })
			plugin.continueWordTransformAfterLanding(editor, null, upper)
			expect(plugin.transformWordOrSelectionInTableLP).not.toHaveBeenCalled()
			expect(plugin.transformWordOrSelectionNonTable).not.toHaveBeenCalled()
		})

		it('hands off to transformWordOrSelectionInTableLP when landed inside a table cell', () => {
			plugin.transformWordOrSelectionInTableLP = vi.fn()
			const editor = makePlainEditor(['foo'], { line: 0, ch: 0 }, { line: 0, ch: 0 }, true)
			plugin.continueWordTransformAfterLanding(editor, { line: 0, ch: 0 }, upper)
			expect(plugin.transformWordOrSelectionInTableLP).toHaveBeenCalledWith(editor, upper)
		})

		it('hands off to transformWordInTableSourceMode when landed on a Source Mode table row', () => {
			plugin.transformWordInTableSourceMode = vi.fn()
			const editor = makePlainEditor(['| foo |'], { line: 0, ch: 0 })
			plugin.continueWordTransformAfterLanding(editor, { line: 0, ch: 2 }, upper)
			expect(plugin.transformWordInTableSourceMode).toHaveBeenCalledWith(editor, upper, expect.objectContaining({ lineType: 'single' }))
		})

		it('hands off to transformWordOrSelectionNonTable when landed on a genuine plain-text line (exited the table)', () => {
			plugin.transformWordOrSelectionNonTable = vi.fn()
			const editor = makePlainEditor(['plain text'], { line: 0, ch: 0 })
			plugin.continueWordTransformAfterLanding(editor, { line: 0, ch: 0 }, upper)
			expect(plugin.transformWordOrSelectionNonTable).toHaveBeenCalledWith(editor, upper)
		})
	})
})
