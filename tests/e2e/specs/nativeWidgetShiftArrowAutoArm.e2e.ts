import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// Confirmed real gap, found while documenting Set-mark's own title/
// Properties/Bases coverage: the body's own CM6 updateListener auto-
// arms Set-mark from a native Shift+Arrow keypress or mouse drag
// (anchor-preserved extend), but the title/property-value/composing-
// input/Bases-cell contenteditable widgets and the property NAME plain
// <input> never had an equivalent — a Shift+Arrow there left
// markActive false, so a FOLLOWING plain Ctrl-F collapsed and moved
// instead of continuing to extend, unlike the body. User's own framing:
// "あえて挙動を変える理由はない" (no reason to deliberately behave
// differently from the body here).
//
// Fixed via a document-level 'selectionchange' listener
// (maybeAutoArmNativeMark / maybeAutoArmNativeMarkForInput in
// registerWindowDomListeners), mirroring CM6's own two rules without
// CM6's transaction tags to lean on:
//  - Rule A (mouse): a document-level _isPointerDown flag (mousedown/
//    mouseup) stands in for CM6's 'select.pointer' tag -- while true,
//    markActive is unconditionally synced to "is the current selection
//    non-empty" (arms on a drag, clears on a plain click).
//  - Rule B (keyboard): comparing the current selectionchange's own
//    anchor against the PREVIOUS one (same node+offset, non-empty,
//    not already armed), ANDed with a trusted-Shift-keydown/keyup-
//    tracked _isShiftKeyDown flag, stands in for CM6's own anchor-
//    preserved extend check -- arms only, never clears.
//  - Rule C (native collapse): found as a SECOND real gap, live, while
//    writing Set-mark's own doc section -- a plain physical arrow key
//    with no Key Upgrade bound collapses the selection via pure native
//    handling, with none of this plugin's own movement functions ever
//    running at all, so nothing else clears the mark afterward. Since
//    every one of this plugin's own movement functions already checks
//    markActive and extends (never natively collapses) whenever it's
//    true, a collapsed result while not pointer-down is always either
//    this native case or a real Shift-extend shrinking back to its own
//    anchor -- both correctly clear, matching the body's own identical
//    "extending one way then back to the exact anchor" convention.
//
// A real WebDriver pointer-drag's own mousemove sequence never actually
// produced a native text selection on a plain contenteditable in this
// harness (confirmed via several attempts, including the exact
// working `dragSelect` pattern used elsewhere in this suite for Live
// Preview table cells, which goes through a completely different CM6
// mouseSelectionStyle extension, not plain browser text-selection-via-
// drag) -- Rule A's mouse-drag half is therefore NOT covered by a
// permanent test here. It shares the exact same `_isPointerDown` +
// `maybeAutoArmNativeMark` code path as the plain-click-clears test
// below, which IS confirmed live, so this is a harness coverage gap,
// not an unverified behavior.
describe('Title/Properties: native Shift+Arrow and mouse-click selection auto-arm Set-mark, matching the body', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function openNote(path: string, content: string) {
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app }, { path2, content2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, content2)
			await app.workspace.getLeaf(true).openFile(file)
		}, { path2: path, content2: content })
		await browser.pause(400)
	}

	async function markActive() {
		return browser.executeObsidian(({ app }) => (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive)
	}

	it('(1) title: Shift+ArrowRight x2 arms the mark; a following plain Ctrl-F extends instead of collapsing', async function () {
		await openNote('NativeAutoArmTitle1.md', '---\n---\nbody\n')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const titleEl = view.containerEl.querySelector('.inline-title') as HTMLElement
			titleEl.focus()
			const sel = titleEl.ownerDocument.getSelection()!
			sel.collapse(titleEl.firstChild, 0)
		})
		await browser.pause(150)

		await expect(await markActive()).toBe(false)
		await browser.keys(['Shift', 'ArrowRight'])
		await browser.keys(['Shift', 'ArrowRight'])
		await browser.pause(150)
		await expect(await markActive()).toBe(true)

		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		const sel = await browser.executeObsidian(() => {
			const s = document.getSelection()!
			return { text: s.toString(), isCollapsed: s.isCollapsed }
		})
		await expect(sel.isCollapsed).toBe(false) // extended, not collapsed+moved
		await expect(sel.text.length).toBe(3) // two Shift-Right then one more plain extend
	})

	it('(2) title: a real mouse click (collapsing) clears an already-armed mark', async function () {
		await openNote('NativeAutoArmTitle2.md', '---\n---\nbody\n')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const titleEl = view.containerEl.querySelector('.inline-title') as HTMLElement
			titleEl.focus()
			const sel = titleEl.ownerDocument.getSelection()!
			sel.collapse(titleEl.firstChild, 0)
		})
		await browser.pause(150)
		await browser.keys(['Shift', 'ArrowRight'])
		await browser.pause(150)
		await expect(await markActive()).toBe(true)

		// A real, trusted click is required here (not a synthetic
		// dispatchEvent pair): the browser's own native collapse-on-click
		// action has to happen while this plugin's own _isPointerDown is
		// still true, which only a genuine mousedown/mouseup pair from
		// WebDriver produces in the right order relative to it.
		const titleEl = await browser.$('.inline-title')
		await titleEl.click({ x: 10, y: 5 })
		await browser.pause(150)
		await expect(await markActive()).toBe(false)
	})

	it('(3) property NAME field: Shift+ArrowRight arms the mark too, via the plain-<input> variant', async function () {
		await openNote('NativeAutoArmName3.md', '---\nfoo: bar\n---\nbody\n')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="foo"]') as HTMLElement
			const el = row.querySelector('.metadata-property-key-input') as HTMLInputElement
			el.focus()
			el.setSelectionRange(0, 0)
		})
		await browser.pause(150)
		await expect(await markActive()).toBe(false)
		await browser.keys(['Shift', 'ArrowRight'])
		await browser.keys(['Shift', 'ArrowRight'])
		await browser.pause(150)
		await expect(await markActive()).toBe(true)
	})

	it('(4) property text value: Shift+ArrowRight arms the mark too, same Selection-API mechanism as the title', async function () {
		await openNote('NativeAutoArmValue4.md', '---\nfoo: hello world\n---\nbody\n')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="foo"]') as HTMLElement
			const el = row.querySelector('.metadata-input-longtext') as HTMLElement
			el.focus()
			const sel = el.ownerDocument.getSelection()!
			sel.collapse(el.firstChild, 0)
		})
		await browser.pause(150)
		await expect(await markActive()).toBe(false)
		await browser.keys(['Shift', 'ArrowRight'])
		await browser.keys(['Shift', 'ArrowRight'])
		await browser.pause(150)
		await expect(await markActive()).toBe(true)
	})

	it('(5) title: a plain (no-Shift, no-mouse) ArrowRight collapsing the selection clears an already-armed mark (Rule C)', async function () {
		await openNote('NativeAutoArmClear5.md', '---\n---\nbody\n')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const titleEl = view.containerEl.querySelector('.inline-title') as HTMLElement
			titleEl.focus()
			const sel = titleEl.ownerDocument.getSelection()!
			sel.collapse(titleEl.firstChild, 0)
		})
		await browser.pause(150)

		await browser.keys(['Shift', 'ArrowRight'])
		await browser.keys(['Shift', 'ArrowRight'])
		await browser.pause(150)
		await expect(await markActive()).toBe(true)

		await browser.keys(['ArrowRight'])
		await browser.pause(150)
		const sel = await browser.executeObsidian(() => document.getSelection()!.isCollapsed)
		await expect(sel).toBe(true) // confirm the plain arrow actually collapsed it
		await expect(await markActive()).toBe(false)
	})
})
