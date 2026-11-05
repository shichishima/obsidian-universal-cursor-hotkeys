import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, property-value-editing sub-phase, Phase 1: Ctrl-F/B
// (char move) and Ctrl-A/E (line boundary) inside a text property's own
// value-edit widget ("metadata-input-longtext", a contenteditable DIV —
// confirmed live the exact same widget Bases table cells use for inline
// text editing too, so this covers both for free). Reuses
// titleMoveChar/titleMoveToLineBoundary as-is from the title field's own
// implementation — both already operate purely through Selection.modify()
// on the element's ownerDocument, with no actual title-specific
// assumption baked in.
//
// The real mechanism here is broadening propertyRowScope's own
// focusin/focusout push/pop condition (PROPERTY_PANEL_SCOPE_SELECTOR) to
// also cover this widget, reusing app.keymap.pushScope exactly like
// item-selection mode already does — NOT a separate raw DOM listener (an
// earlier, abandoned attempt at this). Confirmed live that pushing a
// Scope reaches a REAL keypress even when its exact combo is an
// already-registered command hotkey, since the pushed scope gets checked
// before Obsidian's own root-scope command binding does, in its
// window-level capture listener.
//
// These tests use browser.keys() (real key presses), not synthetic
// dispatchEvent() — confirmed live that synthetic dispatch gives
// unreliable, inconsistent results for anything touching Obsidian's own
// Keymap resolution (see project memory:
// project_property_value_edit_real_key_interception_dead_end).
describe('Property value-edit mode: Ctrl-F/B/A/E movement', function () {
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
			hm.setHotkeys('universal-cursor-hotkeys:cursor-left', [{ modifiers: ['Ctrl'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-home', [{ modifiers: ['Ctrl'], key: 'A' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-end', [{ modifiers: ['Ctrl'], key: 'E' }])
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

	// Focuses the text property's own value-edit widget, placing a
	// collapsed cursor at the given character offset within its text.
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
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			const sel = doc.getSelection()
			return {
				isValueEdit: active?.className === 'metadata-input-longtext',
				focusOffset: sel?.focusOffset,
				isCollapsed: sel?.isCollapsed,
			}
		})
	}

	it('(1) Ctrl-F moves the cursor one character right', async function () {
		await openNote('PropertyValueEditMovementF.md')
		await focusValueAt(5) // "hello world", offset 5 = right after "hello"

		await browser.keys(['Control', 'f'])
		await browser.pause(200)
		const after = await snap()
		await expect(after.isValueEdit).toBe(true)
		await expect(after.focusOffset).toBe(6)
	})

	it('(2) Ctrl-B moves the cursor one character left', async function () {
		await openNote('PropertyValueEditMovementB.md')
		await focusValueAt(5)

		await browser.keys(['Control', 'b'])
		await browser.pause(200)
		const after = await snap()
		await expect(after.focusOffset).toBe(4)
	})

	it('(3) Ctrl-A moves to the start of the value', async function () {
		await openNote('PropertyValueEditMovementA.md')
		await focusValueAt(5)

		await browser.keys(['Control', 'a'])
		await browser.pause(200)
		const after = await snap()
		await expect(after.focusOffset).toBe(0)
	})

	it('(4) Ctrl-E moves to the end of the value', async function () {
		await openNote('PropertyValueEditMovementE.md')
		await focusValueAt(5)

		await browser.keys(['Control', 'e'])
		await browser.pause(200)
		const after = await snap()
		await expect(after.focusOffset).toBe('hello world'.length)
	})

	it('(5) regression: a bare (no Ctrl) "f" keypress still types normally, not intercepted as movement', async function () {
		await openNote('PropertyValueEditMovementTyping.md')
		await focusValueAt(5)

		await browser.keys(['f'])
		await browser.pause(200)
		const value = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			return (row.querySelector('.metadata-input-longtext') as HTMLElement).textContent
		})
		await expect(value).toBe('hellof world')
	})

	it('(6) regression: Ctrl-N/P (not bound to any value-edit behavior) do not move the cursor here', async function () {
		await openNote('PropertyValueEditMovementNoInterference.md')
		await browser.executeObsidian(async ({ app }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.bake()
		})
		await focusValueAt(5)

		await browser.keys(['Control', 'n'])
		await browser.pause(200)
		const after = await snap()
		await expect(after.isValueEdit).toBe(true)
		await expect(after.focusOffset).toBe(5)
	})
})
