import { describe, it, expect, vi, beforeEach } from 'vitest'
import UniversalCursorHotkeysPlugin from '../main.ts'

// setCursorViaCm's preserveActiveSelection param (added alongside the fix for
// gg/G dropping out of Vim's Visual/Visual Line mode — see jumpToDocumentLine's
// own tests in vimSupportHostBridge.test.ts for the end-to-end path). This
// file tests the method directly, since every *other* caller in this codebase
// mocks it out rather than exercising the real implementation.
describe('setCursorViaCm', () => {
	let plugin: any
	let dispatch: ReturnType<typeof vi.fn>
	let focus: ReturnType<typeof vi.fn>
	let editor: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.isPositionInTable = vi.fn().mockReturnValue(false)
		plugin._inScrollPage = false
		dispatch = vi.fn()
		focus = vi.fn()
		editor = {
			posToOffset: (pos: { line: number; ch: number }) => pos.line * 1000 + pos.ch,
			cm: {
				dispatch,
				focus,
				state: { selection: { main: { anchor: 500, head: 900 } } }, // an active (non-empty) selection
				activeCM: undefined,
			},
		}
	})

	it('preserveActiveSelection=false (default): always collapses to a point at the new position, ignoring any existing selection', () => {
		plugin.setCursorViaCm(editor, 2, 0)
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ selection: { anchor: 2000, head: 2000 } }),
		)
	})

	it('preserveActiveSelection=true with an active selection: keeps the existing anchor, moves only head', () => {
		plugin.setCursorViaCm(editor, 2, 0, true)
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ selection: { anchor: 500, head: 2000 } }),
		)
	})

	it('preserveActiveSelection=true with no active selection (anchor === head): collapses to a point, same as the default', () => {
		editor.cm.state.selection.main = { anchor: 500, head: 500 }
		plugin.setCursorViaCm(editor, 2, 0, true)
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ selection: { anchor: 2000, head: 2000 } }),
		)
	})

	it('does not read cm.state at all when preserveActiveSelection is false (default) — safe for callers/mocks with no state property', () => {
		delete editor.cm.state
		expect(() => plugin.setCursorViaCm(editor, 2, 0)).not.toThrow()
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ selection: { anchor: 2000, head: 2000 } }),
		)
	})
})
