import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, Kill/Yank step: Alt-D (Kill word right) / Alt-Backspace
// (Kill word left) in the title field. See titleKillLine.e2e.ts for the
// shared rationale (title = filename, created on the fly; hotkeys set
// explicitly since this plugin ships none by default; real KeyboardEvent
// dispatch to actually drive the Scope/Keymap push-stack).
//
// Deliberately does NOT reuse word-segmentation.ts (the Intl.Segmenter-
// based engine Word left/right and Vim w/b/e need on the body side, since
// CM6's own native word-class boundary has no CJK awareness at all) —
// confirmed live the title's own native Selection.modify('extend', ...,
// 'word') already segments CJK correctly on its own, same as physical
// Option-←/→ in the title (see project_title_field_native_option_arrow_
// word_boundary memory). Test (3) below is the permanent regression
// coverage for that finding.
describe('Kill word left/right (Alt-D / Alt-Backspace) in the title field', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function openNote(path: string, body: string, titleOffset: number) {
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app, obsidian }, { path2, body2, offset }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.isKillChaining = false
			plugin.killCache = ''
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:kill-word-right', [{ modifiers: ['Alt'], key: 'D' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-word-left', [{ modifiers: ['Alt'], key: 'Backspace' }])
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
		}, { path2: path, body2: body, offset: titleOffset })
		// Deterministic instead of a fixed pause — confirmed live the
		// fixed-pause version was genuinely flaky (title.focus()'s own
		// focusin handler pushes the title Scope asynchronously enough
		// relative to a freshly-opened leaf that a flat 300ms wasn't
		// always enough margin; failed as "nothing happened at all" on
		// the very first Alt-D/Alt-Backspace press of a test).
		await browser.waitUntil(async () => {
			return browser.executeObsidian(({ app }) => {
				return (app as any).plugins.plugins['universal-cursor-hotkeys'].titleScope !== null
			})
		}, { timeout: 2000, interval: 50, timeoutMsg: 'title Scope never pushed' })
	}

	async function pressAlt(key: string) {
		await browser.executeObsidian(({ app, obsidian }, key2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.dispatchEvent(new KeyboardEvent('keydown', { key: key2, altKey: true, bubbles: true, cancelable: true }))
		}, key)
		await browser.pause(150)
	}

	async function getTitleText() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			return title.textContent
		})
	}

	it('(1) kills exactly one word forward/backward; no-op at the title\'s own start/end', async function () {
		// "Kill Word Alpha" — ch0 is right before "Kill".
		await openNote('Kill Word Alpha.md', 'body text', 0)

		await pressAlt('d') // Alt-D at offset 0: kills "Kill"
		await expect(await getTitleText()).toBe(' Word Alpha')

		await pressAlt('Backspace') // cursor still at offset 0: nothing to its left — no-op
		await expect(await getTitleText()).toBe(' Word Alpha')
	})

	it('(2) integrates with the title\'s own native undo stack (Ctrl-Z restores the killed word)', async function () {
		await openNote('Kill Word Undo.md', 'body text', 0)
		await pressAlt('d') // kills "Kill"
		await expect(await getTitleText()).toBe(' Word Undo')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.ownerDocument.execCommand('undo')
		})
		await expect(await getTitleText()).toBe('Kill Word Undo')
	})

	it('(3) CJK: consecutive kills split a run of kanji/hiragana word by word, via the title\'s own native word-boundary logic (no custom segmenter needed)', async function () {
		// A minimal, purpose-built string — not the longer
		// "日本語のEmacsとは異なる扱いです" cjkDoubleClickWordSelect.e2e.ts
		// uses for ITS OWN different purpose (a pure CJK run, an embedded
		// English word, and this same verb+auxiliary morpheme, each its
		// own check for that spec's body-side double-click selection).
		// This test only needs the one thing it's actually checking —
		// does a run of kanji/hiragana get split at all, rather than
		// killed as one indivisible block (the exact failure mode
		// word-segmentation.ts exists to prevent on the body side) —
		// confirmed live this minimal string segments identically to the
		// same substring embedded in that longer one.
		await openNote('異なる扱いです.md', 'body text', 0)

		await pressAlt('d') // kills "異なる" only, not sweeping into "扱いです" too
		await expect(await getTitleText()).toBe('扱いです')

		// Confirmed live: the title's native word boundary splits this
		// differently from the body's own custom morphological segmenter
		// (see cjkDoubleClickWordSelect.e2e.ts, which keeps "異なる" as
		// one unit the same way, but does NOT split "扱いです" further) —
		// here it splits further into "扱い" + "です". Different engines,
		// both genuinely word-aware; this asserts the title's own actual
		// behavior, not that it matches the body's.
		await pressAlt('d') // kills "扱い", not "扱いです" as one block
		await expect(await getTitleText()).toBe('です')
	})

	it('(4) a backward kill prepends, building the kill-ring in buffer order across consecutive kills', async function () {
		await openNote('Kill Word Prepend Order.md', 'body text', 'Kill Word Prepend Order'.length)

		await pressAlt('Backspace') // kills "Order" (prepend into an empty cache -> killCache = "Order")
		await expect(await getTitleText()).toBe('Kill Word Prepend ')

		// Confirmed live: unlike the first kill (from the true string end,
		// which excludes the space before "Order"), this one DOES pull in
		// the trailing space after "Prepend" — the cursor now sits right
		// after that space, and the native backward-word boundary treats
		// adjacent trailing whitespace as part of the same unit when
		// approached that way (a common word-delete convention — e.g.
		// Ctrl+Backspace in many editors behaves the same from this exact
		// position).
		await pressAlt('Backspace') // kills "Prepend " (prepend -> killCache = "Prepend Order")
		await expect(await getTitleText()).toBe('Kill Word ')

		const killCache = await browser.executeObsidian(({ app }) => {
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].killCache as string
		})
		// Buffer order (as if the two backward kills had happened in one
		// pass left-to-right), not call order — real Emacs's own
		// backward-kill-word convention.
		await expect(killCache).toBe('Prepend Order')
	})
})
