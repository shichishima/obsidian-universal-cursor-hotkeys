import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, frontmatter sub-phase: title<->body crossing (already
// shipped, see titleCrossingShort.e2e.ts/titleCrossingWrapped.e2e.ts) now
// routes through the Properties panel instead, whenever the note actually
// has frontmatter — confirmed live, this exposed a real pre-existing bug
// unrelated to the new feature: both crossing sites (escapeUpToTitle's
// own call site, and titleMoveLineOrEscapeToBody) hardcoded "line 0"/
// position 0 as "the body's own first line." When frontmatter exists,
// position 0 is the frontmatter's own opening `---`, not real body
// content — Live Preview silently clamps any attempt to place a cursor
// there to the real first body line, so the old `cursor.line === 0`
// check could never be satisfied and Ctrl-P at the top of a
// frontmatter-having note's body did nothing at all. getFirstBodyLine()
// (reads frontmatterPosition from the file's cached metadata) fixes this
// for both crossing directions, and is also what lets each one decide
// whether to land in the Properties panel instead of jumping straight to
// the title/body.
describe('Title<->Properties<->Body crossing, with frontmatter present', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function openNote(path: string) {
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app }, path2) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, `---
myText: hello world
myNumber: 42
---
body line one
body line two
`)
			await app.workspace.getLeaf(true).openFile(file)
		}, path)
		await browser.pause(400)
	}

	async function pressOnActive(key: string, ctrl = true) {
		await browser.executeObsidian(({ app, obsidian }, { key2, ctrl2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			doc.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: key2, ctrlKey: ctrl2, bubbles: true, cancelable: true }))
		}, { key2: key, ctrl2: ctrl })
		await browser.pause(150)
	}

	async function snap() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const sel = doc.getSelection()
			return {
				className: active?.className ?? null,
				isTitle: active === title,
				titleSelectionText: active === title ? sel?.toString() : undefined,
				titleIsCollapsed: active === title ? sel?.isCollapsed : undefined,
				// Checked regardless of which element currently has DOM
				// focus — a stale native Selection can keep pointing into
				// the title even once focus has genuinely moved elsewhere
				// (see titleMoveLineOrEscapeToBody's own fix comment).
				nativeSelectionRangeCount: sel?.rangeCount ?? 0,
				nativeSelectionStillInTitle: sel?.anchorNode ? title.contains(sel.anchorNode) : false,
			}
		})
	}

	it('(1) Title, Ctrl-N at its own last visual line, escapes to the Properties heading (not straight to the body)', async function () {
		await openNote('TitleCrossFmHeading.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.focus()
			;(title.ownerDocument.getSelection() as any)?.modify('move', 'forward', 'documentboundary')
		})
		await browser.pause(80)

		await pressOnActive('n')
		const after = await snap()
		await expect(after.className).toContain('metadata-properties-heading')
		// Real user-reported bug: focusing the heading alone does NOT
		// clear window.getSelection() — it silently kept pointing at the
		// title's own old position, which a third-party title-caret
		// plugin reading the native Selection directly (confirmed live
		// with a real one) kept rendering a stale cursor from, until the
		// Selection changed again elsewhere entirely. Fixed by explicitly
		// clearing it (removeAllRanges()) in the same branch that moves
		// focus to the heading.
		await expect(after.nativeSelectionStillInTitle).toBe(false)
		await expect(after.nativeSelectionRangeCount).toBe(0)
	})

	it('(2) Properties heading, Ctrl-P, lands a COLLAPSED cursor in the title — not native ArrowUp\'s own select-the-whole-title', async function () {
		await openNote('TitleCrossFmCollapsed.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const heading = view.containerEl.querySelector('.metadata-properties-heading') as HTMLElement
			heading.focus()
		})
		await browser.pause(80)

		await pressOnActive('p')
		const after = await snap()
		await expect(after.isTitle).toBe(true)
		await expect(after.titleIsCollapsed).toBe(true)
		await expect(after.titleSelectionText).toBe('')
	})

	it('(2b) regression: Ctrl-N right back out of the title (after arriving via heading Ctrl-P) escapes on the FIRST press, not the second', async function () {
		// Real user-reported bug: sel.collapse(title, title.childNodes.length)
		// (test (2)'s own original landing code) put the selection's
		// focus/anchor on the title's own container DIV — an ELEMENT,
		// child-index-based position — rather than its text node, the
		// same bug class already found and fixed for titleYank's own
		// newline handling. titleMoveLine (which titleMoveLineOrEscapeToBody
		// calls first, to decide whether there's "more title left to move
		// through") misjudged that element-anchored position as "there's
		// still room to move," silently eating the first Ctrl-N press
		// before a second one finally escaped. Fixed by having
		// propertyHeadingEscapeToTitle use Selection.modify('move',
		// 'forward', 'documentboundary') instead, which always lands on a
		// real text node.
		await openNote('TitleCrossFmHeadingRoundTrip.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const heading = view.containerEl.querySelector('.metadata-properties-heading') as HTMLElement
			heading.focus()
		})
		await browser.pause(80)

		await pressOnActive('p') // heading -> title
		const selAfterCtrlP = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const sel = view.containerEl.ownerDocument.getSelection()!
			return { focusNodeType: sel.focusNode?.nodeType }
		})
		await expect(selAfterCtrlP.focusNodeType).toBe(3) // Node.TEXT_NODE, not the title's own container element

		await pressOnActive('n') // title -> heading, must work on this FIRST press
		const after = await snap()
		await expect(after.className).toContain('metadata-properties-heading')
	})

	it('(3) Body\'s real first line ch0, Ctrl-P, escapes to the Properties Add-button (fixes a real pre-existing bug: used to do nothing at all)', async function () {
		await openNote('TitleCrossFmAddButton.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.focus()
			// Deliberately {line:0, ch:0} — with frontmatter present, Live
			// Preview itself clamps this to the real first body line; this
			// is exactly the scenario that used to silently no-op.
			view.editor.setCursor({ line: 0, ch: 0 })
		})
		await browser.pause(80)

		await pressOnActive('p')
		const after = await snap()
		await expect(after.className).toContain('metadata-add-button')
	})

	it('(3b) regression: Ctrl-P at body top lands on the Properties heading (not the title) when the panel is COLLAPSED', async function () {
		// Real user-reported bug: collapsing the Properties panel hides
		// the Add-button (and every row) — confirmed live, offsetParent
		// becomes null for both — but the heading itself stays visible,
		// just gaining an "is-collapsed" class. The original fix for test
		// (3) only ever checked the Add-button's own visibility, so a
		// collapsed (but still genuinely present) Properties panel fell
		// all the way through to escapeUpToTitle, skipping Properties
		// entirely even though it still visibly exists. Fixed by falling
		// back to the heading when the Add-button isn't usable but the
		// heading still is.
		await openNote('TitleCrossFmCollapsedPanel.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const heading = view.containerEl.querySelector('.metadata-properties-heading') as HTMLElement
			const collapseIndicator = heading.querySelector('.collapse-indicator') as HTMLElement | null
			collapseIndicator?.click()
		})
		await browser.pause(200)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.focus()
			view.editor.setCursor({ line: 0, ch: 0 })
		})
		await browser.pause(80)

		await pressOnActive('p')
		const after = await snap()
		await expect(after.className).toContain('metadata-properties-heading')
		await expect(after.isTitle).toBe(false)
	})

	it('(4) regression: a note WITHOUT frontmatter is completely unaffected — Ctrl-P at body ch0 still escapes straight to the title', async function () {
		createdPaths.push('TitleCrossNoFm.md')
		// Bundled into one executeObsidian call — confirmed live (same as
		// propertyItemSelection.e2e.ts's own enterItemSelectionMode fix)
		// that splitting note-open, cursor setup, and the key press across
		// separate round trips can race with the note still settling,
		// intermittently landing the Ctrl-P press's effect somewhere
		// unexpected.
		const after = await browser.executeObsidian(async ({ app, obsidian }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const path = 'TitleCrossNoFm.md'
			const existing = app.vault.getFileByPath(path)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path, 'first body line\nsecond body line')
			await app.workspace.getLeaf(true).openFile(file)
			await new Promise(r => setTimeout(r, 400))

			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			view.editor.focus()
			view.editor.setCursor({ line: 0, ch: 0 })
			await new Promise(r => setTimeout(r, 80))
			doc.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }))
			await new Promise(r => setTimeout(r, 150))

			const active = doc.activeElement as HTMLElement | null
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const sel = doc.getSelection()
			return {
				isTitle: active === title,
				titleIsCollapsed: active === title ? sel?.isCollapsed : undefined,
			}
		})
		await expect(after.isTitle).toBe(true)
		await expect(after.titleIsCollapsed).toBe(true) // unchanged existing behavior — a collapsed landing, never select-all
	})

	it('(5) regression: in Source Mode, frontmatter is treated as plain text — no Properties routing, title<->body crossing still works at the file\'s literal line 0', async function () {
		// Real user-reported bug: getFirstBodyLine() unconditionally read
		// frontmatterPosition regardless of editing mode. Source Mode has
		// no Properties GUI panel at all (frontmatter is just plain text
		// there), but frontmatterPosition still exists in the file's
		// cached metadata even in Source Mode — so the body's own literal
		// line 0 (the opening ---) never satisfied
		// `cursor.line === firstBodyLine` (which pointed past it), and the
		// title's own Ctrl-N landed INSIDE line 0 instead of stopping
		// there, since the "is there a heading to land on" check also
		// read frontmatter position unconditionally. Fixed by having
		// getFirstBodyLine() return 0 unconditionally outside Live
		// Preview — Source Mode gets zero special-casing, exactly
		// matching a frontmatter-less note's own existing behavior.
		createdPaths.push('TitleCrossSourceMode.md')
		const result = await browser.executeObsidian(async ({ app, obsidian }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const path = 'TitleCrossSourceMode.md'
			const existing = app.vault.getFileByPath(path)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path, `---
myText: hello world
---
body line one
body line two
`)
			const leaf = app.workspace.getLeaf(true)
			await leaf.openFile(file, { state: { mode: 'source', source: true } })
			await new Promise(r => setTimeout(r, 400))

			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement

			function press(key: string, ctrl = true) {
				doc.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: ctrl, bubbles: true, cancelable: true }))
			}
			async function wait(ms = 150) { await new Promise(r => setTimeout(r, ms)) }

			// Title, Ctrl-N -> must land at the file's literal line 0 (the
			// opening ---), NOT skip ahead past it into real body content.
			title.focus()
			await wait(80)
			;(doc.getSelection() as any)?.modify('move', 'forward', 'documentboundary')
			await wait(80)
			press('n')
			await wait()
			const afterTitleCtrlN = { line0Text: view.editor.getLine(0), cursor: view.editor.getCursor() }

			// File's literal line 0 ch0, Ctrl-P -> must escape to the title.
			view.editor.focus()
			view.editor.setCursor({ line: 0, ch: 0 })
			await wait(80)
			press('p')
			await wait()
			const active = doc.activeElement
			const sel = doc.getSelection()
			const afterBodyCtrlP = { isTitle: active === title, titleIsCollapsed: active === title ? sel?.isCollapsed : undefined }

			return { afterTitleCtrlN, afterBodyCtrlP }
		})
		await expect(result.afterTitleCtrlN.line0Text).toBe('---')
		await expect(result.afterTitleCtrlN.cursor.line).toBe(0)
		await expect(result.afterBodyCtrlP.isTitle).toBe(true)
		await expect(result.afterBodyCtrlP.titleIsCollapsed).toBe(true)
	})

	it('(6) regression: a wide goal column survives the escape to the title even after crossing a short line (e.g. frontmatter\'s own "---") right before escaping', async function () {
		// Real user-reported bug, a pre-existing mechanism bug surfaced
		// (not introduced) by frontmatter's own short "---" lines making
		// it far more likely to hit: the cursor-up handler read CM6's own
		// goalColumn AFTER calling execPreservingGoalColumn(editor,
		// 'goUp'), but confirmed live that CM6 itself RESETS goalColumn
		// to null the moment 'goUp' hits "nowhere further to go" (already
		// at the document's own absolute top line) — exactly the moment
		// escaping to the title needs it most. A wide goal column
		// established several Ctrl-P presses back (e.g. starting on a
		// long body line) was silently lost the instant the cursor
		// crossed frontmatter's own short "---" line right before
		// escaping, landing in the title at a narrow column instead of
		// the original wide one. Fixed by capturing goalColumn BEFORE
		// the exec call, not after.
		createdPaths.push('TitleCrossGoalColumn.md')
		const result = await browser.executeObsidian(async ({ app, obsidian }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const path = 'TitleCrossGoalColumn.md'
			const existing = app.vault.getFileByPath(path)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path, `---
myText: hello world
---
a wide body line with plenty of characters
second body line
`)
			// Source Mode, to match the exact repro: line 0 ("---") is a
			// genuinely short line there (in Live Preview it's a widget,
			// not a real short line to cross on the way up).
			const leaf = app.workspace.getLeaf(true)
			await leaf.openFile(file, { state: { mode: 'source', source: true } })
			await new Promise(r => setTimeout(r, 400))

			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement

			function press(key: string, ctrl = true) {
				doc.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: ctrl, bubbles: true, cancelable: true }))
			}
			async function wait(ms = 150) { await new Promise(r => setTimeout(r, ms)) }

			// Line 3 (file-relative) = the wide body line. Establish a
			// wide goal column there, then walk all the way up through
			// line 2 ("---"), line 1 ("myText: ..."), line 0 ("---"),
			// and finally escape to the title.
			view.editor.focus()
			view.editor.setCursor({ line: 3, ch: 10 })
			await wait(100)
			for (let i = 0; i < 4; i++) {
				press('p')
				await wait(150)
			}

			const sel = doc.getSelection()
			const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
			return {
				isTitle: doc.activeElement === title,
				titleFocusOffset: sel?.focusOffset,
				titleRectLeft: range ? range.getBoundingClientRect().left : null,
			}
		})
		await expect(result.isTitle).toBe(true)
		// Confirmed live (narrow regression margin, not an exact pixel
		// match — font metrics vary): the pre-fix landing was ch=2 at
		// this exact repro; the fix lands around ch=5, reflecting the
		// much wider original goal column rather than collapsing back to
		// the "---" line's own 3-character width.
		await expect(result.titleFocusOffset).toBeGreaterThan(3);
	})

	it('(7) a wide goal column survives a full round trip THROUGH the Properties panel (body -> title, then back down to body), matching the no-frontmatter behavior', async function () {
		// User-requested symmetry fix, not a bug report: before this,
		// crossing via the Properties panel always landed at a FIXED
		// position on the far side (the title's own end going up, ch=0
		// going down) instead of preserving the goal column the way the
		// existing no-frontmatter body<->title crossing already does.
		// propertyGoalX stores the goal in the body's own screen-pixel
		// space regardless of which direction it's traveling, converting
		// to title-space only at the final landing point
		// (propertyHeadingEscapeToTitle) using the same gutter-
		// normalization formula escapeUpToTitle already uses; the
		// reverse direction (propertyAddButtonEscapeToBody) seeds CM6's
		// own native goalColumn the same way titleMoveLineOrEscapeToBody
		// already does.
		createdPaths.push('TitleCrossFmGoalRoundTrip.md')
		await browser.executeObsidian(async ({ app, obsidian }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const path = 'TitleCrossFmGoalRoundTrip.md'
			const existing = app.vault.getFileByPath(path)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path, `---
myText: hello world
---
a wide body line with plenty of characters
second body line
`)
			await app.workspace.getLeaf(true).openFile(file)
		})
		await browser.pause(400)
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.focus()
			// Body's real first line (single-property frontmatter above),
			// with a wide goal column established on it.
			view.editor.setCursor({ line: 3, ch: 10 })
		})
		await browser.pause(80)

		// Walk all the way up through the add-button, the one property
		// row, and the heading, finally escaping to the title.
		for (let i = 0; i < 4; i++) {
			await pressOnActive('p')
		}
		const atTitle = await snap()
		await expect(atTitle.isTitle).toBe(true)
		// Not the title's own end (12 chars, "hello" the note name has no
		// bearing here — just confirming this isn't a degenerate 0/end
		// fallback): a real mid-title landing derived from the preserved
		// goal column.
		const titleLanding = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			const sel = title.ownerDocument.getSelection()
			return { focusOffset: sel?.focusOffset, titleLength: title.textContent?.length }
		})
		await expect(titleLanding.focusOffset).toBeGreaterThan(0)
		await expect(titleLanding.focusOffset).toBeLessThan(titleLanding.titleLength!)

		// Walk back down the same way, through the heading, the one
		// property row, and the add-button, back into the body — must
		// land at the EXACT original position, not just "the first body
		// line."
		for (let i = 0; i < 4; i++) {
			await pressOnActive('n')
		}
		const backInBody = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getCursor()
		})
		await expect(backInBody.line).toBe(3)
		await expect(backInBody.ch).toBe(10)
	})
})
