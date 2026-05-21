import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// Tuple: [line, ch, Adv. (Std=ON&Adv=ON), Std. (Std=ON&Adv=OFF), OFF (Std=OFF)]
// "OFF" is tested twice — Advanced=ON and Advanced=OFF — sharing the same expected value.
type TestRow = [string, number, number, number, number]

const settingsMatrix: Array<{
	label: string
	std: boolean
	adv: boolean
	idx: 2 | 3 | 4
}> = [
	{ label: 'Adv.',         std: true,  adv: true,  idx: 2 },
	{ label: 'Std.',         std: true,  adv: false, idx: 3 },
	{ label: 'OFF (Adv=ON)', std: false, adv: true,  idx: 4 },
	{ label: 'OFF (Adv=OFF)',std: false, adv: false, idx: 4 },
]

const categories: { name: string; skipAutoStep2?: boolean; rows: TestRow[] }[] = [
	{
		name: 'Unordered lists',
		rows: [ //  2 4 6 8           ch,  Adv., Std., OFF]
			['- item',             4,    2,    2,     0],
			['+ item',             4,    2,    2,     0],
			['* item',             4,    2,    2,     0],
			['  - item',           6,    4,    4,     0],
			['    * item',         8,    6,    6,     0],
			['- item',             1,    0,    0,     0],  // cursor inside "- " prefix → ch=0
		],
	},
	{
		name: 'Task lists',
		rows: [ //      6 8 0
			['- [ ] item',         8,    6,    6,     0],
			['- [x] item',         8,    6,    6,     0],
			['  - [ ] item',      10,    8,    8,     0],
			['  - [x] item',      10,    8,    8,     0],
			['  - [x] item',       5,    0,    0,     0],
		],
	},
	{
		name: 'Ordered lists',
		rows: [ //   345678
			['1. item',            5,    3,    3,     0],
			['1) item',            5,    3,    3,     0],
			['10. item',           6,    4,    4,     0],
			['  1. item',          7,    5,    5,     0],
			['  10. item',         8,    6,    6,     0],
			['10. item',           2,    0,    0,     0],
		],
	},
	{
		name: 'Blockquotes',
		rows: [ // 1234 6
			['> text',             4,    2,    2,     0],
			['>text',              3,    1,    1,     0],
			['>   text',           6,    4,    4,     0],
		],
	},
	{
		name: 'Nested blockquotes',
		rows: [
			['>> text',            6,    3,    3,     0],
			['>>>text',            5,    3,    3,     0],
			['> > > text',         9,    6,    6,     0],
			['>> - item',          8,    5,    5,     0],
			['> - [ ] task',      11,    8,    8,     0],
			['> 1. item',          8,    5,    5,     0],
		],
	},
	{
		name: '(Advanced) Nested blockquote headings and footnotes',
		rows: [
			// Adv: contentPos=4 (past "> # "); Std: contentPos=2 (past "> ")
			['> # heading',        9,    4,    2,     0],
			// ch=4: Adv 2nd step → 0; Std 1st step → 2
			['> # heading',        4,    0,    2,     0],
			['>> ## sub',          8,    6,    3,     0],
			// ch=6: Adv 2nd step → 0; Std 1st step → 3
			['>> ## sub',          6,    0,    3,     0],
			['> [^1]: note',      11,    8,    2,     0],
		],
	},
	{
		name: 'Plain text and edge cases',
		rows: [ //0 2 45
			['hello world',        5,    0,    0,     0],
			['  hello',            4,    2,    2,     0],
			['',                   0,    0,    0,     0],
		],
	},
	{
		name: '(Advanced) Headings',
		rows: [ // 1 3 5 7 9
			['## hello',           5,    3,    0,    0],
			['## hello',           1,    0,    0,    0],  // cursor inside "## " prefix → ch=0
			['###### deep',        9,    7,    0,    0],
			['###### deep',        3,    0,    0,    0],
		],
	},
	{
		name: '(Advanced) Footnotes',
		rows: [ //0  3  6 8
			['[^1]: note',         8,    6,    0,    0],
			['[^1]: note',         3,    0,    0,    0],
		],
	},
	{
		name: '(Advanced) Heading inside unordered list',
		skipAutoStep2: true,  // 3-step navigation: already tested explicitly row-by-row
		rows: [	// 3-step navigation: adv-prefix → list-prefix → ch=0
			//0 2  5 7
			['- ## hello',         7,    5,    2,    0],  // 1st step: past "- ## " / past "- "
			['- ## hello',         5,    2,    2,    0],  // 2nd step: past "- "
			['- ## hello',         2,    0,    0,    0],  // 3rd step: ch=0
		],
	},
]

describe('getBeginningOfLinePosition(line, ch)', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
	})

	for (const { label, std, adv, idx } of settingsMatrix) {
		describe(label, () => {
			beforeEach(() => {
				plugin.settings = { smartHomeStandard: std, smartHomeAdvanced: adv, visualLineMovement: true }
			})

			for (const { name, skipAutoStep2, rows } of categories) {
				describe(name, () => {
					for (const row of rows) {
						const [line, ch] = row
						const expected = row[idx]
						it(`"${line}"  ch=${ch}  →  ${expected}`, () => {
							expect(plugin.getBeginningOfLinePosition(line, ch)).toBe(expected)
						})
						// 2nd step: when cursor is already at the smart home position, pressing HOME
						// again should toggle to ch=0. Auto-generated for Adv./Std. modes only.
						if (std && !skipAutoStep2 && expected > 0) {
							it(`"${line}"  ch=${expected}  →  0  (2nd step)`, () => {
								expect(plugin.getBeginningOfLinePosition(line, expected)).toBe(0)
							})
						}
					}
				})
			}
		})
	}
})
