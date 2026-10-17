import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, waitForInTableCell } from '../helpers'

// "Exit table below" (table-exit-down) used to always land at raw ch=0 on
// the line it exits to, even with Smart Home on, because the landing call
// passed a hardcoded ch=1 probe to getBeginningOfLinePosition instead of the
// target line's own length — Smart Home's skip check only succeeds when the
// matched Markdown prefix is shorter than the probe, and every realistic
// prefix (checkbox, list marker, heading, blockquote) is at least 2 chars.
// Fixed by passing the line's own length instead (see exitTable in
// table-navigation.ts). Covers just the landing position, not the
// also-fixed gj/gk flash on the same kind of line — that's frame-level
// visual timing, not reliably detectable through WDIO's own polling
// granularity, so it's left to manual verification (see tests/E2E.md).
//
// Content layout, relative to the first line after the fixture's own ---
// separator (see tests/e2e/vaults/smoke/ExitTableSmartHome.md). The blank
// line before the table is required for Obsidian's own markdown parser to
// recognize it as a table at all (same requirement as
// multiCursorTableCrossing.e2e.ts) — no blank line after it, though:
// exitTable lands on whatever line is immediately below the table, blank or
// not, so a blank line there would make it land on that instead of the
// checkbox line this test actually wants to land on (confirmed live).
//   +0: foo
//   +1: (blank)
//   +2: | a | b |
//   +3: | --- | --- |
//   +4: | c | d |
//   +5: - [ ] task
describe('Exit table below — Smart Home landing', function () {
	it('lands after the checkbox marker, not at raw ch=0', async function () {
		const l = await openFixtureAndGetContentStart('ExitTableSmartHome.md')

		// A plain editor.setCursor() from outside the table doesn't reliably
		// flip inTableCell to true (same caveat exitTable's own code already
		// documents) — enter for real via the plugin's own DOWN command
		// instead, landing in the header row's leftmost cell.
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2 + 1, ch: 0 }) // the blank line right above the table
		}, l)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')
		await waitForInTableCell(true)
		// waitForInTableCell(true) above confirms the inTableCell flag has
		// flipped, but table-exit-down's own landing dispatch (see
		// setCursorAcrossTableBoundary in main.ts) still raced ahead of
		// Obsidian's table-widget rendering often enough to flake with no
		// wait at all here (confirmed: 50%+ failure rate across two
		// independent batches). A plain blind browser.pause(...) worked
		// (even 10ms was enough across repeated isolated runs) but a
		// double requestAnimationFrame wait is the deterministic
		// equivalent — confirmed just as reliable (20/20 isolated runs) and
		// still genuinely catches the underlying fix being disabled
		// (red/green-verified).
		await browser.executeObsidian(() => new Promise<void>(resolve => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		}))

		await browser.executeObsidianCommand('universal-cursor-hotkeys:table-exit-down')

		const state = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return {
				cursor: view.editor.getCursor(),
				inTableCell: (view.editor as any).inTableCell as boolean,
			}
		})

		await expect(state.cursor).toEqual({ line: l + 5, ch: 6 }) // "- [ ] " is 6 chars
		await expect(state.inTableCell).toBe(false)
	})
})
