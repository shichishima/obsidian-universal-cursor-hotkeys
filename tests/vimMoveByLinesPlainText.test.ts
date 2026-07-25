import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'
import { installVimWindow, uninstallVimWindow, type FakeEditor } from './__helpers__/vimWindow'

// moveByLines' plain-text branch (editor.inTableCell === false): no table
// anywhere in the walked path. Covers goal-column memory and the
// continuing-chain check, independent of any table-crossing/entry concerns
// (see vimMoveByLinesInCell.test.ts / vimMoveByLinesEntry.test.ts for those).

const makeHost = (overrides: Partial<VimSupportHost> = {}): VimSupportHost => ({
	settings: { vimHlSupport: false },
	saveSettings: async () => {},
	crossTableRowForCell: vi.fn().mockReturnValue(null),
	isLinePartOfTable: vi.fn().mockReturnValue(false),
	enterTableAtLine: vi.fn().mockReturnValue(null),
	...overrides,
})

// A plain document, no table anywhere. `|` prefilter never matches, so these
// tests never risk touching scheduleTableEntry.
const LINES = ['aaaaaaaaaa', 'bb', 'cccccccccc', 'dd', 'eeeeeeeeee']

function makeCmAndEditor() {
	const getLine = (n: number) => LINES[n] ?? ''
	const lastLine = () => LINES.length - 1
	const cm = { getLine, lastLine }
	let cursor = { line: 0, ch: 0 }
	const editor: FakeEditor = {
		inTableCell: false,
		getCursor: () => cursor,
		getLine,
	}
	return { cm, editor, setCursor: (c: { line: number; ch: number }) => { cursor = c } }
}

describe('moveByLines: plain text', () => {
	let vim: any
	let win: ReturnType<typeof installVimWindow>

	beforeEach(() => {
		vim = new VimSupport(makeHost()) as any
		win = installVimWindow()
	})
	afterEach(() => uninstallVimWindow())

	it('moves forward by repeat, landing at maxNormalModeCh when goal column exceeds the line', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		const result = vim.moveByLines(cm, { line: 0, ch: 5 }, { forward: true, repeat: 1 })
		// line 1 = 'bb' (len 2) -> maxNormalModeCh = 1
		expect(result).toEqual({ line: 1, ch: 1 })
	})

	it('moves backward by repeat', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		const result = vim.moveByLines(cm, { line: 2, ch: 3 }, { forward: false, repeat: 2 })
		expect(result).toEqual({ line: 0, ch: 3 })
	})

	it('clamps to document start/end', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		const down = vim.moveByLines(cm, { line: 4, ch: 0 }, { forward: true, repeat: 3 })
		expect(down.line).toBe(4)
		const up = vim.moveByLines(cm, { line: 0, ch: 0 }, { forward: false, repeat: 3 })
		expect(up.line).toBe(0)
	})

	it('preserves goal column across a short line when the chain continues', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		// Start at line 0 ch 8 (wide column). Step onto line 1 ('bb', len 2) —
		// clamped to ch 1, but the *true* goal (8) must be remembered.
		const step1 = vim.moveByLines(cm, { line: 0, ch: 8 }, { forward: true, repeat: 1 })
		expect(step1).toEqual({ line: 1, ch: 1 })
		// Continuing (head matches what we just returned) onto line 2
		// ('cccccccccc', len 10) should restore the original column 8.
		const step2 = vim.moveByLines(cm, step1, { forward: true, repeat: 1 })
		expect(step2).toEqual({ line: 2, ch: 8 })
	})

	it('does not preserve goal column when the chain is broken (head does not match last returned pos)', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		vim.moveByLines(cm, { line: 0, ch: 8 }, { forward: true, repeat: 1 }) // caches goalCh=8
		// Simulate an intervening action (e.g. h/l, a click) by passing a head
		// that doesn't match what was last returned.
		const result = vim.moveByLines(cm, { line: 1, ch: 0 }, { forward: true, repeat: 1 })
		// Fresh goal column = head.ch = 0, not the stale 8.
		expect(result).toEqual({ line: 2, ch: 0 })
	})

	it('count-prefixed motion ("3j"-equivalent) preserves the original column in one jump', () => {
		const { cm, editor } = makeCmAndEditor()
		win.setEditor(editor)
		// Single call with repeat=3 jumps straight to the final line, so no
		// intermediate short-line clamp ever has a chance to corrupt the goal.
		const result = vim.moveByLines(cm, { line: 0, ch: 8 }, { forward: true, repeat: 3 })
		expect(result).toEqual({ line: 3, ch: 1 }) // 'dd' len 2 -> clamp to 1
	})
})
