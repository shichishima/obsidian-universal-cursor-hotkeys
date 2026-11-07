import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// Safety net for propertyRowScope/titleScope: both are normally pushed/
// popped purely by focusin/focusout. Live testing across several real
// switching scenarios (same-leaf openFile, repeated rapid switches
// across widget types, a real file-explorer click, switching away from
// a Bases cell-selection view, switching ACTIVE LEAF to an already-open
// split) all fired focusout correctly on their own -- none reproduced a
// stuck scope directly. Since a genuinely stuck scope requires focusout
// to NOT fire (which can't be forced via any real, browser-faithful
// focus change -- any real focus change fires it), this spec tests
// reconcileScopesWithFocus() directly: manually puts propertyRowScope/
// titleScope into the exact "stuck" state (set on the plugin instance,
// pushed onto the real Keymap stack, but with document.activeElement
// already pointing somewhere unrelated) and confirms the reconciler
// -- triggered via a real 'file-open' event -- cleans it up.
describe('Scope reconciliation safety net (propertyRowScope/titleScope)', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	it('(1) a stuck propertyRowScope is popped and cleared on file-open', async function () {
		const noteA = 'ScopeReconcileA.md'
		const noteB = 'ScopeReconcileB.md'
		createdPaths.push(noteA, noteB)

		await browser.executeObsidian(async ({ app }, { a, b }) => {
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			for (const p of [a, b]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(a, `---\nmyText: helloA\n---\nbody A\n`)
			await app.vault.create(b, `other note body B\n`)
			const fileA = app.vault.getFileByPath(a)!
			await app.workspace.getLeaf(true).openFile(fileA)
		}, { a: noteA, b: noteB })
		await browser.pause(500)

		// Focus the property text value widget normally, so propertyRowScope
		// is genuinely pushed on the real Keymap stack.
		const valueEl = await browser.$('.metadata-input-longtext')
		await valueEl.click()
		await browser.pause(300)

		// Simulate "focusout never fired": move DOM focus away via a real
		// .focus() call on the body editor (this itself WOULD normally
		// fire our own focusout listener and clean things up correctly --
		// so immediately afterward, forcibly restore plugin.propertyRowScope
		// to the (no longer matching) scope reference, re-pushing it, to
		// reproduce the exact stuck state deterministically regardless of
        // how a real "focusout didn't fire" bug would actually arise.
		const stuckSetup = await browser.executeObsidian(({ app, obsidian }, b) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			const stuckScope = plugin.propertyRowScope
			const keymap = (app as any).keymap
			// Move real focus to the body editor first (this pops the
			// scope normally via focusout) ...
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.focus()
			// ... then re-push the SAME (now-stale) scope object and
			// reassign it onto the plugin instance, reproducing "stuck"
			// regardless of what real-world bug would cause it.
			keymap.pushScope(stuckScope)
			plugin.propertyRowScope = stuckScope
			const stack = keymap.getWindowStack(window)
			return { stuckScopeIsTop: stack.scope === stuckScope, activeFile: b }
		}, noteB)
		expect(stuckSetup.stuckScopeIsTop).toBe(true) // confirms the stuck state was actually set up

		// Now trigger the real workspace event the safety net listens for.
		await browser.executeObsidian(async ({ app }, b) => {
			const leaf = app.workspace.getLeavesOfType('markdown')[0]
			const file = app.vault.getFileByPath(b)!
			await leaf.openFile(file)
		}, noteB)
		await browser.pause(300) // covers the 2-frame defer inside reconcileScopesWithFocus

		const after = await browser.executeObsidian(({ app }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			const stack = (app as any).keymap.getWindowStack(window)
			return {
				hasPropertyRowScope: !!plugin.propertyRowScope,
				topIsStillPropertyRowScope: stack.scope === plugin.propertyRowScope,
			}
		})
		await expect(after.hasPropertyRowScope).toBe(false)
	})

	it('(2) regression: an UNRELATED file-open elsewhere does not tear down a still-valid, currently-focused propertyRowScope', async function () {
		const note = 'ScopeReconcileStillFocused.md'
		const otherNote = 'ScopeReconcileUnrelated.md'
		createdPaths.push(note, otherNote)

		await browser.executeObsidian(async ({ app }, { notePath, otherPath }) => {
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			for (const p of [notePath, otherPath]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(notePath, `---\nmyText: hello\n---\nbody\n`)
			await app.vault.create(otherPath, `unrelated note\n`)
			const file = app.vault.getFileByPath(notePath)!
			const otherFile = app.vault.getFileByPath(otherPath)!
			const leaf = app.workspace.getLeaf(true)
			await leaf.openFile(file)
			// Open the SECOND leaf with a file right away -- an empty,
			// just-created leaf (no file yet) doesn't report itself as
			// view type 'markdown', confirmed live (getLeavesOfType
			// returned only the first leaf until this ran).
			const secondLeaf = app.workspace.createLeafBySplit(leaf, 'horizontal', false)
			await secondLeaf.openFile(otherFile)
		}, { notePath: note, otherPath: otherNote })
		await browser.pause(500)

		const valueEl = await browser.$('.metadata-input-longtext')
		await valueEl.click()
		await browser.pause(300)

		// Trigger file-open on the OTHER (second) leaf AGAIN, never
		// touching focus in the first leaf at all -- the reconciler must
		// leave the first leaf's genuinely still-valid propertyRowScope
		// alone.
		await browser.executeObsidian(async ({ app }, otherPath) => {
			const leaves = app.workspace.getLeavesOfType('markdown')
			const secondLeaf = leaves[1]
			const file = app.vault.getFileByPath(otherPath)!
			await secondLeaf.openFile(file)
		}, otherNote)
		await browser.pause(300)

		const after = await browser.executeObsidian(({ app }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			const stack = (app as any).keymap.getWindowStack(window)
			return {
				hasPropertyRowScope: !!plugin.propertyRowScope,
				topIsPropertyRowScope: stack.scope === plugin.propertyRowScope,
				stillFocused: document.activeElement?.classList.contains('metadata-input-longtext'),
			}
		})
		await expect(after.stillFocused).toBe(true)
		await expect(after.hasPropertyRowScope).toBe(true)
		await expect(after.topIsPropertyRowScope).toBe(true)
	})
})
