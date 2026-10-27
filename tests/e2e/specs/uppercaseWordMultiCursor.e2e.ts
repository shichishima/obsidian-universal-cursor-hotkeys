import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, waitForInTableCell } from '../helpers'

// Uppercase/Lowercase/Capitalize word's own multi-cursor rewrite
// (transformWordOrSelectionNonTable/InTableLP) resolves each range's own
// selection-vs-word mode independently, rather than deciding once for the
// whole command based on primary alone. The unit test suite covers the
// pure per-range logic in isolation; these three scenarios drive the real
// command through a real CM6 multi-range selection, something a mock
// can't truly verify — especially the inner-cell case, which dispatches
// directly to the cell's own real inner EditorView.
//
// Content layout, relative to the first line after the fixture's own ---
// separator (see tests/e2e/vaults/smoke/UppercaseWordMultiCursor.md):
//   +0: #### 1. Mixed mode
//   +1: foo bar
//   +2: baz qux
//   +3: (blank)
//   +4: #### 2. Primary invalid, secondary runs
//   +5: | cell1 | cell2 |
//   +6: foo bar
//   +7: (blank)
//   +8: #### 3. Multiple selections in one cell
//   +9: (blank)
//  +10: | foo bar | x |
//  +11: | --- | --- |
//  +12: | c | d |
describe('Uppercase word: multi-cursor and selection mode', function () {
	it('(1) a selection range and a word-search range both transform in the same command', async function () {
		const l = await openFixtureAndGetContentStart('UppercaseWordMultiCursor.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setSelections([
				{ anchor: { line: l2 + 1, ch: 0 }, head: { line: l2 + 1, ch: 3 } }, // main: "foo" selected
				{ anchor: { line: l2 + 2, ch: 0 } }, // secondary: plain cursor, falls back to word search
			])
		}, l)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:uppercase-word')

		const lines = await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return [view.editor.getLine(l2 + 1), view.editor.getLine(l2 + 2)]
		}, l)
		await expect(lines).toEqual(['FOO bar', 'BAZ qux'])
	})

	it("(2) primary's own selection crossing a Source Mode table's cell boundary no longer blocks a valid secondary range", async function () {
		const l = await openFixtureAndGetContentStart('UppercaseWordMultiCursor.md')

		// isValidTransformRangeOuter's Source Mode check only applies
		// outside Live Preview — force genuine Source Mode (not just the
		// "source" edit mode, which also covers Live Preview).
		await browser.executeObsidian(async ({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			await view.setState({ ...view.getState(), source: true }, { history: false })
		})

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setSelections([
				{ anchor: { line: l2 + 5, ch: 2 }, head: { line: l2 + 5, ch: 12 } }, // main: "| cell1 | cell2 |" crosses the cell boundary — invalid
				{ anchor: { line: l2 + 6, ch: 0 }, head: { line: l2 + 6, ch: 3 } }, // secondary: "foo" — valid
			])
		}, l)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:uppercase-word')

		const lines = await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return [view.editor.getLine(l2 + 5), view.editor.getLine(l2 + 6)]
		}, l)
		await expect(lines).toEqual(['| cell1 | cell2 |', 'FOO bar']) // main's own line untouched; secondary still transformed
	})

	it('(3) inside one table cell, multiple ranges each transform their own selection independently', async function () {
		const l = await openFixtureAndGetContentStart('UppercaseWordMultiCursor.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2 + 9, ch: 0 }) // blank line right above the table
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down') // -> header row, "foo bar" cell
		await waitForInTableCell(true)

		// Wait for Obsidian's own async cell-focus reconciliation to finish
		// settling (same 2-RAF-frame convention this plugin's own code uses
		// elsewhere for the same race) before dispatching our own selection
		// below — confirmed live that dispatching too early gets silently
		// overwritten back down to a single range once that reconciliation
		// actually lands.
		await browser.executeObsidian(() => new Promise<void>(resolve => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		}))

		// No native command can add a second cursor inside a table cell yet
		// (tracked separately, out of scope here) — dispatch two real
		// selections directly to the cell's own inner EditorView instead,
		// the same way this plugin's own code does internally. "foo bar"
		// -> ranges [0,3) "foo" and [4,7) "bar".
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			const { EditorSelection } = require('@codemirror/state')
			inner.dispatch({
				selection: EditorSelection.create([
					EditorSelection.range(0, 3),
					EditorSelection.range(4, 7),
				], 0),
			})
		})

		await browser.executeObsidianCommand('universal-cursor-hotkeys:uppercase-word')

		const cellText = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			return inner.state.doc.toString()
		})
		await expect(cellText).toBe('FOO BAR')
	})
})
