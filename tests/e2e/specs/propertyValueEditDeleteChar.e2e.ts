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
// value-edit command here). The scope-shadowing bug this widget can
// trigger (see propertyValueEditKillYank.e2e.ts's own section) is now
// handled by a single document-level 'input' listener rather than a
// reclaim call after each individual mutating command — test (5) below
// is the regression coverage for WHY that generalization was needed:
// native Undo (Cmd-Z), never dispatched by this plugin itself, hits the
// exact same bug with no command-level call site to attach a reclaim to.
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

	// Real bug, reported by the user from real-machine usage: Ctrl-D x3
	// then physical Cmd-Z x3 (quickly) left the widget unresponsive —
	// Ctrl-G didn't even work, only the user's own report of this exact
	// sequence surfaced it (synthetic dispatchEvent() did NOT reproduce
	// it during investigation; real browser.keys() was required, same
	// lesson as this whole sub-feature's other investigations). Root
	// cause: native Undo mutates the widget via the browser's own undo
	// manager (confirmed live it still fires a real 'input' event, 3
	// Cmd-Z presses -> 3 'input' events, same as 3 Ctrl-D presses) and
	// Obsidian's own suggestion dropdown reacts to THAT the same way it
	// reacts to this plugin's own mutating commands — but Undo is never
	// dispatched by this plugin, so there was no command-level call site
	// to attach the existing per-command reclaim fix to. Fixed by moving
	// the reclaim logic to a single document-level 'input' listener
	// (registerWindowDomListeners), which catches every mutation path
	// uniformly regardless of cause.
	it('(5) regression: rapid Ctrl-D then native Undo doesn\'t leave the widget unresponsive', async function () {
		await openNote('PropertyValueEditDeleteCharUndoRegression.md', 'hello world')
		await browser.executeObsidian(async ({ app }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:keyboard-quit', [{ modifiers: ['Ctrl'], key: 'G' }])
			hm.bake()
		})
		await focusValueAt(1) // repro specifically needs a non-zero starting offset

		await browser.keys(['Control', 'd'])
		await browser.keys(['Control', 'd'])
		await browser.keys(['Control', 'd'])
		await browser.pause(200)

		await browser.keys(['Meta', 'z'])
		await browser.keys(['Meta', 'z'])
		await browser.keys(['Meta', 'z'])
		await browser.pause(200)
		const afterUndo = await snap()
		await expect(afterUndo.valueText).toBe('hello world') // undo round-trip itself still correct

		await browser.keys(['Control', 'g'])
		await browser.pause(200)
		const afterQuit = await snap()
		await expect(afterQuit.isRow).toBe(true) // Ctrl-G still works — the scope wasn't left shadowed
	})
})
