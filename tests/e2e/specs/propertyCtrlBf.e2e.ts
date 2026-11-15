import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, frontmatter sub-phase: Ctrl-B/F in Properties-panel
// item-selection mode delegate straight to native ArrowLeft/ArrowRight,
// the same pattern Ctrl-N/P already uses for ArrowUp/ArrowDown
// (propertyItemSelection.e2e.ts). Unlike Ctrl-N/P, there's no custom
// per-element handler needed at all — native ArrowLeft/Right already
// does the right thing for every element in the chain, confirmed live
// before writing these tests:
//   - .metadata-properties-heading: collapses (Left) / expands (Right)
//     the whole Properties block. NOT a toggle — Right at an already-
//     expanded heading (and Left at an already-collapsed one) is a
//     confirmed no-op.
//   - .metadata-property: enters the row's own name-edit (Left) or
//     value-edit (Right) mode.
//   - .metadata-add-button: both directions are a confirmed no-op —
//     nothing to collapse/expand or edit there.
//
// Also confirmed live: the number of Escape presses needed to get back
// from an edit mode to the row varies by property type and direction
// (text: 2 for both name and value; number/tags value-edit: 1) — this is
// Obsidian's own native behavior, not something this feature controls,
// so returnToRow() below adapts rather than hardcoding a count.
describe('Properties-panel item-selection mode: Ctrl-B/F native Left/Right delegation', function () {
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
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, `---
myText: hello world
myNumber: 42
myCheckbox: true
---
body content
`)
			await app.workspace.getLeaf(true).openFile(file)
		}, path)
		await browser.pause(400)
	}

	// Mirrors propertyItemSelection.e2e.ts's own helper of the same name —
	// bundled into one executeObsidian call for the same settle-timing
	// reason documented there.
	async function enterItemSelectionMode(propertyKey: string) {
		await browser.executeObsidian(async ({ app, obsidian }, key) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const row = view.containerEl.querySelector(`.metadata-property[data-property-key="${key}"]`) as HTMLElement
			const target = (row.querySelector('[contenteditable="true"], input') as HTMLElement)
			target.focus()
			await new Promise(r => setTimeout(r, 80))
			function press(k: string) {
				doc.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
			}
			press('Escape')
			await new Promise(r => setTimeout(r, 100))
			press('Escape')
			await new Promise(r => setTimeout(r, 100))
		}, propertyKey)
	}

	async function pressKey(key: string, ctrl: boolean) {
		await browser.executeObsidian(({ app, obsidian }, { key2, ctrl2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement!
			active.dispatchEvent(new KeyboardEvent('keydown', { key: key2, ctrlKey: ctrl2, bubbles: true, cancelable: true }))
		}, { key2: key, ctrl2: ctrl })
		await browser.pause(150)
	}

	async function activeDescriptor() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			return {
				propertyKey: active?.closest?.('.metadata-property')?.getAttribute('data-property-key') ?? null,
				className: active?.className ?? null,
				isContentEditable: active?.isContentEditable ?? false,
				tag: active?.tagName ?? null,
			}
		})
	}

	// Presses Escape up to 3 times, stopping once focus is back on the
	// given row. The exact count needed varies by property type/direction
	// (see the file-level comment) — adapting here instead of hardcoding
	// one keeps this test immune to that native, out-of-scope detail.
	async function returnToRow(propertyKey: string) {
		for (let i = 0; i < 3; i++) {
			const atRow = await browser.executeObsidian(({ app, obsidian }, key) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const doc = view.containerEl.ownerDocument
				const row = view.containerEl.querySelector(`.metadata-property[data-property-key="${key}"]`) as HTMLElement
				return doc.activeElement === row
			}, propertyKey)
			if (atRow) return
			await pressKey('Escape', false)
		}
	}

	async function headingCollapsed() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const heading = view.containerEl.querySelector('.metadata-properties-heading') as HTMLElement
			return heading.classList.contains('is-collapsed')
		})
	}

	it('(1) Ctrl-B enters native name-edit mode; after returning to the row via Escape, Ctrl-F enters native value-edit mode', async function () {
		await openNote('PropertyCtrlBfNameThenValue.md')
		await enterItemSelectionMode('mytext')

		await pressKey('b', true)
		const afterB = await activeDescriptor()
		await expect(afterB.tag).toBe('INPUT')
		await expect(afterB.className).toContain('metadata-property-key-input')

		await returnToRow('mytext')
		await expect((await activeDescriptor()).propertyKey).toBe('mytext')

		await pressKey('f', true)
		const afterF = await activeDescriptor()
		await expect(afterF.tag).toBe('DIV')
		await expect(afterF.className).toContain('metadata-input-longtext')
	})

	it('(2) Ctrl-B at the Properties heading collapses the panel', async function () {
		await openNote('PropertyCtrlBfHeadingCollapse.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const heading = view.containerEl.querySelector('.metadata-properties-heading') as HTMLElement
			heading.focus()
		})
		await browser.pause(80)
		await expect(await headingCollapsed()).toBe(false)

		await pressKey('b', true)
		await expect(await headingCollapsed()).toBe(true)
	})

	it('(3) Ctrl-F at the Properties heading expands a collapsed panel (and is a no-op if already expanded, matching native)', async function () {
		await openNote('PropertyCtrlBfHeadingExpand.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const heading = view.containerEl.querySelector('.metadata-properties-heading') as HTMLElement
			const collapseIndicator = heading.querySelector('.collapse-indicator') as HTMLElement | null
			collapseIndicator?.click()
		})
		await browser.pause(200)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const heading = view.containerEl.querySelector('.metadata-properties-heading') as HTMLElement
			heading.focus()
		})
		await browser.pause(80)
		await expect(await headingCollapsed()).toBe(true)

		await pressKey('f', true)
		await expect(await headingCollapsed()).toBe(false)

		// Already expanded now — a second Ctrl-F must stay a no-op, not
		// e.g. toggle back to collapsed.
		await pressKey('f', true)
		await expect(await headingCollapsed()).toBe(false)
	})

	it('(4) regression: Ctrl-B/F while editing the value text move the cursor WITHIN it (not row navigation or name-edit entry) — same mechanism as propertyValueEditMovement.e2e.ts\'s own Ctrl-B/F movement tests', async function () {
		// Previously asserted Ctrl-B/F did nothing at all here — true
		// before propertyRowScope's own push/pop condition was broadened
		// to cover this widget for the property-value-editing movement
		// work (feat/property-value-edit-movement). Once that landed,
		// Ctrl-B here does real character movement (reusing titleMoveChar,
		// same as the title field) without changing which element has
		// focus at all — this test now confirms that, instead of the
		// opposite.
		await openNote('PropertyCtrlBfNoInterference.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const target = row.querySelector('.metadata-input-longtext') as HTMLElement
			target.focus()
			const sel = target.ownerDocument.getSelection()!
			const range = target.ownerDocument.createRange()
			range.setStart(target.firstChild!, 5)
			range.collapse(true)
			sel.removeAllRanges()
			sel.addRange(range)
		})
		await browser.pause(150)
		const before = await activeDescriptor()
		await expect(before.isContentEditable).toBe(true)
		await expect(before.propertyKey).toBe('mytext')

		await pressKey('b', true)
		const after = await activeDescriptor()
		await expect(after.isContentEditable).toBe(true)
		await expect(after.propertyKey).toBe('mytext')
		const focusOffset = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.containerEl.ownerDocument.getSelection()?.focusOffset
		})
		await expect(focusOffset).toBe(4) // "hello world", started at 5, Ctrl-B moved left by one
	})

	it('(5) regression: a note WITHOUT frontmatter is unaffected — Ctrl-B still moves the body cursor one character left', async function () {
		createdPaths.push('PropertyCtrlBfNoFm.md')
		const result = await browser.executeObsidian(async ({ app, obsidian }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-left', [{ modifiers: ['Ctrl'], key: 'B' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const path = 'PropertyCtrlBfNoFm.md'
			const existing = app.vault.getFileByPath(path)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path, 'first body line')
			await app.workspace.getLeaf(true).openFile(file)
			await new Promise(r => setTimeout(r, 400))

			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.focus()
			view.editor.setCursor({ line: 0, ch: 5 })
			await new Promise(r => setTimeout(r, 80))
			const doc = view.containerEl.ownerDocument
			doc.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }))
			await new Promise(r => setTimeout(r, 150))
			return view.editor.getCursor()
		})
		await expect(result.ch).toBe(4)
		await expect(result.line).toBe(0)
	})

	it('(6) regression: Ctrl-B/F at the Add-button are a no-op (confirmed live: native Left/Right do nothing there either)', async function () {
		await openNote('PropertyCtrlBfAddButton.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const addButton = view.containerEl.querySelector('.metadata-add-button') as HTMLElement
			addButton.focus()
		})
		await browser.pause(80)
		const before = await activeDescriptor()

		await pressKey('b', true)
		await expect((await activeDescriptor()).className).toBe(before.className)

		await pressKey('f', true)
		await expect((await activeDescriptor()).className).toBe(before.className)
	})
})
