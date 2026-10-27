import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// D category of Set-mark's clearing/re-anchoring triggers: a plain click
// clears an active mark once CM6 tags the resulting (empty) selection
// "select.pointer"; a real mouse DRAG leaves a non-empty selection, and
// that selection itself becomes the new region (markActive flips to true,
// no extra anchor-setting needed — the drag's own anchor/head already are
// it); switching the active leaf always clears markActive outright.
//
// Content layout relative to the fixture's own --- separator (see
// tests/e2e/vaults/smoke/SetMarkMouseAndLeafChange.md):
//   +0: alpha bravo charlie delta
//   +1: echo foxtrot golf hotel

function getMarkActive() {
	return browser.executeObsidian(({ app }) => {
		return (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean
	})
}

// All specs in this suite run against one shared Obsidian instance, so
// markActive (plugin-instance state) can leak between these its if a
// prior assertion in this same describe block failed before clearing it
// itself — reset explicitly rather than relying on it already being false.
function resetMarkActive() {
	return browser.executeObsidian(({ app }) => {
		(app as any).plugins.plugins['universal-cursor-hotkeys'].markActive = false
	})
}

function getSelections() {
	return browser.executeObsidian(({ app, obsidian }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
		return view.editor.listSelections()
	})
}

function setCursor(pos: { line: number; ch: number }) {
	return browser.executeObsidian(({ app, obsidian }, pos2) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
		view.editor.setCursor(pos2)
	}, pos)
}

// Dispatches a real DOM mousedown/[mousemove]/mouseup sequence against the
// live CM6 instance, at real on-screen coordinates computed from editor
// positions — not a synthetic transaction — so this exercises CM6's own
// native mouseSelectionStyle handling the same way an actual click/drag
// would (confirmed by reading @codemirror/view's own MouseSelection class:
// it listens for mousemove/mouseup on contentDOM.ownerDocument and only
// treats it as a drag once the two points are more than ~10px apart,
// otherwise resolving to a plain collapsed click on mouseup).
//
// `detail: 1` is required on every event — CM6's own getClickType() reads
// event.detail as the native single/double/triple-click counter, and a
// plain `new MouseEvent(...)` defaults it to 0, which falls through to the
// *triple-click* branch (whole-line selection) instead of a plain single
// click. Confirmed live: without this, a "click" at (line, ch=5) resolved
// as if a triple-click had hit that line, expanding into the next line's
// own start — exactly the ch=0/one-line-further failures first seen here.
function mouseGesture(from: { line: number; ch: number }, to?: { line: number; ch: number }) {
	return browser.executeObsidian(({ app, obsidian }, from2, to2) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
		const cm = (view.editor as any).cm
		const posAt = (p: { line: number; ch: number }) => {
			const offset = view.editor.posToOffset(p)
			const coords = cm.coordsAtPos(offset)!
			return { x: (coords.left + coords.right) / 2, y: (coords.top + coords.bottom) / 2 }
		}
		const start = posAt(from2)
		cm.contentDOM.dispatchEvent(new MouseEvent('mousedown', {
			bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1, clientX: start.x, clientY: start.y,
		}))
		if (to2) {
			const end = posAt(to2)
			document.dispatchEvent(new MouseEvent('mousemove', {
				bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1, clientX: end.x, clientY: end.y,
			}))
			document.dispatchEvent(new MouseEvent('mouseup', {
				bubbles: true, cancelable: true, button: 0, buttons: 0, detail: 1, clientX: end.x, clientY: end.y,
			}))
		} else {
			document.dispatchEvent(new MouseEvent('mouseup', {
				bubbles: true, cancelable: true, button: 0, buttons: 0, detail: 1, clientX: start.x, clientY: start.y,
			}))
		}
	}, from, to)
}

describe('Set-mark clearing/re-anchoring triggers (mouse + active-leaf-change)', function () {
	it('a plain click outside the region clears the mark and collapses the selection', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		await resetMarkActive()

		await setCursor({ line: l, ch: 0 })
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down') // builds a real region first
		await expect(await getMarkActive()).toBe(true)

		// Clicks on the second line, well past the region's own head (col 0) —
		// clearly outside the highlighted selection, so this is an unambiguous
		// plain click, not a click-inside-selection (which CM6 treats as
		// potentially starting a text-drag-move instead).
		await mouseGesture({ line: l + 1, ch: 10 })

		await expect(await getMarkActive()).toBe(false)
		await expect(await getSelections()).toEqual([
			{ anchor: { line: l + 1, ch: 10 }, head: { line: l + 1, ch: 10 } },
		])
	})

	it('a mouse drag leaves a real selection and arms the mark from it', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		await resetMarkActive()

		await mouseGesture({ line: l, ch: 0 }, { line: l + 1, ch: 5 })

		await expect(await getMarkActive()).toBe(true)
		await expect(await getSelections()).toEqual([
			{ anchor: { line: l, ch: 0 }, head: { line: l + 1, ch: 5 } },
		])
	})

	// Regression test: a real mouse-drag selection's own resulting range
	// carries a native goalColumn of -1 (confirmed live, directly off
	// cm.state.selection.main — not undefined/no-goal, and not something
	// this plugin's own code sets), unlike editor.setSelection(), which
	// leaves it unset. moveVertically trusts a present goalColumn as-is, so
	// the very first Ctrl-N/P extend after a drag was landing head at
	// column 0 regardless of where the drag's own head actually was — the
	// selection itself stayed intact, only the column snapped to 0. Fixed
	// in extendMarkVertically by only trusting a non-negative goalColumn
	// (a genuine pixel offset can never be negative).
	it('extending after a mouse drag preserves the drag head\'s own column, same-line and cross-line', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		await resetMarkActive()
		// 3 substantial lines so column-preservation is actually observable
		// (the fixture's own content is too short for this).
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.replaceRange(
				'one two three four five six seven\neight nine ten eleven twelve\nthirteen fourteen fifteen sixteen',
				{ line: l2, ch: 0 },
				{ line: l2 + 1, ch: view.editor.getLine(l2 + 1).length },
			)
		}, l)

		// Same-line drag, then Ctrl-N: column must land well past 0.
		await mouseGesture({ line: l, ch: 5 }, { line: l, ch: 15 })
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')
		const afterSameLineCtrlN = await getSelections()
		await expect(afterSameLineCtrlN[0].anchor).toEqual({ line: l, ch: 5 })
		await expect(afterSameLineCtrlN[0].head.line).toBe(l + 1)
		await expect(afterSameLineCtrlN[0].head.ch).toBeGreaterThan(10) // was 0 before the fix

		// Cross-line drag, then Ctrl-P as the FIRST action (not chained
		// after a Ctrl-N) — also regressed independently before the fix.
		await resetMarkActive()
		await mouseGesture({ line: l + 1, ch: 5 }, { line: l + 2, ch: 10 })
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-up')
		const afterCrossLineCtrlP = await getSelections()
		await expect(afterCrossLineCtrlP[0].anchor).toEqual({ line: l + 1, ch: 5 })
		await expect(afterCrossLineCtrlP[0].head.line).toBe(l + 1)
		await expect(afterCrossLineCtrlP[0].head.ch).toBeGreaterThan(5) // was 0 before the fix
	})

	it('switching the active leaf clears the mark', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		await resetMarkActive()

		await setCursor({ line: l, ch: 0 })
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await expect(await getMarkActive()).toBe(true)

		await browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getFileByPath('Welcome.md')!
			await app.workspace.getLeaf(true).openFile(file)
		})

		await expect(await getMarkActive()).toBe(false)
	})
})
