import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, frontmatter sub-phase: real user-reported bug, found
// testing on Windows with the "↓↑ column-aware" Key Upgrade enabled
// (bare ArrowUp/ArrowDown also bound to cursor-up/cursor-down, alongside
// Ctrl-N/P). buildPropertyRowScope's own bind() helper iterates EVERY
// effective hotkey for a command via getEffectiveHotkeysFor(), which
// then also picks up that Key Upgrade's own bare-arrow hotkey — so
// pressing Ctrl-N (which dispatches a synthetic bare ArrowDown as its
// own native-delegation mechanism) re-enters this SAME scope's own
// just-registered handler for that exact (no modifiers, ArrowDown)
// combo, confirmed live to silently swallow the whole chain: the real
// native row-to-row navigation never actually runs at all. Fixed by
// skipping registration of exactly the hotkey that would self-collide
// with the dispatch key (not bare hotkeys in general — a vim-style bare
// 'j'/'k' binding to the same command is untouched by this).
describe('Properties-panel item-selection mode: Key Upgrade bare-arrow interference', function () {
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
			// Mirrors the "↓↑ column-aware" Key Upgrade being ON:
			// cursor-up/down get BOTH the Ctrl-N/P hotkey AND the bare
			// ArrowUp/Down one, exactly as Key Upgrades actually assigns
			// them (see KEY_UPGRADE_DEFS in settings.ts).
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [
				{ modifiers: ['Ctrl'], key: 'P' },
				{ modifiers: [], key: 'ArrowUp' },
			])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [
				{ modifiers: ['Ctrl'], key: 'N' },
				{ modifiers: [], key: 'ArrowDown' },
			])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, `---
myText: hello world
myNumber: 42
myCheckbox: true
---
first body line
second body line
`)
			await app.workspace.getLeaf(true).openFile(file)
		}, path)
		await browser.pause(400)
	}

	async function pressOnActive(key: string, ctrl = true) {
		await browser.executeObsidian(({ app, obsidian }, { key2, ctrl2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			doc.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: key2, ctrlKey: ctrl2, bubbles: true, cancelable: true }))
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
			}
		})
	}

	it('(1) Ctrl-N/P still move focus between sibling property rows when the bare ArrowUp/Down Key Upgrade is also enabled', async function () {
		await openNote('PropertyKeyUpgradeInterferenceRows.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			row.focus()
		})
		await browser.pause(80)
		await expect((await activeDescriptor()).propertyKey).toBe('mytext')

		await pressOnActive('n', true)
		await expect((await activeDescriptor()).propertyKey).toBe('mynumber')

		await pressOnActive('n', true)
		await expect((await activeDescriptor()).propertyKey).toBe('mycheckbox')

		await pressOnActive('p', true)
		await expect((await activeDescriptor()).propertyKey).toBe('mynumber')
	})

	it('(2) Ctrl-P from the first row still reaches the heading, with the Key Upgrade enabled', async function () {
		await openNote('PropertyKeyUpgradeInterferenceHeading.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			row.focus()
		})
		await browser.pause(80)

		await pressOnActive('p', true)
		await expect((await activeDescriptor()).className).toContain('metadata-properties-heading')
	})

	it('(3) Ctrl-N from the Add-button still lands on the body\'s real first line (ch 0), with the Key Upgrade enabled', async function () {
		// Not a "restore the previous cursor position" operation (that's
		// what Ctrl-G/Escape does) — plain native ArrowDown from the
		// Add-button navigates into the body's own first line, matching
		// propertyAddButtonEscapeToBody's own documented fallback
		// behavior when no goal column survived (unrelated to the Key
		// Upgrade interference this spec is about; this test just
		// confirms that behavior still works at all once the fix stops
		// the bare-key collision from swallowing the dispatch entirely).
		await openNote('PropertyKeyUpgradeInterferenceAddButton.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const btn = view.containerEl.querySelector('.metadata-add-button') as HTMLElement
			btn.focus()
		})
		await browser.pause(80)

		await pressOnActive('n', true)
		const result = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getCursor()
		})
		await expect(result).toEqual({ line: 5, ch: 0 })
	})
})
