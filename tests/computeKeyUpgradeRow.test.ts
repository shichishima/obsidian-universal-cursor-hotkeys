import { describe, it, expect } from 'vitest'
import { computeKeyUpgradeRow, hotkeyId } from '../settings'
import type { KeyUpgradeDef, BakedHotkey } from '../settings'

const PLUGIN_PREFIX = 'universal-cursor-hotkeys'
const uchId = (id: string) => `${PLUGIN_PREFIX}:${id}`

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

describe('computeKeyUpgradeRow', () => {
	it('bare entry (mac == win) resolves to the same hotkey regardless of macStyle', () => {
		const def: KeyUpgradeDef = {
			group: 'navBasics', label: 'Table-aware', commandId: 'cursor-end',
			mac: { modifiers: [], key: 'End' }, win: { modifiers: [], key: 'End' },
		}
		const rowMac = computeKeyUpgradeRow(def, makeEffective([]), makeReverseMap([]), cmds([]), true)
		const rowWin = computeKeyUpgradeRow(def, makeEffective([]), makeReverseMap([]), cmds([]), false)
		expect(rowMac.targetHotkey).toEqual({ modifiers: [], key: 'End' })
		expect(rowWin.targetHotkey).toEqual({ modifiers: [], key: 'End' })
	})

	it('modifier-only difference (Word left): Alt on mac, Ctrl on win, same key', () => {
		const def: KeyUpgradeDef = {
			group: 'wordCommands', label: 'Word left', commandId: 'word-left',
			mac: { modifiers: ['Alt'], key: 'ArrowLeft' }, win: { modifiers: ['Ctrl'], key: 'ArrowLeft' },
		}
		const rowMac = computeKeyUpgradeRow(def, makeEffective([]), makeReverseMap([]), cmds([]), true)
		const rowWin = computeKeyUpgradeRow(def, makeEffective([]), makeReverseMap([]), cmds([]), false)
		expect(rowMac.targetHotkey).toEqual({ modifiers: ['Alt'], key: 'ArrowLeft' })
		expect(rowWin.targetHotkey).toEqual({ modifiers: ['Ctrl'], key: 'ArrowLeft' })
	})

	it('key itself differs (Document start): Cmd+ArrowUp on mac, but Ctrl+Home (not Ctrl+ArrowUp) on win', () => {
		const def: KeyUpgradeDef = {
			group: 'navBasics', label: 'Document start', commandId: 'cursor-top',
			mac: { modifiers: ['Meta'], key: 'ArrowUp' }, win: { modifiers: ['Ctrl'], key: 'Home' },
		}
		const rowMac = computeKeyUpgradeRow(def, makeEffective([]), makeReverseMap([]), cmds([]), true)
		const rowWin = computeKeyUpgradeRow(def, makeEffective([]), makeReverseMap([]), cmds([]), false)
		expect(rowMac.targetHotkey).toEqual({ modifiers: ['Meta'], key: 'ArrowUp' })
		expect(rowWin.targetHotkey).toEqual({ modifiers: ['Ctrl'], key: 'Home' })
	})

	it('assigned/conflict detection uses whichever platform hotkey is active', () => {
		const def: KeyUpgradeDef = {
			group: 'navBasics', label: 'Document end', commandId: 'cursor-bottom',
			mac: { modifiers: ['Meta'], key: 'ArrowDown' }, win: { modifiers: ['Ctrl'], key: 'End' },
		}
		const effective = makeEffective([[uchId('cursor-bottom'), baked('Ctrl', 'End')]])
		const reverseMap = makeReverseMap([
			[uchId('cursor-bottom'), baked('Ctrl', 'End')],
			['other-plugin:some-command', baked('Ctrl', 'End')],
		])
		// On win, the assigned Ctrl+End hotkey matches and conflicts with the other command.
		const rowWin = computeKeyUpgradeRow(def, effective, reverseMap, cmds(['other-plugin:some-command']), false)
		expect(rowWin.assigned).toBe(true)
		expect(rowWin.conflictIds).toEqual(['other-plugin:some-command'])
		// On mac, the target hotkey (Cmd+ArrowDown) isn't what's assigned (Ctrl+End) and has no conflict.
		const rowMac = computeKeyUpgradeRow(def, effective, reverseMap, cmds(['other-plugin:some-command']), true)
		expect(rowMac.assigned).toBe(false)
		expect(rowMac.conflictIds).toEqual([])
	})
})
