import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'
import { openFixtureInPopoutAndGetContentStart, closePopoutWindow } from '../helpers'

// Regression coverage for a confirmed real bug found via an E2E_POPOUT
// full-suite sweep (see tests/E2E.md): the native copy/cut/paste/Backspace/
// Delete/Escape markActive-clearing listeners (main.ts's
// registerWindowDomListeners) were registered once against the main
// window's own document at plugin load time — a popout window's own,
// separate document never got the same listeners, so none of these native
// actions cleared markActive while editing inside a popout. Fixed by
// re-registering the same listeners on every window as it opens
// (app.workspace.on('window-open', ...)).
//
// Unlike setMarkNativeClipboardAndDelete.e2e.ts/setMarkEscapeKeydown.e2e.ts
// (which this mirrors for the main window), this spec always runs — it
// doesn't need E2E_POPOUT=1, since it opens its own popout directly via
// openFixtureInPopoutAndGetContentStart regardless of that env var. The
// popout it opens is closed in `after`, switching back to the main window
// so later specs in this suite's own shared instance aren't left running
// against a stale popout.
//
// Content layout relative to the fixture's own --- separator (see
// tests/e2e/vaults/smoke/SetMarkPopoutNativeClearing.md):
//   +0: alpha bravo charlie delta echo     (copy — non-destructive)
//   +1: foxtrot golf hotel india juliett   (cut)
//   +2: kilo lima mike november oscar      (paste)
//   +3: papa quebec romeo sierra tango     (Backspace)
//   +4: uniform victor whiskey xray yankee (Delete)
//   +5: quebec romeo sierra tango uniform  (Escape)
describe('Set-mark native clearing inside a popout window', function () {
	after(async function () {
		await closePopoutWindow()
	})

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

	it('native copy clears markActive inside a popout window', async function () {
		const l = await openFixtureInPopoutAndGetContentStart('SetMarkPopoutNativeClearing.md')
		await armMark(0, l)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			cm.contentDOM.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true }))
		})
		await expectMarkCleared()
	})

	it('native cut clears markActive inside a popout window', async function () {
		const l = await openFixtureInPopoutAndGetContentStart('SetMarkPopoutNativeClearing.md')
		await armMark(1, l)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			cm.contentDOM.dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true }))
		})
		await expectMarkCleared()
	})

	it('native paste clears markActive inside a popout window', async function () {
		const l = await openFixtureInPopoutAndGetContentStart('SetMarkPopoutNativeClearing.md')
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

	it('native Backspace clears markActive inside a popout window', async function () {
		const l = await openFixtureInPopoutAndGetContentStart('SetMarkPopoutNativeClearing.md')
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

	it('native Delete clears markActive inside a popout window', async function () {
		const l = await openFixtureInPopoutAndGetContentStart('SetMarkPopoutNativeClearing.md')
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

	it('native Escape clears markActive inside a popout window', async function () {
		const l = await openFixtureInPopoutAndGetContentStart('SetMarkPopoutNativeClearing.md')
		await armMark(5, l)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
				key: 'Escape', bubbles: true, cancelable: true,
			}))
		})
		await expectMarkCleared()
	})
})
