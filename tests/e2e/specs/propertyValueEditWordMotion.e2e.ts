import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, property-value-editing sub-phase: Alt-F/Alt-B (Word
// right/left) inside a text property's own value-edit widget — the last
// remaining title/property command-parity gap. Reuses titleMoveWord as-is
// — entirely new for BOTH the title field and this widget (same as Delete
// char), so there's no "title already proved it" precedent to lean on
// here, only the underlying Selection API mechanism already used
// throughout this whole sub-feature. suppressFallback is set, same
// reasoning as every other command here with no sensible row/heading/
// Add-button behavior.
describe('Property value-edit mode: Word left/right (Alt-B / Alt-F)', function () {
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
			hm.setHotkeys('universal-cursor-hotkeys:word-right', [{ modifiers: ['Alt'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:word-left', [{ modifiers: ['Alt'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:set-mark', [{ modifiers: ['Ctrl'], key: ' ' }])
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

	async function pressAlt(key: string) {
		await browser.executeObsidian(({ app, obsidian }, key2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement
			active.dispatchEvent(new KeyboardEvent('keydown', { key: key2, altKey: true, bubbles: true, cancelable: true }))
		}, key)
		await browser.pause(150)
	}

	async function pressCtrlSpace() {
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement
			active.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true, cancelable: true }))
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
			const sel = doc.getSelection()
			return {
				valueText: value.textContent,
				isRow: active?.closest?.('.metadata-property')?.getAttribute('data-property-key') === 'mytext' && active?.className !== 'metadata-input-longtext',
				focusOffset: sel?.focusOffset,
				selectedText: sel?.toString(),
				isCollapsed: sel?.isCollapsed,
			}
		})
	}

	it('(1) Alt-F moves forward to the end of the next word', async function () {
		await openNote('PropertyValueEditWordMotionRight.md', 'hello world')
		await focusValueAt(0)

		await pressAlt('f') // lands right after "hello"
		const after = await snap()
		await expect(after.focusOffset).toBe(5)
		await expect(after.isCollapsed).toBe(true)
	})

	it('(2) Alt-B moves backward to the start of the previous word', async function () {
		await openNote('PropertyValueEditWordMotionLeft.md', 'hello world')
		await focusValueAt('hello world'.length)

		await pressAlt('b') // lands right before "world"
		const after = await snap()
		await expect(after.focusOffset).toBe('hello '.length)
	})

	it('(3) Set-mark + Alt-F extends a real selection, matching every other movement command\'s own mark-extend behavior', async function () {
		await openNote('PropertyValueEditWordMotionMark.md', 'hello world')
		await focusValueAt(0)

		await pressCtrlSpace()
		await pressAlt('f')
		const after = await snap()
		await expect(after.isCollapsed).toBe(false)
		await expect(after.selectedText).toBe('hello')
	})

	it('(4) regression: Alt-F/Alt-B on the row itself (item-selection mode) do nothing', async function () {
		await openNote('PropertyValueEditWordMotionNoInterference.md', 'hello world')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			row.focus()
		})
		await browser.pause(150)

		await pressAlt('f')
		await pressAlt('b')
		const after = await snap()
		await expect(after.isRow).toBe(true)
		await expect(after.valueText).toBe('hello world') // completely unchanged
	})
})
