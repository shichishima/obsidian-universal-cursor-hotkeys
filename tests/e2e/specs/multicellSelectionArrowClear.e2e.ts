import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// Real bug found from actual use (2026-11-19): while a real multi-cell
// mouse-drag selection is active in a Live Preview table (the same
// `is-selected` rectangle transformMulticellSelection reacts to), a
// physical arrow key collapses it and moves from its edge in one step --
// confirmed live via a diagnostic dispatch comparison. But this plugin's
// own cursor-up/down/left/right (Ctrl-P/N/B/F) previously left the
// rectangle untouched and moved only the anchor cell's own caret, so the
// stale multi-cell selection and this plugin's own moved cursor coexisted
// at once, which is wrong since no real cursor is meant to be visible
// while a multi-cell selection is active. Fixed by delegating to the same
// native-key dispatch Properties/Bases already use (propertyNativeArrowFallback)
// whenever a multi-cell selection is active, instead of running this
// plugin's own moveCursor*Impl for that one case.
//
// Own dedicated fixture (MulticellSelectionArrowClear.md) -- NOT
// MulticellCaseConversion.md's own tables, since that fixture's Scenario 1
// gets permanently uppercased on disk by multicellCaseConversion.e2e.ts's
// own test (1) earlier in the same full suite run, which would make this
// spec's own cell-text lookups fail once that spec has already run.
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

async function isSelectedCount() {
	return browser.executeObsidian(() => document.querySelectorAll('td.is-selected, th.is-selected').length)
}

describe('cursor-up/down/left/right clear an active multi-cell selection', function () {
	(['UP', 'DOWN', 'LEFT', 'RIGHT'] as const).forEach(direction => {
		it(`(${direction}) a multi-cell selection is cleared, not left stale alongside this plugin's own moved cursor`, async function () {
			await openFixtureAndGetContentStart('MulticellSelectionArrowClear.md')
			await dragSelect('p10', 'p22')
			await expect(await isSelectedCount()).toBe(6)

			await browser.executeObsidianCommand(`universal-cursor-hotkeys:cursor-${direction.toLowerCase()}`)
			await browser.pause(300)

			await expect(await isSelectedCount()).toBe(0)
		})
	})

	it('a single-cell cursor move (no multi-cell selection) is unaffected', async function () {
		await openFixtureAndGetContentStart('MulticellSelectionArrowClear.md')
		const p10 = await cellWrapper('p10')
		await p10.click()
		await browser.pause(300)
		await expect(await isSelectedCount()).toBe(0)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-right')
		await browser.pause(300)
		await expect(await isSelectedCount()).toBe(0)
	})

	// Known gap, found from actual use (2026-11-19) right after the fix
	// above shipped: the clearing above relies on dispatching a synthetic
	// keydown for the bare arrow key -- confirmed reliable for every case
	// above. But when the anchor cell has multiple internal lines (a real
	// `<br>`) and the selection's own anchor sits on a NON-boundary line of
	// it (e.g. the last of two lines), the first Shift+Arrow press only
	// moves within that cell -- a second press is needed to actually cross
	// into the neighboring row. Confirmed live via a diagnostic dump that,
	// once that second press crosses out, `editor.activeCM` stays pointed
	// at the ORIGINAL multi-line cell (not the row the caret now visually
	// sits in) -- Obsidian apparently only hands off "the active cell" on
	// a collapsing cursor move, not a Shift-extend. From that stale state,
	// a synthetic keydown dispatch fails to clear the selection regardless
	// of which element it targets (tried both `document.activeElement` and
	// `editor.cm.contentDOM`, confirmed both fail identically) -- only a
	// REAL, OS-trusted arrow keypress succeeds in this exact state,
	// confirmed live as a direct comparison against the same steps. A
	// programmatic selection override was already confirmed unreliable for
	// this same clearing mechanism earlier (see the fix commit's own
	// writeup above), so this isn't something this plugin can currently
	// work around -- documented here as a known, confirmed limitation
	// rather than silently left unexplained.
	it('known gap: a multi-line cell whose anchor sits on a non-boundary line does not reliably clear', async function () {
		await openFixtureAndGetContentStart('MulticellSelectionArrowClear.md')
		await scrollToLine('q00')
		const qln = await browser.$('(//div[contains(@class,"table-cell-wrapper")])[last()]')
		await qln.waitForExist({ timeout: 3000 })
		await qln.click()
		await browser.pause(300)
		await browser.keys(['End'])
		await browser.pause(100)
		for (let guard = 0; guard < 5; guard++) {
			const atLastLine = await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const inner = (view.editor as any).activeCM
				return inner.state.doc.lineAt(inner.state.selection.main.head).number === inner.state.doc.lines
			})
			if (atLastLine) break
			await browser.keys(['ArrowDown'])
			await browser.keys(['End'])
			await browser.pause(100)
		}
		// 1st press: moves within the cell only (qln2 -> qln1), no cross-cell
		// selection yet. 2nd press: crosses out into q11, the row above.
		await browser.keys(['Shift', 'ArrowUp'])
		await browser.pause(300)
		await browser.keys(['Shift', 'ArrowUp'])
		await browser.pause(300)
		await expect(await isSelectedCount()).toBe(2)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')
		await browser.pause(300)
		// Not toBe(0): this is the confirmed gap, not the fixed behavior.
		await expect(await isSelectedCount()).toBe(2)
	})
})
