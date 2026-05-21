import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// moveCursorHomeInTable — smart home step behavior inside table cells.
//
// 2-step (no prefix):  cursor → startOfInCellLine → moveToLeftCellEnd
// 3-step (prefix):     cursor → smartHomePos → startOfInCellLine → moveToLeftCellEnd
//
// smartHomePos is computed by getBeginningOfLinePosition applied to the cell
// content slice, so Standard / Advanced settings drive the same rules as
// for non-table lines.

type Row = {
	desc:     string
	ch:       number
	settings: { smartHomeStandard: boolean; smartHomeAdvanced: boolean }
	// Expected: setCursorViaCm called with this ch, or moveToLeftCellEnd called.
	setCursorCh?: number
	callsLeftCell?: true
}

type Group = {
	line: string
	rows: Row[]
}

// Shorthand for settings object.
const S = (std: boolean, adv: boolean) =>
	({ smartHomeStandard: std, smartHomeAdvanced: adv })

// Line layouts:
//   '| plain |'     — startOfInCellLine = 2,  no prefix
//   '| - item |'    — startOfInCellLine = 2 ('-'), Standard smart home = 4 ('i')
//   '| # heading |' — startOfInCellLine = 2 ('#'), Advanced smart home = 4 ('h')
const matrix: Group[] = [
	{
		line: '| plain |',
		rows: [
			{ desc: 'cursor in content',    ch: 5, settings: S(true, true), setCursorCh: 2 },
			{ desc: 'cursor at cell start', ch: 2, settings: S(true, true), callsLeftCell: true },
		],
	},
	{
		line: '| - item |',  // Standard prefix '- '; ch2='-', ch4='i'
		rows: [
			{ desc: 'Std OFF — moves directly to cell start', ch: 7, settings: S(false, false), setCursorCh: 2 },
			{ desc: 'Std ON  — cursor past smart home',       ch: 7, settings: S(true,  false), setCursorCh: 4 },
			{ desc: 'Std ON  — cursor at smart home',         ch: 4, settings: S(true,  false), setCursorCh: 2 },
			{ desc: 'Std ON  — cursor at cell start',         ch: 2, settings: S(true,  false), callsLeftCell: true },
		],
	},
	{
		line: '| # heading |',  // Advanced prefix '# '; ch2='#', ch4='h'
		rows: [
			{ desc: 'Std OFF         — moves directly to cell start',  ch: 8, settings: S(false, false), setCursorCh: 2 },
			{ desc: 'Std ON Adv OFF  — heading requires Advanced',     ch: 8, settings: S(true,  false), setCursorCh: 2 },
			{ desc: 'Adv ON          — cursor past smart home',        ch: 8, settings: S(true,  true),  setCursorCh: 4 },
			{ desc: 'Adv ON          — cursor at smart home',          ch: 4, settings: S(true,  true),  setCursorCh: 2 },
			{ desc: 'Adv ON          — cursor at cell start',          ch: 2, settings: S(true,  true),  callsLeftCell: true },
		],
	},
]

describe('moveCursorHomeInTable', () => {
	let plugin: any

	const makeEditor = (ch: number, lineText: string) => ({
		getCursor: () => ({ line: 1, ch }),
		getLine:   () => lineText,
		exec:      () => {},
	})

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.setCursorViaCm    = vi.fn()
		plugin.moveToLeftCellEnd = vi.fn()
	})

	for (const group of matrix) {
		describe(group.line, () => {
			for (const row of group.rows) {
				it(row.desc, () => {
					plugin.settings = row.settings
					plugin.moveCursorHomeInTable(makeEditor(row.ch, group.line))
					if (row.setCursorCh !== undefined) {
						expect(plugin.setCursorViaCm)
							.toHaveBeenCalledWith(expect.anything(), 1, row.setCursorCh)
						expect(plugin.moveToLeftCellEnd).not.toHaveBeenCalled()
					} else {
						expect(plugin.moveToLeftCellEnd).toHaveBeenCalled()
						expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
					}
				})
			}
		})
	}
})
