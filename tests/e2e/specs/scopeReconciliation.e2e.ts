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
//
// Test (3), added later, covers a DIFFERENT (and this time, actually
// CONFIRMED LIVE via [UCH-propscope-debug] console logging in a real
// vault) leak mechanism: a focusin event arriving while propertyRowScope
// is still set, before focusout for the previous target ever ran. The
// real trigger -- Ctrl-G's own internal tagged Escape re-dispatch
// synchronously kicking off Obsidian's own blur -> focusProperty chain
// BEFORE the original element's focusout bubbles up to this plugin's
// document-level listener -- could not be reproduced via browser.keys()
// in this harness either, same category as tests (1)/(2)'s own "can't
// force a real focus change to skip focusout" limitation. So, same
// precedent as those two, this dispatches the focusin event directly.
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

	it('(3) a focusin while propertyRowScope is already set does not orphan the first scope', async function () {
		const notePath = 'ScopeReconcileDoubleFocusin.md'
		createdPaths.push(notePath)

		await browser.executeObsidian(async ({ app }, notePath2) => {
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(notePath2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(notePath2, `---\ntags:\n  - existingtag\n---\nbody line\n`)
			await app.workspace.getLeaf(true).openFile(file)
		}, notePath)
		await browser.pause(500)

		const row = await browser.$('.metadata-property')
		await row.click({ x: 2, y: 2 })
		await browser.pause(150)

		const result = await browser.executeObsidian(({ app }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			const keymap = (app as any).keymap
			const rowEl = document.querySelector('.metadata-property') as HTMLElement

			rowEl.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
			const scope1 = plugin.propertyRowScope
			const afterFirstPush = { scope1Exists: !!scope1, topIsScope1: keymap.getWindowStack(window).scope === scope1 }

			// Force the exact leak shape: a SECOND focusin arrives while
			// propertyRowScope is still scope1, with no focusout dispatched
			// in between.
			rowEl.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
			const scope2 = plugin.propertyRowScope
			const afterSecondPush = { scope2DiffersFromScope1: scope2 !== scope1, topIsScope2: keymap.getWindowStack(window).scope === scope2 }

			// A normal focusout pops whatever propertyRowScope currently
			// points to (scope2). If scope1 was never popped, it resurfaces
			// as the new top once scope2 is gone.
			rowEl.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
			const topAfterPop = keymap.getWindowStack(window).scope

			return {
				afterFirstPush,
				afterSecondPush,
				scope1LeakedAsNewTop: topAfterPop === scope1,
				pluginScopeNowNull: plugin.propertyRowScope === null,
			}
		})

		await expect(result.afterFirstPush.scope1Exists).toBe(true)
		await expect(result.afterFirstPush.topIsScope1).toBe(true)
		await expect(result.afterSecondPush.scope2DiffersFromScope1).toBe(true)
		await expect(result.afterSecondPush.topIsScope2).toBe(true)
		await expect(result.scope1LeakedAsNewTop).toBe(false) // the actual regression check
		await expect(result.pluginScopeNowNull).toBe(true)
	})
})
