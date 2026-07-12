import { describe, it, expect } from 'vitest'
import { selectCurrentChips, hotkeyId } from '../settings'
import type { BakedHotkey } from '../settings'
import type { Modifier } from 'obsidian'

// ── helpers ──────────────────────────────────────────────────────────────────

const baked = (modifiers: string, key: string): BakedHotkey => ({ modifiers, key })
const rec   = (...args: [string, ...Modifier[]]): { modifiers: Modifier[]; key: string } =>
	({ modifiers: args.slice(1) as Modifier[], key: args[0] })

const ids = (hks: BakedHotkey[]) => hks.map(hotkeyId)

// ── cursor-home (rec=Ctrl+A, exKey=Home) ────────────────────────────────────

describe('selectCurrentChips — cursor-home (rec defined, exKey=Home)', () => {
	const recommended = rec('A', 'Ctrl')
	const exKey = 'Home'

	it('empty allHks → no chips, no remaining', () => {
		const { chips, remaining } = selectCurrentChips([], recommended, exKey)
		expect(chips).toHaveLength(0)
		expect(remaining).toHaveLength(0)
	})

	it('[Ctrl+A] → chips=[Ctrl+A], remaining=[]', () => {
		const { chips, remaining } = selectCurrentChips([baked('Ctrl', 'A')], recommended, exKey)
		expect(ids(chips)).toEqual([hotkeyId(baked('Ctrl', 'A'))])
		expect(remaining).toHaveLength(0)
	})

	it('[Home] → chips=[Home], remaining=[]  (bare only, modified first order but modified absent)', () => {
		const { chips, remaining } = selectCurrentChips([baked('', 'Home')], recommended, exKey)
		expect(ids(chips)).toEqual([hotkeyId(baked('', 'Home'))])
		expect(remaining).toHaveLength(0)
	})

	it('[Ctrl+A, Home] → chips=[Ctrl+A, Home] (modified first)', () => {
		const allHks = [baked('Ctrl', 'A'), baked('', 'Home')]
		const { chips, remaining } = selectCurrentChips(allHks, recommended, exKey)
		expect(ids(chips)).toEqual([hotkeyId(baked('Ctrl', 'A')), hotkeyId(baked('', 'Home'))])
		expect(remaining).toHaveLength(0)
	})

	it('[Home, Ctrl+X] → chips=[Ctrl+X, Home] (modified first; Ctrl+X is modifiedCand)', () => {
		const allHks = [baked('', 'Home'), baked('Ctrl', 'X')]
		const { chips, remaining } = selectCurrentChips(allHks, recommended, exKey)
		expect(ids(chips)).toEqual([hotkeyId(baked('Ctrl', 'X')), hotkeyId(baked('', 'Home'))])
		expect(remaining).toHaveLength(0)
	})

	it('[Ctrl+A, Home, Ctrl+X] → chips=[Ctrl+A, Home], remaining=[Ctrl+X]', () => {
		const allHks = [baked('Ctrl', 'A'), baked('', 'Home'), baked('Ctrl', 'X')]
		const { chips, remaining } = selectCurrentChips(allHks, recommended, exKey)
		expect(ids(chips)).toEqual([hotkeyId(baked('Ctrl', 'A')), hotkeyId(baked('', 'Home'))])
		expect(ids(remaining)).toEqual([hotkeyId(baked('Ctrl', 'X'))])
	})

	it('[Ctrl+X] (custom, no rec in allHks) → chips=[Ctrl+X], remaining=[]', () => {
		const { chips, remaining } = selectCurrentChips([baked('Ctrl', 'X')], recommended, exKey)
		expect(ids(chips)).toEqual([hotkeyId(baked('Ctrl', 'X'))])
		expect(remaining).toHaveLength(0)
	})

	it('[Ctrl+X, Ctrl+Y] → chips=[Ctrl+X], remaining=[Ctrl+Y]', () => {
		const allHks = [baked('Ctrl', 'X'), baked('Ctrl', 'Y')]
		const { chips, remaining } = selectCurrentChips(allHks, recommended, exKey)
		expect(chips).toHaveLength(1)
		expect(ids(remaining)).toEqual([hotkeyId(baked('Ctrl', 'Y'))])
	})
})

// ── page-down (rec=null, exKey=PageDown) ────────────────────────────────────

describe('selectCurrentChips — page-down (rec=null, exKey=PageDown)', () => {
	const exKey = 'PageDown'

	it('empty allHks → no chips', () => {
		const { chips, remaining } = selectCurrentChips([], null, exKey)
		expect(chips).toHaveLength(0)
		expect(remaining).toHaveLength(0)
	})

	it('[PageDown] → chips=[PageDown], remaining=[]  (bare first)', () => {
		const { chips, remaining } = selectCurrentChips([baked('', 'PageDown')], null, exKey)
		expect(ids(chips)).toEqual([hotkeyId(baked('', 'PageDown'))])
		expect(remaining).toHaveLength(0)
	})

	it('[Ctrl+C] → chips=[Ctrl+C], remaining=[]  (bare absent → just modified)', () => {
		const { chips, remaining } = selectCurrentChips([baked('Ctrl', 'C')], null, exKey)
		expect(ids(chips)).toEqual([hotkeyId(baked('Ctrl', 'C'))])
		expect(remaining).toHaveLength(0)
	})

	it('[PageDown, Ctrl+C] → chips=[PageDown, Ctrl+C] (bare first)', () => {
		const allHks = [baked('', 'PageDown'), baked('Ctrl', 'C')]
		const { chips, remaining } = selectCurrentChips(allHks, null, exKey)
		expect(ids(chips)).toEqual([hotkeyId(baked('', 'PageDown')), hotkeyId(baked('Ctrl', 'C'))])
		expect(remaining).toHaveLength(0)
	})

	it('[PageDown, Ctrl+C, Ctrl+D] → chips=[PageDown, Ctrl+C], remaining=[Ctrl+D]', () => {
		const allHks = [baked('', 'PageDown'), baked('Ctrl', 'C'), baked('Ctrl', 'D')]
		const { chips, remaining } = selectCurrentChips(allHks, null, exKey)
		expect(ids(chips)).toEqual([hotkeyId(baked('', 'PageDown')), hotkeyId(baked('Ctrl', 'C'))])
		expect(ids(remaining)).toEqual([hotkeyId(baked('Ctrl', 'D'))])
	})
})

// ── cursor-end (rec=Ctrl+E, exKey=End) ──────────────────────────────────────

describe('selectCurrentChips — cursor-end (rec defined, exKey=End)', () => {
	const recommended = rec('E', 'Ctrl')
	const exKey = 'End'

	it('[Ctrl+E, End] → chips=[Ctrl+E, End] (modified first)', () => {
		const allHks = [baked('Ctrl', 'E'), baked('', 'End')]
		const { chips, remaining } = selectCurrentChips(allHks, recommended, exKey)
		expect(ids(chips)).toEqual([hotkeyId(baked('Ctrl', 'E')), hotkeyId(baked('', 'End'))])
		expect(remaining).toHaveLength(0)
	})

	it('[End] → chips=[End]', () => {
		const { chips } = selectCurrentChips([baked('', 'End')], recommended, exKey)
		expect(ids(chips)).toEqual([hotkeyId(baked('', 'End'))])
	})
})

// ── page-up (rec=null, exKey=PageUp) ────────────────────────────────────────

describe('selectCurrentChips — page-up (rec=null, exKey=PageUp)', () => {
	const exKey = 'PageUp'

	it('[PageUp, Ctrl+B] → chips=[PageUp, Ctrl+B] (bare first)', () => {
		const allHks = [baked('', 'PageUp'), baked('Ctrl', 'B')]
		const { chips, remaining } = selectCurrentChips(allHks, null, exKey)
		expect(ids(chips)).toEqual([hotkeyId(baked('', 'PageUp')), hotkeyId(baked('Ctrl', 'B'))])
		expect(remaining).toHaveLength(0)
	})

	it('[PageUp, Ctrl+B, Ctrl+C] → chips=[PageUp, Ctrl+B], remaining=[Ctrl+C]', () => {
		const allHks = [baked('', 'PageUp'), baked('Ctrl', 'B'), baked('Ctrl', 'C')]
		const { chips, remaining } = selectCurrentChips(allHks, null, exKey)
		expect(chips).toHaveLength(2)
		expect(ids(remaining)).toEqual([hotkeyId(baked('Ctrl', 'C'))])
	})
})

// ── no exKey (most cursor commands) ─────────────────────────────────────────

describe('selectCurrentChips — no exKey (e.g. cursor-up, rec=Ctrl+P)', () => {
	const recommended = rec('P', 'Ctrl')

	it('[Ctrl+P] → chips=[Ctrl+P]', () => {
		const { chips } = selectCurrentChips([baked('Ctrl', 'P')], recommended, undefined)
		expect(ids(chips)).toEqual([hotkeyId(baked('Ctrl', 'P'))])
	})

	it('[Ctrl+P, Ctrl+X] → chips=[Ctrl+P], remaining=[Ctrl+X]', () => {
		const allHks = [baked('Ctrl', 'P'), baked('Ctrl', 'X')]
		const { chips, remaining } = selectCurrentChips(allHks, recommended, undefined)
		expect(ids(chips)).toEqual([hotkeyId(baked('Ctrl', 'P'))])
		expect(ids(remaining)).toEqual([hotkeyId(baked('Ctrl', 'X'))])
	})

	it('bare key without exKey falls back to bareCand → chips=[bare, modified] (rec defined → modified first)', () => {
		// edge case: a bare key assigned to a command with no exKey defined
		const allHks = [baked('', 'A'), baked('Ctrl', 'P')]
		const { chips } = selectCurrentChips(allHks, recommended, undefined)
		// rec defined → modified first; modifiedCand=Ctrl+P (rec), bareCand=bare-A
		expect(ids(chips)).toEqual([hotkeyId(baked('Ctrl', 'P')), hotkeyId(baked('', 'A'))])
	})

	it('bare key only, no exKey, no rec in allHks → chips=[bare] (modified first but none)', () => {
		const allHks = [baked('', 'A')]
		const { chips } = selectCurrentChips(allHks, recommended, undefined)
		expect(ids(chips)).toEqual([hotkeyId(baked('', 'A'))])
	})
})
