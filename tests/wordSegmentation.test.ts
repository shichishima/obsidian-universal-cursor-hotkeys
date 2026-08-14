import { describe, it, expect } from 'vitest'
import { getWordSpans, findWordSpanOnLine } from '../word-segmentation.ts'

describe('getWordSpans', () => {
	it('splits plain ASCII words, skipping whitespace', () => {
		expect(getWordSpans('hello world')).toEqual([{ from: 0, to: 5 }, { from: 6, to: 11 }])
	})

	it('merges a run of consecutive punctuation into one span', () => {
		expect(getWordSpans('foo...bar')).toEqual([
			{ from: 0, to: 3 }, { from: 3, to: 6 }, { from: 6, to: 9 },
		])
	})

	it('keeps underscores inside a single word span', () => {
		expect(getWordSpans('snake_case_var')).toEqual([{ from: 0, to: 14 }])
	})

	it('splits on a hyphen, matching vim\'s own punctuation class', () => {
		expect(getWordSpans('foo-bar')).toEqual([
			{ from: 0, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 7 },
		])
	})

	it('skips leading, trailing, and repeated whitespace', () => {
		expect(getWordSpans('  hi  there  ')).toEqual([{ from: 2, to: 4 }, { from: 6, to: 11 }])
	})

	it('returns an empty array for an empty line', () => {
		expect(getWordSpans('')).toEqual([])
	})

	it('returns an empty array for a whitespace-only line', () => {
		expect(getWordSpans('   ')).toEqual([])
	})

	it('segments Japanese text morphologically, not as one run', () => {
		expect(getWordSpans('私は日本語を勉強しています')).toEqual([
			{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 5 }, { from: 5, to: 6 },
			{ from: 6, to: 8 }, { from: 8, to: 9 }, { from: 9, to: 11 }, { from: 11, to: 13 },
		])
	})
})

describe('findWordSpanOnLine', () => {
	// spans on "foo bar baz": foo=[0,3) bar=[4,7) baz=[8,11)
	const line = 'foo bar baz'

	it('forward: returns the containing span when fromCh is inside a word', () => {
		expect(findWordSpanOnLine(line, 0, true)).toEqual({ from: 0, to: 3 })
		expect(findWordSpanOnLine(line, 5, true)).toEqual({ from: 4, to: 7 })
	})

	it('forward: returns the next span when fromCh is exactly at a word\'s end', () => {
		expect(findWordSpanOnLine(line, 3, true)).toEqual({ from: 4, to: 7 })
	})

	it('forward: returns null once there is no further span on the line', () => {
		expect(findWordSpanOnLine(line, 11, true)).toBeNull()
	})

	it('backward: returns the containing span when fromCh is inside a word', () => {
		expect(findWordSpanOnLine(line, 5, false)).toEqual({ from: 4, to: 7 })
	})

	it('backward: returns the previous span when fromCh is exactly at a word\'s start', () => {
		expect(findWordSpanOnLine(line, 4, false)).toEqual({ from: 0, to: 3 })
	})

	it('backward: returns null once there is no earlier span on the line', () => {
		expect(findWordSpanOnLine(line, 0, false)).toBeNull()
	})
})
