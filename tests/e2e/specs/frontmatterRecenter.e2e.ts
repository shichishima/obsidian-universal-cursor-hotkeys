import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, recenter follow-up: Ctrl-L (recenter/recenter-top-bottom),
// previously wired only to the note body and Bases table cell-selection,
// now also works anywhere in the Properties panel (row, heading,
// Add-button, every value-edit widget, the key-edit input).
//
// Confirmed live before implementing (not assumed) that `.metadata-container`
// sits INSIDE the SAME `.cm-scroller` the note body itself scrolls through
// -- scrolling far down in the body scrolls the Properties panel out of
// view right along with it, unlike Bases' own separate `.bases-view`
// scroller. So the exact same scroll primitive this plugin's own
// scrollToCursorAtY uses for the body's cursor applies here unchanged,
// just targeting the focused property element's own getBoundingClientRect()
// instead of the CM6 cursor's screen position (see scrollElementToY /
// recenterPropertyPanel / recenterTopBottomPropertyPanel in src/main.ts).
// recenter/recenter-top-bottom's own bind() calls were broadened from
// BASES_TABLE_CONTAINER_SELECTOR-only to PROPERTY_PANEL_SCOPE_SELECTOR,
// branching internally to the existing recenterBases/recenterTopBottomBases
// for a Bases container specifically.
//
// Centering the FIRST property row specifically is geometrically
// unachievable in most realistic layouts -- it sits too close to the very
// top of the whole document (nothing can ever be "above" frontmatter) for
// scrollTop to reach a true center without going negative, so it clamps
// to 0 instead (the exact same boundary behavior this plugin's own
// recenter already has for the note body near document start, and Bases
// near the start/end of its own table). These tests use a tall
// frontmatter block (15+ properties) and target its LAST row specifically,
// which has enough document-relative height above it for centering to be
// genuinely achievable -- confirmed live, not assumed.
//
// _recenterStep (the center->top->bottom cyclic counter, shared with the
// body and Bases) has THREE existing reset triggers for the note body
// (a CM6 transaction, or a 'mousedown') plus the Bases/item-selection
// fallback-dispatch fix (a separate, earlier bug) -- but entering/exiting
// a value-edit widget via real DOM focus change, and moving the caret
// WITHIN an already-focused widget, are BOTH new paths this feature
// introduces that neither of those covers. Fixed with two more reset
// points: unconditionally in the document-level 'focusin' handler
// (focus changes never come from recenter itself, which only ever
// scrolls, so this can't self-reset its own cycle), and inside bind()'s
// own valueEditHandler dispatch branch (excluding recenter/
// recenter-top-bottom's own invocation specifically, since both ALSO
// reach that branch for a widget target and would otherwise immediately
// undo their own step advance).
describe('Recenter (Ctrl-L) inside the Properties panel', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function setUp(notePath: string) {
		createdPaths.push(notePath)
		const longBody = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
		const frontmatterProps = Array.from({ length: 15 }, (_, i) => `prop${i}: value${i}`).join('\n')
		await browser.executeObsidian(({ app }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:recenter', [{ modifiers: ['Ctrl'], key: 'L' }])
			hm.setHotkeys('universal-cursor-hotkeys:recenter-top-bottom', [{ modifiers: ['Ctrl', 'Shift'], key: 'L' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:keyboard-quit', [{ modifiers: ['Ctrl'], key: 'G' }])
			hm.bake()
		})
		await browser.executeObsidian(async ({ app }, { notePath2, longBody2, frontmatterProps2 }) => {
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(notePath2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(notePath2, `---\n${frontmatterProps2}\nmyText: hello\n---\n${longBody2}\n`)
			await app.workspace.getLeaf(true).openFile(file)
		}, { notePath2: notePath, longBody2: longBody, frontmatterProps2: frontmatterProps })
		await browser.pause(500)
	}

	async function getStep() {
		return browser.executeObsidian(({ app }) => (app as any).plugins.plugins['universal-cursor-hotkeys']._recenterStep)
	}

	async function lastRowLocalTop() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const cm = (view.editor as any).cm
			const rows = document.querySelectorAll('.metadata-property')
			const row = rows[rows.length - 1] as HTMLElement
			const rect = row.getBoundingClientRect()
			const scrollRect = cm.scrollDOM.getBoundingClientRect()
			return rect.top - scrollRect.top
		})
	}

	it('(1) Ctrl-L centers the focused property row (the last row, geometrically achievable)', async function () {
		await setUp('FrontmatterRecenterCenter.md')

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			;(view.editor as any).cm.scrollDOM.scrollTop = 50
		})
		await browser.pause(200)

		const rows = await browser.$$('.metadata-property')
		await rows[rows.length - 1].click({ x: 2, y: 2 })
		await browser.pause(150)

		const before = await lastRowLocalTop()
		await browser.keys(['Control', 'l'])
		await browser.pause(200)
		const after = await lastRowLocalTop()

		const expectedCenter = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return (view.editor as any).cm.scrollDOM.clientHeight / 2
		})
		await expect(Math.abs(before - expectedCenter)).toBeGreaterThan(20)
		await expect(Math.abs(after - expectedCenter)).toBeLessThan(1)
	})

	it('(2) Ctrl-Shift-L cycles center -> top -> bottom -> center', async function () {
		await setUp('FrontmatterRecenterCycle.md')

		const rows = await browser.$$('.metadata-property')
		await rows[rows.length - 1].click({ x: 2, y: 2 })
		await browser.pause(150)

		await browser.keys(['Control', 'Shift', 'l'])
		await browser.pause(200)
		const center = await lastRowLocalTop()
		const expectedCenter = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return (view.editor as any).cm.scrollDOM.clientHeight / 2
		})
		await expect(Math.abs(center - expectedCenter)).toBeLessThan(1)

		await browser.keys(['Control', 'Shift', 'l'])
		await browser.pause(200)
		const top = await lastRowLocalTop()
		await expect(top).toBeLessThan(center)

		await browser.keys(['Control', 'Shift', 'l'])
		await browser.pause(200)
		const bottom = await lastRowLocalTop()
		await expect(bottom).toBeGreaterThan(center)

		await browser.keys(['Control', 'Shift', 'l'])
		await browser.pause(200)
		const backToCenter = await lastRowLocalTop()
		await expect(Math.abs(backToCenter - expectedCenter)).toBeLessThan(1)
	})

	it('(3) regression: entering/exiting a value-edit widget resets the cycle', async function () {
		await setUp('FrontmatterRecenterFocusReset.md')

		const rows = await browser.$$('.metadata-property')
		const row = rows[rows.length - 1]
		await row.click({ x: 2, y: 2 })
		await browser.keys(['Escape']) // -> item-selection mode (plain row focus, not the widget)
		await browser.pause(150)

		await browser.keys(['Control', 'Shift', 'l']) // step 0 -> queues step 1 next
		await browser.pause(200)
		await expect(await getStep()).toBe(1)

		await browser.keys(['Control', 'f']) // enters the value-edit widget -- a real focus change
		await browser.pause(200)
		await expect(await getStep()).toBe(0)

		await browser.keys(['Control', 'Shift', 'l']) // queues step 1 again
		await browser.pause(200)
		await expect(await getStep()).toBe(1)

		await browser.keys(['Control', 'g']) // exits back to the row -- also a real focus change
		await browser.pause(200)
		await expect(await getStep()).toBe(0)
	})

	it('(4) regression: caret movement within an already-focused widget resets the cycle too', async function () {
		await setUp('FrontmatterRecenterCaretReset.md')

		const rows = await browser.$$('.metadata-property')
		const row = rows[rows.length - 1]
		// Clicking the value text directly lands focus straight inside the
		// value-edit widget without ever touching the row's own
		// item-selection container -- confirmed live this is how a real
		// click actually behaves, and it's exactly the scenario this test
		// needs: no focus CHANGE happens on the next keypress, only a
		// caret move within the same already-focused element.
		const valueEl = await row.$('.metadata-property-value')
		await valueEl.click()
		await browser.pause(150)

		await browser.keys(['Control', 'Shift', 'l']) // step 0 -> queues step 1 next
		await browser.pause(200)
		await expect(await getStep()).toBe(1)

		await browser.keys(['Control', 'f']) // caret move WITHIN the same widget -- no focus change at all
		await browser.pause(200)
		await expect(await getStep()).toBe(0)
	})
})
