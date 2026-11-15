import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'
import { readFixtureBody } from '../helpers'

// 0.13.0 Feature 1: Ctrl-P/N crossing between the note body and the
// `.inline-title` field (a plain contenteditable, not CM6). The title's
// own text IS the note's filename, so unlike every other spec in this
// suite (which opens a committed fixture under vaults/smoke/ via
// openFixtureAndGetContentStart), these notes are created on the fly with
// app.vault.create so the filename — and therefore the title under test —
// is controlled directly from the spec itself. The note's BODY content
// still comes from a committed vaults/smoke/*.md fixture (via
// readFixtureBody) — only the title needs to be dynamic. Deleted again in
// `after` so repeated runs don't accumulate stale notes in the shared test
// vault.
//
// This plugin ships with NO default hotkeys (every command is bound only
// once the user configures it), and the title-field Scope specifically
// reads the user's own CURRENT bindings via hotkeyManager.bakedHotkeys —
// so a real keyboard-level test needs a real hotkey registered first
// (hotkeyManager.setHotkeys + bake()), unlike the rest of this suite's
// specs, which invoke commands directly by id and never touch hotkeys at
// all. The key itself is dispatched as a real KeyboardEvent (bubbles:true)
// on whichever element has focus — same technique already used by
// setMarkEscapeKeydown.e2e.ts for a native (non-hotkey) key — so this
// drives the actual Scope/Keymap push-stack dispatch path, not just the
// command callback a plain executeObsidianCommand would reach.
describe('Title crossing: short (unwrapped) title', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function pressCtrl(el: 'body' | 'title', key: string) {
		await browser.executeObsidian(({ app, obsidian }, { el: el2, key: key2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const target = el2 === 'body'
				? (view.editor as any).cm.contentDOM
				: view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			target.dispatchEvent(new KeyboardEvent('keydown', { key: key2, ctrlKey: true, bubbles: true, cancelable: true }))
		}, { el, key })
		// Real keyboard dispatch + Scope push/pop settles asynchronously
		// (focusin/focusout handlers, CM6's own transaction dispatch) —
		// confirmed live a fixed short wait is enough at this interaction
		// rate, matching the margin already used while diagnosing this
		// feature's own bugs earlier in development.
		await browser.pause(150)
	}

	async function readState() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const doc = title.ownerDocument
			const active = doc.activeElement === title
			const sel = doc.getSelection()
			return {
				activeIsTitle: active,
				titleOffset: active && sel?.rangeCount ? sel.getRangeAt(0).startOffset : null,
				cursor: active ? null : view.editor.getCursor(),
			}
		})
	}

	it('body line0 ch0 crosses into the title at exactly offset 0 (no gutter drift)', async function () {
		const path = 'TitleCrossingShortCh0.md'
		createdPaths.push(path)
		const body = await readFixtureBody('TitleCrossingShortCh0Fixture.md')
		await browser.executeObsidian(async ({ app, obsidian }, { path2, body2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, body2)
			await app.workspace.getLeaf(true).openFile(file)
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: 0, ch: 0 }) // line 0 of the fixture body is the actual test position
		}, { path2: path, body2: body })
		await browser.pause(300) // let the freshly-opened title finish laying out

		await pressCtrl('body', 'p')
		const state = await readState()

		// Before the gutter-relative-offset fix, this landed partway into
		// the title instead of its own true start (the body's line-number
		// gutter doesn't exist in the title, so a raw absolute-pixel match
		// overshot by roughly the gutter's own width).
		await expect(state.activeIsTitle).toBe(true)
		await expect(state.titleOffset).toBe(0)
	})

	it('a goal column from a longer line survives crossing a blank line, then round-trips back exactly via Ctrl-A/Ctrl-N', async function () {
		const path = 'TitleCrossingShortRoundTrip.md'
		createdPaths.push(path)
		// Line 0 is blank, line 1 has real text — mirrors the reported
		// scenario: pressing Ctrl-P from deep inside line 1 passes through
		// the blank line 0 on the way to the title.
		const body = await readFixtureBody('TitleCrossingShortRoundTripFixture.md')
		await browser.executeObsidian(async ({ app, obsidian }, { path2, body2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-home', [{ modifiers: ['Ctrl'], key: 'A' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, body2)
			await app.workspace.getLeaf(true).openFile(file)
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: 1, ch: 20 })
		}, { path2: path, body2: body })
		await browser.pause(300)

		await pressCtrl('body', 'p') // line1 -> line0 (blank)
		const afterFirstUp = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getCursor()
		})
		// The blank line itself has no column to show it on — this only
		// proves we're on line 0, not that the goal column survived.
		await expect(afterFirstUp).toEqual({ line: 0, ch: 0 })

		await pressCtrl('body', 'p') // line0 -> title, using the PRESERVED goal column
		const afterEntry = await readState()
		await expect(afterEntry.activeIsTitle).toBe(true)
		// Before reading CM6's native goalColumn (instead of the blank
		// line's own already-collapsed ch-0 position), this landed at the
		// title's own offset 0 — silently forgetting the far-off column
		// several Ctrl-P presses back. A short, unwrapped title clamps to
		// its own last character rather than reproducing the exact body
		// pixel column, so the only robust assertion here is "not 0".
		await expect(afterEntry.titleOffset).not.toBe(0)

		await pressCtrl('title', 'a') // Home: resets to the title's own ch0, resets titleGoalX
		const afterHome = await readState()
		await expect(afterHome.titleOffset).toBe(0)

		await pressCtrl('title', 'n') // escape back into the body, seeding CM6's goalColumn with ch0
		const afterEscape = await readState()
		await expect(afterEscape.activeIsTitle).toBe(false)
		// Lands back on the blank line 0, at its own ch0.
		await expect(afterEscape.cursor).toEqual({ line: 0, ch: 0 })
	})
})
