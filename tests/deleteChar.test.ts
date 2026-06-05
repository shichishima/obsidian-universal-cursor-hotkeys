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

function makeLineAt(text: string) {
	return (pos: number) => {
		const parts = text.split('\n')
		let offset = 0
		for (let i = 0; i < parts.length; i++) {
			const to = offset + parts[i].length
			if (pos <= to) {
				return { from: offset, to, text: parts[i], number: i + 1 }
			}
			offset = to + 1
		}
		const last = parts[parts.length - 1]
		return { from: text.length - last.length, to: text.length, text: last, number: parts.length }
	}
}

function makeEditorWithInnerView(innerText: string, head: number) {
	const innerDispatch = vi.fn()
	const outerCm = {} as any
	return {
		activeCM: {
			state: {
				doc: {
					toString: () => innerText,
					lineAt: makeLineAt(innerText),
					lines: innerText.split('\n').length,
				},
				selection: { main: { head } },
			},
			dispatch: innerDispatch,
		},
		cm: outerCm,
		_innerDispatch: innerDispatch,
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
	// inner view path — primary path when editor.activeCM is available
	// ===========================================================================
	//
	// innerText=' hello '  single line; endOfSubLine=6 (trimEnd)
	// innerText=' a\n b '  multi-line: sub-line 1 from=0,to=2; sub-line 2 from=3,to=6,endOfSubLine=5

	type Row = {
		desc:          string
		innerText:     string
		head:          number
		innerDispatch?: { changes: { from: number; to: number; insert: string }; selection: { anchor: number }; userEvent: string }
		deleteForward?: true
		// neither = no-op
	}

	const innerViewMatrix: Row[] = [
		// single-line cell: endOfSubLine=6
		{ desc: 'single: within content → deleteCharForward',   innerText: ' hello ', head: 3, deleteForward: true },
		{ desc: 'single: at end → no-op',                       innerText: ' hello ', head: 6 },
		{ desc: 'single: past end (trailing space) → no-op',    innerText: ' hello ', head: 7 },

		// multi-line cell: sub-line 1 to=2; sub-line 2 endOfSubLine=5
		{ desc: 'multi: within first sub-line → deleteCharForward', innerText: ' a\n b ', head: 1, deleteForward: true },
		{ desc: 'multi: at first sub-line end → delete \\n',        innerText: ' a\n b ', head: 2,
			innerDispatch: { changes: { from: 2, to: 3, insert: '' }, selection: { anchor: 2 }, userEvent: 'delete' } },
		{ desc: 'multi: within last sub-line → deleteCharForward',  innerText: ' a\n b ', head: 4, deleteForward: true },
		{ desc: 'multi: at last sub-line end → no-op',              innerText: ' a\n b ', head: 5 },
	]

	describe('inner view path', () => {
		for (const row of innerViewMatrix) {
			it(row.desc, () => {
				const editor = makeEditorWithInnerView(row.innerText, row.head)
				plugin.deleteCharInTableLP(editor)

				if (row.innerDispatch) {
					expect(editor._innerDispatch).toHaveBeenCalledWith(row.innerDispatch)
					expect(deleteCharForward).not.toHaveBeenCalled()
				} else if (row.deleteForward) {
					expect(deleteCharForward).toHaveBeenCalledWith(editor.cm)
					expect(editor._innerDispatch).not.toHaveBeenCalled()
				} else {
					expect(editor._innerDispatch).not.toHaveBeenCalled()
					expect(deleteCharForward).not.toHaveBeenCalled()
				}
			})
		}
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
