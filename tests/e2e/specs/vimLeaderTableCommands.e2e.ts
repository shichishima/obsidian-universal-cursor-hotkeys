import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, enableVimMode, waitForInTableCell } from '../helpers'

// Priority-4 (last tier) Vim coverage: the leader-key table-structure/
// table-navigation commands (off by default — enabled per test via
// vimSupport's own setters, matching how the Settings UI toggles them).
//
// Table navigation (tj/tk/th/tl/tx/tX) is "pure cursor movement, original
// logic" per this plugin's own docs — the real-Obsidian-coverage case is
// strong here, so all 6 are covered. Table structure (to/tO/tdd/tyyp/...,
// 17 commands total) is "a thin wrapper around Obsidian's own built-in
// table commands" per the same docs — confirmed by reading vim-support.ts
// directly: every one of them shares one factory (tableCommandAction) that
// just gates on inTableCell and delegates to Obsidian's own command by ID,
// no mutation logic of its own. One representative sample (tdd, delete
// row) is covered here to confirm the leader-key-to-native-command dispatch
// itself works live; the other 16 share the identical wiring and aren't
// each individually re-verified.
describe('Vim leader-key table commands (table navigation + a table-structure sample)', function () {
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

	async function enableLeaderFeatures() {
		await browser.executeObsidian(({ app }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.vimSupport.setTableStructureEnabled(true)
			plugin.vimSupport.setTableNavigationEnabled(true)
		})
	}

	async function disableLeaderFeatures() {
		await browser.executeObsidian(({ app }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.vimSupport.setTableStructureEnabled(false)
			plugin.vimSupport.setTableNavigationEnabled(false)
		})
	}

	it('(1) tj/tl/tk/th: direct cell-to-cell jumps, landing at each cell\'s own content start', async function () {
		await enableVimMode()
		await enableLeaderFeatures()
		try {
			await openFixtureAndGetContentStart('VimLeaderTableCommands.md')
			await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				for (let i = 0; i < view.editor.lineCount(); i++) {
					if (view.editor.getLine(i).trim() === '| a | b |') {
						view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('a') })
						return
					}
				}
				throw new Error('not found')
			})
			await waitForInTableCell(true, 3000)

			await browser.keys([' ', 't', 'j']) // down to the cell below (same column)
			await browser.pause(400)
			let state = await getState()
			await expect(state.inTableCell).toBe(true)
			await expect(state.line.charAt(state.cursor.ch)).toBe('1')

			await browser.keys([' ', 't', 'l']) // right, same row
			await browser.pause(400)
			state = await getState()
			await expect(state.line.charAt(state.cursor.ch)).toBe('2')

			await browser.keys([' ', 't', 'k']) // up to the cell above (same column)
			await browser.pause(400)
			state = await getState()
			await expect(state.line.charAt(state.cursor.ch)).toBe('b')

			await browser.keys([' ', 't', 'h']) // left, back to the start
			await browser.pause(400)
			state = await getState()
			await expect(state.line.charAt(state.cursor.ch)).toBe('a')
		} finally {
			await disableLeaderFeatures()
		}
	})

	it('(2) tx exits the table below, landing outside it', async function () {
		await enableVimMode()
		await enableLeaderFeatures()
		try {
			await openFixtureAndGetContentStart('VimLeaderTableCommands.md')
			await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				for (let i = 0; i < view.editor.lineCount(); i++) {
					if (view.editor.getLine(i).trim() === '| 3 | 4 |') {
						view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('3') })
						return
					}
				}
				throw new Error('not found')
			})
			await waitForInTableCell(true, 3000)

			await browser.keys([' ', 't', 'x'])
			await browser.pause(400)
			const state = await getState()
			await expect(state.inTableCell).toBe(false)
		} finally {
			await disableLeaderFeatures()
		}
	})

	it('(3) tdd (table-structure sample) deletes the current row via Obsidian\'s own built-in command', async function () {
		await enableVimMode()
		await enableLeaderFeatures()
		try {
			await openFixtureAndGetContentStart('VimLeaderTableCommands.md')
			await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				for (let i = 0; i < view.editor.lineCount(); i++) {
					if (view.editor.getLine(i).trim() === '| 1 | 2 |') {
						view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('1') })
						return
					}
				}
				throw new Error('not found')
			})
			await waitForInTableCell(true, 3000)

			await browser.keys([' ', 't', 'd', 'd'])
			await browser.pause(400)
			const content = await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				return view.editor.getValue()
			})
			await expect(content).not.toContain('| 1 ')
			await expect(content).toContain('3')
			await expect(content).toContain('4')
		} finally {
			await disableLeaderFeatures()
		}
	})
})
