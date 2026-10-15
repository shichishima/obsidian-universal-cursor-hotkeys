import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'

// First real regression test on top of the e2e smoke test: HOME used to
// collapse every secondary cursor down to one (fixed on fix/multi-cursor-collapse).
// This drives a real CM6 multi-range selection through the plugin's actual
// command, something the unit test suite can only mock, never truly verify.
describe('multi-cursor HOME (plain text)', function () {
	it('moves every cursor to its own line start, without collapsing to one', async function () {
		await browser.executeObsidian(async ({ app, obsidian }) => {
			const file = app.vault.getFileByPath('MultiCursorHome.md')!
			await app.workspace.getLeaf().openFile(file)
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setSelections([
				{ anchor: { line: 0, ch: 3 } }, // inside "foo"
				{ anchor: { line: 1, ch: 3 } }, // inside "baz"
			], 0)
		})

		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-home')

		const heads = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.listSelections().map(s => ({ line: s.head.line, ch: s.head.ch }))
		})

		await expect(heads).toEqual([
			{ line: 0, ch: 0 },
			{ line: 1, ch: 0 },
		])
	})
})
