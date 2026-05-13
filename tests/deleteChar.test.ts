import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

vi.mock('@codemirror/commands', () => ({
	deleteCharForward: vi.fn(),
	cursorPageDown: vi.fn(),
	cursorPageUp: vi.fn(),
}))

import { deleteCharForward } from '@codemirror/commands'
import UniversalCursorHotkeysPlugin from '../main.ts'

function makeEditor(lines: string[], cursorLine: number, cursorCh: number) {
	const buf = [...lines]
	return {
		getCursor:        vi.fn(() => ({ line: cursorLine, ch: cursorCh })),
		getLine:          vi.fn((line: number) => buf[line] ?? ''),
		lineCount:        vi.fn(() => buf.length),
		replaceRange:     vi.fn(),
		setLine:          vi.fn((line: number, text: string) => { buf[line] = text }),
		replaceSelection: vi.fn(),
		cm:               {} as any,
		_buf:             buf,
	}
}


describe('deleteCharInTableLP', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: true, crossRowNavigation: true }
		plugin.setCursorViaCm = vi.fn()
		vi.mocked(deleteCharForward).mockClear()
		vi.stubGlobal('window', globalThis)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})


	// ===========================================================================
	// no-op: cell boundary (single / last)
	// ===========================================================================

	describe('no-op at cell boundary', () => {
		it('single cell — cursor at endOfInCellLine', () => {
			// | hello |  pipes at 0,8  endOfInCellLine=7
			const lineText = '| hello |'
			const editor = makeEditor([lineText], 0, 7)
			plugin.deleteCharInTableLP(editor)
			expect(editor.setLine).not.toHaveBeenCalled()
			expect(deleteCharForward).not.toHaveBeenCalled()
		})

		it('single cell — cursor past endOfInCellLine (trailing space before pipe)', () => {
			const lineText = '| hello |'
			const editor = makeEditor([lineText], 0, 8)
			plugin.deleteCharInTableLP(editor)
			expect(editor.setLine).not.toHaveBeenCalled()
			expect(deleteCharForward).not.toHaveBeenCalled()
		})

		it('last in-cell line — cursor at endOfInCellLine', () => {
			// | a<br>b |  last segment: startOfInCellLine=7, endOfInCellLine=8
			const lineText = '| a<br>b |'
			const editor = makeEditor([lineText], 0, 8)
			const info = plugin.getInCellLineInfo(lineText, 8)
			expect(info?.lineType).toBe('last')
			plugin.deleteCharInTableLP(editor)
			expect(editor.setLine).not.toHaveBeenCalled()
			expect(deleteCharForward).not.toHaveBeenCalled()
		})
	})


	// ===========================================================================
	// <br> deletion: join in-cell sub-lines
	// ===========================================================================

	describe('<br> deletion at in-cell line end', () => {
		it('first segment — removes <br> and defers cursor restore', () => {
			vi.useFakeTimers()
			// | a<br>b |  first segment endOfInCellLine=3 (at '<' of <br>)
			const lineText = '| a<br>b |'
			const editor = makeEditor([lineText], 0, 3)
			const info = plugin.getInCellLineInfo(lineText, 3)
			expect(info?.lineType).toBe('first')

			plugin.deleteCharInTableLP(editor)

			expect(editor.setLine).toHaveBeenCalledWith(0, '| ab |')
			expect(deleteCharForward).not.toHaveBeenCalled()

			vi.runAllTimers()
			expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 3)
		})

		it('first segment — removes <br> including trailing spaces', () => {
			vi.useFakeTimers()
			// | a<br>   b |  <br>+3 spaces consumed
			const lineText = '| a<br>   b |'
			const editor = makeEditor([lineText], 0, 3)

			plugin.deleteCharInTableLP(editor)

			expect(editor.setLine).toHaveBeenCalledWith(0, '| ab |')
		})

		it('middle segment — removes <br> between middle and last', () => {
			vi.useFakeTimers()
			// | a<br>b<br>c |  middle segment endOfInCellLine=8 (second '<br>' start)
			const lineText = '| a<br>b<br>c |'
			const editor = makeEditor([lineText], 0, 8)
			const info = plugin.getInCellLineInfo(lineText, 8)
			expect(info?.lineType).toBe('middle')

			plugin.deleteCharInTableLP(editor)

			expect(editor.setLine).toHaveBeenCalledWith(0, '| a<br>bc |')
		})
	})


	// ===========================================================================
	// within cell content: delegates to deleteCharForward
	// ===========================================================================

	describe('within cell content', () => {
		it('cursor within single cell — calls deleteCharForward', () => {
			// | hello |  cursor at ch=2, before endOfInCellLine=7
			const lineText = '| hello |'
			const editor = makeEditor([lineText], 0, 2)
			plugin.deleteCharInTableLP(editor)
			expect(deleteCharForward).toHaveBeenCalledWith(editor.cm)
			expect(editor.setLine).not.toHaveBeenCalled()
		})

		it('cursor at start of last in-cell line — calls deleteCharForward', () => {
			// | a<br>b |  cursor at ch=7 (start of 'b'), endOfInCellLine=8
			const lineText = '| a<br>b |'
			const editor = makeEditor([lineText], 0, 7)
			plugin.deleteCharInTableLP(editor)
			expect(deleteCharForward).toHaveBeenCalledWith(editor.cm)
		})
	})
})


describe('deleteCharInTableSource', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.settings = { smartHomeStandard: true, smartHomeAdvanced: true, visualLineMovement: true, crossRowNavigation: true }
		vi.mocked(deleteCharForward).mockClear()
	})


	// ===========================================================================
	// no-op: at or past cellEnd (trailing \s*|)
	// ===========================================================================

	describe('no-op at cell boundary', () => {
		it('cursor at cellEnd (trimmed content end)', () => {
			// | hello |  cellEnd=7 (after 'o', before ' |')
			const lineText = '| hello |'
			const editor = makeEditor([lineText], 0, 7)
			plugin.deleteCharInTableSource(editor)
			expect(deleteCharForward).not.toHaveBeenCalled()
		})

		it('cursor in trailing space before pipe', () => {
			const lineText = '| hello |'
			const editor = makeEditor([lineText], 0, 8)
			plugin.deleteCharInTableSource(editor)
			expect(deleteCharForward).not.toHaveBeenCalled()
		})
	})


	// ===========================================================================
	// within cell: delegates to deleteCharForward (no HTML-tag awareness)
	// ===========================================================================

	describe('within cell content', () => {
		it('cursor within cell content — calls deleteCharForward', () => {
			const lineText = '| hello |'
			const editor = makeEditor([lineText], 0, 2)
			plugin.deleteCharInTableSource(editor)
			expect(deleteCharForward).toHaveBeenCalledWith(editor.cm)
		})

		it('cursor inside <br> tag — treated as plain text, calls deleteCharForward', () => {
			// In Source Mode <br> is raw text; cursor at ch=4 (inside '<br>') should delete normally
			const lineText = '| a<br>b |'
			const editor = makeEditor([lineText], 0, 4)
			plugin.deleteCharInTableSource(editor)
			expect(deleteCharForward).toHaveBeenCalledWith(editor.cm)
		})
	})
})
