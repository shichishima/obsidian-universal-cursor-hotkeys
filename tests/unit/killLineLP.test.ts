import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorSelection, ChangeSet } from '@codemirror/state'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../../src/main.ts'

// killLineInTableLP — LP table kill-line behavior using the cell's own
// inner view, now multi-range-safe. Three per-range outcomes:
//   head < endOfSubLine            -> kill text to sub-line content end
//   !isLastSubLine && head at \n   -> kill \n (join sub-lines; smartJoin trims next sub-line start)
//   isLastSubLine && head >= end   -> no-op (cell boundary) -- left in place, not removed
//
// cm.state.changes uses the REAL ChangeSet.of (not a stub) — see
// killRegion.test.ts's own identical note on why this matters for
// multi-range dispatches.

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

function makeMultiSelectionLPEditor(innerText: string, ranges: { from: number; to: number }[], mainIndex: number) {
	const dispatch = vi.fn()
	const inner = {
		state: {
			doc: {
				toString: () => innerText,
				lineAt: makeLineAt(innerText),
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

function makeSingleCursorEditor(innerText: string, head: number) {
	return makeMultiSelectionLPEditor(innerText, [{ from: head, to: head }], 0)
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

type Row = {
	desc:         string
	head:         number
	smartJoin?:   boolean
	dispatch?:    { changes: { from: number; to: number; insert: string }; killCursor: number }
	killText?:    string   // expected killCache; undefined = no-op (cache stays '')
}

type Group = {
	innerText: string
	rows:      Row[]
}

// Single sub-line: ' hello ' (7 chars)
//   trimEnd=' hello' (len=6) -> endOfSubLine=6
//
// Two sub-lines: ' a\n b ' (6 chars: indices 0=' ',1='a',2='\n',3=' ',4='b',5=' ')
//   sub-line 1: from=0, to=2, text=' a'  -> endOfSubLine=2 (=subLine.to)
//   sub-line 2: from=3, to=6, text=' b ' -> endOfSubLine=5 (trimEnd=' b', len=2)
const matrix: Group[] = [
	{
		innerText: ' hello ',
		rows: [
			{ desc: 'cursor in middle -> kill to content end',
			  head: 2,
			  dispatch: { changes: { from: 2, to: 6, insert: '' }, killCursor: 2 },
			  killText: 'ello' },
			{ desc: 'cursor at content end -> no-op',      head: 6 },
			{ desc: 'cursor in trailing space -> no-op',   head: 7 },
		],
	},
	{
		innerText: ' a\n b ',
		rows: [
			{ desc: 'first sub-line: cursor in content -> kill to sub-line end',
			  head: 1,
			  dispatch: { changes: { from: 1, to: 2, insert: '' }, killCursor: 1 },
			  killText: 'a' },
			{ desc: 'first sub-line: cursor at \\n, smartJoin OFF -> kill \\n only',
			  head: 2,
			  dispatch: { changes: { from: 2, to: 3, insert: '' }, killCursor: 2 },
			  killText: '\n' },
			{ desc: 'first sub-line: cursor at \\n, smartJoin ON -> kill \\n + leading space',
			  head: 2, smartJoin: true,
			  dispatch: { changes: { from: 2, to: 4, insert: '' }, killCursor: 2 },
			  // The trimmed leading space is deleted from the cell too, so it
			  // must be in the kill cache alongside the newline.
			  killText: '\n ' },
			{ desc: 'last sub-line: cursor in content -> kill to content end',
			  head: 4,
			  dispatch: { changes: { from: 4, to: 5, insert: '' }, killCursor: 4 },
			  killText: 'b' },
			{ desc: 'last sub-line: cursor at content end -> no-op', head: 5 },
		],
	},
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('killLineInTableLP', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, smartJoin: false, visualLineMovement: true, crossRowNavigation: true }
		plugin.isKillChaining     = false
		plugin.isDispatchingKill  = false
		plugin.killCache          = ''
		vi.stubGlobal('navigator', {
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	for (const group of matrix) {
		describe(`innerText: '${group.innerText}'`, () => {
			for (const row of group.rows) {
				it(row.desc, () => {
					plugin.settings = { ...plugin.settings, smartJoin: row.smartJoin ?? false }
					const editor = makeSingleCursorEditor(group.innerText, row.head)
					plugin.killLineInTableLP(editor)

					if (row.dispatch !== undefined) {
						expect(editor._innerDispatch).toHaveBeenCalledWith({
							changes: [row.dispatch.changes],
							selection: EditorSelection.create([EditorSelection.cursor(row.dispatch.killCursor)], 0),
							userEvent: 'delete',
						})
						expect(plugin.killCache).toBe(row.killText)
						expect(plugin.isKillChaining).toBe(true)
					} else {
						expect(editor._innerDispatch).not.toHaveBeenCalled()
						expect(plugin.killCache).toBe('')
						expect(plugin.isKillChaining).toBe(false)
					}
				})
			}
		})
	}

	describe('multi-cursor', () => {
		it('each range within the cell kills its own line-end independently, joined with \\n', () => {
			// ' a\n b ' (6 chars). Two cursors: in first sub-line's content (1)
			// and in last sub-line's content (4).
			const editor = makeMultiSelectionLPEditor(' a\n b ', [{ from: 1, to: 1 }, { from: 4, to: 4 }], 0)
			plugin.killLineInTableLP(editor)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: [{ from: 1, to: 2, insert: '' }, { from: 4, to: 5, insert: '' }],
				// range2's own kill-start (4) shifts left by 1 (range1's own
				// 1-char deletion earlier in the document) -> 3, not the
				// stale pre-change 4.
				selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)], 0),
				userEvent: 'delete',
			})
			expect(plugin.killCache).toBe('a\nb')
		})

		it('a no-op secondary (at the cell boundary) is left in place; primary still kills', () => {
			const editor = makeMultiSelectionLPEditor(' a\n b ', [{ from: 1, to: 1 }, { from: 5, to: 5 }], 0)
			plugin.killLineInTableLP(editor)
			expect(editor._innerDispatch).toHaveBeenCalledWith({
				changes: [{ from: 1, to: 2, insert: '' }],
				selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(4)], 0),
				userEvent: 'delete',
			})
		})

		it('no-op when not inside a table cell (activeCM === cm)', () => {
			const editor = { activeCM: {}, cm: {} } as any
			editor.activeCM = editor.cm
			expect(() => plugin.killLineInTableLP(editor)).not.toThrow()
		})
	})
})
