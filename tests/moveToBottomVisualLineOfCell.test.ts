import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codemirror/language', () => ({
	syntaxTree: vi.fn(),
}))

import UniversalCursorHotkeysPlugin from '../main.ts'

// LINE_SINGLE = '| content |'   eoc=9   inner doc=' content' (len=8)
// LINE_2SEG   = '| line1<br>line2 |'    inner doc=' line1\nline2'
//   last sub-line 'line2' at from=7, trimEnd len=5, contentEnd=12
const LINE_SINGLE = '| content |'
const LINE_2SEG   = '| line1<br>line2 |'

describe('moveToBottomVisualLineOfCell', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
	})

	// Build an inner view mock.
	// coordsMap: pos → top (null → coordsAtPos always returns null)
	// posResult: return value of posAtCoords (null → posAtCoords returns null)
	function makeInner(
		docText: string,
		coordsMap: Record<number, number> | null,
		posResult: number | null,
	) {
		const parts = docText.split('\n')
		const lineByNumber = (n: number) => {
			let offset = 0
			for (let i = 0; i < n - 1; i++) offset += parts[i].length + 1
			const text = parts[n - 1]
			return { number: n, from: offset, to: offset + text.length, text }
		}
		const coordsAtPos = coordsMap !== null
			? vi.fn((pos: number) => {
				const top = coordsMap[pos]
				if (top === undefined) return null
				return { top, bottom: top + 18, left: 100, right: 200 }
			})
			: vi.fn(() => null)
		const posAtCoords = vi.fn(() => posResult)
		const dispatch    = vi.fn()
		return {
			state: {
				doc: {
					lines: parts.length,
					line: lineByNumber,
				},
			},
			coordsAtPos,
			posAtCoords,
			dispatch,
		}
	}

	// Build editor mock. getCursor calls are returned in sequence; last repeats.
	function makeEditor(
		lineText: string,
		ch: number,
		inner: object,
		extraCursors: { line: number; ch: number }[] = [],
	) {
		const baseCursor   = { line: 1, ch }
		const cursorSeq    = [baseCursor, ...extraCursors]
		const getCursorMock = vi.fn()
		cursorSeq.forEach((c, i) => {
			if (i < cursorSeq.length - 1) getCursorMock.mockReturnValueOnce(c)
			else getCursorMock.mockReturnValue(c)
		})
		const outerCm = {}
		return {
			getCursor: getCursorMock,
			getLine:   vi.fn().mockReturnValue(lineText),
			exec:      vi.fn(),
			setCursor: vi.fn(),
			activeCM:  inner,
			cm:        outerCm,
		}
	}

	// Attach a separate cm reference so activeCM === cm (no inner view).
	function withoutInner(editor: ReturnType<typeof makeEditor>) {
		return { ...editor, activeCM: editor.cm }
	}

	// ===========================================================================
	// coordsAtPos path — inner view dispatched directly, no goDown
	// ===========================================================================

	it('single VL: coordsAtPos succeeds → inner.dispatch called, goDown not called', () => {
		// inner doc ' content', contentEnd = 0 + 8 = 8
		const inner  = makeInner(' content', { 8: 100 }, 3)
		const editor = makeEditor(LINE_SINGLE, 2, inner)
		plugin.moveToBottomVisualLineOfCell(editor)
		expect(inner.dispatch).toHaveBeenCalledWith({ selection: { anchor: 3 } })
		expect(editor.exec).not.toHaveBeenCalledWith('goDown')
	})

	it('multi sub-line: coordsAtPos on last sub-line succeeds → inner.dispatch called', () => {
		// inner doc ' line1\nline2'
		// last sub-line: from=7, text='line2', trimEnd len=5 → contentEnd=12
		const inner  = makeInner(' line1\nline2', { 12: 120 }, 5)
		const editor = makeEditor(LINE_2SEG, 2, inner)
		plugin.moveToBottomVisualLineOfCell(editor)
		expect(inner.dispatch).toHaveBeenCalledWith({ selection: { anchor: 5 } })
		expect(editor.exec).not.toHaveBeenCalledWith('goDown')
	})

	it('coordsAtPos path: posAtCoords called with x=0 and y = endCoords.top + 9', () => {
		// endCoords.top = 100 → posAtCoords called with y=109
		const inner  = makeInner(' content', { 8: 100 }, 3)
		const editor = makeEditor(LINE_SINGLE, 2, inner)
		plugin.moveToBottomVisualLineOfCell(editor)
		expect(inner.posAtCoords).toHaveBeenCalledWith({ x: 0, y: 109 }, false)
	})

	// ===========================================================================
	// fallback: goDown loop runs
	// ===========================================================================

	it('coordsAtPos returns null → goDown loop runs (goRight called)', () => {
		// inner exists but coordsAtPos returns null → fallback
		const inner  = makeInner(' content', null, null)
		const editor = makeEditor(LINE_SINGLE, 2, inner, [
			{ line: 1, ch: 3 },  // after goRight (same line)
			{ line: 1, ch: 2 },  // after goLeft (lastPos)
			{ line: 1, ch: 2 },  // after goDown (noMove → break)
		])
		plugin.moveToBottomVisualLineOfCell(editor)
		expect(inner.dispatch).not.toHaveBeenCalled()
		expect(editor.exec).toHaveBeenCalledWith('goRight')
	})

	it('posAtCoords returns null → goDown loop runs', () => {
		// coordsAtPos succeeds but posAtCoords returns null → fallback
		const inner  = makeInner(' content', { 8: 100 }, null)
		const editor = makeEditor(LINE_SINGLE, 2, inner, [
			{ line: 1, ch: 3 },
			{ line: 1, ch: 2 },
			{ line: 1, ch: 2 },
		])
		plugin.moveToBottomVisualLineOfCell(editor)
		expect(inner.dispatch).not.toHaveBeenCalled()
		expect(editor.exec).toHaveBeenCalledWith('goRight')
	})

	it('no inner view (activeCM === cm) → goDown loop runs', () => {
		const inner  = makeInner(' content', { 8: 100 }, 3)
		const editor = withoutInner(makeEditor(LINE_SINGLE, 2, inner, [
			{ line: 1, ch: 3 },
			{ line: 1, ch: 2 },
			{ line: 1, ch: 2 },
		]))
		plugin.moveToBottomVisualLineOfCell(editor)
		expect(editor.exec).toHaveBeenCalledWith('goRight')
	})
})


describe('placeAtBottomVL', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.moveToBottomVisualLineOfCell = vi.fn()
		plugin.scheduleBottomVisualLine     = vi.fn()
	})

	function makeEditor(inner: object, cm: object = {}) {
		return { activeCM: inner, cm }
	}

	// ===========================================================================
	// sync path: inner view available and coordsAtPos succeeds
	// ===========================================================================

	it('inner view available, coordsAtPos succeeds → moveToBottomVisualLineOfCell called synchronously', () => {
		// inner doc ' content', contentEnd=8, coordsAtPos(8) returns non-null
		const coordsAtPos = vi.fn((pos: number) =>
			pos === 8 ? { top: 100, bottom: 118, left: 100, right: 200 } : null
		)
		const inner  = {
			state: { doc: { lines: 1, line: () => ({ from: 0, text: ' content' }) } },
			coordsAtPos,
		}
		const editor = makeEditor(inner)
		plugin.placeAtBottomVL(editor)
		expect(plugin.moveToBottomVisualLineOfCell).toHaveBeenCalledWith(editor)
		expect(plugin.scheduleBottomVisualLine).not.toHaveBeenCalled()
	})

	// ===========================================================================
	// async fallback: scheduleBottomVisualLine called
	// ===========================================================================

	it('no inner view (activeCM === cm) → scheduleBottomVisualLine called', () => {
		const cm     = {}
		const editor = makeEditor(cm, cm)
		plugin.placeAtBottomVL(editor)
		expect(plugin.scheduleBottomVisualLine).toHaveBeenCalledWith(editor)
		expect(plugin.moveToBottomVisualLineOfCell).not.toHaveBeenCalled()
	})

	it('inner view available but coordsAtPos returns null → scheduleBottomVisualLine called', () => {
		const inner  = {
			state: { doc: { lines: 1, line: () => ({ from: 0, text: ' content' }) } },
			coordsAtPos: vi.fn(() => null),
		}
		const editor = makeEditor(inner)
		plugin.placeAtBottomVL(editor)
		expect(plugin.scheduleBottomVisualLine).toHaveBeenCalledWith(editor)
		expect(plugin.moveToBottomVisualLineOfCell).not.toHaveBeenCalled()
	})
})


describe('handleCellStartSnap', () => {
	let plugin: any

	beforeEach(() => {
		plugin = Object.create(UniversalCursorHotkeysPlugin.prototype)
		plugin.CELL_SEPARATOR_REGEX  = /(?<!\\)\|/g
		plugin.TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/
		plugin.setCursorToPrevRow = vi.fn()
		plugin.placeAtBottomVL   = vi.fn()
	})

	// Build inner view mock with fixed coords for two positions.
	// afterHead: coords of current cursor after goUp (VL1 start)
	// beforeHead: coords of cursor before goUp (original position)
	function makeInnerWithCoords(
		afterHead:  number,
		afterTop:   number | null,
		beforeHead: number,
		beforeTop:  number | null,
	) {
		const coords = new Map<number, number | null>([
			[afterHead,  afterTop],
			[beforeHead, beforeTop],
		])
		return {
			state: { selection: { main: { head: afterHead } } },
			coordsAtPos: vi.fn((pos: number) => {
				const top = coords.get(pos)
				if (top == null) return null
				return { top, bottom: top + 18, left: 100, right: 200 }
			}),
		}
	}

	// Build editor mock with inner view (activeCM !== cm).
	function makeEditorWithInner(inner: object, execResults: { line: number; ch: number }[] = []) {
		const cm = {}
		let callCount = 0
		const getCursor = vi.fn(() => {
			const result = execResults[callCount] ?? execResults[execResults.length - 1]
			callCount++
			return result
		})
		return {
			activeCM: inner,
			cm,
			exec:      vi.fn(),
			getCursor,
			setCursor: vi.fn(),
		}
	}

	// Build editor mock without inner view (activeCM === cm).
	function makeEditorWithoutInner(execResults: { line: number; ch: number }[]) {
		const cm = {} as any
		let callCount = 0
		const getCursor = vi.fn(() => {
			const result = execResults[callCount] ?? execResults[execResults.length - 1]
			callCount++
			return result
		})
		cm.exec      = vi.fn()
		cm.getCursor = getCursor
		const editor = {
			activeCM: cm,
			cm,
			exec:      vi.fn(),
			getCursor,
			setCursor: vi.fn(),
		}
		return editor
	}

	// ===========================================================================
	// coordsAtPos path — VL2+ left edge: originalCoords.top > vl1Coords.top + 2
	// ===========================================================================

	it('coordsAtPos path: VL2+ left edge (originalCoords.top > vl1Coords.top + 2) → return early, no prevRow', () => {
		// afterHead=0 (VL1 start, top=100), beforeHead=10 (VL2+ pos, top=120)
		const inner  = makeInnerWithCoords(0, 100, 10, 120)
		const editor = makeEditorWithInner(inner)
		plugin.handleCellStartSnap(editor, 1, 5, 0, 10)
		expect(plugin.setCursorToPrevRow).not.toHaveBeenCalled()
		expect(plugin.placeAtBottomVL).not.toHaveBeenCalled()
	})

	it('coordsAtPos path: originalCoords.top exactly equals vl1Coords.top + 3 → return early (boundary)', () => {
		// top diff = 3 > 2 → stay
		const inner  = makeInnerWithCoords(0, 100, 10, 103)
		const editor = makeEditorWithInner(inner)
		plugin.handleCellStartSnap(editor, 1, 5, 0, 10)
		expect(plugin.setCursorToPrevRow).not.toHaveBeenCalled()
		expect(plugin.placeAtBottomVL).not.toHaveBeenCalled()
	})

	// ===========================================================================
	// coordsAtPos path — VL1 middle: originalCoords.top ≤ vl1Coords.top + 2
	// ===========================================================================

	it('coordsAtPos path: VL1 middle (same top) → setCursorToPrevRow + placeAtBottomVL called', () => {
		// afterHead=0 (top=100), beforeHead=5 (top=100) — same VL
		const inner  = makeInnerWithCoords(0, 100, 5, 100)
		const editor = makeEditorWithInner(inner)
		plugin.handleCellStartSnap(editor, 1, 5, 0, 5)
		expect(plugin.setCursorToPrevRow).toHaveBeenCalledWith(editor, 0)
		expect(plugin.placeAtBottomVL).toHaveBeenCalledWith(editor)
	})

	it('coordsAtPos path: originalCoords.top = vl1Coords.top + 2 → VL1 middle (boundary)', () => {
		// diff = 2 → not > 2 → VL1 middle path
		const inner  = makeInnerWithCoords(0, 100, 5, 102)
		const editor = makeEditorWithInner(inner)
		plugin.handleCellStartSnap(editor, 1, 5, 0, 5)
		expect(plugin.setCursorToPrevRow).toHaveBeenCalledWith(editor, 0)
		expect(plugin.placeAtBottomVL).toHaveBeenCalledWith(editor)
	})

	// ===========================================================================
	// coordsAtPos path — null coords → fallback to goDown probe
	// ===========================================================================

	it('coordsAtPos returns null for vl1Coords → fallback: VL2+ case (backTest === original → goUp only)', () => {
		// afterHead=0, coordsAtPos(0) returns null → fallback
		const inner  = makeInnerWithCoords(0, null, 5, 100)
		// goDown → same position → VL2+
		const editor = makeEditorWithInner(inner, [{ line: 1, ch: 5 }])
		plugin.handleCellStartSnap(editor, 1, 5, 0, 5)
		expect(editor.exec).toHaveBeenNthCalledWith(1, 'goDown')
		expect(editor.exec).toHaveBeenNthCalledWith(2, 'goUp')
		expect(plugin.setCursorToPrevRow).not.toHaveBeenCalled()
	})

	it('coordsAtPos returns null for originalCoords → fallback: VL1 middle case (backTest ≠ original → prevRow)', () => {
		// beforeHead=5, coordsAtPos(5) returns null → fallback
		const inner  = makeInnerWithCoords(0, 100, 5, null)
		// goDown → different position → VL1 middle
		const editor = makeEditorWithInner(inner, [{ line: 1, ch: 7 }])
		plugin.handleCellStartSnap(editor, 1, 5, 0, 5)
		expect(editor.exec).toHaveBeenNthCalledWith(1, 'goDown')
		expect(editor.exec).toHaveBeenNthCalledWith(2, 'goUp')
		expect(plugin.setCursorToPrevRow).toHaveBeenCalledWith(editor, 0)
		expect(plugin.placeAtBottomVL).toHaveBeenCalledWith(editor)
	})

	// ===========================================================================
	// fallback: innerHeadBeforeGoUp undefined → goDown probe directly
	// ===========================================================================

	it('innerHeadBeforeGoUp undefined → goDown probe: VL2+ (backTest === original) → goUp only', () => {
		const inner  = makeInnerWithCoords(0, 100, 5, 120)
		// goDown → same position → VL2+
		const editor = makeEditorWithInner(inner, [{ line: 1, ch: 5 }])
		plugin.handleCellStartSnap(editor, 1, 5, 0, undefined)
		expect(editor.exec).toHaveBeenNthCalledWith(1, 'goDown')
		expect(editor.exec).toHaveBeenNthCalledWith(2, 'goUp')
		expect(plugin.setCursorToPrevRow).not.toHaveBeenCalled()
	})

	it('innerHeadBeforeGoUp undefined → goDown probe: VL1 middle (backTest ≠ original) → prevRow', () => {
		const inner  = makeInnerWithCoords(0, 100, 5, 100)
		// goDown → different position → VL1 middle
		const editor = makeEditorWithInner(inner, [{ line: 1, ch: 7 }])
		plugin.handleCellStartSnap(editor, 1, 5, 0, undefined)
		expect(editor.exec).toHaveBeenNthCalledWith(1, 'goDown')
		expect(editor.exec).toHaveBeenNthCalledWith(2, 'goUp')
		expect(plugin.setCursorToPrevRow).toHaveBeenCalledWith(editor, 0)
		expect(plugin.placeAtBottomVL).toHaveBeenCalledWith(editor)
	})

	// ===========================================================================
	// fallback: no inner view (activeCM === cm) → goDown probe directly
	// ===========================================================================

	it('no inner view (activeCM === cm) → goDown probe: VL2+ → goUp only', () => {
		// goDown → same position
		const editor = makeEditorWithoutInner([{ line: 1, ch: 5 }])
		plugin.handleCellStartSnap(editor, 1, 5, 0, 5)
		expect(editor.exec).toHaveBeenNthCalledWith(1, 'goDown')
		expect(editor.exec).toHaveBeenNthCalledWith(2, 'goUp')
		expect(plugin.setCursorToPrevRow).not.toHaveBeenCalled()
	})

	it('no inner view (activeCM === cm) → goDown probe: VL1 middle → prevRow', () => {
		// goDown → different position
		const editor = makeEditorWithoutInner([{ line: 1, ch: 7 }])
		plugin.handleCellStartSnap(editor, 1, 5, 0, 5)
		expect(editor.exec).toHaveBeenNthCalledWith(1, 'goDown')
		expect(editor.exec).toHaveBeenNthCalledWith(2, 'goUp')
		expect(plugin.setCursorToPrevRow).toHaveBeenCalledWith(editor, 0)
		expect(plugin.placeAtBottomVL).toHaveBeenCalledWith(editor)
	})
})
