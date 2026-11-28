import { browser, expect } from '@wdio/globals'
import { describe, it, after } from 'mocha'

// Scope-based Key Upgrades rearchitecture (feat/key-upgrades-scope-
// rearchitecture, 0.13.1, see project_key_upgrades_scope_based_
// rearchitecture_0_13_1 memory): the whole point of replacing the global
// hotkeyManager.setHotkeys claim with a focus-scoped app.keymap.Scope is
// that non-CM6 surfaces stop losing bare keys to this plugin regardless of
// focus. Excalidraw is the original motivating case (reported breakage:
// bare ArrowUp/Down and Home/End not reaching its own canvas-object-nudge
// or in-shape text editing while a Key Upgrade claimed them) and the one
// the cursor-up/down prototype was manually verified against live
// (2026-11-19) -- but never with an automated E2E test, since this vault
// had no real non-CM6 plugin surface to test against until Excalidraw was
// added to tests/e2e/wdio.conf.mts (2026-11-28). This is that automated
// equivalent, extended to cover cursor-home/cursor-end (migrated this same
// session) alongside cursor-up/cursor-down.
//
// Excalidraw shows a one-time "Welcome to Excalidraw" modal covering the
// entire view the first time `excalidraw-autocreate` runs in a freshly
// copied vault (no persisted "already seen" state to carry over) -- every
// test below dismisses it defensively via Escape before interacting with
// the canvas. The canvas itself is pointer-events:none (a separate
// "static" background canvas sits on top for grid rendering); the real
// interactive canvas is `canvas.excalidraw__canvas.interactive`. Toolbar
// buttons need a real `.click()` (WebDriver's own interactability check
// rejects them as occluded by Obsidian's frameless-window title bar in
// this environment, even though they're genuinely clickable for a real
// user) -- confirmed live this still produces a real React state update
// (aria-pressed flips), unlike a fully synthetic PointerEvent sequence
// dispatched on the canvas itself, which produced no observable effect at
// all (canvas pointer handling needs WebDriver's own trusted pointer
// actions, not a scripted dispatchEvent).
describe('Excalidraw: Key Upgrades scope-based rearchitecture does not steal bare keys', function () {
	const createdPaths: string[] = []

	after(async function () {
		await browser.executeObsidian(async ({ app }, paths) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.settings.keyUpgradeHomeScope = false
			plugin.settings.keyUpgradeEndScope = false
			plugin.settings.keyUpgradeArrowUpScope = false
			plugin.settings.keyUpgradeArrowDownScope = false
			await plugin.saveSettings()
			app.workspace.getLeavesOfType('excalidraw').forEach((leaf: any) => leaf.detach())
			for (const path of paths) {
				const file = app.vault.getFileByPath(path)
				if (file) await app.vault.delete(file)
			}
		}, createdPaths)
	})

	async function openFreshDrawing() {
		const activeFilePath = await browser.executeObsidian(async ({ app }) => {
			await (app as any).commands.executeCommandById('obsidian-excalidraw-plugin:excalidraw-autocreate')
			return app.workspace.getActiveFile()?.path ?? null
		})
		if (activeFilePath) createdPaths.push(activeFilePath)
		await browser.pause(2000)
		// Dismiss "Welcome to Excalidraw" if present -- harmless no-op if
		// it isn't (e.g. a later call in the same already-seen session).
		await browser.keys(['Escape'])
		await browser.pause(300)
	}

	function clickToolbarButton(testId: string) {
		return browser.executeObsidian(({ app }, testId2) => {
			const leaf = app.workspace.getLeavesOfType('excalidraw')[0]
			const containerEl = (leaf?.view as any)?.containerEl as HTMLElement
			const btn = containerEl.querySelector(`[data-testid="${testId2}"]`) as HTMLElement
			btn.click()
		}, testId)
	}

	async function interactiveCanvasRect() {
		return browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('excalidraw')[0]
			const containerEl = (leaf?.view as any)?.containerEl as HTMLElement
			const canvas = containerEl.querySelector('canvas.excalidraw__canvas.interactive') as HTMLCanvasElement
			const r = canvas.getBoundingClientRect()
			return { x: r.x, y: r.y, width: r.width, height: r.height }
		})
	}

	function activeElementInfo() {
		return browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('excalidraw')[0]
			const containerEl = (leaf?.view as any)?.containerEl as HTMLElement
			const active = containerEl.ownerDocument.activeElement as HTMLElement
			return { tag: active?.tagName, isCE: active?.isContentEditable }
		})
	}

	// Checks specifically for a BARE-key entry (no modifiers) on the given
	// command -- not "nothing at all baked for it". This suite's many
	// other, unrelated specs commonly bind real modified hotkeys (Ctrl-A/
	// E, Ctrl-P/N, etc.) to these same commands as part of their own
	// fixture setup and don't always reset them afterward, since nothing
	// before this file ever asserted on residual hm state -- a real,
	// pre-existing suite-wide hygiene gap (confirmed live: this exact
	// leak from other specs is what the broader assertion originally
	// caught, not anything wrong with this migration). The actual
	// architectural guarantee this migration makes is narrower: no BARE
	// key claim on the root scope for these commands, regardless of what
	// modified combo some other spec may have left behind.
	function hasBareKeyBaked(commandId: string, key: string) {
		return browser.executeObsidian(({ app }, { commandId2, key2 }) => {
			const hm = (app as any).hotkeyManager
			return hm.bakedIds.some((id: string, i: number) =>
				id === commandId2 && hm.bakedHotkeys[i].key === key2 && hm.bakedHotkeys[i].modifiers === '')
		}, { commandId2: commandId, key2: key })
	}

	it('bare Home/End still move the caret inside an Excalidraw text element, with keyUpgradeHomeScope/EndScope on', async function () {
		await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			// The whole point: flip the plugin's own setting, never hm.setHotkeys.
			plugin.settings.keyUpgradeHomeScope = true
			plugin.settings.keyUpgradeEndScope = true
			await plugin.saveSettings()
		})

		await openFreshDrawing()
		await clickToolbarButton('toolbar-text')
		await browser.pause(300)

		const rect = await interactiveCanvasRect()
		await browser.performActions([{
			type: 'pointer', id: 'mouse1', parameters: { pointerType: 'mouse' },
			actions: [
				{ type: 'pointerMove', duration: 0, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
				{ type: 'pointerDown', button: 0 },
				{ type: 'pause', duration: 50 },
				{ type: 'pointerUp', button: 0 },
			],
		}])
		await browser.releaseActions()
		await browser.pause(600)

		const afterClick = await activeElementInfo()
		await expect(afterClick.tag).toBe('TEXTAREA') // Excalidraw's own text-edit widget, not a CM6 instance

		await browser.keys(['h', 'e', 'l', 'l', 'o'])
		await browser.pause(150)
		await browser.keys(['Home'])
		await browser.pause(150)
		await browser.keys(['x'])
		await browser.pause(150)
		await browser.keys(['End'])
		await browser.pause(150)
		await browser.keys(['y'])
		await browser.pause(150)

		const text = await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('excalidraw')[0]
			const containerEl = (leaf?.view as any)?.containerEl as HTMLElement
			const active = containerEl.ownerDocument.activeElement as HTMLTextAreaElement
			return active.value
		})
		// "hello" -> Home -> "x" inserted at start -> "xhello" -> End ->
		// "y" appended at end -> "xhelloy". Either Home or End alone being
		// swallowed would leave "x" or "y" at the wrong end instead.
		await expect(text).toBe('xhelloy')

		await expect(await hasBareKeyBaked('universal-cursor-hotkeys:cursor-home', 'Home')).toBe(false)
		await expect(await hasBareKeyBaked('universal-cursor-hotkeys:cursor-end', 'End')).toBe(false)
	})

	it('bare ArrowUp/Down still nudge a selected Excalidraw shape, with keyUpgradeArrowUpScope/DownScope on', async function () {
		await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
			plugin.settings.keyUpgradeArrowUpScope = true
			plugin.settings.keyUpgradeArrowDownScope = true
			await plugin.saveSettings()
		})

		await openFreshDrawing()
		await clickToolbarButton('toolbar-rectangle')
		await browser.pause(300)

		const rect = await interactiveCanvasRect()
		const x1 = Math.round(rect.x + 100), y1 = Math.round(rect.y + 100)
		const x2 = Math.round(rect.x + 220), y2 = Math.round(rect.y + 180)
		await browser.performActions([{
			type: 'pointer', id: 'mouse1', parameters: { pointerType: 'mouse' },
			actions: [
				{ type: 'pointerMove', duration: 0, x: x1, y: y1 },
				{ type: 'pointerDown', button: 0 },
				{ type: 'pointerMove', duration: 200, x: x2, y: y2 },
				{ type: 'pointerUp', button: 0 },
			],
		}])
		await browser.releaseActions()
		await browser.pause(500)

		async function rectPosition() {
			return browser.executeObsidian(({ app }) => {
				const leaf = app.workspace.getLeavesOfType('excalidraw')[0]
				const ea = (window as any).ExcalidrawAutomate.getAPI(leaf.view)
				const el = ea.getViewElements().find((e: any) => e.type === 'rectangle')
				return { x: el.x, y: el.y }
			})
		}

		const before = await rectPosition()
		await browser.keys(['ArrowDown'])
		await browser.keys(['ArrowDown'])
		await browser.pause(300)
		const afterDown = await rectPosition()
		// Native Excalidraw nudge, not this plugin's cursor-down (which has
		// no meaning for a canvas shape at all) -- only the y coordinate
		// should move, and only by Excalidraw's own per-press nudge amount.
		await expect(afterDown.x).toBe(before.x)
		await expect(afterDown.y).toBeGreaterThan(before.y)

		await browser.keys(['ArrowUp'])
		await browser.pause(300)
		const afterUp = await rectPosition()
		await expect(afterUp.y).toBeLessThan(afterDown.y)

		await expect(await hasBareKeyBaked('universal-cursor-hotkeys:cursor-up', 'ArrowUp')).toBe(false)
		await expect(await hasBareKeyBaked('universal-cursor-hotkeys:cursor-down', 'ArrowDown')).toBe(false)
	})
})
