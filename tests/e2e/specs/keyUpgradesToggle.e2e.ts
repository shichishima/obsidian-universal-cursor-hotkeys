import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'

// Key Upgrades toggles a real Obsidian hotkey assignment, not just display
// state — toggling a row on calls hotkeyManager.setHotkeys/save/bake. The
// unit test suite (computeKeyUpgradeRow.test.ts) already covers the row's
// own expected display logic, but never exercises the real hotkeyManager
// side effect, since that's a genuine Obsidian API with no meaningful mock.
// Exercises the HOME row ("3-step Smart home", commandId cursor-home,
// recommended key: bare Home).
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
	it('toggling a row on/off actually calls hotkeyManager.setHotkeys', async function () {
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
			const before = await readBakedHomeKeys()
			await expect(before).toEqual([]) // not assigned by default

			await clickHomeRowToggle() // toggle on
			const afterOn = await readBakedHomeKeys()
			await expect(afterOn).toEqual([{ modifiers: '', key: 'Home' }])

			await clickHomeRowToggle() // toggle off again (same checkbox, now checked)
			const afterOff = await readBakedHomeKeys()
			await expect(afterOff).toEqual([])
		} finally {
			await closeSettings()
		}
	})
})
