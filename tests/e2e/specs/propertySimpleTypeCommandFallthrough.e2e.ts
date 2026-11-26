import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// A real gap found live while documenting Set-mark's own title/Properties/
// Bases coverage: PROPERTY_ANY_ITEM_SELECTION_SELECTOR (the shared "claim
// and no-op" selector used by Set-mark, Kill-line, Kill-region,
// Copy-region, Yank, Delete char, Kill word left/right, and HOME/END)
// never included PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR (checkbox/date/
// datetime/number inputs) -- the exact same category of bug as
// fix/property-multiselect-pill-command-fallthrough, just for a different
// missing selector class. Confirmed live via a throwaway diagnostic
// BEFORE fixing anything: pressing Set-mark with real DOM focus on a date
// input flipped `markActive` true and armed a mark on the BODY editor
// underneath, even though focus never left the date input.
describe('Property panel: commands no-op on checkbox/date/datetime/number, not fall through to the body', function () {
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
			hm.setHotkeys('universal-cursor-hotkeys:cursor-home', [{ modifiers: ['Ctrl'], key: 'A' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-end', [{ modifiers: ['Ctrl'], key: 'E' }])
			hm.setHotkeys('universal-cursor-hotkeys:set-mark', [{ modifiers: ['Ctrl'], key: ' ' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-line', [{ modifiers: ['Ctrl'], key: 'K' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-region', [{ modifiers: ['Ctrl'], key: 'W' }])
			hm.setHotkeys('universal-cursor-hotkeys:copy-region', [{ modifiers: ['Alt'], key: 'W' }])
			hm.setHotkeys('universal-cursor-hotkeys:yank', [{ modifiers: ['Ctrl'], key: 'Y' }])
			hm.setHotkeys('universal-cursor-hotkeys:delete-char', [{ modifiers: ['Ctrl'], key: 'D' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-word-left', [{ modifiers: ['Alt'], key: 'Backspace' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-word-right', [{ modifiers: ['Alt'], key: 'D' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, `---
mycheckbox: true
mydate: 2026-01-15
mydatetime: 2026-01-15T10:30
mynumber: 42
---
first body line
second body line
`)
			await app.workspace.getLeaf(true).openFile(file)
		}, path)
		await browser.pause(400)
	}

	async function focus(propertyKey: string, selector: string) {
		await browser.executeObsidian(({ app, obsidian }, { propertyKey2, selector2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector(`.metadata-property[data-property-key="${propertyKey2}"]`) as HTMLElement
			const el = row.querySelector(selector2) as HTMLElement
			el.focus()
		}, { propertyKey2: propertyKey, selector2: selector })
		await browser.pause(150)
	}

	async function snapBody() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			const doc = view.containerEl.ownerDocument
			return {
				text: view.editor.getValue(),
				cursor: view.editor.getCursor(),
				markActive: plugin.markActive as boolean,
				activeTag: doc.activeElement?.tagName ?? null,
			}
		})
	}

	const commandsToKeys: [string, string[]][] = [
		['HOME', ['Control', 'a']],
		['END', ['Control', 'e']],
		['Set mark', ['Control', ' ']],
		['Kill line', ['Control', 'k']],
		['Kill region', ['Control', 'w']],
		['Copy region', ['Alt', 'w']],
		['Yank', ['Control', 'y']],
		['Delete char', ['Control', 'd']],
		['Kill word left', ['Alt', 'Backspace']],
		['Kill word right', ['Alt', 'd']],
	]

	for (const [name, keys] of commandsToKeys) {
		it(`(date) ${name} is a true no-op on a focused date input, not a body fallthrough`, async function () {
			await openNote(`PropertySimpleTypeFallthrough_${name.replace(/\s+/g, '')}.md`)
			// Give the body's own mark/cursor state something to corrupt if
			// the command falls through, so a silent fallthrough is actually
			// observable.
			await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				view.editor.setCursor({ line: 1, ch: 6 }) // mid "second body line"
			})
			await focus('mydate', 'input[type="date"]')

			const before = await snapBody()
			await expect(before.markActive).toBe(false)
			await expect(before.activeTag).toBe('INPUT')

			await browser.keys(keys)
			await browser.pause(200)

			const after = await snapBody()
			await expect(after.text).toBe(before.text)
			await expect(after.cursor).toEqual(before.cursor)
			await expect(after.markActive).toBe(false)
		})
	}

	const otherTypes: [string, string][] = [
		['mycheckbox', 'input[type="checkbox"]'],
		['mydatetime', 'input[type="datetime-local"]'],
		['mynumber', 'input[type="number"]'],
	]

	for (const [propertyKey, selector] of otherTypes) {
		it(`(${propertyKey}) Set mark is a true no-op, confirming the fix covers every PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR type, not just date`, async function () {
			await openNote(`PropertySimpleTypeFallthrough_${propertyKey}.md`)
			await focus(propertyKey, selector)

			const before = await snapBody()
			await expect(before.markActive).toBe(false)

			await browser.keys(['Control', ' '])
			await browser.pause(200)

			const after = await snapBody()
			await expect(after.markActive).toBe(false)
			await expect(after.text).toBe(before.text)
		})
	}
})
