import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, Bases re-verification: a Bases table view's own
// per-cell value widgets reuse the EXACT same DOM classes as the
// single-note Properties panel (confirmed live via a DOM survey, since
// deleted) -- .metadata-input-longtext for text, input[type=checkbox/
// date/number] for those types, .multi-select-input for list/tags/
// aliases. Every command bound in buildPropertyRowScope matches on
// these LEAF element classes directly, with no dependency on the
// Properties panel's own .metadata-property row wrapper existing at
// all -- so none of this needed new code, confirmed by this spec
// exercising real commands end-to-end, not just checking DOM classes
// match.
//
// NOT covered, confirmed by the same DOM survey: a Bases column's own
// header (the property NAME) is a plain, non-editable
// ".bases-table-header-name" div -- nothing like
// ".metadata-property-key-input". Bases renames a column through its
// own menu-based UI, not an inline text input -- the property
// NAME-editing phase's commands genuinely don't apply here, not a gap
// to fix.
describe('Bases table view: property-text-editing command parity', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function openBase(notePath: string, basePath: string, frontmatter: string, order: string[]) {
		createdPaths.push(notePath, basePath)
		await browser.executeObsidian(async ({ app }, { notePath2, basePath2, frontmatter2, order2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-left', [{ modifiers: ['Ctrl'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-home', [{ modifiers: ['Ctrl'], key: 'A' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-end', [{ modifiers: ['Ctrl'], key: 'E' }])
			hm.setHotkeys('universal-cursor-hotkeys:keyboard-quit', [{ modifiers: ['Ctrl'], key: 'G' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-line', [{ modifiers: ['Ctrl'], key: 'K' }])
			hm.setHotkeys('universal-cursor-hotkeys:yank', [{ modifiers: ['Ctrl'], key: 'Y' }])
			hm.setHotkeys('universal-cursor-hotkeys:delete-char', [{ modifiers: ['Ctrl'], key: 'D' }])
			hm.setHotkeys('universal-cursor-hotkeys:set-mark', [{ modifiers: ['Ctrl'], key: ' ' }])
			hm.setHotkeys('universal-cursor-hotkeys:copy-region', [{ modifiers: ['Alt'], key: 'W' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			app.workspace.getLeavesOfType('bases').forEach(leaf => leaf.detach())
			for (const p of [notePath2, basePath2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(notePath2, frontmatter2)
			const baseContent = `views:\n  - type: table\n    name: Table\n    order:\n${order2.map(o => `      - ${o}`).join('\n')}\n`
			const baseFile = await app.vault.create(basePath2, baseContent)
			await app.workspace.getLeaf(true).openFile(baseFile)
		}, { notePath2: notePath, basePath2: basePath, frontmatter2: frontmatter, order2: order })
		await browser.pause(800)
	}

	async function focusCell(noteStem: string, dataProperty: string) {
		await browser.executeObsidian(({ app }, { noteStem2, prop }) => {
			const leaf = app.workspace.getLeavesOfType('bases')[0]
			const container = leaf?.view?.containerEl as HTMLElement
			const rows = Array.from(container.querySelectorAll('.bases-tr')) as HTMLElement[]
			const myRow = rows.find(r => r.textContent?.includes(noteStem2))
			const cell = myRow?.querySelector(`[data-property="${prop}"]`) as HTMLElement
			const widget = cell?.querySelector('.metadata-input-longtext, input') as HTMLElement
			widget?.focus()
		}, { noteStem2: noteStem, prop: dataProperty })
		await browser.pause(150)
	}

	async function getCellState(noteStem: string, dataProperty: string) {
		return browser.executeObsidian(({ app }, { noteStem2, prop }) => {
			const leaf = app.workspace.getLeavesOfType('bases')[0]
			const container = leaf?.view?.containerEl as HTMLElement
			const rows = Array.from(container.querySelectorAll('.bases-tr')) as HTMLElement[]
			const myRow = rows.find(r => r.textContent?.includes(noteStem2))
			const cell = myRow?.querySelector(`[data-property="${prop}"]`) as HTMLElement
			const widget = cell?.querySelector('.metadata-input-longtext, input') as HTMLElement
			const doc = container.ownerDocument
			return {
				text: widget?.textContent ?? (widget as HTMLInputElement)?.value,
				isActive: doc.activeElement === widget,
			}
		}, { noteStem2: noteStem, prop: dataProperty })
	}

	it('(1) Ctrl-A/F/D move the cursor and delete a character in a text cell', async function () {
		await openBase('BasesTextCmd.md', 'BasesTextCmd.base', `---\nmyText: hello world\n---\nbody\n`, ['file.name', 'myText'])
		await focusCell('BasesTextCmd', 'note.myText')
		await browser.keys(['Control', 'a'])
		await browser.keys(['Control', 'f'])
		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		await browser.keys(['Control', 'd'])
		await browser.pause(150)
		const after = await getCellState('BasesTextCmd', 'note.myText')
		await expect(after.text).toBe('helo world')
	})

	it('(2) Ctrl-K then Ctrl-Y round-trips a text cell\'s whole value', async function () {
		await openBase('BasesKillYank.md', 'BasesKillYank.base', `---\nmyText: hello world\n---\nbody\n`, ['file.name', 'myText'])
		await focusCell('BasesKillYank', 'note.myText')
		await browser.keys(['Control', 'a'])
		await browser.pause(100)
		await browser.keys(['Control', 'k'])
		await browser.pause(150)
		const afterKill = await getCellState('BasesKillYank', 'note.myText')
		await expect(afterKill.text?.trim()).toBe('')
		await browser.keys(['Control', 'y'])
		await browser.pause(300)
		const afterYank = await getCellState('BasesKillYank', 'note.myText')
		await expect(afterYank.text).toBe('hello world')
	})

	it('(3) Ctrl-G exits a text/checkbox/date cell without error', async function () {
		await openBase(
			'BasesCtrlG.md', 'BasesCtrlG.base',
			`---\nmyText: hello\nmyCheckbox: true\nmyDate: 2026-01-15\n---\nbody\n`,
			['file.name', 'myText', 'myCheckbox', 'myDate'],
		)
		for (const prop of ['note.myText', 'note.myCheckbox', 'note.myDate']) {
			await focusCell('BasesCtrlG', prop)
			await browser.keys(['Control', 'g'])
			await browser.pause(150)
			const after = await getCellState('BasesCtrlG', prop)
			await expect(after.isActive).toBe(false)
		}
	})

	it('(4) regression: Ctrl-D then native Undo doesn\'t leave a Bases text cell unresponsive', async function () {
		await openBase('BasesUndoRegression.md', 'BasesUndoRegression.base', `---\nmyText: hello world\n---\nbody\n`, ['file.name', 'myText'])
		await focusCell('BasesUndoRegression', 'note.myText')
		await browser.keys(['Control', 'f'])
		await browser.pause(100)
		await browser.keys(['Control', 'd'])
		await browser.pause(150)
		await browser.keys(['Meta', 'z'])
		await browser.pause(300)
		const afterUndo = await getCellState('BasesUndoRegression', 'note.myText')
		await expect(afterUndo.text).toBe('hello world') // undo round-trip itself still correct

		await browser.keys(['Control', 'g'])
		await browser.pause(200)
		const afterQuit = await getCellState('BasesUndoRegression', 'note.myText')
		await expect(afterQuit.isActive).toBe(false) // Ctrl-G still works -- the scope wasn't left shadowed
	})

	it('(5) Ctrl-F moves the caret in a list (multitext) cell\'s trailing chip', async function () {
		await openBase('BasesListMove.md', 'BasesListMove.base', `---\nmyList:\n  - item1\n---\nbody\n`, ['file.name', 'myList'])
		await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('bases')[0]
			const container = leaf?.view?.containerEl as HTMLElement
			const rows = Array.from(container.querySelectorAll('.bases-tr')) as HTMLElement[]
			const myRow = rows.find(r => r.textContent?.includes('BasesListMove'))
			const cell = myRow?.querySelector('[data-property="note.myList"]') as HTMLElement
			const input = cell?.querySelector('.multi-select-input') as HTMLElement
			input.focus()
			input.textContent = 'hello'
			const sel = input.ownerDocument.getSelection()!
			const range = input.ownerDocument.createRange()
			range.setStart(input.firstChild!, 0)
			range.collapse(true)
			sel.removeAllRanges()
			sel.addRange(range)
		})
		await browser.pause(150)
		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		const focusOffset = await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('bases')[0]
			const container = leaf?.view?.containerEl as HTMLElement
			return container.ownerDocument.getSelection()!.focusOffset
		})
		await expect(focusOffset).toBe(1)
	})

	it('(6) a column header (property name) is NOT an editable input -- confirms this phase\'s scope boundary', async function () {
		await openBase('BasesHeaderCheck.md', 'BasesHeaderCheck.base', `---\nmyText: hello\n---\nbody\n`, ['file.name', 'myText'])
		const headerInfo = await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('bases')[0]
			const container = leaf?.view?.containerEl as HTMLElement
			const headers = Array.from(container.querySelectorAll('.bases-table-header-name')) as HTMLElement[]
			const myTextHeader = headers.find(h => h.textContent === 'myText')
			return {
				found: !!myTextHeader,
				isContentEditable: myTextHeader?.isContentEditable ?? null,
				tagName: myTextHeader?.tagName ?? null,
			}
		})
		await expect(headerInfo.found).toBe(true)
		await expect(headerInfo.isContentEditable).toBe(false)
		await expect(headerInfo.tagName).toBe('DIV')
	})

	// Alt-W (Copy region) in a Bases text cell reuses titleCopyRegion
	// exactly like the Properties panel's own text-like value widget does
	// (same DOM class, same code path) -- so the same collapse-after-copy
	// fix applies here for free. See copyRegionSelectionCollapse.e2e.ts
	// for the equivalent outer/table-cell coverage.
	it('(7) Alt-W (Copy region) copies a text cell\'s selection without mutating it, and collapses the selection', async function () {
		await openBase('BasesCopyRegion.md', 'BasesCopyRegion.base', `---\nmyText: hello world\n---\nbody\n`, ['file.name', 'myText'])
		await focusCell('BasesCopyRegion', 'note.myText')

		await browser.keys(['Control', 'a']) // -> start
		await browser.keys(['Control', ' ']) // set-mark
		await browser.keys(['Control', 'f'])
		await browser.keys(['Control', 'f'])
		await browser.keys(['Control', 'f'])
		await browser.keys(['Control', 'f'])
		await browser.keys(['Control', 'f']) // selects "hello"
		await browser.pause(150)

		await browser.keys(['Alt', 'w'])
		await browser.pause(150)

		const after = await getCellState('BasesCopyRegion', 'note.myText')
		await expect(after.text).toBe('hello world') // unchanged -- copy, not kill

		const selectedText = await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('bases')[0]
			const container = leaf?.view?.containerEl as HTMLElement
			return container.ownerDocument.getSelection()!.toString()
		})
		await expect(selectedText).toBe('') // collapses after copying, same as the body's own Copy region

		const killCache = await browser.executeObsidian(({ app }) => (app as any).plugins.plugins['universal-cursor-hotkeys'].killCache)
		await expect(killCache).toBe('hello')
	})
})
