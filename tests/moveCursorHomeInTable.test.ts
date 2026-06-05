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
// VL step (new):       when visualLineMovement ON and VL2+, cursor → VL left edge first
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

// Inner view mock with coordsAtPos / posAtCoords for VL-step tests.
function makeInnerViewWithCoords(
	innerText: string,
	innerHead: number,
	coordsTop: number | null,
	vlStartPos: number | null,
) {
	const { inner, dispatch } = makeInnerView(innerText, innerHead)
	const coordsAtPos = vi.fn((pos: number) =>
		pos === innerHead && coordsTop !== null
			? { top: coordsTop, bottom: coordsTop + 18, left: 100, right: 200 }
			: null
	)
	const posAtCoords = vi.fn(() => vlStartPos)
	return { inner: { ...inner, coordsAtPos, posAtCoords }, dispatch, coordsAtPos, posAtCoords }
}

function makeEditorWithCoords(
	ch: number,
	lineText: string,
	coordsTop: number | null,
	vlStartPos: number | null,
) {
	const cellStart = 1
	const cellEnd   = lineText.lastIndexOf('|')
	const innerText = lineText.slice(cellStart, cellEnd)
	const innerHead = ch - cellStart
	const { inner, dispatch, coordsAtPos, posAtCoords } = makeInnerViewWithCoords(innerText, innerHead, coordsTop, vlStartPos)
	const outerCm = {}
	return {
		getCursor: () => ({ line: 1, ch }),
		getLine:   () => lineText,
		exec:      () => {},
		activeCM:  inner,
		cm:        outerCm,
		_innerDispatch: dispatch,
		_coordsAtPos:   coordsAtPos,
		_posAtCoords:   posAtCoords,
	}
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


// ===========================================================================
// VL step tests — visual-line-aware home inside LP table cells
// ===========================================================================
//
// Inner doc: ' long content' (length 13), startOfSubLine=1 ('l')
// Tests use ch=10 → innerHead=9, which is to the right of startOfSubLine.
// vlStartPos=5 represents the VL2+ left edge (> startOfSubLine=1).

const VL_LINE = '| long content |'
// innerText = ' long content ', startOfSubLine=1, smartHomeInner=1 (no prefix)

describe('moveCursorHomeInTable — VL step', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.moveToLeftCellEnd = vi.fn()
	})

	const vlOn  = { visualLineMovement: true,  smartHomeStandard: true, smartHomeAdvanced: false }
	const vlOff = { visualLineMovement: false, smartHomeStandard: true, smartHomeAdvanced: false }

	it('VL2+, not at VL edge → dispatch to vlStartPos', () => {
		plugin.settings = vlOn
		// head=9, vlStartPos=5 (> startOfSubLine=1, < head=9) → VL step fires
		const editor = makeEditorWithCoords(10, VL_LINE, 100, 5)
		plugin.moveCursorHomeInTable(editor)
		expect(editor._innerDispatch).toHaveBeenCalledWith({ selection: { anchor: 5 }, userEvent: 'move' })
	})

	it('VL2+, already at VL edge (head === vlStartPos) → fall through to smart home', () => {
		plugin.settings = vlOn
		// head=5, vlStartPos=5 → head > vlStartPos is false → skip VL step
		const editor = makeEditorWithCoords(6, VL_LINE, 100, 5)
		plugin.moveCursorHomeInTable(editor)
		// smart home: smartHomeInner=1 → dispatch(1)
		expect(editor._innerDispatch).toHaveBeenCalledWith({ selection: { anchor: 1 }, userEvent: 'move' })
	})

	it('VL1 (vlStartPos <= startOfSubLine) → fall through to smart home', () => {
		plugin.settings = vlOn
		// head=9, vlStartPos=1 (= startOfSubLine) → vlStartPos > startOfSubLine is false → skip VL step
		const editor = makeEditorWithCoords(10, VL_LINE, 100, 1)
		plugin.moveCursorHomeInTable(editor)
		expect(editor._innerDispatch).toHaveBeenCalledWith({ selection: { anchor: 1 }, userEvent: 'move' })
	})

	it('visualLineMovement OFF → skip VL step, fall through to smart home', () => {
		plugin.settings = vlOff
		const editor = makeEditorWithCoords(10, VL_LINE, 100, 5)
		plugin.moveCursorHomeInTable(editor)
		// VL step skipped → smart home: dispatch(1)
		expect(editor._innerDispatch).toHaveBeenCalledWith({ selection: { anchor: 1 }, userEvent: 'move' })
		expect(editor._coordsAtPos).not.toHaveBeenCalled()
	})

	it('coordsAtPos returns null → skip VL step, fall through to smart home', () => {
		plugin.settings = vlOn
		// coordsTop=null → coordsAtPos returns null → skip VL step
		const editor = makeEditorWithCoords(10, VL_LINE, null, 5)
		plugin.moveCursorHomeInTable(editor)
		expect(editor._innerDispatch).toHaveBeenCalledWith({ selection: { anchor: 1 }, userEvent: 'move' })
	})

	it('posAtCoords returns null → skip VL step, fall through to smart home', () => {
		plugin.settings = vlOn
		// coordsTop=100 (non-null) but posAtCoords returns null → skip VL step
		const editor = makeEditorWithCoords(10, VL_LINE, 100, null)
		plugin.moveCursorHomeInTable(editor)
		expect(editor._innerDispatch).toHaveBeenCalledWith({ selection: { anchor: 1 }, userEvent: 'move' })
	})
})
