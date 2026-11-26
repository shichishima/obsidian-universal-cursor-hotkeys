import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// Phase 2 of fix/property-multiselect-pill-command-fallthrough's own
// follow-up: Kill word left/right and Yank on an already-committed
// pill in a tags/list/aliases field, richer than the Phase-1 fix's
// plain no-op (see propertyMultiselectPillFallthrough.e2e.ts).
//
// Kill word left/right (propertyPillKillWord): deliberately symmetric
// in both directions, unlike native Option-Backspace/Delete (confirmed
// live elsewhere: backward deletes the pill outright, forward is a
// no-op) -- every other Kill word implementation in this plugin always
// kills something and pushes it to the kill-cache/clipboard, so this
// one does too, joining the kill-cache from whichever side matches its
// own direction (same `!forward` convention titleKillWord uses).
// Deletion itself dispatches a synthetic Backspace, wrapped in the
// SAME isDispatchingKill guard killLineOuter's own cm.dispatch call
// uses -- found live as a real second bug while building this test:
// deleting a pill rewrites the note's own raw frontmatter YAML, a real
// transaction on the body's underlying CM6 document that Obsidian
// tags with a genuine Transaction.userEvent (a real, undo-worthy user
// edit from Obsidian's own perspective) -- without the guard, that
// transaction immediately reset isKillChaining via this plugin's own
// EditorView.updateListener, so two consecutive kills on two different
// pills only ever kept the SECOND one's text, discarding the first.
//
// Yank (propertyPillYank): the round-trip counterpart, appending a new
// pill at the list's own end -- the same place a newly-TYPED tag
// always commits to; pill-to-pill reordering has no native equivalent
// at all, not even for a human physically typing one (deliberately
// scoped to the pill case only, not the trailing composing input,
// which already yanks correctly as plain text-at-caret via Phase 1's
// own PROPERTY_TEXT_LIKE_EDIT_SELECTOR widening).
describe('Kill word / Yank round-trip on an already-committed pill', function () {
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
			hm.setHotkeys('universal-cursor-hotkeys:kill-word-left', [{ modifiers: ['Ctrl', 'Shift'], key: 'K' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-word-right', [{ modifiers: ['Ctrl', 'Shift'], key: 'J' }])
			hm.setHotkeys('universal-cursor-hotkeys:yank', [{ modifiers: ['Ctrl', 'Shift'], key: 'Y' }])
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

	async function focusLastPill() {
		const row = await browser.$('.metadata-property[data-property-key="mylist"]')
		await row.click({ x: 2, y: 2 })
		await browser.pause(150)
		const input = await browser.$('.metadata-property[data-property-key="mylist"] .multi-select-input')
		await input.click()
		await browser.pause(150)
		await dismissSuggesterIfOpen()
		await browser.keys(['ArrowLeft']) // lands on "itemThree"
		await browser.pause(150)
	}

	async function readState() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mylist"]') as HTMLElement
			const pills = Array.from(row.querySelectorAll('.multi-select-pill')).map(p => p.textContent)
			return {
				pills,
				// Compares the body's own text content, not a line INDEX --
				// deleting/adding a pill changes the raw frontmatter YAML's
				// own line count, which shifts every body line's index
				// without the body itself actually changing at all.
				bodyText: view.editor.getValue().split('---\n').pop(),
			}
		})
	}

	it('(1) Kill word left on a pill deletes it, pushes its text to the kill-cache/clipboard, body untouched', async function () {
		await openNote('PillKillWordLeft.md')
		await focusLastPill() // "itemThree"
		const before = await readState()
		await browser.keys(['Control', 'Shift', 'k'])
		await browser.pause(200)
		const after = await readState()

		const killCache = await browser.executeObsidian(({ app }) => {
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].killCache as string
		})
		const clip = await browser.executeObsidian(async () => {
			try { return await navigator.clipboard.readText() } catch { return null }
		})

		await expect(after.pills).toEqual(['itemOne', 'itemTwo'])
		await expect(after.bodyText).toBe(before.bodyText)
		await expect(killCache).toBe('itemThree')
		await expect(clip).toBe('itemThree')
	})

	it('(2) Kill word right on a pill also deletes it and pushes its text to the kill-cache (symmetric with left)', async function () {
		await openNote('PillKillWordRight.md')
		await focusLastPill() // "itemThree"
		const before = await readState()
		await browser.keys(['Control', 'Shift', 'j'])
		await browser.pause(200)
		const after = await readState()
		const killCache = await browser.executeObsidian(({ app }) => {
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].killCache as string
		})

		await expect(after.pills).toEqual(['itemOne', 'itemTwo'])
		await expect(after.bodyText).toBe(before.bodyText)
		await expect(killCache).toBe('itemThree')
	})

	it('(3) regression: consecutive Kill word left on two different pills chains into ONE kill-cache entry', async function () {
		await openNote('PillKillWordChain.md')
		await focusLastPill() // "itemThree"
		await browser.keys(['Control', 'Shift', 'k']) // kills "itemThree", lands on "itemTwo"
		await browser.pause(200)
		await browser.keys(['Control', 'Shift', 'k']) // kills "itemTwo" too -- no intervening command
		await browser.pause(200)
		const killCache = await browser.executeObsidian(({ app }) => {
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].killCache as string
		})
		// Prepend convention (same as titleKillWord's own `!forward`):
		// each new backward kill joins onto the FRONT of the existing cache.
		await expect(killCache).toBe('itemTwoitemThree')
	})

	it('(4) Yank on a pill appends the killed text as a new pill at the list\'s own end', async function () {
		await openNote('PillYankAppend.md')
		await focusLastPill() // "itemThree"
		await browser.keys(['Control', 'Shift', 'k']) // kill it -> kill-cache/clipboard = "itemThree"
		await browser.pause(200)

		const input = await browser.$('.metadata-property[data-property-key="mylist"] .multi-select-input')
		await input.click()
		await browser.pause(150)
		await dismissSuggesterIfOpen()
		await browser.keys(['ArrowLeft']) // lands on the new last pill, "itemTwo"
		await browser.pause(150)

		const before = await readState()
		await browser.keys(['Control', 'Shift', 'y'])
		await browser.pause(300)
		const after = await readState()

		await expect(after.pills).toEqual(['itemOne', 'itemTwo', 'itemThree'])
		await expect(after.bodyText).toBe(before.bodyText)
	})
})
