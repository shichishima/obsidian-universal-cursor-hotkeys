import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, waitForInTableCell } from '../helpers'

// Kill Line/Kill Region/Kill Word/Copy Region/Yank's own multi-cursor
// rewrite (killLineOuter/killLineInTableLP, killRegion/killRegionInTableLP,
// killWordOuter/killWordInTableLP, copyRegion/copyRegionInTableLP,
// yankOuter/yankInTableLP): each range now kills/copies/yanks
// independently, joined with '\n' into one shared kill-cache entry
// (matching native Obsidian's own observed multi-cut behavior), with
// Yank distributing one piece per cursor when the clipboard's own line
// count matches the current cursor count. The unit test suite verifies
// the pure per-range logic and position remapping against a real
// ChangeSet; these scenarios drive the real commands through the real
// system clipboard and real CM6 dispatch, confirming the whole pipeline
// (including the LP table cell's own inner EditorView) actually achieves
// the intended round-trip — something a mock can't truly verify.
//
// Content layout, relative to the first line after the fixture's own ---
// separator (see tests/e2e/vaults/smoke/KillYankMultiCursor.md):
//   +0: #### 1. Kill region round-trip
//   +1: foo bar
//   +2: baz qux
//   +3: AAA BBB
//   +4: CCC DDD
//   +5: (blank)
//   +6: #### 2. Kill line round-trip
//   +7: line one
//   +8: line two
//   +9: target one
//  +10: target two
//  +11: (blank)
//  +12: #### 3. Cell word round-trip
//  +13: (blank)
//  +14: | foo bar | x |
//  +15: | --- | --- |
//  +16: | c | d |
//  +17: (blank)
//  +18: #### 4. Yank count mismatch
//  +19: AAA
//  +20: BBB
//  +21: (blank)
//  +22: #### 5. Outer kill -> inner yank
//  +23: ONE two
//  +24: THREE four
//  +25: (blank)
//  +26: | ab cd | x |
//  +27: | --- | --- |
//  +28: | e | f |
describe('Kill/Yank: multi-cursor round-trip', function () {
	it('(1) kill region (outer), two selections -> yank at two other positions, each piece lands separately', async function () {
		const l = await openFixtureAndGetContentStart('KillYankMultiCursor.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setSelections([
				{ anchor: { line: l2 + 1, ch: 0 }, head: { line: l2 + 1, ch: 3 } }, // "foo"
				{ anchor: { line: l2 + 2, ch: 0 }, head: { line: l2 + 2, ch: 3 } }, // "baz"
			])
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:kill-region')
		await browser.pause(100) // clipboard write is fire-and-forget; give it time to land

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setSelections([
				{ anchor: { line: l2 + 3, ch: 0 } },
				{ anchor: { line: l2 + 4, ch: 0 } },
			])
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:yank')

		const lines = await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return [view.editor.getLine(l2 + 3), view.editor.getLine(l2 + 4)]
		}, l)
		await expect(lines).toEqual(['fooAAA BBB', 'bazCCC DDD'])
	})

	it('(2) kill line (outer) from two positions -> yank at two other positions', async function () {
		const l = await openFixtureAndGetContentStart('KillYankMultiCursor.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setSelections([
				{ anchor: { line: l2 + 7, ch: 4 } }, // "line| one"
				{ anchor: { line: l2 + 8, ch: 4 } }, // "line| two"
			])
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:kill-line')
		await browser.pause(100)

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setSelections([
				{ anchor: { line: l2 + 9, ch: 'target one'.length } },
				{ anchor: { line: l2 + 10, ch: 'target two'.length } },
			])
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:yank')

		const lines = await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return [view.editor.getLine(l2 + 9), view.editor.getLine(l2 + 10)]
		}, l)
		await expect(lines).toEqual(['target one one', 'target two two'])
	})

	it('(3) inside one table cell, kill word at two positions -> yank at the (shifted) same two positions reconstructs the original text', async function () {
		const l = await openFixtureAndGetContentStart('KillYankMultiCursor.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2 + 13, ch: 0 }) // blank line right above the table
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down') // -> header row, "foo bar" cell
		// Longer timeout than this helper's own 2000ms default: confirmed via
		// an instrumented 12-run batch that entering the cell occasionally
		// takes longer than that under load, with the helper's own timeout
		// silently swallowed — not a dispatch-timing race, just a budget
		// that's sometimes too tight (same class of issue already fixed this
		// way for setMarkPageUpDown.e2e.ts).
		await waitForInTableCell(true, 5000)
		// Wait for Obsidian's own async cell-focus reconciliation to finish
		// settling before dispatching our own selection — see
		// uppercaseWordMultiCursor.e2e.ts's own identical note.
		await browser.executeObsidian(() => new Promise<void>(resolve => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		}))

		// "foo bar": cursor1 at 1 ("f|oo"), cursor2 at 5 ("foo b|ar")
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			const { EditorSelection } = require('@codemirror/state')
			inner.dispatch({
				selection: EditorSelection.create([
					EditorSelection.cursor(1),
					EditorSelection.cursor(5),
				], 0),
			})
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:kill-word-right')
		await browser.pause(100)

		const afterKill = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			return inner.state.doc.toString()
		})
		await expect(afterKill).toBe('f b')

		// New cursors at 1 (between 'f' and ' ') and 3 (end, after 'b')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			const { EditorSelection } = require('@codemirror/state')
			inner.dispatch({
				selection: EditorSelection.create([
					EditorSelection.cursor(1),
					EditorSelection.cursor(3),
				], 0),
			})
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:yank')

		const afterYank = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			return inner.state.doc.toString()
		})
		await expect(afterYank).toBe('foo bar')
	})

	it('(4) yank: clipboard line count does not match cursor count -> duplicates the whole text at every cursor', async function () {
		const l = await openFixtureAndGetContentStart('KillYankMultiCursor.md')

		await browser.executeObsidian(async () => {
			await navigator.clipboard.writeText('XY')
		})
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setSelections([
				{ anchor: { line: l2 + 19, ch: 0 } },
				{ anchor: { line: l2 + 20, ch: 0 } },
			])
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:yank')

		const lines = await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return [view.editor.getLine(l2 + 19), view.editor.getLine(l2 + 20)]
		}, l)
		await expect(lines).toEqual(['XYAAA', 'XYBBB'])
	})

	it('(5) outer multi-cursor kill region, then multi-cursor yank inside a table cell', async function () {
		const l = await openFixtureAndGetContentStart('KillYankMultiCursor.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setSelections([
				{ anchor: { line: l2 + 23, ch: 0 }, head: { line: l2 + 23, ch: 3 } }, // "ONE"
				{ anchor: { line: l2 + 24, ch: 0 }, head: { line: l2 + 24, ch: 5 } }, // "THREE"
			])
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:kill-region')
		await browser.pause(100)

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2 + 25, ch: 0 }) // blank line right above the table
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')
		await waitForInTableCell(true, 5000)
		await browser.executeObsidian(() => new Promise<void>(resolve => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		}))

		// "ab cd": cursor1 at 0, cursor2 at 3 (between ' ' and 'c')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			const { EditorSelection } = require('@codemirror/state')
			inner.dispatch({
				selection: EditorSelection.create([
					EditorSelection.cursor(0),
					EditorSelection.cursor(3),
				], 0),
			})
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:yank')

		const cellText = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			return inner.state.doc.toString()
		})
		await expect(cellText).toBe('ONEab THREEcd')
	})
})
