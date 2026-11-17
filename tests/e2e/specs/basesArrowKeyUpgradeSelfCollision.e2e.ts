import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// Bases-native-shortcut-collision investigation (third item, see
// basesSetMarkSelectColumn.e2e.ts / basesHomeEndColumnJump.e2e.ts and
// tests/E2E.md's "Bases native-shortcut collisions" section for the
// first two). This one is a self-collision, not a collision with
// Bases' own native shortcut: cursor-up/cursor-down's Bases branch
// delegates row navigation to Bases' native handling via a synthetic
// bare-arrow dispatch (propertyNativeArrowFallback). If a Key Upgrade
// ALSO binds that exact bare key to cursor-up/cursor-down (the only
// way a bare arrow reaches this plugin's checkCallback at all), the
// synthetic dispatch re-enters the SAME command's own checkCallback
// instead of ever reaching Bases' own listener -- the same mechanism
// already confirmed and FIXED for the analogous Properties-row case
// (isBareArrowKeyUpgradeSelfBound/propertyRowMoveUp/propertyRowMoveDown),
// and separately confirmed (but not fixed until now) against Bases'
// own Ctrl-N/P delegation when that Properties fix landed.
//
// Confirmed live via a wrapped-checkCallback invocation counter plus a
// real multi-row, multi-column table: the existing suppressNativeArrowFallback
// guard already bounded this to exactly ONE harmless re-entry (2 total
// invocations, not the ~32-level recursion the Properties case had
// before ITS fix) -- no crash, no stack overflow -- but the active
// cell still silently failed to move at all, in every direction tested
// (ArrowUp AND ArrowRight both no-op'd when self-bound; cursor-left/
// cursor-right have no isBareArrowKeyUpgradeSelfBound-style guard of
// their own at all and were found to reproduce the identical symptom,
// but fixing them is out of scope here -- see the note at the bottom).
//
// Unlike the Properties-row case, no safe manual fallback exists for
// Bases: a direct read of Obsidian's own app.js confirms Bases tracks
// its active cell via private internal state (`this.activeCell`/
// `this.selection`, a `{row, column, groupIdx}` object driving a
// separately-positioned overlay div, `.bases-table-active-cell` --
// not a DOM class on the cell itself) that no public API exposes. The
// one DOM-visible resync hook (a `focusin` listener that re-derives
// `activeCell` via `getCellFromDom`) only fires when that state is
// currently null, not when stepping from an already-active cell to a
// neighbor -- and the table is virtualized (`updateVirtualDisplay`/
// `lastViewport`/`pendingScroll` on the same object), so a target
// row's cell may not even exist in the DOM yet to `.focus()` without
// first replicating Bases' own scroll-into-view logic too. Confirmed
// unfixable, third instance of the same architectural wall as
// basesHomeEndColumnJump.e2e.ts.
//
// Fix: cursor-up/cursor-down's Bases branch now skips the dispatch
// outright when isBareArrowKeyUpgradeSelfBound reports a self-binding,
// instead of relying on suppressNativeArrowFallback to silently absorb
// a doomed recursive re-entry -- same net (no-op) outcome, no wasted
// extra checkCallback invocation.
describe('Bases table view: ArrowUp/Down Key Upgrade self-collision is a safe, single-invocation no-op', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	it('self-bound bare ArrowUp/Down neither crashes, recurses unboundedly, nor moves the active cell', async function () {
		const notePaths = ['BasesArrowSelfNote1.md', 'BasesArrowSelfNote2.md', 'BasesArrowSelfNote3.md']
		const basePath = 'BasesArrowSelf.base'
		createdPaths.push(...notePaths, basePath)

		await browser.executeObsidian(async ({ app }, { notePaths2, basePath2 }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:cursor-up', [{ modifiers: [], key: 'ArrowUp' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-down', [{ modifiers: [], key: 'ArrowDown' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-right', [{ modifiers: ['Ctrl'], key: 'F' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			app.workspace.getLeavesOfType('bases').forEach(leaf => leaf.detach())
			for (const p of [...notePaths2, basePath2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			await app.vault.create(notePaths2[0], `---\nmyText: a\nmyNumber: 1\n---\nbody1\n`)
			await app.vault.create(notePaths2[1], `---\nmyText: b\nmyNumber: 2\n---\nbody2\n`)
			await app.vault.create(notePaths2[2], `---\nmyText: c\nmyNumber: 3\n---\nbody3\n`)
			const baseFile = await app.vault.create(basePath2, `filters:\n  file.name.contains("BasesArrowSelfNote")\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - myText\n      - myNumber\n`)
			await app.workspace.getLeaf(true).openFile(baseFile)
		}, { notePaths2: notePaths, basePath2: basePath })
		await browser.pause(800)

		await browser.executeObsidian(({ app }) => {
			const cmd = (app as any).commands.commands['universal-cursor-hotkeys:cursor-up']
			;(window as any).__upCallCount = 0
			const orig = cmd.checkCallback.bind(cmd)
			cmd.checkCallback = (checking: boolean) => {
				(window as any).__upCallCount++
				return orig(checking)
			}
		})

		async function activeCellInfo() {
			await browser.keys(['Enter'])
			await browser.pause(300)
			const result = await browser.executeObsidian(({ app }) => {
				const leaf = app.workspace.getLeavesOfType('bases')[0]
				const container = leaf?.view?.containerEl as HTMLElement
				const active = container.ownerDocument.activeElement as HTMLElement | null
				const cellWrap = active?.closest?.('[data-property]') as HTMLElement | null
				const rowEl = cellWrap?.closest('.bases-tr') as HTMLElement | null
				const rows = Array.from(container.querySelectorAll('.bases-tr')) as HTMLElement[]
				return {
					prop: cellWrap?.getAttribute('data-property') ?? null,
					rowIndex: rowEl ? rows.indexOf(rowEl) : -1,
					value: (active as HTMLInputElement)?.value ?? active?.textContent ?? null,
				}
			})
			await browser.keys(['Escape'])
			await browser.pause(150)
			await browser.keys(['Escape'])
			await browser.pause(150)
			return result
		}

		// Row 2 (BasesArrowSelfNote2, myText="b"), middle column -- has
		// somewhere to go in every direction, so a silent failure-to-move
		// can't be confused with "already at the edge."
		const cellEl = await browser.$('.bases-tr:nth-of-type(2) [data-property="note.myText"]')
		await cellEl.click()
		await browser.pause(200)
		await browser.keys(['Escape'])
		await browser.pause(200)
		await browser.keys(['Escape'])
		await browser.pause(200)

		const start = await activeCellInfo()
		await expect(start).toEqual({ prop: 'note.myText', rowIndex: 2, value: 'b' })

		// Known-good reference first: Ctrl-F (an ordinary, non-self-bound
		// hotkey) still correctly reaches Bases' own native column
		// navigation via the same propertyNativeArrowFallback helper.
		await browser.keys(['Control', 'f'])
		await browser.pause(300)
		const afterCtrlF = await activeCellInfo()
		await expect(afterCtrlF).toEqual({ prop: 'note.myNumber', rowIndex: 2, value: '2' })

		// Re-click back to a clean row2/myText baseline for the self-bound probe.
		await (await browser.$('.bases-tr:nth-of-type(2) [data-property="note.myText"]')).click()
		await browser.pause(200)
		await browser.keys(['Escape'])
		await browser.pause(150)
		await browser.keys(['Escape'])
		await browser.pause(150)

		let threw = false
		try {
			await browser.keys(['ArrowUp'])
		} catch (e) {
			threw = true
		}
		await browser.pause(400)

		const callCount = await browser.executeObsidian(() => (window as any).__upCallCount)
		await expect(threw).toBe(false)
		// Exactly 1: the dispatch is now skipped outright when self-bound,
		// instead of the previous 2 (1 real + 1 recursive re-entry absorbed
		// by suppressNativeArrowFallback).
		await expect(callCount).toBe(1)

		const afterArrowUp = await activeCellInfo()
		await expect(afterArrowUp).toEqual({ prop: 'note.myText', rowIndex: 2, value: 'b' })
	})
})

// Not covered by a test (matches this project's convention for a
// confirmed-unfixable gap, same as propertyCtrlG.e2e.ts (7) /
// propertyNameEdit.e2e.ts (12)'s bare-Escape-swallow): cursor-left/
// cursor-right were found, during this investigation, to reproduce the
// identical self-collision symptom against Bases' own column
// navigation when a Key Upgrade binds a bare ArrowLeft/ArrowRight to
// them -- but they have no isBareArrowKeyUpgradeSelfBound-style guard
// of their own at all (their Bases/Properties-row branch calls
// propertyNativeArrowFallback unconditionally), and fixing that is a
// different, larger change than this branch's own scope: Properties'
// own ArrowLeft/Right on a row is semantically "enter edit mode," not
// "step to a sibling," so it would need its own separate investigation
// into whether a safe manual fallback exists there, independent of
// Bases' own confirmed-unfixable column state. Left for a future
// branch, not assumed fixed or broken beyond what's noted here.
