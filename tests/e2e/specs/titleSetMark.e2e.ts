import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, Kill/Yank step: Set-mark (Ctrl-Space) in the title
// field. See titleKillLine.e2e.ts for the shared rationale (title =
// filename, created on the fly; hotkeys set explicitly since this plugin
// ships none by default; real KeyboardEvent dispatch to actually drive
// the Scope/Keymap push-stack).
//
// Unlike the body's own CM6-based Set-mark (which needs its own anchor-
// tracking machinery), the title's native Selection already distinguishes
// anchor from focus on its own — arming the mark just collapses to the
// current focus, and every existing movement command already calls
// Selection.modify with 'extend' instead of 'move' whenever markActive is
// true (the same native mechanism a real Shift+Arrow keypress uses).
//
// Direct regression test for a real bug found live during development:
// Ctrl-P/N's own "did we move to a new visual line" detection read
// sel.getRangeAt(0) directly, which reflects the WHOLE anchor-to-focus
// range once a mark is active (often a single rect spanning most of a
// line) rather than "where does the caret/focus currently render" — every
// marked Ctrl-P/N silently became a no-op as a result. Fixed by reading a
// dedicated collapsed-at-focus range throughout (titleFocusRects).
describe('Set-mark (Ctrl-Space) in the title field', function () {
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
			plugin.markActive = false
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:set-mark', [{ modifiers: ['Ctrl'], key: ' ' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-left', [{ modifiers: ['Ctrl'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-home', [{ modifiers: ['Ctrl'], key: 'A' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-end', [{ modifiers: ['Ctrl'], key: 'E' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.setHotkeys('universal-cursor-hotkeys:kill-line', [{ modifiers: ['Ctrl'], key: 'K' }])
			hm.setHotkeys('universal-cursor-hotkeys:keyboard-quit', [{ modifiers: ['Ctrl'], key: 'G' }])
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
		await browser.waitUntil(async () => {
			return browser.executeObsidian(({ app }) => {
				return (app as any).plugins.plugins['universal-cursor-hotkeys'].titleScope !== null
			})
		}, { timeout: 8000, interval: 50, timeoutMsg: 'title Scope never pushed' })
	}

	async function pressCtrl(key: string) {
		await browser.executeObsidian(({ app, obsidian }, key2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.dispatchEvent(new KeyboardEvent('keydown', { key: key2, ctrlKey: true, bubbles: true, cancelable: true }))
		}, key)
		await browser.pause(120)
	}

	async function snap() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const doc = title.ownerDocument
			const sel = doc.getSelection()!
			return {
				activeIsTitle: doc.activeElement === title,
				anchorOffset: sel.anchorOffset,
				focusOffset: sel.focusOffset,
				selectedText: sel.toString(),
				titleText: title.textContent,
			}
		})
	}

	// Which visual line the FOCUS currently renders on, identified by its
	// own collapsed-at-focus rect's top (same technique titleMoveLine's
	// own titleFocusRects uses internally) — robust to the exact
	// character offsets, which vary with the test window's own width.
	async function focusTop() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const doc = title.ownerDocument
			const sel = doc.getSelection()!
			if (!sel.focusNode) return null
			const r = doc.createRange()
			r.setStart(sel.focusNode, sel.focusOffset)
			r.collapse(true)
			const rect = r.getClientRects()[0]
			return rect ? Math.round(rect.top) : null
		})
	}

	it('(1) Ctrl-F/B extend a native selection from a fixed anchor, Ctrl-A/E extend to the line boundary', async function () {
		await openNote('SetMarkAlpha.md', 'body text', 0) // title: "SetMarkAlpha"

		await pressCtrl(' ') // Set-mark at offset 0
		await pressCtrl('f')
		await pressCtrl('f')
		let s = await snap()
		await expect(s.anchorOffset).toBe(0)
		await expect(s.focusOffset).toBe(2)
		await expect(s.selectedText).toBe('Se')

		await pressCtrl('e') // extend to the title's own end
		s = await snap()
		await expect(s.anchorOffset).toBe(0)
		await expect(s.selectedText).toBe('SetMarkAlpha')

		await pressCtrl('a') // extend back to the title's own start — collapses, since anchor is also 0
		s = await snap()
		await expect(s.anchorOffset).toBe(0)
		await expect(s.focusOffset).toBe(0)
		await expect(s.selectedText).toBe('')
	})

	it('(2) Ctrl-P/N extend through a wrapped title\'s own visual lines, one at a time, from a fixed anchor', async function () {
		await openNote(
			'SetMarkWrappedAVeryLongFilenameThatShouldForceTheInlineTitleFieldToWrapAcrossMultipleVisualLinesForTestingPurposesXXXXXXXXXXXXXXXXXXXX.md',
			'body text', 0,
		)

		await pressCtrl(' ') // Set-mark at offset 0
		const downOffsets: number[] = []
		for (let i = 0; i < 5; i++) { // one extra press past the title's own end, to confirm it stabilizes rather than escaping
			await pressCtrl('n')
			downOffsets.push((await snap()).focusOffset)
		}
		// Monotonically non-decreasing (one visual line at a time — the
		// direct regression case for the getRangeAt(0)-vs-focus bug above,
		// which made every one of these a silent no-op), reaching a real
		// max partway through and then staying there (stable, not
		// escaping to the body) — not asserting the exact offsets/VL
		// count themselves, since the test window's own width (and so
		// exactly where this title wraps) isn't perfectly reproducible
		// across separate E2E runs.
		for (let i = 1; i < downOffsets.length; i++) {
			await expect(downOffsets[i]).toBeGreaterThanOrEqual(downOffsets[i - 1])
		}
		await expect(new Set(downOffsets).size).toBeGreaterThan(1) // real movement happened, not stuck at the very first press
		const maxOffset = Math.max(...downOffsets)
		await expect(downOffsets[downOffsets.length - 1]).toBe(maxOffset) // converged
		await expect(downOffsets[downOffsets.length - 2]).toBe(maxOffset) // ...and stayed (confirms a boundary stop, not still climbing)

		const afterDown = await snap()
		await expect(afterDown.anchorOffset).toBe(0) // anchor never moved
		await expect(afterDown.activeIsTitle).toBe(true) // never escaped to the body

		for (let i = 0; i < 6; i++) await pressCtrl('p')
		const afterUp = await snap()
		await expect(afterUp.anchorOffset).toBe(0)
		await expect(afterUp.focusOffset).toBe(0) // retraced all the way back to the anchor itself
		await expect(afterUp.selectedText).toBe('')
	})

	it('(2b) Ctrl-P/N still extends correctly after a same-line extend in the OPPOSITE direction (Ctrl-F then Ctrl-P, Ctrl-B then Ctrl-N)', async function () {
		await openNote(
			'SetMarkReversalAVeryLongFilenameThatShouldForceTheInlineTitleFieldToWrapAcrossMultipleVisualLinesForTestingPurposesXXXXXXXXXXXXXXXXXXXX.md',
			'body text', 0,
		)

		// Get onto VL2 via the already-proven-working marked Ctrl-N chain
		// (test (2) above), then Ctrl-G to settle there as a plain cursor
		// before the actual scenario begins — the exact offset varies by
		// the test window's own width, so this is more robust than
		// hardcoding a specific starting offset.
		await pressCtrl(' ')
		await pressCtrl('n')
		await pressCtrl('g')

		// Direct regression test for a real bug found live: a single
		// Selection.modify('extend', ..., 'line') call, when extending in
		// the direction OPPOSITE the selection's current extension, only
		// retracts focus back to the anchor — it does not continue past
		// it into the new direction until a SECOND call (confirmed live
		// via a direct native-API probe). Without the fix (titleMoveLine
		// re-issuing the modify() call once it detects focus landed
		// exactly on the anchor), both of these silently collapsed the
		// selection back to the Set-mark position instead of moving.
		await pressCtrl(' ') // re-arm the mark at the current (VL2) position
		await pressCtrl('f') // extend right by one char — anchor < focus now
		const afterF = await snap()
		await pressCtrl('p') // reverse direction: must still reach VL1, not collapse to the anchor
		const afterFP = await snap()
		await expect(afterFP.focusOffset).not.toBe(afterF.anchorOffset) // the bug's own exact symptom
		await expect(afterFP.focusOffset).toBeLessThan(afterF.anchorOffset) // genuinely moved up, past the anchor

		await pressCtrl('g')
		await pressCtrl(' ') // re-arm the mark again at the current (VL1) position
		await pressCtrl('b') // extend left by one char — anchor > focus now
		const afterB = await snap()
		await pressCtrl('n') // reverse direction: must still reach VL2, not collapse to the anchor
		const afterBN = await snap()
		await expect(afterBN.focusOffset).not.toBe(afterB.anchorOffset)
		await expect(afterBN.focusOffset).toBeGreaterThan(afterB.anchorOffset)
	})

	it('(2c) a SECOND reversal in a row does not skip an extra visual line (Ctrl-F, Ctrl-P, Ctrl-N chained together)', async function () {
		// Needs 3+ visual lines — (2b)'s own title only wraps across 2,
		// which can't distinguish this bug from (2b)'s own fix (the
		// anchor and the second-reversal's landing line need to be
		// genuinely different lines for this to be a meaningful check).
		await openNote(
			'SetMarkDoubleReversalAVeryLongFilenameThatShouldForceTheInlineTitleFieldToWrapAcrossAtLeastThreeVisualLinesForTestingPurposesXXXXXXXXXXXXXXXXXXXXYYYYYYYYYYYYYYYYYYYYZZZZZZZZZZZZZZZZZZZZ.md',
			'body text', 0,
		)

		// Get onto VL2 (the middle line) via the proven marked Ctrl-N chain.
		await pressCtrl(' ')
		await pressCtrl('n')
		await pressCtrl('g')
		const startTop = await focusTop()

		// Direct regression test for a real bug found live after (2b)'s
		// own fix shipped: that fix unconditionally retried the modify()
		// call whenever the first one retracted focus exactly onto the
		// anchor — correct when the anchor sits on the SAME line we
		// started this call on (a trivial same-line retraction, nothing
		// moved yet), but wrong once a chain of reversals puts the anchor
		// on a genuinely DIFFERENT line: retracting onto it there already
		// IS the real, complete one-line move, and retrying anyway
		// continued past the anchor into a further line, silently
		// skipping one entire visual line on every second reversal.
		await pressCtrl(' ') // re-arm the mark on VL2
		await pressCtrl('f') // extend right by one char
		await pressCtrl('p') // first reversal: up to VL1 ((2b)'s own fix)
		const afterFP = await focusTop()
		await expect(afterFP).not.toBe(startTop) // genuinely left VL2

		await pressCtrl('n') // second reversal: back down — must land on VL2, not skip to VL3
		const afterFPN = await focusTop()
		await expect(afterFPN).toBe(startTop) // back on VL2, not one further

		await pressCtrl('g')
		await pressCtrl(' ') // re-arm the mark at the current position, re-centered on VL2
		await pressCtrl('b') // extend left by one char
		await pressCtrl('n') // first reversal: down to VL3
		const afterBN = await focusTop()
		await expect(afterBN).not.toBe(startTop)

		await pressCtrl('p') // second reversal: back up — must land on VL2, not skip past it to VL1
		const afterBNP = await focusTop()
		await expect(afterBNP).toBe(startTop)
	})

	it('(3) Kill line clears the mark and kills from the cursor (focus), not from the selection\'s own range-start', async function () {
		await openNote('SetMarkKillOrder.md', 'body text', 'SetMarkKillOrder'.length) // cursor at the title's own end

		await pressCtrl(' ') // Set-mark at the title's own end
		await pressCtrl('b')
		await pressCtrl('b')
		await pressCtrl('b')
		await pressCtrl('b') // extends backward 4 chars: anchor=end, focus=end-4, selecting "Order" backward
		const beforeKill = await snap()
		await expect(beforeKill.focusOffset).toBeLessThan(beforeKill.anchorOffset)

		await pressCtrl('k') // Kill line: must operate from focus (the cursor), not the range's own lower-order start
		const markActiveAfterKill = await browser.executeObsidian(({ app }) => {
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean
		})
		await expect(markActiveAfterKill).toBe(false)
		const afterKill = await snap()
		// Kills from focus (end-4) to the title's own end, leaving
		// everything before focus untouched — not from the range's own
		// start (which a naive getRangeAt(0).startOffset read would use
		// instead, deleting the wrong portion whenever anchor > focus).
		await expect(afterKill.titleText).toBe('SetMarkKillO')
	})

	it('(4) Ctrl-G clears the mark and collapses, WITHOUT leaving the title (unlike native Escape)', async function () {
		await openNote('SetMarkCtrlG.md', 'body text', 0)

		await pressCtrl(' ') // Set-mark at offset 0
		await pressCtrl('f')
		await pressCtrl('f')
		const before = await snap()
		await expect(before.selectedText).toBe('Se')

		await pressCtrl('g') // Ctrl-G: set-mark cancellation only
		const markActiveAfter = await browser.executeObsidian(({ app }) => {
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean
		})
		await expect(markActiveAfter).toBe(false)
		const after = await snap()
		await expect(after.selectedText).toBe('')
		await expect(after.anchorOffset).toBe(after.focusOffset) // collapsed, at the (unmoved) focus
		// Deliberately NOT mirroring native physical Escape's own behavior
		// here (confirmed live: it blurs the title entirely, jumping back
		// to wherever the cursor was in the body before the title was
		// ever entered) — Ctrl-G stays in the title with only the
		// mark/selection affected.
		await expect(after.activeIsTitle).toBe(true)
	})
})
