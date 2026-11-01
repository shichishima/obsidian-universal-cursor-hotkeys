import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, Kill/Yank step: Ctrl-W (Kill region) / Alt-W (Copy
// region) in the title field. See titleKillLine.e2e.ts for the shared
// rationale (title = filename, created on the fly; hotkeys set
// explicitly since this plugin ships none by default; real KeyboardEvent
// dispatch to actually drive the Scope/Keymap push-stack).
//
// Unlike the body's own killRegion/copyRegion (which need multi-cursor
// handling), these operate on whatever native Selection is currently
// active regardless of how it got there (Set-mark extend, a mouse drag,
// Shift+Arrow) — a native Selection only ever has one range, so there's
// no per-range loop needed at all. Test (3) below is the direct
// confirmation that this isn't special-cased to Set-mark-created
// selections specifically.
describe('Kill region (Ctrl-W) / Copy region (Alt-W) in the title field', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function openNote(path: string, body: string) {
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app, obsidian }, { path2, body2 }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.isKillChaining = false
			plugin.killCache = ''
			plugin.markActive = false
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:set-mark', [{ modifiers: ['Ctrl'], key: ' ' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-region', [{ modifiers: ['Ctrl'], key: 'W' }])
			hm.setHotkeys('universal-cursor-hotkeys:copy-region', [{ modifiers: ['Alt'], key: 'W' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, body2)
			await app.workspace.getLeaf(true).openFile(file)
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const title = doc.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.focus()
			const textNode = title.firstChild as Text
			const range = doc.createRange()
			range.setStart(textNode, 0)
			range.collapse(true)
			const sel = doc.getSelection()!
			sel.removeAllRanges()
			sel.addRange(range)
		}, { path2: path, body2: body })
		await browser.waitUntil(async () => {
			return browser.executeObsidian(({ app }) => {
				return (app as any).plugins.plugins['universal-cursor-hotkeys'].titleScope !== null
			})
		}, { timeout: 8000, interval: 50, timeoutMsg: 'title Scope never pushed' })
	}

	async function pressCtrl(key: string, alt = false) {
		await browser.executeObsidian(({ app, obsidian }, { key2, alt2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.dispatchEvent(new KeyboardEvent('keydown', { key: key2, ctrlKey: !alt2, altKey: alt2, bubbles: true, cancelable: true }))
		}, { key2: key, alt2: alt })
		await browser.pause(120)
	}

	async function snap() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const doc = title.ownerDocument
			const sel = doc.getSelection()!
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			return {
				titleText: title.textContent,
				selectedText: sel.toString(),
				markActive: plugin.markActive as boolean,
				killCache: plugin.killCache as string,
			}
		})
	}

	it('(1) Copy region copies the Set-mark selection without mutating the title, and clears the mark', async function () {
		await openNote('TitleRegionCopy.md', 'body text') // title: "TitleRegionCopy"

		await pressCtrl(' ') // Set-mark at offset 0
		await pressCtrl('f')
		await pressCtrl('f')
		await pressCtrl('f') // selects "Tit"
		const before = await snap()
		await expect(before.selectedText).toBe('Tit')
		await expect(before.markActive).toBe(true)

		await pressCtrl('w', true) // Alt-W: Copy region
		const after = await snap()
		await expect(after.titleText).toBe('TitleRegionCopy') // unchanged — non-destructive
		await expect(after.markActive).toBe(false)
		await expect(after.killCache).toBe('Tit')
	})

	it('(2) Kill region deletes the Set-mark selection, kills it (no chaining — overwrites), and clears the mark', async function () {
		await openNote('TitleRegionKill.md', 'body text') // title: "TitleRegionKill"

		await pressCtrl(' ')
		await pressCtrl('f')
		await pressCtrl('f')
		await pressCtrl('f') // selects "Tit"
		await pressCtrl('w') // Ctrl-W: Kill region
		const after = await snap()
		await expect(after.titleText).toBe('leRegionKill') // "Tit" removed
		await expect(after.markActive).toBe(false)
		await expect(after.killCache).toBe('Tit') // overwritten, not appended to any prior kill-ring content
	})

	it('(3) Kill region works on a native Selection not created via Set-mark (e.g. a mouse drag)', async function () {
		await openNote('TitleRegionNative.md', 'body text')

		// Simulate a mouse-drag-equivalent selection directly via the
		// native Selection API — never pressed Set-mark at all.
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const doc = title.ownerDocument
			const textNode = title.firstChild as Text
			const sel = doc.getSelection() as any
			sel.setBaseAndExtent(textNode, 0, textNode, 5) // "Title"
		})
		const before = await snap()
		await expect(before.markActive).toBe(false)
		await expect(before.selectedText).toBe('Title')

		await pressCtrl('w')
		const after = await snap()
		await expect(after.titleText).toBe('RegionNative') // "Title" removed from "TitleRegionNative"
	})
})
