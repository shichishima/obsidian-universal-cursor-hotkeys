import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// Kill word left/right (Emacs Alt-Backspace/Alt-D). Structured to mirror
// killLine.test.ts/killLineLP.test.ts's own three-branch split (plain text,
// LP table, Source Mode table) — each tested by calling the branch method
// directly, same as those files do.

function makePlainEditor(lines: string[], cursorLine: number, cursorCh: number) {
	const buf = [...lines]
	return {
		getCursor: vi.fn(() => ({ line: cursorLine, ch: cursorCh })),
		getLine: vi.fn((line: number) => buf[line] ?? ''),
		lineCount: vi.fn(() => buf.length),
		getRange: vi.fn((from: any, to: any) => {
			if (from.line === to.line) return buf[from.line].slice(from.ch, to.ch)
			const parts = [buf[from.line].slice(from.ch)]
			for (let i = from.line + 1; i < to.line; i++) parts.push(buf[i])
			parts.push(buf[to.line].slice(0, to.ch))
			return parts.join('\n')
		}),
		replaceRange: vi.fn((replacement: string, from: any, to: any) => {
			if (from.line === to.line) {
				buf[from.line] = buf[from.line].slice(0, from.ch) + replacement + buf[from.line].slice(to.ch)
			} else {
				const merged = buf[from.line].slice(0, from.ch) + replacement + buf[to.line].slice(to.ch)
				buf.splice(from.line, to.line - from.line + 1, merged)
			}
		}),
		inTableCell: false,
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

function makeLPEditor(innerText: string, head: number) {
	const dispatch = vi.fn()
	const inner = {
		state: {
			doc: {
				toString: () => innerText,
				lineAt: makeLineAt(innerText),
				lines: innerText.split('\n').length,
				sliceString: (from: number, to?: number) => innerText.slice(from, to),
			},
			selection: { main: { head } },
		},
		dispatch,
	}
	return {
		activeCM: inner,
		cm: {} as any,
		_innerDispatch: dispatch,
	}
}


describe('killWord', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.isKillChaining    = false
		plugin.isDispatchingKill = false
		plugin.killCache         = ''
		plugin.isLivePreviewMode = vi.fn().mockReturnValue(false)
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)

		vi.stubGlobal('navigator', {
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})


	// ===========================================================================
	// killWordNonTable
	// ===========================================================================

	describe('killWordNonTable', () => {
		it('forward: kills from cursor to the end of the current word', () => {
			const editor = makePlainEditor(['foo bar'], 0, 1) // f|oo bar
			plugin.killWordNonTable(editor, true)
			expect(editor._buf[0]).toBe('f bar')
			expect(plugin.killCache).toBe('oo')
		})

		it('backward: kills from cursor to the start of the current word', () => {
			const editor = makePlainEditor(['foo bar'], 0, 6) // foo ba|r
			plugin.killWordNonTable(editor, false)
			expect(editor._buf[0]).toBe('foo r')
			expect(plugin.killCache).toBe('ba')
		})

		it('forward: no more words — crosses blank lines to the next word', () => {
			const editor = makePlainEditor(['foo', '', 'bar'], 0, 3) // right after "foo"
			plugin.killWordNonTable(editor, true)
			expect(plugin.killCache).toBe('\n\nbar')
			expect(editor.replaceRange).toHaveBeenCalledWith('', { line: 0, ch: 3 }, { line: 2, ch: 3 })
		})

		it('forward: at the document end with no further word — no-op', () => {
			const editor = makePlainEditor(['foo bar'], 0, 7)
			plugin.killWordNonTable(editor, true)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})

		it('backward: at the document start with no earlier word — no-op', () => {
			const editor = makePlainEditor(['foo bar'], 0, 0)
			plugin.killWordNonTable(editor, false)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})

		it('forward: stops at a table boundary instead of killing into its raw Markdown', () => {
			// Regression: without the isPositionInTable guard, the search treated
			// the table row's raw text (starting with '|') as ordinary
			// word/punctuation content and killed straight into it, deleting the
			// table's own opening '|' and corrupting it.
			plugin.isPositionInTable = vi.fn((_e: any, line: number) => line === 1)
			const editor = makePlainEditor(['foo', '| a | b |'], 0, 3) // right after "foo"
			plugin.killWordNonTable(editor, true)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})

		it('backward: stops at a table boundary instead of killing into its raw Markdown', () => {
			plugin.isPositionInTable = vi.fn((_e: any, line: number) => line === 0)
			const editor = makePlainEditor(['| a | b |', 'foo'], 1, 0) // right before "foo"
			plugin.killWordNonTable(editor, false)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})

		it('writes killCache to clipboard', () => {
			const editor = makePlainEditor(['foo bar'], 0, 1)
			plugin.killWordNonTable(editor, true)
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith('oo')
		})

		it('consecutive forward kills APPEND to the kill cache', () => {
			plugin.isKillChaining = true
			plugin.killCache = 'foo'
			const editor = makePlainEditor(['foo bar'], 0, 1)
			plugin.killWordNonTable(editor, true)
			expect(plugin.killCache).toBe('foooo')
		})

		it('consecutive backward kills PREPEND to the kill cache', () => {
			plugin.isKillChaining = true
			plugin.killCache = 'bar'
			const editor = makePlainEditor(['foo bar'], 0, 6)
			plugin.killWordNonTable(editor, false)
			expect(plugin.killCache).toBe('babar')
		})

		it('sets isKillChaining to true after a successful kill', () => {
			const editor = makePlainEditor(['foo bar'], 0, 1)
			plugin.killWordNonTable(editor, true)
			expect(plugin.isKillChaining).toBe(true)
		})
	})


	// ===========================================================================
	// killWordInTableLP
	// ===========================================================================

	describe('killWordInTableLP', () => {
		it('forward: kills to the end of the current word within the segment', () => {
			const editor = makeLPEditor('foo bar', 1) // f|oo bar
			plugin.killWordInTableLP(editor, true)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: { from: 1, to: 3, insert: '' },
				selection: { anchor: 1 },
				userEvent: 'delete',
			})
			expect(plugin.killCache).toBe('oo')
		})

		it('backward: kills to the start of the current word within the segment', () => {
			const editor = makeLPEditor('foo bar', 6) // foo ba|r
			plugin.killWordInTableLP(editor, false)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: { from: 4, to: 6, insert: '' },
				selection: { anchor: 4 },
				userEvent: 'delete',
			})
			expect(plugin.killCache).toBe('ba')
		})

		it('forward: no word left in this segment — no-op, does not cross to the next segment', () => {
			// 'foo\nbar' — two segments 'foo' and 'bar'; cursor at end of 'foo'
			const editor = makeLPEditor('foo\nbar', 3)
			plugin.killWordInTableLP(editor, true)
			expect(editor._innerDispatch).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})

		it('backward: no word left in this segment — no-op, does not cross to the previous segment', () => {
			// 'foo\nbar' — cursor at start of 'bar' (segment 2)
			const editor = makeLPEditor('foo\nbar', 4)
			plugin.killWordInTableLP(editor, false)
			expect(editor._innerDispatch).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})

		it('no-op when not inside a table cell (activeCM === cm)', () => {
			const editor = { activeCM: {}, cm: {} }
			editor.activeCM = editor.cm
			plugin.killWordInTableLP(editor, true)
			expect(plugin.killCache).toBe('')
		})

		it('sets isKillChaining to true after a successful kill', () => {
			const editor = makeLPEditor('foo bar', 1)
			plugin.killWordInTableLP(editor, true)
			expect(plugin.isKillChaining).toBe(true)
		})
	})


	// ===========================================================================
	// killWordInTableSourceMode
	// ===========================================================================

	describe('killWordInTableSourceMode', () => {
		it('forward: kills a punctuation-run word span, normalizing an escaped pipe', () => {
			// '| a\|b c |' — cell content 'a\|b c' at [2,8): 'a'=word[2,3), '\|'=punctuation-word[3,5)
			const line = '| a\\|b c |'
			const editor = makePlainEditor([line], 0, 3) // cursor right after 'a', at the '\'
			const info = { lineType: 'single', startOfInCellLine: 2, endOfInCellLine: 8, isEmpty: false } as any
			plugin.killWordInTableSourceMode(editor, true, info)
			expect(plugin.killCache).toBe('|') // '\|' normalized to '|'
			expect(editor.replaceRange).toHaveBeenCalledWith('', { line: 0, ch: 3 }, { line: 0, ch: 5 })
		})

		it('backward: kills to the start of the current word', () => {
			const line = '| foo bar |'
			const editor = makePlainEditor([line], 0, 8) // '| foo ba|r |'
			const info = { lineType: 'single', startOfInCellLine: 2, endOfInCellLine: 9, isEmpty: false } as any
			plugin.killWordInTableSourceMode(editor, false, info)
			expect(plugin.killCache).toBe('ba')
			expect(editor.replaceRange).toHaveBeenCalledWith('', { line: 0, ch: 6 }, { line: 0, ch: 8 })
		})

		it('forward: no word left within the scoped in-cell line — no-op', () => {
			const line = '| foo |'
			const editor = makePlainEditor([line], 0, 5) // end of 'foo'
			const info = { lineType: 'single', startOfInCellLine: 2, endOfInCellLine: 5, isEmpty: false } as any
			plugin.killWordInTableSourceMode(editor, true, info)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})
	})
})
