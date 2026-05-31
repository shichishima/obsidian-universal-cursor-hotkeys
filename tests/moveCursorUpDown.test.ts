import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// moveCursorUp and moveCursorDown — callout/blockquote entry in Live Preview mode.
//
// goUp/goDown skip over collapsed callout/blockquote widgets entirely.
// setCursor is used instead to expand the widget and place the cursor inside.
//
// moveCursorDown: detects callout headers via regex on the next line's text.
//   Plain blockquotes ("> text") are handled by goDown without special treatment.
// moveCursorUp: detects quote context via isLineInQuote (syntax tree) on the prev line.
//   Precondition: current line must be empty/whitespace-only.

function makePlugin() {
	const plugin: any = Object.create(UniversalCursorHotkeysPlugin.prototype)
	plugin.isLivePreviewMode    = vi.fn().mockReturnValue(true)
	plugin.isPositionInTable    = vi.fn().mockReturnValue(false)
	plugin.moveCursorUpInTable  = vi.fn()
	plugin.moveCursorUpIntoTable   = vi.fn()
	plugin.moveCursorDownInTable   = vi.fn()
	plugin.moveCursorDownIntoTable = vi.fn()
	plugin.setCursorViaCm       = vi.fn()
	return plugin
}

function makeEditor(lines: string[], line: number, ch: number) {
	const setCursor = vi.fn()
	const exec      = vi.fn()
	return {
		editor: {
			getCursor: vi.fn().mockReturnValue({ line, ch }),
			getLine:   vi.fn((l: number) => lines[l] ?? ''),
			lineCount: vi.fn().mockReturnValue(lines.length),
			setCursor,
			exec,
			cm: {},
		},
		setCursor,
		exec,
	}
}


// ===========================================================================
// moveCursorDown — callout entry (Ctrl-N)
// ===========================================================================

describe('moveCursorDown — callout entry', () => {
	let plugin: any

	beforeEach(() => {
		plugin = makePlugin()
	})

	const calloutHeaders: [string, string][] = [
		['> [!info]',         '> [!info] — bare type'],
		['> [!note] Title',   '> [!note] Title'],
		['> [!warning]+',     '> [!warning]+ — with + modifier'],
		['> [!tip]+ Note',    '> [!tip]+ Note'],
		['> [!danger]-',      '> [!danger]- — with - modifier'],
		['  > [!info]',       '  > [!info] — indented'],
	]

	for (const [header, desc] of calloutHeaders) {
		it(`setCursor when next line is ${desc}`, () => {
			const lines = ['some text', header]
			const { editor, setCursor, exec } = makeEditor(lines, 0, 4)
			plugin.moveCursorDown(editor)
			expect(setCursor).toHaveBeenCalledWith({ line: 1, ch: Math.min(4, header.length) })
			expect(exec).not.toHaveBeenCalled()
		})
	}

	it('ch clamped to next line length when cursor ch exceeds it', () => {
		const lines = ['very long line text here', '> [!note]']
		const { editor, setCursor } = makeEditor(lines, 0, 20)
		plugin.moveCursorDown(editor)
		// '> [!note]' is 9 chars; ch=20 is clamped to 9
		expect(setCursor).toHaveBeenCalledWith({ line: 1, ch: 9 })
	})

	it('exec goDown when next line is plain blockquote (not callout)', () => {
		const lines = ['some text', '> plain blockquote']
		const { editor, setCursor, exec } = makeEditor(lines, 0, 4)
		plugin.moveCursorDown(editor)
		expect(exec).toHaveBeenCalledWith('goDown')
		expect(setCursor).not.toHaveBeenCalled()
	})

	it('exec goDown when next line is regular text', () => {
		const lines = ['some text', 'regular text']
		const { editor, setCursor, exec } = makeEditor(lines, 0, 4)
		plugin.moveCursorDown(editor)
		expect(exec).toHaveBeenCalledWith('goDown')
		expect(setCursor).not.toHaveBeenCalled()
	})

	it('exec goDown when next line does not exist (last line)', () => {
		const lines = ['only line']
		const { editor, setCursor, exec } = makeEditor(lines, 0, 4)
		plugin.moveCursorDown(editor)
		expect(exec).toHaveBeenCalledWith('goDown')
		expect(setCursor).not.toHaveBeenCalled()
	})

	it('exec goDown when [!] has empty type name (not a valid callout)', () => {
		const lines = ['some text', '> [!] text']
		const { editor, setCursor, exec } = makeEditor(lines, 0, 4)
		plugin.moveCursorDown(editor)
		expect(exec).toHaveBeenCalledWith('goDown')
		expect(setCursor).not.toHaveBeenCalled()
	})

	it('exec goDown in non-LP mode', () => {
		plugin.isLivePreviewMode = vi.fn().mockReturnValue(false)
		const lines = ['some text', '> [!info] callout']
		const { editor, setCursor, exec } = makeEditor(lines, 0, 4)
		plugin.moveCursorDown(editor)
		expect(exec).toHaveBeenCalledWith('goDown')
		expect(setCursor).not.toHaveBeenCalled()
	})
})


// ===========================================================================
// moveCursorUp — callout/blockquote entry (Ctrl-P)
// ===========================================================================

describe('moveCursorUp — callout entry', () => {
	let plugin: any

	beforeEach(() => {
		plugin = makePlugin()
		plugin.isLineInQuote = vi.fn()
	})

	it('setCursor to prev line when current line is empty and prev is in quote', () => {
		const lines = ['> [!info] callout', '']
		const { editor, setCursor, exec } = makeEditor(lines, 1, 0)
		plugin.isLineInQuote.mockReturnValue(true)
		plugin.moveCursorUp(editor)
		expect(setCursor).toHaveBeenCalledWith({ line: 0, ch: 0 })
		expect(exec).not.toHaveBeenCalled()
	})

	it('setCursor to prev line when current line is whitespace-only', () => {
		const lines = ['> blockquote', '   ']
		const { editor, setCursor, exec } = makeEditor(lines, 1, 0)
		plugin.isLineInQuote.mockReturnValue(true)
		plugin.moveCursorUp(editor)
		expect(setCursor).toHaveBeenCalledWith({ line: 0, ch: 0 })
		expect(exec).not.toHaveBeenCalled()
	})

	it('ch clamped to prev line length when cursor ch exceeds it', () => {
		// prev line '> short' = 7 chars; cursor ch=10 is clamped to 7
		const lines = ['> short', '']
		const { editor, setCursor } = makeEditor(lines, 1, 10)
		plugin.isLineInQuote.mockReturnValue(true)
		plugin.moveCursorUp(editor)
		expect(setCursor).toHaveBeenCalledWith({ line: 0, ch: 7 })
	})

	it('exec goUp when current line is not empty', () => {
		const lines = ['> [!info] callout', 'some text']
		const { editor, setCursor, exec } = makeEditor(lines, 1, 4)
		plugin.isLineInQuote.mockReturnValue(true)
		plugin.moveCursorUp(editor)
		expect(exec).toHaveBeenCalledWith('goUp')
		expect(setCursor).not.toHaveBeenCalled()
	})

	it('exec goUp when prev line is not in quote', () => {
		const lines = ['regular text', '']
		const { editor, setCursor, exec } = makeEditor(lines, 1, 0)
		plugin.isLineInQuote.mockReturnValue(false)
		plugin.moveCursorUp(editor)
		expect(exec).toHaveBeenCalledWith('goUp')
		expect(setCursor).not.toHaveBeenCalled()
	})

	it('exec goUp when cursor.line === 0', () => {
		const lines = ['']
		const { editor, setCursor, exec } = makeEditor(lines, 0, 0)
		plugin.moveCursorUp(editor)
		expect(exec).toHaveBeenCalledWith('goUp')
		expect(setCursor).not.toHaveBeenCalled()
	})

	it('exec goUp in non-LP mode', () => {
		plugin.isLivePreviewMode = vi.fn().mockReturnValue(false)
		const lines = ['> [!info] callout', '']
		const { editor, setCursor, exec } = makeEditor(lines, 1, 0)
		plugin.isLineInQuote.mockReturnValue(true)
		plugin.moveCursorUp(editor)
		expect(exec).toHaveBeenCalledWith('goUp')
		expect(setCursor).not.toHaveBeenCalled()
	})
})


// ===========================================================================
// moveCursorDown — image/embed entry (Ctrl-N)
// ===========================================================================

describe('moveCursorDown — image/embed entry', () => {
	let plugin: any

	beforeEach(() => {
		plugin = makePlugin()
	})

	const imageCases: [string, string][] = [
		['![[note]]',       'Obsidian embed'],
		['![[image.png]]',  'Obsidian image embed'],
		['![alt](url)',     'Markdown image'],
		['![](url)',        'Markdown image no alt'],
	]

	for (const [line, desc] of imageCases) {
		it(`calls setCursorViaCm when next line is ${desc}`, () => {
			const lines = ['text above', line]
			const { editor, exec } = makeEditor(lines, 0, 0)
			plugin.moveCursorDown(editor)
			expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 1, 0)
			expect(exec).not.toHaveBeenCalled()
		})
	}

	it('falls through to goDown when next line has leading whitespace "  ![[...]]"', () => {
		const lines = ['text above', '  ![[note]]']
		const { editor, exec } = makeEditor(lines, 0, 0)
		plugin.moveCursorDown(editor)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		expect(exec).toHaveBeenCalledWith('goDown')
	})

	it('falls through to goDown when next line is plain text', () => {
		const lines = ['text above', 'plain text']
		const { editor, exec } = makeEditor(lines, 0, 0)
		plugin.moveCursorDown(editor)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		expect(exec).toHaveBeenCalledWith('goDown')
	})

	it('falls through to goDown in source mode', () => {
		plugin.isLivePreviewMode.mockReturnValue(false)
		const lines = ['text above', '![[note]]']
		const { editor, exec } = makeEditor(lines, 0, 0)
		plugin.moveCursorDown(editor)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		expect(exec).toHaveBeenCalledWith('goDown')
	})

	it('falls through to goDown when cursor is on the last line', () => {
		const lines = ['only line']
		const { editor, exec } = makeEditor(lines, 0, 0)
		plugin.moveCursorDown(editor)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		expect(exec).toHaveBeenCalledWith('goDown')
	})
})


// ===========================================================================
// moveCursorUp — image/embed entry (Ctrl-P)
// ===========================================================================

describe('moveCursorUp — image/embed entry', () => {
	let plugin: any

	beforeEach(() => {
		plugin = makePlugin()
		plugin.isLineInQuote = vi.fn().mockReturnValue(false)
	})

	const imageCases: [string, string][] = [
		['![[note]]',       'Obsidian embed'],
		['![[image.png]]',  'Obsidian image embed'],
		['![alt](url)',     'Markdown image'],
		['![](url)',        'Markdown image no alt'],
	]

	for (const [line, desc] of imageCases) {
		it(`calls setCursorViaCm when previous line is ${desc}`, () => {
			const lines = [line, 'text below']
			const { editor, exec } = makeEditor(lines, 1, 0)
			plugin.moveCursorUp(editor)
			expect(plugin.setCursorViaCm).toHaveBeenCalledWith(editor, 0, 0)
			expect(exec).not.toHaveBeenCalled()
		})
	}

	it('falls through to goUp when previous line has leading whitespace "  ![[...]]"', () => {
		const lines = ['  ![[note]]', 'text below']
		const { editor, exec } = makeEditor(lines, 1, 0)
		plugin.moveCursorUp(editor)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		expect(exec).toHaveBeenCalledWith('goUp')
	})

	it('falls through to goUp when previous line is plain text', () => {
		const lines = ['plain text', 'text below']
		const { editor, exec } = makeEditor(lines, 1, 0)
		plugin.moveCursorUp(editor)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		expect(exec).toHaveBeenCalledWith('goUp')
	})

	it('falls through to goUp in source mode', () => {
		plugin.isLivePreviewMode.mockReturnValue(false)
		const lines = ['![[note]]', 'text below']
		const { editor, exec } = makeEditor(lines, 1, 0)
		plugin.moveCursorUp(editor)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		expect(exec).toHaveBeenCalledWith('goUp')
	})

	it('falls through to goUp when cursor is on line 0', () => {
		const lines = ['![[note]]']
		const { editor, exec } = makeEditor(lines, 0, 0)
		plugin.moveCursorUp(editor)
		expect(plugin.setCursorViaCm).not.toHaveBeenCalled()
		expect(exec).toHaveBeenCalledWith('goUp')
	})
})
