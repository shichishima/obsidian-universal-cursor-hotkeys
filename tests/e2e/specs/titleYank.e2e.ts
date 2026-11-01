import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, Kill/Yank step: Ctrl-Y (Yank) in the title field — the
// last item in the Kill/Yank roadmap. See titleKillLine.e2e.ts /
// titleRegion.e2e.ts for the shared rationale (title = filename, created on
// the fly; hotkeys set explicitly since this plugin ships none by default;
// real KeyboardEvent dispatch to actually drive the Scope/Keymap
// push-stack).
//
// titleYank uses document.execCommand('insertText', false, text) —
// confirmed live (via a throwaway probe comparing it against a real
// ClipboardEvent('paste', ...)) to behave IDENTICALLY to native Cmd-V
// paste in the title for an embedded (non-trailing) newline, dropping it
// entirely rather than replacing it with a space. But a kill-ring entry
// ENDING in a newline (e.g. two Ctrl-Ks in the body: first kills the
// line's own text, second kills the line break itself) hit a genuine
// Chromium contenteditable bug on insert — confirmed live, and confirmed
// to affect a real native Cmd-V paste identically, not just this plugin's
// own execCommand call: the selection's focus/anchor land on the title's
// container element instead of its text node afterward, and the title's
// native undo stack silently stops working for every subsequent edit.
// titleYank strips newlines itself before inserting rather than trusting
// the browser — test (5) below is the direct regression coverage.
//
// Unlike the body's own yank()/yankOuter() (which needs per-range
// multi-cursor handling and Markdown-table/list-marker-dedup logic), the
// title only ever has one native Selection, and execCommand('insertText')
// already does the right thing whether the selection is collapsed or not
// — so titleYank itself is just a clipboard read + one execCommand call.
describe('Yank (Ctrl-Y) in the title field', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	// Opens a fresh note, seeds the shared kill-ring (both killCache and the
	// real OS clipboard, matching titleYank's own read-clipboard-first
	// path) with `killRingText`, places a collapsed cursor at
	// `titleOffset`, and resets isKillChaining/markActive so each test
	// starts from a known baseline.
	async function openNote(path: string, body: string, titleOffset: number, killRingText: string) {
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app, obsidian }, { path2, body2, offset, killRingText2 }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.isKillChaining = false
			plugin.markActive = false
			plugin.killCache = killRingText2
			await navigator.clipboard.writeText(killRingText2)
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:yank', [{ modifiers: ['Ctrl'], key: 'Y' }])
			hm.setHotkeys('universal-cursor-hotkeys:set-mark', [{ modifiers: ['Ctrl'], key: ' ' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, body2)
			await app.workspace.getLeaf(true).openFile(file)
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const title = doc.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.focus()
			const textNode = title.firstChild as Text
			const range = doc.createRange()
			range.setStart(textNode, offset)
			range.collapse(true)
			const sel = doc.getSelection()!
			sel.removeAllRanges()
			sel.addRange(range)
		}, { path2: path, body2: body, offset: titleOffset, killRingText2: killRingText })
		await browser.waitUntil(async () => {
			return browser.executeObsidian(({ app }) => {
				return (app as any).plugins.plugins['universal-cursor-hotkeys'].titleScope !== null
			})
		}, { timeout: 8000, interval: 50, timeoutMsg: 'title Scope never pushed' })
	}

	async function pressCtrl(el: 'body' | 'title', key: string) {
		await browser.executeObsidian(({ app, obsidian }, { el: el2, key: key2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const target = el2 === 'body'
				? (view.editor as any).cm.contentDOM
				: view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			target.dispatchEvent(new KeyboardEvent('keydown', { key: key2, ctrlKey: true, bubbles: true, cancelable: true }))
		}, { el, key })
		await browser.pause(150)
	}

	async function snap() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			return {
				titleText: title.textContent,
				markActive: plugin.markActive as boolean,
				isKillChaining: plugin.isKillChaining as boolean,
			}
		})
	}

	it('(1) inserts the kill-ring content at a collapsed cursor, clearing an active mark', async function () {
		await openNote('YankInsert.md', 'body text not used by this test', 4, 'ABC') // "Yank" | "Insert"
		await pressCtrl('title', ' ') // Set-mark, to confirm Yank clears it
		const before = await snap()
		await expect(before.markActive).toBe(true)

		await pressCtrl('title', 'y')
		const after = await snap()
		await expect(after.titleText).toBe('YankABCInsert')
		await expect(after.markActive).toBe(false)
		await expect(after.isKillChaining).toBe(false)
	})

	it('(2) replaces an active (non-collapsed) native selection instead of inserting at a point', async function () {
		await openNote('YankReplace.md', 'body text not used by this test', 0, 'XYZ')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const doc = title.ownerDocument
			const textNode = title.firstChild as Text
			const sel = doc.getSelection() as any
			sel.setBaseAndExtent(textNode, 4, textNode, 11) // selects "Replace" out of "YankReplace"
		})

		await pressCtrl('title', 'y')
		const after = await snap()
		await expect(after.titleText).toBe('YankXYZ')
	})

	it('(3) cross-context round trip: Kill line in the body populates the shared kill-ring, Yank in the title retrieves it', async function () {
		await openNote('YankChain.md', 'first line body\nsecond line', 4, '') // "Yank" | "Chain"
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.focus() // DOM focus must actually leave the title for executeObsidianCommand's editorCallback to fire
			view.editor.setCursor({ line: 0, ch: 6 }) // "first " | "line body"
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:kill-line') // kills "line body" into the shared kill-ring
		await browser.pause(150)

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.focus()
			// Re-focusing resets the native cursor to offset 0 (confirmed
			// live) rather than preserving wherever it was before DOM focus
			// left the title — re-place it explicitly at the same offset 4
			// used in openNote above ("Yank" | "Chain").
			const textNode = title.firstChild as Text
			const range = doc.createRange()
			range.setStart(textNode, 4)
			range.collapse(true)
			const sel = doc.getSelection()!
			sel.removeAllRanges()
			sel.addRange(range)
		})
		await browser.waitUntil(async () => {
			return browser.executeObsidian(({ app }) => {
				return (app as any).plugins.plugins['universal-cursor-hotkeys'].titleScope !== null
			})
		}, { timeout: 8000, interval: 50, timeoutMsg: 'title Scope never pushed on re-focus' })

		await pressCtrl('title', 'y')
		const after = await snap()
		await expect(after.titleText).toBe('Yankline bodyChain')
	})

	it('(4) integrates with the title\'s own native undo stack (Ctrl-Z restores the pre-yank text)', async function () {
		await openNote('YankUndo.md', 'body text not used by this test', 4, 'ABC') // "Yank" | "Undo"
		await pressCtrl('title', 'y')
		await expect((await snap()).titleText).toBe('YankABCUndo')

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.ownerDocument.execCommand('undo')
		})
		await expect((await snap()).titleText).toBe('YankUndo')
	})

	it('(5) strips a trailing newline before inserting (Chromium contenteditable bug regression)', async function () {
		// A kill-ring entry ending in a newline is a realistic case: in the
		// body, Ctrl-K at a line's own end kills just the line break,
		// chaining onto a prior same-line kill (e.g. "ABC" then "\n").
		// Inserting such a string via execCommand('insertText') without
		// stripping it first leaves the native Selection's focus/anchor on
		// the title's own container element instead of its text node, and
		// silently breaks the title's native undo stack from that point on
		// — confirmed live via a throwaway repro probe, and confirmed to
		// affect a real native Cmd-V paste of the same content identically
		// (not specific to this plugin's own execCommand call).
		await openNote('YankTrailingNewline.md', 'body text not used by this test', 4, 'ABC\n') // "Yank" | "TrailingNewline"
		await pressCtrl('title', 'y')
		await expect((await snap()).titleText).toBe('YankABCTrailingNewline')

		const selAfterYank = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const sel = view.containerEl.ownerDocument.getSelection()!
			return { focusNodeType: sel.focusNode?.nodeType, focusNodeName: sel.focusNode?.nodeName }
		})
		await expect(selAfterYank.focusNodeType).toBe(3) // Node.TEXT_NODE — not the title's own container DIV (the broken state this guards against)
		await expect(selAfterYank.focusNodeName).toBe('#text')

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.ownerDocument.execCommand('undo')
		})
		await expect((await snap()).titleText).toBe('YankTrailingNewline') // undo still works afterward
	})

	it('(6) prefers the real OS clipboard over killCache when they diverge (e.g. something copied outside Obsidian)', async function () {
		await openNote('YankClipPriority.md', 'body text not used by this test', 4, 'CLIPBOARD_VALUE') // seeds both clipboard and killCache to the same value
		await browser.executeObsidian(({ app }) => {
			// Diverge killCache from the clipboard without touching the
			// clipboard itself — simulates copying something outside
			// Obsidian after an earlier in-app kill.
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.killCache = 'KILLCACHE_VALUE'
		})

		await pressCtrl('title', 'y')
		await expect((await snap()).titleText).toBe('YankCLIPBOARD_VALUEClipPriority')
	})

	it('(7) falls back to killCache when navigator.clipboard.readText() throws', async function () {
		await openNote('YankClipFail.md', 'body text not used by this test', 4, 'FALLBACK_VALUE')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const win = view.containerEl.ownerDocument.defaultView as any
			win.__uchOriginalReadText = navigator.clipboard.readText
			navigator.clipboard.readText = () => Promise.reject(new Error('mock clipboard read failure'))
		})

		try {
			await pressCtrl('title', 'y')
			await expect((await snap()).titleText).toBe('YankFALLBACK_VALUEClipFail')
		} finally {
			await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const win = view.containerEl.ownerDocument.defaultView as any
				navigator.clipboard.readText = win.__uchOriginalReadText
			})
		}
	})

	it('(8) strips an embedded (non-trailing) newline too, e.g. from a multi-line body Kill region', async function () {
		await openNote('YankEmbeddedNewline.md', 'body text not used by this test', 4, 'AB\nCD') // "Yank" | "EmbeddedNewline"
		await pressCtrl('title', 'y')
		await expect((await snap()).titleText).toBe('YankABCDEmbeddedNewline')

		const selAfterYank = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const sel = view.containerEl.ownerDocument.getSelection()!
			return { focusNodeType: sel.focusNode?.nodeType }
		})
		await expect(selAfterYank.focusNodeType).toBe(3) // Node.TEXT_NODE, same regression guard as test (5)

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.ownerDocument.execCommand('undo')
		})
		await expect((await snap()).titleText).toBe('YankEmbeddedNewline')
	})

	it('(9) is a safe no-op when the kill-ring is empty', async function () {
		await openNote('YankEmptyNoop.md', 'body text not used by this test', 4, '')
		await pressCtrl('title', 'y')
		await expect((await snap()).titleText).toBe('YankEmptyNoop')
	})
})
