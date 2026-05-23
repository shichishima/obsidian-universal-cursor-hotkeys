import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// moveCursorEndInTable — END behavior inside LP table cells.
//
// Uses inner view (editor.activeCM) directly.
// Inner view doc sub-line boundaries:
//   isLastSubLine: endOfSubLine = subLine.from + subLine.text.trimEnd().length
//   others:        endOfSubLine = subLine.to  (position of the \n separator)
//
// Behavior:
//   head < endOfSubLine  → dispatch to endOfSubLine
//   head >= endOfSubLine, last sub-line  → moveToRightCellStart
//   head >= endOfSubLine, non-last       → no-op

// ---------------------------------------------------------------------------
// Inner view mock helpers
// ---------------------------------------------------------------------------

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
			},
			selection: { main: { head } },
		},
		dispatch,
	}
	return {
		activeCM: inner,
		cm: {},
		_innerDispatch: dispatch,
	}
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

type Row = {
	desc:          string
	head:          number
	dispatchAnchor?: number  // inner coordinate; undefined = not called
	callsRightCell?: true    // moveToRightCellStart should be called
	// (neither) = no-op: neither dispatch nor moveToRightCellStart
}

type Group = {
	innerText: string
	rows: Row[]
}

// Single-line cell: innerText=' plain ' (7 chars)
//   endOfSubLine = trimEnd(' plain ').length = 6
//
// Multi-line cell: innerText=' text1\n text2 '
//   sub-line 1: from=0, to=6, text=' text1'  → endOfSubLine=6 (subLine.to)
//   sub-line 2: from=7, to=14, text=' text2 ' → endOfSubLine=13 (7 + trimEnd=6)
const matrix: Group[] = [
	{
		innerText: ' plain ',
		rows: [
			{ desc: 'cursor in middle → dispatch to end',  head: 4, dispatchAnchor: 6 },
			{ desc: 'cursor at start  → dispatch to end',  head: 1, dispatchAnchor: 6 },
			{ desc: 'cursor at end    → moveToRightCellStart', head: 6, callsRightCell: true },
		],
	},
	{
		innerText: ' text1\n text2 ',
		rows: [
			{ desc: 'first sub-line: middle → dispatch to sub-line end', head: 3,  dispatchAnchor: 6 },
			{ desc: 'first sub-line: at end → no-op',                    head: 6 },
			{ desc: 'last sub-line: middle  → dispatch to sub-line end', head: 9,  dispatchAnchor: 13 },
			{ desc: 'last sub-line: at end  → moveToRightCellStart',     head: 13, callsRightCell: true },
		],
	},
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('moveCursorEndInTable', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.moveToRightCellStart  = vi.fn()
	})

	for (const group of matrix) {
		describe(`innerText: '${group.innerText}'`, () => {
			for (const row of group.rows) {
				it(row.desc, () => {
					const editor = makeEditor(group.innerText, row.head)
					plugin.moveCursorEndInTable(editor)

					if (row.dispatchAnchor !== undefined) {
						expect(editor._innerDispatch).toHaveBeenCalledWith({ selection: { anchor: row.dispatchAnchor }, userEvent: 'move' })
						expect(plugin.moveToRightCellStart).not.toHaveBeenCalled()
					} else if (row.callsRightCell) {
						expect(plugin.moveToRightCellStart).toHaveBeenCalled()
						expect(editor._innerDispatch).not.toHaveBeenCalled()
					} else {
						expect(editor._innerDispatch).not.toHaveBeenCalled()
						expect(plugin.moveToRightCellStart).not.toHaveBeenCalled()
					}
				})
			}
		})
	}
})
