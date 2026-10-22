import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, enableVimMode, waitForInTableCell } from '../helpers'

// Priority-1 Vim motion coverage: j/k, gj/gk, gg/G, $ sticky goal — all scoped
// to table-crossing/table-cell behavior, since outside tables these are
// vanilla codemirror-vim, unmodified. Existing unit tests for these
// (vimMoveByLinesInCell.test.ts, vimMoveByDisplayLinesInCell.test.ts, etc.)
// mock CM6 entirely; this suite is the first REAL-Obsidian coverage —
// catching things a mock can't: real table-widget rendering, real
// goal-column pixel math, real async table-entry timing.
//
// A real production gotcha hit while writing this suite (2026-10-22, not
// kept as its own test): every table here needs a blank line before it.
// Obsidian's Live Preview table widget does not render without one when
// the preceding line is plain text (or even a heading) directly above with
// no blank line — confirmed by querying for `.cm-table-widget` elements in
// the DOM. Skipping that blank line looks like "vim's own `j` can't enter a
// table at all" (zero movement, repeatable, not a timing issue — tried
// longer pauses and repeated presses) when it's actually "there's no table
// to enter in the first place." Every fixture in this suite keeps that
// blank line deliberately.
describe('Vim motions: j/k, gj/gk, gg/G, $ sticky (table-crossing)', function () {
	function getState() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const editor = view.editor as any
			return {
				cursor: view.editor.getCursor(),
				inTableCell: editor.inTableCell as boolean,
				line: view.editor.getLine(view.editor.getCursor().line),
			}
		})
	}

	async function setCursorOnExactLine(exact: string, ch: number) {
		await browser.executeObsidian(({ app, obsidian }, exact2, ch2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).trim() === exact2) {
					view.editor.setCursor({ line: i, ch: ch2 })
					return
				}
			}
			throw new Error(`line "${exact2}" not found`)
		}, exact, ch)
	}

	it('(1) j crosses outer -> table header row -> data row -> outer, preserving column', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimJkGgGjGk.md')
		await setCursorOnExactLine('alpha bravo charlie', 6)
		// Captured live rather than hardcoded: Obsidian's own table auto-
		// formatter can rewrite this fixture's column padding on disk the
		// first time its table is rendered/touched, shifting raw ch offsets
		// — confirmed live (the same table read back with different padding
		// across separate fresh-file-open runs in this same suite). Cell
		// *content* equality (.toContain) and "did the column survive the
		// round trip" (compared against this starting value) are the only
		// padding-independent things worth asserting here.
		const startCh = (await getState()).cursor.ch

		await browser.keys(['j']) // skip the blank line before the table
		await browser.pause(250)
		await browser.keys(['j']) // enter the table's header row
		await browser.pause(300)
		let state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line).toContain('short')

		await browser.keys(['j']) // cross to the data row
		await browser.pause(300)
		state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line).toContain('one')

		await browser.keys(['j']) // exit below, onto the blank line
		await browser.pause(300)
		await browser.keys(['j']) // onto the trailing plain-text line
		await browser.pause(300)
		state = await getState()
		await expect(state.inTableCell).toBe(false)
		await expect(state.line).toBe('delta echo foxtrot')
		await expect(state.cursor.ch).toBe(startCh) // original column preserved throughout
	})

	it('(2) gj/gk move through a cell\'s own real <br>-separated sub-lines, then cross the row boundary', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimJkGgGjGk.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).includes('alpha<br>bravo')) {
					const ch = view.editor.getLine(i).indexOf('alpha') + 2
					view.editor.setCursor({ line: i, ch })
					return
				}
			}
			throw new Error('cell not found')
		})
		await waitForInTableCell(true, 3000)

		await browser.keys(['g', 'j'])
		await browser.pause(250)
		let state = await getState()
		await expect(state.line).toContain('bravo charlie')

		await browser.keys(['g', 'j'])
		await browser.pause(250)
		state = await getState()
		await expect(state.line).toContain('delta echo')

		await browser.keys(['g', 'k'])
		await browser.pause(250)
		await browser.keys(['g', 'k'])
		await browser.pause(250)
		state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line).toContain('alpha')

		// One more gk from the cell's own first sub-line crosses the row
		// boundary, landing in the row above (same convention as plain k).
		await browser.keys(['g', 'k'])
		await browser.pause(300)
		state = await getState()
		await expect(state.line).toBe('| long | b |')
	})

	it('(3) gg/G reach the real document start/end', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimJkGgGjGk.md')
		await setCursorOnExactLine('line two', 3)

		await browser.keys(['g', 'g'])
		await browser.pause(200)
		let state = await getState()
		await expect(state.cursor.line).toBe(0)

		await browser.keys(['G'])
		await browser.pause(200)
		state = await getState()
		const lastLine = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.lastLine()
		})
		await expect(state.cursor.line).toBe(lastLine)
	})

	it('(4) $ sticky goal survives a j crossing a table row, landing at each cell\'s own end', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimJkGgGjGk.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).includes('short')) {
					view.editor.setCursor({ line: i, ch: 2 })
					return
				}
			}
			throw new Error('not found')
		})
		await waitForInTableCell(true, 3000)

		await browser.keys(['$'])
		await browser.pause(150)
		let state = await getState()
		await expect(state.line).toContain('short')
		// End of the "short" cell's own content — padding-independent:
		// wherever "short" actually sits in the (possibly auto-formatted)
		// line, $ should land right after it.
		await expect(state.cursor.ch).toBe(state.line.indexOf('short') + 'short'.length - 1)

		await browser.keys(['j'])
		await browser.pause(300)
		state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line).toContain('one')
		// Sticky goal carried the "this cell's own end" intent forward across
		// the row crossing, landing at the end of "one" (not "short"'s own
		// raw ch, and not clamped to column 1's width from the row above).
		await expect(state.cursor.ch).toBe(state.line.indexOf('one') + 'one'.length - 1)
	})
})
