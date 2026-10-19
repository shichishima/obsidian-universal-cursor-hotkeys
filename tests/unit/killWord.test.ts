import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorSelection, ChangeSet } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../../src/main.ts'

// Kill word left/right (Emacs Alt-Backspace/Alt-D). Multi-cursor-safe,
// structured to mirror killLine.test.ts/killLineLP.test.ts's own split
// (plain text + Source Mode table unified under killWordOuter, LP table
// as its own cell-scoped loop). Source Mode detection/getInCellLineInfo
// now run for real inside killWordOuter — no more manually-constructed
// `info` objects passed directly to a standalone function.
//
// cm.state.changes uses the REAL ChangeSet.of (not a stub) — see
// killRegion.test.ts's own identical note on why this matters for
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
		getRange: vi.fn((f: any, t: any) => {
			if (f.line === t.line) return buf[f.line].slice(f.ch, t.ch)
			const parts = [buf[f.line].slice(f.ch)]
			for (let i = f.line + 1; i < t.line; i++) parts.push(buf[i])
			parts.push(buf[t.line].slice(0, t.ch))
			return parts.join('\n')
		}),
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

function makeSingleCursorEditor(lines: string[], line: number, ch: number) {
	return makeMultiSelectionPlainEditor(lines, [{ from: { line, ch }, to: { line, ch } }], 0)
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

function makeSingleCursorLPEditor(innerText: string, head: number) {
	return makeMultiSelectionLPEditor(innerText, [{ from: head, to: head }], 0)
}


describe('killWord', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.settings = { tableAwareSourceModeEditing: true }
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

	// Set-mark category A: an operation that consumes/destroys the active
	// selection deactivates the mark — unconditional at the top of the
	// dispatcher, before routing to any of the sub-variants below.
	it('deactivates Set-mark (markActive)', () => {
		plugin.markActive = true
		const editor = makeSingleCursorEditor(['foo bar'], 0, 1)
		plugin.killWord(editor, true)
		expect(plugin.markActive).toBe(false)
	})


	describe('outer -- plain text', () => {
		it('forward: kills from cursor to the end of the current word', () => {
			const editor = makeSingleCursorEditor(['foo bar'], 0, 1) // f|oo bar
			plugin.killWordOuter(editor, true)
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 1, to: 3, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(1)], 0),
				userEvent: 'delete',
			})
			expect(plugin.killCache).toBe('oo')
		})

		it('backward: kills from cursor to the start of the current word', () => {
			const editor = makeSingleCursorEditor(['foo bar'], 0, 6) // foo ba|r
			plugin.killWordOuter(editor, false)
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 4, to: 6, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(4)], 0),
				userEvent: 'delete',
			})
			expect(plugin.killCache).toBe('ba')
		})

		it('forward: no more words -- crosses blank lines to the next word', () => {
			const editor = makeSingleCursorEditor(['foo', '', 'bar'], 0, 3) // right after "foo"
			plugin.killWordOuter(editor, true)
			expect(plugin.killCache).toBe('\n\nbar')
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 3, to: 8, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(3)], 0),
				userEvent: 'delete',
			})
		})

		it('forward: at the document end with no further word -- no-op', () => {
			const editor = makeSingleCursorEditor(['foo bar'], 0, 7)
			plugin.killWordOuter(editor, true)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})

		it('backward: at the document start with no earlier word -- no-op', () => {
			const editor = makeSingleCursorEditor(['foo bar'], 0, 0)
			plugin.killWordOuter(editor, false)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})

		it('forward: stops at a table boundary instead of killing into its raw Markdown', () => {
			// Regression: without the isPositionInTable guard, the search treated
			// the table row's raw text (starting with '|') as ordinary
			// word/punctuation content and killed straight into it, deleting the
			// table's own opening '|' and corrupting it.
			plugin.isPositionInTable = vi.fn((_e: any, line: number) => line === 1)
			const editor = makeSingleCursorEditor(['foo', '| a | b |'], 0, 3) // right after "foo"
			plugin.killWordOuter(editor, true)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})

		it('backward: stops at a table boundary instead of killing into its raw Markdown', () => {
			plugin.isPositionInTable = vi.fn((_e: any, line: number) => line === 0)
			const editor = makeSingleCursorEditor(['| a | b |', 'foo'], 1, 0) // right before "foo"
			plugin.killWordOuter(editor, false)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})

		it('writes killCache to clipboard', () => {
			const editor = makeSingleCursorEditor(['foo bar'], 0, 1)
			plugin.killWordOuter(editor, true)
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith('oo')
		})

		it('consecutive forward kills APPEND to the kill cache', () => {
			plugin.isKillChaining = true
			plugin.killCache = 'foo'
			const editor = makeSingleCursorEditor(['foo bar'], 0, 1)
			plugin.killWordOuter(editor, true)
			expect(plugin.killCache).toBe('foooo')
		})

		it('consecutive backward kills PREPEND to the kill cache', () => {
			plugin.isKillChaining = true
			plugin.killCache = 'bar'
			const editor = makeSingleCursorEditor(['foo bar'], 0, 6)
			plugin.killWordOuter(editor, false)
			expect(plugin.killCache).toBe('babar')
		})

		it('sets isKillChaining to true after a successful kill', () => {
			const editor = makeSingleCursorEditor(['foo bar'], 0, 1)
			plugin.killWordOuter(editor, true)
			expect(plugin.isKillChaining).toBe(true)
		})

		describe('multi-cursor', () => {
			it('each range kills its own word independently, joined with \\n', () => {
				// 'foo bar\nbaz qux' (length 15). Range0 at ch=1 ("f|oo"),
				// range1 at (1,ch=1) ("b|az").
				const editor = makeMultiSelectionPlainEditor(
					['foo bar', 'baz qux'],
					[
						{ from: { line: 0, ch: 1 }, to: { line: 0, ch: 1 } },
						{ from: { line: 1, ch: 1 }, to: { line: 1, ch: 1 } },
					],
					0,
				)
				plugin.killWordOuter(editor, true)
				// range0: kills [1,3) "oo". range1 pre-change offset for ch=1 on
				// line 1 is 9; its own kill is [9,11) "az". After range0's own
				// 2-char deletion, range1's own from/to shift left by 2.
				expect(editor.cm.dispatch).toHaveBeenCalledWith({
					changes: [{ from: 1, to: 3, insert: '' }, { from: 9, to: 11, insert: '' }],
					selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(7)], 0),
					userEvent: 'delete',
				})
				expect(plugin.killCache).toBe('oo\naz')
			})
		})
	})


	describe('LP table cell', () => {
		it('forward: kills to the end of the current word within the segment', () => {
			const editor = makeSingleCursorLPEditor('foo bar', 1) // f|oo bar
			plugin.killWordInTableLP(editor, true)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: [{ from: 1, to: 3, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(1)], 0),
				userEvent: 'delete',
			})
			expect(plugin.killCache).toBe('oo')
		})

		it('backward: kills to the start of the current word within the segment', () => {
			const editor = makeSingleCursorLPEditor('foo bar', 6) // foo ba|r
			plugin.killWordInTableLP(editor, false)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: [{ from: 4, to: 6, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(4)], 0),
				userEvent: 'delete',
			})
			expect(plugin.killCache).toBe('ba')
		})

		it('forward: no word left in this segment -- crosses the <br> (\\n) into the next segment of the SAME cell', () => {
			const editor = makeSingleCursorLPEditor('foo\nbar', 3)
			plugin.killWordInTableLP(editor, true)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: [{ from: 3, to: 7, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(3)], 0),
				userEvent: 'delete',
			})
			expect(plugin.killCache).toBe('\nbar')
		})

		it('backward: no word left in this segment -- crosses the <br> (\\n) into the previous segment of the SAME cell', () => {
			const editor = makeSingleCursorLPEditor('foo\nbar', 4)
			plugin.killWordInTableLP(editor, false)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: [{ from: 0, to: 4, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(0)], 0),
				userEvent: 'delete',
			})
			expect(plugin.killCache).toBe('foo\n')
		})

		it('forward: no word left anywhere in the cell -- no-op at the true cell edge (last segment)', () => {
			const editor = makeSingleCursorLPEditor('foo\nbar', 7)
			plugin.killWordInTableLP(editor, true)
			expect(editor._innerDispatch).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})

		it('backward: no word left anywhere in the cell -- no-op at the true cell edge (first segment)', () => {
			const editor = makeSingleCursorLPEditor('foo\nbar', 0)
			plugin.killWordInTableLP(editor, false)
			expect(editor._innerDispatch).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})

		it('no-op when not inside a table cell (activeCM === cm)', () => {
			const editor = { activeCM: {}, cm: {} } as any
			editor.activeCM = editor.cm
			expect(() => plugin.killWordInTableLP(editor, true)).not.toThrow()
		})

		it('sets isKillChaining to true after a successful kill', () => {
			const editor = makeSingleCursorLPEditor('foo bar', 1)
			plugin.killWordInTableLP(editor, true)
			expect(plugin.isKillChaining).toBe(true)
		})

		describe('multi-cursor', () => {
			it('each range within the cell kills its own word independently, joined with \\n', () => {
				const editor = makeMultiSelectionLPEditor('foo bar', [{ from: 1, to: 1 }, { from: 5, to: 5 }], 0)
				plugin.killWordInTableLP(editor, true)
				// range0: [1,3) "oo". range1 (pre-change head 5, "b|ar") own
				// word span is [5,7) "ar"; after range0's 2-char deletion it
				// shifts to [3,5).
				expect(editor._innerDispatch).toHaveBeenCalledWith({
					changes: [{ from: 1, to: 3, insert: '' }, { from: 5, to: 7, insert: '' }],
					selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)], 0),
					userEvent: 'delete',
				})
				expect(plugin.killCache).toBe('oo\nar')
			})
		})
	})


	describe('outer -- Source Mode table row', () => {
		it('forward: kills a punctuation-run word span, normalizing an escaped pipe', () => {
			// '| a\|b c |' — cell content 'a\|b c' at [2,8): 'a'=word[2,3), '\|'=punctuation-word[3,5)
			const line = '| a\\|b c |'
			const editor = makeSingleCursorEditor([line], 0, 3) // cursor right after 'a', at the '\'
			plugin.killWordOuter(editor, true)
			expect(plugin.killCache).toBe('|') // '\|' normalized to '|'
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 3, to: 5, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(3)], 0),
				userEvent: 'delete',
			})
		})

		it('backward: kills to the start of the current word', () => {
			const line = '| foo bar |'
			const editor = makeSingleCursorEditor([line], 0, 8) // '| foo ba|r |'
			plugin.killWordOuter(editor, false)
			expect(plugin.killCache).toBe('ba')
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 6, to: 8, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(6)], 0),
				userEvent: 'delete',
			})
		})

		it('forward: no word left within a single-segment cell -- no-op at the true cell edge', () => {
			const line = '| foo |'
			const editor = makeSingleCursorEditor([line], 0, 5) // end of 'foo'
			plugin.killWordOuter(editor, true)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})

		// '| foo<br>bar |' -- one cell, two <br>-segments: "foo" at [2,5), "bar" at [9,12)
		const BR_LINE = '| foo<br>bar |'

		it('forward: no word left in this segment -- crosses the <br> into the next segment of the SAME cell', () => {
			const editor = makeSingleCursorEditor([BR_LINE], 0, 5) // right after "foo", at the <br> boundary
			plugin.killWordOuter(editor, true)
			expect(plugin.killCache).toBe('\nbar') // '<br>bar' normalized
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 5, to: 12, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(5)], 0),
				userEvent: 'delete',
			})
		})

		it('backward: no word left in this segment -- crosses the <br> into the previous segment of the SAME cell', () => {
			const editor = makeSingleCursorEditor([BR_LINE], 0, 9) // start of "bar"
			plugin.killWordOuter(editor, false)
			expect(plugin.killCache).toBe('foo\n') // 'foo<br>' normalized
			expect(editor.cm.dispatch).toHaveBeenCalledWith({
				changes: [{ from: 2, to: 9, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(2)], 0),
				userEvent: 'delete',
			})
		})

		it('forward: no word left anywhere in the cell -- no-op at the true cell edge (last segment)', () => {
			const editor = makeSingleCursorEditor([BR_LINE], 0, 12) // end of "bar"
			plugin.killWordOuter(editor, true)
			expect(editor.cm.dispatch).not.toHaveBeenCalled()
			expect(plugin.killCache).toBe('')
		})
	})
})
