import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, waitForInTableCell } from '../helpers'

// Three real gaps found while auditing every command against real Emacs's
// own deactivate-mark convention (transient-mark-mode deactivates the mark
// after virtually any command unless it explicitly opts out) — not assumed,
// cross-checked against this plugin's own source for each command below.
//
// Content layout relative to the fixture's own --- separator (see
// tests/e2e/vaults/smoke/SetMarkMouseAndLeafChange.md):
//   +0: alpha bravo charlie delta
//   +1: echo foxtrot golf hotel
describe('Set-mark: clearing/arming gaps found via real-Emacs-behavior audit', function () {
	it('Kill line now clears markActive (previously left it armed — kill-line never looks at the selection, but real Emacs still deactivates the mark like any other editing command)', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 0 })
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-right') // extend to "a"

		await browser.executeObsidianCommand('universal-cursor-hotkeys:kill-line')

		const after = await browser.executeObsidian(({ app }) => ({
			markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
		}))
		await expect(after.markActive).toBe(false)
	})

	it("Move to cell right now clears markActive (previously left a 'zombie' armed mark that silently re-armed a new region from the landed cell)", async function () {
		const l = await openFixtureAndGetContentStart('SetMarkTableSkip.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = l2; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).includes('| a | b |')) {
					view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('a') })
					return
				}
			}
			throw new Error('cell not found')
		}, l)
		await waitForInTableCell(true, 3000)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-right') // extend to select "a"
		await browser.executeObsidianCommand('universal-cursor-hotkeys:table-cell-right')

		const after = await browser.executeObsidian(({ app }) => ({
			markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
		}))
		await expect(after.markActive).toBe(false)

		// Confirm this isn't just the flag — the next extend command must
		// genuinely move rather than silently start a new region.
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-right')
		const sel = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			return { anchor: inner.state.selection.main.anchor, head: inner.state.selection.main.head }
		})
		await expect(sel.anchor).toBe(sel.head) // plain move, no new selection
	})

	it('Exit table below now clears markActive (same gap/fix as Move to cell, shared table-navigation.ts implementation)', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkTableSkip.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = l2; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).includes('| c | d |')) {
					view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('c') })
					return
				}
			}
			throw new Error('cell not found')
		}, l)
		await waitForInTableCell(true, 3000)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-right') // extend to select "c"
		await browser.executeObsidianCommand('universal-cursor-hotkeys:table-exit-down')
		await waitForInTableCell(false, 3000)

		const after = await browser.executeObsidian(({ app }) => ({
			markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
		}))
		await expect(after.markActive).toBe(false)
	})

	it('Select all now arms markActive (previously left it untouched) — matching real Emacs\'s mark-whole-buffer, which activates a fresh region rather than leaving mark state alone', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 5 })
		}, l)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:select-all')

		const after = await browser.executeObsidian(({ app }) => ({
			markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
		}))
		await expect(after.markActive).toBe(true)

		// Confirm the armed mark is genuinely usable: the next extend
		// command continues from the selection Select all just made (its
		// own head, the document's end), not a fresh/reset anchor. Compared
		// as offsets (not hardcoded line/ch) so this doesn't depend on the
		// fixture's own exact trailing-newline layout.
		const before = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const sel = view.editor.listSelections()[0]
			return { anchor: view.editor.posToOffset(sel.anchor), head: view.editor.posToOffset(sel.head) }
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-left')
		const after2 = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const sel = view.editor.listSelections()[0]
			return { anchor: view.editor.posToOffset(sel.anchor), head: view.editor.posToOffset(sel.head) }
		})
		await expect(after2.anchor).toBe(before.anchor) // original anchor (offset 0) preserved
		await expect(after2.head).toBe(before.head - 1) // extending FROM where Select all's own head was, one char back
	})
})
