import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

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
		posToOffset: vi.fn((pos: { line: number; ch: number }) => pos.line * 1000 + pos.ch),
		cm: { dispatch: vi.fn(), focus: vi.fn() },
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
			selection: { main: { head, from: selFrom, to: selTo } },
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
		it('routes to transformSelection when a selection is active', () => {
			plugin.transformSelection = vi.fn()
			plugin.transformWordNonTable = vi.fn()
			const editor = makePlainEditor(['foo bar'], { line: 0, ch: 0 }, { line: 0, ch: 3 })
			plugin.transformWord(editor, upper)
			expect(plugin.transformSelection).toHaveBeenCalledWith(editor, upper)
			expect(plugin.transformWordNonTable).not.toHaveBeenCalled()
		})

		it('routes to transformWordInTableLP when inTableCell', () => {
			plugin.transformWordInTableLP = vi.fn()
			const editor = makePlainEditor(['foo'], { line: 0, ch: 0 }, { line: 0, ch: 0 }, true)
			plugin.transformWord(editor, upper)
			expect(plugin.transformWordInTableLP).toHaveBeenCalledWith(editor, upper)
		})

		it('routes to transformWordNonTable otherwise', () => {
			plugin.transformWordNonTable = vi.fn()
			const editor = makePlainEditor(['foo'], { line: 0, ch: 0 })
			plugin.transformWord(editor, upper)
			expect(plugin.transformWordNonTable).toHaveBeenCalledWith(editor, upper)
		})
	})

	describe('transformWordNonTable', () => {
		it('cursor mid-word: transforms the WHOLE word, not just from the cursor onward', () => {
			// 'he|llo' — real Emacs would only transform 'llo'; UCH transforms 'hello' whole.
			const editor = makePlainEditor(['hello world'], { line: 0, ch: 2 })
			plugin.transformWordNonTable(editor, upper)
			expect(editor._buf[0]).toBe('HELLO world')
		})

		it('cursor before a word: transforms that word', () => {
			const editor = makePlainEditor(['  hello'], { line: 0, ch: 0 })
			plugin.transformWordNonTable(editor, upper)
			expect(editor._buf[0]).toBe('  HELLO')
		})

		it('crosses blank lines to reach the next word', () => {
			const editor = makePlainEditor(['foo', '', '', 'bar'], { line: 0, ch: 3 })
			plugin.transformWordNonTable(editor, upper)
			expect(editor._buf[3]).toBe('BAR')
		})

		it('at the document end with no further word: no-op', () => {
			const editor = makePlainEditor(['foo'], { line: 0, ch: 3 })
			plugin.transformWordNonTable(editor, upper)
			expect(editor.replaceRange).not.toHaveBeenCalled()
		})

		it('reaching a table row: hands off via continueWordTransformAfterLanding', () => {
			plugin.landInRowEdgeCellForWord = vi.fn().mockReturnValue({ line: 1, ch: 2 })
			plugin.continueWordTransformAfterLanding = vi.fn()
			plugin.isPositionInTable = vi.fn((_e: any, line: number) => line === 1)
			const editor = makePlainEditor(['foo', '| bar |'], { line: 0, ch: 3 })
			plugin.transformWordNonTable(editor, upper)
			expect(plugin.landInRowEdgeCellForWord).toHaveBeenCalledWith(editor, 1, true, false, false)
			expect(plugin.continueWordTransformAfterLanding).toHaveBeenCalledWith(editor, { line: 1, ch: 2 }, upper)
		})
	})

	describe('transformWordInTableLP', () => {
		it('transforms the word within the current segment', () => {
			const editor = makeLPEditor('foo bar', 1)
			plugin.transformWordInTableLP(editor, upper)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: { from: 0, to: 3, insert: 'FOO' },
				selection: { anchor: 3 },
				userEvent: 'input',
			})
		})

		it('capitalize: applies the transform to the whole matched word', () => {
			const editor = makeLPEditor('hello world', 8) // cursor inside "world"
			plugin.transformWordInTableLP(editor, capitalize)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: { from: 6, to: 11, insert: 'World' },
				selection: { anchor: 11 },
				userEvent: 'input',
			})
		})

		it('crosses a <br> (\\n) to the next segment within the same cell', () => {
			// 'foo\nbar' — two segments; cursor at end of 'foo'
			const editor = makeLPEditor('foo\nbar', 3)
			plugin.transformWordInTableLP(editor, upper)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: { from: 4, to: 7, insert: 'BAR' },
				selection: { anchor: 7 },
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
			plugin.transformWordInTableLP(editor, upper)
			expect(plugin.crossTableRowForWord).toHaveBeenCalledWith(editor, 0, true, false, false)
			expect(plugin.continueWordTransformAfterLanding).toHaveBeenCalledWith(editor, { line: 1, ch: 2 }, upper)
		})

		it('no-op when not inside a table cell (activeCM === cm)', () => {
			const editor = { activeCM: {}, cm: {} }
			editor.activeCM = editor.cm
			expect(() => plugin.transformWordInTableLP(editor, upper)).not.toThrow()
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
			expect(plugin.crossTableRowForWord).toHaveBeenCalledWith(editor, 0, true, false, false)
			expect(plugin.continueWordTransformAfterLanding).toHaveBeenCalledWith(editor, { line: 1, ch: 2 }, upper)
		})
	})

	describe('continueWordTransformAfterLanding', () => {
		it('no-op when landing is null', () => {
			plugin.transformWordInTableLP = vi.fn()
			plugin.transformWordNonTable = vi.fn()
			const editor = makePlainEditor(['foo'], { line: 0, ch: 0 })
			plugin.continueWordTransformAfterLanding(editor, null, upper)
			expect(plugin.transformWordInTableLP).not.toHaveBeenCalled()
			expect(plugin.transformWordNonTable).not.toHaveBeenCalled()
		})

		it('hands off to transformWordInTableLP when landed inside a table cell', () => {
			plugin.transformWordInTableLP = vi.fn()
			const editor = makePlainEditor(['foo'], { line: 0, ch: 0 }, { line: 0, ch: 0 }, true)
			plugin.continueWordTransformAfterLanding(editor, { line: 0, ch: 0 }, upper)
			expect(plugin.transformWordInTableLP).toHaveBeenCalledWith(editor, upper)
		})

		it('hands off to transformWordInTableSourceMode when landed on a Source Mode table row', () => {
			plugin.transformWordInTableSourceMode = vi.fn()
			const editor = makePlainEditor(['| foo |'], { line: 0, ch: 0 })
			plugin.continueWordTransformAfterLanding(editor, { line: 0, ch: 2 }, upper)
			expect(plugin.transformWordInTableSourceMode).toHaveBeenCalledWith(editor, upper, expect.objectContaining({ lineType: 'single' }))
		})

		it('hands off to transformWordNonTable when landed on a genuine plain-text line (exited the table)', () => {
			plugin.transformWordNonTable = vi.fn()
			const editor = makePlainEditor(['plain text'], { line: 0, ch: 0 })
			plugin.continueWordTransformAfterLanding(editor, { line: 0, ch: 0 }, upper)
			expect(plugin.transformWordNonTable).toHaveBeenCalledWith(editor, upper)
		})
	})

	describe('transformSelection', () => {
		beforeEach(() => {
			plugin.getValidatedRegionText = vi.fn().mockReturnValue('foo bar') // any non-null value = valid
		})

		it('non-table: transforms the whole selection', () => {
			const editor = makePlainEditor(['hello world'], { line: 0, ch: 0 }, { line: 0, ch: 11 })
			plugin.transformSelection(editor, upper)
			expect(editor._buf[0]).toBe('HELLO WORLD')
		})

		it('LP table: transforms via inner dispatch', () => {
			const editor: any = makeLPEditor('hello world', 0, 0, 5)
			editor.inTableCell = true
			editor.getCursor = vi.fn(() => ({ line: 0, ch: 0 }))
			plugin.transformSelection(editor, upper)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: { from: 0, to: 5, insert: 'HELLO' },
				selection: { anchor: 5 },
				userEvent: 'input',
			})
		})

		it('lowercase-word transform applies too (not just uppercase)', () => {
			const editor = makePlainEditor(['HELLO WORLD'], { line: 0, ch: 0 }, { line: 0, ch: 11 })
			plugin.transformSelection(editor, lower)
			expect(editor._buf[0]).toBe('hello world')
		})

		it('invalid selection (rejected by getValidatedRegionText): no-op', () => {
			plugin.getValidatedRegionText = vi.fn().mockReturnValue(null)
			const editor = makePlainEditor(['hello world'], { line: 0, ch: 0 }, { line: 0, ch: 11 })
			plugin.transformSelection(editor, upper)
			expect(editor.replaceRange).not.toHaveBeenCalled()
		})
	})
})
