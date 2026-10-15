import { browser } from '@wdio/globals'

// Keeping the Obsidian window from stealing OS-level focus on launch is
// handled centrally in wdio.conf.mts's own `before` hook (a plain Node
// osascript call, re-activating whatever app was frontmost before the test
// run started) — see that file's own comment for why window-level tricks
// (opacity, position, minimize) tried here first were all rejected.

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
