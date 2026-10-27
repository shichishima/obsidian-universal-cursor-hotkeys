import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, enableVimMode, waitForInTableCell } from '../helpers'

// Priority-2 Vim motion coverage: w/b/e (and by extension W/B/E/ge/gE, which
// share the exact same moveByWords override, distinguished only by
// motionArgs — see vim-support.ts's own doc comment) — scoped to table-
// crossing/CJK behavior. Outside tables, with Latin-only text, these are
// vanilla codemirror-vim, unmodified; this suite is the first real-Obsidian
// coverage of the parts that aren't.
describe('Vim motions: w/b/e (word motions, table-crossing + CJK)', function () {
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

	async function setCursorOnLineContaining(needle: string, atSubstring: string) {
		await browser.executeObsidian(({ app, obsidian }, needle2, sub2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				const line = view.editor.getLine(i)
				if (line.includes(needle2)) {
					view.editor.setCursor({ line: i, ch: line.indexOf(sub2) })
					return
				}
			}
			throw new Error(`line containing "${needle2}" not found`)
		}, needle, atSubstring)
	}

	it('(1) w crosses a cell\'s own <br> sub-lines, then the adjacent cell, then the next row, then exits the table', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimWordMotions.md')
		await setCursorOnLineContaining('alpha<br>bravo', 'alpha')
		await waitForInTableCell(true, 3000)

		await browser.keys(['w']) // alpha -> bravo, crossing the <br> as one unit
		await browser.pause(300)
		let state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line.slice(state.cursor.ch, state.cursor.ch + 5)).toBe('bravo')

		await browser.keys(['w']) // bravo -> gamma, same sub-line
		await browser.pause(300)
		state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line.slice(state.cursor.ch, state.cursor.ch + 5)).toBe('gamma')

		await browser.keys(['w']) // gamma -> delta, crossing to the adjacent cell on the same row
		await browser.pause(300)
		state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line.slice(state.cursor.ch, state.cursor.ch + 5)).toBe('delta')

		await browser.keys(['w']) // delta -> echo, crossing to the next row's first cell
		await browser.pause(300)
		state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line.slice(state.cursor.ch, state.cursor.ch + 4)).toBe('echo')

		await browser.keys(['w']) // echo -> foxtrot, same row's last cell
		await browser.pause(300)
		state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line.slice(state.cursor.ch, state.cursor.ch + 7)).toBe('foxtrot')

		await browser.keys(['w']) // foxtrot -> exits the table entirely
		await browser.pause(300)
		state = await getState()
		await expect(state.inTableCell).toBe(false)
	})

	it('(2) b crosses the same boundaries backward', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimWordMotions.md')
		await setCursorOnLineContaining('foxtrot', 'foxtrot')
		await waitForInTableCell(true, 3000)

		await browser.keys(['b']) // foxtrot -> echo, same row
		await browser.pause(300)
		let state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line.slice(state.cursor.ch, state.cursor.ch + 4)).toBe('echo')

		await browser.keys(['b']) // echo -> delta, crossing up to the previous row's last cell
		await browser.pause(300)
		state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line.slice(state.cursor.ch, state.cursor.ch + 5)).toBe('delta')

		await browser.keys(['b']) // delta -> gamma, crossing back into the first cell
		await browser.pause(300)
		state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line.slice(state.cursor.ch, state.cursor.ch + 5)).toBe('gamma')
	})

	it('(3) e lands on the word\'s own end, not its start', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimWordMotions.md')
		await setCursorOnLineContaining('alpha<br>bravo', 'alpha')
		await waitForInTableCell(true, 3000)

		await browser.keys(['e'])
		await browser.pause(300)
		const state = await getState()
		await expect(state.line.charAt(state.cursor.ch)).toBe('a') // last char of "alpha"
		await expect(state.line.charAt(state.cursor.ch - 4)).toBe('a') // first char of "alpha", 4 back
	})

	it('(4) w through a CJK cell uses dictionary segmentation, not one whole run', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimWordMotions.md')
		await setCursorOnLineContaining('日本語の文章です', '日本語')
		await waitForInTableCell(true, 3000)
		const startCh = (await getState()).cursor.ch

		await browser.keys(['w'])
		await browser.pause(300)
		const state = await getState()
		// A script-boundary-only (vanilla vim) classifier would treat the
		// whole "日本語の文章です" run as one word and jump straight past
		// it (to the next cell). Dictionary segmentation instead stops
		// partway through it, at "の" — confirmed live: landed well short
		// of the run's own end.
		await expect(state.inTableCell).toBe(true)
		await expect(state.cursor.ch).toBeGreaterThan(startCh)
		await expect(state.line.charAt(state.cursor.ch)).toBe('の')
	})
})
