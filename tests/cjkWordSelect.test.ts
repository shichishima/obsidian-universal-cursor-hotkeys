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

	it('a no-drag double-click on ASCII text still selects the whole native word, matching CM6\'s own default', () => {
		// The gesture is claimed unconditionally (so a later drag into CJK text
		// on a different line can still segment correctly), but a plain word
		// with no CJK anywhere falls back to the same native word-class run
		// CM6's own groupAt would have picked, not a collapsed point.
		const view = makeView('hello world')
		const style = cjkWordSelectionStyle(() => true)(view, makeEvent(2))
		expect(style).not.toBeNull()
		const sel = style!.get(makeEvent(2), false, false)
		expect(sel.main.from).toBe(0)
		expect(sel.main.to).toBe(5)
	})

	it('regression: double-click on an English-only line then drag into an adjacent Japanese line segments the Japanese side', () => {
		// Live bug report: starting the gesture on non-CJK text used to hand
		// the *entire* drag to CM6's native handler, so a later crossing into
		// CJK text on a different line never got segmented.
		const lines: Record<number, { from: number; to: number; text: string }> = {
			0: { from: 0, to: 11, text: 'hello world' }, // English-only line
			1: { from: 12, to: 12 + JP_LINE.length, text: JP_LINE }, // 私は日本語を勉強しています
		}
		const view = {
			state: {
				doc: { lineAt: (pos: number) => (pos <= 11 ? lines[0] : lines[1]) },
				selection: EditorSelection.single(0),
			},
			posAtCoords: ({ x }: { x: number }) => x,
		} as any
		const style = cjkWordSelectionStyle(() => true)(view, makeEvent(2))! // anchor: "hello" [0,5)
		const sel = style.get(makeEvent(12 + 3), false, false) // drag into 日本語 [12+2, 12+5)
		expect(sel.main.anchor).toBe(0)
		expect(sel.main.head).toBe(12 + 5)
	})

	it('regression: double-click on a Japanese line then drag into an adjacent English-only line still segments the Japanese anchor', () => {
		const lines: Record<number, { from: number; to: number; text: string }> = {
			0: { from: 0, to: JP_LINE.length, text: JP_LINE },
			1: { from: JP_LINE.length + 1, to: JP_LINE.length + 1 + 11, text: 'hello world' },
		}
		const view = {
			state: {
				doc: { lineAt: (pos: number) => (pos <= JP_LINE.length ? lines[0] : lines[1]) },
				selection: EditorSelection.single(0),
			},
			posAtCoords: ({ x }: { x: number }) => x,
		} as any
		const style = cjkWordSelectionStyle(() => true)(view, makeEvent(3))! // anchor: 日本語 [2,5)
		const sel = style.get(makeEvent(JP_LINE.length + 1 + 2), false, false) // drag into "hello" [+0,+5)
		expect(sel.main.anchor).toBe(2)
		expect(sel.main.head).toBe(JP_LINE.length + 1 + 5)
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

	it('dragging from a CJK word into plain ASCII text extends to the whole native word, not just the click position', () => {
		// Previously the drag position's own span fell back to a bare point
		// (not a real word span) whenever it landed on non-CJK text, so this
		// used to stop mid-word ("hell", head=6) instead of at the actual word
		// boundary — the same underlying gap as the cross-line bug, just
		// within a single line. dragSpanAt's native-word-run fallback fixes
		// this uniformly, so the drag now correctly reaches the end of "hello".
		const mixed = '日本語 hello' // 日本語[0,3) space[3] hello[4,9)
		const view = makeView(mixed)
		const style = cjkWordSelectionStyle(() => true)(view, makeEvent(1))! // inside 日本語
		const sel = style.get(makeEvent(6), false, false) // drag into "hello" (not CJK)
		expect(sel.main.anchor).toBe(0)
		expect(sel.main.head).toBe(9)
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
