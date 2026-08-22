import { describe, it, expect } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { isCjkChar, getCjkWordSpan, cjkWordSelectionStyle } from '../cjk-word-select.ts'

// cjk-word-select.ts's own pure logic (isCjkChar, getCjkWordSpan) plus the
// EditorView.mouseSelectionStyle factory (cjkWordSelectionStyle) — no real
// CM6 EditorView involved, matching table-navigation.ts's own test style. The
// fake view's posAtCoords treats clientX as the document offset directly, so
// test events can just say "click at offset N".

describe('isCjkChar', () => {
	it('is true for hiragana, katakana, and kanji', () => {
		expect(isCjkChar('あ')).toBe(true)
		expect(isCjkChar('ア')).toBe(true)
		expect(isCjkChar('私')).toBe(true)
	})

	it('is false for ASCII letters, punctuation, and Hangul', () => {
		expect(isCjkChar('a')).toBe(false)
		expect(isCjkChar('.')).toBe(false)
		expect(isCjkChar('한')).toBe(false)
	})
})

describe('getCjkWordSpan', () => {
	it('returns null when ch is not adjacent to a CJK character', () => {
		expect(getCjkWordSpan('hello world', 2)).toBeNull()
	})

	it('returns the segmenter span containing ch when it is inside a CJK run', () => {
		// "私は日本語を勉強しています" -> 私|は|日本語|を|勉強|し|てい|ます
		expect(getCjkWordSpan('私は日本語を勉強しています', 3)).toEqual({ from: 2, to: 5 }) // 日本語
	})

	it('checks the character before ch too, for a click landing right at a span boundary', () => {
		// ch=2 sits between "は" (to 2) and "日本語" (from 2) — forward bias picks "日本語".
		expect(getCjkWordSpan('私は日本語を勉強しています', 2)).toEqual({ from: 2, to: 5 })
	})

	it('returns null on a pure-whitespace/empty line', () => {
		expect(getCjkWordSpan('', 0)).toBeNull()
	})

	it('regression: double-clicking an ASCII term embedded in Japanese prose selects just that term, not the whole mixed run', () => {
		// Live bug report (2026-08-22): CM6's default charCategorizer treats
		// Latin letters and CJK characters as the same "Word" class, so
		// clicking inside "Emacs" itself (no CJK character immediately
		// adjacent to the click) used to fall through to native behavior,
		// which glues the whole mixed run together.
		const line = '扱いがEmacsとは異なる'
		const emacsStart = line.indexOf('Emacs')
		expect(getCjkWordSpan(line, emacsStart + 2)).toEqual({ from: emacsStart, to: emacsStart + 5 })
	})
})

describe('cjkWordSelectionStyle', () => {
	// "私は日本語を勉強しています" spans: 私[0,1) は[1,2) 日本語[2,5) を[5,6) 勉強[6,8) し[8,9) てい[9,11) ます[11,13)
	const JP_LINE = '私は日本語を勉強しています'

	const makeEvent = (pos: number, overrides: Partial<MouseEvent> = {}) =>
		({ button: 0, detail: 2, clientX: pos, clientY: 0, ...overrides }) as MouseEvent

	const makeView = (text: string, selection = EditorSelection.single(0)) => ({
		state: {
			doc: { lineAt: (_pos: number) => ({ from: 0, to: text.length, text }) },
			selection,
		},
		posAtCoords: ({ x }: { x: number }) => (x < 0 || x > text.length ? null : x),
	}) as any

	it('returns null when disabled', () => {
		const style = cjkWordSelectionStyle(() => false)(makeView(JP_LINE), makeEvent(3))
		expect(style).toBeNull()
	})

	it('returns null for a single click (not a double-click)', () => {
		const style = cjkWordSelectionStyle(() => true)(makeView(JP_LINE), makeEvent(3, { detail: 1 }))
		expect(style).toBeNull()
	})

	it('returns null for a non-primary-button click', () => {
		const style = cjkWordSelectionStyle(() => true)(makeView(JP_LINE), makeEvent(3, { button: 2 }))
		expect(style).toBeNull()
	})

	it('returns null when posAtCoords can\'t resolve a position', () => {
		const style = cjkWordSelectionStyle(() => true)(makeView(JP_LINE), makeEvent(-1))
		expect(style).toBeNull()
	})

	it('returns null on ASCII text — defers to CM6\'s own native double-click', () => {
		const style = cjkWordSelectionStyle(() => true)(makeView('hello world'), makeEvent(2))
		expect(style).toBeNull()
	})

	it('double-click on a CJK word selects just that segmenter word, not the whole run', () => {
		const view = makeView(JP_LINE)
		const style = cjkWordSelectionStyle(() => true)(view, makeEvent(3)) // inside 日本語 [2,5)
		expect(style).not.toBeNull()
		const sel = style!.get(makeEvent(3), false, false)
		expect(sel.main.from).toBe(2)
		expect(sel.main.to).toBe(5)
	})

	it('dragging rightward after the double-click extends selection a whole word at a time', () => {
		const view = makeView(JP_LINE)
		const style = cjkWordSelectionStyle(() => true)(view, makeEvent(3))! // start: 日本語 [2,5)
		const sel = style.get(makeEvent(7), false, false) // drag into 勉強 [6,8)
		expect(sel.main.anchor).toBe(2)
		expect(sel.main.head).toBe(8)
	})

	it('dragging leftward reverses anchor/head so the selection still spans both words', () => {
		const view = makeView(JP_LINE)
		const style = cjkWordSelectionStyle(() => true)(view, makeEvent(7))! // start: 勉強 [6,8)
		const sel = style.get(makeEvent(3), false, false) // drag back into 日本語 [2,5)
		expect(sel.main.anchor).toBe(8)
		expect(sel.main.head).toBe(2)
	})

	it('dragging from a CJK word into plain ASCII text still produces a sensible merged range', () => {
		const mixed = '日本語 hello' // 日本語[0,3) space[3] hello[4,9)
		const view = makeView(mixed)
		const style = cjkWordSelectionStyle(() => true)(view, makeEvent(1))! // inside 日本語
		const sel = style.get(makeEvent(6), false, false) // drag into "hello" (not CJK)
		expect(sel.main.anchor).toBe(0)
		expect(sel.main.head).toBe(6)
	})

	it('extend=true extends the existing selection\'s main range instead of replacing it wholesale', () => {
		const view = makeView(JP_LINE, EditorSelection.single(0, 1)) // pre-existing selection [0,1)
		const style = cjkWordSelectionStyle(() => true)(view, makeEvent(3))! // 日本語 [2,5)
		const sel = style.get(makeEvent(3), true, false)
		expect(sel.main.anchor).toBe(0)
		expect(sel.main.head).toBe(5)
	})

	it('multiple=true adds the word range as a new selection range', () => {
		const view = makeView(JP_LINE, EditorSelection.create([EditorSelection.range(0, 1)]))
		const style = cjkWordSelectionStyle(() => true)(view, makeEvent(3))!
		const sel = style.get(makeEvent(3), false, true)
		expect(sel.ranges.length).toBe(2)
	})

	it('update() remaps the captured start span across a doc change, changing the merge result', () => {
		const view = makeView(JP_LINE)
		const style = cjkWordSelectionStyle(() => true)(view, makeEvent(3))! // start span 日本語 [2,5)
		// Simulate an edit that shifts everything from the mousedown point onward by +2.
		style.update({ docChanged: true, changes: { mapPos: (p: number) => p + 2 } } as any)
		// Drag onto 勉強 [6,8) (the fake doc's text itself is unchanged, only the
		// remembered start position/span are remapped) — merge uses the
		// REMAPPED start span [4,7), not the original [2,5).
		const sel = style.get(makeEvent(7), false, false)
		expect(sel.main.anchor).toBe(4)
		expect(sel.main.head).toBe(8)
	})

	it('update() is a no-op when the doc hasn\'t changed', () => {
		const view = makeView(JP_LINE)
		const style = cjkWordSelectionStyle(() => true)(view, makeEvent(3))!
		style.update({ docChanged: false } as any)
		const sel = style.get(makeEvent(3), false, false)
		expect(sel.main.from).toBe(2)
		expect(sel.main.to).toBe(5)
	})
})
