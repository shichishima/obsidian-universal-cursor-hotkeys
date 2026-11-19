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
})
