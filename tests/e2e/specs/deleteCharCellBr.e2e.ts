import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, waitForInTableCell } from '../helpers'

// Real-Obsidian coverage for Delete char (Ctrl-D) inside a table cell's own
// <br>-separated sub-lines — only unit-tested (mocked CM6) before this.
// Delete char's own grapheme-cluster-awareness is inherited for free from
// CM6's own deleteCharForward (an already-trustworthy, well-established
// official command) — not re-verified here, unlike moveByCharacters (h/l),
// which needed its own custom logic for that. The real plugin-specific
// risk is the <br> boundary handling: deleteCharInTableLP treats a cell's
// own <br> tag as one atomic unit when joining two sub-lines, and
// separately clamps so the cell's own true end never crosses into the
// adjacent cell.
function getState() {
	return browser.executeObsidian(({ app, obsidian }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
		const editor = view.editor as any
		return {
			cursor: view.editor.getCursor(),
			inTableCell: editor.inTableCell as boolean,
			line: view.editor.getLine(view.editor.getCursor().line),
		}
	})
}

describe('Delete char (Ctrl-D) inside a table cell\'s own <br> sub-lines', function () {
	it('at the end of a non-last sub-line, joins it with the next (deletes the <br> as one unit)', async function () {
		await openFixtureAndGetContentStart('DeleteCharCellBrJoin.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).includes('alpha<br>bravo')) {
					const ch = view.editor.getLine(i).indexOf('alpha') + 'alpha'.length
					view.editor.setCursor({ line: i, ch })
					return
				}
			}
			throw new Error('cell not found')
		})
		await waitForInTableCell(true, 3000)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:delete-char')
		await browser.pause(300)
		const state = await getState()
		await expect(state.line).toContain('alphabravo')
		await expect(state.line).not.toContain('<br>')
	})

	it('at the true end of the cell (last sub-line\'s own end), no-ops rather than crossing into the adjacent cell', async function () {
		await openFixtureAndGetContentStart('DeleteCharCellBrEnd.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).includes('alpha<br>bravo')) {
					const ch = view.editor.getLine(i).indexOf('bravo') + 'bravo'.length
					view.editor.setCursor({ line: i, ch })
					return
				}
			}
			throw new Error('cell not found')
		})
		await waitForInTableCell(true, 3000)
		const before = await getState()

		await browser.executeObsidianCommand('universal-cursor-hotkeys:delete-char')
		await browser.pause(300)
		const after = await getState()
		await expect(after.line).toBe(before.line)
		await expect(after.cursor).toEqual(before.cursor)
		await expect(after.inTableCell).toBe(true) // stayed in this cell, didn't cross to "y"
	})
})
