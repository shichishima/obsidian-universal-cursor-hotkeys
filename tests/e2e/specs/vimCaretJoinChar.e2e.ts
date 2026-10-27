import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart, enableVimMode, waitForInTableCell } from '../helpers'

// Priority-3 Vim motion coverage: h/l/x (grapheme-aware, cell-boundary
// clamped), ^/I (Smart home reuse), J (Smart join reuse). First real-
// Obsidian coverage for any of these (same rationale as Priority 1/2
// above) — these specific ones were never table-cell-crossing-complex
// enough to need their own dedicated real-Obsidian test until now.
describe('Vim motions: h/l/x (grapheme+cell clamp), ^/I (Smart home reuse), J (Smart join reuse)', function () {
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

	it('(1) l steps over a whole emoji grapheme in one move, then crosses the cell boundary at the true edge', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimCaretJoinChar.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).includes('😀abc')) {
					view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('😀') })
					return
				}
			}
			throw new Error('cell not found')
		})
		await waitForInTableCell(true, 3000)
		const startCh = (await getState()).cursor.ch

		await browser.keys(['l']) // over the emoji (2 UTF-16 units) as one grapheme step
		await browser.pause(200)
		let state = await getState()
		await expect(state.cursor.ch).toBe(startCh + 2) // skipped both surrogate halves together
		await expect(state.line.charAt(state.cursor.ch)).toBe('a')

		await browser.keys(['l', 'l']) // a -> b -> c, the cell's own last character
		await browser.pause(200)
		state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line.charAt(state.cursor.ch)).toBe('c')

		await browser.keys(['l']) // crosses into the adjacent cell on the same row
		await browser.pause(300)
		state = await getState()
		await expect(state.inTableCell).toBe(true)
		await expect(state.line.charAt(state.cursor.ch)).toBe('y')

		await browser.keys(['l']) // last cell of the last row -> exits the table entirely
		await browser.pause(300)
		state = await getState()
		await expect(state.inTableCell).toBe(false)
	})

	it('(2) x deletes a whole emoji grapheme, not one surrogate half of it', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimCaretJoinChar.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).includes('😀abc')) {
					view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('😀') })
					return
				}
			}
			throw new Error('cell not found')
		})
		await waitForInTableCell(true, 3000)

		await browser.keys(['x'])
		await browser.pause(300)
		const state = await getState()
		await expect(state.line).toContain('abc')
		await expect(state.line).not.toContain('😀')
		// No leftover broken surrogate half rendered as U+FFFD or similar —
		// deleting at the emoji's own start landed exactly on "a", the very
		// next real character, not stranded mid-surrogate-pair. (Not a
		// length check: Obsidian's own table auto-formatter can add column
		// padding once this table's been touched by an earlier test in this
		// same spec file, confirmed live — same gotcha as vimJkGgGjGk.e2e.ts.)
		await expect(state.line.charAt(state.cursor.ch)).toBe('a')
	})

	it('(3) ^ (Smart home reuse) skips the leading checkbox marker to reach content start', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimCaretJoinChar.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			for (let i = 0; i < view.editor.lineCount(); i++) {
				if (view.editor.getLine(i).includes('checkbox item')) {
					view.editor.setCursor({ line: i, ch: view.editor.getLine(i).indexOf('item') })
					return
				}
			}
			throw new Error('line not found')
		})
		// browser.keys(['^']) does not reliably reach codemirror-vim's own
		// keymap for this particular shifted-digit character via WebDriverIO
		// — confirmed live (stayed completely motionless even from an
		// unambiguous mid-line position). A synthetic keydown with the
		// correct key/code/shiftKey triple does, matching how real browsers
		// report this physical key combo.
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
				key: '^', code: 'Digit6', shiftKey: true, bubbles: true, cancelable: true,
			}))
		})
		await browser.pause(200)
		const state = await getState()
		await expect(state.line.slice(state.cursor.ch)).toBe('checkbox item')
	})

	it('(4) J (Smart join reuse) strips the next line\'s list marker when Smart join is on', async function () {
		await enableVimMode()
		await openFixtureAndGetContentStart('VimCaretJoinChar.md')
		await browser.executeObsidian(({ app }) => {
			;(app as any).plugins.plugins['universal-cursor-hotkeys'].settings.smartJoin = true
		})
		try {
			await browser.executeObsidian(({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				for (let i = 0; i < view.editor.lineCount(); i++) {
					if (view.editor.getLine(i).trim() === 'alpha') {
						view.editor.setCursor({ line: i, ch: 0 })
						return
					}
				}
				throw new Error('line not found')
			})
			await browser.keys(['J'])
			await browser.pause(200)
			const state = await getState()
			// "- beta gamma" with its own "- " marker stripped, single space
			// inserted — not vim's own default (whitespace-only) join, which
			// would have left "alpha - beta gamma".
			await expect(state.line).toBe('alpha beta gamma')
		} finally {
			await browser.executeObsidian(({ app }) => {
				;(app as any).plugins.plugins['universal-cursor-hotkeys'].settings.smartJoin = false
			})
		}
	})
})
