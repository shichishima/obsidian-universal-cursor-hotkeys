import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'
import { installVimWindow, uninstallVimWindow } from './__helpers__/vimWindow'

// VimSupport's per-feature toggle state machine (setup/teardown/setXEnabled/
// needsRestart) — pure class logic, no DOM involved, so this only needs the
// same window.CodeMirrorAdapter.Vim stub the join/visual-mode tests already use.

const makeSettings = (overrides: Partial<VimSupportHost['settings']> = {}): VimSupportHost['settings'] => ({
	vimHlSupport: false,
	vimJkSupport: false,
	vimJoinSupport: false,
	vimCaretSupport: false,
	vimWordSupport: false,
	vimGgSupport: false,
	vimDisplayLineSupport: false,
	vimEolSupport: false,
	vimTableStructureSupport: false, vimTableNavigationSupport: false,
	vimLeaderUseBackslash: false,
	smartJoin: false,
	smartHomeStandard: false,
	...overrides,
})

const makeHost = (settings: VimSupportHost['settings'] = makeSettings()): VimSupportHost => ({
	settings,
	saveSettings: vi.fn().mockResolvedValue(undefined),
	crossTableRowForCell: vi.fn().mockReturnValue(null),
	getAdjacentRowLine: vi.fn().mockReturnValue(0),
	crossTableRowForWord: vi.fn().mockReturnValue(null),
	jumpToDocumentLine: vi.fn().mockReturnValue(null),
	isLinePartOfTable: vi.fn().mockReturnValue(false),
	enterTableAtLine: vi.fn().mockReturnValue(null),
	refineDisplayLineColumn: vi.fn().mockReturnValue(null),
	getBeginningOfLinePosition: vi.fn().mockReturnValue(0),
	executeObsidianCommand: vi.fn().mockReturnValue(true),
})

describe('VimSupport per-feature toggles', () => {
	let defineMotion: ReturnType<typeof vi.fn>
	let defineAction: ReturnType<typeof vi.fn>
	let mapCommand: ReturnType<typeof vi.fn>
	let unmap: ReturnType<typeof vi.fn>

	beforeEach(() => {
		installVimWindow()
		defineMotion = vi.fn()
		defineAction = vi.fn()
		mapCommand = vi.fn()
		unmap = vi.fn().mockReturnValue(true)
		;(globalThis as any).window.CodeMirrorAdapter = { Vim: { defineMotion, defineAction, mapCommand, unmap, exitVisualMode: vi.fn() } }
	})

	afterEach(() => {
		uninstallVimWindow()
	})

	// Last function registered under `name`, across either mock.
	const lastRegistered = (name: string): unknown => {
		const calls = [...defineMotion.mock.calls, ...defineAction.mock.calls];
		return [...calls].reverse().find(c => c[0] === name)?.[1]
	}
	const wasRegistered = (name: string): boolean => lastRegistered(name) !== undefined

	describe('setup()', () => {
		it('applies only the features whose setting is on', () => {
			const host = makeHost(makeSettings({ vimHlSupport: true, vimJoinSupport: true, vimGgSupport: true }))
			const vim = new VimSupport(host)
			vim.setup()
			expect(lastRegistered('moveByCharacters')).toBe((vim as any).moveByCharacters)
			expect(lastRegistered('joinLines')).toBe((vim as any).joinLines)
			expect(lastRegistered('moveToLineOrEdgeOfDocument')).toBe((vim as any).moveToLineOrEdgeOfDocument)
			expect(wasRegistered('moveByLines')).toBe(false)
			expect(wasRegistered('moveToFirstNonWhiteSpaceCharacter')).toBe(false)
			expect(wasRegistered('moveByWords')).toBe(false)
			expect(wasRegistered('moveByDisplayLines')).toBe(false)
			expect(wasRegistered('moveToEol')).toBe(false)
		})

		it('applies nothing when every feature is off', () => {
			const vim = new VimSupport(makeHost())
			vim.setup()
			expect(defineMotion).not.toHaveBeenCalled()
			expect(defineAction).not.toHaveBeenCalled()
		})
	})

	describe('teardown()', () => {
		it('restores all 8 overrides regardless of their setting state', () => {
			const vim = new VimSupport(makeHost())
			vim.teardown()
			expect(wasRegistered('moveByCharacters')).toBe(true)
			expect(wasRegistered('moveByLines')).toBe(true)
			expect(wasRegistered('joinLines')).toBe(true)
			expect(wasRegistered('moveToFirstNonWhiteSpaceCharacter')).toBe(true)
			expect(wasRegistered('moveByWords')).toBe(true)
			expect(wasRegistered('moveToLineOrEdgeOfDocument')).toBe(true)
			expect(wasRegistered('moveByDisplayLines')).toBe(true)
			expect(wasRegistered('moveToEol')).toBe(true)
		})

		it('restore target for h/l matches vim.js\'s own native default (no line-boundary clamp, unlike the live override)', () => {
			const vim = new VimSupport(makeHost())
			vim.teardown()
			const restored = lastRegistered('moveByCharacters') as (cm: unknown, head: unknown, args: unknown) => unknown
			const cm = { getLine: () => 'hi' }
			// vim.js's own default: naive ch+repeat, no clamping to the line's own
			// end — unlike the live override (see vimMoveByCharacters.test.ts),
			// which would clamp this same input to ch: 2.
			expect(restored(cm, { line: 0, ch: 1 }, { forward: true, repeat: 5 })).toEqual({ line: 0, ch: 6 })
		})

		it('restore target for $ lands on the line\'s own last character, with no goal-column persistence (see vimMoveToEol.test.ts for the live override\'s own Infinity-goal behavior)', () => {
			const vim = new VimSupport(makeHost())
			vim.teardown()
			const restored = lastRegistered('moveToEol') as (cm: unknown, head: unknown, args: unknown) => unknown
			const cm = { getLine: (n: number) => (n === 0 ? 'aaaaa' : 'bb'), lastLine: () => 1 }
			expect(restored(cm, { line: 0, ch: 2 }, { forward: true, repeat: 1 })).toEqual({ line: 0, ch: 4 })
		})
	})

	describe('setHlEnabled', () => {
		it('turning on applies the live override, saves settings, and does not need a restart', () => {
			const host = makeHost()
			const vim = new VimSupport(host)
			vim.setHlEnabled(true)
			expect(host.settings.vimHlSupport).toBe(true)
			expect(lastRegistered('moveByCharacters')).toBe((vim as any).moveByCharacters)
			expect(host.saveSettings).toHaveBeenCalled()
			expect(vim.needsRestart).toBe(false)
		})

		it('turning off restores vim\'s native default and flags needsRestart', () => {
			const host = makeHost(makeSettings({ vimHlSupport: true }))
			const vim = new VimSupport(host)
			vim.setHlEnabled(false)
			expect(host.settings.vimHlSupport).toBe(false)
			expect(lastRegistered('moveByCharacters')).not.toBe((vim as any).moveByCharacters)
			expect(vim.needsRestart).toBe(true)
		})
	})

	describe('setJkEnabled', () => {
		it('turning on applies the live override and does not need a restart', () => {
			const vim = new VimSupport(makeHost())
			vim.setJkEnabled(true)
			expect(lastRegistered('moveByLines')).toBe((vim as any).moveByLines)
			expect(vim.needsRestart).toBe(false)
		})

		it('turning off restores the default and flags needsRestart', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimJkSupport: true })))
			vim.setJkEnabled(false)
			expect(lastRegistered('moveByLines')).not.toBe((vim as any).moveByLines)
			expect(vim.needsRestart).toBe(true)
		})
	})

	describe('setJoinEnabled', () => {
		it('turning on applies the live override and does not need a restart', () => {
			const vim = new VimSupport(makeHost())
			vim.setJoinEnabled(true)
			expect(lastRegistered('joinLines')).toBe((vim as any).joinLines)
			expect(vim.needsRestart).toBe(false)
		})

		it('turning off restores the default and flags needsRestart', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimJoinSupport: true })))
			vim.setJoinEnabled(false)
			expect(lastRegistered('joinLines')).not.toBe((vim as any).joinLines)
			expect(vim.needsRestart).toBe(true)
		})
	})

	describe('setCaretEnabled', () => {
		it('turning on applies the live override and does not need a restart', () => {
			const vim = new VimSupport(makeHost())
			vim.setCaretEnabled(true)
			expect(lastRegistered('moveToFirstNonWhiteSpaceCharacter')).toBe((vim as any).moveToFirstNonWhiteSpaceCharacter)
			expect(vim.needsRestart).toBe(false)
		})

		it('turning off restores the default and flags needsRestart', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimCaretSupport: true })))
			vim.setCaretEnabled(false)
			expect(lastRegistered('moveToFirstNonWhiteSpaceCharacter')).not.toBe((vim as any).moveToFirstNonWhiteSpaceCharacter)
			expect(vim.needsRestart).toBe(true)
		})
	})

	describe('setWordsEnabled', () => {
		it('turning on applies the live override and does not need a restart', () => {
			const vim = new VimSupport(makeHost())
			vim.setWordsEnabled(true)
			expect(lastRegistered('moveByWords')).toBe((vim as any).moveByWords)
			expect(vim.needsRestart).toBe(false)
		})

		it('turning off restores the default and flags needsRestart', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimWordSupport: true })))
			vim.setWordsEnabled(false)
			expect(lastRegistered('moveByWords')).not.toBe((vim as any).moveByWords)
			expect(vim.needsRestart).toBe(true)
		})
	})

	describe('setGgEnabled', () => {
		it('turning on applies the live override and does not need a restart', () => {
			const vim = new VimSupport(makeHost())
			vim.setGgEnabled(true)
			expect(lastRegistered('moveToLineOrEdgeOfDocument')).toBe((vim as any).moveToLineOrEdgeOfDocument)
			expect(vim.needsRestart).toBe(false)
		})

		it('turning off restores the default and flags needsRestart', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimGgSupport: true })))
			vim.setGgEnabled(false)
			expect(lastRegistered('moveToLineOrEdgeOfDocument')).not.toBe((vim as any).moveToLineOrEdgeOfDocument)
			expect(vim.needsRestart).toBe(true)
		})
	})

	describe('setDisplayLinesEnabled', () => {
		it('turning on applies the live override and does not need a restart', () => {
			const vim = new VimSupport(makeHost())
			vim.setDisplayLinesEnabled(true)
			expect(lastRegistered('moveByDisplayLines')).toBe((vim as any).moveByDisplayLines)
			expect(vim.needsRestart).toBe(false)
		})

		it('turning off restores the default and flags needsRestart', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimDisplayLineSupport: true })))
			vim.setDisplayLinesEnabled(false)
			expect(lastRegistered('moveByDisplayLines')).not.toBe((vim as any).moveByDisplayLines)
			expect(vim.needsRestart).toBe(true)
		})
	})

	describe('setEolEnabled', () => {
		it('turning on applies the live override and does not need a restart', () => {
			const vim = new VimSupport(makeHost())
			vim.setEolEnabled(true)
			expect(lastRegistered('moveToEol')).toBe((vim as any).moveToEol)
			expect(vim.needsRestart).toBe(false)
		})

		it('turning off restores the default and flags needsRestart', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimEolSupport: true })))
			vim.setEolEnabled(false)
			expect(lastRegistered('moveToEol')).not.toBe((vim as any).moveToEol)
			expect(vim.needsRestart).toBe(true)
		})
	})

	describe('needsRestart', () => {
		it('stays true for the rest of the session even after re-enabling', () => {
			const vim = new VimSupport(makeHost())
			vim.setHlEnabled(true)
			vim.setHlEnabled(false)
			expect(vim.needsRestart).toBe(true)
			vim.setHlEnabled(true)
			expect(vim.needsRestart).toBe(true) // does not clear
		})

		it('is a single shared flag — disabling one feature flags it for all', () => {
			const vim = new VimSupport(makeHost(makeSettings({ vimJkSupport: true })))
			expect(vim.needsRestart).toBe(false)
			vim.setJkEnabled(false)
			expect(vim.needsRestart).toBe(true)
		})
	})
})
