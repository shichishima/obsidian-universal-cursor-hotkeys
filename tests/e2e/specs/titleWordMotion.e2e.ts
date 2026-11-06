import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1: Alt-F/Alt-B (Word right/left) in the title field — the
// last remaining title/property command-parity gap, entirely new for this
// context (same as Delete char). See titleKillLine.e2e.ts for the shared
// rationale (title = filename, created on the fly; hotkeys set explicitly
// since this plugin ships none by default; real KeyboardEvent dispatch to
// actually drive the Scope/Keymap push-stack).
//
// Reuses titleSelectionModify as-is (already handles the markActive
// 'extend'/'move' branch internally) with 'word' granularity — the same
// native Selection.modify mechanism titleKillWord already confirmed is
// CJK-safe without a custom segmenter (see
// project_title_field_native_option_arrow_word_boundary memory), now used
// for pure movement instead of killing.
describe('Word left/right (Alt-B / Alt-F) in the title field', function () {
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
			hm.setHotkeys('universal-cursor-hotkeys:word-right', [{ modifiers: ['Alt'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:word-left', [{ modifiers: ['Alt'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:set-mark', [{ modifiers: ['Ctrl'], key: ' ' }])
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

	async function pressAlt(key: string) {
		await browser.executeObsidian(({ app, obsidian }, key2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.dispatchEvent(new KeyboardEvent('keydown', { key: key2, altKey: true, bubbles: true, cancelable: true }))
		}, key)
		await browser.pause(150)
	}

	async function pressCtrlSpace() {
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true, cancelable: true }))
		})
		await browser.pause(150)
	}

	async function snap() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const sel = title.ownerDocument.getSelection()
			return { titleText: title.textContent, focusOffset: sel?.focusOffset, selectedText: sel?.toString(), isCollapsed: sel?.isCollapsed }
		})
	}

	it('(1) Alt-F moves forward to the end of the next word', async function () {
		await openNote('Word Motion Alpha.md', 'body text', 0) // "Word" | " Motion Alpha"
		await pressAlt('f') // lands right after "Word"
		const after = await snap()
		await expect(after.focusOffset).toBe(4)
		await expect(after.isCollapsed).toBe(true) // pure move, no selection
	})

	it('(2) Alt-B moves backward to the start of the previous word', async function () {
		await openNote('Word Motion Beta.md', 'body text', 'Word Motion Beta'.length)
		await pressAlt('b') // lands right before "Beta"
		const after = await snap()
		await expect(after.focusOffset).toBe('Word Motion '.length)
	})

	it('(3) CJK: a run of kanji/hiragana is crossed word by word via native word-boundary logic, same as Kill word', async function () {
		await openNote('異なる扱いです.md', 'body text', 0)
		await pressAlt('f') // moves past "異なる" only, not sweeping into "扱いです" too
		const after = await snap()
		await expect(after.focusOffset).toBe('異なる'.length)
	})

	it('(4) Set-mark + Alt-F extends a real selection, matching every other movement command\'s own mark-extend behavior', async function () {
		await openNote('Word Motion Mark.md', 'body text', 0)
		await pressCtrlSpace()
		await pressAlt('f')
		const after = await snap()
		await expect(after.isCollapsed).toBe(false)
		await expect(after.selectedText).toBe('Word')
	})

	it('(5) a true no-op at the title\'s own start/end', async function () {
		await openNote('Word Motion AtEnd.md', 'body text', 'Word Motion AtEnd'.length)
		await pressAlt('f') // already at the title's own end
		const after = await snap()
		await expect(after.titleText).toBe('Word Motion AtEnd')
		await expect(after.focusOffset).toBe('Word Motion AtEnd'.length)
	})
})
