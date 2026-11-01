import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'
import { switchToMainWindow } from '../helpers'

// 0.13.0 Feature 1: confirms Set-mark, Kill region, and Yank in the title
// field all work inside a popout window's own separate document — not just
// the main window's. Mirrors titleCrossingPopout.e2e.ts's own rationale:
// the title Scope (pushed/popped via registerWindowDomListeners, wired
// per-window through app.workspace.on('window-open', ...)) was designed to
// cover popouts "for free," but that's an architectural expectation, not
// something titleKillLine/titleKillWord/titleSetMark/titleRegion/titleYank
// ever actually exercised in a popout themselves — each of those spec
// files only ever runs against the main window. Rather than duplicating
// every one of those specs' own assertions a second time inside a popout
// (expensive, and the underlying mechanism is the one thing actually in
// question, not each command's own already-covered logic), this is a
// single combined regression test chaining Set-mark -> Kill region -> Yank
// -> Kill line in one popout session, enough to prove the shared
// Scope-per-window mechanism isn't accidentally scoped to the main window
// only.
describe('Set-mark / Kill region / Yank / Kill line in the title field, inside a popout window', function () {
	const path = 'TitleKillYankPopout.md'
	let popoutWindowHandle: string | null = null

	after(async function () {
		if (popoutWindowHandle) {
			await browser.switchToWindow(popoutWindowHandle)
			await browser.closeWindow()
			await switchToMainWindow()
		}
		await browser.executeObsidian(async ({ app }, path2) => {
			const file = app.vault.getFileByPath(path2)
			if (file) await app.vault.delete(file)
		}, path)
	})

	async function pressCtrl(key: string, alt = false) {
		await browser.executeObsidian(({ app, obsidian }, { key2, alt2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.dispatchEvent(new KeyboardEvent('keydown', { key: key2, ctrlKey: !alt2, altKey: alt2, bubbles: true, cancelable: true }))
		}, { key2: key, alt2: alt })
		await browser.pause(150)
	}

	async function snap() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			return {
				titleText: title.textContent,
				markActive: plugin.markActive as boolean,
				killCache: plugin.killCache as string,
			}
		})
	}

	it('Set-mark extend + Kill region + Yank round trip, then Kill line, all inside the popout\'s own document', async function () {
		const beforeHandles = await browser.getWindowHandles()

		const leafId = await browser.executeObsidian(async ({ app }, path2) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.isKillChaining = false
			plugin.markActive = false
			plugin.killCache = ''
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:set-mark', [{ modifiers: ['Ctrl'], key: ' ' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-region', [{ modifiers: ['Ctrl'], key: 'W' }])
			hm.setHotkeys('universal-cursor-hotkeys:yank', [{ modifiers: ['Ctrl'], key: 'Y' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-line', [{ modifiers: ['Ctrl'], key: 'K' }])
			hm.bake()
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, 'body text not used by this test')
			const leaf: any = app.workspace.openPopoutLeaf()
			await leaf.openFile(file, { state: { mode: 'source', source: false } })
			app.workspace.setActiveLeaf(leaf, { focus: true })
			return leaf.id as string
		}, path)

		await browser.waitUntil(
			async () => (await browser.getWindowHandles()).length > beforeHandles.length,
			{ timeout: 5000, timeoutMsg: 'popout window never opened' },
		)
		const afterHandles = await browser.getWindowHandles()
		popoutWindowHandle = afterHandles.find(h => !beforeHandles.includes(h))!
		await browser.switchToWindow(popoutWindowHandle)
		await browser.pause(300)

		await browser.executeObsidian(({ app }, leafId2) => {
			const leaf = app.workspace.getLeafById(leafId2)
			if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true })
		}, leafId)

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.focus()
			const textNode = title.firstChild as Text
			const range = doc.createRange()
			range.setStart(textNode, 0)
			range.collapse(true)
			const sel = doc.getSelection()!
			sel.removeAllRanges()
			sel.addRange(range)
		})
		await browser.waitUntil(async () => {
			return browser.executeObsidian(({ app }) => {
				return (app as any).plugins.plugins['universal-cursor-hotkeys'].titleScope !== null
			})
		}, { timeout: 8000, interval: 50, timeoutMsg: 'title Scope never pushed in the popout' })

		// Set-mark, then extend 4 characters right ("Titl" out of "TitleKillYankPopout").
		await pressCtrl(' ')
		await pressCtrl('f')
		await pressCtrl('f')
		await pressCtrl('f')
		await pressCtrl('f')
		const marked = await snap()
		await expect(marked.markActive).toBe(true)

		// Kill region: removes the marked selection, clears the mark, kills it.
		await pressCtrl('w')
		const afterKillRegion = await snap()
		await expect(afterKillRegion.titleText).toBe('eKillYankPopout')
		await expect(afterKillRegion.markActive).toBe(false)
		await expect(afterKillRegion.killCache).toBe('Titl')

		// Yank: re-inserts the killed text at the current cursor, which sits
		// at the kill's own start offset (0) after Kill region collapses
		// there — round-trips back to the exact original title.
		await pressCtrl('y')
		const afterYank = await snap()
		await expect(afterYank.titleText).toBe('TitleKillYankPopout')

		// Kill line: move to offset 0, then kill to the title's own end.
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const textNode = title.firstChild as Text
			const range = doc.createRange()
			range.setStart(textNode, 0)
			range.collapse(true)
			const sel = doc.getSelection()!
			sel.removeAllRanges()
			sel.addRange(range)
		})
		await pressCtrl('k')
		const afterKillLine = await snap()
		await expect(afterKillLine.titleText).toBe('')
	})
})
