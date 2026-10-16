import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// The real-world motivation for this whole feature: selecting a large
// outer-view region that happens to contain a whole table, e.g. to
// cut/paste it — exactly what a mouse-drag selection already does
// natively in Live Preview, but what native Shift+cursor cannot do at all
// (confirmed live by the person who designed this, not just assumed).
// Set mark above the table, extend DOWN (Ctrl-N) across it, and the whole
// table's own rows must end up inside the region — the range never
// actually becomes "inside" any cell along the way, it just skips the
// whole table atomically and lands on the far side (see
// findLineAfterWholeTable/extendMarkVertically in main.ts).
//
// Content layout, relative to the first line after the fixture's own ---
// separator (see tests/e2e/vaults/smoke/SetMarkTableSkip.md). The blank
// line before the table is required for Obsidian's own markdown parser to
// recognize it as a table at all (same requirement as every other
// table-adjacent e2e spec in this suite):
//   +0: before
//   +1: (blank)
//   +2: | a | b |
//   +3: | --- | --- |
//   +4: | c | d |
//   +5: (blank)
//   +6: after
describe('Set-mark extend crossing a table (Ctrl-N)', function () {
	it('skips the whole table atomically, landing with it inside the region', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkTableSkip.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 0 }) // "before"
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')

		// before -> blank (plain step) -> skips the whole table in one native
		// moveVertically call -> after (plain step)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')

		const state = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return {
				selections: view.editor.listSelections(),
				selectedText: view.editor.getSelection(),
				inTableCell: (view.editor as any).inTableCell as boolean,
			}
		})

		await expect(state.selections).toEqual([{ anchor: { line: l, ch: 0 }, head: { line: l + 6, ch: 0 } }])
		await expect(state.selectedText).toBe('before\n\n| a | b |\n| --- | --- |\n| c | d |\n\n')
		await expect(state.inTableCell).toBe(false) // never actually entered a cell along the way
	})
})
