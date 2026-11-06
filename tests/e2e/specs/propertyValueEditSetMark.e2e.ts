import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, property-value-editing sub-phase, Phase 2: Set-mark
// (Ctrl-Space) inside a text property's own value-edit widget. Reuses
// titleSetMark as-is from the title field's own implementation — it
// arms markActive and collapses the native Selection to its own current
// focus (the anchor point); titleMoveChar/titleMoveToLineBoundary
// (already shipped in propertyValueEditMovement.e2e.ts) already check
// markActive via titleSelectionModify's own 'extend' vs 'move' branch,
// so movement immediately starts extending a real selection once
// armed — confirmed live before writing these tests by calling the
// plugin's own private methods directly.
//
// Also extends keyboard-quit (Ctrl-G, already shipped) with a
// value-edit-specific handler: real Emacs's C-g is a universal ABORT,
// so it must also clear any armed mark (reusing titleKeyboardQuit)
// before doing the native-Escape exit everything else in this panel
// already does.
describe('Property value-edit mode: Set-mark (Ctrl-Space)', function () {
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
		await browser.executeObsidian(async ({ app }, path2) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:set-mark', [{ modifiers: ['Ctrl'], key: ' ' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-left', [{ modifiers: ['Ctrl'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-home', [{ modifiers: ['Ctrl'], key: 'A' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-end', [{ modifiers: ['Ctrl'], key: 'E' }])
			hm.setHotkeys('universal-cursor-hotkeys:keyboard-quit', [{ modifiers: ['Ctrl'], key: 'G' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, `---
myText: hello world
---
first body line
`)
			await app.workspace.getLeaf(true).openFile(file)
		}, path)
		await browser.pause(400)
	}

	async function focusValueAt(offset: number) {
		await browser.executeObsidian(({ app, obsidian }, off) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const value = row.querySelector('.metadata-input-longtext') as HTMLElement
			value.focus()
			const sel = value.ownerDocument.getSelection()!
			const textNode = value.firstChild!
			const range = value.ownerDocument.createRange()
			range.setStart(textNode, off)
			range.collapse(true)
			sel.removeAllRanges()
			sel.addRange(range)
		}, offset)
		await browser.pause(150)
	}

	async function snap() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			const sel = doc.getSelection()
			return {
				isValueEdit: active?.className === 'metadata-input-longtext',
				isRow: active?.closest?.('.metadata-property')?.getAttribute('data-property-key') === 'mytext' && active?.className !== 'metadata-input-longtext',
				isCollapsed: sel?.isCollapsed,
				selectedText: sel?.toString(),
				markActive: plugin.markActive,
			}
		})
	}

	it('(1) Ctrl-Space then Ctrl-F extends a real selection forward', async function () {
		await openNote('PropertyValueEditSetMarkF.md')
		await focusValueAt(5) // "hello world", offset 5 = right after "hello"

		await browser.keys(['Control', ' '])
		await browser.pause(150)
		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		await browser.keys(['Control', 'f'])
		await browser.pause(200)

		const after = await snap()
		await expect(after.markActive).toBe(true)
		await expect(after.isCollapsed).toBe(false)
		await expect(after.selectedText).toBe(' wo')
	})

	it('(2) Ctrl-Space then Ctrl-B extends a real selection backward', async function () {
		await openNote('PropertyValueEditSetMarkB.md')
		await focusValueAt(5)

		await browser.keys(['Control', ' '])
		await browser.pause(150)
		await browser.keys(['Control', 'b'])
		await browser.pause(150)
		await browser.keys(['Control', 'b'])
		await browser.pause(200)

		const after = await snap()
		await expect(after.isCollapsed).toBe(false)
		await expect(after.selectedText).toBe('lo')
	})

	it('(3) Ctrl-Space then Ctrl-A extends the selection to the start of the value', async function () {
		await openNote('PropertyValueEditSetMarkA.md')
		await focusValueAt(5)

		await browser.keys(['Control', ' '])
		await browser.pause(150)
		await browser.keys(['Control', 'a'])
		await browser.pause(200)

		const after = await snap()
		await expect(after.isCollapsed).toBe(false)
		await expect(after.selectedText).toBe('hello')
	})

	it('(4) Ctrl-Space then Ctrl-E extends the selection to the end of the value', async function () {
		await openNote('PropertyValueEditSetMarkE.md')
		await focusValueAt(5)

		await browser.keys(['Control', ' '])
		await browser.pause(150)
		await browser.keys(['Control', 'e'])
		await browser.pause(200)

		const after = await snap()
		await expect(after.isCollapsed).toBe(false)
		await expect(after.selectedText).toBe(' world')
	})

	it('(5) Ctrl-G clears an active mark AND exits to item-selection mode, in one press', async function () {
		await openNote('PropertyValueEditSetMarkG.md')
		await focusValueAt(5)

		await browser.keys(['Control', ' '])
		await browser.pause(150)
		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		const beforeG = await snap()
		await expect(beforeG.isCollapsed).toBe(false) // confirm a real selection existed first

		await browser.keys(['Control', 'g'])
		await browser.pause(200)
		const after = await snap()
		await expect(after.markActive).toBe(false)
		await expect(after.isRow).toBe(true)
	})

	it('(6) regression: Ctrl-Space on the row itself (item-selection mode) does nothing', async function () {
		await openNote('PropertyValueEditSetMarkNoInterference.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			row.focus()
		})
		await browser.pause(150)

		await browser.keys(['Control', ' '])
		await browser.pause(200)
		const after = await snap()
		await expect(after.isRow).toBe(true)
		await expect(after.markActive).toBe(false)
	})
})
