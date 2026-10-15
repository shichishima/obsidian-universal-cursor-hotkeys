import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// Core multi-cursor + table policy: a table cell renders through a separate
// CM6 EditorView from the outer document, and only one view can hold DOM
// focus at a time — so once the primary range settles on one side of a
// table boundary, any other range left on the opposite side can't coexist
// with it. Covers both halves of that policy via DOWN (Ctrl-N):
//   1. a secondary alone crossing into the table is dropped, primary
//      continues normally in plain text.
//   2. the primary itself crossing collapses the whole selection to one,
//      matching the pre-existing single-cursor table-entry behavior.
//
// Content layout, relative to the first line after the fixture's own ---
// separator (see tests/e2e/vaults/smoke/MultiCursorTableCrossing.md). The
// blank lines around the table are required for Obsidian's own markdown
// parser to recognize it as a table at all (confirmed live: without them,
// isPositionInTable's syntax-tree lookup never sees a Table node):
//   +0: foo          +6: bar
//   +1: (blank)       +7: baz
//   +2: | a | b |     +8: qux
//   +3: | --- | --- |
//   +4: | c | d |
//   +5: (blank)
async function readEditorState() {
	return browser.executeObsidian(({ app, obsidian }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
		return {
			heads: view.editor.listSelections().map(s => ({ line: s.head.line, ch: s.head.ch })),
			inTableCell: (view.editor as any).inTableCell as boolean,
		}
	})
}

async function setPrimaryAndSecondaryThenPressDown(
	contentStart: number,
	primaryOffset: number,
	primaryCh: number,
	secondaryOffset: number,
	secondaryCh: number,
	expectInTableCell: boolean,
) {
	const primary = { line: contentStart + primaryOffset, ch: primaryCh }
	const secondary = { line: contentStart + secondaryOffset, ch: secondaryCh }

	// `editor.setSelections`'s own `main` parameter does NOT set CM6's
	// EditorSelection.mainIndex — confirmed live (it stayed 0 regardless of
	// what was passed). The first range in the array is always main
	// instead, so `primary` must be passed first.
	await browser.executeObsidian(({ app, obsidian }, primary2, secondary2) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
		view.editor.setSelections([{ anchor: primary2 }, { anchor: secondary2 }])
	}, primary, secondary)

	await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')

	// Entering a table cell swaps in a separate inner CM6 view — confirmed
	// live that this lands a frame or two after the command itself
	// (matching this plugin's own "two RAF frames" deferral elsewhere for
	// the same cell-focus reconciliation), so inTableCell can briefly still
	// read stale right after the command. Poll instead of asserting cold.
	let state = await readEditorState()
	await browser.waitUntil(async () => {
		state = await readEditorState()
		return state.inTableCell === expectInTableCell
	}, { timeout: 2000, interval: 100, timeoutMsg: `inTableCell never reached ${expectInTableCell}` }).catch(() => {})
	return state
}

describe('multi-cursor crossing a table boundary (DOWN)', function () {
	it('drops a secondary that alone would cross into the table', async function () {
		const l = await openFixtureAndGetContentStart('MultiCursorTableCrossing.md')

		const { heads, inTableCell } = await setPrimaryAndSecondaryThenPressDown(
			l,
			7, 3, // primary: "baz" — DOWN stays in plain text
			1, 0, // secondary: blank line right above the table — DOWN crosses into it
			false,
		)

		await expect(heads).toEqual([{ line: l + 8, ch: 3 }]) // only primary survives, landed on "qux"
		await expect(inTableCell).toBe(false)
	})

	it('collapses the whole selection to primary when primary crosses into the table', async function () {
		const l = await openFixtureAndGetContentStart('MultiCursorTableCrossing.md')

		const { heads, inTableCell } = await setPrimaryAndSecondaryThenPressDown(
			l,
			1, 0, // primary: blank line right above the table — DOWN crosses into it
			7, 3, // secondary: "baz" — would otherwise stay in plain text
			true,
		)

		await expect(heads.length).toBe(1)
		await expect(heads[0]!.line).toBe(l + 2) // landed on the table's header row
		await expect(inTableCell).toBe(true)
	})
})
