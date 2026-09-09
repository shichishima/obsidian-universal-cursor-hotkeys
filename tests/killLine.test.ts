import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'
import { getInCellLineInfo } from '../table-cell-utils.ts'

// ---------------------------------------------------------------------------
// Minimal editor mock helpers
// ---------------------------------------------------------------------------

function makeEditor(lines: string[], cursorLine: number, cursorCh: number) {
	const buf = [...lines]

	return {
		getCursor: vi.fn((_sel?: string) => ({ line: cursorLine, ch: cursorCh })),
		// getLine reads from the (possibly mutated) buf
		getLine:  vi.fn((line: number) => buf[line] ?? ''),
		lineCount: vi.fn(() => buf.length),
		replaceRange: vi.fn((replacement: string, from: any, to: any) => {
			if (from.line === to.line) {
				buf[from.line] = buf[from.line].slice(0, from.ch) + replacement + buf[from.line].slice(to.ch)
			} else {
				// Cross-line: merge from.line..to.line into one line
				const merged = buf[from.line].slice(0, from.ch) + replacement + buf[to.line].slice(to.ch)
				buf.splice(from.line, to.line - from.line + 1, merged)
			}
		}),
		setLine: vi.fn((line: number, text: string) => {
			buf[line] = text
		}),
		replaceSelection: vi.fn(),
		_buf: buf,
	}
}


describe('killLine', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, smartJoin: false, visualLineMovement: true, crossRowNavigation: true }
		plugin.isKillChaining = false
		plugin.isDispatchingKill = false
		plugin.killCache = ''

		plugin.isLivePreviewMode = vi.fn().mockReturnValue(false)
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)
		plugin.setCursorViaCm    = vi.fn()

		vi.stubGlobal('navigator', {
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
		})
		vi.stubGlobal('window', globalThis)
		vi.stubGlobal('activeWindow', globalThis)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	// ===========================================================================
	// killLineNonTable — cursor not at line end
	// ===========================================================================

	describe('killLineNonTable — cursor before line end', () => {
		// [lineText, cursorCh, expectedLineAfter, expectedKillCache]
		const cases: [string, number, string, string][] = [
			['hello world', 6,  'hello ',  'world'],
			['hello world', 0,  '',        'hello world'],
			['hello',       2,  'he',      'llo'],
		]

		for (const [lineText, ch, expectedLine, expectedCache] of cases) {
			it(`"${lineText}" ch=${ch} → kills "${expectedCache}"`, () => {
				const editor = makeEditor([lineText], 0, ch)
				plugin.killLineNonTable(editor)
				expect(editor._buf[0]).toBe(expectedLine)
				expect(plugin.killCache).toBe(expectedCache)
				expect(plugin.isKillChaining).toBe(true)
			})
		}
	})

	// ===========================================================================
	// killLineNonTable — cursor at line end (join next line)
	// ===========================================================================

	describe('killLineNonTable — cursor at line end', () => {
		describe('smartJoin: OFF (default) — preserves leading syntax', () => {
			it('joins next line without trimming', () => {
				const editor = makeEditor(['hello', '  world'], 0, 5)
				plugin.killLineNonTable(editor)
				expect(editor._buf[0]).toBe('hello  world')
				expect(plugin.killCache).toBe('\n')
				expect(plugin.isKillChaining).toBe(true)
			})

			it('joins next line with no leading whitespace', () => {
				const editor = makeEditor(['hello', 'world'], 0, 5)
				plugin.killLineNonTable(editor)
				expect(editor._buf[0]).toBe('helloworld')
				expect(plugin.killCache).toBe('\n')
			})
		})

		describe('smartJoin: ON — trims to smart home position', () => {
			beforeEach(() => {
				plugin.settings = { ...plugin.settings, smartJoin: true }
			})

			it('joins next line, stripping leading whitespace to content start', () => {
				const editor = makeEditor(['hello', '  world'], 0, 5)
				plugin.killLineNonTable(editor)
				expect(editor._buf[0]).toBe('helloworld')
				expect(plugin.killCache).toBe('\n')
				expect(plugin.isKillChaining).toBe(true)
			})

			it('joins next line with list marker stripped', () => {
				const editor = makeEditor(['hello', '- item'], 0, 5)
				plugin.killLineNonTable(editor)
				expect(editor._buf[0]).toBe('helloitem')
				expect(plugin.killCache).toBe('\n')
			})

			it('joins next line with no leading syntax — unchanged', () => {
				const editor = makeEditor(['hello', 'world'], 0, 5)
				plugin.killLineNonTable(editor)
				expect(editor._buf[0]).toBe('helloworld')
				expect(plugin.killCache).toBe('\n')
			})
		})

		it('does nothing at last line', () => {
			const editor = makeEditor(['only line'], 0, 9)
			plugin.killLineNonTable(editor)
			expect(editor._buf[0]).toBe('only line')
			expect(plugin.killCache).toBe('')
			expect(plugin.isKillChaining).toBe(false)
		})
	})

	// ===========================================================================
	// killLineNonTable — consecutive kills accumulate in killCache
	// ===========================================================================

	it('consecutive kills accumulate killCache', () => {
		// First kill: kills 'world' from 'hello world', cache = 'world', chaining = true
		const editor = makeEditor(['hello world'], 0, 6)
		plugin.killLineNonTable(editor)
		expect(plugin.killCache).toBe('world')
		expect(plugin.isKillChaining).toBe(true)

		// Second kill with chaining=true: cursor is now at ch=6 of the shortened line 'hello '
		// 'hello '[6] is at end → joins next line, but there is none → no-op
		// Use a fresh editor at new position to simulate second kill
		const editor2 = makeEditor(['first ', 'second'], 0, 6)
		editor2.getCursor.mockReturnValue({ line: 0, ch: 6 })
		// plugin.isKillChaining is still true from first kill
		plugin.killLineNonTable(editor2)
		// Should append to cache
		expect(plugin.killCache).toBe('world\n')
	})

	// ===========================================================================
	// killLineInTableSourceMode — cursor before in-cell line end
	// ===========================================================================

	describe('killLineInTableSourceMode — cursor before in-cell line end', () => {
		// Line: '| hello |'  pipes at 0, 8  cellStart=1, cellEnd=8
		// startOfInCellLine=2  endOfInCellLine=7
		// [lineText, cursorCh, expectedLineAfter, expectedKillCacheNormalized]
		const cases: [string, number, string, string][] = [
			// kill from content start
			['| hello |',       2, '|  |',   'hello'],
			// kill from middle of content
			['| hello |',       4, '| he |', 'llo'],
			// single char cell
			['| x |',           2, '|  |',   'x'],
			// escaped pipe: \| normalized to | in cache
			['| a \\| b |',     2, '|  |',   'a | b'],
		]

		for (const [lineText, ch, expectedLine, expectedNormCache] of cases) {
			it(`"${lineText}" ch=${ch} → "${expectedLine}", normalized cache="${expectedNormCache}"`, () => {
				const editor = makeEditor([lineText], 0, ch)
				const info = getInCellLineInfo(lineText, ch)
				plugin.killLineInTableSourceMode(editor, info)
				expect(editor._buf[0]).toBe(expectedLine)
				expect(plugin.normalizeKillText(plugin.killCache)).toBe(expectedNormCache)
				expect(plugin.isKillChaining).toBe(true)
			})
		}
	})

	// ===========================================================================
	// killLineInTableSourceMode — cursor at in-cell line end (kill <br>)
	// ===========================================================================

	describe('killLineInTableSourceMode — kill <br> at in-cell line end', () => {
		it('removes <br> synchronously and defers cursor restore', () => {
			vi.useFakeTimers()
			// '| line1<br>line2 |'
			// pipes at 0 and 17; cellStart=1, cellEnd=17
			// first segment: ' line1' (1..7), <br> at 7, endOfSeg0=7
			// ch=7 = endOfInCellLine of 'first' segment
			const lineText = '| line1<br>line2 |'
			const editor = makeEditor([lineText], 0, 7)
			const info = getInCellLineInfo(lineText, 7)
			expect(info?.lineType).toBe('first')

			plugin.killLineInTableSourceMode(editor, info)

			// setLine called synchronously with <br> removed
			expect(editor.setLine).toHaveBeenCalledWith(0, '| line1line2 |')
			// isKillChaining not set yet
			expect(plugin.isKillChaining).toBe(false)
			expect(plugin.killCache).toBe('\n')

			vi.runAllTimers()
			expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 7)
			expect(plugin.isKillChaining).toBe(true)
		})

		it('removes <br> but keeps trailing spaces when smartJoin is OFF', () => {
			vi.useFakeTimers()
			// '| a<br>   b |'
			const lineText = '| a<br>   b |'
			const editor = makeEditor([lineText], 0, 3)
			const info = getInCellLineInfo(lineText, 3)
			expect(info?.lineType).toBe('first')

			plugin.killLineInTableSourceMode(editor, info)
			// only <br> removed, trailing spaces preserved
			expect(editor.setLine).toHaveBeenCalledWith(0, '| a   b |')

			vi.runAllTimers()
			expect(plugin.isKillChaining).toBe(true)
		})

		it('removes <br> with trailing spaces when smartJoin is ON', () => {
			vi.useFakeTimers()
			plugin.settings = { ...plugin.settings, smartJoin: true }
			// '| a<br>   b |'
			const lineText = '| a<br>   b |'
			const editor = makeEditor([lineText], 0, 3)
			const info = getInCellLineInfo(lineText, 3)
			expect(info?.lineType).toBe('first')

			plugin.killLineInTableSourceMode(editor, info)
			// <br> + '   ' (3 spaces) removed
			expect(editor.setLine).toHaveBeenCalledWith(0, '| ab |')

			vi.runAllTimers()
			expect(plugin.isKillChaining).toBe(true)
		})

		it('removes <br> with list marker when smartJoin is ON', () => {
			vi.useFakeTimers()
			plugin.settings = { ...plugin.settings, smartJoin: true }
			// '| a<br>   - item |'
			const lineText = '| a<br>   - item |'
			const editor = makeEditor([lineText], 0, 3)
			const info = getInCellLineInfo(lineText, 3)
			expect(info?.lineType).toBe('first')

			plugin.killLineInTableSourceMode(editor, info)
			// <br> + '   - ' removed, content 'item' remains
			expect(editor.setLine).toHaveBeenCalledWith(0, '| aitem |')

			vi.runAllTimers()
			expect(plugin.isKillChaining).toBe(true)
		})
	})

	// ===========================================================================
	// killLineInTableSourceMode — no-op at cell/in-cell-line boundary
	// ===========================================================================

	describe('killLineInTableSourceMode — no-op cases', () => {
		it('no-op at last in-cell line end (cell boundary, lineType last)', () => {
			// cursor at endOfInCellLine of 'last' segment → no matching branch
			const lineText = '| line1<br>line2 |'
			const editor = makeEditor([lineText], 0, 16)
			const info = getInCellLineInfo(lineText, 16)
			expect(info?.lineType).toBe('last')

			plugin.killLineInTableSourceMode(editor, info)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(editor.setLine).not.toHaveBeenCalled()
			expect(plugin.isKillChaining).toBe(false)
		})

		it('no-op at end of single in-cell line', () => {
			const lineText = '| hello |'
			const editor = makeEditor([lineText], 0, 7)
			const info = getInCellLineInfo(lineText, 7)
			expect(info?.lineType).toBe('single')

			plugin.killLineInTableSourceMode(editor, info)
			expect(editor.replaceRange).not.toHaveBeenCalled()
			expect(editor.setLine).not.toHaveBeenCalled()
		})
	})
})
