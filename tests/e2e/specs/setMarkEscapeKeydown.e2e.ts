import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// A bare-ESC Key Upgrade (app.hotkeyManager.setHotkeys claiming Escape
// globally) was tried and reverted (2026-10-17): it broke Escape in
// non-CM6 contexts that rely on it natively (Excalidraw, the note title
// field's own deselect). The replacement is a purely passive `keydown`
// listener (no preventDefault/stopPropagation) that just clears
// markActive as a side effect — native Escape handling everywhere,
// including CM6's own simplifySelection, proceeds untouched.
//
// Without this listener, pressing Escape to collapse a Set-mark
// selection (via CM6's native simplifySelection) leaves markActive true
// — that keydown never reaches any of this plugin's own commands — so
// the very next Ctrl-B/F/N/P/A/E would silently re-arm a new region from
// wherever the cursor ended up. This is exactly the desync a person using
// the feature reported live.
//
// Content layout relative to the fixture's own --- separator (see
// tests/e2e/vaults/smoke/SetMarkMouseAndLeafChange.md):
//   +0: alpha bravo charlie delta
//   +1: echo foxtrot golf hotel
describe('Set-mark: bare Escape clears markActive without claiming the key', function () {
	it('native Escape collapses the selection; markActive is cleared as a side effect; a later extend command does a plain move, not a re-extend', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 0 })
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')

		const beforeEscape = await browser.executeObsidian(({ app }) => {
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean
		})
		await expect(beforeEscape).toBe(true)
		const selectionBeforeEscape = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.listSelections()
		})
		await expect(selectionBeforeEscape).toEqual([{ anchor: { line: l, ch: 0 }, head: { line: l + 1, ch: 0 } }])

		// Dispatched on cm.contentDOM (where CM6's own keydown handling
		// lives), bubbling up to the document-level listener this plugin
		// registers — not a synthetic command invocation, a real DOM event.
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
				key: 'Escape', bubbles: true, cancelable: true,
			}))
		})

		const afterEscape = await browser.executeObsidian(({ app }) => {
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean
		})
		await expect(afterEscape).toBe(false)
		const selectionAfterEscape = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.listSelections()
		})
		// CM6's native simplifySelection collapsed it to a cursor at the
		// region's own head (not back to the anchor).
		await expect(selectionAfterEscape).toEqual([{ anchor: { line: l + 1, ch: 0 }, head: { line: l + 1, ch: 0 } }])

		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-right')
		const afterCtrlF = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.listSelections()
		})
		// Plain one-character move, not an extend back toward any old anchor.
		await expect(afterCtrlF).toEqual([{ anchor: { line: l + 1, ch: 1 }, head: { line: l + 1, ch: 1 } }])
	})
})
