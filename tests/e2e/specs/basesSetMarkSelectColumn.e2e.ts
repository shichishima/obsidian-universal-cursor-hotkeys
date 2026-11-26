import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// Bases-native-shortcut-collision fix: Set-mark (Ctrl-Space) used to
// silently swallow Bases' own native "select column" shortcut, which
// shares the exact same key combo (https://obsidian.md/help/bases/views/table#Shortcuts).
//
// Root cause, confirmed live via a diagnostic probe plus a direct read
// of Obsidian's own app.js (the Bases table view class): Bases'
// cell-selection-mode Ctrl-Space is NOT an Obsidian command at all --
// it's a plain `addEventListener('keydown', ...)` on
// `.bases-table-container` itself (`if(a.key===" "&&a.ctrlKey){...
// this.selection={top:0,bottom:...,start:b.start,end:b.end,...}}`),
// gated at its own very first line on `a.defaultPrevented` already
// being true. `set-mark`'s own checkCallback had no
// BASES_TABLE_CONTAINER_SELECTOR branch of its own, so it fell through
// to the shared PROPERTY_ANY_ITEM_SELECTION_SELECTOR check (which
// bundles the Bases container together with Properties'
// row/heading/Add-button, none of which have a meaningful Ctrl-Space
// action) and claimed-and-no-op'd the key -- which still makes
// Obsidian's own Keymap call preventDefault() on the real keydown
// event, so by the time it would otherwise reach Bases' own listener,
// `a.defaultPrevented` is already true and that listener bails out
// immediately, before ever checking `a.key`/`a.ctrlKey` at all.
//
// This reproduced identically whether the Bases table was its own
// standalone tab (no MarkdownView/editor exists at all under it) or
// embedded in a note via `![[some.base]]` (a real MarkdownView DOES
// exist underneath, for the HOST note) -- confirmed live that neither
// case's outcome has anything to do with whether a MarkdownView/editor
// happens to exist; `set-mark`'s checkCallback runs purely off
// `activeDocument.activeElement` matching `.bases-table-container`,
// before ever reaching the MarkdownView-dependent fallback at the
// bottom of the function.
//
// Fix: `set-mark`'s checkCallback now checks
// BASES_TABLE_CONTAINER_SELECTOR explicitly, ahead of
// PROPERTY_ANY_ITEM_SELECTION_SELECTOR, and returns `false` (not
// claimed) rather than `true`-and-no-op -- letting the real keydown
// event reach Bases' own native listener untouched, in both the
// standalone and embedded case alike.
describe('Set-mark (Ctrl-Space) no longer collides with Bases\' native select-column', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function reachCellSelectionMode(cellSelector: string) {
		const cellEl = await browser.$(cellSelector)
		await cellEl.click()
		await browser.pause(200)
		await browser.keys(['Escape']) // clicked in -> first Escape only clears the click's own text-selection sub-state
		await browser.pause(200)
		await browser.keys(['Escape']) // -> cell-selection mode, real DOM focus on .bases-table-container
		await browser.pause(200)
	}

	async function hasNativeColumnSelection() {
		return browser.executeObsidian(() => {
			const container = document.querySelector('.bases-table-container')
			return !!container?.querySelector('.bases-table-selection')
		})
	}

	it('(1) standalone Bases tab: Ctrl-Space selects the column natively instead of being swallowed', async function () {
		const notePaths = ['BasesSetMarkNote1.md', 'BasesSetMarkNote2.md']
		const basePath = 'BasesSetMarkStandalone.base'
		createdPaths.push(...notePaths, basePath)

		await browser.executeObsidian(async ({ app }, { notePaths2, basePath2 }) => {
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			app.workspace.getLeavesOfType('bases').forEach(leaf => leaf.detach())
			for (const p of [...notePaths2, basePath2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(notePaths2[0], `---\nmyText: a\n---\nbody1\n`)
			await app.vault.create(notePaths2[1], `---\nmyText: b\n---\nbody2\n`)
			const baseFile = await app.vault.create(basePath2, `filters:\n  file.name.contains("BasesSetMarkNote")\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - myText\n`)
			await app.workspace.getLeaf(true).openFile(baseFile)
		}, { notePaths2: notePaths, basePath2: basePath })
		await browser.pause(800)

		await reachCellSelectionMode('.bases-tr:nth-of-type(1) [data-property="note.myText"]')
		await expect(await hasNativeColumnSelection()).toBe(false)

		await browser.keys(['Control', ' '])
		await browser.pause(300)
		await expect(await hasNativeColumnSelection()).toBe(true)
	})

	it('(2) Bases embedded in a note (![[some.base]]): Ctrl-Space selects the column natively instead of being swallowed by the host note\'s own editor', async function () {
		const notePaths = ['BasesSetMarkEmbedNote1.md', 'BasesSetMarkEmbedNote2.md', 'BasesSetMarkEmbedHost.md']
		const basePath = 'BasesSetMarkEmbedded.base'
		createdPaths.push(...notePaths, basePath)

		await browser.executeObsidian(async ({ app }, { notePaths2, basePath2, hostPath2 }) => {
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			app.workspace.getLeavesOfType('bases').forEach(leaf => leaf.detach())
			for (const p of [...notePaths2, basePath2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(notePaths2[0], `---\nmyText: a\n---\nbody1\n`)
			await app.vault.create(notePaths2[1], `---\nmyText: b\n---\nbody2\n`)
			await app.vault.create(basePath2, `filters:\n  file.name.contains("BasesSetMarkEmbedNote")\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - myText\n`)
			const hostFile = await app.vault.create(hostPath2, `# host\n\n![[${basePath2}]]\n`)
			await app.workspace.getLeaf(true).openFile(hostFile)
		}, { notePaths2: notePaths, basePath2: basePath, hostPath2: notePaths[2] })
		await browser.pause(1000)

		await reachCellSelectionMode('.bases-tr:nth-of-type(1) [data-property="note.myText"]')
		await expect(await hasNativeColumnSelection()).toBe(false)

		await browser.keys(['Control', ' '])
		await browser.pause(300)
		await expect(await hasNativeColumnSelection()).toBe(true)
	})
})
