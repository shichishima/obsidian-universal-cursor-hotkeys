import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// Bases-native-shortcut-collision investigation (fourth and final item,
// see basesSetMarkSelectColumn.e2e.ts / basesHomeEndColumnJump.e2e.ts /
// basesArrowKeyUpgradeSelfCollision.e2e.ts and tests/E2E.md's "Bases
// native-shortcut collisions" section for the first three). Page
// Up/Down turned out to be a hybrid of the first two outcomes, not a
// repeat of either one: part of it was genuinely fixable (and WAS a
// real regression, unlike Home/End's pure no-op), part of it hits the
// exact same unfixable wall as Home/End.
//
// page-up/page-down were registered with a plain `editorCallback`, the
// only command on this whole investigation that wasn't `checkCallback`
// -- Obsidian's own built-in gating for an editorCallback command just
// checks "is there an active MarkdownView/editor right now," with NO
// activeDocument.activeElement awareness at all. Confirmed live: with a
// bare PageUp/PageDown Key Upgrade bound, this meant `pageDown(editor)`
// ran against the HOST note's own body editor whenever a Bases table
// was embedded in a note (`![[some.base]]`) and real focus was on the
// Bases cell-selection container -- moving the host editor's cursor
// while the user was visibly looking at the Bases table, a real,
// confusing regression, the exact same class of bug Set-mark's own
// Ctrl-Space had (just via Obsidian's built-in editorCallback dispatch
// instead of this plugin's own checkCallback logic). Standalone-tab
// Bases was unaffected by THIS particular bug (no MarkdownView exists
// there at all, so Obsidian's own built-in gating already silently
// declined to run the command either way).
//
// Fix for that part: converted page-up/page-down to checkCallback,
// mirroring every other command on this investigation, with an
// explicit BASES_TABLE_CONTAINER_SELECTOR branch returning `false`
// ahead of the generic editor fallback -- same shape as Set-mark's own
// Ctrl-Space fix.
//
// What that fix does NOT do: restore Bases' own native page-scroll.
// Confirmed live via a document-level capturing `keydown` probe, in
// BOTH the standalone and embedded case: once a bare Page Up/Down is
// registered to ANY command via a Key Upgrade, the real physical
// keypress never becomes a DOM `keydown` event at all -- the exact
// same architectural wall already confirmed unfixable for bare
// Home/End (a direct `app.js` read confirms Bases' own Page Up/Down
// handling shares the identical keydown function, the identical bare-
// key-only gate, and the identical private `this.activeCell`/
// `this.selection` state as ArrowUp/Down and Home/End -- it steps by a
// page's worth of rows instead of one, nothing else differs). So
// returning `false` here only stops this plugin from corrupting the
// host body; it can never make the real key reach Bases' own listener,
// which never sees it either way, in either Bases context.
describe('Bases table view: Page Up/Down no longer corrupts the host note when embedded; native paging remains unfixable', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:page-up', [])
			hm.setHotkeys('universal-cursor-hotkeys:page-down', [])
			hm.bake()
		})
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	it('(1) standalone Bases tab: bare PageDown Key Upgrade is a safe no-op (not fixed, but not broken either)', async function () {
		const notePaths = ['BasesPageUpDownNote1.md', 'BasesPageUpDownNote2.md']
		const basePath = 'BasesPageUpDownStandalone.base'
		createdPaths.push(...notePaths, basePath)

		await browser.executeObsidian(async ({ app }, { notePaths2, basePath2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:page-up', [{ modifiers: [], key: 'PageUp' }])
			hm.setHotkeys('universal-cursor-hotkeys:page-down', [{ modifiers: [], key: 'PageDown' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			app.workspace.getLeavesOfType('bases').forEach(leaf => leaf.detach())
			for (const p of [...notePaths2, basePath2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(notePaths2[0], `---\nmyText: a\n---\nbody1\n`)
			await app.vault.create(notePaths2[1], `---\nmyText: b\n---\nbody2\n`)
			const baseFile = await app.vault.create(basePath2, `filters:\n  file.name.contains("BasesPageUpDownNote")\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - myText\n`)
			await app.workspace.getLeaf(true).openFile(baseFile)
		}, { notePaths2: notePaths, basePath2: basePath })
		await browser.pause(800)

		const cellEl = await browser.$('.bases-tr:nth-of-type(1) [data-property="note.myText"]')
		await cellEl.click()
		await browser.pause(200)
		await browser.keys(['Escape'])
		await browser.pause(200)
		await browser.keys(['Escape'])
		await browser.pause(200)

		let threw = false
		try {
			await browser.keys(['PageDown'])
		} catch (e) {
			threw = true
		}
		await browser.pause(300)
		await expect(threw).toBe(false)

		// No assertion on the active cell actually moving -- confirmed
		// architecturally unfixable, documented above. This test only
		// guards against a crash/exception, matching this project's
		// convention for a confirmed-unfixable gap (propertyCtrlG.e2e.ts
		// (7), propertyNameEdit.e2e.ts (12)).
	})

	it('(2) Bases embedded in a note: PageDown no longer moves the HOST note\'s own cursor while focus is on the Bases table', async function () {
		const notePaths = ['BasesPageUpDownEmbedNote1.md', 'BasesPageUpDownEmbedNote2.md', 'BasesPageUpDownEmbedHost.md']
		const basePath = 'BasesPageUpDownEmbedded.base'
		createdPaths.push(...notePaths, basePath)

		await browser.executeObsidian(async ({ app }, { notePaths2, basePath2, hostPath2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:page-up', [{ modifiers: [], key: 'PageUp' }])
			hm.setHotkeys('universal-cursor-hotkeys:page-down', [{ modifiers: [], key: 'PageDown' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			app.workspace.getLeavesOfType('bases').forEach(leaf => leaf.detach())
			for (const p of [...notePaths2, basePath2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(notePaths2[0], `---\nmyText: a\n---\nbody1\n`)
			await app.vault.create(notePaths2[1], `---\nmyText: b\n---\nbody2\n`)
			await app.vault.create(basePath2, `filters:\n  file.name.contains("BasesPageUpDownEmbedNote")\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - myText\n`)
			const hostFile = await app.vault.create(hostPath2, `# host\n\n![[${basePath2}]]\n`)
			await app.workspace.getLeaf(true).openFile(hostFile)
		}, { notePaths2: notePaths, basePath2: basePath, hostPath2: notePaths[2] })
		await browser.pause(1000)

		const cellEl = await browser.$('.bases-tr:nth-of-type(1) [data-property="note.myText"]')
		await cellEl.click()
		await browser.pause(200)
		await browser.keys(['Escape'])
		await browser.pause(200)
		await browser.keys(['Escape'])
		await browser.pause(200)

		await browser.executeObsidian(({ app }) => {
			const mdView = app.workspace.getLeavesOfType('markdown')[0]?.view as any
			mdView?.editor?.setCursor({ line: 0, ch: 0 })
		})

		await browser.keys(['PageDown'])
		await browser.pause(400)

		const hostCursorAfter = await browser.executeObsidian(({ app }) => {
			const mdView = app.workspace.getLeavesOfType('markdown')[0]?.view as any
			return mdView?.editor?.getCursor()
		})
		// Before the fix, this was {line: 3, ch: 0} on this same 3-line
		// host document -- scrollPage moved the host body's own cursor to
		// the end, even though real focus was visibly on the Bases table.
		await expect(hostCursorAfter).toEqual({ line: 0, ch: 0 })
	})
})
