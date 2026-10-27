import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// Regression test for a real bug found right after 0.12.0's Set-mark shipped
// (2026-10-22): Recenter's own getCursorScreenY() read the browser's native
// window.getSelection() range's getBoundingClientRect() to find the cursor's
// screen Y. That works fine for a plain (empty) selection, but once Set-mark
// creates a real, non-empty selection, the native Range spans anchor..head —
// its bounding rect is the UNION box of the whole selection, not the head's
// own position. With a forward selection (anchor/mark above, head/cursor
// below), this made Recenter center on the mark instead of the actual
// cursor. Fixed by collapsing to sel.focusNode/focusOffset (the Selection
// API's own "where the caret end sits" properties) before reading the rect.
describe('Recenter with an active Set-mark selection', function () {
	it('Recenter centers the actual cursor (head), not the mark (anchor)', async function () {
		const l = await openFixtureAndGetContentStart('RecenterWithSetMark.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 0 })
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		for (let i = 0; i < 20; i++) {
			await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')
		}

		const before = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			return { scrollTop: cm.scrollDOM.scrollTop as number }
		})

		await browser.executeObsidianCommand('universal-cursor-hotkeys:recenter')
		await browser.pause(200)

		const after = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			const coords = cm.coordsAtPos(cm.state.selection.main.head)
			const scrollRect = cm.scrollDOM.getBoundingClientRect()
			return {
				scrollTop: cm.scrollDOM.scrollTop as number,
				clientHeight: cm.scrollDOM.clientHeight as number,
				headScreenY: coords ? coords.top - scrollRect.top : null,
			}
		})

		// The bug left scrollTop completely unchanged (mark/anchor was already
		// near the top, "no scroll needed"). A real recenter must scroll.
		await expect(after.scrollTop).not.toBe(before.scrollTop)

		// The actual cursor (head) should now sit within half a line of the
		// viewport's vertical center — not off at the mark's own position.
		const expectedCenter = after.clientHeight / 2
		await expect(after.headScreenY).not.toBeNull()
		await expect(Math.abs((after.headScreenY as number) - expectedCenter)).toBeLessThan(20)
	})
})
