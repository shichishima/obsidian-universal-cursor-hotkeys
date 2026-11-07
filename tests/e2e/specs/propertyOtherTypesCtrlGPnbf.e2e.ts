import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, property-value-editing follow-up phase: extends
// Ctrl-G (exit) to checkbox/date/datetime/list(multitext)/tags/aliases
// (6 types), and Ctrl-P/N/B/F to date/datetime/list/tags/aliases (5,
// checkbox excluded since it has no cursor concept at all) — the
// user's own scope decision, see project memory
// project_property_other_types_ctrl_g_pnbf_scope.
//
// number was added to Ctrl-G's own coverage in a follow-up fix — it
// was never part of this phase's original 6-type list at all (a real
// gap, not a deliberate exclusion), caught by a user report
// ("numberでCtrl-Gが効かない") after the rest of this phase shipped.
// Shares the exact same no-Selection-API wall as date/datetime (see
// project_frontmatter_property_dom_survey's own Category B finding)
// and was never in scope for Ctrl-PNBF either way, so it only joins
// PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR, not PROPERTY_CURSOR_PNBF_SELECTOR.
//
// Confirmed live via diagnostic probes BEFORE implementing (not
// assumed): synthetic dispatchEvent() does NOT trigger date/datetime's
// own native field-stepping behavior at all (a real browser.keys()
// press does increment the value; a dispatched one leaves it
// completely unchanged) -- this is a genuine, confirmed platform wall,
// the same "browsers only perform a key's own default action for
// TRUSTED events" limitation already known from the title/text-type
// work, just hitting a different native control this time. So
// Ctrl-P/N/B/F on date/datetime is a TRUE no-op by design, not a
// simplified "cursor-key delegation" the way the original scope memo
// first assumed -- there is no implementation possible here with any
// public API.
//
// list/tags/aliases' own trailing in-progress chip (multi-select-input)
// IS a real contenteditable with the same Selection API the text type
// already uses -- confirmed live it reuses titleMoveChar/
// propertyValueEditMoveLine completely unchanged, no multi-select-
// specific logic needed.
describe('Property panel: Ctrl-G + Ctrl-PNBF for other property types', function () {
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
			hm.setHotkeys('universal-cursor-hotkeys:keyboard-quit', [{ modifiers: ['Ctrl'], key: 'G' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-left', [{ modifiers: ['Ctrl'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(path2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(path2, `---
myCheckbox: true
myDate: 2026-01-15
myDateTime: 2026-01-15T10:30
myNumber: 42
myList:
  - item1
tags:
  - tagone
aliases:
  - aliasone
---
first body line
`)
			await app.workspace.getLeaf(true).openFile(file)
		}, path)
		await browser.pause(500)
	}

	async function focus(propertyKey: string, selector: string) {
		await browser.executeObsidian(({ app, obsidian }, { propertyKey2, selector2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector(`.metadata-property[data-property-key="${propertyKey2}"]`) as HTMLElement
			const el = row.querySelector(selector2) as HTMLElement
			el.focus()
		}, { propertyKey2: propertyKey, selector2: selector })
		await browser.pause(150)
	}

	async function snap(propertyKey: string, selector: string) {
		return browser.executeObsidian(({ app, obsidian }, { propertyKey2, selector2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector(`.metadata-property[data-property-key="${propertyKey2}"]`) as HTMLElement
			const el = row.querySelector(selector2) as HTMLElement | null
			const doc = view.containerEl.ownerDocument
			const active = doc.activeElement as HTMLElement | null
			return {
				isRow: active?.closest?.('.metadata-property')?.getAttribute('data-property-key') === propertyKey2 && active !== el,
				elValue: el instanceof HTMLInputElement ? el.value : el?.textContent,
			}
		}, { propertyKey2: propertyKey, selector2: selector })
	}

	const types: [string, string][] = [
		['mycheckbox', 'input[type="checkbox"]'],
		['mydate', 'input[type="date"]'],
		['mydatetime', 'input[type="datetime-local"]'],
		['mynumber', 'input[type="number"]'],
		['mylist', '.multi-select-input'],
		['tags', '.multi-select-input'],
		['aliases', '.multi-select-input'],
	]

	for (const [propertyKey, selector] of types) {
		it(`(1.${propertyKey}) Ctrl-G exits from ${propertyKey} back to item-selection mode`, async function () {
			await openNote(`PropertyOtherTypesCtrlG_${propertyKey}.md`)
			await focus(propertyKey, selector)
			await browser.keys(['Control', 'g'])
			await browser.pause(150)
			const after = await snap(propertyKey, selector)
			await expect(after.isRow).toBe(true)
		})
	}

	it('(2) Ctrl-F/B/P/N on date are a true no-op — value and focus both unchanged', async function () {
		await openNote('PropertyOtherTypesDateNoop.md')
		await focus('mydate', 'input[type="date"]')

		for (const key of ['f', 'b', 'p', 'n']) {
			await browser.keys(['Control', key])
			await browser.pause(150)
			const after = await snap('mydate', 'input[type="date"]')
			await expect(after.elValue).toBe('2026-01-15')
			await expect(after.isRow).toBe(false) // focus never left the input
		}
	})

	it('(3) Ctrl-F/B/P/N on datetime are a true no-op', async function () {
		await openNote('PropertyOtherTypesDateTimeNoop.md')
		await focus('mydatetime', 'input[type="datetime-local"]')

		for (const key of ['f', 'b', 'p', 'n']) {
			await browser.keys(['Control', key])
			await browser.pause(150)
			const after = await snap('mydatetime', 'input[type="datetime-local"]')
			await expect(after.elValue).toBe('2026-01-15T10:30')
			await expect(after.isRow).toBe(false)
		}
	})

	it('(4) Ctrl-F moves the caret within the multi-select trailing chip, reusing the same Selection API as the text type', async function () {
		await openNote('PropertyOtherTypesMultiselectMove.md')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector('.metadata-property[data-property-key="mylist"]') as HTMLElement
			const input = row.querySelector('.multi-select-input') as HTMLElement
			input.focus()
			input.textContent = 'hello'
			const sel = input.ownerDocument.getSelection()!
			const range = input.ownerDocument.createRange()
			range.setStart(input.firstChild!, 0)
			range.collapse(true)
			sel.removeAllRanges()
			sel.addRange(range)
		})
		await browser.pause(150)

		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		const focusOffset = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.containerEl.ownerDocument.getSelection()!.focusOffset
		})
		await expect(focusOffset).toBe(1)
	})

	it('(5) regression: Ctrl-F on checkbox falls through safely (no crash, no unwanted side effect)', async function () {
		await openNote('PropertyOtherTypesCheckboxSafe.md')
		await focus('mycheckbox', 'input[type="checkbox"]')
		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		const after = await snap('mycheckbox', 'input[type="checkbox"]')
		await expect(after.elValue).toBe('on') // checkbox state unchanged
		await expect(after.isRow).toBe(false) // focus stayed on the checkbox
	})

	// Real regression: ArrowLeft/Right from the multi-select trailing
	// input moves real DOM focus onto an already-committed pill
	// (.multi-select-pill), confirmed live -- a focus target that didn't
	// match PROPERTY_PANEL_SCOPE_SELECTOR at all, so propertyRowScope got
	// torn down (via the focusout handler's own check matching the INPUT
	// on its way out) the moment a pill gained focus. Ctrl-G (and every
	// other command) did nothing at all from there. Fixed with a single
	// selector addition (.multi-select-pill -> PROPERTY_MULTISELECT_PILL_SELECTOR
	// -> PROPERTY_ANY_VALUE_WIDGET_SELECTOR) -- the EXISTING generic
	// Ctrl-G handler's own synthetic Escape redispatch already reaches
	// the row directly from a pill once the scope simply stays alive; no
	// special pill-only handler was actually needed (a pill's own
	// native Escape only steps back to the input, one level short, but
	// that behavior turned out to be trusted-events-only, so it never
	// interferes with the redispatch).
	it('(6) regression: Ctrl-G exits from a multi-select pill (not just the trailing input) straight to item-selection mode', async function () {
		await openNote('PropertyOtherTypesPillCtrlG.md')
		await focus('mylist', '.multi-select-pill')
		await browser.keys(['Control', 'g'])
		await browser.pause(150)
		const after = await snap('mylist', '.multi-select-pill')
		await expect(after.isRow).toBe(true)
	})

	// Follow-up, same day: once a pill simply stays within
	// PROPERTY_PANEL_SCOPE_SELECTOR (the fix above), Ctrl-B/F pill-to-
	// pill navigation came for free too -- no new code at all. The
	// cursor-left/right bind() calls' own EXISTING generic native-
	// dispatch fallback (same mechanism item-selection mode's own row/
	// heading/Add-button already rely on) picks up a focused pill
	// automatically, since nothing in PROPERTY_CURSOR_LR_SELECTOR
	// matches it more specifically. Confirmed live a real browser
	// ArrowLeft/Right already moves between pills on its own; this test
	// confirms the PLUGIN's own Ctrl-B/F hotkeys reach the exact same
	// native behavior via the fallback dispatch.
	it('(7) Ctrl-B/F move between pills in a multi-select widget, for free via the existing fallback dispatch', async function () {
		await openNote('PropertyOtherTypesPillCtrlBF.md')
		await focus('mylist', '.multi-select-input')
		await browser.keys(['ArrowLeft']) // real native press: lands on the last pill ("item1")
		await browser.pause(150)
		const onPill = await snap('mylist', '.multi-select-pill')
		await expect(onPill.isRow).toBe(false) // confirms we're actually on the pill, not bounced out
		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		const afterCtrlF = await browser.executeObsidian(({ app, obsidian }, propertyKey2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector(`.metadata-property[data-property-key="${propertyKey2}"]`) as HTMLElement
			const active = row.ownerDocument.activeElement as HTMLElement | null
			return { isInput: active?.classList.contains('multi-select-input') ?? false }
		}, 'mylist')
		await expect(afterCtrlF.isInput).toBe(true) // Ctrl-F from the only pill moves forward into the trailing input
	})

	// User's own direct follow-up, same day: "row選択モード→Ctrl-F→(？？モード)
	// →物理カーソル←→pill選択モード" (the "???" being the trailing
	// input's own empty composing state) -- this physical-cursor-only
	// crossing was the one direction Ctrl-B/F DIDN'T already cover for
	// free, unlike test (7)'s own pill-to-pill and pill-to-input
	// crossings. Confirmed live before implementing: titleMoveChar's own
	// Selection.modify('move', 'left', 'character') is a true no-op at
	// the input's own start (nothing to its own left WITHIN its own text
	// -- the preceding pill is a separate DOM sibling, not part of this
	// element's content at all), while a real ArrowLeft there hands
	// focus to the preceding pill instead. Fixed with a new
	// isSelectionAtStartOf() boundary check in propertyMoveCharOrNoop,
	// focusing el.previousElementSibling (the pill) directly rather than
	// a native-equivalent dispatch -- a synthetic ArrowLeft dispatch was
	// tried first and SEEMED to fail here, but that was this test's own
	// bug (see below), not the dispatch itself; direct focus was kept
	// anyway since it's simpler and has no dependency on how Obsidian's
	// own native handler happens to be wired. Scoped to going backward
	// only (Ctrl-F from the input's own end has nothing after it in the
	// DOM either way) and skipped while a mark is active (no defined
	// meaning for extending across this boundary).
	//
	// Also confirmed live, NOT assumed: this boundary crossing itself is
	// conditional on the input being genuinely EMPTY -- a real ArrowLeft
	// with uncommitted typed text still at caret position 0 stays within
	// the input rather than escaping (Obsidian's own native behavior,
	// unrelated to this plugin), which this fix's own isSelectionAtStartOf()
	// check already respects (it only compares text content, so typed
	// text before the caret makes it return false regardless of caret
	// offset being 0 relative to that text).
	//
	// A real test-authoring bug surfaced while building this red-green:
	// with TWO pills in the list, snap()'s own el lookup
	// (row.querySelector('.multi-select-pill')) always resolves to the
	// FIRST pill in DOM order, not whichever one actually has focus --
	// made this test's own assertion fail even though the fix worked
	// correctly (confirmed via direct instrumentation: the handler ran
	// exactly once, found the right previousElementSibling, and focus
	// genuinely ended up on the correct pill). Checking
	// document.activeElement directly, instead of reusing snap(), avoids
	// this entirely.
	it('(8) Ctrl-B escapes from the trailing input\'s own start to the preceding pill, but only while the input is genuinely empty', async function () {
		const notePath = 'PropertyOtherTypesInputBoundary.md'
		createdPaths.push(notePath)
		await browser.executeObsidian(async ({ app }, notePath2) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-left', [{ modifiers: ['Ctrl'], key: 'B' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			const existing = app.vault.getFileByPath(notePath2)
			if (existing) await app.vault.delete(existing)
			const file = await app.vault.create(notePath2, `---\nmylist:\n  - itemOne\n  - itemTwo\n---\nbody\n`)
			await app.workspace.getLeaf(true).openFile(file)
		}, notePath)
		await browser.pause(500)

		async function activeElementState() {
			return browser.executeObsidian(({ app, obsidian }, propertyKey2) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
				const row = view.containerEl.querySelector(`.metadata-property[data-property-key="${propertyKey2}"]`) as HTMLElement
				const active = row.ownerDocument.activeElement as HTMLElement | null
				return { isPill: active?.classList.contains('multi-select-pill') ?? false, isInput: active?.classList.contains('multi-select-input') ?? false, text: active?.textContent }
			}, 'mylist')
		}

		const row = await browser.$('.metadata-property')
		await row.click({ x: 2, y: 2 })
		await browser.keys(['Escape'])
		await browser.pause(150)
		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		await browser.keys(['Control', 'b'])
		await browser.pause(150)
		const afterEmpty = await activeElementState()
		await expect(afterEmpty.isPill).toBe(true) // landed on a pill, not stuck on the input
		await expect(afterEmpty.text).toBe('itemTwo') // specifically the LAST pill (closest to the input)

		// Back into the input, type uncommitted text, confirm Ctrl-B at
		// position 0 now stays put (matches native) instead of escaping.
		await focus('mylist', '.multi-select-input')
		await browser.keys(['h', 'i'])
		await browser.pause(150)
		await browser.keys(['Control', 'b'])
		await browser.keys(['Control', 'b']) // two presses: "hi" -> "h|i" -> "|hi" (now AT position 0, with text present)
		await browser.pause(150)
		const afterTyped = await browser.executeObsidian(({ app, obsidian }, propertyKey2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector(`.metadata-property[data-property-key="${propertyKey2}"]`) as HTMLElement
			const el = row.querySelector('.multi-select-input') as HTMLElement
			return { isInput: row.ownerDocument.activeElement === el, text: el.textContent }
		}, 'mylist')
		await expect(afterTyped.isInput).toBe(true)
		await expect(afterTyped.text).toBe('hi')
	})
})
