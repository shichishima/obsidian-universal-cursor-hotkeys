import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'
import { switchToMainWindow, readFixtureBody } from '../helpers'

// 0.13.0 Feature 1: confirms Ctrl-P/N title<->body crossing works the same
// inside a popout window — its own SEPARATE document/DOM, not just a
// different view onto the main window's. This category of bug has bitten
// this plugin before (see setMarkPopoutNativeClearing.e2e.ts): a listener
// registered once against the main window's own document at plugin load
// time silently never reaches a later-opened popout's own document. The
// title Scope here is pushed/popped via registerWindowDomListeners, which
// IS already wired per-window (app.workspace.on('window-open', ...)) —
// this is the regression test confirming that actually holds for the
// title-crossing feature specifically, not just the markActive-clearing
// listeners it was originally fixed for.
//
// Mirrors titleCrossingShort.e2e.ts's own rationale for creating the note
// on the fly (title = filename) and explicitly setting hotkeys (this
// plugin ships none by default). Doesn't reuse
// openFixtureInPopoutAndGetContentStart (that helper opens an EXISTING
// committed fixture by path) — the note has to be created with a
// controlled filename first, so this spec opens its own popout directly,
// closing it in `after` so later specs in this suite's own shared
// instance aren't left running against a stale popout.
describe('Title crossing inside a popout window', function () {
	const path = 'TitleCrossingPopout.md'
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

	async function pressCtrl(el: 'body' | 'title', key: string) {
		await browser.executeObsidian(({ app, obsidian }, { el: el2, key: key2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const target = el2 === 'body'
				? (view.editor as any).cm.contentDOM
				: view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			target.dispatchEvent(new KeyboardEvent('keydown', { key: key2, ctrlKey: true, bubbles: true, cancelable: true }))
		}, { el, key })
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

	it('Ctrl-P crosses body ch0 -> title ch0, Ctrl-N escapes back, inside the popout\'s own document', async function () {
		const beforeHandles = await browser.getWindowHandles()

		const body = await readFixtureBody('TitleCrossingPopoutFixture.md')
		const leafId = await browser.executeObsidian(async ({ app, obsidian }, { path2, body2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.bake()
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, body2)
			const leaf: any = app.workspace.openPopoutLeaf()
			await leaf.openFile(file, { state: { mode: 'source', source: false } })
			app.workspace.setActiveLeaf(leaf, { focus: true })
			const view = leaf.view as InstanceType<typeof obsidian.MarkdownView>
			view.editor.setCursor({ line: 0, ch: 0 })
			return leaf.id as string
		}, { path2: path, body2: body })

		await browser.waitUntil(
			async () => (await browser.getWindowHandles()).length > beforeHandles.length,
			{ timeout: 5000, timeoutMsg: 'popout window never opened' },
		)
		const afterHandles = await browser.getWindowHandles()
		popoutWindowHandle = afterHandles.find(h => !beforeHandles.includes(h))!
		await browser.switchToWindow(popoutWindowHandle)
		await browser.pause(300)

		// Switching the WebDriver window context doesn't tell Obsidian
		// itself which leaf is "active" — point app.workspace back at the
		// popout leaf explicitly (same gotcha
		// openFixtureInPopoutAndGetContentStart's own comment documents).
		await browser.executeObsidian(({ app }, leafId2) => {
			const leaf = app.workspace.getLeafById(leafId2)
			if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true })
		}, leafId)

		await pressCtrl('body', 'p')
		const entry = await readState()
		await expect(entry.activeIsTitle).toBe(true)
		await expect(entry.titleOffset).toBe(0)

		await pressCtrl('title', 'n')
		const afterEscape = await readState()
		await expect(afterEscape.activeIsTitle).toBe(false)
		await expect(afterEscape.cursor).toEqual({ line: 0, ch: 0 })
	})
})
