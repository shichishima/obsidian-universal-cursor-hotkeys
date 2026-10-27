import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, waitForInTableCell } from '../helpers'

// TOP/BOTTOM (jumpToBufferEdge) had no markActive check at all, and its own
// dispatch is tagged "move" (not "select") — invisible to the generic
// native-collapse-clearing rule too. Pressing it while marked silently left
// markActive stuck true while the selection jumped to an unrelated
// position, risking a wildly wrong extend on the next Ctrl-B/F/N/P/A/E.
//
// A common real Emacs idiom motivated fixing this properly rather than
// just clearing the mark: Set-mark at a note's own start, then BOTTOM,
// selects the whole note in two keystrokes — the same shape as
// mouse-drag/Shift+Arrow unification already gave this plugin for other
// selection mechanisms.
//
// Content layout relative to the fixture's own --- separator (see
// tests/e2e/vaults/smoke/SetMarkMouseAndLeafChange.md):
//   +0: alpha bravo charlie delta
//   +1: echo foxtrot golf hotel
describe('Set-mark: TOP/BOTTOM extend to the buffer edge', function () {
	it('Set-mark at the note start, then BOTTOM, selects the whole note (the real Emacs idiom)', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkMouseAndLeafChange.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 0 })
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-bottom')

		const after = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return {
				markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
				selection: view.editor.listSelections(),
				lastLine: view.editor.lastLine(),
			}
		})
		await expect(after.markActive).toBe(true)
		await expect(after.selection).toEqual([
			{ anchor: { line: l, ch: 0 }, head: { line: after.lastLine, ch: 0 } },
		])
	})

	// Content layout relative to the fixture's own --- separator (see
	// tests/e2e/vaults/smoke/SetMarkTableSkip.md):
	//   +0: before
	//   +1: (blank)
	//   +2: | a | b |
	//   +3: | --- | --- |
	//   +4: | c | d |
	//   +5: (blank)
	//   +6: after
	it("inside a table cell, BOTTOM still reaches the real document end, exiting the cell and including the whole table in the selection", async function () {
		const l = await openFixtureAndGetContentStart('SetMarkTableSkip.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2 + 1, ch: 0 }) // blank line right above the table
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down') // -> header/col1
		await waitForInTableCell(true)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:table-cell-down') // -> row1/col1 ("c")
		await waitForInTableCell(true)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-bottom')

		// Exiting the cell to the outer view, while keeping the real
		// selection intact, needs two frames of deferral — see
		// extendMarkBufferEdge's own comment in main.ts for why a direct
		// dispatch-then-focus races against Obsidian's own async
		// cell-exit reconciliation (confirmed live: that reconciliation
		// always eventually collapses the selection back to a point once
		// DOM focus actually leaves the cell, regardless of ordering).
		// inTableCell alone flips false on the FIRST (throwaway) dispatch
		// — waiting on it isn't enough, the real anchor/head is only
		// applied two frames later, so this polls for the real,
		// non-collapsed selection itself.
		await browser.waitUntil(async () => {
			return await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const sel = view.editor.listSelections()[0]
				return !(view.editor as any).inTableCell &&
					(sel.anchor.line !== sel.head.line || sel.anchor.ch !== sel.head.ch)
			})
		}, { timeout: 1000, interval: 20 })

		const after = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return {
				markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
				inTableCell: (view.editor as any).inTableCell as boolean,
				selection: view.editor.listSelections(),
				lastLine: view.editor.lastLine(),
			}
		})
		await expect(after.inTableCell).toBe(false)
		await expect(after.markActive).toBe(true)
		// Anchor snaps to the table's own FIRST line (+2, the header row),
		// not row1/col1's own exact position (+4) Set-mark was pressed at
		// — the "whole table, atomic" policy means the header and
		// delimiter rows above the mark are swept in too, not left out.
		// Head is the real document's own end.
		await expect(after.selection).toEqual([
			{ anchor: { line: l + 2, ch: 0 }, head: { line: after.lastLine, ch: 0 } },
		])
	})

	it("inside a table cell, TOP snaps the anchor to the table's own last line, sweeping in rows below the one marked", async function () {
		const l = await openFixtureAndGetContentStart('SetMarkTableSkip.md')
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2 + 1, ch: 0 }) // blank line right above the table
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down') // -> header/col1 ("a")
		await waitForInTableCell(true)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-top')

		await browser.waitUntil(async () => {
			return await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const sel = view.editor.listSelections()[0]
				return !(view.editor as any).inTableCell &&
					(sel.anchor.line !== sel.head.line || sel.anchor.ch !== sel.head.ch)
			})
		}, { timeout: 1000, interval: 20 })

		const after = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return {
				markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
				inTableCell: (view.editor as any).inTableCell as boolean,
				selection: view.editor.listSelections(),
			}
		})
		await expect(after.inTableCell).toBe(false)
		await expect(after.markActive).toBe(true)
		// Anchor snaps to the table's own LAST line (+4, row1), not the
		// header row's own exact position (+2) Set-mark was pressed at —
		// the delimiter row and row1 below the mark are swept in too.
		// Head is the real document's own start.
		await expect(after.selection).toEqual([
			{ anchor: { line: l + 4, ch: 9 }, head: { line: 0, ch: 0 } },
		])
	})

	// Edge case found by the user after the above shipped: a table sitting
	// directly at the document's own start/end, with no buffering blank
	// line, means the throwaway collapse dispatch inside
	// extendMarkBufferEdge's own cell-exit mechanism (see its comment in
	// main.ts) lands on ANOTHER table boundary instead of safe plain text
	// — confirmed live that this leaves editor.inTableCell stuck true
	// permanently (not just transiently), even though the eventual
	// selection's own anchor/head end up numerically correct regardless.
	// Fixed by landing the throwaway collapse one step past the table's
	// own edge (findOffsetPastWholeTableHorizontal) instead of directly on
	// the real target. Uses editor.setValue (not a fixture's own file) to
	// get a table at the literal first/last line with no file-naming
	// convention to satisfy.
	it('a table at the literal start of the note (no leading blank line) still exits and sweeps correctly', async function () {
		await openFixtureAndGetContentStart('SetMarkBufferEdgeTableAtStart.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setValue('| a | b |\n| --- | --- |\n| c | d |\n\nmiddle\n')
			view.editor.setCursor({ line: 0, ch: 0 })
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down') // -> header/col1
		await waitForInTableCell(true)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:table-cell-down') // -> row1/col1 ("c")
		await waitForInTableCell(true)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-top')

		await browser.waitUntil(async () => {
			return await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const sel = view.editor.listSelections()[0]
				return !(view.editor as any).inTableCell &&
					(sel.anchor.line !== sel.head.line || sel.anchor.ch !== sel.head.ch)
			})
		}, { timeout: 1000, interval: 20 })

		const after = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return {
				markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
				inTableCell: (view.editor as any).inTableCell as boolean,
				selection: view.editor.listSelections(),
			}
		})
		await expect(after.inTableCell).toBe(false)
		await expect(after.markActive).toBe(true)
		// Head reaches the true document start (line 0, ch 0 — the
		// table's own literal first character, nothing before it at all).
		await expect(after.selection[0].head).toEqual({ line: 0, ch: 0 })
		// Anchor is the table's own last line (its real, Obsidian-padded
		// width — Live Preview aligns column widths once a table is
		// actually rendered/visited, so this isn't the literal "| c | d |"
		// length).
		await expect(after.selection[0].anchor.line).toBe(2)
	})

	it('a table at the literal end of the note (no trailing blank line) still exits and sweeps correctly', async function () {
		await openFixtureAndGetContentStart('SetMarkBufferEdgeTableAtEnd.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setValue('middle\n\n| a | b |\n| --- | --- |\n| c | d |')
			view.editor.setCursor({ line: 2, ch: 0 })
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down') // -> header/col1
		await waitForInTableCell(true)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:table-cell-down') // -> row1/col1 ("c")
		await waitForInTableCell(true)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-bottom')

		await browser.waitUntil(async () => {
			return await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const sel = view.editor.listSelections()[0]
				return !(view.editor as any).inTableCell &&
					(sel.anchor.line !== sel.head.line || sel.anchor.ch !== sel.head.ch)
			})
		}, { timeout: 1000, interval: 20 })

		const after = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return {
				markActive: (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean,
				inTableCell: (view.editor as any).inTableCell as boolean,
				selection: view.editor.listSelections(),
				lastLine: view.editor.lastLine(),
			}
		})
		await expect(after.inTableCell).toBe(false)
		await expect(after.markActive).toBe(true)
		// Anchor is the table's own first line (header row).
		await expect(after.selection[0].anchor).toEqual({ line: 2, ch: 0 })
		// Head reaches the true document end — the table's own last row,
		// nothing after it at all.
		await expect(after.selection[0].head.line).toBe(after.lastLine)
	})
})
