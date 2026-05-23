import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// killLineInTableLP — LP table kill-line behavior using inner view.
//
// Inner view doc = cell content (no pipes, \n for <br>).
// Three cases:
//   head < endOfSubLine            → kill text to sub-line content end
//   !isLastSubLine && head at \n   → kill \n (join sub-lines; smartJoin trims next sub-line start)
//   isLastSubLine && head >= end   → no-op (cell boundary)

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

function makeEditor(innerText: string, head: number) {
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

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

type Row = {
	desc:         string
	head:         number
	smartJoin?:   boolean
	dispatch?:    { changes: { from: number; to: number; insert: string }; selection: { anchor: number }; userEvent: string }
	killText?:    string   // expected killCache; undefined = no-op (cache stays '')
}

type Group = {
	innerText: string
	rows:      Row[]
}

// Single sub-line: ' hello ' (7 chars)
//   trimEnd=' hello' (len=6) → endOfSubLine=6
//
// Two sub-lines: ' a\n b ' (6 chars: indices 0=' ',1='a',2='\n',3=' ',4='b',5=' ')
//   sub-line 1: from=0, to=2, text=' a'  → endOfSubLine=2 (=subLine.to)
//   sub-line 2: from=3, to=6, text=' b ' → endOfSubLine=5 (trimEnd=' b', len=2)
const matrix: Group[] = [
	{
		innerText: ' hello ',
		rows: [
			{ desc: 'cursor in middle → kill to content end',
			  head: 2,
			  dispatch: { changes: { from: 2, to: 6, insert: '' }, selection: { anchor: 2 }, userEvent: 'delete' },
			  killText: 'ello' },
			{ desc: 'cursor at content end → no-op',      head: 6 },
			{ desc: 'cursor in trailing space → no-op',   head: 7 },
		],
	},
	{
		innerText: ' a\n b ',
		rows: [
			{ desc: 'first sub-line: cursor in content → kill to sub-line end',
			  head: 1,
			  dispatch: { changes: { from: 1, to: 2, insert: '' }, selection: { anchor: 1 }, userEvent: 'delete' },
			  killText: 'a' },
			{ desc: 'first sub-line: cursor at \\n, smartJoin OFF → kill \\n only',
			  head: 2,
			  dispatch: { changes: { from: 2, to: 3, insert: '' }, selection: { anchor: 2 }, userEvent: 'delete' },
			  killText: '\n' },
			{ desc: 'first sub-line: cursor at \\n, smartJoin ON → kill \\n + leading space',
			  head: 2, smartJoin: true,
			  dispatch: { changes: { from: 2, to: 4, insert: '' }, selection: { anchor: 2 }, userEvent: 'delete' },
			  killText: '\n' },
			{ desc: 'last sub-line: cursor in content → kill to content end',
			  head: 4,
			  dispatch: { changes: { from: 4, to: 5, insert: '' }, selection: { anchor: 4 }, userEvent: 'delete' },
			  killText: 'b' },
			{ desc: 'last sub-line: cursor at content end → no-op', head: 5 },
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
					const editor = makeEditor(group.innerText, row.head)
					plugin.killLineInTableLP(editor)

					if (row.dispatch !== undefined) {
						expect(editor._innerDispatch).toHaveBeenCalledWith(row.dispatch)
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
})
