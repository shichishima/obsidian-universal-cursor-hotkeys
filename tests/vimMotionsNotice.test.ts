import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

const { noticeSpy } = vi.hoisted(() => ({ noticeSpy: vi.fn() }))
vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>()
	return { ...actual, Notice: noticeSpy }
})

import UniversalCursorHotkeysPlugin from '../main.ts'

// main.ts's warnIfVimMotionsCoexisting — informational-only Notice shown when
// Vim Motions is also installed and at least one of this plugin's own Vim
// overrides is enabled. Does not affect whether those overrides apply (see
// vim-support.ts's own getVim() for that gate) — purely a heads-up.

const makeSettings = (overrides: Record<string, boolean> = {}) => ({
	vimHlSupport: false,
	vimJkSupport: false,
	vimJoinSupport: false,
	vimCaretSupport: false,
	vimWordSupport: false,
	vimGgSupport: false,
	vimDisplayLineSupport: false,
	vimEolSupport: false,
	...overrides,
})

describe('warnIfVimMotionsCoexisting (main.ts)', () => {
	let plugin: any

	beforeEach(() => {
		noticeSpy.mockClear()
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
	})

	it('shows a Notice when Vim Motions is installed and a Vim override is enabled', () => {
		plugin.settings = makeSettings({ vimHlSupport: true })
		plugin.app = { plugins: { plugins: { 'vim-motions': {} } } }
		plugin.warnIfVimMotionsCoexisting()
		expect(noticeSpy).toHaveBeenCalledTimes(1)
	})

	it('does not show a Notice when Vim Motions is not installed', () => {
		plugin.settings = makeSettings({ vimHlSupport: true })
		plugin.app = { plugins: { plugins: {} } }
		plugin.warnIfVimMotionsCoexisting()
		expect(noticeSpy).not.toHaveBeenCalled()
	})

	it('does not show a Notice when no Vim override of this plugin\'s own is enabled, even if Vim Motions is installed', () => {
		plugin.settings = makeSettings()
		plugin.app = { plugins: { plugins: { 'vim-motions': {} } } }
		plugin.warnIfVimMotionsCoexisting()
		expect(noticeSpy).not.toHaveBeenCalled()
	})
})
