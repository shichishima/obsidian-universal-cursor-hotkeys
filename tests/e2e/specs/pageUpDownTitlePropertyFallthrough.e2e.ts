import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// Confirmed real gap, found while documenting Page up/down's own
// title/Properties/Bases coverage for the command-details.md writeup:
// unlike every other command in this plugin, Page up/down's own
// checkCallback only guarded BASES_TABLE_CONTAINER_SELECTOR (Bases'
// own cell-SELECTION mode) -- it never checked TITLE_SELECTOR,
// PROPERTY_TEXT_LIKE_EDIT_SELECTOR, or PROPERTY_ANY_ITEM_SELECTION_SELECTOR
// at all, so pressing Page up/down while actually editing a title,
// frontmatter property value, composing tag input, or a Bases cell's
// own text silently fell through to the body editor underneath --
// moving the BODY's cursor by a page while real DOM focus stayed
// exactly where it was, with no visible sign anything happened.
// Confirmed live via a throwaway diagnostic before fixing: focusing a
// frontmatter text value, then pressing Page Down, moved the body's
// cursor from line 3 to line 33 while activeElement never changed.
//
// Fix mirrors the exact same shape every other command in this file
// already uses (see cursor-home's own checkCallback): title and
// PROPERTY_TEXT_LIKE_EDIT_SELECTOR claim-and-no-op (no "page" concept
// on a single line), BASES_TABLE_CONTAINER_SELECTOR keeps its existing
// `return false` (the already-documented, confirmed-unfixable
// Bases-native-paging architectural wall -- unchanged by this fix),
// and PROPERTY_ANY_ITEM_SELECTION_SELECTOR (row/heading/Add-button/
// pill/checkbox/date/datetime/number) claims-and-no-ops too.
describe('Page up/down: title/Properties/Bases-cell text editing no longer falls through to the body', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function openNote(path: string, content: string) {
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app }, { path2, content2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:page-down', [{ modifiers: ['Ctrl', 'Shift'], key: 'D' }])
			hm.setHotkeys('universal-cursor-hotkeys:page-up', [{ modifiers: ['Ctrl', 'Shift'], key: 'U' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, content2)
			await app.workspace.getLeaf(true).openFile(file)
		}, { path2: path, content2: content })
		await browser.pause(400)
	}

	async function bodyCursor() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getCursor()
		})
	}

	const longBody = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')

	it('(1) title: Page Down does not move the body cursor while the title is focused', async function () {
		await openNote('PageDownTitle.md', `---\n---\n${longBody}`)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: 2, ch: 0 })
			const titleEl = view.containerEl.querySelector('.inline-title') as HTMLElement
			titleEl.focus()
		})
		await browser.pause(150)
		const before = await bodyCursor()

		await browser.keys(['Control', 'Shift', 'd'])
		await browser.pause(200)
		const after = await bodyCursor()
		await expect(after).toEqual(before)
	})

	it('(2) frontmatter text value: Page Down does not move the body cursor', async function () {
		await openNote('PageDownPropertyValue.md', `---\nmyText: hello\n---\n${longBody}`)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: 2, ch: 0 })
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const el = row.querySelector('.metadata-input-longtext') as HTMLElement
			el.focus()
		})
		await browser.pause(150)
		const before = await bodyCursor()

		await browser.keys(['Control', 'Shift', 'd'])
		await browser.pause(200)
		const after = await bodyCursor()
		await expect(after).toEqual(before)
	})

	it('(3) frontmatter composing tag input: Page Up does not move the body cursor', async function () {
		await openNote('PageUpPropertyComposing.md', `---\nmylist:\n  - itemOne\n---\n${longBody}`)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: 40, ch: 0 })
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mylist"]') as HTMLElement
			const el = row.querySelector('.multi-select-input') as HTMLElement
			el.focus()
		})
		await browser.pause(150)
		const before = await bodyCursor()

		await browser.keys(['Control', 'Shift', 'u'])
		await browser.pause(200)
		const after = await bodyCursor()
		await expect(after).toEqual(before)
	})

	it('(4) regression: Bases cell-selection mode still returns false, unaffected by this fix', async function () {
		const notePath = 'PageDownBasesNote.md'
		const basePath = 'PageDownBases.base'
		createdPaths.push(basePath)
		await browser.executeObsidian(async ({ app }, { notePath2, basePath2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:page-down', [{ modifiers: ['Ctrl', 'Shift'], key: 'D' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			app.workspace.getLeavesOfType('bases').forEach(leaf => leaf.detach())
			for (const p of [notePath2, basePath2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(notePath2, '---\nmyText: hello\n---\nbody\n')
			const baseContent = `views:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - note.myText\n`
			const baseFile = await app.vault.create(basePath2, baseContent)
			await app.workspace.getLeaf(true).openFile(baseFile)
		}, { notePath2: notePath, basePath2: basePath })
		await browser.pause(800)

		await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('bases')[0]
			const container = leaf?.view?.containerEl as HTMLElement
			;(container.querySelector('.bases-table-container') as HTMLElement)?.focus()
		})
		await browser.pause(150)

		// Just confirms no error/crash occurs and the container stays
		// focused -- this plugin returning false here means the key
		// event is left alone (Bases' own native paging can't be
		// restored once a Key Upgrade claims the bare key, a separate,
		// already-documented architectural wall -- unaffected by this
		// fix either way).
		await browser.keys(['Control', 'Shift', 'd'])
		await browser.pause(150)
		const stillFocused = await browser.executeObsidian(() => {
			return document.activeElement?.className.includes('bases-table-container')
		})
		await expect(stillFocused).toBe(true)
	})
})
