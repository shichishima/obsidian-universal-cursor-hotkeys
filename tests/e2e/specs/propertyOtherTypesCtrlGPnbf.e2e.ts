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
})
