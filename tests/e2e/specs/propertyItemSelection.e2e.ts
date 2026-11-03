import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, frontmatter sub-phase, Phase 1: Ctrl-N/P drive the
// same row-to-row focus navigation a Properties-panel row's own "item
// selection mode" already does for physical ArrowUp/ArrowDown.
//
// "Item selection mode" is reached by pressing Escape twice from inside
// a property's text-editing state — confirmed live this collapses
// document.activeElement to the .metadata-property row DIV itself
// (tabIndex=0), distinct from any of its own text-editing descendants
// having focus. The Scope pushed for this mode is keyed to an EXACT
// match on the row element (not .closest()), specifically so ordinary
// text editing inside a property never activates this row-navigation
// scope — test (4) below is the direct regression coverage for that.
//
// Ctrl-N/P dispatch a synthetic native ArrowDown/ArrowUp KeyboardEvent
// on the focused row rather than hand-rolling sibling-element lookup +
// .focus() — this means the boundary behavior (tests (2)/(3)) is
// whatever Obsidian's own native handler already does, confirmed live:
// ArrowUp at the first row moves to the "Properties" heading above;
// ArrowDown at the last row moves to the "Add property" button below.
// Neither is a UCH-authored behavior, just inherited for free.
//
// The heading and Add-button are themselves full members of this same
// navigable chain, not dead ends — tests (5)/(6) below confirm Ctrl-N/P
// still work FROM them back INTO the row list. The one exception,
// Ctrl-P FROM the heading escaping all the way to the title (which native
// ArrowUp does too, but by selecting the whole title — this plugin
// deliberately lands a collapsed cursor instead, matching every other
// Ctrl-N/P crossing in the plugin), is cross-context and covered
// separately in titleCrossingFrontmatter.e2e.ts, not here.
describe('Properties-panel item-selection mode: Ctrl-N/P row navigation', function () {
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
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
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
		await browser.pause(400) // Properties panel render + initial layout settle
	}

	// Focuses the given property's text-editing area, then presses
	// Escape twice to reach item-selection mode on that row. Bundled into
	// one executeObsidian call rather than three separate round trips
	// (focus, then two individual pressKey calls) — confirmed live that
	// the multi-round-trip style can race with the Properties panel still
	// settling right after a freshly (re-)opened note, intermittently
	// landing the second Escape's effective target somewhere unexpected.
	// A single bundled script has no such gap.
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
		await browser.pause(100)
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
			}
		})
	}

	it('(1) Ctrl-N/P move focus between sibling property rows in order', async function () {
		await openNote('PropertyItemSelectBasic.md')
		await enterItemSelectionMode('mytext')
		await expect((await activeDescriptor()).propertyKey).toBe('mytext')

		await pressKey('n', true)
		await expect((await activeDescriptor()).propertyKey).toBe('mynumber')

		await pressKey('n', true)
		await expect((await activeDescriptor()).propertyKey).toBe('mycheckbox')

		await pressKey('p', true)
		await expect((await activeDescriptor()).propertyKey).toBe('mynumber')
	})

	it('(2) Ctrl-P at the first row moves to the Properties heading, same as physical ArrowUp', async function () {
		await openNote('PropertyItemSelectTopBoundary.md')
		await enterItemSelectionMode('mytext')

		await pressKey('p', true)
		const after = await activeDescriptor()
		await expect(after.propertyKey).toBe(null)
		await expect(after.className).toContain('metadata-properties-heading')
	})

	it('(3) Ctrl-N at the last row moves to the Add-property button, same as physical ArrowDown', async function () {
		await openNote('PropertyItemSelectBottomBoundary.md')
		await enterItemSelectionMode('mycheckbox')

		await pressKey('n', true)
		const after = await activeDescriptor()
		await expect(after.propertyKey).toBe(null)
		await expect(after.className).toContain('metadata-add-button')
	})

	it('(4) Ctrl-N/P do nothing to row focus while ordinary text editing is active (not item-selection mode)', async function () {
		await openNote('PropertyItemSelectNoInterference.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const target = row.querySelector('[contenteditable="true"]') as HTMLElement
			target.focus()
		})
		await browser.pause(80)
		const before = await activeDescriptor()
		await expect(before.isContentEditable).toBe(true)
		await expect(before.propertyKey).toBe('mytext')

		await pressKey('n', true) // must NOT trigger row navigation here
		const after = await activeDescriptor()
		await expect(after.isContentEditable).toBe(true)
		await expect(after.propertyKey).toBe('mytext')
	})

	it('(5) Ctrl-N at the Properties heading moves into the first property row', async function () {
		await openNote('PropertyItemSelectHeadingIntoRows.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const heading = view.containerEl.querySelector('.metadata-properties-heading') as HTMLElement
			heading.focus()
		})
		await browser.pause(80)
		await expect((await activeDescriptor()).className).toContain('metadata-properties-heading')

		await pressKey('n', true)
		await expect((await activeDescriptor()).propertyKey).toBe('mytext')
	})

	it('(6) Ctrl-P at the Add-property button moves into the last property row', async function () {
		await openNote('PropertyItemSelectAddButtonIntoRows.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const addButton = view.containerEl.querySelector('.metadata-add-button') as HTMLElement
			addButton.focus()
		})
		await browser.pause(80)
		await expect((await activeDescriptor()).className).toContain('metadata-add-button')

		await pressKey('p', true)
		await expect((await activeDescriptor()).propertyKey).toBe('mycheckbox')
	})
})
