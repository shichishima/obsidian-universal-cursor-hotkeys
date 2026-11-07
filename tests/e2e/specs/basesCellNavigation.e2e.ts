import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, Bases follow-up: a Bases table view's own "cell
// selection mode" (reached via Escape from a cell's edit mode) keeps
// real DOM focus on one shared ".bases-table-container" element for
// the whole table -- NEVER on any individual cell. Confirmed live that
// physical arrow keys move an internal "active cell" marker while this
// container stays focused throughout, and that a synthetic Arrow*
// dispatch on this SAME container reproduces it exactly (verified by
// pressing Enter afterward and checking which cell actually entered
// edit mode -- the only reliable way to observe the internal marker
// from outside, since it carries no stable, directly-queryable
// attribute).
//
// Implementation: ".bases-table-container" was added to
// PROPERTY_PANEL_FOCUS_SELECTOR (grouped alongside Properties' own
// row/heading/Add-button, since it plays the identical role -- a
// focused, non-editing "navigation mode" container Ctrl-P/N/B/F should
// delegate to a native arrow-key dispatch for). No new handler code
// was needed at all: cursor-up/down/left/right's own EXISTING generic
// native-dispatch fallback (used for Properties' row/heading/Add-button
// already) picks this target up automatically, since nothing else in
// buildPropertyRowScope's bind() calls matches it more specifically.
//
// Escape (Ctrl-G) from a Bases cell's edit mode already reaches this
// same cell-selection mode for free, via the bare-Escape pass-through
// fix shipped in the previous commit (see propertyCtrlG.e2e.ts test
// (7)) -- no separate test needed here for that half.
describe('Bases table view: Ctrl-P/N/B/F cell navigation', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function cellState() {
		return browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('bases')[0]
			const container = leaf?.view?.containerEl as HTMLElement
			const doc = container.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			const rows = Array.from(container.querySelectorAll('.bases-tr')) as HTMLElement[]
			const row = active?.closest?.('.bases-tr') as HTMLElement | null
			return {
				activeDataProperty: active?.closest?.('[data-property]')?.getAttribute('data-property') ?? null,
				rowIndex: row ? rows.indexOf(row) : -1,
			}
		})
	}

	it('Ctrl-F/N/B/P move the active cell one column/row at a time, confirmed via Enter', async function () {
		const notePaths = ['BasesCellNavNote1.md', 'BasesCellNavNote2.md']
		const basePath = 'BasesCellNav.base'
		createdPaths.push(...notePaths, basePath)

		await browser.executeObsidian(async ({ app }, { notePaths2, basePath2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-left', [{ modifiers: ['Ctrl'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			app.workspace.getLeavesOfType('bases').forEach(leaf => leaf.detach())
			for (const p of [...notePaths2, basePath2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(notePaths2[0], `---\nmyText: a\nmyNumber: 1\n---\nbody1\n`)
			await app.vault.create(notePaths2[1], `---\nmyText: b\nmyNumber: 2\n---\nbody2\n`)
			// Filtered to just these 2 notes -- without this, the view
			// shows every file in the vault, and row indices become
			// unreliable to reason about in a shared test vault.
			const baseFile = await app.vault.create(basePath2, `filters:\n  file.name.contains("BasesCellNavNote")\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - myText\n      - myNumber\n`)
			await app.workspace.getLeaf(true).openFile(baseFile)
		}, { notePaths2: notePaths, basePath2: basePath })
		await browser.pause(800)

		const cellEl = await browser.$('.bases-tr:nth-of-type(1) [data-property="note.myText"]')
		await cellEl.click()
		await browser.pause(200)
		const start = await cellState()
		await expect(start.activeDataProperty).toBe('note.myText')

		await browser.keys(['Escape']) // -> cell-selection mode
		await browser.pause(200)

		await browser.keys(['Control', 'f']) // right: myText -> myNumber, same row
		await browser.pause(200)
		await browser.keys(['Control', 'n']) // down: one row
		await browser.pause(200)
		await browser.keys(['Enter'])
		await browser.pause(300)
		const afterForward = await cellState()
		await expect(afterForward.activeDataProperty).toBe('note.myNumber')
		await expect(afterForward.rowIndex).toBe(start.rowIndex + 1)

		await browser.keys(['Escape']) // back to cell-selection mode
		await browser.pause(200)
		await browser.keys(['Control', 'b']) // left: myNumber -> myText, same row
		await browser.pause(200)
		await browser.keys(['Control', 'p']) // up: one row
		await browser.pause(200)
		await browser.keys(['Enter'])
		await browser.pause(300)
		const afterBack = await cellState()
		await expect(afterBack.activeDataProperty).toBe('note.myText')
		await expect(afterBack.rowIndex).toBe(start.rowIndex) // exactly reversed
	})
})
