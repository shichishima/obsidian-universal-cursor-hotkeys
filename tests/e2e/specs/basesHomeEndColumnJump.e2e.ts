import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// Bases-native-shortcut-collision investigation (second item, see
// basesSetMarkSelectColumn.e2e.ts and tests/E2E.md's "Bases
// native-shortcut collisions" section for the first, Ctrl-Space):
// Home/End's own native "jump to first/last column" in Bases'
// cell-selection mode (https://obsidian.md/help/bases/views/table#Shortcuts)
// turned out NOT to be fixable the same way Ctrl-Space was. Bases only
// acts on the BARE Home/End key (gated on `!event.metaKey&&!event.ctrlKey`
// in its own handler, confirmed via a direct read of Obsidian's own
// app.js), and a bare Home/End can only ever reach cursor-home/
// cursor-end's own checkCallback via a Key Upgrade (the Hotkeys UI
// itself can't capture a bare Home/End at all) -- meaning this
// collision is, by construction, ALWAYS the self-bound case already
// documented on isBareArrowKeyUpgradeSelfBound (see its own comment,
// above cursor-up/cursor-down).
//
// Confirmed live via a document-level capturing `keydown` probe
// (`executeObsidian`): the REAL physical bare Home/End keypress never
// becomes a DOM `keydown` event at all once it's registered as ANY
// command's hotkey -- Obsidian's Keymap consumes it before the DOM
// ever sees it, regardless of what checkCallback returns. Actively
// redispatching a synthetic bare Home/End from checkCallback (mirroring
// propertyNativeArrowFallback, with the same recursion guard) was also
// tried and confirmed to produce no observable event either -- the
// exact same "Keymap consumes it unconditionally regardless of a
// recursive call's own return value" wall already hit for the Arrow-key
// self-collision case. Unlike that case, Properties' row navigation has
// a manual DOM-sibling-stepping fallback to reach for
// (propertyRowMoveUp/propertyRowMoveDown) -- Bases' active-cell/column
// state is private, internal, grouping- and virtualization-aware state
// this plugin has no access to, so there's no equivalent manual
// replacement available. This is a confirmed, unfixable architectural
// limitation, not a gap left for later.
//
// `cursor-home`/`cursor-end`'s checkCallback still gained an explicit
// BASES_TABLE_CONTAINER_SELECTOR branch returning `false` (mirroring
// set-mark's own Ctrl-Space fix) -- correct and sufficient for Ctrl-A/E
// (macOS-style keybindings): Bases never acts on that combo regardless
// (it only checks the bare key), so stepping aside is harmless and
// avoids the old claim-and-no-op's `.bases-table-container`-bundling-
// with-Properties behavior being even nominally involved here. This
// spec covers that regression-safety case; the bare-Home/End-vs-Bases
// gap itself has no corresponding test, matching how other confirmed,
// unfixable gaps in this project are documented (prose only, not a
// guaranteed-red spec) -- see e.g. propertyCtrlG.e2e.ts (7)/
// propertyNameEdit.e2e.ts (12)'s own bare-Escape-swallow gap.
describe('Bases table view: Ctrl-A/E on the cell-selection container is a safe no-op', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
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
