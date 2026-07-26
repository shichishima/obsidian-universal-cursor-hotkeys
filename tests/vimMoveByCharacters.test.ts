import { describe, it, expect } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'

// moveByCharacters (h/l) is a private field on VimSupport; accessed via `as any`
// like the rest of this test suite accesses private plugin methods.

const makeHost = (): VimSupportHost => ({
	settings: { vimHlSupport: false, smartJoin: false },
	getBeginningOfLinePosition: () => 0,
	saveSettings: async () => {},
	crossTableRowForCell: () => null,
	isLinePartOfTable: () => false,
	enterTableAtLine: () => null,
})

const vim = new VimSupport(makeHost()) as any

const cm = (lineText: string) => ({ getLine: (_n: number) => lineText })

describe('moveByCharacters (h/l)', () => {
	it('l moves forward by repeat', () => {
		const result = vim.moveByCharacters(cm('hello'), { line: 0, ch: 0 }, { forward: true, repeat: 3 })
		expect(result).toEqual({ line: 0, ch: 3 })
	})

	it('h moves backward by repeat', () => {
		const result = vim.moveByCharacters(cm('hello'), { line: 0, ch: 4 }, { forward: false, repeat: 2 })
		expect(result).toEqual({ line: 0, ch: 2 })
	})

	it('l does not wrap past the end of the line', () => {
		const result = vim.moveByCharacters(cm('hi'), { line: 0, ch: 1 }, { forward: true, repeat: 5 })
		expect(result).toEqual({ line: 0, ch: 2 })
	})

	it('h does not wrap past the start of the line', () => {
		const result = vim.moveByCharacters(cm('hi'), { line: 0, ch: 1 }, { forward: false, repeat: 5 })
		expect(result).toEqual({ line: 0, ch: 0 })
	})

	it('never crosses the line boundary even from a non-boundary position', () => {
		// Regression: naive ch+repeat arithmetic could hand vim.js an
		// out-of-range Pos, which it would then "fix" by crossing into the
		// adjacent table cell. Clamping within the line ourselves prevents that.
		const result = vim.moveByCharacters(cm('abc'), { line: 0, ch: 1 }, { forward: true, repeat: 100 })
		expect(result).toEqual({ line: 0, ch: 3 })
	})

	it('steps by grapheme cluster, not UTF-16 code unit (surrogate-pair emoji)', () => {
		// 😀 is a surrogate pair (2 UTF-16 units). Naive ch+1 would land mid-character.
		const line = 'a😀b'
		const result = vim.moveByCharacters(cm(line), { line: 0, ch: 1 }, { forward: true, repeat: 1 })
		expect(result).toEqual({ line: 0, ch: 3 }) // skips both code units of 😀
	})

	it('steps backward by grapheme cluster over a surrogate pair', () => {
		const line = 'a😀b'
		const result = vim.moveByCharacters(cm(line), { line: 0, ch: 3 }, { forward: false, repeat: 1 })
		expect(result).toEqual({ line: 0, ch: 1 })
	})

	it('repeat=1 single-step still respects the line boundary', () => {
		const result = vim.moveByCharacters(cm('a'), { line: 0, ch: 0 }, { forward: true, repeat: 1 })
		expect(result).toEqual({ line: 0, ch: 1 })
		const result2 = vim.moveByCharacters(cm('a'), { line: 0, ch: 1 }, { forward: true, repeat: 1 })
		expect(result2).toEqual({ line: 0, ch: 1 })
	})
})
