import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, frontmatter sub-phase: Ctrl-G (keyboard-quit) in
// Properties-panel item-selection mode delegates straight to native
// Escape, the same "delegate to native key" pattern Ctrl-B/F and Ctrl-N/P
// already use for this panel. Confirmed live before writing these tests:
// native Escape from ANY element in the chain (a row, the heading, the
// Add-button — panel expanded or collapsed, doesn't matter) simply
// returns DOM focus to the body. CM6's own cursor position was never
// touched while focus was in Properties (entering item-selection mode
// never moves it), so it's restored exactly where it already was. Unlike
// cursor-up/down, no goal-column logic is needed here at all.
describe('Properties-panel item-selection mode: Ctrl-G native Escape delegation', function () {
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
			hm.setHotkeys('universal-cursor-hotkeys:keyboard-quit', [{ modifiers: ['Ctrl'], key: 'G' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, `---
myText: hello world
---
first body line
second body line
`)
			await app.workspace.getLeaf(true).openFile(file)
		}, path)
		await browser.pause(400)
	}

	async function setBodyCursor(line: number, ch: number) {
		await browser.executeObsidian(({ app, obsidian }, pos) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.focus()
			view.editor.setCursor(pos)
		}, { line, ch })
		await browser.pause(100)
	}

	async function pressCtrlG() {
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			doc.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true }))
		})
		await browser.pause(150)
	}

	async function snap() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			return {
				propertyKey: active?.closest?.('.metadata-property')?.getAttribute('data-property-key') ?? null,
				isContentEditable: active?.isContentEditable ?? false,
				editorCursor: active?.closest?.('.cm-content') ? view.editor.getCursor() : undefined,
			}
		})
	}

	it('(1) Ctrl-G on a property row (item-selection mode) escapes to the body, restoring its own existing cursor position', async function () {
		await openNote('PropertyCtrlGRow.md')
		await setBodyCursor(3, 6)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			row.focus()
		})
		await browser.pause(80)

		await pressCtrlG()
		const after = await snap()
		await expect(after.editorCursor).toEqual({ line: 3, ch: 6 })
	})

	it('(2) Ctrl-G at the Properties heading escapes to the body the same way', async function () {
		await openNote('PropertyCtrlGHeading.md')
		await setBodyCursor(4, 3)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const heading = view.containerEl.querySelector('.metadata-properties-heading') as HTMLElement
			heading.focus()
		})
		await browser.pause(80)

		await pressCtrlG()
		const after = await snap()
		await expect(after.editorCursor).toEqual({ line: 4, ch: 3 })
	})

	it('(3) Ctrl-G at the Add-button escapes to the body the same way', async function () {
		await openNote('PropertyCtrlGAddButton.md')
		await setBodyCursor(3, 2)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const btn = view.containerEl.querySelector('.metadata-add-button') as HTMLElement
			btn.focus()
		})
		await browser.pause(80)

		await pressCtrlG()
		const after = await snap()
		await expect(after.editorCursor).toEqual({ line: 3, ch: 2 })
	})

	it('(4) Ctrl-G at the heading, panel COLLAPSED, still escapes to the body the same way', async function () {
		await openNote('PropertyCtrlGCollapsed.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const heading = view.containerEl.querySelector('.metadata-properties-heading') as HTMLElement
			const collapseIndicator = heading.querySelector('.collapse-indicator') as HTMLElement | null
			collapseIndicator?.click()
		})
		await browser.pause(200)
		await setBodyCursor(4, 5)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const heading = view.containerEl.querySelector('.metadata-properties-heading') as HTMLElement
			heading.focus()
		})
		await browser.pause(80)

		await pressCtrlG()
		const after = await snap()
		await expect(after.editorCursor).toEqual({ line: 4, ch: 5 })
	})

	it('(5) Ctrl-G also escapes from inside the value-edit widget itself, back to item-selection mode (not just item-selection mode\'s own row/heading/Add-button)', async function () {
		// This was originally scoped OUT (see the property-value-editing
		// movement work, feat/property-value-edit-movement) after
		// confirming live that Obsidian stops propagation of a
		// Ctrl-modified keydown from this widget before it reaches
		// app.keymap at all — UNLESS a Scope is actually pushed while
		// focus is there, in which case it's checked before Obsidian's
		// own root-scope command binding ever gets a chance. Once
		// propertyRowScope's own push/pop condition was broadened to
		// cover this widget too (for the movement commands), Ctrl-G
		// escaping from here came along for free — this test now
		// confirms it rather than asserting the opposite.
		await openNote('PropertyCtrlGFromValueEdit.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const target = row.querySelector('[contenteditable="true"]') as HTMLElement
			target.focus()
		})
		await browser.pause(150)
		const before = await snap()
		await expect(before.isContentEditable).toBe(true)

		await pressCtrlG()
		const after = await snap()
		await expect(after.isContentEditable).toBe(false)
		await expect(after.propertyKey).toBe('mytext')
	})

	it('(6) regression: a note WITHOUT frontmatter is unaffected — Ctrl-G still clears an active Set-mark selection in the body', async function () {
		createdPaths.push('PropertyCtrlGNoFm.md')
		const result = await browser.executeObsidian(async ({ app, obsidian }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:keyboard-quit', [{ modifiers: ['Ctrl'], key: 'G' }])
			hm.setHotkeys('universal-cursor-hotkeys:set-mark', [{ modifiers: ['Ctrl'], key: ' ' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const path = 'PropertyCtrlGNoFm.md'
			const existing = app.vault.getFileByPath(path)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path, 'first body line')
			await app.workspace.getLeaf(true).openFile(file)
			await new Promise(r => setTimeout(r, 400))

			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			view.editor.focus()
			view.editor.setCursor({ line: 0, ch: 0 })
			await new Promise(r => setTimeout(r, 80))
			function press(key: string) {
				doc.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }))
			}
			press(' ') // set-mark
			await new Promise(r => setTimeout(r, 100))
			press('f'); press('f'); press('f') // extend selection right by 3
			await new Promise(r => setTimeout(r, 100))
			const beforeSel = view.editor.listSelections()[0]
			press('g') // keyboard-quit
			await new Promise(r => setTimeout(r, 100))
			const afterSel = view.editor.listSelections()[0]
			return {
				beforeCollapsed: beforeSel.anchor.ch === beforeSel.head.ch,
				afterAnchor: afterSel.anchor,
				afterHead: afterSel.head,
			}
		})
		await expect(result.beforeCollapsed).toBe(false) // confirm a real selection existed first
		await expect(result.afterAnchor).toEqual(result.afterHead) // Ctrl-G collapsed it
	})

	// A real regression found while verifying Bases support (not Bases-
	// specific, caught in the plain Properties panel too): the
	// property-name-edit phase's own bare-Escape pass-through
	// registration (added to buildPropertyRowScope to preserve the
	// name/key-edit input's native two-stage Escape handling) was
	// checking "is this the key-edit input?" and swallowing (returning
	// false for) every other target otherwise -- including a text value
	// widget with NO hotkey assigned to keyboard-quit at all, the true
	// out-of-the-box default state. Before the name-edit phase shipped,
	// nothing was registered for bare Escape unless keyboard-quit itself
	// had a hotkey, so a genuine external Escape always fell through to
	// each widget's own native handling untouched. Fixed by checking the
	// OPPOSITE condition instead: swallow ONLY for item-selection mode's
	// own row/heading/Add-button (still required by this file's own
	// tests above and propertyItemSelection.e2e.ts), defer to native for
	// every other value-editing widget regardless of type -- this also
	// covers Bases' own cells for free, since they share the same
	// classes (see basesPropertyEditing.e2e.ts).
	it('(7) regression: a bare Escape (keyboard-quit left UNMAPPED) still exits a text value widget natively', async function () {
		createdPaths.push('PropertyCtrlGBareEscape.md')
		await browser.executeObsidian(async ({ app }, path) => {
			// Deliberately does NOT call hm.setHotkeys for keyboard-quit --
			// testing the true default, no-hotkey-configured state.
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path, `---\nmyText: hello world\n---\nbody\n`)
			await app.workspace.getLeaf(true).openFile(file)
		}, 'PropertyCtrlGBareEscape.md')
		await browser.pause(400)

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const target = row.querySelector('.metadata-input-longtext') as HTMLElement
			target.focus()
		})
		await browser.pause(150)

		await browser.keys(['Escape'])
		await browser.pause(300)

		const after = await snap()
		await expect(after.propertyKey).toBe('mytext')
		await expect(after.isContentEditable).toBe(false) // landed on the row itself, not still editing
	})
})
