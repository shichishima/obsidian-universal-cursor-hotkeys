import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// CORRECTED (2026-11-16, see project_checkcallback_property_suggester_ctrl_np_swallowed
// memory for the full writeup): an earlier version of this canary only
// asserted that Ctrl-N was "a true no-op while the suggester is visibly
// open" -- by which it meant the EDITOR's own text-cursor offset doesn't
// move. That part is still true and still correct UX (you want Ctrl-N to
// navigate the dropdown, not move the body text cursor, while it's
// showing) -- but the earlier version never checked whether the
// suggester's OWN highlighted item moved. It does, natively, and
// CYCLICALLY (wraps past either end), the exact same `Dd` chooser class
// backing the command palette/quick switcher that Obsidian ships
// Ctrl-N/P on since 1.13.4
// (https://obsidian.md/changelog/2026-07-30-desktop-v1.13.4/). Enter also
// natively commits the highlighted item -- no plugin code of any kind is
// involved in any of this, and this plugin's own checkCallback-based
// cursor-up/down correctly never fires here, because something already
// sitting above rootScope in the window's Scope stack claims Ctrl-N/P
// first.
//
// This spec is a CANARY for a future Obsidian version changing that
// internal behavior (in either direction), not a feature test of this
// plugin's own code.
describe('Known architecture: Obsidian\'s own suggester claims Ctrl-N/P while visibly open, and handles it natively', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	it('Ctrl-N never moves the editor\'s own text cursor while the suggester is visibly open, but DOES navigate the suggester natively (cyclic) and Enter commits it', async function () {
		const notePath = 'SuggesterArchNote.md'
		const seedPaths = [
			'SuggesterArchSeed0.md',
			'SuggesterArchSeed1.md',
			'SuggesterArchSeed2.md',
		]
		createdPaths.push(notePath, ...seedPaths)

		await browser.executeObsidian(async ({ app }, { notePath2, seedPaths2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			for (const p of [notePath2, ...seedPaths2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			// Seed 3 existing text values sharing a common prefix so the
			// suggester has a genuine multi-item list to navigate.
			await app.vault.create(seedPaths2[0], `---\nmyText: testbeta\n---\nbody\n`)
			await app.vault.create(seedPaths2[1], `---\nmyText: testalpha\n---\nbody\n`)
			await app.vault.create(seedPaths2[2], `---\nmyText: testgamma\n---\nbody\n`)
			// No spaces in this note's own body, so a real second visual
			// line exists for Ctrl-N to reach once the suggester is out
			// of the way (checked at the very end of this test).
			const file = await app.vault.create(notePath2, `---\nmyText: ""\n---\naaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbccccccccccccccccccccddddddddddddddddddddeeeeeeeeeeeeeeeeeeee\n`)
			await app.workspace.getLeaf(true).openFile(file)
		}, { notePath2: notePath, seedPaths2: seedPaths })
		await browser.pause(500)

		const row = await browser.$('.metadata-property')
		await row.click({ x: 2, y: 2 })
		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		await browser.keys(['t', 'e', 's', 't']) // matches testalpha/testbeta/testgamma -- triggers the suggester
		await browser.pause(300)

		const getSuggester = async () => browser.executeObsidian(() => {
			const items = Array.from(document.querySelectorAll('.suggestion-container.mod-property-value .suggestion-item'))
			return {
				count: items.length,
				selectedText: items.find(i => i.classList.contains('is-selected'))?.textContent ?? null,
			}
		})

		const initial = await getSuggester()
		await expect(initial.count).toBe(3)
		await expect(initial.selectedText).toBe('testbeta') // Obsidian's own suggester auto-highlights the first item natively

		const beforeOffset = await browser.executeObsidian(() => document.getSelection()?.focusOffset ?? -1)

		await browser.keys(['Control', 'n'])
		await browser.pause(200)
		const whileOpenOffset = await browser.executeObsidian(() => document.getSelection()?.focusOffset ?? -1)
		// The architectural reason this plugin's own checkCallback can't
		// reach Ctrl-N/P here: Obsidian's own scope has already claimed
		// it, so the widget's own text cursor is untouched.
		await expect(whileOpenOffset).toBe(beforeOffset)
		// But the suggester's OWN highlight DID move — natively, with
		// zero plugin code.
		await expect((await getSuggester()).selectedText).toBe('testalpha')

		await browser.keys(['Control', 'n'])
		await browser.pause(200)
		await expect((await getSuggester()).selectedText).toBe('testgamma')

		await browser.keys(['Control', 'n']) // past the last item — confirms native WRAP, not clamp
		await browser.pause(200)
		await expect((await getSuggester()).selectedText).toBe('testbeta')

		await browser.keys(['Enter']) // native commit, no synthetic click needed
		await browser.pause(300)
		const committed = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const value = row.querySelector('.metadata-input-longtext') as HTMLElement
			return { text: value.textContent, suggesterGone: !document.querySelector('.suggestion-container.mod-property-value .suggestion-item') }
		})
		await expect(committed.text).toBe('testbeta')
		await expect(committed.suggesterGone).toBe(true)

		// Now exit this widget and re-enter the BODY's own wrapped line,
		// confirming this plugin's own checkCallback-based line-move
		// still works normally once nothing is claiming Ctrl-N above it
		// (i.e. this architecture note doesn't regress the plugin's own
		// feature anywhere else).
		await browser.keys(['Escape'])
		await browser.pause(300)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.focus()
			view.editor.setCursor({ line: 0, ch: 0 })
		})
		await browser.pause(200)
		const beforeCursor2 = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getCursor()
		})
		await browser.keys(['Control', 'n'])
		await browser.pause(300)
		const afterCursor2 = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getCursor()
		})
		// this plugin's own cursor-down DID run on the body (moved to the
		// wrapped line's own second visual row, same logical line 0 but a
		// later ch) -- no suggester anywhere to claim the key first.
		await expect(afterCursor2.ch).toBeGreaterThan(beforeCursor2.ch)
	})
})
