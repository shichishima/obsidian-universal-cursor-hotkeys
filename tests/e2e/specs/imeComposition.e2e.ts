import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// Every command checks `editor.cm?.composing || editor.activeCM?.composing`
// (CM6's own composing getter: `inputState.composing > 0`) before running,
// a real bug class historically — e.g. the 0.11.2 fix where commands
// started firing mid-IME-composition after a few candidate-cycling presses
// and moved the real cursor instead of the candidate selection. Real IME
// composition isn't something WDIO can drive directly (no actual input
// method engine in this environment) — compositionstart/compositionupdate
// DOM events alone only set CM6's internal counter to 0, not > 0; it only
// goes above 0 once a real DOM mutation lands while composing (see
// @codemirror/view's own applyDOMChange). So this test sets
// `cm.inputState.composing` directly instead — a plain, non-private
// instance property — which exercises this plugin's own guard condition
// exactly the same way, without needing to reproduce CM6's own internal
// bookkeeping.
//
// Content, relative to the first line after the fixture's own --- separator
// (see tests/e2e/vaults/smoke/ImeComposition.md):
//   +0: foo bar
describe('IME composition guard', function () {
	it('HOME no-ops while composing, then works normally once composition ends', async function () {
		const l = await openFixtureAndGetContentStart('ImeComposition.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 3 }) // mid "foo"
			;(view.editor as any).cm.inputState.composing = 1
		}, l)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-home')

		const whileComposing = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getCursor()
		})
		await expect(whileComposing).toEqual({ line: l, ch: 3 }) // unchanged — the command no-op'd

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			;(view.editor as any).cm.inputState.composing = -1 // composition ended
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-home')

		const afterComposing = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getCursor()
		})
		await expect(afterComposing).toEqual({ line: l, ch: 0 }) // now it actually ran
	})
})
