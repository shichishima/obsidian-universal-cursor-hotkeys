import { browser } from '@wdio/globals'
import { obsidianPage } from 'wdio-obsidian-service'

// Entering/exiting a table cell swaps in (or back out of) a separate inner
// CM6 view — confirmed live, more than once, that inTableCell can still read
// stale for a frame or two right after the command that triggered the
// transition (matching this plugin's own "two RAF frames" deferral
// elsewhere for the same cell-focus reconciliation). Any command gated on
// editor.inTableCell (e.g. table-exit-up/down) can silently no-op if run
// before this settles. Poll instead of asserting/acting cold.
export async function waitForInTableCell(expected: boolean, timeout = 2000) {
	await browser.waitUntil(async () => {
		const inTableCell = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return (view.editor as any).inTableCell as boolean
		})
		return inTableCell === expected
	}, { timeout, interval: 100, timeoutMsg: `inTableCell never reached ${expected}` }).catch(() => {})
}

// Turns on Obsidian's own core "Vim key bindings" setting (vault config key
// 'vimMode', confirmed by reading settings.ts's own read of the same key —
// undocumented but stable). Must be called BEFORE opening the fixture leaf
// that will receive vim keystrokes: the Vim keymap extension is wired in
// when a markdown view's editor is constructed, so toggling this after a
// view already exists leaves that existing view's own CM6 instance
// unaffected until it's reopened.
export async function enableVimMode() {
	await browser.executeObsidian(({ app }) => {
		(app.vault as any).setConfig('vimMode', true)
	})
}

// Opt-in (E2E_POPOUT=1, see package.json's "test:e2e:popout") reroutes every
// fixture open through a single shared popout window instead of the main
// one, letting the existing suite run unmodified against a popout — for
// occasional manual sweeps covering the popout-specific layout-measurement-
// staleness bug category documented in
// project_popout_window_cursor_investigation (gj/gk goal column, j/k/w/b/e
// crossing, scrollPage). Not run by default: doubles suite runtime and most
// specs have no popout-sensitive code path at all, so it's not worth a
// standing/permanent second pass — see that memory's own 3 findings, each
// of which got its own small permanent regression test instead.
const usePopout = !!process.env.E2E_POPOUT
let popoutWindowHandle: string | null = null

// Each fixture note under vaults/smoke/ keeps a `# heading` + `- description`
// block above a `---` separator, documenting what it's for — editable in
// Obsidian without touching the actual test content below it. Specs
// reference positions relative to the first line after `---`, not raw file
// line numbers, so editing the header never shifts a spec's own hardcoded
// offsets.
export async function openFixtureAndGetContentStart(path: string): Promise<number> {
	if (usePopout) return openFixtureInPopoutAndGetContentStart(path)

	return browser.executeObsidian(async ({ app, obsidian }, path2) => {
		// Detach any existing leaves and open a fresh one — reusing an
		// already-open leaf across tests (re-opening the same fixture) was
		// suspected of carrying over stale state between tests.
		app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
		const file = app.vault.getFileByPath(path2)!
		await app.workspace.getLeaf(true).openFile(file)
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
		const editor = view.editor
		for (let i = 0; i < editor.lineCount(); i++) {
			if (editor.getLine(i).trim() === '---') return i + 1
		}
		throw new Error(`"${path2}": no --- separator found`)
	}, path)
}

// E2E_POPOUT path: one popout window is created on the first call and
// reused (via openFile on its own existing leaf) for every fixture opened
// for the rest of the run — matching the main-window path's "no lasting
// per-test leftovers", but without paying a fresh OS-window spin-up cost on
// every single test.
let popoutLeafId: string | null = null

// Exported directly (not just through the E2E_POPOUT gate above) so a
// dedicated, always-run regression spec can open a real popout on demand —
// see setMarkPopoutNativeClearing.e2e.ts, added after a confirmed real bug
// (not a test-infra artifact) found via an E2E_POPOUT full-suite sweep: the
// native copy/cut/paste/Backspace/Delete/Escape markActive-clearing
// listeners were registered once against the main window's own document at
// plugin load time, never for a later-opened popout's own document.
export async function switchToMainWindow(): Promise<void> {
	await browser.switchToWindow(await obsidianPage.getMainWindowHandle())
}

// Closes the shared popout opened by openFixtureInPopoutAndGetContentStart
// and switches back to the main window — every spec that calls that
// function directly (not through the E2E_POPOUT gate, which leaves the
// popout open for the rest of the shared-instance run on purpose) must call
// this in its own `after` hook, or every later spec in the suite's own
// shared instance would keep running against the stale popout instead of
// the main window.
export async function closePopoutWindow(): Promise<void> {
	if (!popoutWindowHandle) return
	await browser.switchToWindow(popoutWindowHandle)
	await browser.closeWindow()
	popoutWindowHandle = null
	popoutLeafId = null
	await switchToMainWindow()
}

export async function openFixtureInPopoutAndGetContentStart(path: string): Promise<number> {
	if (!popoutWindowHandle || !popoutLeafId) {
		const beforeHandles = await browser.getWindowHandles()
		// Grab the new leaf's own persistent id right here, in the same call
		// that creates it — trying to re-identify "which leaf is the
		// popout's" afterward via iterateAllLeaves is unreliable: getRoot()
		// for the main window's own left/right sidebar leaves is ALSO not
		// === rootSplit, and (confirmed live) their .win can read as
		// undefined rather than the main window, so a "not the main
		// window" filter can still match a sidebar leaf by mistake — which
		// is exactly what happened (the fixture note opened in the main
		// window's left sidebar instead of the popout). getLeafById is the
		// one unambiguous way back to this exact leaf on every later call.
		popoutLeafId = await browser.executeObsidian(({ app }) => (app.workspace.openPopoutLeaf() as any).id)
		await browser.waitUntil(
			async () => (await browser.getWindowHandles()).length > beforeHandles.length,
			{ timeout: 5000, timeoutMsg: 'popout window never opened' },
		)
		const afterHandles = await browser.getWindowHandles()
		popoutWindowHandle = afterHandles.find(h => !beforeHandles.includes(h))!
	}
	await browser.switchToWindow(popoutWindowHandle)
	return browser.executeObsidian(async ({ app, obsidian }, { path2, leafId }) => {
		const popoutLeaf = app.workspace.getLeafById(leafId)
		if (!popoutLeaf) throw new Error('popout leaf not found')
		const file = app.vault.getFileByPath(path2)!
		// Without an explicit view state, a freshly-created popout leaf's
		// mode isn't guaranteed to be Live Preview — confirmed live (via a
		// screenshot showing the file menu's own "Source mode" item
		// checked) that it can end up in real Source Mode, not just "edit
		// mode" generically (MarkdownView's state.mode 'source'/'preview'
		// is the edit-vs-reading-view switch; the separate state.source
		// boolean is the actual Live-Preview-vs-Source-Mode switch this
		// was missing). Forcing it here keeps every popout-opened fixture
		// in Live Preview deterministically, matching the main window.
		await popoutLeaf.openFile(file, { state: { mode: 'source', source: false } })
		// Switching the WebDriver window context doesn't tell Obsidian itself
		// which leaf is "active" — every spec's own direct
		// app.workspace.getActiveViewOfType/executeObsidianCommand calls (not
		// routed through this helper) still resolve against whatever
		// app.workspace.activeLeaf already is, so it has to be pointed at
		// the popout leaf explicitly for the rest of the existing suite to
		// work unmodified against it.
		app.workspace.setActiveLeaf(popoutLeaf, { focus: true })
		const editor = (popoutLeaf.view as any).editor as InstanceType<typeof obsidian.MarkdownView>['editor']
		for (let i = 0; i < editor.lineCount(); i++) {
			if (editor.getLine(i).trim() === '---') return i + 1
		}
		throw new Error(`"${path2}": no --- separator found`)
	}, { path2: path, leafId: popoutLeafId! })
}
