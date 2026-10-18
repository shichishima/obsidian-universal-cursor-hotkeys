import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, waitForInTableCell } from '../helpers'

// Add cursor above/below (addCursorVertically). Native Obsidian's own
// 'editor:add-cursor-below'/'-above' were confirmed (live, via a throwaway
// E2E diagnostic, not kept) to mis-step vertically — skipping a whole
// document line on 'below' and failing to leave the current line at all on
// 'above' — so this command is a from-scratch reimplementation on top of
// CM6's own view.moveVertically instead of delegating to native. The unit
// test suite covers the pure per-call logic against a mocked view; these
// scenarios drive the real command through real CM6 goal-column/pixel
// geometry and the real table-cell inner view, which a mock can't verify.
//
// Content layout, relative to the first line after the fixture's own ---
// separator (see tests/e2e/vaults/smoke/AddCursorAboveBelow.md):
//   +0: #### 1. Outer: column clamp + stacking (both directions)
//   +1: this is a somewhat long line of text here
//   +2: short
//   +3: another longer line of text here too
//   +4: tiny
//   +5: yet another fairly long line indeed right
//   +6: (blank)
//   +7: #### 2. Inner: table cell sub-line above/below + stacking + boundary
//   +8: (blank)
//   +9: | long | b |
//  +10: | --- | --- |
//  +11: | alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar | y |
//  +12: (blank)
//  +13: #### 3. Set-mark interaction
//  +14: line one here
//  +15: line two here
//  +16: line three here
//  +17: line four here
//  +18: line five here
//  +19: (blank)
//  +20: #### 4. Outer: buffer end boundary
//  +21: last line of this document

async function readHeads() {
	return browser.executeObsidian(({ app, obsidian }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
		const editor = view.editor as any
		const sel = editor.cm.state.selection
		return {
			mainIndex: sel.mainIndex,
			heads: sel.ranges.map((r: any) => ({ line: editor.offsetToPos(r.head).line, ch: editor.offsetToPos(r.head).ch })),
		}
	})
}

// A command run against a table cell's own inner view can leave an async
// Obsidian-internal resync pending — addCursorVertically's own in-cell
// branch defers itself by 2 animation frames to beat it (see its own doc
// comment in main.ts), so a caller must wait the same 2 frames before
// reading the result, same convention as exitTableSmartHome.e2e.ts's own
// "deterministic double-rAF wait".
async function settle() {
	await browser.executeObsidian(() => new Promise<void>(resolve => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	}))
}

describe('Add cursor above/below', function () {
	it('(1) outer: column clamp + stacking through lines of varying length, both directions', async function () {
		const l = await openFixtureAndGetContentStart('AddCursorAboveBelow.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2 + 1, ch: 20 })
		}, l)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:add-cursor-below')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:add-cursor-below')

		const after = await readHeads()
		await expect(after.heads).toEqual([
			{ line: l + 1, ch: 20 },
			{ line: l + 2, ch: 5 },  // clamped to the end of "short"
			{ line: l + 3, ch: 20 }, // long enough again: the original pixel goal un-clamps
		])
		await expect(after.mainIndex).toBe(2) // the latest addition is primary

		// Reverse direction, from a fresh position.
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2 + 3, ch: 20 })
		}, l)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:add-cursor-above')

		const afterUp = await readHeads()
		await expect(afterUp.heads).toEqual([
			{ line: l + 2, ch: 5 }, // clamped to the end of "short"
			{ line: l + 3, ch: 20 },
		])
		await expect(afterUp.mainIndex).toBe(0)
	})

	it('(2) inner: table cell sub-line above/below, stacking, and boundary no-ops', async function () {
		const l = await openFixtureAndGetContentStart('AddCursorAboveBelow.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2 + 10, ch: 0 }) // the table's own delimiter row
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down') // -> row1/col1, the long wrapped cell
		await waitForInTableCell(true, 5000)
		// waitForInTableCell(true) confirms the flag flipped, but the
		// landing dispatch itself can still race ahead of Obsidian's own
		// table-widget rendering settling (same race exitTableSmartHome.e2e.ts
		// documents for its own double-rAF wait) — confirmed live here too
		// (intermittent: editor.activeCM read back as the outer view with
		// no wait).
		await settle()

		const innerHeads = async () => browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const inner = (view.editor as any).activeCM
			return inner.state.selection.ranges.map((r: any) => r.head)
		})

		await browser.executeObsidianCommand('universal-cursor-hotkeys:add-cursor-above')
		await settle()
		await expect(await innerHeads()).toEqual([0]) // already the cell's own first sub-line: no-op

		await browser.executeObsidianCommand('universal-cursor-hotkeys:add-cursor-below')
		await settle()
		await expect(await innerHeads()).toEqual([0, 74])

		await browser.executeObsidianCommand('universal-cursor-hotkeys:add-cursor-below')
		await settle()
		await expect(await innerHeads()).toEqual([0, 74, 93]) // 93 = end of the cell's own content

		await browser.executeObsidianCommand('universal-cursor-hotkeys:add-cursor-below')
		await settle()
		await expect(await innerHeads()).toEqual([0, 74, 93]) // already the cell's own last sub-line: no-op
	})

	it('(3) Set-mark interaction: a newly added cursor joins mark-extension on the next Ctrl-N/P', async function () {
		const l = await openFixtureAndGetContentStart('AddCursorAboveBelow.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2 + 14, ch: 4 })
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')

		const readRanges = async () => browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const editor = view.editor as any
			const sel = editor.cm.state.selection
			return sel.ranges.map((r: any) => ({ anchor: editor.offsetToPos(r.anchor), head: editor.offsetToPos(r.head) }))
		})
		const readMarkActive = async () => browser.executeObsidian(({ app }) => {
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive
		})

		await expect(await readRanges()).toEqual([
			{ anchor: { line: l + 14, ch: 4 }, head: { line: l + 16, ch: 4 } },
		])

		await browser.executeObsidianCommand('universal-cursor-hotkeys:add-cursor-below')

		await expect(await readRanges()).toEqual([
			{ anchor: { line: l + 14, ch: 4 }, head: { line: l + 16, ch: 4 } }, // untouched
			{ anchor: { line: l + 17, ch: 4 }, head: { line: l + 17, ch: 4 } }, // fresh, not-yet-extended mark point
		])
		await expect(await readMarkActive()).toBe(true)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')

		await expect(await readRanges()).toEqual([
			{ anchor: { line: l + 14, ch: 4 }, head: { line: l + 17, ch: 4 } }, // extended one more line
			{ anchor: { line: l + 17, ch: 4 }, head: { line: l + 18, ch: 4 } }, // the new cursor extended too
		])
	})

	// Only the END direction is tested at the buffer's own real edge here —
	// every fixture in this suite carries a heading + description block
	// above its own --- separator, so "the first line after ---" is never
	// genuinely the whole document's own first line, and a true "nothing
	// above at all" case can't be built from this shared helper. The START
	// direction's own no-op guard is the exact same code path regardless of
	// direction (addCursorVertically's `stepped.head === primary.head`
	// check), already covered directly by the unit test suite, and the
	// real moveVertically clamp-to-start behavior itself was confirmed live
	// via a throwaway diagnostic (not kept) against a real standalone file.
	it('(4) outer: buffer end boundary — lands there once, no-ops on a second press', async function () {
		const l = await openFixtureAndGetContentStart('AddCursorAboveBelow.md')

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2 + 21, ch: 5 })
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:add-cursor-below')
		const afterEnd1 = await readHeads()
		await expect(afterEnd1.heads).toEqual([
			{ line: l + 21, ch: 5 },
			{ line: l + 21, ch: 26 }, // end of "last line of this document"
		])
		await browser.executeObsidianCommand('universal-cursor-hotkeys:add-cursor-below')
		const afterEnd2 = await readHeads()
		await expect(afterEnd2.heads).toEqual(afterEnd1.heads) // no-op: already at the buffer's own end
	})
})
