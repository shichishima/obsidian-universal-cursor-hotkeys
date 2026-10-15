import { browser, expect } from '@wdio/globals'
import { describe, it } from 'mocha'

// Pure plumbing check: does Obsidian launch, load this plugin, and register
// its commands at all — before any real test writes a scenario against it.
describe('e2e pipeline wiring', function () {
	it('loads the plugin', async function () {
		// app.plugins/app.commands are internal, undocumented Obsidian APIs —
		// not part of the public `obsidian` package's own App type.
		const enabled = await browser.executeObsidian(({ app }) => {
			return (app as any).plugins.enabledPlugins.has('universal-cursor-hotkeys')
		})
		await expect(enabled).toBe(true)
	})

	it('registers its commands', async function () {
		const hasCommand = await browser.executeObsidian(({ app }) => {
			return 'universal-cursor-hotkeys:cursor-home' in (app as any).commands.commands
		})
		await expect(hasCommand).toBe(true)
	})
})
