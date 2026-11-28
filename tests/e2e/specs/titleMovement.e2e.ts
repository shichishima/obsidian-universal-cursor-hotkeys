import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1 coverage gap, found during the 0.13.0 release test-
// matrix audit (tests/E2E.md's own "# 0.13.0" section): basic Ctrl-B/F
// (one character) and Ctrl-A/E (Home/End) in the title field were only
// ever exercised INDIRECTLY, as a precondition inside the
// titleCrossingShort/Wrapped specs (which care about the BOUNDARY
// crossing, not plain within-field movement). The functionality itself
// already worked -- this just gives it its own, direct, minimal test.
describe('Ctrl-B/F/A/E basic movement in the title field', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function openNote(path: string, titleOffset: number) {
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app, obsidian }, { path2, offset }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-left', [{ modifiers: ['Ctrl'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-home', [{ modifiers: ['Ctrl'], key: 'A' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-end', [{ modifiers: ['Ctrl'], key: 'E' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, 'body text')
			await app.workspace.getLeaf(true).openFile(file)
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const title = doc.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.focus()
			const textNode = title.firstChild as Text
			const range = doc.createRange()
			range.setStart(textNode, offset)
			range.collapse(true)
			const sel = doc.getSelection()!
			sel.removeAllRanges()
			sel.addRange(range)
		}, { path2: path, offset: titleOffset })
		// Was: waited for plugin.titleScope !== null -- that property never
		// existed on the plugin class (confirmed live via a full-file grep
		// of src/main.ts), so `undefined !== null` made this an unconditional
		// no-op wait, not a real synchronization point. Waits for the actual
		// precondition pressCtrl below depends on instead: the title is
		// really focused AND the caret really landed at the intended offset
		// (both set above, but not guaranteed to have taken effect
		// synchronously in every environment/timing).
		await browser.waitUntil(async () => {
			return browser.executeObsidian(({ app, obsidian }, offset) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
				const sel = title.ownerDocument.getSelection()
				return title.ownerDocument.activeElement === title && sel?.focusOffset === offset
			}, titleOffset)
		}, { timeout: 8000, interval: 50, timeoutMsg: 'title focus/selection never settled at the intended offset' })
	}

	async function pressCtrl(key: string) {
		await browser.executeObsidian(({ app, obsidian }, key2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.dispatchEvent(new KeyboardEvent('keydown', { key: key2, ctrlKey: true, bubbles: true, cancelable: true }))
		}, key)
		await browser.pause(150)
	}

	async function focusOffset() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			return title.ownerDocument.getSelection()?.focusOffset
		})
	}

	it('(1) Ctrl-F moves the cursor one character right', async function () {
		await openNote('TitleMoveCtrlF.md', 0)
		await pressCtrl('f')
		await expect(await focusOffset()).toBe(1)
	})

	it('(2) Ctrl-B moves the cursor one character left', async function () {
		await openNote('TitleMoveCtrlB.md', 'TitleMoveCtrlB'.length)
		await pressCtrl('b')
		await expect(await focusOffset()).toBe('TitleMoveCtrlB'.length - 1)
	})

	it('(3) Ctrl-A moves to the start of the title', async function () {
		await openNote('TitleMoveCtrlA.md', 'TitleMoveCtrlA'.length)
		await pressCtrl('a')
		await expect(await focusOffset()).toBe(0)
	})

	it('(4) Ctrl-E moves to the end of the title', async function () {
		await openNote('TitleMoveCtrlE.md', 0)
		await pressCtrl('e')
		await expect(await focusOffset()).toBe('TitleMoveCtrlE'.length)
	})

	it('(5) regression: Ctrl-B/F are true no-ops at the title\'s own start/end', async function () {
		await openNote('TitleMoveBoundary.md', 0)
		await pressCtrl('b') // already at the start
		await expect(await focusOffset()).toBe(0)
		await pressCtrl('e')
		await pressCtrl('f') // already at the end
		await expect(await focusOffset()).toBe('TitleMoveBoundary'.length)
	})
})
