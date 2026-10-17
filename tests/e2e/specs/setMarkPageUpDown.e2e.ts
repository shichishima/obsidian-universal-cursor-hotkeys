import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, waitForInTableCell } from '../helpers'

// Page Up/Down's own landing position is a real pixel measurement against
// however tall the actual viewport happens to be (see scrollPage in
// main.ts) — not something this suite controls or can hardcode a line
// number for reliably across environments. Every test below that cares
// about "where did it actually land" measures a PLAIN (non-mark) Page
// Down/Up from the same starting point first, on a freshly rebuilt
// identical document, and compares the marked version's own head against
// that measurement — this is also a direct test of the specific "same
// landing position as without Set-mark" requirement the user asked for
// (the escaped-a-table case "consumes" its own distance from the page
// budget, rather than adding extra distance on top of a full page).
//
// Three source/landing combinations, per the user's own policy
// breakdown:
//   (1) outer source, outer landing — any table crossed along the way is
//       swept in atomically (free, via the same pixel-block mechanism
//       Ctrl-N/P's own vertical extend already relies on).
//   (2) outer source, landing inside a table — snaps past that table's
//       own far edge (the one actually being passed through) instead of
//       ending up focused inside a cell.
//   (3) inner source (starting inside a cell) — the current table is
//       swept in as a whole block (anchor snaps to its own back edge),
//       and the head still reaches the exact same spot a plain Page
//       Down/Up from that same cell would.
//
// Multi-cursor is deliberately out of scope (see extendMarkPage's own
// comment in main.ts) — not tested here, same simplification
// extendMarkBufferEdge's own in-cell branch already made for TOP/BOTTOM.
describe('Set-mark: Page Up/Down extend', function () {
	it('(1) outer source, outer landing: head matches a plain Page Down, table crossed along the way included atomically', async function () {
		const buildDoc = () => browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const lines: string[] = []
			for (let i = 0; i < 15; i++) lines.push('line ' + i)
			lines.push('', '| a | b |', '| --- | --- |', '| c | d |', '')
			for (let i = 0; i < 150; i++) lines.push('after ' + i)
			view.editor.setValue(lines.join('\n'))
			view.editor.setCursor({ line: 2, ch: 0 })
		})

		await openFixtureAndGetContentStart('SetMarkPageUpDownOuterOuter.md')
		await buildDoc()
		await browser.executeObsidianCommand('universal-cursor-hotkeys:page-down')
		await browser.pause(300)
		const plainHead = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getCursor()
		})

		await buildDoc()
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:page-down')
		await browser.pause(300)
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
		await expect(after.selection).toEqual([{ anchor: { line: 2, ch: 0 }, head: plainHead }])
	})

	it('(2) outer source, landing inside a table: snaps past that table\'s own far edge', async function () {
		// Table spans lines 6..207 (header + delimiter + 200 rows) — tall
		// enough to contain any reasonable viewport's own page height.
		// The expected head below is computed from this same layout, not
		// hand-counted, to avoid a transcription error — confirmed via
		// the sanity check right below too.
		const tableLastLine = 6 + 2 + 200 - 1
		const tableLastLineText = '| r199 |'
		const buildDoc = () => browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const lines: string[] = []
			for (let i = 0; i < 5; i++) lines.push('line ' + i)
			lines.push('', '| x |', '| --- |')
			for (let i = 0; i < 200; i++) lines.push('| r' + i + ' |')
			lines.push('', 'after the table')
			view.editor.setValue(lines.join('\n'))
			view.editor.setCursor({ line: 0, ch: 0 })
		})

		await openFixtureAndGetContentStart('SetMarkPageUpDownOuterInner.md')
		await buildDoc()
		// Sanity check on the hand-derived layout constants above, before
		// trusting them for the real assertion below.
		const actualLastLineText = await browser.executeObsidian(({ app, obsidian }, line) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getLine(line as number)
		}, tableLastLine)
		await expect(actualLastLineText).toBe(tableLastLineText)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:page-down')
		await browser.pause(300)
		const plain = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return (view.editor as any).inTableCell as boolean
		})
		// Sanity check on the test content itself: the plain landing must
		// actually fall inside the table, or this test isn't exercising
		// the case it claims to.
		await expect(plain).toBe(true)

		await buildDoc()
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:page-down')
		await browser.waitUntil(async () => {
			return await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const sel = view.editor.listSelections()[0]
				return !(view.editor as any).inTableCell &&
					(sel.anchor.line !== sel.head.line || sel.anchor.ch !== sel.head.ch)
			})
		}, { timeout: 5000, interval: 50 })
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
		// Anchor unchanged (outer-sourced). Head is the table's own true
		// last line's own end, not wherever the raw page-height landing
		// fell inside it.
		await expect(after.selection).toEqual([
			{ anchor: { line: 0, ch: 0 }, head: { line: tableLastLine, ch: tableLastLineText.length } },
		])
	})

	it('(3) inner source: current table swept in whole, head still matches a plain Page Down from the same cell', async function () {
		const buildDoc = () => browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const lines: string[] = []
			for (let i = 0; i < 15; i++) lines.push('line ' + i)
			lines.push('', '| a | b |', '| --- | --- |', '| c | d |', '')
			for (let i = 0; i < 150; i++) lines.push('after ' + i)
			view.editor.setValue(lines.join('\n'))
			view.editor.setCursor({ line: 16, ch: 0 }) // header row
		})

		await openFixtureAndGetContentStart('SetMarkPageUpDownInnerSource.md')
		await buildDoc()
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down') // -> header/col1
		await waitForInTableCell(true)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:table-cell-down') // -> row1/col1 ("c")
		await waitForInTableCell(true)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:page-down')
		await browser.pause(300)
		const plainHead = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getCursor()
		})

		await buildDoc()
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-down')
		await waitForInTableCell(true)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:table-cell-down')
		await waitForInTableCell(true)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:page-down')
		// Settling normally takes well under 500ms (confirmed via repeated
		// instrumented runs), but occasionally runs past a 2000ms budget
		// under load — a generous timeout here, not a sign of a real hang.
		await browser.waitUntil(async () => {
			return await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const sel = view.editor.listSelections()[0]
				return !(view.editor as any).inTableCell &&
					(sel.anchor.line !== sel.head.line || sel.anchor.ch !== sel.head.ch)
			})
		}, { timeout: 5000, interval: 50 })
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
		// Anchor snaps to the table's own first line (header, +16), not
		// row1/col1's own exact position (+18) Set-mark was pressed at.
		// Head matches the plain Page Down's own landing exactly —
		// escaping the table consumed part of the page budget rather
		// than adding extra distance on top of a full page.
		await expect(after.selection).toEqual([{ anchor: { line: 16, ch: 0 }, head: plainHead }])
	})
})
