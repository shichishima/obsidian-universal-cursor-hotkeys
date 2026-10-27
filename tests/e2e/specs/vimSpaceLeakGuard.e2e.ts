import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, enableVimMode } from '../helpers'

// Real-Obsidian coverage for the 0.11.2 "bare Space inserts a literal
// space" fix. Root cause, confirmed by reading vim-support.ts directly:
// turning on table-structure or table-navigation support removes Space's
// own native vim.js binding (a keyToKey synonym for "l") to make room for
// the "<Space>t..." leader sequences, via unmap() — which has no read-back
// API, so that native binding can never be restored once gone, even after
// turning the feature back off. Without the leak-guard, an *incomplete*
// leader attempt (e.g. a stray Space press with no matching sequence)
// then falls through vim.js's own findKey to CM6's default text-insertion
// handling, inserting a literal space. The fix (applySpaceLeakGuard) wraps
// multiSelectHandleKey to swallow a bare Space outside Insert mode once
// that native binding is gone, and deliberately stays installed even
// after the feature is toggled back off (spaceNativeBindingRemoved is
// sticky for the rest of the session) - that persistence is exactly what
// this test confirms actually holds up.
describe('Vim Space leak-guard (no literal space after toggling table features off)', function () {
	it('toggle table navigation on, then off, then a bare Space does not insert a literal space', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimSpaceLeakGuard.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).trim() === 'alpha bravo') {
					view.editor.setCursor({ line: i, ch: 0 })
					return
				}
			}
			throw new Error('line not found')
		})

		await browser.executeObsidian(({ app }) => {
			;(app as any).plugins.plugins['universal-cursor-hotkeys'].vimSupport.setTableNavigationEnabled(true)
		})
		await browser.pause(200)
		await browser.executeObsidian(({ app }) => {
			;(app as any).plugins.plugins['universal-cursor-hotkeys'].vimSupport.setTableNavigationEnabled(false)
		})
		await browser.pause(200)

		const before = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getValue()
		})

		// An incomplete leader attempt (a stray bare Space with no
		// following sequence) is exactly the shape that leaked a literal
		// space before this fix.
		await browser.keys([' '])
		await browser.pause(300)

		const after = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getValue()
		})
		await expect(after).toBe(before)
		await expect(after).not.toContain('  alpha') // no leaked literal space inserted before the line's own content
	})
})
