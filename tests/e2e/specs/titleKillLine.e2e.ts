import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'
import { readFixtureBody } from '../helpers'

// 0.13.0 Feature 1, Kill/Yank step: Ctrl-K (Kill line) in the title field —
// the first content-MUTATING command to reach the title, everything before
// this was pure cursor movement. See titleCrossingShort/Wrapped.e2e.ts for
// the shared rationale (title = filename, created on the fly; hotkeys set
// explicitly since this plugin ships none by default; real KeyboardEvent
// dispatch to actually drive the Scope/Keymap push-stack).
//
// titleKillLine uses document.execCommand('delete', false) rather than
// Range.deleteContents() — confirmed live the former integrates with the
// title's own native undo stack while the latter does not (see test (2)
// below). It shares the exact same kill-ring (killCache/isKillChaining) as
// the body's own Kill line — tests (3)/(4) are the direct regression
// coverage for a real gap found while building this: isKillChaining's own
// auto-reset is wired entirely through CM6's updateListener, which never
// fires for the title at all (plain contenteditable, not CM6), so every
// non-kill title command needed an explicit reset added.
//
// Each test's title survives Ctrl-K down to a DIFFERENT prefix — not just
// cosmetic: Obsidian renames the file to match as the title is edited, and
// an earlier draft of this spec had every test converge on the SAME
// post-kill name ("Kill"), so the second test's own rename silently
// collided with the first's leftover file (confirmed live: a real
// in-app conflict notice, not a clean no-op) and broke everything
// downstream in that test. `after` cleans up both the original filename
// and the expected post-kill one, so a mid-test failure can't leave stale
// state for the next run either.
describe('Kill line (Ctrl-K) in the title field', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	// Opens a fresh note with the given title/body, places a collapsed
	// cursor at `titleOffset` within the title, and resets the shared
	// kill-ring state so each test starts from a known, deterministic
	// baseline regardless of what an earlier test in this shared-instance
	// file left behind. Deletes any leftover file at the post-kill name
	// too (see the describe block's own comment on why that matters).
	async function openNote(path: string, postKillName: string, body: string, titleOffset: number) {
		createdPaths.push(path, postKillName)
		await browser.executeObsidian(async ({ app, obsidian }, { path2, postKillPath, body2, offset }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.isKillChaining = false
			plugin.killCache = ''
			const hm = (app as any).hotkeyManager
			hm.setHotkeys('universal-cursor-hotkeys:kill-line', [{ modifiers: ['Ctrl'], key: 'K' }])
			hm.setHotkeys('universal-cursor-hotkeys:cursor-left', [{ modifiers: ['Ctrl'], key: 'B' }])
			hm.bake()
			app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach())
			for (const p of [path2, postKillPath]) {
				const existing = app.vault.getFileByPath(p)
				if (existing) await app.vault.delete(existing)
			}
			const file = await app.vault.create(path2, body2)
			await app.workspace.getLeaf(true).openFile(file)
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const doc = view.containerEl.ownerDocument
			const title = doc.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.focus()
			const textNode = title.firstChild as Text
			const range = doc.createRange()
			range.setStart(textNode, offset)
			range.collapse(true)
			const sel = doc.getSelection()!
			sel.removeAllRanges()
			sel.addRange(range)
		}, { path2: path, postKillPath: postKillName, body2: body, offset: titleOffset })
		// Deterministic instead of a fixed pause — confirmed live (while
		// building titleKillWord.e2e.ts, which hits this same openNote
		// shape) that a flat 300ms isn't always enough margin for
		// title.focus()'s own focusin handler to finish pushing the title
		// Scope on a freshly-opened leaf; failed as "nothing happened at
		// all" on the very first Ctrl-K press of a test.
		await browser.waitUntil(async () => {
			return browser.executeObsidian(({ app }) => {
				return (app as any).plugins.plugins['universal-cursor-hotkeys'].titleScope !== null
			})
		}, { timeout: 8000, interval: 50, timeoutMsg: 'title Scope never pushed' })
	}

	async function pressCtrl(el: 'body' | 'title', key: string) {
		await browser.executeObsidian(({ app, obsidian }, { el: el2, key: key2 }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const target = el2 === 'body'
				? (view.editor as any).cm.contentDOM
				: view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			target.dispatchEvent(new KeyboardEvent('keydown', { key: key2, ctrlKey: true, bubbles: true, cancelable: true }))
		}, { el, key })
		await browser.pause(150)
	}

	async function getTitleText() {
		return browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			return title.textContent
		})
	}

	it('(1) kills from the cursor to the title\'s own end; a second Ctrl-K right at the new end is a no-op', async function () {
		// Body content is irrelevant to this test (only the title is
		// exercised), so it's written as the description itself rather
		// than appended after unused positioning content.
		await openNote('KillBasicRestOfTitle.md', 'KillBasic.md',
			'E2E fixture for titleKillLine.e2e.ts test (1): body content is ' +
			'not used by this test, only the title. Created fresh and deleted ' +
			'after the test runs.', 9) // "KillBasic" | "RestOfTitle"
		await pressCtrl('title', 'k')
		await expect(await getTitleText()).toBe('KillBasic')
		await pressCtrl('title', 'k') // already at the end — nothing left to kill
		await expect(await getTitleText()).toBe('KillBasic')
	})

	it('(2) integrates with the title\'s own native undo stack (Ctrl-Z restores the killed text)', async function () {
		// Body content is irrelevant to this test (only the title is
		// exercised), so it's written as the description itself.
		await openNote('KillUndoRestOfTitle.md', 'KillUndo.md',
			'E2E fixture for titleKillLine.e2e.ts test (2): body content is ' +
			'not used by this test, only the title. Created fresh and deleted ' +
			'after the test runs.', 8) // "KillUndo" | "RestOfTitle"
		await pressCtrl('title', 'k')
		await expect(await getTitleText()).toBe('KillUndo')
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			const title = view.containerEl.querySelector(".inline-title[contenteditable='true']") as HTMLElement
			title.ownerDocument.execCommand('undo')
		})
		await expect(await getTitleText()).toBe('KillUndoRestOfTitle')
	})

	it('(3) chains with a kill-line in the body when nothing intervenes (shared kill-ring)', async function () {
		// ch6 on line0 and the yank-insertion point on line1 are both real
		// test positions in the fixture body.
		const body = await readFixtureBody('TitleKillLineBodyFixture.md')
		await openNote('KillChainRestOfTitle.md', 'KillChain.md', body, 9) // "KillChain" | "RestOfTitle"

		await pressCtrl('title', 'k') // kills "RestOfTitle" into the kill-ring
		await expect(await getTitleText()).toBe('KillChain')

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			// editor.setCursor alone updates CM6's own internal state but
			// does NOT move DOM focus away from the title (confirmed live:
			// without this, executeObsidianCommand's editorCallback never
			// actually fires — focus stayed in the title throughout, same
			// root cause titleMoveLineOrEscapeToBody's own escape-to-body
			// landing already has to handle for the real feature). No
			// intervening title command ran between this and the kill
			// above, so isKillChaining is still true going into it.
			view.editor.focus()
			view.editor.setCursor({ line: 0, ch: 6 }) // "alpha " | "bravo"
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:kill-line') // kills "bravo" — should CHAIN onto the title's own kill
		await browser.pause(150)

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: 1, ch: 0 })
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:yank')
		const bodyText = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getValue()
		})
		// The chained kill-ring entry is the title's own kill immediately
		// followed by the body's, with no separator (titleKillLine's own
		// updateKillCache call, like killLineOuter's single-range case,
		// adds none).
		await expect(bodyText).toContain('RestOfTitlebravo')
	})

	it('(4) an intervening title movement breaks the kill chain (isKillChaining reset gap fix)', async function () {
		// Same fixture as test (3) — ch6 on line0 and the yank-insertion
		// point on line1 are both real test positions. (Its own
		// description deliberately doesn't spell out the title's own kill
		// suffix, since this test asserts the final body text does not
		// contain that string.)
		const body = await readFixtureBody('TitleKillLineBodyFixture.md')
		await openNote('KillBreakRestOfTitle.md', 'KillBreak.md', body, 9) // "KillBreak" | "RestOfTitle"

		await pressCtrl('title', 'k') // kills "RestOfTitle" into the kill-ring
		await expect(await getTitleText()).toBe('KillBreak')

		await pressCtrl('title', 'b') // pure movement in the title — must reset isKillChaining

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.focus() // see test (3)'s own comment — required for executeObsidianCommand to actually fire
			view.editor.setCursor({ line: 0, ch: 6 })
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:kill-line') // kills "bravo" — must OVERWRITE, not chain
		await browser.pause(150)

		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			view.editor.setCursor({ line: 1, ch: 0 })
		})
		await browser.executeObsidianCommand('universal-cursor-hotkeys:yank')
		const bodyText = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!
			return view.editor.getValue()
		})
		await expect(bodyText).toContain('bravosecond line')
		await expect(bodyText).not.toContain('RestOfTitle')
	})
})
