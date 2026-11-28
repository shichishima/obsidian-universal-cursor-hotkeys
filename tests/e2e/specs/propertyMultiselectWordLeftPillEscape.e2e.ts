import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// Regression coverage for a confirmed real gap found while documenting
// Word left/right's own title/Properties/Bases coverage: a real
// physical Option-Left at the multi-select trailing input's own EMPTY
// start already escapes to the preceding pill (confirmed live,
// matching plain ArrowLeft's own already-handled escape in
// propertyMoveCharOrNoop) -- titleMoveWord's own Selection.modify
// ('word') can't cross that sibling DOM boundary on its own, the same
// limitation plain Selection.modify('character') had before
// propertyMoveCharOrNoop's own isSelectionAtStartOf fix. Word right
// has no equivalent case -- the trailing input is always the list's
// last element, nothing follows it to escape into either way.
describe('Word left escapes from the composing input\'s own empty start to the preceding pill', function () {
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
		await browser.executeObsidian(async ({ app }, { path2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:word-left', [{ modifiers: ['Ctrl', 'Shift'], key: 'L' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, '---\nmylist:\n  - itemOne\n  - itemTwo\n---\nbody\n')
			await app.workspace.getLeaf(true).openFile(file)
		}, { path2: path })
		await browser.pause(400)
	}

	async function dismissSuggesterIfOpen() {
		const hasSuggester = await browser.executeObsidian(() => !!document.querySelector('.suggestion-container.mod-property-value .suggestion-item'))
		if (hasSuggester) {
			await browser.keys(['Escape'])
			await browser.pause(200)
		}
	}

	async function focusEmptyInput() {
		const row = await browser.$('.metadata-property[data-property-key="mylist"]')
		await row.click({ x: 2, y: 2 })
		await browser.pause(150)
		const input = await browser.$('.metadata-property[data-property-key="mylist"] .multi-select-input')
		await input.click()
		await browser.pause(150)
		await dismissSuggesterIfOpen()
	}

	async function snap() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			return { activeClass: active?.className ?? null, activeText: active?.textContent ?? null }
		})
	}

	it('(1) Word left at the empty composing input\'s own start moves to the preceding pill', async function () {
		await openNote('WordLeftPillEscape.md')
		await focusEmptyInput()
		const before = await snap()
		await expect(before.activeClass).toBe('multi-select-input')

		await browser.keys(['Control', 'Shift', 'l'])
		await browser.pause(200)
		const after = await snap()
		await expect(after.activeClass).toBe('multi-select-pill')
		await expect(after.activeText).toBe('itemTwo')
	})

	it('(2) regression: Word left with uncommitted typed text (caret at its own end) stays put, matching the already-shipped char-level Ctrl-B', async function () {
		await openNote('WordLeftPillEscapeTyped.md')
		await focusEmptyInput()
		await browser.keys(['h', 'i']) // "hi", caret stays at the end -- the common "still typing" case
		await browser.pause(150)

		const before = await snap()
		await expect(before.activeClass).toBe('multi-select-input')

		await browser.keys(['Control', 'Shift', 'l'])
		await browser.pause(200)
		const after = await snap()
		// isSelectionAtStartOf only compares TEXT content, so typed text
		// before the caret makes it return false regardless of the
		// caret's own offset -- same convention propertyMoveCharOrNoop's
		// own Ctrl-B escape already uses. Word left moves within "hi"
		// instead of escaping.
		await expect(after.activeClass).toBe('multi-select-input')
	})
})
