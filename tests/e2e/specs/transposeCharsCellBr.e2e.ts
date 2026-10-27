import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, waitForInTableCell } from '../helpers'

// Real-Obsidian coverage for Transpose chars (Alt-T, no default key) inside
// a table cell's own <br>-separated sub-lines — only unit-tested (mocked
// CM6) before this. Confirmed by reading main.ts directly: only the true
// cell boundary (the opening |, sub-line 1's own start) is a hard stop —
// a <br> boundary is crossable and swapped as one atomic 4-character unit
// (never partially), the same way a real \n is treated as one atomic unit
// when crossing a plain-text line boundary. At a sub-line's own end,
// swapLastTwoInRange's grapheme-cluster-aware swap (via findClusterBreak,
// the same primitive CM6's own transposeChars uses) is inherited for free
// there too, not re-verified with its own emoji case here.
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

describe('Transpose chars inside a table cell\'s own <br> sub-lines', function () {
	it('(1) crossing a <br> swaps it as one atomic unit — "A<br>B<br>CD" at the start of "B" becomes "AB<br><br>CD"', async function () {
		await openFixtureAndGetContentStart('TransposeCharsCellBr.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).includes('A<br>B<br>CD')) {
					view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('B') })
					return
				}
			}
			throw new Error('cell not found')
		})
		await waitForInTableCell(true, 3000)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:transpose-chars')
		await browser.pause(300)
		const state = await getState()
		await expect(state.line).toContain('AB<br><br>CD')
	})

	it('(2) at the true start of the cell (the opening "A"), no-ops rather than reaching outside the cell', async function () {
		await openFixtureAndGetContentStart('TransposeCharsCellBrStart.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).includes('A<br>B<br>CD')) {
					view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('A') })
					return
				}
			}
			throw new Error('cell not found')
		})
		await waitForInTableCell(true, 3000)
		const before = await getState()

		await browser.executeObsidianCommand('universal-cursor-hotkeys:transpose-chars')
		await browser.pause(300)
		const after = await getState()
		await expect(after.line).toBe(before.line)
		await expect(after.cursor).toEqual(before.cursor)
	})

	it('(3) at the end of the last sub-line ("CD"), swaps the last two characters there (real Emacs end-of-line case)', async function () {
		await openFixtureAndGetContentStart('TransposeCharsCellBrEnd.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).includes('A<br>B<br>CD')) {
					view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('CD') + 2 })
					return
				}
			}
			throw new Error('cell not found')
		})
		await waitForInTableCell(true, 3000)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:transpose-chars')
		await browser.pause(300)
		const state = await getState()
		await expect(state.line).toContain('DC')
		await expect(state.line).not.toContain('CD')
	})
})
