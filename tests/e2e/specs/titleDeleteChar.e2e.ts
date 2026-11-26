import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1: Ctrl-D (Delete char) in the title field — entirely new
// for this context, unlike every other command added to the title field so
// far (all of which already existed on at least the body side before being
// ported here). See titleKillLine.e2e.ts for the shared rationale (title =
// filename, created on the fly; hotkeys set explicitly since this plugin
// ships none by default; real KeyboardEvent dispatch to actually drive the
// Scope/Keymap push-stack).
//
// Unlike Kill line/word (which always collapse to point first, discarding
// any active selection on purpose), Delete char does NOT touch the mark's
// own extend/move distinction and deletes whatever's already selected if a
// selection exists — matching real Emacs's delete-char, which also ignores
// the mark, and matching the body's own deleteChar (deleteCharForward),
// which never checks markActive either.
describe('Delete char (Ctrl-D) in the title field', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function openNote(path: string, body: string, titleOffset: number) {
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app, obsidian }, { path2, body2, offset }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:delete-char', [{ modifiers: ['Ctrl'], key: 'D' }])
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
			range.setStart(textNode, offset)
			range.collapse(true)
			const sel = doc.getSelection()!
			sel.removeAllRanges()
			sel.addRange(range)
		}, { path2: path, body2: body, offset: titleOffset })
		await browser.waitUntil(async () => {
			return browser.executeObsidian(({ app }) => {
				return (app as any).plugins.plugins['universal-cursor-hotkeys'].titleScope !== null
			})
		}, { timeout: 8000, interval: 50, timeoutMsg: 'title Scope never pushed' })
	}

	async function pressCtrlD() {
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }))
		})
		await browser.pause(150)
	}

	async function getTitleText() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			return title.textContent
		})
	}

	it('(1) deletes the character after the cursor', async function () {
		await openNote('Delete Char Basic.md', 'body text', 6) // "Delete" | " Char Basic"
		await pressCtrlD() // deletes the space right after "Delete"
		await expect(await getTitleText()).toBe('DeleteChar Basic')
	})

	it('(2) is a true no-op at the title\'s own end — not a wrong-direction (backward) delete', async function () {
		await openNote('Delete Char AtEnd.md', 'body text', 'Delete Char AtEnd'.length)
		await pressCtrlD()
		await expect(await getTitleText()).toBe('Delete Char AtEnd') // unchanged, not "Delete Char AtEn"
	})

	it('(3) deletes an entire active (non-collapsed) selection, not one extra character past it', async function () {
		await openNote('Delete Char Selection.md', 'body text', 0)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const doc = title.ownerDocument
			const textNode = title.firstChild as Text
			const sel = doc.getSelection() as any
			sel.setBaseAndExtent(textNode, 0, textNode, 6) // selects "Delete"
		})
		await pressCtrlD()
		await expect(await getTitleText()).toBe(' Char Selection')
	})

	it('(4) integrates with the title\'s own native undo stack (Ctrl-Z restores the deleted character)', async function () {
		await openNote('Delete Char Undo.md', 'body text', 6) // "Delete" | " Char Undo"
		await pressCtrlD()
		await expect(await getTitleText()).toBe('DeleteChar Undo')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.ownerDocument.execCommand('undo')
		})
		await expect(await getTitleText()).toBe('Delete Char Undo')
	})
})
