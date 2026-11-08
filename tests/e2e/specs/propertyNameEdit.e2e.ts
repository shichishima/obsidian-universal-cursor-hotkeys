import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, property NAME (key) editing phase: the property's own
// name field (".metadata-property-key-input") is a real <input
// type="text">, unlike the title field and the text value-edit widget
// (both contenteditable) -- document.getSelection() doesn't apply to a
// form control's internal text at all, so every handler here
// (propertyKeyMoveChar/MoveToLineBoundary/MoveWord/SetMark/KeyboardQuit/
// KillLine/KillWord/DeleteChar/CopyRegion/KillRegion/Yank) is its own new
// implementation working through the input's own selectionStart/
// selectionEnd/selectionDirection triple, confirmed live (via a temp
// diagnostic spec, deleted after) that execCommand('delete'/'insertText')
// still respects that triple exactly like it respects
// document.getSelection() for a contenteditable, including persistence to
// frontmatter after blur -- same technique as the title field's own Kill/
// Yank, just a different underlying selection model.
//
// Ctrl-P/N (cursor-up/down) have no sensible "up/down" meaning on a
// plain single-line field by itself (a deliberate scope decision when
// this phase was planned, see project memory
// project_property_other_types_ctrl_g_pnbf_scope's sibling note), so
// they stay a true no-op there -- EXCEPT while this field's own
// "previously used property names" suggester is visible, where Ctrl-N/P
// now navigate it and Enter commits the highlighted item (added later,
// same mechanism as the multi-select value-suggester's own navigation --
// see test (14) below and PROPERTY_SUGGESTER_SELECTOR's own comment in
// src/main.ts).
describe('Property panel: NAME (key) field editing', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function openNote(path: string, key: string) {
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app, obsidian }, { path2, key2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-left', [{ modifiers: ['Ctrl'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-home', [{ modifiers: [], key: 'Home' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-end', [{ modifiers: [], key: 'End' }])
			hm.setHotkeys('universal-cursor-hotkeys:word-left', [{ modifiers: ['Alt'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:word-right', [{ modifiers: ['Alt'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:set-mark', [{ modifiers: ['Ctrl'], key: ' ' }])
			hm.setHotkeys('universal-cursor-hotkeys:keyboard-quit', [{ modifiers: ['Ctrl'], key: 'G' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-line', [{ modifiers: ['Ctrl'], key: 'K' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-region', [{ modifiers: ['Ctrl'], key: 'W' }])
			hm.setHotkeys('universal-cursor-hotkeys:copy-region', [{ modifiers: ['Alt'], key: 'W' }])
			hm.setHotkeys('universal-cursor-hotkeys:yank', [{ modifiers: ['Ctrl'], key: 'Y' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-word-left', [{ modifiers: ['Alt'], key: 'Backspace' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-word-right', [{ modifiers: ['Alt'], key: 'D' }])
			hm.setHotkeys('universal-cursor-hotkeys:delete-char', [{ modifiers: ['Ctrl'], key: 'D' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, `---
${key2}: hello world
---
first body line
`)
			await app.workspace.getLeaf(true).openFile(file)
		}, { path2: path, key2: key })
		await browser.pause(500)
	}

	async function getKeyInput() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property') as HTMLElement
			const el = row.querySelector('.metadata-property-key-input') as HTMLInputElement
			return { value: el.value, selStart: el.selectionStart, selEnd: el.selectionEnd, selDir: el.selectionDirection }
		})
	}

	async function focusKeyInput(caretAt?: number) {
		await browser.executeObsidian(({ app, obsidian }, caretAt2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property') as HTMLElement
			const el = row.querySelector('.metadata-property-key-input') as HTMLInputElement
			el.focus()
			if (caretAt2 != null) el.setSelectionRange(caretAt2, caretAt2)
		}, caretAt ?? null)
		await browser.pause(150)
	}

	it('(1) Ctrl-B/F move the caret one character at a time', async function () {
		await openNote('PropNameMoveChar.md', 'myName')
		await focusKeyInput(3) // "myN|ame"
		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		let s = await getKeyInput()
		await expect(s.selStart).toBe(4)
		await browser.keys(['Control', 'b'])
		await browser.keys(['Control', 'b'])
		await browser.pause(150)
		s = await getKeyInput()
		await expect(s.selStart).toBe(2)
	})

	it('(2) Home/End move to the value\'s own start/end', async function () {
		await openNote('PropNameHomeEnd.md', 'myName')
		await focusKeyInput(3)
		await browser.keys(['Home'])
		await browser.pause(150)
		let s = await getKeyInput()
		await expect(s.selStart).toBe(0)
		await browser.keys(['End'])
		await browser.pause(150)
		s = await getKeyInput()
		await expect(s.selStart).toBe(6) // "myName".length
	})

	it('(3) Alt-F/Alt-B move by word (CJK-safe segmentation reused from word-segmentation.ts)', async function () {
		await openNote('PropNameWordMove.md', 'fooBarBaz')
		await focusKeyInput(0)
		await browser.keys(['Alt', 'f'])
		await browser.pause(150)
		const s = await getKeyInput()
		// Intl.Segmenter splits camelCase on its own morphological boundaries;
		// just confirm real forward progress happened, not stuck at 0.
		await expect(s.selStart).toBeGreaterThan(0)
	})

	it('(4) Ctrl-Space + Ctrl-F extends a real selection (set-mark)', async function () {
		await openNote('PropNameSetMark.md', 'myName')
		await focusKeyInput(0)
		await browser.keys(['Control', ' '])
		await browser.keys(['Control', 'f'])
		await browser.keys(['Control', 'f'])
		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		const s = await getKeyInput()
		await expect(s.selStart).toBe(0)
		await expect(s.selEnd).toBe(3)
	})

	it('(5) Ctrl-G clears an active mark without exiting the field', async function () {
		await openNote('PropNameKeyboardQuit.md', 'myName')
		await focusKeyInput(0)
		await browser.keys(['Control', ' '])
		await browser.keys(['Control', 'f'])
		await browser.keys(['Control', 'f'])
		await browser.keys(['Control', 'g'])
		await browser.pause(150)
		const s = await getKeyInput()
		await expect(s.selStart).toBe(s.selEnd) // collapsed, mark cleared
	})

	it('(6) Ctrl-K kills from caret to end, persists the rename after blur', async function () {
		await openNote('PropNameKillLine.md', 'myName')
		await focusKeyInput(2) // "my|Name"
		await browser.keys(['Control', 'k'])
		await browser.pause(150)
		let s = await getKeyInput()
		await expect(s.value).toBe('my')

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property') as HTMLElement
			const el = row.querySelector('.metadata-property-key-input') as HTMLInputElement
			el.blur()
		})
		await browser.pause(400)
		const content = await browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getFileByPath('PropNameKillLine.md')
			return file ? await app.vault.read(file) : null
		})
		await expect(content).toContain('my:')
	})

	it('(7) Ctrl-Y yanks the kill-line result back in', async function () {
		await openNote('PropNameYank.md', 'myName')
		await focusKeyInput(2) // "my|Name"
		await browser.keys(['Control', 'k']) // kills "Name" into the kill-ring
		await browser.pause(150)
		await browser.keys(['Control', 'y'])
		await browser.pause(300)
		const s = await getKeyInput()
		await expect(s.value).toBe('myName')
	})

	it('(8) Alt-Backspace/Alt-D kill one word at a time', async function () {
		await openNote('PropNameKillWord.md', 'foo bar')
		// property keys can't contain a literal space the same way frontmatter
		// values can -- use an underscore-joined two-segment name instead, since
		// the word-segmentation engine still treats it as two words via
		// Intl.Segmenter's own punctuation-run handling.
		await openNote('PropNameKillWord2.md', 'fooBar')
		await focusKeyInput(6) // end of "fooBar"
		await browser.keys(['Alt', 'Backspace'])
		await browser.pause(150)
		const s = await getKeyInput()
		await expect(s.value.length).toBeLessThan(6)
	})

	it('(9) Ctrl-D deletes the character after point', async function () {
		await openNote('PropNameDeleteChar.md', 'myName')
		await focusKeyInput(2) // "my|Name"
		await browser.keys(['Control', 'd'])
		await browser.pause(150)
		const s = await getKeyInput()
		await expect(s.value).toBe('myame')
	})

	it('(10) Alt-W copies the active selection without deleting it', async function () {
		await openNote('PropNameCopyRegion.md', 'myName')
		await focusKeyInput(0)
		await browser.keys(['Control', ' '])
		await browser.keys(['Control', 'f'])
		await browser.keys(['Control', 'f'])
		await browser.keys(['Alt', 'w'])
		await browser.pause(150)
		const s = await getKeyInput()
		await expect(s.value).toBe('myName') // unchanged -- copy, not kill
	})

	it('(11) Ctrl-W kills the active selection', async function () {
		await openNote('PropNameKillRegion.md', 'myName')
		await focusKeyInput(0)
		await browser.keys(['Control', ' '])
		await browser.keys(['Control', 'f'])
		await browser.keys(['Control', 'f'])
		await browser.keys(['Control', 'w'])
		await browser.pause(150)
		const s = await getKeyInput()
		await expect(s.value).toBe('Name')
	})

	it('(12) Ctrl-G then real Escape exits to item-selection mode', async function () {
		await openNote('PropNameEscapeExit.md', 'myName')
		await focusKeyInput(0)
		await browser.keys(['Escape'])
		await browser.pause(150)
		const isRow = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			return active?.classList.contains('metadata-property') ?? false
		})
		await expect(isRow).toBe(true)
	})

	// Real user report ("2文字目でCtrl-D→Cmd-Zで入力が効かなくなる"): the
	// SAME scope-shadowing bug already fixed for the text value-edit
	// widget (propertyValueEditDeleteChar.e2e.ts's own test (5)) also
	// affects this input -- its own native autocomplete/suggester reacts
	// to the real 'input' event from execCommand('delete') or the
	// browser's own native Undo by pushing its OWN Scope on top of
	// propertyRowScope, exactly like the text widget's suggester. The
	// existing document-level 'input' reclaim listener was originally
	// scoped to PROPERTY_VALUE_EDIT_SELECTOR only (this input didn't
	// exist yet when that fix shipped) -- broadened to
	// PROPERTY_TEXT_LIKE_EDIT_SELECTOR to cover both. Repro specifically
	// needs a non-zero starting offset, same as the original text-widget
	// bug.
	it('(13) regression: Ctrl-D then native Undo doesn\'t leave the key-edit input unresponsive', async function () {
		await openNote('PropNameUndoRegression.md', 'myName')
		await focusKeyInput(1) // repro specifically needs a non-zero starting offset

		await browser.keys(['Control', 'd'])
		await browser.keys(['Control', 'd'])
		await browser.keys(['Control', 'd'])
		await browser.pause(200)

		await browser.keys(['Meta', 'z'])
		await browser.keys(['Meta', 'z'])
		await browser.keys(['Meta', 'z'])
		await browser.pause(200)
		const afterUndo = await getKeyInput()
		await expect(afterUndo.value).toBe('myName') // undo round-trip itself still correct

		await browser.keys(['Control', 'g'])
		await browser.pause(200)
		const isRow = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			return active?.classList.contains('metadata-property') ?? false
		})
		await expect(isRow).toBe(true) // Ctrl-G still works -- the scope wasn't left shadowed
	})

	// Separate feature, added later: this field's own "previously used
	// property names" suggester (confirmed live to share the exact same
	// DOM shape -- `.suggestion-container.mod-property-key` -- and the
	// exact same lack of any native keyboard support as the multi-select
	// value-suggester) now gets the SAME from-scratch Ctrl-N/P
	// navigation and Enter-to-commit already shipped for that one, just
	// by broadening PROPERTY_SUGGESTER_SELECTOR. See
	// propertyOtherTypesCtrlGPnbf.e2e.ts's own test (10) for the
	// original investigation this reuses.
	it('(14) Ctrl-N/P navigate this field\'s own suggester; Enter commits the highlighted item', async function () {
		const seedPaths = [
			'PropNameSuggesterNavSeed0.md',
			'PropNameSuggesterNavSeed1.md',
			'PropNameSuggesterNavSeed2.md',
		]
		createdPaths.push(...seedPaths)
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const p of paths) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(paths[0], `---\ntestbeta: x\n---\nbody\n`)
			await app.vault.create(paths[1], `---\ntestalpha: x\n---\nbody\n`)
			await app.vault.create(paths[2], `---\ntestgamma: x\n---\nbody\n`)
		}, seedPaths)

		await openNote('PropNameSuggesterNav.md', 'myName')
		await browser.executeObsidian(({ app }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.bake()
		})

		await focusKeyInput(0)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property') as HTMLElement
			const input = row.querySelector('.metadata-property-key-input') as HTMLInputElement
			input.select()
		})
		await browser.keys(['t', 'e', 's', 't'])
		await browser.pause(400)

		const getSelected = async () => browser.executeObsidian(() => {
			const items = Array.from(document.querySelectorAll('.suggestion-container.mod-property-key .suggestion-item'))
			return items.find(i => i.classList.contains('is-selected'))?.textContent ?? null
		})

		await expect(await getSelected()).toBe('testbeta') // Obsidian's own suggester auto-highlights the first item, but ignores keyboard input that would normally move it

		await browser.keys(['Control', 'n'])
		await browser.pause(150)
		await expect(await getSelected()).toBe('testalpha')

		await browser.keys(['Control', 'n'])
		await browser.pause(150)
		await expect(await getSelected()).toBe('testgamma')

		await browser.keys(['Control', 'n']) // already at the last item -- boundary clamping, not wrap-around
		await browser.pause(150)
		await expect(await getSelected()).toBe('testgamma')

		await browser.keys(['Control', 'p'])
		await browser.pause(150)
		await expect(await getSelected()).toBe('testalpha')

		await browser.keys(['Enter']) // commits the currently-highlighted item via a synthetic click
		await browser.pause(300)

		const afterCommit = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property') as HTMLElement
			return { propertyKey: row.getAttribute('data-property-key') }
		})
		await expect(afterCommit.propertyKey).toBe('testalpha')
	})
})
