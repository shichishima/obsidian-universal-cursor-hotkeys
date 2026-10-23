import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// Real-Obsidian coverage for CJK double-click word selection
// (cjk-word-select.ts) — only unit-tested (mocked CM6) before this. CM6's
// own built-in double-click selection (groupAt) has no word boundary
// within a run of kanji/hiragana/katakana at all — this plugin intercepts
// EditorView.mouseSelectionStyle to use the same Intl.Segmenter-based
// engine Word left/right and Vim w/b/e already use, but needs a REAL mouse
// gesture (detail: 2, matching CM6's own getClickType() reading) to
// exercise at all; a scripted setCursor+command can't reach this code path.
//
// The Emacs/Japanese-mixed line here deliberately reproduces a real,
// previously-fixed bug (confirmed live 2026-08-22, see cjk-word-select.ts's
// own doc comment): an ASCII word embedded in Japanese prose used to not
// get isolated at all, because an earlier version only checked whether the
// *clicked* character itself was CJK — "Emacs" itself has no CJK character
// directly in it, so that check declined to intervene, leaving CM6's own
// native run (merging it with adjacent Japanese) in place. The actual fix
// scans outward to find the native word-class run first, then checks
// whether *that run* contains a CJK character anywhere.
describe('CJK double-click word select (real mouse gesture, dictionary segmentation)', function () {
	function getSelections() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.listSelections()
		})
	}

	function doubleClickAt(pos: { line: number; ch: number }) {
		return browser.executeObsidian(({ app, obsidian }, pos2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			const offset = view.editor.posToOffset(pos2)
			const coords = cm.coordsAtPos(offset)!
			const x = (coords.left + coords.right) / 2
			const y = (coords.top + coords.bottom) / 2
			// detail: 2 is required — CM6's own getClickType() reads
			// event.detail as the native click-count; a plain MouseEvent
			// defaults it to 0, which would misread as a different click
			// type entirely (confirmed by this same pitfall documented in
			// setMarkMouseAndLeafChange.e2e.ts for single-click).
			cm.contentDOM.dispatchEvent(new MouseEvent('mousedown', {
				bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 2, clientX: x, clientY: y,
			}))
			document.dispatchEvent(new MouseEvent('mouseup', {
				bubbles: true, cancelable: true, button: 0, buttons: 0, detail: 2, clientX: x, clientY: y,
			}))
		}, pos)
	}

	// Fixture line: 日本語のEmacsとは異なる扱いです
	// ch:            0  1  2 3 4-8   9 10 11 12 13 14 15 16 17

	it('(1) double-clicking inside "日本語" selects just that word, not the whole run including "の"', async function () {
		const l = await openFixtureAndGetContentStart('CjkDoubleClickWordSelect.md')
		await doubleClickAt({ line: l, ch: 1 }) // inside "本"
		await browser.pause(200)
		const sel = await getSelections()
		await expect(sel).toEqual([{ anchor: { ch: 0, line: l }, head: { ch: 3, line: l } }])
	})

	it('(2) double-clicking "Emacs" (embedded in Japanese prose) isolates just that word — the historical bug case', async function () {
		const l = await openFixtureAndGetContentStart('CjkDoubleClickWordSelect.md')
		await doubleClickAt({ line: l, ch: 6 }) // inside "Emacs"
		await browser.pause(200)
		const sel = await getSelections()
		await expect(sel).toEqual([{ anchor: { ch: 4, line: l }, head: { ch: 9, line: l } }])
	})

	it('(3) double-clicking inside "異なる" (a verb+auxiliary morpheme) selects the whole unit, not split further', async function () {
		const l = await openFixtureAndGetContentStart('CjkDoubleClickWordSelect.md')
		await doubleClickAt({ line: l, ch: 11 }) // "異"
		await browser.pause(200)
		const sel = await getSelections()
		await expect(sel).toEqual([{ anchor: { ch: 11, line: l }, head: { ch: 14, line: l } }])
	})
})
