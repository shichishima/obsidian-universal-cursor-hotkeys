import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, waitForInTableCell } from '../helpers'

// Real bug report: in a table cell whose content is one hard line but long
// enough to word-wrap into multiple visual lines (no <br> at all — plain
// soft-wrap), double-click a word on the first visual line, Ctrl-W (kill
// region), Cmd-Z (undo), Ctrl-N (cursor-down) — the cursor exited to the
// row below instead of advancing to the cell's own next visual line, even
// though moveCursorDownInTable's own isOnLastVL check correctly computed
// "not on the last visual line" (confirmed live via a diagnostic before
// fixing).
//
// Root cause: native goDown's own real convention, independent of this
// plugin entirely, is "an active selection collapses in place on this
// press without also moving" (confirmed live with this plugin disabled —
// Cmd-X, Cmd-Z, bare physical Down arrow, same no-move result). Undo
// restores the original (non-empty) selection, so the very next goDown
// call just collapses it — a real action, but reported as a "no-op" `ch`
// reading, which moveCursorDownInTable's own file-end fallback
// misinterpreted as "nothing below." Fixed by checking whether a
// selection was active immediately before calling goDown.
//
// Unlike most other table-entry-dependent specs in this suite, this one
// needs no browser.pause(...) settle time at all — confirmed by running
// it 13+ times in isolation and twice as part of the full shared-instance
// suite, zero flakes either way, with the suite's own total E2E time
// roughly halved as a result. Every step here works off a position this
// plugin's own commands (cursor-down, table-cell-down/-right) just
// produced synchronously, unlike specs that click/navigate into a
// freshly-opened file's table before anything has rendered yet.
//
// Content layout relative to the fixture's own --- separator (see
// tests/e2e/vaults/smoke/UndoInCellVLStale.md — a minimal table built for
// this test, not the original real-world note the bug was first found in):
//   +0: (blank)
//   +1: header row
//   +2: delimiter row
//   +3: row1 — col3 is a long single line that word-wraps
//   +4: row2 — col2/col3 are empty cells
const TARGET_CELL_TEXT = 'alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey'

describe('Undo in a word-wrapped table cell does not exit to the row below', function () {
	it('kill-region + undo + cursor-down stays in the same cell (not the empty cell below)', async function () {
		const l = await openFixtureAndGetContentStart('UndoInCellVLStale.md')

		// Reach row1/col3 via reliable cell-to-cell navigation — coordsAtPos
		// on a not-yet-focused row resolves to wherever the table's own
		// first row starts (same "whole unfocused table is one collapsed
		// visual block" behavior confirmed during Set-mark's own
		// table-skip work), so a direct coordinate click into an arbitrary
		// row doesn't reliably land where intended.
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 0 }) // blank line right above the table
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down') // -> header/col1
		await waitForInTableCell(true)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:table-cell-down') // -> row1/col1
		await browser.executeObsidianCommand('universal-cursor-hotkeys:table-cell-right') // -> row1/col2
		await browser.executeObsidianCommand('universal-cursor-hotkeys:table-cell-right') // -> row1/col3

		// Real double-click on "alpha" (the cell's own first word), using
		// the now-focused inner view's own coordsAtPos.
		const targetCoords = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			const text = inner.state.doc.toString()
			const ch = text.indexOf('alpha')
			const coords = inner.coordsAtPos(ch)
			return coords ? { x: (coords.left + coords.right) / 2, y: (coords.top + coords.bottom) / 2 } : null
		})

		await browser.executeObsidian(({ app, obsidian }, pos) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			inner.contentDOM.dispatchEvent(new MouseEvent('mousedown', {
				bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 2, clientX: pos!.x, clientY: pos!.y,
			}))
			document.dispatchEvent(new MouseEvent('mouseup', {
				bubbles: true, cancelable: true, button: 0, buttons: 0, detail: 2, clientX: pos!.x, clientY: pos!.y,
			}))
		}, targetCoords)

		const selectedWord = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getSelection()
		})
		await expect(selectedWord).toBe('alpha')

		await browser.executeObsidianCommand('universal-cursor-hotkeys:kill-region')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.undo()
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')

		const after = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			return {
				inTableCell: (view.editor as any).inTableCell,
				innerDocText: inner ? inner.state.doc.toString() : null,
			}
		})

		await expect(after.inTableCell).toBe(true)
		// Still row1/col3's own (undo-restored) content — not the empty
		// cell in row2 below it.
		await expect(after.innerDocText).toBe(TARGET_CELL_TEXT)
	})
})
