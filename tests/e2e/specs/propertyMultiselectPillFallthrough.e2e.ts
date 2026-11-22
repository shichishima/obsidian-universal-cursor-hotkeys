import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// Regression coverage for a confirmed real bug: every command gated on
// PROPERTY_TEXT_LIKE_EDIT_SELECTOR + PROPERTY_ANY_ITEM_SELECTION_SELECTOR
// (Home/End, Word left/right, Set-mark, Kill-line/region/Copy-region/
// Yank, Kill word left/right, Delete char) fell through to the BODY
// editor's own fallback whenever a tags/list/aliases widget had focus,
// since neither selector matched a committed pill
// (.multi-select-pill) or the trailing composing input
// (.multi-select-input) at all -- same visible-focus-stays-put,
// invisible-body-corruption shape as the already-fixed row/heading/
// Add-button gap (see PROPERTY_ANY_ITEM_SELECTION_SELECTOR's own
// comment in main.ts), just never extended to this widget.
//
// Fix: PROPERTY_TEXT_LIKE_EDIT_SELECTOR now includes
// PROPERTY_MULTISELECT_INPUT_SELECTOR (the composing input is a
// contenteditable DIV just like the text-value widget, so the existing
// titleXxx reuse already works on it mechanically); the committed pill
// is added to PROPERTY_ANY_ITEM_SELECTION_SELECTOR for a safe no-op,
// confirmed live against real, unbound physical keys to match native
// (Home/End/Delete char are genuine no-ops on a focused pill) -- except
// Word left/right, where native Option-Left/Right actually moves to
// the previous/next pill, so those two check
// PROPERTY_MULTISELECT_PILL_SELECTOR separately and dispatch via the
// same propertyNativeArrowFallback cursor-left/right already uses for
// a pill, rather than no-op.
//
// Kill word left/right still no-op on a pill in this fix (confirmed
// red/green only for "no longer corrupts the body") -- native
// Option-Backspace/Delete is asymmetric and destructive (deletes the
// pill outright), deliberately NOT replicated here; that richer,
// pill-specific kill/yank round-trip is a separate follow-up.
//
// Word left/right use a Ctrl+Shift test hotkey rather than this
// plugin's own recommended Alt-B/Alt-F: confirmed live that a REAL
// Alt-combo keypress sent through WebDriver on macOS, while this
// plugin's own checkCallback is synchronously re-dispatching a
// SEPARATE synthetic keydown from inside that same real event's own
// handler, doesn't reach Obsidian's native pill-navigation listener --
// the identical dispatch succeeds immediately when triggered any other
// way (a standalone dispatchEvent call, executeObsidianCommand, or a
// real non-Alt combo like Ctrl+Shift+L). This is a macOS/WebDriver
// Option-key automation quirk specific to this nested-dispatch shape,
// not a real bug (the actual fix code is identical either way) --
// Alt-B/F against a pill can't be exercised reliably through this E2E
// harness, so this spec never sends it.
describe('PROPERTY_TEXT_LIKE_EDIT_SELECTOR / PROPERTY_ANY_ITEM_SELECTION_SELECTOR now cover tags/list pills', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function openNote(path: string) {
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app }, { path2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:word-left', [{ modifiers: ['Ctrl', 'Shift'], key: 'L' }])
			hm.setHotkeys('universal-cursor-hotkeys:word-right', [{ modifiers: ['Ctrl', 'Shift'], key: 'R' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-home', [{ modifiers: ['Ctrl'], key: 'A' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-line', [{ modifiers: ['Ctrl'], key: 'K' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, '---\nmylist:\n  - itemOne\n  - itemTwo\n  - itemThree\n---\nalpha bravo charlie delta\n')
			await app.workspace.getLeaf(true).openFile(file)
		}, { path2: path })
		await browser.pause(400)
	}

	async function dismissSuggesterIfOpen() {
		const hasSuggester = await browser.executeObsidian(() => !!document.querySelector('.suggestion-container.mod-property-value .suggestion-item'))
		if (hasSuggester) {
			await browser.keys(['Escape'])
			await browser.pause(200)
		}
	}

	async function focusRowThenInput() {
		const row = await browser.$('.metadata-property[data-property-key="mylist"]')
		await row.click({ x: 2, y: 2 })
		await browser.pause(150)
		const input = await browser.$('.metadata-property[data-property-key="mylist"] .multi-select-input')
		await input.click()
		await browser.pause(150)
		// Focusing a property whose value already appears elsewhere in the
		// vault's metadataCache (every note here reuses the same "mylist"
		// key) can pop the native "previously used values" suggester,
		// which swallows the very next keypress before this plugin's own
		// checkCallback ever sees it (project_checkcallback_property_suggester_ctrl_np_swallowed
		// memory) -- dismiss it first, same as every other spec that
		// focuses a multi-select widget this way.
		await dismissSuggesterIfOpen()
	}

	async function focusLastPill() {
		await focusRowThenInput()
		await browser.keys(['ArrowLeft']) // lands on "itemThree"
		await browser.pause(150)
	}

	async function snap() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			return {
				activeClass: active?.className ?? null,
				activeText: active?.textContent ?? null,
				bodyCursor: view.editor.getCursor(),
				// Kill-line at ch0 of a non-empty line kills the whole line
				// without moving the cursor's own line/ch coordinates at all
				// (both the start AND the end of the now-empty line) -- a
				// cursor-position-only check would miss that corruption
				// entirely, so this also reads the body's own line content.
				bodyLine: view.editor.getLine(6),
			}
		})
	}

	it('(1) Word right on a pill moves to the NEXT pill, not the body cursor', async function () {
		await openNote('PillFallthroughWordRight.md')
		await focusLastPill() // "itemThree", the LAST pill -- nothing after it
		await browser.keys(['Control', 'Shift', 'l']) // back off itemThree onto itemTwo first, so Word right has somewhere to go
		await browser.pause(150)
		const before = await snap()
		await browser.keys(['Control', 'Shift', 'r'])
		await browser.pause(150)
		const after = await snap()
		await expect(after.activeClass).toBe('multi-select-pill')
		await expect(after.activeText).toBe('itemThree')
		await expect(after.bodyCursor).toEqual(before.bodyCursor) // body untouched
	})

	it('(2) Word left on a pill moves to the PREVIOUS pill, not the body cursor', async function () {
		await openNote('PillFallthroughWordLeft.md')
		await focusLastPill() // "itemThree"
		const before = await snap()
		await browser.keys(['Control', 'Shift', 'l'])
		await browser.pause(150)
		const after = await snap()
		await expect(after.activeClass).toBe('multi-select-pill')
		await expect(after.activeText).toBe('itemTwo')
		await expect(after.bodyCursor).toEqual(before.bodyCursor) // body untouched
	})

	it('(3) Home on a pill is a true no-op, not a silent body-cursor move', async function () {
		await openNote('PillFallthroughHome.md')
		await focusLastPill() // "itemThree"
		const before = await snap()
		await browser.keys(['Control', 'a'])
		await browser.pause(150)
		const after = await snap()
		await expect(after).toEqual(before) // nothing changed at all
	})

	it('(4) Kill-line on a pill is a true no-op, not a silent body-text deletion', async function () {
		await openNote('PillFallthroughKillLine.md')
		await focusLastPill() // "itemThree"
		const before = await snap()
		await browser.keys(['Control', 'k'])
		await browser.pause(150)
		const after = await snap()
		await expect(after).toEqual(before) // nothing changed -- body line 5 ("alpha bravo...") untouched
	})

	it('(5) the trailing composing input gets REAL text editing (Home/Word right), not a fallthrough', async function () {
		await openNote('PillFallthroughComposingInput.md')
		await focusRowThenInput()
		await browser.keys(['f', 'o', 'u', 'r']) // type "four" (uncommitted)
		await browser.pause(150)

		const bodyBefore = await browser.executeObsidian(({ app, obsidian }) => {
			return app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.getCursor()
		})

		await browser.keys(['Control', 'a']) // Home: should move within "four", not touch the body
		await browser.pause(150)
		const afterHome = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mylist"]') as HTMLElement
			const el = row.querySelector('.multi-select-input') as HTMLElement
			const sel = el.ownerDocument.getSelection()
			return { focusOffset: sel?.focusOffset, bodyCursor: view.editor.getCursor() }
		})
		await expect(afterHome.focusOffset).toBe(0) // moved to the start of "four"
		await expect(afterHome.bodyCursor).toEqual(bodyBefore) // body untouched

		await browser.keys(['Control', 'Shift', 'r']) // Word right: to the end of "four"
		await browser.pause(150)
		const afterWordRight = await browser.executeObsidian(({ app, obsidian }) => {
			const row = (app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.containerEl)
				.querySelector('.metadata-property[data-property-key="mylist"]') as HTMLElement
			const el = row.querySelector('.multi-select-input') as HTMLElement
			return el.ownerDocument.getSelection()?.focusOffset
		})
		await expect(afterWordRight).toBe(4) // "four".length
	})
})
