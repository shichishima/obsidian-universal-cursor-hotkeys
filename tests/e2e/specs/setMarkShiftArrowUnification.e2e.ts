import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// Reported inconsistency: a mouse drag already arms Set-mark immediately
// (markActive = !selection.empty, see the "select.pointer" branch in
// main.ts) — Ctrl-F right after a drag extends from the drag's own
// anchor/head on the very first press. Shift+Arrow range-selection did
// not get the same treatment: before this fix, the first Ctrl-F after a
// Shift-selection just collapsed it (no visible movement, matching the
// universal "first press on an active selection collapses in place"
// convention), and only the *second* Ctrl-F moved — plainly, not
// extending, since markActive was never armed.
//
// Fixed by recognizing Shift+Arrow's own signature in the same
// EditorView.updateListener already used for mouse click/drag: both
// Shift+Arrow and this plugin's own extend commands dispatch with the
// bare "select"/"select.uch" tag family and preserve the anchor while
// moving the head (confirmed live via scratch diagnostic logging, not
// kept) — unlike a plain arrow key collapsing an existing selection, which
// moves the anchor itself to meet the new head. That anchor-preserved
// signature, once tag-filtered to exclude this plugin's own "select.uch"
// dispatches and the existing "select.pointer" mouse case, uniquely
// identifies "something else just extended a selection from a fixed
// anchor" — arming markActive from it, the same way a drag already does.
//
// Content layout relative to the fixture's own --- separator (see
// tests/e2e/vaults/smoke/SetMarkMouseAndLeafChange.md):
//   +0: alpha bravo charlie delta
//   +1: echo foxtrot golf hotel
describe('Set-mark: Shift+Arrow range-selection unifies with Ctrl-PNBF extension', function () {
	it('Ctrl-F right after a Shift+ArrowRight selection extends from its own anchor on the first press (not a collapse)', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 0 })
		}, l)

		// Real Shift+ArrowRight x2 (select "al"), not a synthetic command.
		for (let i = 0; i < 2; i++) {
			await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const cm = (view.editor as any).cm
				cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
					key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true,
				}))
			})
		}

		const armed = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return {
				markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
				selection: view.editor.listSelections(),
			}
		})
		await expect(armed.markActive).toBe(true)
		await expect(armed.selection).toEqual([{ anchor: { line: l, ch: 0 }, head: { line: l, ch: 2 } }])

		// The critical assertion: this plugin's own Ctrl-F extends from
		// the Shift-selection's own anchor on the very first press, rather
		// than collapsing it first.
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-right')
		const afterCtrlF = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.listSelections()
		})
		await expect(afterCtrlF).toEqual([{ anchor: { line: l, ch: 0 }, head: { line: l, ch: 3 } }])
	})

	it('shrinking a Shift+Arrow selection back to empty clears markActive (same as a plain native collapse)', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 0 })
		}, l)

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
				key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true,
			}))
		})
		const armed = await browser.executeObsidian(({ app }) => {
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean
		})
		await expect(armed).toBe(true)

		// Shift+ArrowLeft shrinks it back to exactly the anchor (empty again).
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
				key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true,
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

	// Real, confirmed false positive the anchor-preserved check alone would
	// have missed: native selectAll (Ctrl-A/Cmd-A, if bound outside this
	// plugin's own "Select all" command) always dispatches anchor 0/head
	// doc.length under the same bare "select" tag as a genuine extend. If
	// the cursor already happened to sit at position 0, "anchor unchanged"
	// passes by pure coincidence — selectAll's own result is
	// state-identical to a genuine Shift-Ctrl-End extend made from
	// position 0, so nothing in the transaction can tell them apart.
	// Deliberately excluding "the whole buffer, start to end" trades away
	// arming for that one indistinguishable case (falls back to the older,
	// still-correct collapse-first behavior there) in exchange for not
	// misfiring on the much more commonly hit selectAll collision.
	it('native selectAll from document position 0 does not arm markActive', async function () {
		await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		const result = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			view.editor.setCursor({ line: 0, ch: 0 })
			// Same dispatch shape as @codemirror/commands' own selectAll.
			cm.dispatch({
				selection: { anchor: 0, head: cm.state.doc.length },
				userEvent: 'select',
			})
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean
		})
		await expect(result).toBe(false)
	})

	it('a genuine Shift+Ctrl+End extend from a non-zero position still arms markActive (the whole-buffer exclusion is narrow, not a general regression)', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 1 }) // deliberately NOT position 0
		}, l)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
				key: 'End', shiftKey: true, metaKey: true, bubbles: true, cancelable: true,
			}))
		})
		const result = await browser.executeObsidian(({ app }) => {
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean
		})
		await expect(result).toBe(true)
	})
})
