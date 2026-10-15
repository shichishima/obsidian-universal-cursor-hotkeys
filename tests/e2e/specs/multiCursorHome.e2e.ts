import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// First real regression test on top of the e2e smoke test: HOME used to
// collapse every secondary cursor down to one (fixed on fix/multi-cursor-collapse).
// This drives a real CM6 multi-range selection through the plugin's actual
// command, something the unit test suite can only mock, never truly verify.
describe('multi-cursor HOME (plain text)', function () {
	it('moves every cursor to its own line start, without collapsing to one', async function () {
		const l = await openFixtureAndGetContentStart('MultiCursorHome.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setSelections([
				{ anchor: { line: l2 + 0, ch: 3 } }, // inside "foo"
				{ anchor: { line: l2 + 1, ch: 3 } }, // inside "baz"
			], 0)
		}, l)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-home')

		const heads = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.listSelections().map(s => ({ line: s.head.line, ch: s.head.ch }))
		})

		await expect(heads).toEqual([
			{ line: l + 0, ch: 0 },
			{ line: l + 1, ch: 0 },
		])
	})
})
