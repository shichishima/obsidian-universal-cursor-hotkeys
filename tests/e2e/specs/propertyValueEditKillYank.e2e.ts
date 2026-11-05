import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, property-value-editing sub-phase, Phase 3: Kill-line
// (Ctrl-K), Kill-region (Ctrl-W), Copy-region (Alt-W), and Yank (Ctrl-Y)
// inside a text property's own value-edit widget. Reuses
// titleKillLine/titleKillRegion/titleCopyRegion/titleYank as-is from the
// title field's own implementation — all four already operate purely
// through the Selection API on the element's own ownerDocument, with no
// title-specific assumption baked in (same precedent as every other
// value-edit handler shipped in propertyValueEditMovement.e2e.ts and
// propertyValueEditSetMark.e2e.ts).
//
// Kill-word (Alt-D/Alt-Backspace) is deliberately NOT included — out of
// scope per the user's own explicit scope decision for this sub-feature.
//
// All four are bound with suppressFallback (see buildPropertyRowScope's
// own comment in main.ts): their base keys are plain letters, and the
// bind() fallback dispatch's dropped-modifier bug (found and fixed for
// Set-mark's own Ctrl-Space, see propertyValueEditSetMark.e2e.ts) would
// equally make a bare letter keydown on a row look like "start typing"
// to Obsidian's own row listener. Test (6) below is the direct
// regression coverage confirming all three letter-keyed commands are a
// true no-op on the plain row, not just Set-mark's own Space key.
describe('Property value-edit mode: Kill-line / Kill-region / Copy-region / Yank', function () {
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
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.isKillChaining = false
			plugin.killCache = ''
			plugin.markActive = false
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:set-mark', [{ modifiers: ['Ctrl'], key: ' ' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-left', [{ modifiers: ['Ctrl'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-home', [{ modifiers: ['Ctrl'], key: 'A' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-line', [{ modifiers: ['Ctrl'], key: 'K' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-region', [{ modifiers: ['Ctrl'], key: 'W' }])
			hm.setHotkeys('universal-cursor-hotkeys:copy-region', [{ modifiers: ['Alt'], key: 'W' }])
			hm.setHotkeys('universal-cursor-hotkeys:yank', [{ modifiers: ['Ctrl'], key: 'Y' }])
			hm.setHotkeys('universal-cursor-hotkeys:keyboard-quit', [{ modifiers: ['Ctrl'], key: 'G' }])
			hm.bake()
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
		await browser.pause(400)
	}

	async function focusValueAt(offset: number) {
		await browser.executeObsidian(({ app, obsidian }, off) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const value = row.querySelector('.metadata-input-longtext') as HTMLElement
			value.focus()
			const sel = value.ownerDocument.getSelection()!
			const textNode = value.firstChild!
			const range = value.ownerDocument.createRange()
			range.setStart(textNode, off)
			range.collapse(true)
			sel.removeAllRanges()
			sel.addRange(range)
		}, offset)
		await browser.pause(150)
	}

	// Dispatches on whatever currently has real DOM focus (not hardcoded to
	// the value-edit widget) — test (6) below focuses the plain row
	// instead, and needs the keydown to land there to actually exercise
	// buildPropertyRowScope's own target-matching logic.
	async function pressCtrl(key: string, alt = false) {
		await browser.executeObsidian(({ app, obsidian }, { key2, alt2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement
			active.dispatchEvent(new KeyboardEvent('keydown', { key: key2, ctrlKey: !alt2, altKey: alt2, bubbles: true, cancelable: true }))
		}, { key2: key, alt2: alt })
		await browser.pause(150)
	}

	async function snap() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const value = row.querySelector('.metadata-input-longtext') as HTMLElement
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			const sel = doc.getSelection()
			return {
				valueText: value.textContent,
				isRow: active?.closest?.('.metadata-property')?.getAttribute('data-property-key') === 'mytext' && active?.className !== 'metadata-input-longtext',
				selectedText: sel?.toString(),
				markActive: plugin.markActive as boolean,
				killCache: plugin.killCache as string,
			}
		})
	}

	it('(1) Ctrl-K kills from the cursor to the value\'s own end, into the shared kill-ring', async function () {
		await openNote('PropertyValueEditKillLine.md')
		await focusValueAt(5) // "hello world", offset 5 = right after "hello"

		await pressCtrl('k')
		const after = await snap()
		await expect(after.valueText).toBe('hello')
		await expect(after.killCache).toBe(' world')
	})

	it('(2) Ctrl-W (Kill region) deletes the Set-mark selection and clears the mark', async function () {
		await openNote('PropertyValueEditKillRegion.md')
		await focusValueAt(0)

		await pressCtrl(' ') // Set-mark at offset 0
		await pressCtrl('f')
		await pressCtrl('f')
		await pressCtrl('f')
		await pressCtrl('f')
		await pressCtrl('f') // selects "hello"

		await pressCtrl('w') // Ctrl-W: Kill region
		const after = await snap()
		await expect(after.valueText).toBe(' world')
		await expect(after.markActive).toBe(false)
		await expect(after.killCache).toBe('hello')
	})

	it('(3) Alt-W (Copy region) copies the Set-mark selection without mutating the value, and clears the mark', async function () {
		await openNote('PropertyValueEditCopyRegion.md')
		await focusValueAt(0)

		await pressCtrl(' ')
		await pressCtrl('f')
		await pressCtrl('f')
		await pressCtrl('f')
		await pressCtrl('f')
		await pressCtrl('f') // selects "hello"

		await pressCtrl('w', true) // Alt-W: Copy region
		const after = await snap()
		await expect(after.valueText).toBe('hello world') // unchanged — non-destructive
		await expect(after.markActive).toBe(false)
		await expect(after.killCache).toBe('hello')
	})

	it('(4) Ctrl-Y inserts the kill-ring content at a collapsed cursor', async function () {
		await openNote('PropertyValueEditYankInsert.md')
		await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.killCache = 'XYZ'
			// titleYank (reused here) prefers the real OS clipboard over
			// killCache — seed both, matching titleYank.e2e.ts's own
			// openNote precedent, since a leftover clipboard value from an
			// earlier test in this shared instance would otherwise win.
			await navigator.clipboard.writeText('XYZ')
		})
		await focusValueAt(5) // right after "hello"

		await pressCtrl('y')
		const after = await snap()
		await expect(after.valueText).toBe('helloXYZ world')
	})

	it('(5) Ctrl-Y replaces an active (non-collapsed) selection instead of inserting at a point', async function () {
		await openNote('PropertyValueEditYankReplace.md')
		await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.killCache = 'XYZ'
			await navigator.clipboard.writeText('XYZ')
		})
		await focusValueAt(0)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const value = row.querySelector('.metadata-input-longtext') as HTMLElement
			const doc = value.ownerDocument
			const textNode = value.firstChild as Text
			const sel = doc.getSelection() as any
			sel.setBaseAndExtent(textNode, 0, textNode, 5) // selects "hello"
		})

		await pressCtrl('y')
		const after = await snap()
		await expect(after.valueText).toBe('XYZ world')
	})

	it('(6) regression: Ctrl-K/Ctrl-W/Ctrl-Y on the row itself (item-selection mode) do nothing', async function () {
		await openNote('PropertyValueEditKillYankNoInterference.md')
		await browser.executeObsidian(({ app }) => {
			(app as any).plugins.plugins['universal-cursor-hotkeys'].killCache = 'UNUSED'
		})
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			row.focus()
		})
		await browser.pause(150)

		await pressCtrl('k')
		await pressCtrl('w')
		await pressCtrl('y')
		const after = await snap()
		await expect(after.isRow).toBe(true)
		await expect(after.valueText).toBe('hello world') // completely unchanged
	})

	it('(7) cross-context: Kill line in the body populates the shared kill-ring, Yank in the value-edit widget retrieves it', async function () {
		await openNote('PropertyValueEditKillYankChain.md')
		await focusValueAt(5) // right after "hello"

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.focus() // DOM focus must actually leave the value-edit widget for executeObsidianCommand's editorCallback to fire
			view.editor.setCursor({ line: 0, ch: 0 }) // "first body line"
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:kill-line') // kills "first body line" into the shared kill-ring
		await browser.pause(150)

		await focusValueAt(5) // re-focus and re-place, same as titleYank.e2e.ts's own cross-context test
		await pressCtrl('y')
		const after = await snap()
		await expect(after.valueText).toBe('hellofirst body line world')
	})

	// Real bug, reported by the user from real-machine usage right after
	// this sub-feature shipped: pressing Ctrl-A -> Ctrl-K -> Ctrl-Y twice
	// in a row left the cursor completely unresponsive, including Ctrl-G
	// — only a physical Escape press recovered it. Root cause: Obsidian's
	// own property-value suggestion dropdown (visible the moment the
	// widget gets focus, suggesting previously-used values for this
	// property) reacts to the real 'input' event Ctrl-K/Ctrl-Y's own
	// execCommand triggers by pushing ITS OWN Scope on top of
	// propertyRowScope — confirmed live via a diagnostic dump of
	// app.keymap's own window-scope stack. DOM focus never actually left
	// the value-edit widget, so propertyRowScope was still technically
	// pushed, just shadowed underneath the suggester's scope, silently
	// breaking every command bound here until physical Escape closed the
	// dropdown and popped its own scope as an unrelated side effect of
	// Obsidian's own code. Fixed by reclaimPropertyRowScopeAfterMutation
	// (see its own comment in main.ts) — called after every mutating
	// value-edit command (kill-line/kill-region/yank), it detects a
	// foreign scope on top after a settle delay and pops it specifically,
	// rather than force-pushing a duplicate of our own (which would leak
	// the stack — see the method's own comment for why).
	it('(8) regression: repeated Ctrl-A/Ctrl-K/Ctrl-Y cycles don\'t let Obsidian\'s own suggestion dropdown shadow the Scope — Ctrl-G still works afterward', async function () {
		await openNote('PropertyValueEditKillYankScopeShadow.md')
		await focusValueAt(0)

		await pressCtrl('a'); await pressCtrl('k'); await pressCtrl('y')
		await pressCtrl('a'); await pressCtrl('k'); await pressCtrl('y')
		const afterCycles = await snap()
		await expect(afterCycles.valueText).toBe('hello world') // the round trip itself is still lossless

		await pressCtrl('g')
		const afterQuit = await snap()
		await expect(afterQuit.isRow).toBe(true) // Ctrl-G still works — the scope wasn't left shadowed
	})
})
