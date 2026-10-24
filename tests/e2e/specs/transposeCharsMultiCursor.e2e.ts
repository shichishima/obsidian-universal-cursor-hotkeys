import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, waitForInTableCell } from '../helpers'

// fix/transpose-chars-multicursor: previously, only the mid-line case was
// multi-cursor-safe (delegating straight to CM6's own stock transposeChars,
// which handles every range on its own) — the at-line-end override and both
// table branches only ever looked at the PRIMARY range, silently ignoring
// every other one. The unit test suite covers the pure per-range resolve
// functions in isolation; these two scenarios drive the real command
// through a real CM6 multi-range selection on real Obsidian, something a
// mock can't truly verify — especially the inner-cell case, which
// dispatches directly to the cell's own real inner EditorView.
//
// Each test gets its own dedicated fixture (same established convention as
// every other mutating-test spec in this suite) — Transpose chars actually
// edits the document, so sharing one fixture across tests would corrupt it
// for whichever test runs second within this same shared-instance run.
//
// Content layout for the outer test, relative to the first line after the
// fixture's own --- separator (see
// tests/e2e/vaults/smoke/TransposeCharsMultiCursorOuter.md):
//   +0: abcdef
//   +1: xy
//
// Content layout for the inner test (see
// tests/e2e/vaults/smoke/TransposeCharsMultiCursorInner.md):
//   +0: (blank line above)
//   +1: (blank)
//   +2: | ab<br>cd | y |
//   +3: | --- | --- |
describe('Transpose chars: multi-cursor', function () {
	it('(1) outer: one mid-line range and one at-line-end range both transpose in the same command', async function () {
		const l = await openFixtureAndGetContentStart('TransposeCharsMultiCursorOuter.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setSelections([
				{ anchor: { line: l2, ch: 3 } },     // mid "abcdef" -> "abdcef"
				{ anchor: { line: l2 + 1, ch: 2 } },  // end of "xy" -> "yx"
			])
		}, l)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:transpose-chars')

		const lines = await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return [view.editor.getLine(l2), view.editor.getLine(l2 + 1)]
		}, l)
		await expect(lines).toEqual(['abdcef', 'yx'])
	})

	it('(2) inside one table cell\'s own <br> sub-lines, multiple ranges each transpose independently', async function () {
		const l = await openFixtureAndGetContentStart('TransposeCharsMultiCursorInner.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2 + 1, ch: 0 }) // blank line right above the table
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down') // -> header row, "ab<br>cd" cell
		await waitForInTableCell(true, 3000)

		// Same 2-RAF-frame settle convention as uppercaseWordMultiCursor's
		// own identical case — dispatching too early gets silently
		// overwritten back down to a single range once Obsidian's own
		// cell-focus reconciliation actually lands.
		await browser.executeObsidian(() => new Promise<void>(resolve => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		}))

		// No native command can add a second cursor inside a table cell yet
		// — dispatch two real ranges directly to the cell's own inner
		// EditorView, the same way this plugin's own code does internally.
		// "ab<br>cd" (represented internally as "ab\ncd"): head=1 (mid "ab"),
		// head=5 (end of "cd").
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

		await browser.executeObsidianCommand('universal-cursor-hotkeys:transpose-chars')

		const cellText = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			return inner.state.doc.toString()
		})
		await expect(cellText).toBe('ba\ndc') // "ab" -> "ba", "cd" -> "dc", both sub-lines independently
	})
})
