import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, property-value-editing sub-phase: Kill word left/right
// (Alt-Backspace / Alt-D) inside a text property's own value-edit widget.
// Reuses titleKillWord as-is from the title field's own implementation —
// already generic over any HTMLElement via its own ownerDocument's
// Selection API, same precedent as every value-edit handler shipped
// earlier in this sub-feature. This command was initially scoped OUT of
// property-value-editing, then revisited once the title/property command
// parity gap was noticed (title already had Kill word, property didn't).
//
// Same CJK finding as titleKillWord.e2e.ts applies here unchanged (same
// underlying function, same native Selection.modify('extend', ..., 'word')
// mechanism) — confirmed live via test (3) below, not just assumed from
// the title's own result.
//
// suppressFallback is set (same reasoning as every other mutating
// value-edit command here) — Alt-Backspace/Alt-D have no sensible
// row/heading/Add-button behavior, and the fallback dispatch's own
// dropped-modifier bug (found for Set-mark's own Ctrl-Space) applies
// equally here.
describe('Property value-edit mode: Kill word left/right (Alt-Backspace / Alt-D)', function () {
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
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.isKillChaining = false
			plugin.killCache = ''
			plugin.markActive = false
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:kill-word-right', [{ modifiers: ['Alt'], key: 'D' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-word-left', [{ modifiers: ['Alt'], key: 'Backspace' }])
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

	it('(1) Alt-D kills one word forward', async function () {
		await openNote('PropertyValueEditKillWordRight.md', 'Kill Word Alpha')
		await focusValueAt(0) // right before "Kill"

		await pressAlt('d') // kills "Kill"
		const after = await snap()
		await expect(after.valueText).toBe(' Word Alpha')
	})

	it('(2) Alt-Backspace kills one word backward; no-op at the value\'s own start', async function () {
		await openNote('PropertyValueEditKillWordLeft.md', 'Kill Word Alpha')
		await focusValueAt(0)

		await pressAlt('Backspace') // nothing to the left — no-op
		const after = await snap()
		await expect(after.valueText).toBe('Kill Word Alpha')
	})

	it('(3) CJK: a run of kanji/hiragana is split word by word via native word-boundary logic, same as the title field', async function () {
		await openNote('PropertyValueEditKillWordCJK.md', '異なる扱いです')
		await focusValueAt(0)

		await pressAlt('d') // kills "異なる" only, not sweeping into "扱いです" too
		const after = await snap()
		await expect(after.valueText).toBe('扱いです')
	})

	it('(4) regression: Alt-D/Alt-Backspace on the row itself (item-selection mode) do nothing', async function () {
		await openNote('PropertyValueEditKillWordNoInterference.md', 'Kill Word Alpha')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			row.focus()
		})
		await browser.pause(150)

		await pressAlt('d')
		await pressAlt('Backspace')
		const after = await snap()
		await expect(after.isRow).toBe(true)
		await expect(after.valueText).toBe('Kill Word Alpha') // completely unchanged
	})
})
