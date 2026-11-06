import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, property-value-editing sub-phase: Ctrl-D (Delete char)
// inside a text property's own value-edit widget. Reuses titleDeleteChar
// as-is — entirely new for BOTH the title field and this widget (unlike
// Kill word, which already existed on the title side before this phase),
// so there's no "title already proved it" precedent to lean on here, only
// the underlying Selection API mechanism being the same one already used
// throughout this whole sub-feature.
//
// suppressFallback is set (same reasoning as every other mutating
// value-edit command here) and reclaimPropertyRowScopeAfterMutation is
// called afterward (same treatment as kill-line/kill-region/kill-word/
// yank — see propertyValueEditKillYank.e2e.ts's own section for the full
// writeup on why).
describe('Property value-edit mode: Delete char (Ctrl-D)', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function openNote(path: string, value: string) {
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app }, { path2, value2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:delete-char', [{ modifiers: ['Ctrl'], key: 'D' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, `---
myText: ${value2}
---
first body line
`)
			await app.workspace.getLeaf(true).openFile(file)
		}, { path2: path, value2: value })
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

	async function pressCtrlD() {
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement
			active.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }))
		})
		await browser.pause(150)
	}

	async function snap() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const value = row.querySelector('.metadata-input-longtext') as HTMLElement
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			return {
				valueText: value.textContent,
				isRow: active?.closest?.('.metadata-property')?.getAttribute('data-property-key') === 'mytext' && active?.className !== 'metadata-input-longtext',
			}
		})
	}

	it('(1) deletes the character after the cursor', async function () {
		await openNote('PropertyValueEditDeleteCharBasic.md', 'hello world')
		await focusValueAt(5) // right after "hello"

		await pressCtrlD() // deletes the space right after "hello"
		const after = await snap()
		await expect(after.valueText).toBe('helloworld')
	})

	it('(2) is a true no-op at the value\'s own end', async function () {
		await openNote('PropertyValueEditDeleteCharAtEnd.md', 'hello world')
		await focusValueAt('hello world'.length)

		await pressCtrlD()
		const after = await snap()
		await expect(after.valueText).toBe('hello world') // unchanged
	})

	it('(3) deletes an entire active (non-collapsed) selection, not one extra character past it', async function () {
		await openNote('PropertyValueEditDeleteCharSelection.md', 'hello world')
		await focusValueAt(0)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const value = row.querySelector('.metadata-input-longtext') as HTMLElement
			const doc = value.ownerDocument
			const textNode = value.firstChild as Text
			const sel = doc.getSelection() as any
			sel.setBaseAndExtent(textNode, 0, textNode, 5) // selects "hello"
		})

		await pressCtrlD()
		const after = await snap()
		await expect(after.valueText).toBe(' world')
	})

	it('(4) regression: Ctrl-D on the row itself (item-selection mode) does nothing', async function () {
		await openNote('PropertyValueEditDeleteCharNoInterference.md', 'hello world')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			row.focus()
		})
		await browser.pause(150)

		await pressCtrlD()
		const after = await snap()
		await expect(after.isRow).toBe(true)
		await expect(after.valueText).toBe('hello world') // completely unchanged
	})
})
