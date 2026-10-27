import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// Native copy/cut/paste/Backspace/Delete are not this plugin's own
// commands, so none of them reach any command callback that could clear
// markActive itself — the same gap bare Escape had before
// setMarkEscapeKeydown.e2e.ts's own listener, and fixed the same way: a
// purely passive document-level listener (no preventDefault/
// stopPropagation) that only clears markActive as a side effect, leaving
// every one of these native actions completely untouched otherwise.
//
// Confirmed live (scratch testing, not kept) that CM6's own contentDOM-level
// copy/cut/paste handling never calls stopPropagation, so a plain
// bubble-phase document listener sees all three after CM6's own handling
// completes. Backspace/Delete are different: CM6's own keymap handling
// also lives on contentDOM and runs before any bubble-phase document
// listener, so reading "was there a selection" at that point would already
// see the post-deletion, collapsed state — but this clear is deliberately
// unconditional (same precedent as this plugin's own Delete char command,
// which also clears markActive regardless of whether a selection existed),
// so that ordering doesn't matter here.
//
// Content layout relative to the fixture's own --- separator (see
// tests/e2e/vaults/smoke/SetMarkNativeClipboardAndDelete.md) — one line per
// case, so a destructive test (cut/paste/Backspace/Delete) never affects a
// later test's own line even if an earlier edit persists:
//   +0: alpha bravo charlie delta echo   (copy — non-destructive)
//   +1: foxtrot golf hotel india juliett (cut)
//   +2: kilo lima mike november oscar    (paste)
//   +3: papa quebec romeo sierra tango   (Backspace)
//   +4: uniform victor whiskey xray yankee (Delete)
describe('Set-mark: native clipboard/delete keys clear markActive without claiming the key', function () {
	async function armMark(lineOffset: number, l: number) {
		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 0 })
		}, l + lineOffset)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:set-mark')
		await browser.executeObsidianCommand('universal-cursor-hotkeys:cursor-right') // arm a real (non-empty) selection
		const markActive = await browser.executeObsidian(({ app }) => {
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean
		})
		await expect(markActive).toBe(true)
	}

	async function expectMarkCleared() {
		const markActive = await browser.executeObsidian(({ app }) => {
			return (app as any).plugins.plugins['universal-cursor-hotkeys'].markActive as boolean
		})
		await expect(markActive).toBe(false)
	}

	it('native copy clears markActive', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkNativeClipboardAndDelete.md')
		await armMark(0, l)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			cm.contentDOM.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true }))
		})
		await expectMarkCleared()
	})

	it('native cut clears markActive', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkNativeClipboardAndDelete.md')
		await armMark(1, l)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			cm.contentDOM.dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true }))
		})
		await expectMarkCleared()
	})

	it('native paste clears markActive', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkNativeClipboardAndDelete.md')
		await armMark(2, l)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			const dt = new DataTransfer()
			dt.setData('text/plain', 'x')
			cm.contentDOM.dispatchEvent(new ClipboardEvent('paste', {
				bubbles: true, cancelable: true, clipboardData: dt,
			}))
		})
		await expectMarkCleared()
	})

	it('native Backspace clears markActive', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkNativeClipboardAndDelete.md')
		await armMark(3, l)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
				key: 'Backspace', bubbles: true, cancelable: true,
			}))
		})
		await expectMarkCleared()
	})

	it('native Delete clears markActive', async function () {
		const l = await openFixtureAndGetContentStart('SetMarkNativeClipboardAndDelete.md')
		await armMark(4, l)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
				key: 'Delete', bubbles: true, cancelable: true,
			}))
		})
		await expectMarkCleared()
	})
})
