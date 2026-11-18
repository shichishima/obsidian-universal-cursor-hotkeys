import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// Uppercase/Lowercase/Capitalize word's real multi-cell mouse-drag
// selection support. Obsidian's Live Preview table marks every cell inside
// a dragged rectangle with an `is-selected` class on its own `<td>`/`<th>`
// (confirmed live, see this plugin's own transformMulticellSelection doc
// comment in src/main.ts) — only a real WebDriver pointer drag triggers
// this, a synthetic MouseEvent/PointerEvent dispatchEvent sequence produces
// no selection at all (confirmed first, before writing any of this).
//
// Fixture (tests/e2e/vaults/smoke/MulticellCaseConversion.md) has three
// SEPARATE tables, one per scenario below — each test mutates its own
// table's content on disk, so they must never share cells (same
// convention as UppercaseWordMultiCursor.md's own separate line ranges).
//
// CM6 only mounts DOM nodes for content inside its own rendered viewport
// -- confirmed live, the 3rd table (Scenario 3, further down the fixture)
// had zero .table-cell-wrapper elements at all until scrolled into view,
// not something any of the earlier scenarios in this suite happen to
// trigger on their own. scrollToLine must run before the first cellWrapper
// lookup in any scenario below the first screenful.
async function scrollToLine(needle: string) {
	await browser.executeObsidian(({ app, obsidian }, needle2) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
		const editor = view.editor
		for (let i = 0; i < editor.lineCount(); i++) {
			if (editor.getLine(i).includes(needle2)) {
				editor.scrollIntoView({ from: { line: i, ch: 0 }, to: { line: i, ch: 0 } }, true);
				return;
			}
		}
		throw new Error(`line containing "${needle2}" not found`)
	}, needle)
	await browser.pause(200)
}

async function cellWrapper(text: string) {
	const el = await browser.$(`//div[contains(@class,"table-cell-wrapper")][normalize-space(text())="${text}"]`)
	await el.waitForExist({ timeout: 3000 })
	return el
}

async function dragSelect(fromText: string, toText: string) {
	const from = await cellWrapper(fromText)
	const to = await cellWrapper(toText)
	await browser.action('pointer')
		.move({ origin: from })
		.down({ button: 0 })
		.move({ origin: to, duration: 300 })
		.up({ button: 0 })
		.perform()
	await browser.pause(300)
}

// Locates a table by one of its own header cell's text (e.g. "h00"),
// rather than a hardcoded line offset from the fixture's own --- separator
// -- three separate tables share this one fixture file, so offset
// arithmetic from a single shared anchor would be fragile to get right and
// easy to silently break if the fixture's own prose above each table is
// ever edited. Returns [headerRow, dataRow1, dataRow2].
function getTableLines(headerCellText: string) {
	return browser.executeObsidian(({ app, obsidian }, needle) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
		const editor = view.editor
		for (let i = 0; i < editor.lineCount(); i++) {
			if (editor.getLine(i).includes(needle)) {
				return [editor.getLine(i), editor.getLine(i + 2), editor.getLine(i + 3)]
			}
		}
		throw new Error(`header cell "${needle}" not found`)
	}, headerCellText)
}

describe('Uppercase/Lowercase/Capitalize word: real multi-cell mouse-drag selection', function () {
	it('(1) a 2-row x 3-col drag transforms every selected cell, header row left untouched', async function () {
		await openFixtureAndGetContentStart('MulticellCaseConversion.md')
		await scrollToLine('h00')
		await dragSelect('a10', 'a22')

		await browser.executeObsidianCommand('universal-cursor-hotkeys:uppercase-word')

		const [header, row1, row2] = await getTableLines('h00')
		await expect(header).toContain('h00')
		await expect(header).toContain('h01')
		await expect(header).toContain('h02')
		await expect(row1).toContain('A10')
		await expect(row1).toContain('A12')
		await expect(row2).toContain('A20')
		await expect(row2).toContain('A21')
		await expect(row2).toContain('A22')
		// The <br>-separated cell: both sub-lines transform, the tag itself
		// survives untouched -- no `i` flag here deliberately, so this
		// actually proves the content got uppercased (not just that the
		// original, still-lowercase text happens to satisfy a
		// case-insensitive match).
		await expect(row1).toMatch(/MID<br>DLE/)
	})

	it('(2) a drag including the header row transforms header cells too', async function () {
		await openFixtureAndGetContentStart('MulticellCaseConversion.md')
		await scrollToLine('b00')
		await dragSelect('b01', 'b12')

		await browser.executeObsidianCommand('universal-cursor-hotkeys:capitalize-word')

		const [header, row1, row2] = await getTableLines('b00')
		await expect(header).toContain('b00') // outside the rectangle (column 0) -- untouched
		await expect(header).toContain('B01')
		await expect(header).toContain('B02')
		await expect(row1).toContain('b10') // outside the rectangle (column 0) -- untouched
		await expect(row1).toContain('B11')
		await expect(row1).toContain('B12')
		await expect(row2).toContain('b20')
		await expect(row2).toContain('b21')
		await expect(row2).toContain('b22')
	})

	it('(3) a plain click (no drag) falls through to the existing single-cell behavior, unaffected', async function () {
		await openFixtureAndGetContentStart('MulticellCaseConversion.md')
		await scrollToLine('g00')
		const g20 = await cellWrapper('g20')
		await g20.click()
		await browser.pause(300)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:uppercase-word')

		const [header, , row2] = await getTableLines('g00')
		await expect(header).toContain('g00') // untouched -- no multi-cell selection existed
		await expect(row2).toContain('G20') // the clicked cell's own word still transforms normally
		await expect(row2).toContain('g21') // neighbors on the SAME row stay untouched -- confirms this didn't silently widen to the whole row
		await expect(row2).toContain('g22')
	})

	// Real bug found from actual use (2026-11-18): a real Shift+ArrowUp
	// escape out of this cell (NOT a mouse drag -- every scenario above
	// uses one) up into the header row above, run through lowercase-word,
	// appended two extra trailing `<br>` to the data cell's own content
	// ("ABC<br>123<br>XYZ" -> "abc<br>123<br>xyz<br><br>"). Root cause,
	// confirmed via a diagnostic dump of transformMulticellSelection's own
	// computed `original`/`transformed` values: the transform itself was
	// already correct with no extra `<br>` at all -- the corruption was an
	// Obsidian-side side effect of this function's own raw outer-document
	// dispatch landing on a cell whose inner view was STILL mounted (the
	// anchor cell always has one), confirmed reproducible only after a real
	// Shift+ArrowUp escape specifically (a programmatic selection set to the
	// identical position never triggered it, and neither does a mouse-drag
	// selection, which is presumably why the mouse-drag scenarios above
	// never caught this). Fixed by editing the anchor cell through its own
	// live inner view (same mechanism the existing single-cell path already
	// uses) instead of a raw outer-text edit, for the anchor specifically --
	// every OTHER selected cell still uses the raw outer-text edit, since
	// they have no inner view to go through.
	it('(4) a real Shift+ArrowUp escape out of a <br>-cell into the header no longer corrupts it', async function () {
		await openFixtureAndGetContentStart('MulticellCaseConversion.md')
		await scrollToLine('d00')
		// Not cellWrapper('ABC123XYZ'): XPath's text() only matches a
		// DIRECT text-node child, so for a wrapper with <br> children (text
		// node "ABC", <br>, text node "123", <br>, text node "XYZ")
		// normalize-space(text()) only ever sees the FIRST one ("ABC"),
		// never the full concatenated textContent a DOM query would see.
		// This is the last/only such wrapper in this fixture.
		const cell = await browser.$('(//div[contains(@class,"table-cell-wrapper")])[last()]')
		await cell.waitForExist({ timeout: 3000 })
		await cell.click()
		await browser.pause(300)

		// Land precisely at the end of the cell's own first real line
		// ("ABC") using only real keys -- a programmatic selection set to
		// the same position does NOT reproduce the bug (confirmed during
		// investigation), so this must stay keyboard-driven.
		await browser.keys(['Home'])
		await browser.pause(100)
		for (let guard = 0; guard < 10; guard++) {
			const atFirstLine = await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const inner = (view.editor as any).activeCM
				return inner.state.doc.lineAt(inner.state.selection.main.head).number === 1
			})
			if (atFirstLine) break
			await browser.keys(['ArrowUp'])
			await browser.keys(['Home'])
			await browser.pause(100)
		}
		await browser.keys(['End'])
		await browser.pause(100)

		await browser.keys(['Shift', 'ArrowUp'])
		await browser.pause(300)
		const isSelectedCount = await browser.executeObsidian(() =>
			document.querySelectorAll('td.is-selected, th.is-selected').length)
		await expect(isSelectedCount).toBe(2) // confirms the escape really did produce a 2-cell cross-row selection

		await browser.executeObsidianCommand('universal-cursor-hotkeys:lowercase-word')
		await browser.pause(300)

		const [, row1] = await getTableLines('d00')
		await expect(row1).toContain('abc<br>123<br>xyz')
		// The regression itself: two extra trailing `<br>` tags. Checking
		// the exact count directly, rather than just `.toContain`, so this
		// test would have failed on the original bug (which also contained
		// "abc<br>123<br>xyz" as a substring, just with more after it).
		await expect((row1.match(/<br>/g) ?? []).length).toBe(2)
	})
})
