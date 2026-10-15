import { browser } from '@wdio/globals'

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

// Each fixture note under vaults/smoke/ keeps a `# heading` + `- description`
// block above a `---` separator, documenting what it's for — editable in
// Obsidian without touching the actual test content below it. Specs
// reference positions relative to the first line after `---`, not raw file
// line numbers, so editing the header never shifts a spec's own hardcoded
// offsets.
export async function openFixtureAndGetContentStart(path: string): Promise<number> {
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
