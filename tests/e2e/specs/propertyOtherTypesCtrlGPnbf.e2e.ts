import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, property-value-editing follow-up phase: extends
// Ctrl-G (exit) to checkbox/date/datetime/list(multitext)/tags/aliases
// (6 types), and Ctrl-P/N/B/F to date/datetime/list/tags/aliases (5,
// checkbox excluded since it has no cursor concept at all) — a scope
// decision documented in project memory
// project_property_other_types_ctrl_g_pnbf_scope.
//
// number was added to Ctrl-G's own coverage in a follow-up fix — it
// was never part of this phase's original 6-type list at all (a real
// gap, not a deliberate exclusion), caught post-release
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

	// User's own direct follow-up, same day: "row選択→myList→Ctrl-Fで入
	// 力モード→Ctrl-Nでプルダウンの1つ目にカーソル(フォーカス)とすると、
	// Ctrl-PNBFもCtrl-Gも効かなくなる。Escなら抜けられるので、Ctrl-Gは効
	// くべきだ" -- confirmed live this is the SAME scope-shadowing class
	// already fixed for the text value-edit widget
	// (propertyValueEditKillYank.e2e.ts's own test (8)), just triggered
	// by a DIFFERENT path: typing a character matching an EXISTING value
	// elsewhere in the vault shows the multi-select's own "previously
	// used values" suggester, which pushes its own Scope on top of
	// propertyRowScope WITHOUT producing any 'input' event (Ctrl-N/G
	// themselves don't mutate text either), so the existing 'input'-only
	// reclaim listener never covered this path at all. Added a parallel
	// 'keydown'-based reclaim trigger (covers this and every other
	// shadowing cause uniformly, the same way the 'input' listener
	// already covers every MUTATING cause uniformly).
	it('(9) regression: typing a value that triggers the multi-select suggester does not permanently shadow Ctrl-G', async function () {
		const notePath = 'PropertyOtherTypesSuggesterShadow.md'
		const seedPaths = ['PropertyOtherTypesSuggesterSeed0.md', 'PropertyOtherTypesSuggesterSeed1.md']
		createdPaths.push(notePath, ...seedPaths)

		await browser.executeObsidian(async ({ app }, { notePath2, seedPaths2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:keyboard-quit', [{ modifiers: ['Ctrl'], key: 'G' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			for (const p of [notePath2, ...seedPaths2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			// Seed existing values so Obsidian's own suggester actually has
			// something to show once a matching character is typed.
			await app.vault.create(seedPaths2[0], `---\nmyList:\n  - seedalpha\n---\nbody\n`)
			await app.vault.create(seedPaths2[1], `---\nmyList:\n  - seedbeta\n---\nbody\n`)
			const file = await app.vault.create(notePath2, `---\nmyList:\n  - item1\n---\nbody\n`)
			await app.workspace.getLeaf(true).openFile(file)
		}, { notePath2: notePath, seedPaths2: seedPaths })
		await browser.pause(500)

		const row = await browser.$('.metadata-property')
		await row.click({ x: 2, y: 2 })
		await browser.keys(['Escape'])
		await browser.pause(150)
		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		await browser.keys(['s']) // matches "seedalpha"/"seedbeta" -- triggers the suggester
		await browser.pause(300)

		const whileShadowed = await browser.executeObsidian(() => ({
			suggesterVisible: !!document.querySelector('.suggestion-container'),
		}))
		await expect(whileShadowed.suggesterVisible).toBe(true) // confirms the suggester genuinely appeared

		await browser.keys(['Control', 'n']) // reproduces the exact failing sequence
		await browser.pause(300)
		await browser.keys(['Control', 'g'])
		await browser.pause(300)

		const after = await browser.executeObsidian(({ app, obsidian }, propertyKey) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector(`.metadata-property[data-property-key="${propertyKey}"]`) as HTMLElement
			const active = row.ownerDocument.activeElement as HTMLElement | null
			return { isRow: active === row }
		}, 'mylist')
		await expect(after.isRow).toBe(true) // Ctrl-G successfully exited to item-selection mode
	})

	// Separate gap, same investigation: the multi-select "previously used
	// values" suggester (list/tags/aliases) has ZERO keyboard navigation of
	// its own -- confirmed live that a real physical ArrowDown, this
	// plugin's own Ctrl-N, and a real physical Enter all leave its
	// .is-selected class completely unchanged, and Enter doesn't commit the
	// highlighted item either, it just inserts the literally-typed prefix
	// as a brand-new pill with the suggester left open. Ctrl-N/P now drive
	// a from-scratch highlight (moving the suggester's own .is-selected
	// class between .suggestion-item siblings, clamped at both ends rather
	// than wrapping, matching this plugin's convention everywhere else),
	// and a bare Enter registered directly on propertyRowScope (same
	// precedent as the existing bare-Escape pass-through) commits the
	// highlighted item via a synthetic MouseEvent('click') -- confirmed
	// live this reliably completes the typed prefix to the clicked item's
	// own full value, unlike synthetic KeyboardEvents elsewhere in this
	// codebase, which are known-unreliable for anything Keymap-adjacent.
	it('(10) Ctrl-N/P navigate the multi-select suggester (no native keyboard support of its own); Enter commits the highlighted item', async function () {
		const notePath = 'PropertyOtherTypesSuggesterNav.md'
		const seedPaths = [
			'PropertyOtherTypesSuggesterNavSeed0.md',
			'PropertyOtherTypesSuggesterNavSeed1.md',
			'PropertyOtherTypesSuggesterNavSeed2.md',
		]
		createdPaths.push(notePath, ...seedPaths)

		await browser.executeObsidian(async ({ app }, { notePath2, seedPaths2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: ['Ctrl'], key: 'P' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: ['Ctrl'], key: 'N' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			for (const p of [notePath2, ...seedPaths2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			// Seed 3 existing tag values sharing a common prefix so the
			// suggester has a genuine multi-item list to navigate.
			await app.vault.create(seedPaths2[0], `---\ntags:\n  - testbeta\n---\nbody\n`)
			await app.vault.create(seedPaths2[1], `---\ntags:\n  - testalpha\n---\nbody\n`)
			await app.vault.create(seedPaths2[2], `---\ntags:\n  - testgamma\n---\nbody\n`)
			const file = await app.vault.create(notePath2, `---\ntags:\n  - tagone\n---\nbody\n`)
			await app.workspace.getLeaf(true).openFile(file)
		}, { notePath2: notePath, seedPaths2: seedPaths })
		await browser.pause(500)

		const row = await browser.$('.metadata-property')
		await row.click({ x: 2, y: 2 })
		await browser.keys(['Escape'])
		await browser.pause(150)
		await browser.keys(['Control', 'f'])
		await browser.pause(150)
		await browser.keys(['t', 'e', 's', 't']) // matches testalpha/testbeta/testgamma -- triggers the suggester
		await browser.pause(300)

		const getSelected = async () => browser.executeObsidian(() => {
			const items = Array.from(document.querySelectorAll('.suggestion-container.mod-property-value .suggestion-item'))
			return {
				count: items.length,
				selectedText: items.find(item => item.classList.contains('is-selected'))?.textContent ?? null,
			}
		})

		const initial = await getSelected()
		await expect(initial.count).toBe(3) // confirms the suggester genuinely has 3 items to navigate
		await expect(initial.selectedText).toBe('testbeta') // Obsidian's own suggester auto-highlights the first item by default, but (confirmed live) ignores every keyboard input that would normally move it

		await browser.keys(['Control', 'n'])
		await browser.pause(150)
		await expect((await getSelected()).selectedText).toBe('testalpha')

		await browser.keys(['Control', 'n'])
		await browser.pause(150)
		await expect((await getSelected()).selectedText).toBe('testgamma')

		await browser.keys(['Control', 'n']) // already at the last item -- confirms boundary clamping, not wrap-around
		await browser.pause(150)
		await expect((await getSelected()).selectedText).toBe('testgamma')

		await browser.keys(['Control', 'p'])
		await browser.pause(150)
		await expect((await getSelected()).selectedText).toBe('testalpha')

		await browser.keys(['Enter']) // commits the currently-highlighted item via a synthetic click
		await browser.pause(300)

		const committed = await browser.executeObsidian(({ app, obsidian }, propertyKey) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector(`.metadata-property[data-property-key="${propertyKey}"]`) as HTMLElement
			const pills = Array.from(row.querySelectorAll('.multi-select-pill')).map(p => p.textContent)
			return { pills }
		}, 'tags')
		await expect(committed.pills).toContain('testalpha') // the typed "test" prefix completed to the clicked item's own full value

		// Regression: Enter with no suggester visible is completely
		// untouched native behavior (commits a brand-new pill), not
		// swallowed by the new bare-Enter handler.
		await browser.keys(['z', 'z', 'z', 'z', 'z']) // doesn't match any existing value -- no suggester
		await browser.pause(300)
		const noSuggester = await browser.executeObsidian(() => ({
			suggesterVisible: !!document.querySelector('.suggestion-container'),
		}))
		await expect(noSuggester.suggesterVisible).toBe(false)

		await browser.keys(['Enter'])
		await browser.pause(300)
		const afterPlainEnter = await browser.executeObsidian(({ app, obsidian }, propertyKey) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const row = view.containerEl.querySelector(`.metadata-property[data-property-key="${propertyKey}"]`) as HTMLElement
			const pills = Array.from(row.querySelectorAll('.multi-select-pill')).map(p => p.textContent)
			return { pills }
		}, 'tags')
		await expect(afterPlainEnter.pills).toContain('zzzzz')
	})
})
