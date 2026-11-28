import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// Bases-native-shortcut-collision investigation (second item, see
// basesSetMarkSelectColumn.e2e.ts and tests/E2E.md's "Bases
// native-shortcut collisions" section for the first, Ctrl-Space):
// Home/End's own native "jump to first/last column" in Bases'
// cell-selection mode (https://obsidian.md/help/bases/views/table#Shortcuts)
// turned out NOT to be fixable the same way Ctrl-Space was -- UNDER THE
// OLD MECHANISM. Bases only acts on the BARE Home/End key (gated on
// `!event.metaKey&&!event.ctrlKey` in its own handler, confirmed via a
// direct read of Obsidian's own app.js), and a bare Home/End could only
// ever reach cursor-home/cursor-end's own checkCallback via a Key
// Upgrade claiming it globally via hm.setHotkeys (the Hotkeys UI itself
// can't capture a bare Home/End at all) -- meaning this collision was,
// by construction, ALWAYS the self-bound case already documented on
// isBareArrowKeyUpgradeSelfBound (see its own comment, above
// cursor-up/cursor-down).
//
// Confirmed live via a document-level capturing `keydown` probe
// (`executeObsidian`): the REAL physical bare Home/End keypress never
// became a DOM `keydown` event at all once it was registered as ANY
// command's hotkey the OLD way -- Obsidian's Keymap consumed it before
// the DOM ever saw it, regardless of what checkCallback returned.
// Actively redispatching a synthetic bare Home/End from checkCallback
// (mirroring propertyNativeArrowFallback, with the same recursion guard)
// was also tried and confirmed to produce no observable event either --
// the exact same "Keymap consumes it unconditionally regardless of a
// recursive call's own return value" wall already hit for the Arrow-key
// self-collision case. Unlike that case, Properties' row navigation has
// a manual DOM-sibling-stepping fallback to reach for
// (propertyRowMoveUp/propertyRowMoveDown) -- Bases' active-cell/column
// state is private, internal, grouping- and virtualization-aware state
// this plugin has no access to, so there was no equivalent manual
// replacement available either. Confirmed, at the time, an unfixable
// architectural limitation given the OLD global-claim mechanism -- not
// a permanent one, since cursor-home/cursor-end have since been migrated
// to the Scope-based Key Upgrades rearchitecture (feat/key-upgrades-
// scope-rearchitecture, 0.13.1), which removes the global claim entirely
// and resolves this gap for good -- see the second describe block below.
//
// `cursor-home`/`cursor-end`'s checkCallback still has an explicit
// BASES_TABLE_CONTAINER_SELECTOR branch returning `false` (mirroring
// set-mark's own Ctrl-Space fix) -- correct and sufficient for Ctrl-A/E
// (macOS-style keybindings): Bases never acts on that combo regardless
// (it only checks the bare key), so stepping aside is harmless and
// avoids the old claim-and-no-op's `.bases-table-container`-bundling-
// with-Properties behavior being even nominally involved here. The
// first describe block below covers that regression-safety case.
describe('Bases table view: Ctrl-A/E on the cell-selection container is a safe no-op', function () {
	const createdPaths: string[] = []

	// Resets this test's own hm.setHotkeys calls (Ctrl-A/E/F on cursor-
	// home/end/right) -- otherwise they bleed into whatever spec runs
	// after this one in the same continuous session (all specs share one
	// already-launched Obsidian instance, see wdio.conf.mts's own comment)
	// and were caught doing exactly that against this same file's own
	// second describe block below, which asserts nothing stays baked for
	// cursor-home/cursor-end.
	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-home', [])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-end', [])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [])
			hm.bake()
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	it('Ctrl-A/E do not move the active cell or throw while focus is on .bases-table-container', async function () {
		const notePaths = ['BasesHomeEndNote1.md', 'BasesHomeEndNote2.md']
		const basePath = 'BasesHomeEnd.base'
		createdPaths.push(...notePaths, basePath)

		await browser.executeObsidian(async ({ app }, { notePaths2, basePath2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-home', [{ modifiers: ['Ctrl'], key: 'A' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-end', [{ modifiers: ['Ctrl'], key: 'E' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			app.workspace.getLeavesOfType('bases').forEach(leaf => leaf.detach())
			for (const p of [...notePaths2, basePath2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(notePaths2[0], `---\nmyA: a1\nmyText: b1\nmyNumber: 1\n---\nbody1\n`)
			await app.vault.create(notePaths2[1], `---\nmyA: a2\nmyText: b2\nmyNumber: 2\n---\nbody2\n`)
			const baseFile = await app.vault.create(basePath2, `filters:\n  file.name.contains("BasesHomeEndNote")\nviews:\n  - type: table\n    name: Table\n    order:\n      - myA\n      - myText\n      - myNumber\n`)
			await app.workspace.getLeaf(true).openFile(baseFile)
		}, { notePaths2: notePaths, basePath2: basePath })
		await browser.pause(800)

		const cellEl = await browser.$('.bases-tr:nth-of-type(1) [data-property="note.myText"]')
		await cellEl.click()
		await browser.pause(200)
		await browser.keys(['Escape']) // clicked in -> first Escape only clears the click's own text-selection sub-state
		await browser.pause(200)
		await browser.keys(['Escape']) // -> cell-selection mode, real DOM focus on .bases-table-container
		await browser.pause(200)

		// Establish a known-good reference point first (Ctrl-F, proven
		// elsewhere in this project to correctly reach Bases via
		// propertyNativeArrowFallback) before probing Ctrl-A/E's no-op.
		await browser.keys(['Control', 'f'])
		await browser.pause(300)

		await browser.keys(['Control', 'a'])
		await browser.pause(300)
		await browser.keys(['Control', 'e'])
		await browser.pause(300)

		await browser.keys(['Enter'])
		await browser.pause(300)
		const result = await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('bases')[0]
			const container = leaf?.view?.containerEl as HTMLElement
			const active = container.ownerDocument.activeElement as HTMLElement | null
			return active?.closest?.('[data-property]')?.getAttribute('data-property') ?? null
		})
		// Ctrl-F alone (myText -> myNumber) should still be the only
		// effective move; Ctrl-A/E must not have moved it further or
		// thrown an error that would have failed the test outright.
		await expect(result).toBe('note.myNumber')
	})
})

// Scope-based Key Upgrades rearchitecture (feat/key-upgrades-scope-
// rearchitecture, 0.13.1): cursor-home/cursor-end were migrated off the
// OLD global hm.setHotkeys claim onto a focus-scoped app.keymap Scope,
// same mechanism already validated for cursor-up/down. This is the
// positive case the "CONFIRMED UNFIXABLE" note above never had a test
// for -- back then, a bare Home/End reaching cursor-home/cursor-end at
// all meant it was claimed globally via hm.setHotkeys, which necessarily
// stole the key from Bases regardless of focus. Now that the Key Upgrade
// toggle only pushes a Scope while a real CM6 `.cm-content` has focus
// (see keyUpgradesScope's own field comment in main.ts), toggling the
// HOME/END rows on via the plugin's own keyUpgradeHomeScope/EndScope
// settings -- never touching hotkeyManager at all -- should leave a bare
// Home/End completely untouched while focus is on `.bases-table-container`
// instead, letting Bases' own native "jump to first/last column" run
// normally for the first time.
describe('Bases table view: bare Home/End reaches native column-jump even with the Key Upgrade scope toggled on', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.settings.keyUpgradeHomeScope = false
			plugin.settings.keyUpgradeEndScope = false
			await plugin.saveSettings()
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	it('bare Home/End move the active cell to the first/last column, Key Upgrade scope setting on, hotkeyManager untouched', async function () {
		const notePaths = ['BasesHomeEndScopeNote1.md', 'BasesHomeEndScopeNote2.md']
		const basePath = 'BasesHomeEndScope.base'
		createdPaths.push(...notePaths, basePath)

		await browser.executeObsidian(async ({ app }, { notePaths2, basePath2 }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			// The whole point: flip the plugin's own setting, never hm.setHotkeys.
			plugin.settings.keyUpgradeHomeScope = true
			plugin.settings.keyUpgradeEndScope = true
			await plugin.saveSettings()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			app.workspace.getLeavesOfType('bases').forEach(leaf => leaf.detach())
			for (const p of [...notePaths2, basePath2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(notePaths2[0], `---\nmyA: a1\nmyText: b1\nmyNumber: 1\n---\nbody1\n`)
			await app.vault.create(notePaths2[1], `---\nmyA: a2\nmyText: b2\nmyNumber: 2\n---\nbody2\n`)
			const baseFile = await app.vault.create(basePath2, `filters:\n  file.name.contains("BasesHomeEndScopeNote")\nviews:\n  - type: table\n    name: Table\n    order:\n      - myA\n      - myText\n      - myNumber\n`)
			await app.workspace.getLeaf(true).openFile(baseFile)
		}, { notePaths2: notePaths, basePath2: basePath })
		await browser.pause(800)

		async function activeProperty() {
			await browser.keys(['Enter'])
			await browser.pause(300)
			const result = await browser.executeObsidian(({ app }) => {
				const leaf = app.workspace.getLeavesOfType('bases')[0]
				const container = leaf?.view?.containerEl as HTMLElement
				const active = container.ownerDocument.activeElement as HTMLElement | null
				return active?.closest?.('[data-property]')?.getAttribute('data-property') ?? null
			})
			await browser.keys(['Escape'])
			await browser.pause(150)
			await browser.keys(['Escape'])
			await browser.pause(150)
			return result
		}

		const cellEl = await browser.$('.bases-tr:nth-of-type(1) [data-property="note.myText"]')
		await cellEl.click()
		await browser.pause(200)
		await browser.keys(['Escape']) // clicked in -> first Escape only clears the click's own text-selection sub-state
		await browser.pause(200)
		await browser.keys(['Escape']) // -> cell-selection mode, real DOM focus on .bases-table-container
		await browser.pause(200)

		await browser.keys(['Home'])
		await browser.pause(300)
		await expect(await activeProperty()).toBe('note.myA') // first column

		// Re-enter cell-selection mode on the middle column again for a
		// clean End probe (activeProperty's own trailing Escapes above
		// already left focus/selection mode intact, no re-click needed).
		await browser.keys(['Control', 'f']) // myA -> myText, known-good reference move
		await browser.pause(300)

		await browser.keys(['End'])
		await browser.pause(300)
		await expect(await activeProperty()).toBe('note.myNumber') // last column

		// The architectural point of the rearchitecture: neither row's own
		// toggle ever touches hotkeyManager, so neither command's fullId
		// ever gets a BARE-key entry baked. Checking specifically for the
		// bare entry (not "nothing at all baked") -- this suite's many
		// other, unrelated specs commonly bind a real modified hotkey
		// (Ctrl-A/E etc.) to these same commands as their own fixture
		// setup and don't always reset it afterward; a broader "array is
		// completely empty" check is sensitive to that pre-existing,
		// unrelated suite-wide leak, confirmed live when it caught exactly
		// that noise instead of a real problem here.
		const hasBareKeyBaked = (commandId: string, key: string) => browser.executeObsidian(({ app }, { commandId2, key2 }) => {
			const hm = (app as any).hotkeyManager
			return hm.bakedIds.some((id: string, i: number) =>
				id === commandId2 && hm.bakedHotkeys[i].key === key2 && hm.bakedHotkeys[i].modifiers === '')
		}, { commandId2: commandId, key2: key })
		await expect(await hasBareKeyBaked('universal-cursor-hotkeys:cursor-home', 'Home')).toBe(false)
		await expect(await hasBareKeyBaked('universal-cursor-hotkeys:cursor-end', 'End')).toBe(false)
	})
})
