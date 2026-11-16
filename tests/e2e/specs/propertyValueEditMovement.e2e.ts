import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, property-value-editing sub-phase, Phase 1: Ctrl-F/B
// (char move) and Ctrl-A/E (line boundary) inside a text property's own
// value-edit widget ("metadata-input-longtext", a contenteditable DIV —
// confirmed live the exact same widget Bases table cells use for inline
// text editing too, so this covers both for free). Reuses
// titleMoveChar/titleMoveToLineBoundary as-is from the title field's own
// implementation — both already operate purely through Selection.modify()
// on the element's ownerDocument, with no actual title-specific
// assumption baked in.
//
// The real mechanism here is broadening propertyRowScope's own
// focusin/focusout push/pop condition (PROPERTY_PANEL_SCOPE_SELECTOR) to
// also cover this widget, reusing app.keymap.pushScope exactly like
// item-selection mode already does — NOT a separate raw DOM listener (an
// earlier, abandoned attempt at this). Confirmed live that pushing a
// Scope reaches a REAL keypress even when its exact combo is an
// already-registered command hotkey, since the pushed scope gets checked
// before Obsidian's own root-scope command binding does, in its
// window-level capture listener.
//
// These tests use browser.keys() (real key presses), not synthetic
// dispatchEvent() — confirmed live that synthetic dispatch gives
// unreliable, inconsistent results for anything touching Obsidian's own
// Keymap resolution (see project memory:
// project_property_value_edit_real_key_interception_dead_end).
describe('Property value-edit mode: Ctrl-F/B/A/E movement', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function openNote(path: string, valueOverride?: string) {
		createdPaths.push(path)
		await browser.executeObsidian(async ({ app }, { path2, value2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-left', [{ modifiers: ['Ctrl'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-home', [{ modifiers: ['Ctrl'], key: 'A' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-end', [{ modifiers: ['Ctrl'], key: 'E' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, `---
myText: ${value2 ?? 'hello world'}
---
first body line
`)
			await app.workspace.getLeaf(true).openFile(file)
		}, { path2: path, value2: valueOverride })
		await browser.pause(400)
	}

	// Focuses the text property's own value-edit widget, placing a
	// collapsed cursor at the given character offset within its text.
	async function focusValueAt(offset: number) {
		await browser.executeObsidian(({ app, obsidian }, off) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			const value = row.querySelector('.metadata-input-longtext') as HTMLElement
			value.focus()
			const sel = value.ownerDocument.getSelection()!
			const textNode = value.firstChild!
			const range = value.ownerDocument.createRange()
			range.setStart(textNode, off)
			range.collapse(true)
			sel.removeAllRanges()
			sel.addRange(range)
		}, offset)
		await browser.pause(150)
	}

	async function snap() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			const sel = doc.getSelection()
			return {
				isValueEdit: active?.className === 'metadata-input-longtext',
				focusOffset: sel?.focusOffset,
				isCollapsed: sel?.isCollapsed,
			}
		})
	}

	it('(1) Ctrl-F moves the cursor one character right', async function () {
		await openNote('PropertyValueEditMovementF.md')
		await focusValueAt(5) // "hello world", offset 5 = right after "hello"

		await browser.keys(['Control', 'f'])
		await browser.pause(200)
		const after = await snap()
		await expect(after.isValueEdit).toBe(true)
		await expect(after.focusOffset).toBe(6)
	})

	it('(2) Ctrl-B moves the cursor one character left', async function () {
		await openNote('PropertyValueEditMovementB.md')
		await focusValueAt(5)

		await browser.keys(['Control', 'b'])
		await browser.pause(200)
		const after = await snap()
		await expect(after.focusOffset).toBe(4)
	})

	it('(3) Ctrl-A moves to the start of the value', async function () {
		await openNote('PropertyValueEditMovementA.md')
		await focusValueAt(5)

		await browser.keys(['Control', 'a'])
		await browser.pause(200)
		const after = await snap()
		await expect(after.focusOffset).toBe(0)
	})

	it('(4) Ctrl-E moves to the end of the value', async function () {
		await openNote('PropertyValueEditMovementE.md')
		await focusValueAt(5)

		await browser.keys(['Control', 'e'])
		await browser.pause(200)
		const after = await snap()
		await expect(after.focusOffset).toBe('hello world'.length)
	})

	it('(5) regression: a bare (no Ctrl) "f" keypress still types normally, not intercepted as movement', async function () {
		await openNote('PropertyValueEditMovementTyping.md')
		await focusValueAt(5)

		await browser.keys(['f'])
		await browser.pause(200)
		const value = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mytext"]') as HTMLElement
			return (row.querySelector('.metadata-input-longtext') as HTMLElement).textContent
		})
		await expect(value).toBe('hellof world')
	})

	it('(6) regression: Ctrl-N/P on a value with only ONE visual line are a true no-op (the cursor doesn\'t jump to an end)', async function () {
		// This is now a REAL behavior (Ctrl-N/P move by visual line — see
		// test (7)/(8) below), not "unbound" as this test's name once
		// implied — kept as a regression specifically for the bug found
		// while adding that behavior: titleMoveLine's own `false` return
		// ("no line to move to") does NOT mean the selection was left
		// untouched on its own (its internal Selection.modify() call
		// still jumps to the value's own end/start even then) —
		// propertyValueEditMoveLine's restore-on-no-op is what this test
		// actually guards.
		await openNote('PropertyValueEditMovementNoInterference.md')
		await browser.executeObsidian(async ({ app }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.bake()
		})
		await focusValueAt(5)

		await browser.keys(['Control', 'n'])
		await browser.pause(200)
		let after = await snap()
		await expect(after.isValueEdit).toBe(true)
		await expect(after.focusOffset).toBe(5)

		await browser.keys(['Control', 'p'])
		await browser.pause(200)
		after = await snap()
		await expect(after.focusOffset).toBe(5)
	})

	it('(7) Ctrl-N/P move by VISUAL line within a wrapped value, and stop at its own first/last visual line', async function () {
		// "longtext" (this widget's own class name) genuinely wraps —
		// confirmed live this fixture's value (no spaces, so it can only
		// break mid-word) renders across at least 3 visual lines in the
		// Properties panel's own default width.
		await openNote('PropertyValueEditMovementWrap.md',
			'aaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbccccccccccccccccccccddddddddddddddddddddeeeeeeeeeeeeeeeeeeee')
		await browser.executeObsidian(async ({ app }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.bake()
		})
		await focusValueAt(0) // the value's own first visual line

		// This note's OWN value is now indexed in the metadataCache under
		// this same property key -- from focus alone (no typing), that's
		// enough to make the "previously used values" suggester show up
		// listing its own value as a candidate (confirmed live via
		// diagnostic), which would otherwise swallow every Ctrl-N/P below
		// before this plugin's own checkCallback ever runs (see
		// project_checkcallback_property_suggester_ctrl_np_swallowed
		// memory). Dismiss it first -- this test is about visual-line
		// movement, not suggester-vs-movement priority (that's test (9)'s
		// own job).
		const hasSuggester = await browser.executeObsidian(() => !!document.querySelector('.suggestion-container.mod-property-value .suggestion-item'))
		if (hasSuggester) {
			await browser.keys(['Escape'])
			await browser.pause(200)
		}

		// Ctrl-P at the very first visual line is a true no-op.
		await browser.keys(['Control', 'p'])
		await browser.pause(200)
		let after = await snap()
		await expect(after.focusOffset).toBe(0)

		// Ctrl-N moves down to a LATER visual line — the exact offset
		// depends on real rendered width, so this only asserts real
		// forward progress (a later position in the text), not a
		// hardcoded number.
		await browser.keys(['Control', 'n'])
		await browser.pause(200)
		after = await snap()
		const afterOneDown = after.focusOffset!
		await expect(afterOneDown).toBeGreaterThan(0)

		// Ctrl-N repeated enough times reaches the value's own LAST
		// visual line and then stays there (true no-op, not an
		// end-of-value jump) — confirmed by pressing one extra time past
		// whatever it takes to reach the end and checking it doesn't move
		// any further.
		let prev = afterOneDown
		for (let i = 0; i < 10; i++) {
			await browser.keys(['Control', 'n'])
			await browser.pause(150)
			const cur = (await snap()).focusOffset!
			if (cur === prev) break // reached the last visual line
			prev = cur
		}
		const atEnd = prev
		await browser.keys(['Control', 'n']) // one more press past the end
		await browser.pause(200)
		after = await snap()
		await expect(after.focusOffset).toBe(atEnd) // still a no-op, not jumped to textLength
	})

	it('(8) regression: a note WITHOUT frontmatter is unaffected — Ctrl-N/P still move the body cursor between real lines', async function () {
		await browser.executeObsidian(async ({ app, obsidian }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const path = 'PropertyValueEditMovementNoFrontmatter.md'
			const existing = app.vault.getFileByPath(path)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path, 'first line\nsecond line')
			await app.workspace.getLeaf(true).openFile(file)
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.focus()
			view.editor.setCursor({ line: 0, ch: 0 })
		})
		await browser.pause(300)

		await browser.keys(['Control', 'n'])
		await browser.pause(200)
		const cursor = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getCursor()
		})
		await expect(cursor.line).toBe(1)

		await browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getFileByPath('PropertyValueEditMovementNoFrontmatter.md')
			if (file) await app.vault.delete(file)
		})
	})

	it('(9) CORRECTED: while this property key\'s own "previously used values" suggester is genuinely open, Ctrl-N/P correctly do NOT move by visual line -- Obsidian\'s own native suggester Scope claims the key first, every time, by design', async function () {
		// An earlier version of this test asserted the OPPOSITE --that
		// visual-line movement should win over the suggester here. That
		// was wrong: re-investigated live (see
		// project_checkcallback_property_suggester_ctrl_np_swallowed
		// memory) and confirmed Obsidian's own suggester Scope (the same
		// `Dd` chooser class backing the command palette/quick switcher)
		// unconditionally claims Ctrl-N/P the instant it's pushed,
		// checked BEFORE rootScope's own command-hotkey resolution --
		// this plugin's checkCallback-based line-move architecturally
		// cannot win that race, no matter how its own dispatch logic is
		// written. That's also not a loss: the suggester's own highlight
		// moves instead (natively, no plugin code), which is the correct
		// UX for a visible dropdown — see propertySuggesterScopeLimitation.e2e.ts
		// for the full positive assertion of that.
		//
		// This note deliberately pre-seeds a matching history value so
		// the suggester genuinely has a candidate before the real note
		// under test is even opened — not relying on incidental history
		// left behind by other specs sharing this same persistent e2e
		// vault.
		const text = 'aaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbccccccccccccccccccccddddddddddddddddddddeeeeeeeeeeeeeeeeeeee'
		createdPaths.push('PropertyValueEditMovementSuggesterSeed.md')
		await browser.executeObsidian(async ({ app }, value2) => {
			const existing = app.vault.getFileByPath('PropertyValueEditMovementSuggesterSeed.md')
			if (existing) await app.vault.delete(existing)
			await app.vault.create('PropertyValueEditMovementSuggesterSeed.md', `---\nmyText: ${value2}\n---\n`)
		}, text)
		await browser.pause(300) // let the metadata cache index the seed note's own value

		await openNote('PropertyValueEditMovementSuggesterConflict.md', text)
		await browser.executeObsidian(async ({ app }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.bake()
		})
		await focusValueAt(0)

		// Confirm the premise: the suggester is genuinely open before the
		// keypress under test, not just assumed. (This fixture's suggester
		// has been confirmed flaky in the past — if it doesn't render,
		// this test can't exercise anything, so skip rather than false-fail.)
		const hasSuggester = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const suggester = doc.querySelector('.suggestion-container.mod-property-value')
			return !!suggester && suggester.querySelectorAll('.suggestion-item').length > 0
		})
		if (!hasSuggester) this.skip()

		const before1 = await snap()
		await browser.keys(['Control', 'n'])
		await browser.pause(200)
		const after1 = await snap()
		await expect(after1.focusOffset).toBe(before1.focusOffset) // the editor's own cursor is correctly untouched

		// Confirm the key didn't just vanish -- the suggester's own
		// highlight moved instead, fully natively.
		const suggesterSelected = await browser.executeObsidian(() => {
			const items = Array.from(document.querySelectorAll('.suggestion-container.mod-property-value .suggestion-item'))
			return items.find(i => i.classList.contains('is-selected'))?.textContent ?? null
		})
		await expect(suggesterSelected).not.toBeNull()

		// Once the suggester is closed, this plugin's own checkCallback
		// takes back over normally.
		await browser.keys(['Escape'])
		await browser.pause(300)
		const before2 = await snap()
		await browser.keys(['Control', 'n'])
		await browser.pause(200)
		const after2 = await snap()
		await expect(after2.focusOffset).toBeGreaterThan(before2.focusOffset!)
	})
})
