import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// In the title field, Cmd-Z (native undo) restores text but this
// plugin's own Undo command (Ctrl-/ recommended hotkey) does nothing.
// Root cause: 'undo'/'redo' were the only two editing commands
// still using editorCallback (always calling editor.undo()/redo() on the
// BODY's own CM6 Editor instance, regardless of where focus actually is)
// -- every other editing command (Kill line, Delete char, etc.) was
// already ported to checkCallback with a title/property branch for
// 0.13.0, but Undo/Redo were missed. Fixed by giving them the same
// checkCallback shape as Delete char, dispatching to a new titleUndo()
// helper that calls el.ownerDocument.execCommand('undo'/'redo', false)
// instead -- the same execCommand-based technique titleDeleteChar/
// propertyKeyDeleteChar already use to stay integrated with each
// widget's own native (non-CM6) undo stack.
//
// This spec exercises the actual 'undo'/'redo' COMMANDS (via their own
// hotkey, real KeyboardEvent dispatch) across all four non-CM6-Editor
// surfaces this plugin edits text in, to confirm execCommand('undo'/
// 'redo') actually round-trips for each one -- titleDeleteChar.e2e.ts's
// own test (4) already proved this for the title specifically (using a
// raw execCommand('undo') call, not this plugin's own command), but the
// property-value/property-name/Bases cases were never confirmed this way
// before, and property-name in particular is a plain <input> rather than
// a contenteditable, a meaningfully different browser undo-manager path.
describe('Undo / Redo commands on non-CM6 text surfaces (title / frontmatter / Bases)', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function setHotkeys() {
		await browser.executeObsidian(({ app }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:delete-char', [{ modifiers: ['Ctrl'], key: 'D' }])
			hm.setHotkeys('universal-cursor-hotkeys:undo', [{ modifiers: ['Ctrl'], key: '/' }])
			hm.setHotkeys('universal-cursor-hotkeys:redo', [{ modifiers: ['Ctrl', 'Shift'], key: '/' }])
			hm.bake()
		})
	}

	async function pressOnActiveElement(key: string, opts: { ctrlKey?: boolean, shiftKey?: boolean } = {}) {
		await browser.executeObsidian(({ app, obsidian }, { key2, opts2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement
			active.dispatchEvent(new KeyboardEvent('keydown', { key: key2, ctrlKey: opts2.ctrlKey, shiftKey: opts2.shiftKey, bubbles: true, cancelable: true }))
		}, { key2: key, opts2: opts })
		await browser.pause(150)
	}

	async function pressCtrlD() { await pressOnActiveElement('d', { ctrlKey: true }) }
	async function pressUndo() { await pressOnActiveElement('/', { ctrlKey: true }) }
	async function pressRedo() { await pressOnActiveElement('/', { ctrlKey: true, shiftKey: true }) }

	it('(1) title field: Ctrl-/ undoes a Ctrl-D delete, Ctrl-Shift-/ redoes it', async function () {
		const path = 'UndoRedo Title.md'
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app, obsidian }, path2) => {
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, 'body text')
			await app.workspace.getLeaf(true).openFile(file)
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const title = doc.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.focus()
			const textNode = title.firstChild as Text
			const range = doc.createRange()
			range.setStart(textNode, 6) // "UndoRe" | "do Title"
			range.collapse(true)
			const sel = doc.getSelection()!
			sel.removeAllRanges()
			sel.addRange(range)
		}, path)
		await setHotkeys()
		await browser.waitUntil(async () => {
			return browser.executeObsidian(({ app }) => {
				return (app as any).plugins.plugins['universal-cursor-hotkeys'].titleScope !== null
			})
		}, { timeout: 8000, interval: 50, timeoutMsg: 'title Scope never pushed' })

		async function getTitleText() {
			return browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
				return title.textContent
			})
		}

		await pressCtrlD() // deletes the "d" right after "UndoRe"
		await expect(await getTitleText()).toBe('UndoReo Title')
		await pressUndo()
		await expect(await getTitleText()).toBe('UndoRedo Title')
		await pressRedo()
		await expect(await getTitleText()).toBe('UndoReo Title')
	})

	it('(2) frontmatter property value (text): Ctrl-/ undoes a Ctrl-D delete', async function () {
		const path = 'UndoRedo PropertyValue.md'
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app }, path2) => {
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, `---
myText: hello world
---
first body line
`)
			await app.workspace.getLeaf(true).openFile(file)
		}, path)
		await setHotkeys()
		await browser.pause(400)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const value = row.querySelector('.metadata-input-longtext') as HTMLElement
			value.focus()
			const sel = value.ownerDocument.getSelection()!
			const textNode = value.firstChild!
			const range = value.ownerDocument.createRange()
			range.setStart(textNode, 1)
			range.collapse(true)
			sel.removeAllRanges()
			sel.addRange(range)
		})
		await browser.pause(150)

		async function snapValue() {
			return browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
				const value = row.querySelector('.metadata-input-longtext') as HTMLElement
				return value.textContent
			})
		}

		await pressCtrlD() // deletes "e" right after "h"
		await expect(await snapValue()).toBe('hllo world')
		await pressUndo()
		await expect(await snapValue()).toBe('hello world')
	})

	it('(3) frontmatter property name (key input): Ctrl-/ undoes a Ctrl-D delete', async function () {
		const path = 'UndoRedo PropertyName.md'
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app }, path2) => {
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, `---
myName: hello world
---
first body line
`)
			await app.workspace.getLeaf(true).openFile(file)
		}, path)
		await setHotkeys()
		await browser.pause(400)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property') as HTMLElement
			const el = row.querySelector('.metadata-property-key-input') as HTMLInputElement
			el.focus()
			el.setSelectionRange(1, 1)
		})
		await browser.pause(150)

		async function snapKey() {
			return browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const row = view.containerEl.querySelector('.metadata-property') as HTMLElement
				const el = row.querySelector('.metadata-property-key-input') as HTMLInputElement
				return el.value
			})
		}

		await pressCtrlD() // deletes "y" right after "m"
		await expect(await snapKey()).toBe('mName')
		await pressUndo()
		await expect(await snapKey()).toBe('myName')
	})

	it('(4) Bases table cell (text): Ctrl-/ undoes a Ctrl-D delete', async function () {
		const notePath = 'UndoRedo BasesNote.md'
		const basePath = 'UndoRedo Bases.base'
		createdPaths.push(notePath, basePath)
		await browser.executeObsidian(async ({ app }, { notePath2, basePath2 }) => {
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			app.workspace.getLeavesOfType('bases').forEach(leaf => leaf.detach())
			for (const p of [notePath2, basePath2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(notePath2, `---\nmyText: hello world\n---\nbody\n`)
			const baseContent = `filters:\n  file.name.contains("UndoRedo BasesNote")\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - myText\n`
			const baseFile = await app.vault.create(basePath2, baseContent)
			await app.workspace.getLeaf(true).openFile(baseFile)
		}, { notePath2: notePath, basePath2: basePath })
		await setHotkeys()
		await browser.pause(800)
		await browser.executeObsidian(({ app }, noteStem) => {
			const leaf = app.workspace.getLeavesOfType('bases')[0]
			const container = leaf?.view?.containerEl as HTMLElement
			const rows = Array.from(container.querySelectorAll('.bases-tr')) as HTMLElement[]
			const myRow = rows.find(r => r.textContent?.includes(noteStem))
			const cell = myRow?.querySelector('[data-property="note.myText"]') as HTMLElement
			const widget = cell?.querySelector('.metadata-input-longtext') as HTMLElement
			widget?.focus()
			const sel = widget.ownerDocument.getSelection()!
			const textNode = widget.firstChild!
			const range = widget.ownerDocument.createRange()
			range.setStart(textNode, 1)
			range.collapse(true)
			sel.removeAllRanges()
			sel.addRange(range)
		}, 'UndoRedo BasesNote')
		await browser.pause(150)

		async function snapCell() {
			return browser.executeObsidian(({ app }, noteStem) => {
				const leaf = app.workspace.getLeavesOfType('bases')[0]
				const container = leaf?.view?.containerEl as HTMLElement
				const rows = Array.from(container.querySelectorAll('.bases-tr')) as HTMLElement[]
				const myRow = rows.find(r => r.textContent?.includes(noteStem))
				const cell = myRow?.querySelector('[data-property="note.myText"]') as HTMLElement
				const widget = cell?.querySelector('.metadata-input-longtext') as HTMLElement
				return widget?.textContent
			}, 'UndoRedo BasesNote')
		}

		// Bases renders in its own 'bases' leaf type, not a MarkdownView, so
		// the shared pressCtrlD/pressUndo helpers (which look up the active
		// MarkdownView) don't apply here -- real browser.keys() dispatch
		// goes to whatever actually has DOM focus regardless of leaf type,
		// same technique basesPropertyEditing.e2e.ts already uses.
		await browser.keys(['Control', 'd']) // deletes "e" right after "h"
		await browser.pause(150)
		await expect(await snapCell()).toBe('hllo world')
		await browser.keys(['Control', '/'])
		await browser.pause(150)
		await expect(await snapCell()).toBe('hello world')
	})

	// Regression coverage for the fallthrough branch itself: no existing
	// spec exercised the 'undo'/'redo' commands' plain-body behavior even
	// before this fix (vimTableUndoRedo.e2e.ts/undoInCellVLStale.e2e.ts
	// both cover native/Vim undo, not this plugin's own command) --
	// confirms the checkCallback conversion didn't change ordinary,
	// outside-title-and-frontmatter behavior at all.
	it('(5) regression: plain note body still falls through to editor.undo()/redo()', async function () {
		const path = 'UndoRedo PlainBody.md'
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app, obsidian }, path2) => {
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, 'hello world')
			await app.workspace.getLeaf(true).openFile(file)
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: 0, ch: 5 }) // "hello" | " world"
		}, path)
		await browser.pause(300)

		async function getBody() {
			return browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				return view.editor.getValue()
			})
		}

		await browser.executeObsidianCommand('universal-cursor-hotkeys:delete-char') // deletes the space
		await browser.pause(150)
		await expect(await getBody()).toBe('helloworld')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:undo')
		await browser.pause(150)
		await expect(await getBody()).toBe('hello world')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:redo')
		await browser.pause(150)
		await expect(await getBody()).toBe('helloworld')
	})
})
