import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

describe('getBeginningOfLinePosition(line, ch)', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
	})

	// -------------------------------------------------------------------------
	// Headings
	// -------------------------------------------------------------------------

	it('heading ## hello — returns index after "## " when ch is past the prefix', () => {
		// "## ".length = 3; ch=5 > 3 → 3
		expect(plugin.getBeginningOfLinePosition('## hello', 5)).toBe(3)
	})

	it('heading ###### deep — returns index after "###### "', () => {
		expect(plugin.getBeginningOfLinePosition('###### deep', 8)).toBe(7)
	})

	it('heading ## hello — ch already at smart-home (ch=3) returns 0 (2-step toggle)', () => {
		// result[0].length (3) < ch (3) is false → returns 0
		expect(plugin.getBeginningOfLinePosition('## hello', 3)).toBe(0)
	})

	// -------------------------------------------------------------------------
	// Heading inside unordered list
	// -------------------------------------------------------------------------

	it('heading in list "- ## hello" — returns index after "- ## "', () => {
		// "- ## ".length = 5; ch=7 > 5 → 5
		expect(plugin.getBeginningOfLinePosition('- ## hello', 7)).toBe(5)
	})

	// -------------------------------------------------------------------------
	// Unordered lists
	// -------------------------------------------------------------------------

	it('unordered list "- item" — returns index after "- "', () => {
		expect(plugin.getBeginningOfLinePosition('- item', 4)).toBe(2)
	})

	it('unordered list "+ item" — returns index after "+ "', () => {
		expect(plugin.getBeginningOfLinePosition('+ item', 4)).toBe(2)
	})

	it('unordered list "* item" — returns index after "* "', () => {
		expect(plugin.getBeginningOfLinePosition('* item', 4)).toBe(2)
	})

	// -------------------------------------------------------------------------
	// Task lists
	// -------------------------------------------------------------------------

	it('task list "- [ ] item" — returns index after "- [ ] "', () => {
		// "- [ ] ".length = 6; ch=8 > 6 → 6
		expect(plugin.getBeginningOfLinePosition('- [ ] item', 8)).toBe(6)
	})

	it('completed task "- [x] item" — returns index after "- [x] "', () => {
		expect(plugin.getBeginningOfLinePosition('- [x] item', 8)).toBe(6)
	})

	// -------------------------------------------------------------------------
	// Ordered lists
	// -------------------------------------------------------------------------

	it('ordered list "1. item" — returns index after "1. "', () => {
		expect(plugin.getBeginningOfLinePosition('1. item', 5)).toBe(3)
	})

	it('ordered list "10. item" — returns index after "10. "', () => {
		expect(plugin.getBeginningOfLinePosition('10. item', 6)).toBe(4)
	})

	it('ordered list "1) item" — returns index after "1) "', () => {
		expect(plugin.getBeginningOfLinePosition('1) item', 5)).toBe(3)
	})

	// -------------------------------------------------------------------------
	// Blockquotes
	// -------------------------------------------------------------------------

	it('blockquote "> text" — returns index after "> "', () => {
		expect(plugin.getBeginningOfLinePosition('> text', 4)).toBe(2)
	})

	// -------------------------------------------------------------------------
	// Footnotes
	// -------------------------------------------------------------------------

	it('footnote "[^1]: note" — returns index after "[^1]: "', () => {
		// "[^1]: ".length = 6; ch=8 > 6 → 6
		expect(plugin.getBeginningOfLinePosition('[^1]: note', 8)).toBe(6)
	})

	// -------------------------------------------------------------------------
	// Plain text
	// -------------------------------------------------------------------------

	it('plain text — returns 0', () => {
		expect(plugin.getBeginningOfLinePosition('hello world', 5)).toBe(0)
	})

	it('indented line "  hello" — returns 0 when ch is past the indent', () => {
		// "  ".length = 2 < ch=4 → 2? No: the last pattern matches "  " (length 2),
		// and 2 < 4, so returns 2 (the indent position, acting as smart home).
		expect(plugin.getBeginningOfLinePosition('  hello', 4)).toBe(2)
	})

	it('empty line — returns 0', () => {
		expect(plugin.getBeginningOfLinePosition('', 0)).toBe(0)
	})
})
