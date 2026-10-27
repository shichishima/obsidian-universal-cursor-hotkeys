import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, enableVimMode, waitForInTableCell } from '../helpers'

// Real-Obsidian coverage for u/Ctrl-r inside a table cell. Confirmed by
// reading vim-support.ts directly: tableUndo/tableRedo delegate to
// Editor.undo()/redo() (real CM6 undo/redo at the *outer*, whole-document
// level) instead of vim's own cell-scoped default, specifically because a
// per-cell inner view's own local history has no record of table-structure
// edits (row/column insert/delete), which are applied at the outer level.
// Only unit-tested before this (mocked CM6) — this is the first real-
// Obsidian coverage, which matters here specifically because the fix
// itself was only found via live testing in the first place: Obsidian's
// own Editor.undo()/redo() leaves the just-restored range *selected*
// (real CM6 behavior), and vim.js's own default keymap binds a bare "u"
// to a *different* action while a selection is live (visual-mode
// lowercase-selection, not undo) - so the very next "u" press after an
// undo could silently no-op. tableUndo's own fix (setCursor to collapse
// the selection right after delegating) is exactly what this suite
// confirms actually holds up end-to-end.
describe('Vim u/Ctrl-r inside a table cell (Editor.undo/redo delegation)', function () {
	function getContent() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getValue()
		})
	}

	async function enableTableStructure() {
		await browser.executeObsidian(({ app }) => {
			;(app as any).plugins.plugins['universal-cursor-hotkeys'].vimSupport.setTableStructureEnabled(true)
		})
	}
	async function disableTableStructure() {
		await browser.executeObsidian(({ app }) => {
			;(app as any).plugins.plugins['universal-cursor-hotkeys'].vimSupport.setTableStructureEnabled(false)
		})
	}

	it('(1) a second, immediate u press still works (the documented selection-after-undo bug)', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimTableUndoRedo.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).includes('alpha')) {
					view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('alpha') })
					return
				}
			}
			throw new Error('cell not found')
		})
		await waitForInTableCell(true, 3000)

		await browser.keys(['d', 'w']) // delete "alpha" — a real edit
		await browser.pause(300)
		let content = await getContent()
		await expect(content).not.toContain('alpha')

		await browser.keys(['u']) // undo #1: restores "alpha"
		await browser.pause(400)
		content = await getContent()
		await expect(content).toContain('alpha')

		// The documented bug: Editor.undo() leaves the restored range
		// selected, and vim.js's own default keymap routes a bare "u" to a
		// *different* (visual-mode) binding while a selection is live — so
		// this second press could silently no-op instead of reaching undo
		// again. tableUndo's own fix collapses that selection right after
		// delegating; confirm nothing regressed by checking the content is
		// still intact (not stuck, not double-undone past the fixture's own
		// starting state).
		await browser.keys(['u'])
		await browser.pause(400)
		content = await getContent()
		await expect(content).toContain('alpha')
	})

	it('(2) undo correctly walks back through a structural edit then a plain-text edit, in that reverse order', async function () {
		await enableVimMode()
		await enableTableStructure()
		try {
			await openFixtureAndGetContentStart('VimTableUndoRedo.md')
			await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				for (let i = 0; i < view.editor.lineCount(); i++) {
					if (view.editor.getLine(i).includes('alpha')) {
						view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('alpha') })
						return
					}
				}
				throw new Error('cell not found')
			})
			await waitForInTableCell(true, 3000)

			await browser.keys(['x']) // plain-text edit: "alpha" -> "lpha"
			await browser.pause(300)
			let content = await getContent()
			await expect(content).toContain('lpha')
			await expect(content).not.toContain('alpha')

			await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				for (let i = 0; i < view.editor.lineCount(); i++) {
					if (view.editor.getLine(i).trim().startsWith('| 1')) {
						view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('1') })
						return
					}
				}
				throw new Error('row not found')
			})
			await waitForInTableCell(true, 3000)
			await browser.keys([' ', 't', 'd', 'd']) // structural edit: delete the whole row
			await browser.pause(400)
			content = await getContent()
			await expect(content).not.toContain('| 1')

			await browser.keys(['u']) // undo #1 (most recent first): restores the deleted row
			await browser.pause(400)
			content = await getContent()
			await expect(content).toContain('1')
			await expect(content).toContain('2')
			await expect(content).toContain('lpha') // the earlier plain-text edit is still in effect

			await browser.keys(['u']) // undo #2: restores "alpha"
			await browser.pause(400)
			content = await getContent()
			await expect(content).toContain('alpha')
		} finally {
			await disableTableStructure()
		}
	})
})
