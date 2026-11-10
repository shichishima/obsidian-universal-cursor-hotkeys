import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, waitForInTableCell } from '../helpers'

// Copy region (Alt-W) set markActive=false on copy, but never collapsed
// the CM6 selection itself, leaving the just-copied region still visually
// highlighted afterward — a real, previously-identified gap (unlike
// Kill region, which always collapses the selection as a side effect of
// deleting it). Fixed by calling the existing, already multi-cursor-safe
// collapseActiveSelectionToHead (same helper setMark/keyboardQuit already
// use) right after markActive is cleared, in both copyRegion (outer) and
// copyRegionInTableLP (table cell) — see killYankMultiCursor.e2e.ts for
// the same table-cell entry pattern used here.
//
// Content layout, relative to the first line after the fixture's own ---
// separator (see tests/e2e/vaults/smoke/CopyRegionSelectionCollapse.md):
//   +0: #### 1. Outer, single cursor
//   +1: hello world
//   +2: (blank)
//   +3: #### 2. Outer, multi-cursor
//   +4: foo bar
//   +5: baz qux
//   +6: (blank)
//   +7: #### 3. Table cell
//   +8: (blank)
//   +9: | foo bar | x |
//  +10: | --- | --- |
//  +11: | c | d |
describe('Copy region (Alt-W): collapses the selection after copying', function () {
	it('(1) outer, single cursor: selection collapses to head, text unchanged', async function () {
		const l = await openFixtureAndGetContentStart('CopyRegionSelectionCollapse.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setSelection({ line: l2 + 1, ch: 0 }, { line: l2 + 1, ch: 5 }) // "hello"
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:copy-region')
		await browser.pause(100)

		const after = await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			return {
				sel: view.editor.listSelections()[0],
				line: view.editor.getLine(l2 + 1),
				killCache: plugin.killCache as string,
			}
		}, l)
		await expect(after.sel).toEqual({ anchor: { line: l + 1, ch: 5 }, head: { line: l + 1, ch: 5 } })
		await expect(after.line).toBe('hello world') // non-destructive
		await expect(after.killCache).toBe('hello')
	})

	it('(2) outer, multi-cursor: each range collapses independently to its own head', async function () {
		const l = await openFixtureAndGetContentStart('CopyRegionSelectionCollapse.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setSelections([
				{ anchor: { line: l2 + 4, ch: 0 }, head: { line: l2 + 4, ch: 3 } }, // "foo"
				{ anchor: { line: l2 + 5, ch: 0 }, head: { line: l2 + 5, ch: 3 } }, // "baz"
			])
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:copy-region')
		await browser.pause(100)

		const after = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			return {
				sels: view.editor.listSelections(),
				killCache: plugin.killCache as string,
			}
		})
		await expect(after.sels).toEqual([
			{ anchor: { line: l + 4, ch: 3 }, head: { line: l + 4, ch: 3 } },
			{ anchor: { line: l + 5, ch: 3 }, head: { line: l + 5, ch: 3 } },
		])
		await expect(after.killCache).toBe('foo\nbaz')
	})

	it('(3) table cell: selection collapses to head, text unchanged', async function () {
		const l = await openFixtureAndGetContentStart('CopyRegionSelectionCollapse.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2 + 8, ch: 0 }) // blank line right above the table
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down') // -> header row, "foo bar" cell
		await waitForInTableCell(true, 5000)
		await browser.executeObsidian(() => new Promise<void>(resolve => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		}))

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			const { EditorSelection } = require('@codemirror/state')
			inner.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 3)], 0) }) // "foo"
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:copy-region')
		await browser.pause(100)

		const after = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			const range = inner.state.selection.main
			return {
				from: range.from,
				to: range.to,
				text: inner.state.doc.toString(),
				killCache: plugin.killCache as string,
			}
		})
		await expect(after.from).toBe(3)
		await expect(after.to).toBe(3)
		await expect(after.text).toBe('foo bar') // non-destructive
		await expect(after.killCache).toBe('foo')
	})
})
