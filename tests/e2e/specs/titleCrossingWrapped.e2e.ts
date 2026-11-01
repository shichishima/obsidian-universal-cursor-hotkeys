import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1: Ctrl-P/N crossing into and within a WRAPPED title (one
// long enough to span multiple visual lines). See titleCrossingShort.e2e.ts
// for the shared rationale (title = filename, so the note is created on the
// fly rather than via a committed fixture; hotkeys must be set explicitly
// since this plugin ships with none by default; real KeyboardEvents are
// dispatched to drive the actual Scope/Keymap push-stack path).
//
// This is the direct regression test for a real bug found live during
// development: chaining Ctrl-P upward through a wrapped title's own visual
// lines skipped one extra line per press (landing on VLn-2 instead of
// VLn-1). Root cause was the ambiguous-VL-boundary-offset workaround
// nudging in the wrong direction for the backward (Ctrl-P) case — see
// titleMoveLine's own comment in src/main.ts. The chained up/down sequence
// below asserts the full, exact top-coordinate sequence (not just
// first/last), since a skip is only visible as a missing intermediate step.
describe('Title crossing: wrapped title', function () {
	// Long enough to reliably wrap across 4 visual lines at the default
	// test window size (confirmed live: 4 distinct line tops, ~31px apart).
	const path = 'TitleCrossingWrappedAVeryLongFilenameThatShouldForceTheInlineTitleFieldToWrapAcrossMultipleVisualLinesForTestingPurposesXXXXXXXXXXXXXXXXXXXX.md'

	after(async function () {
		await browser.executeObsidian(async ({ app }, path2) => {
			const file = app.vault.getFileByPath(path2)
			if (file) await app.vault.delete(file)
		}, path)
	})

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

	async function readTitleState() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const doc = title.ownerDocument
			const active = doc.activeElement === title
			const sel = doc.getSelection()
			const rect = active && sel?.rangeCount
				? (sel.getRangeAt(0).getClientRects()[0] ?? sel.getRangeAt(0).getBoundingClientRect())
				: null
			return {
				activeIsTitle: active,
				offset: active && sel?.rangeCount ? sel.getRangeAt(0).startOffset : null,
				top: rect ? Math.round(rect.top) : null,
			}
		})
	}

	it('chains Ctrl-P up through each visual line exactly once, then Ctrl-N back down, then escapes to the body', async function () {
		const hm = await browser.executeObsidian(async ({ app, obsidian }, path2) => {
			const hm2 = (app as any).hotkeyManager
			hm2.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm2.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm2.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, '\nfirst line of body text here')
			await app.workspace.getLeaf(true).openFile(file)
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: 0, ch: 0 })
			return true
		}, path)
		await expect(hm).toBe(true)
		await browser.pause(300)

		await pressCtrl('body', 'p') // body ch0 -> the title's LAST (bottommost) visual line
		const entry = await readTitleState()
		await expect(entry.activeIsTitle).toBe(true)

		const upTops: (number | null)[] = [entry.top]
		for (let i = 0; i < 4; i++) {
			await pressCtrl('title', 'p')
			upTops.push((await readTitleState()).top)
		}

		// Strictly decreasing (moving up one real visual line at a time)
		// until the title's own first line is reached, then a true no-op
		// (nothing above — frontmatter is out of scope for 0.13.0's own
		// title-only work). The regression this guards against showed up
		// as a MISSING intermediate value here (e.g. jumping two lines on
		// one press), not just a wrong final position.
		const distinctTops = [...new Set(upTops)]
		await expect(distinctTops.length).toBe(4) // 4 visual lines, confirmed live for this title/window size
		await expect(upTops).toEqual([...distinctTops, distinctTops[3]]) // strictly decreasing, then repeats (no-op)
		await expect(upTops[upTops.length - 1]).toBe(upTops[upTops.length - 2]) // the last Ctrl-P was a genuine no-op

		const topAtVL1 = (await readTitleState())
		// Having walked all the way up, we're at the title's own true
		// start — this is a structural invariant (not dependent on exact
		// pixel/font metrics the way the intermediate offsets would be).
		await expect(topAtVL1.offset).toBe(0)

		const downTops: (number | null)[] = []
		for (let i = 0; i < 4; i++) {
			await pressCtrl('title', 'n')
			downTops.push((await readTitleState()).top)
		}
		// Retraces the exact same visual lines in reverse, then escapes.
		await expect(downTops.slice(0, 3)).toEqual([...distinctTops].reverse().slice(1))

		await pressCtrl('title', 'n') // one more Ctrl-N from the last visual line escapes into the body
		const afterEscape = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			return {
				activeIsTitle: title.ownerDocument.activeElement === title,
				cursor: view.editor.getCursor(),
			}
		})
		await expect(afterEscape.activeIsTitle).toBe(false)
		await expect(afterEscape.cursor.line).toBe(1) // the body's first real line, below the blank line 0
	})
})
