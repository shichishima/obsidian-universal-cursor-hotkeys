import { describe, it, expect } from 'vitest'
import { computeRow, hotkeyId, formatHotkey, normMods } from '../settings'
import type { CommandDef, BakedHotkey } from '../settings'
import type { Modifier } from 'obsidian'

// ── helpers ──────────────────────────────────────────────────────────────────

const rec = (key: string, ...mods: Modifier[]): { modifiers: Modifier[]; key: string } => ({ modifiers: mods, key })

const def = (id: string, recommended: { modifiers: Modifier[]; key: string } | null): CommandDef => ({
	block: 'cursor', id, name: id.toUpperCase(), recommended,
})

const baked = (modifiers: string, key: string): BakedHotkey => ({ modifiers, key })

const makeEffective = (entries: Array<[string, BakedHotkey]>) =>
	(cmdId: string): BakedHotkey[] => entries.filter(([id]) => id === cmdId).map(([, hk]) => hk)

const makeReverseMap = (entries: Array<[string, BakedHotkey]>): Map<string, string[]> => {
	const map = new Map<string, string[]>()
	for (const [id, hk] of entries) {
		const kid = hotkeyId(hk)
		const list = map.get(kid)
		if (list) list.push(id)
		else map.set(kid, [id])
	}
	return map
}

const cmds = (ids: string[]): Record<string, { name: string }> =>
	Object.fromEntries(ids.map(id => [id, { name: id }]))

const PLUGIN_PREFIX = 'universal-cursor-hotkeys'
const uchId = (id: string) => `${PLUGIN_PREFIX}:${id}`

// ── normMods ─────────────────────────────────────────────────────────────────

describe('normMods', () => {
	it('array input passes through', () => {
		expect(normMods(['Ctrl', 'Shift'])).toEqual(['Ctrl', 'Shift'])
	})
	it('comma-separated string splits correctly', () => {
		expect(normMods('Ctrl,Shift')).toEqual(['Ctrl', 'Shift'])
	})
	it('empty string returns empty array', () => {
		expect(normMods('')).toEqual([])
	})
	it('empty array returns empty array', () => {
		expect(normMods([])).toEqual([])
	})
})

// ── hotkeyId ─────────────────────────────────────────────────────────────────

describe('hotkeyId', () => {
	it('modifiers are sorted', () => {
		expect(hotkeyId({ modifiers: ['Shift', 'Ctrl'], key: 'A' }))
			.toBe(hotkeyId({ modifiers: ['Ctrl', 'Shift'], key: 'A' }))
	})
	it('key is lowercased', () => {
		expect(hotkeyId({ modifiers: ['Ctrl'], key: 'A' }))
			.toBe(hotkeyId({ modifiers: ['Ctrl'], key: 'a' }))
	})
	it('bare key has no modifier prefix', () => {
		expect(hotkeyId({ modifiers: [], key: 'Home' })).toBe('+home')
	})
	it('baked string modifiers work', () => {
		expect(hotkeyId({ modifiers: 'Ctrl', key: 'a' })).toBe('Ctrl+a')
	})
})

// ── formatHotkey ─────────────────────────────────────────────────────────────

describe('formatHotkey', () => {
	it('Windows: Ctrl+A', () => {
		expect(formatHotkey({ modifiers: ['Ctrl'], key: 'A' }, false)).toBe('Ctrl+A')
	})
	it('Windows: Ctrl+Shift+A', () => {
		expect(formatHotkey({ modifiers: ['Ctrl', 'Shift'], key: 'A' }, false)).toBe('Ctrl+Shift+A')
	})
	it('Windows: Alt+A', () => {
		expect(formatHotkey({ modifiers: ['Alt'], key: 'A' }, false)).toBe('Alt+A')
	})
	it('Windows: Meta+A → Win+A', () => {
		expect(formatHotkey({ modifiers: ['Meta'], key: 'A' }, false)).toBe('Win+A')
	})
	it('Windows: bare Home', () => {
		expect(formatHotkey({ modifiers: [], key: 'Home' }, false)).toBe('Home')
	})
	it('Windows: PageDown → Page Down', () => {
		expect(formatHotkey({ modifiers: [], key: 'PageDown' }, false)).toBe('Page Down')
	})
	it('Windows: PageUp → Page Up', () => {
		expect(formatHotkey({ modifiers: [], key: 'PageUp' }, false)).toBe('Page Up')
	})
	it('Mac: Ctrl+A → ⌃ A', () => {
		expect(formatHotkey({ modifiers: ['Ctrl'], key: 'A' }, true)).toBe('⌃ A')
	})
	it('Mac: Mod+A → ⌘ A', () => {
		expect(formatHotkey({ modifiers: ['Mod'], key: 'A' }, true)).toBe('⌘ A')
	})
	it('Mac: Shift+A → ⇧ A', () => {
		expect(formatHotkey({ modifiers: ['Shift'], key: 'A' }, true)).toBe('⇧ A')
	})
	it('Mac: Alt+A → ⌥ A', () => {
		expect(formatHotkey({ modifiers: ['Alt'], key: 'A' }, true)).toBe('⌥ A')
	})
	it('Mac: Meta+A → ⌘ A', () => {
		expect(formatHotkey({ modifiers: ['Meta'], key: 'A' }, true)).toBe('⌘ A')
	})
	it('Mac: Ctrl+Shift+A → ⌃⇧ A', () => {
		expect(formatHotkey({ modifiers: ['Ctrl', 'Shift'], key: 'A' }, true)).toBe('⌃⇧ A')
	})
})

// ── computeRow ───────────────────────────────────────────────────────────────

describe('computeRow — recommended: null', () => {
	it('action is none, status is dash', () => {
		const row = computeRow(def('page-down', null), makeEffective([]), new Map(), undefined)
		expect(row.action).toBe('none')
		expect(row.status).toBe('—')
	})
	it('shows current hotkey if assigned', () => {
		const hk = baked('Ctrl', 'P')
		const row = computeRow(
			def('page-down', null),
			makeEffective([[uchId('page-down'), hk]]),
			new Map(), undefined,
		)
		expect(row.current).toBe('Ctrl+P')
	})
	it('multiple hotkeys: extraCount is length - 1', () => {
		const entries: Array<[string, BakedHotkey]> = [
			[uchId('page-down'), baked('Ctrl', 'P')],
			[uchId('page-down'), baked('Ctrl', 'N')],
			[uchId('page-down'), baked('Ctrl', 'F')],
		]
		const row = computeRow(def('page-down', null), makeEffective(entries), new Map(), undefined)
		expect(row.extraCount).toBe(2)
		expect(row.current).toBe('Ctrl+P')
	})
})

describe('computeRow — recommended set, already applied', () => {
	it('action is done, status is Set', () => {
		const hk = baked('Ctrl', 'A')
		const row = computeRow(
			def('cursor-home', rec('A', 'Ctrl')),
			makeEffective([[uchId('cursor-home'), hk]]),
			new Map(), undefined,
		)
		expect(row.action).toBe('done')
		expect(row.status).toBe('✅ Set')
	})
	it('rec applied but another command also uses that key → action done, status 🔴Conflict', () => {
		const otherId = 'other-plugin:some-cmd'
		const entries: Array<[string, BakedHotkey]> = [
			[uchId('cursor-home'), baked('Ctrl', 'A')],
			[otherId,              baked('Ctrl', 'A')],
		]
		const row = computeRow(
			def('cursor-home', rec('A', 'Ctrl')),
			makeEffective(entries),
			makeReverseMap(entries),
			cmds([otherId]),
		)
		expect(row.action).toBe('done')
		expect(row.status).toBe('🔴Conflict: ')
		expect(row.conflictIds).toEqual([otherId])
	})
})

describe('computeRow — custom key (different from recommended)', () => {
	it('action is done, status is Custom key', () => {
		const hk = baked('Ctrl', 'H')
		const row = computeRow(
			def('cursor-home', rec('A', 'Ctrl')),
			makeEffective([[uchId('cursor-home'), hk]]),
			new Map(), undefined,
		)
		expect(row.action).toBe('done')
		expect(row.status).toBe('🔵Custom')
	})
})

describe('computeRow — no hotkey, no conflict', () => {
	it('action is set, status is No conflict', () => {
		const row = computeRow(
			def('cursor-home', rec('A', 'Ctrl')),
			makeEffective([]),
			new Map(), undefined,
		)
		expect(row.action).toBe('set')
		expect(row.status).toBe('Available')
		expect(row.conflictIds).toEqual([])
	})
})

describe('computeRow — conflict with active command', () => {
	it('action is overwrite, single conflict gets warning icon', () => {
		const otherId = 'other-plugin:some-cmd'
		const entries: Array<[string, BakedHotkey]> = [[otherId, baked('Ctrl', 'A')]]
		const row = computeRow(
			def('cursor-home', rec('A', 'Ctrl')),
			makeEffective([]),
			makeReverseMap(entries),
			cmds([otherId]),
		)
		expect(row.action).toBe('override')
		expect(row.status).toBe('🟡Used by: ')
		expect(row.conflictIds).toEqual([otherId])
	})

	it('multiple conflicts get alarm icon', () => {
		const id1 = 'plugin-a:cmd-1'
		const id2 = 'plugin-b:cmd-2'
		const entries: Array<[string, BakedHotkey]> = [
			[id1, baked('Ctrl', 'A')],
			[id2, baked('Ctrl', 'A')],
		]
		const row = computeRow(
			def('cursor-home', rec('A', 'Ctrl')),
			makeEffective([]),
			makeReverseMap(entries),
			cmds([id1, id2]),
		)
		expect(row.status).toBe('🔴Conflict: ')
		expect(row.conflictIds).toHaveLength(2)
	})
})

describe('computeRow — bare key exception (cursor-home / cursor-end)', () => {
	it('bare Home on cursor-home is ignored → action is set', () => {
		const row = computeRow(
			def('cursor-home', rec('A', 'Ctrl')),
			makeEffective([[uchId('cursor-home'), baked('', 'Home')]]),
			new Map(), undefined,
		)
		expect(row.action).toBe('set')
		expect(row.status).toBe('Available')
		expect(row.current).toBe('Home')
	})

	it('bare Home on cursor-home + Ctrl+A → ✅ Set', () => {
		const row = computeRow(
			def('cursor-home', rec('A', 'Ctrl')),
			makeEffective([
				[uchId('cursor-home'), baked('', 'Home')],
				[uchId('cursor-home'), baked('Ctrl', 'A')],
			]),
			new Map(), undefined,
		)
		expect(row.action).toBe('done')
		expect(row.status).toBe('✅ Set')
		expect(row.current).toBe('Ctrl+A')
		expect(row.extraCount).toBe(1)
	})

	it('bare End on cursor-end is ignored → action is set', () => {
		const row = computeRow(
			def('cursor-end', rec('E', 'Ctrl')),
			makeEffective([[uchId('cursor-end'), baked('', 'End')]]),
			new Map(), undefined,
		)
		expect(row.action).toBe('set')
		expect(row.current).toBe('End')
	})

	it('bare Home on cursor-home with conflict → action is override, current shows Home', () => {
		const otherId = 'other-plugin:cmd'
		const entries: Array<[string, BakedHotkey]> = [[otherId, baked('Ctrl', 'A')]]
		const row = computeRow(
			def('cursor-home', rec('A', 'Ctrl')),
			makeEffective([[uchId('cursor-home'), baked('', 'Home')]]),
			makeReverseMap(entries),
			cmds([otherId]),
		)
		expect(row.action).toBe('override')
		expect(row.current).toBe('Home')
	})
})

describe('computeRow — conflict with disabled plugin command', () => {
	it('disabled plugin command is excluded from conflictIds → action is set', () => {
		const disabledId = 'disabled-plugin:some-cmd'
		const entries: Array<[string, BakedHotkey]> = [[disabledId, baked('Ctrl', 'A')]]
		const row = computeRow(
			def('cursor-home', rec('A', 'Ctrl')),
			makeEffective([]),
			makeReverseMap(entries),
			cmds([]),
		)
		expect(row.action).toBe('set')
		expect(row.conflictIds).toEqual([])
	})

	it('active conflict remains when mixed with disabled', () => {
		const activeId   = 'active-plugin:cmd'
		const disabledId = 'disabled-plugin:cmd'
		const entries: Array<[string, BakedHotkey]> = [
			[activeId,   baked('Ctrl', 'A')],
			[disabledId, baked('Ctrl', 'A')],
		]
		const row = computeRow(
			def('cursor-home', rec('A', 'Ctrl')),
			makeEffective([]),
			makeReverseMap(entries),
			cmds([activeId]),
		)
		expect(row.action).toBe('override')
		expect(row.conflictIds).toEqual([activeId])
	})
})
