import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// Real report: Set-mark → extend to a real selection → a bare (unmodified)
// physical arrow key collapses it, same as any plain editor's "first press
// on an active selection just collapses in place" convention — but that key
// isn't this plugin's own command, so it never reached a callback that
// could clear markActive, leaving a later Ctrl-B/F/N/P/A/E silently re-arm
// a new region from wherever the physical key left the cursor.
//
// Same gap/fix shape as Escape/cut/copy/paste/Backspace/Delete, but there's
// no fixed key list to listen for here: every one of @codemirror/commands'
// own plain-movement commands (bare arrows, Home/End, Page Up/Down,
// Ctrl-Home/End, ...) dispatches through the same shared `setSel` helper,
// tagged `userEvent: "select"` (confirmed by reading that source directly)
// — one check in the EditorView.updateListener in main.ts covers all of
// them, no per-key enumeration needed.
//
// This plugin's own extend/collapse dispatches (the 5 extendMark*
// functions, plus collapseActiveSelectionToHead shared by Set-mark's own
// re-press and Ctrl-G) use a more specific `"select.uch"` tag instead of
// bare `"select"` specifically so this new rule can't misfire on them —
// confirmed via scratch diagnostic logging that CM6 tags a native collapse
// and this plugin's own extend identically by tag alone (both `"select"`)
// when they weren't yet distinguished. Without the distinct tag, two of
// this plugin's own legitimate actions would have been wrongly caught by a
// plain "selection went non-empty -> empty" check: Set-mark's own re-press
// (markActive is set true *before* its own collapse-to-head dispatch) and
// extending one way then back to the exact anchor (a real non-empty ->
// empty transition that's this plugin's own doing, not a native collapse).
// Both are covered below alongside the main native-collapse case.
//
// Content layout relative to the fixture's own --- separator (see
// tests/e2e/vaults/smoke/SetMarkMouseAndLeafChange.md):
//   +0: alpha bravo charlie delta
//   +1: echo foxtrot golf hotel
describe('Set-mark: native physical cursor movement clears markActive without claiming any key', function () {
	it('a bare ArrowLeft collapsing an active selection clears markActive', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 0 })
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-right') // extend: "a" selected

		const before = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return {
				markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
				selection: view.editor.listSelections(),
			}
		})
		await expect(before.markActive).toBe(true)
		await expect(before.selection).toEqual([{ anchor: { line: l, ch: 0 }, head: { line: l, ch: 1 } }])

		// Dispatched on cm.contentDOM (where CM6's own key handling lives),
		// bubbling up to the document-level listener — not a synthetic
		// command invocation, a real DOM event, same technique as the
		// existing Escape/Backspace/Delete specs.
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
				key: 'ArrowLeft', bubbles: true, cancelable: true,
			}))
		})

		const after = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return {
				markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
				selection: view.editor.listSelections(),
			}
		})
		await expect(after.selection).toEqual([{ anchor: { line: l, ch: 0 }, head: { line: l, ch: 0 } }])
		await expect(after.markActive).toBe(false)
	})

	it("extending then retracting back to the exact anchor does NOT clear markActive (this plugin's own doing, not a native collapse)", async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 0 })
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-right') // extend to "a"
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-left') // retract back to the anchor — selection goes non-empty -> empty

		const afterRetract = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return {
				markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
				selection: view.editor.listSelections(),
			}
		})
		await expect(afterRetract.selection).toEqual([{ anchor: { line: l, ch: 0 }, head: { line: l, ch: 0 } }])
		await expect(afterRetract.markActive).toBe(true)

		// Confirm the mark is still genuinely usable from the original
		// anchor, not just left "true" while actually desynced.
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-right')
		const afterReExtend = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.listSelections()
		})
		await expect(afterReExtend).toEqual([{ anchor: { line: l, ch: 0 }, head: { line: l, ch: 1 } }])
	})

	it('re-pressing Set-mark while a selection is already active leaves markActive true (re-arm, not clobbered by the new rule)', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 0 })
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-right')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-right') // extend to "al"

		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark') // re-press: abandon + re-anchor at current head

		const after = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return {
				markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
				selection: view.editor.listSelections(),
			}
		})
		await expect(after.selection).toEqual([{ anchor: { line: l, ch: 2 }, head: { line: l, ch: 2 } }])
		await expect(after.markActive).toBe(true)
	})
})
