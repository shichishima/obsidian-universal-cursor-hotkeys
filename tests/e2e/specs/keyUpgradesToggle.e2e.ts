import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'

// Key Upgrades toggles a real Obsidian hotkey assignment, not just display
// state — toggling a row on calls hotkeyManager.setHotkeys/save/bake. The
// unit test suite (computeKeyUpgradeRow.test.ts) already covers the row's
// own expected display logic, but never exercises the real hotkeyManager
// side effect, since that's a genuine Obsidian API with no meaningful mock.
//
// Exercises the HOME row ("3-step Smart home", commandId cursor-home,
// recommended key: bare Home) -- migrated to the Scope-based Key Upgrades
// rearchitecture (feat/key-upgrades-scope-rearchitecture, 0.13.1) alongside
// cursor-up/down earlier: toggling this row no longer touches hotkeyManager
// at all (see KeyUpgradeDef.scopeSettingKey's own doc comment in
// settings.ts) -- its on/off state now lives purely in the plugin's own
// keyUpgradeHomeScope setting, and hm.bakedIds for this fullId must stay
// empty regardless of the toggle's state, which is the whole point of the
// rearchitecture (no root-scope claim left to steal the bare key from
// Excalidraw/Bases/frontmatter). Previously (before this migration) this
// test asserted the OLD hm.setHotkeys-based behavior for this exact row;
// updated in place rather than left stale once the row's own mechanism
// changed.
//
// app.setting.openTabById() renders the tab's own containerEl fully (in
// memory — confirmed live its innerHTML is populated), but doesn't attach
// it to the live document in this environment (confirmed live: it's never
// true even right after the real "app:open-settings" command, or after
// patching window.activeDocument/activeWindow first — neither is what
// actually gates this). A detached element's own click handlers don't fire
// correctly even via a direct .click() call, so this appends it to
// document.body itself before clicking, and removes it again afterward.
describe('Key Upgrades hotkey assignment', function () {
	it('toggling the HOME row on/off flips keyUpgradeHomeScope, never touches hotkeyManager', async function () {
		const fullId = 'universal-cursor-hotkeys:cursor-home'

		function readBakedHomeKeys() {
			return browser.executeObsidian(({ app }, fullId2) => {
				const hm = (app as any).hotkeyManager
				const matches = []
				for (let i = 0; i < hm.bakedIds.length; i++) {
					if (hm.bakedIds[i] === fullId2) matches.push(hm.bakedHotkeys[i])
				}
				return matches
			}, fullId)
		}

		function readHomeScopeSetting() {
			return browser.executeObsidian(({ app }) => {
				const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
				return plugin.settings.keyUpgradeHomeScope
			})
		}

		function clickHomeRowToggle() {
			return browser.executeObsidian(({ app }) => {
				const plugin = (app as any).plugins.plugins['universal-cursor-hotkeys']
				plugin.settings.activeSettingsTab = 'general' // confirmed live: can default to something else
				const setting = (app as any).setting
				const tab = setting.openTabById('universal-cursor-hotkeys')
				if (!document.contains(setting.containerEl)) document.body.appendChild(setting.containerEl)
				const rows = Array.from(tab.containerEl.querySelectorAll('.uch-row-thin')) as HTMLElement[]
				const row = rows.find(r => r.textContent?.includes('3-step Smart home'))
				const checkbox = row?.querySelector('input[type="checkbox"]') as HTMLInputElement
				checkbox.closest('.checkbox-container')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
			})
		}

		function closeSettings() {
			return browser.executeObsidian(({ app }) => {
				const setting = (app as any).setting
				setting.close?.()
				setting.containerEl.remove()
			})
		}

		try {
			await expect(await readHomeScopeSetting()).toBe(false) // off by default
			await expect(await readBakedHomeKeys()).toEqual([]) // never baked, regardless of toggle state

			await clickHomeRowToggle() // toggle on
			await expect(await readHomeScopeSetting()).toBe(true)
			await expect(await readBakedHomeKeys()).toEqual([])

			await clickHomeRowToggle() // toggle off again (same checkbox, now checked)
			await expect(await readHomeScopeSetting()).toBe(false)
			await expect(await readBakedHomeKeys()).toEqual([])
		} finally {
			await closeSettings()
		}
	})
})
