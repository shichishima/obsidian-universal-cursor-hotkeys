import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// moveCursorHomeInTable — smart home step behavior inside LP table cells.
//
// Uses inner view (editor.activeCM) directly instead of outer string parsing.
// Inner view doc = cell content between pipes (including surrounding spaces).
// Inner head = outer ch - cellStart (cellStart = 1 for all test lines).
//
// 2-step (no prefix):  cursor → startOfSubLine → moveToLeftCellEnd
// 3-step (prefix):     cursor → smartHomeInner → startOfSubLine → moveToLeftCellEnd
//
// startOfSubLine = subLine.from + subLine.text.search(/\S|$/)  (skip leading space on first sub-line)
// smartHomeInner = startOfSubLine + getBeginningOfLinePosition(contentText, head - startOfSubLine)
//   where contentText = subLine.text.slice(startOfSubLine - subLine.from)

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

function makeInnerView(innerText: string, innerHead: number) {
	const dispatch = vi.fn()
	const inner = {
		state: {
			doc: {
				toString: () => innerText,
				lineAt: makeLineAt(innerText),
				lines: innerText.split('\n').length,
			},
			selection: { main: { head: innerHead } },
		},
		dispatch,
	}
	return { inner, dispatch }
}

// For these test lines, all cells start at outer ch 1 (pipe at 0),
// so innerHead = outerCh - 1 and innerText = line.slice(1, line.lastIndexOf('|')).
function makeEditor(ch: number, lineText: string) {
	const cellStart = 1
	const cellEnd   = lineText.lastIndexOf('|')
	const innerText = lineText.slice(cellStart, cellEnd)
	const innerHead = ch - cellStart
	const { inner, dispatch } = makeInnerView(innerText, innerHead)
	const outerCm = {}  // distinct object — activeCM !== cm signals LP inner view active
	return {
		getCursor: () => ({ line: 1, ch }),
		getLine:   () => lineText,
		exec:      () => {},
		activeCM:  inner,
		cm:        outerCm,
		_innerDispatch: dispatch,
	}
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

type Row = {
	desc:     string
	ch:       number
	settings: { smartHomeStandard: boolean; smartHomeAdvanced: boolean }
	// Expected: inner.dispatch called with this anchor, or moveToLeftCellEnd called.
	dispatchAnchor?: number   // inner coordinate
	callsLeftCell?: true
}

type Group = {
	line: string
	rows: Row[]
}

const S = (std: boolean, adv: boolean) =>
	({ smartHomeStandard: std, smartHomeAdvanced: adv })

// Line layouts and expected inner coords:
//   '| plain |'     — innerText=' plain ', startOfSubLine=1 ('p')
//                     no prefix → smartHome=startOfSubLine=1
//   '| - item |'    — innerText=' - item ', startOfSubLine=1 ('-')
//                     Standard prefix "- " → smartHomeInner=3 ('i')
//   '| # heading |' — innerText=' # heading ', startOfSubLine=1 ('#')
//                     Advanced prefix "# " → smartHomeInner=3 ('h')
const matrix: Group[] = [
	{
		line: '| plain |',
		rows: [
			{ desc: 'cursor in content',    ch: 5, settings: S(true, true), dispatchAnchor: 1 },
			{ desc: 'cursor at cell start', ch: 2, settings: S(true, true), callsLeftCell: true },
		],
	},
	{
		line: '| - item |',  // innerText: ' - item '; startOfSubLine=1; prefix "- "=2chars
		rows: [
			{ desc: 'Std OFF — moves to cell start',      ch: 7, settings: S(false, false), dispatchAnchor: 1 },
			{ desc: 'Std ON  — cursor past smart home',   ch: 7, settings: S(true,  false), dispatchAnchor: 3 },
			{ desc: 'Std ON  — cursor at smart home',     ch: 4, settings: S(true,  false), dispatchAnchor: 1 },
			{ desc: 'Std ON  — cursor at cell start',     ch: 2, settings: S(true,  false), callsLeftCell: true },
		],
	},
	{
		line: '| # heading |',  // innerText: ' # heading '; startOfSubLine=1; prefix "# "=2chars (Adv)
		rows: [
			{ desc: 'Std OFF         — moves to cell start',       ch: 8, settings: S(false, false), dispatchAnchor: 1 },
			{ desc: 'Std ON Adv OFF  — heading requires Advanced', ch: 8, settings: S(true,  false), dispatchAnchor: 1 },
			{ desc: 'Adv ON          — cursor past smart home',    ch: 8, settings: S(true,  true),  dispatchAnchor: 3 },
			{ desc: 'Adv ON          — cursor at smart home',      ch: 4, settings: S(true,  true),  dispatchAnchor: 1 },
			{ desc: 'Adv ON          — cursor at cell start',      ch: 2, settings: S(true,  true),  callsLeftCell: true },
		],
	},
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('moveCursorHomeInTable', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.moveToLeftCellEnd = vi.fn()
	})

	for (const group of matrix) {
		describe(group.line, () => {
			for (const row of group.rows) {
				it(row.desc, () => {
					plugin.settings = row.settings
					const editor = makeEditor(row.ch, group.line)
					plugin.moveCursorHomeInTable(editor)

					if (row.dispatchAnchor !== undefined) {
						expect(editor._innerDispatch).toHaveBeenCalledWith({
							selection: { anchor: row.dispatchAnchor },
							userEvent: 'move',
						})
						expect(plugin.moveToLeftCellEnd).not.toHaveBeenCalled()
					} else {
						expect(plugin.moveToLeftCellEnd).toHaveBeenCalled()
						expect(editor._innerDispatch).not.toHaveBeenCalled()
					}
				})
			}
		})
	}
})
