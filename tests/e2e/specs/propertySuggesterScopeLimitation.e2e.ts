import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// Known, Obsidian-VERSION-specific architectural limitation (not a bug
// in this plugin, and not something checkCallback's own dispatch logic
// could ever fix): Obsidian's own "previously used values" suggester
// pushes its own app.keymap Scope the moment a text/multi-select/
// key-edit widget is focused, registering Ctrl-N/Ctrl-P itself (a
// built-in Obsidian 1.13.4+ feature, see
// https://obsidian.md/changelog/2026-07-30-desktop-v1.13.4/). That
// Scope sits above rootScope, so Ctrl-N/P never reaches this plugin's
// own checkCallback-based commands while the dropdown is genuinely
// visible. Confirmed via a live app.keymap.getWindowStack() probe:
// focusing the widget pushes exactly one new scope (depth +1, carrying
// the suggester's own Ctrl-N/P/ArrowUp/Down/Enter registrations); that
// SAME scope object stays active across typing/re-filtering; Escape
// pops JUST that one scope back off (DOM focus never moves) -- see
// project_checkcallback_property_suggester_ctrl_np_swallowed memory for
// the full writeup. 0.13.0 ships scoped to what checkCallback can
// reach; this is the one documented gap, and native physical arrow
// keys / mouse already cover the same suggester navigation regardless.
//
// This spec is a CANARY for a future Obsidian version changing that
// internal behavior, not a feature test of this plugin's own code: if
// the "while suggester is open" assertion below ever starts FAILING
// because Ctrl-N/P unexpectedly moved the cursor, that's GOOD NEWS --
// Obsidian stopped swallowing the key, and this plugin's existing
// checkCallback-based Ctrl-N/P should reach the widget there with zero
// code changes. Revisit the memory above and this limitation's own
// entry in tests/E2E.md and the public limitations doc if that happens.
describe('Known limitation: Obsidian\'s own suggester swallows Ctrl-N/P while visibly open', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	it('Ctrl-N is a true no-op while the suggester is visibly open, and moves the cursor normally once dismissed via Escape', async function () {
		const notePaths = ['SuggesterLimitationNote1.md', 'SuggesterLimitationNote2.md']
		createdPaths.push(...notePaths)
		// No spaces, so it can only wrap mid-word -- same fixture shape
		// as propertyValueEditMovement.e2e.ts's own wrapped-value test,
		// guaranteeing a real second visual line for Ctrl-N to reach
		// once the suggester is out of the way.
		const longValue = 'aaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbccccccccccccccccccccddddddddddddddddddddeeeeeeeeeeeeeeeeeeee'

		await browser.executeObsidian(async ({ app }, { paths, value }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			for (const p of paths) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(paths[0], `---\nmyText: ${value}\n---\nbody1\n`)
			// A second note with the SAME value, so the "previously used
			// values" suggester has a real match to show from focus
			// alone, with no typing required.
			await app.vault.create(paths[1], `---\nmyText: ${value}\n---\nbody2\n`)
			await app.workspace.getLeaf(true).openFile(app.vault.getFileByPath(paths[0])!)
		}, { paths: notePaths, value: longValue })
		await browser.pause(400)

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const value = row.querySelector('.metadata-input-longtext') as HTMLElement
			value.focus()
			const sel = value.ownerDocument.getSelection()!
			const textNode = value.firstChild!
			const range = value.ownerDocument.createRange()
			range.setStart(textNode, 0)
			range.collapse(true)
			sel.removeAllRanges()
			sel.addRange(range)
		})
		await browser.pause(200)

		const suggesterVisible = await browser.executeObsidian(() => {
			return !!document.querySelector('.suggestion-container.mod-property-value .suggestion-item')
		})
		await expect(suggesterVisible).toBe(true)

		const beforeOffset = await browser.executeObsidian(() => document.getSelection()?.focusOffset ?? -1)

		await browser.keys(['Control', 'n'])
		await browser.pause(300)
		const whileOpenOffset = await browser.executeObsidian(() => document.getSelection()?.focusOffset ?? -1)
		// The known limitation itself: Obsidian's own scope has already
		// claimed Ctrl-N, so this plugin's checkCallback never even runs.
		await expect(whileOpenOffset).toBe(beforeOffset)

		await browser.keys(['Escape'])
		await browser.pause(300)
		const suggesterGone = await browser.executeObsidian(() => {
			return !document.querySelector('.suggestion-container.mod-property-value .suggestion-item')
		})
		await expect(suggesterGone).toBe(true)

		await browser.keys(['Control', 'n'])
		await browser.pause(300)
		const afterEscapeOffset = await browser.executeObsidian(() => document.getSelection()?.focusOffset ?? -1)
		// Once the suggester's own scope is popped (confirmed: DOM focus
		// never left the widget), this plugin's own checkCallback-based
		// line-move takes over normally.
		await expect(afterEscapeOffset).toBeGreaterThan(beforeOffset)
	})
})
