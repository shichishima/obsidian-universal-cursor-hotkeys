import { browser, expect } from '@wdio/globals'
import { describe, it, afterEach } from 'mocha'
import { openFixtureAndGetContentStart } from '../helpers'

// Regression coverage for a confirmed real bug: Kill Line, Kill Line,
// Yank dropped the first kill's own text (yanking back only an empty
// line) whenever the active file was ALSO open in a second split leaf
// — same root cause, and same fix, whether that second leaf is an
// ordinary split or a popout window (a popout is just another leaf).
//
// Root cause: this plugin's own EditorView.updateListener resets
// isKillChaining on any genuine user-triggered transaction, so an
// unrelated edit breaks a Kill Line chain. When the same file is open
// in two leaves, Obsidian propagates the first kill's edit to the
// OTHER leaf's own separate EditorView as a second, asynchronous
// transaction that still carries a Transaction.userEvent annotation —
// arriving after the kill command's own isDispatchingKill guard window
// has already closed, so it was indistinguishable from a real second
// user edit and reset isKillChaining right after the first kill, before
// the second Kill Line ever ran.
//
// Content layout relative to the fixture's own --- separator (see
// tests/e2e/vaults/smoke/KillChainSplitPaneEcho.md):
//   +0: alpha
//   +1: beta
//
// With a cursor at (+0, ch 0): the first Kill Line kills "alpha" (text
// only, line becomes empty); the second Kill Line — now at the empty
// line's own end — joins with the next line, killing just the "\n"
// between them. Chained correctly, the kill-cache ends up as
// "alpha\n"; broken, it's just "\n". Yanking back at that same
// position after both kills restores the original two-line content
// exactly when chaining worked, but drops "alpha" (leaving a stray
// empty line) when it didn't — matching the bug as originally
// reported.
describe('Kill-chain not broken by a same-file split leaf\'s own echoed transaction', function () {
	afterEach(async function () {
		await browser.executeObsidian(({ app }) => {
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
		})
	})

	it('Kill Line x2 then Yank restores the full combined text, not just the second kill\'s empty-line remainder', async function () {
		const l = await openFixtureAndGetContentStart('KillChainSplitPaneEcho.md')

		const leafAId = await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.isKillChaining = false
			plugin.killCache = ''
			const leafA = (app.workspace as any).activeLeaf
			const file = app.workspace.getActiveFile()!
			// Second leaf, same file — the split side of the bug (a popout
			// leaf hits the exact same code path, confirmed live; a plain
			// split is enough to cover the shared root cause).
			const leafB = app.workspace.getLeaf('split', 'vertical')
			await leafB.openFile(file)
			app.workspace.setActiveLeaf(leafA, { focus: true })
			return (leafA as any).id as string
		})

		await browser.executeObsidian(({ app, obsidian }, leafAId2) => {
			const leaf = app.workspace.getLeafById(leafAId2)!
			app.workspace.setActiveLeaf(leaf, { focus: true })
			const view = leaf.view as InstanceType<typeof obsidian.MarkdownView>
			view.editor.focus()
		}, leafAId)

		await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: l2, ch: 0 })
		}, l)

		await browser.executeObsidianCommand('universal-cursor-hotkeys:kill-line')
		// Gives the OTHER leaf's own file-sync echo time to actually land —
		// confirmed live that it arrives asynchronously, not synchronously
		// within the dispatch above; too short a gap wouldn't reproduce the
		// original bug at all.
		await browser.pause(300)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:kill-line')
		await browser.pause(100)
		await browser.executeObsidianCommand('universal-cursor-hotkeys:yank')

		const lines = await browser.executeObsidian(({ app, obsidian }, l2) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return [view.editor.getLine(l2), view.editor.getLine(l2 + 1)]
		}, l)
		await expect(lines).toEqual(['alpha', 'beta'])
	})
})
