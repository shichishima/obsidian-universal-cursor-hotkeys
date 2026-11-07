import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// 0.13.0 Feature 1, Bases follow-up: Ctrl-L (recenter / recenter-top-bottom)
// in a Bases table view's own cell-selection mode. Unlike Ctrl-P/N/B/F
// cell navigation (see basesCellNavigation.e2e.ts), Bases has no native
// equivalent for Ctrl-L at all -- this is a genuinely new implementation,
// not a native-dispatch delegation.
//
// Confirmed live before implementing: ".bases-table-container" (the
// element that stays focused throughout cell-selection mode) is NOT
// itself the scrollable element -- its own scrollHeight/clientHeight are
// always equal. The real scrollable ancestor is its own parent,
// ".bases-view". The currently-selected cell is found via
// ".bases-table-active-cell", present directly in the DOM at all times.
// ".bases-view"'s own header (".bases-thead") is position: sticky,
// permanently occupying the top of its viewport -- factored into
// "center"/"top" target calculations, but not "bottom".
//
// This spec deliberately opens the Bases leaf in a split below a
// markdown leaf (see setUpTable), not as the window's only leaf -- a
// real regression (reported live after this feature first shipped:
// "top" landed behind the sticky header, "bottom" stopped short with
// visible slack beneath it) only showed up once .bases-view's own
// getBoundingClientRect().top was nonzero, which an earlier,
// single-leaf draft of this spec never exercised. See
// recenterBasesScrollTo's own comment in main.ts for the fix.
describe('Bases table view: Ctrl-L recenter / recenter-top-bottom', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	// localTop is the active cell's top relative to .bases-view's OWN top
	// edge, not the page -- rect.top (page-relative) alone isn't meaningful
	// here, since .bases-view itself can sit anywhere on the page (e.g.
	// below a tab bar). This is exactly the distinction the scrollRect.top
	// fix in recenterBasesScrollTo is about -- see that method's own
	// comment.
	async function cellTopAndClientHeight() {
		return browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('bases')[0]
			const container = leaf?.view?.containerEl as HTMLElement
			const scrollEl = container.querySelector('.bases-view') as HTMLElement
			const cellEl = container.querySelector('.bases-table-active-cell') as HTMLElement | null
			const rect = cellEl?.getBoundingClientRect()
			const scrollRect = scrollEl?.getBoundingClientRect()
			const headerEl = scrollEl?.querySelector('.bases-thead') as HTMLElement | null
			return {
				localTop: rect && scrollRect ? rect.top - scrollRect.top : undefined,
				clientHeight: scrollEl?.clientHeight,
				headerHeight: headerEl?.getBoundingClientRect().height,
			}
		})
	}

	// Deliberately opens the Bases leaf in a SPLIT, below a markdown leaf
	// -- not just a single, unsplit leaf -- so .bases-view's own
	// getBoundingClientRect().top is nonzero (as it would be in a real
	// vault with a tab bar/other UI above the table). This is the exact
	// condition that exposed the scrollRect.top bug (see
	// recenterBasesScrollTo's own comment): an unsplit single-leaf layout
	// made that bug's own symptom invisible to this spec in an earlier
	// draft.
	async function setUpTable(notePaths: string[], basePath: string) {
		await browser.executeObsidian(async ({ app }, { notePaths2, basePath2 }) => {
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			app.workspace.getLeavesOfType('bases').forEach(leaf => leaf.detach())
			for (const p of [...notePaths2, basePath2]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			for (let i = 0; i < notePaths2.length; i++) {
				await app.vault.create(notePaths2[i], `---\nmyText: row ${i}\n---\nbody\n`)
			}
			// Filtered, and 200 rows deep -- without filters: the view shows
			// every file in the shared test vault; the row count needs to be
			// large enough that the table actually scrolls.
			const baseFile = await app.vault.create(basePath2, `filters:\n  file.name.contains("${basePath2.replace('.base', '')}Note")\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - myText\n`)
			const topLeaf = app.workspace.getLeaf(true)
			await topLeaf.openFile(app.vault.getMarkdownFiles()[0])
			const basesLeaf = app.workspace.createLeafBySplit(topLeaf, 'horizontal', true)
			await basesLeaf.openFile(baseFile)
			app.workspace.setActiveLeaf(basesLeaf)
		}, { notePaths2: notePaths, basePath2: basePath })
		await browser.pause(800)
	}

	it('Ctrl-L (recenter) scrolls the active cell to the vertical center', async function () {
		const basePath = 'BasesRecenter.base'
		const notePaths = Array.from({ length: 200 }, (_, i) => `BasesRecenterNote${i}.md`)
		createdPaths.push(...notePaths, basePath)

		await browser.executeObsidian(({ app }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:recenter', [{ modifiers: ['Ctrl'], key: 'L' }])
			hm.bake()
		})
		await setUpTable(notePaths, basePath)

		await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('bases')[0]
			const container = leaf?.view?.containerEl as HTMLElement
			const scrollEl = container.querySelector('.bases-view') as HTMLElement
			scrollEl.scrollTop = 100
		})
		await browser.pause(300)

		const cellEl = await browser.$('.bases-tr:nth-of-type(5) [data-property="note.myText"]')
		await cellEl.click()
		await browser.pause(200)
		await browser.keys(['Escape']) // -> cell-selection mode
		await browser.pause(300)

		const before = await cellTopAndClientHeight()
		await browser.keys(['Control', 'l'])
		await browser.pause(200)
		const after = await cellTopAndClientHeight()

		const expectedCenter = (after.headerHeight ?? 0) + ((after.clientHeight ?? 0) - (after.headerHeight ?? 0)) / 2
		await expect(Math.abs((before.localTop ?? 0) - expectedCenter)).toBeGreaterThan(20)
		await expect(Math.abs((after.localTop ?? 0) - expectedCenter)).toBeLessThan(1)
	})

	it('Ctrl-Shift-L (recenter-top-bottom) cycles center -> top -> bottom -> center', async function () {
		const basePath = 'BasesRecenterCycle.base'
		const notePaths = Array.from({ length: 200 }, (_, i) => `BasesRecenterCycleNote${i}.md`)
		createdPaths.push(...notePaths, basePath)

		await browser.executeObsidian(({ app }) => {
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:recenter', [])
			hm.setHotkeys('universal-cursor-hotkeys:recenter-top-bottom', [{ modifiers: ['Ctrl', 'Shift'], key: 'L' }])
			hm.bake()
		})
		await setUpTable(notePaths, basePath)

		await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('bases')[0]
			const container = leaf?.view?.containerEl as HTMLElement
			const scrollEl = container.querySelector('.bases-view') as HTMLElement
			scrollEl.scrollTop = 100
		})
		await browser.pause(300)

		const cellEl = await browser.$('.bases-tr:nth-of-type(5) [data-property="note.myText"]')
		await cellEl.click()
		await browser.pause(200)
		await browser.keys(['Escape']) // -> cell-selection mode
		await browser.pause(300)

		await browser.keys(['Control', 'Shift', 'l'])
		await browser.pause(200)
		const center = await cellTopAndClientHeight()
		const expectedCenter = (center.headerHeight ?? 0) + ((center.clientHeight ?? 0) - (center.headerHeight ?? 0)) / 2
		await expect(Math.abs((center.localTop ?? 0) - expectedCenter)).toBeLessThan(1)

		await browser.keys(['Control', 'Shift', 'l'])
		await browser.pause(200)
		const top = await cellTopAndClientHeight()
		await expect(top.localTop).toBeLessThan(center.localTop ?? 0)

		await browser.keys(['Control', 'Shift', 'l'])
		await browser.pause(200)
		const bottom = await cellTopAndClientHeight()
		await expect(bottom.localTop).toBeGreaterThan(center.localTop ?? 0)

		await browser.keys(['Control', 'Shift', 'l'])
		await browser.pause(200)
		const backToCenter = await cellTopAndClientHeight()
		await expect(Math.abs((backToCenter.localTop ?? 0) - expectedCenter)).toBeLessThan(1)
	})
})
