import { describe, it, expect, vi, afterEach } from 'vitest'
import { VimSupport } from '../vim-support'
import type { VimSupportHost } from '../vim-support'
import { installVimWindow, uninstallVimWindow, type FakeEditor } from './__helpers__/vimWindow'

// moveByLines' plain-text-to-table-entry path: walking one line at a time
// until a table row is reached, then handing the remaining repeat count off
// to enterTableAtLine. The `remaining` off-by-one (found via a live 3-<br>-
// segment cell: "4j" landed one segment early) is the key regression covered
// here — 3j/4j/5j against the same fixture that caught it.

const makeHost = (overrides: Partial<VimSupportHost> = {}): VimSupportHost => ({
	settings: { vimHlSupport: false, vimJkSupport: false, vimJoinSupport: false, vimCaretSupport: false, vimWordSupport: false, smartJoin: false, smartHomeStandard: false },
	getBeginningOfLinePosition: () => 0,
	saveSettings: async () => {},
	crossTableRowForCell: vi.fn().mockReturnValue(null),
	crossTableRowForWord: vi.fn().mockReturnValue(null),
	isLinePartOfTable: vi.fn().mockReturnValue(true),
	enterTableAtLine: vi.fn().mockReturnValue(null),
	...overrides,
})

// Mirrors the real repro exactly (including the blank line before the table):
// 111 / 222 / <blank> / header ("AAA<br>BBB<br>CCC" in cellIndex 0, 3
// <br>-segments) / delimiter / data row 1.
const LINES = [
	'111',
	'222',
	'',
	'| AAA<br>BBB<br>CCC | 123456 |', // line 3: header
	'| ----------------- | ------ |', // line 4: delimiter
	'| 123456            |        |', // line 5: data row 1
]

function makeEditor(cursor: { line: number; ch: number }): FakeEditor {
	return {
		inTableCell: false,
		getCursor: () => cursor,
		getLine: (n: number) => LINES[n] ?? '',
	}
}

const cmFor = (lastLine = LINES.length) => ({
	getLine: (n: number) => LINES[n] ?? '',
	lastLine: () => lastLine,
})

describe('moveByLines: plain text entering a table', () => {
	let win: ReturnType<typeof installVimWindow>
	afterEach(() => uninstallVimWindow())

	it('single-step entry (repeat=1 reaching the header directly) uses remaining=1', () => {
		// remaining is never decremented for the entry-detection step itself
		// (see moveByLines' own comment) — so even an *immediate* match (0 plain
		// lines consumed first) carries remaining=1, landing on the header's own
		// first segment (segmentOffset = remaining - 1 = 0).
		const host = makeHost()
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeEditor({ line: 2, ch: 0 }))
		vim.moveByLines(cmFor(), { line: 2, ch: 0 }, { forward: true, repeat: 1 })
		win.flush()
		expect(host.enterTableAtLine).toHaveBeenCalledWith(
			expect.anything(), 3 /* header line */, 0 /* cellIndex fallback */, true, 0 /* goalCh */, 1 /* remaining */,
		)
	})

	it('regression: 3j/4j/5j from the top land on segments 1/2/3 (remaining=1/2/3), not one segment early', () => {
		// repeat=3 crosses '111'->'222'->blank, reaching the header on the 3rd
		// step with remaining=1 (the header's own first segment). repeat=4/5
		// should increment remaining by 1 each time, not stay off-by-one short.
		const host3 = makeHost()
		const vim3 = new VimSupport(host3) as any
		win = installVimWindow(makeEditor({ line: 0, ch: 0 }))
		vim3.moveByLines(cmFor(), { line: 0, ch: 0 }, { forward: true, repeat: 3 })
		win.flush()
		expect(host3.enterTableAtLine).toHaveBeenCalledWith(expect.anything(), 3, 0, true, 0, 1)

		const host4 = makeHost()
		const vim4 = new VimSupport(host4) as any
		win = installVimWindow(makeEditor({ line: 0, ch: 0 }))
		vim4.moveByLines(cmFor(), { line: 0, ch: 0 }, { forward: true, repeat: 4 })
		win.flush()
		expect(host4.enterTableAtLine).toHaveBeenCalledWith(expect.anything(), 3, 0, true, 0, 2)

		const host5 = makeHost()
		const vim5 = new VimSupport(host5) as any
		win = installVimWindow(makeEditor({ line: 0, ch: 0 }))
		vim5.moveByLines(cmFor(), { line: 0, ch: 0 }, { forward: true, repeat: 5 })
		win.flush()
		expect(host5.enterTableAtLine).toHaveBeenCalledWith(expect.anything(), 3, 0, true, 0, 3)
	})

	it('does not schedule entry when the repeat never reaches a table row', () => {
		const host = makeHost()
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeEditor({ line: 0, ch: 0 }))
		const result = vim.moveByLines(cmFor(), { line: 0, ch: 0 }, { forward: true, repeat: 1 }) // -> line 1, plain
		win.flush()
		expect(host.enterTableAtLine).not.toHaveBeenCalled()
		expect(result).toEqual({ line: 1, ch: 0 })
	})

	it('backward entry from just below the table reaches the last data row', () => {
		const host = makeHost()
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeEditor({ line: 6, ch: 0 })) // one plain line below the table
		vim.moveByLines(cmFor(6), { line: 6, ch: 0 }, { forward: false, repeat: 1 })
		win.flush()
		expect(host.enterTableAtLine).toHaveBeenCalledWith(expect.anything(), 5 /* data row 1 */, 0, false, 0, 1)
	})

	it('aborts the entry if isLinePartOfTable rejects the cheap pre-filter match', () => {
		// A line that merely starts with '|' (e.g. an escaped pipe in plain
		// text) but isn't actually a Live-Preview table, per the full check.
		const host = makeHost({ isLinePartOfTable: vi.fn().mockReturnValue(false) })
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeEditor({ line: 2, ch: 0 }))
		vim.moveByLines(cmFor(), { line: 2, ch: 0 }, { forward: true, repeat: 1 })
		win.flush()
		expect(host.enterTableAtLine).not.toHaveBeenCalled()
	})

	it('temporary synchronous return stays at head.line rather than jumping to the raw target', () => {
		// Landing directly on the raw target line risked landing mid-dash on a
		// delimiter row (or otherwise on a position Live Preview can't focus);
		// the real landing happens only once the deferred callback corrects it.
		const host = makeHost()
		const vim = new VimSupport(host) as any
		win = installVimWindow(makeEditor({ line: 2, ch: 0 }))
		// Don't flush — inspect the synchronous return only.
		const result = vim.moveByLines(cmFor(), { line: 2, ch: 0 }, { forward: true, repeat: 1 })
		expect(result.line).toBe(2) // head.line, not 3 (the header)
	})
})
