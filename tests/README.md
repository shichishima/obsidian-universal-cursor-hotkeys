# Test Checklist

## Structure of `main.ts`

Legend: ✅ unit-testable · ⚙️ testable with editor mock · 🚫 requires Obsidian runtime · Tested: ☑ implemented · ☐ not yet

### Constants

| Symbol | Testable | Tested | Notes |
|--------|----------|--------|-------|
| `CELL_SEPARATOR_REGEX` | ✅ | ☑ | Pure regex; tested indirectly via `getPipePositions` |
| `TABLE_DELIMITER_REGEX` | ✅ | ☑ | Pure regex; direct pattern tests |

---

### Lifecycle

| Method | Testable | Tested | Notes |
|--------|----------|--------|-------|
| `onload()` | 🚫 | ☐ | Registers commands via Obsidian `Plugin` API |
| `onunload()` | 🚫 | ☐ | Obsidian lifecycle hook |

---

### Entry points — Ctrl-A / Ctrl-E / Ctrl-B / Ctrl-F

These methods branch on `isLivePreviewMode()` + `isPositionInTable()`, both of which require
the Obsidian runtime. They are not directly unit-testable; each branch delegates to a
dedicated helper that is tested separately.

| Method | Testable | Tested | Notes |
|--------|----------|--------|-------|
| `moveCursorHome` | 🚫 | ☐ | Dispatches to `moveCursorHomeInTable` or `moveCursorHomeNonTable` |
| `moveCursorEnd` | 🚫 | ☐ | Dispatches to `moveCursorEndInTable` or `moveCursorEndNonTable` |
| `moveCursorLeft` | 🚫 | ☐ | Inline table/non-table branch |
| `moveCursorRight` | 🚫 | ☐ | Inline table/non-table branch |

---

### Ctrl-A / Ctrl-E helpers

| Method | Testable | Tested | Notes |
|--------|----------|--------|-------|
| `moveCursorHomeInTable` | 🚫 | ☐ | Calls `isPositionInTable`, `setCursorViaCm`, `moveToLeftCellEnd` |
| `moveCursorHomeNonTable` | ✅ | ☑ | CM6 `moveToLineBoundary` + smart home; fully mockable |
| `moveCursorEndInTable` | 🚫 | ☐ | Calls `isPositionInTable`, `setCursorViaCm`, `moveToRightCellStart` |
| `moveCursorEndNonTable` | ✅ | ☑ | CM6 `moveToLineBoundary` + logical line end; fully mockable |

---

### Entry points — Ctrl-P / Ctrl-N

| Method | Testable | Tested | Notes |
|--------|----------|--------|-------|
| `moveCursorUp` | 🚫 | ☐ | Branches on `isLivePreviewMode` + `isPositionInTable` |
| `moveCursorDown` | 🚫 | ☐ | Branches on `isLivePreviewMode` + `isPositionInTable` |

---

### Ctrl-P / Ctrl-N — in-table helpers

These methods call `editor.exec('goUp/goDown')` and rely on CM6's visual-line model,
which cannot be reproduced without the Obsidian/CodeMirror rendering pipeline.

| Method | Testable | Tested | Notes |
|--------|----------|--------|-------|
| `moveCursorUpInTable` | 🚫 | ☐ | `goRight` / `goLeft` / `goUp` + CM6 visual-line state |
| `moveCursorUpIntoTable` | 🚫 | ☐ | `goUp` crossing table boundary |
| `moveCursorDownInTable` | 🚫 | ☐ | `goDown` + CM6 visual-line state |
| `moveCursorDownIntoTable` | 🚫 | ☐ | `goDown` crossing table boundary |

---

### Ctrl-B / Ctrl-F — cell boundary helpers

| Method | Testable | Tested | Notes |
|--------|----------|--------|-------|
| `moveToLeftCellEnd` | 🚫 | ☐ | Calls `isPositionInTable` via `getPrevRowLine` |
| `moveToRightCellStart` | 🚫 | ☐ | Calls `isPositionInTable` via `getNextRowLine` and `setCursorViaCm` |

---

### Table row navigation

`getPrevRowLine` and `getNextRowLine` call `isPositionInTable`, which requires the CM6
syntax tree. They can be tested with a mock editor that stubs `isPositionInTable`'s
inputs, but require some setup.

| Method | Testable | Tested | Notes |
|--------|----------|--------|-------|
| `computePrevRowLine` | ✅ | ☑ | Pure: `(currentLine, prevLineInTable, prevLineText)` → target line |
| `computeNextRowLine` | ✅ | ☑ | Pure: `(currentLine, nextLineInTable, nextLineText, lineAfterNextInTable)` → target line |
| `getPrevRowLine` | 🚫 | ☐ | Thin wrapper; calls `isPositionInTable` (syntax tree) |
| `getNextRowLine` | 🚫 | ☐ | Thin wrapper; calls `isPositionInTable` (syntax tree) |
| `setCursorToPrevRow` | 🚫 | ☐ | Calls `getPrevRowLine` + `setCursorViaCm` (needs `cm`) |
| `setCursorToNextRow` | 🚫 | ☐ | Same |

---

### Ctrl-P / Ctrl-N — deeper helpers

| Method | Testable | Tested | Notes |
|--------|----------|--------|-------|
| `handleCellStartSnap` | 🚫 | ☐ | `goDown` / `goUp` + CM6 visual-line state |
| `scheduleBottomVisualLine` | 🚫 | ☐ | `setTimeout` + `isPositionInTable` |
| `moveToBottomVisualLineOfCell` | 🚫 | ☐ | `goRight` / `goDown` loop + CM6 visual-line state |

---

### Cell content position helpers — pure string functions

All of these take `(line: string, ch: number)` and return a number.
No editor object is needed; they are fully unit-testable.

| Method | Testable | Tested | Notes |
|--------|----------|--------|-------|
| `getInCellLineInfo` | ✅ | ☑ | `<br>`-aware in-cell line segmentation |
| `getCellBounds` | ✅ | ☑ | Open/close pipe detection |
| `getStartOfCellContent` | ✅ | ☑ | First non-space after open pipe |
| `getEndOfCellContent` | ✅ | ☑ | Last non-space before close pipe |
| `getEndOfCellContentByCellIndex` | ✅ | ☑ | Same, addressed by cell index |
| `getRightmostCellIndex` | ✅ | ☑ | Pipe count → rightmost index |

---

### Cell index helpers

| Method | Testable | Tested | Notes |
|--------|----------|--------|-------|
| `getCellIndex` | ✅ | ☑ | Pure string operation |
| `getChByCellIndex` | ⚙️ | ☐ | Needs `editor.getLine` mock (trivial) |

---

### Infrastructure

| Method | Testable | Tested | Notes |
|--------|----------|--------|-------|
| `isPositionInTable` | 🚫 | ☐ | CM6 `syntaxTree` + offset resolution |
| `setCursorViaCm` | 🚫 | ☐ | `cm.dispatch` + `cm.focus` (DOM) |
| `isLivePreviewMode` | 🚫 | ☐ | `app.workspace.getActiveViewOfType` |
| `getBeginningOfLinePosition` | ✅ | ☑ | Pure string → smart home position |
| `getPipePositions` | ✅ | ☑ | Pure regex over string |

---

## Test checklist

Unit-testable items not yet covered by an automated test.
Items already covered by `tests/*.test.ts` are checked.

---

## `moveCursorHomeNonTable` — Ctrl-A / Home (non-table)

### cm available

- [x] Case (1a): cursor on VL2+ non-left-edge — calls `moveToLineBoundary(main, false, true)`
- [x] Case (1a): dispatches `EditorSelection.create` with assoc preserved
- [x] Case (1a): `goRight` / `goLeft` are not called
- [x] Case (1a): `setCursor` is not called
- [x] Case (1b)/(2): already at VL left edge — falls through to smart home
- [x] Case (1b)/(2): VL1 (`vlCh === 0`) — falls through to smart home
- [x] Case (1b)/(2): heading line (`## hello`) — moves to content start (after `## `)
- [x] Case (1b)/(2): `dispatch` is not called

### cm absent (fallback)

- [x] Plain text — moves to ch=0
- [x] Heading line — moves to content start
- [x] Already at line start (ch=0) — `setCursor` is still called with ch=0

---

## `moveCursorEndNonTable` — Ctrl-E / End (non-table)

### cm available

- [x] Calls `moveToLineBoundary(main, true, true)`
- [x] Plain text — dispatches with correct `head` and `assoc`
- [x] Soft-wrap VL1 end — dispatches with `assoc=-1` preserved
- [x] Hidden markdown at line end (e.g. `[[link]]`) — dispatches with `assoc=0`
- [x] Already at VL end — falls through; `setCursor` moves to logical line end (2-step)
- [x] `setCursor` is not called in the normal (non-fallthrough) case

### cm absent (fallback)

- [x] Cursor in the middle — `setCursor` moves to line end
- [x] Cursor at line start (ch=0) — `setCursor` moves to line end
- [x] Cursor already at line end — `setCursor` is not called
- [x] Empty line — `setCursor` is not called
- [x] Multibyte characters — `setCursor` moves to correct line end

---

## `getPipePositions(line)`

- [x] Row with multiple pipes `| a | b | c |` — returns correct indices
- [x] Escaped pipe `\|` is excluded
- [x] Line with no pipes — returns `[]`

---

## `TABLE_DELIMITER_REGEX`

- [x] `| --- |` — matches
- [x] `| :---: |` — matches
- [x] `| :--- |` and `| ---: |` — match
- [x] `| - |` (single dash) — matches
- [x] `|     |` (spaces only) — does **not** match (regression: was wrongly matching before fix)
- [x] `| abc |` (text content) — does not match

---

## `getCellBounds(line, ch)`

- [x] ch inside a cell — returns correct `{ open, close }`
- [x] ch exactly on a pipe — treated as the right edge of the left cell (`p >= ch` fix)
- [x] ch before any pipe — returns `null`
- [x] Escaped pipe `\|` does not act as a cell boundary

---

## `getStartOfCellContent(line, ch)` / `getEndOfCellContent(line, ch)`

- [x] Normal cell `| hello |` — correct start / end positions
- [x] Leading spaces `|  hello |` — start skips leading spaces
- [x] Trailing spaces `| hello  |` — end trims trailing spaces
- [x] Spaces-only cell `|     |` — `start === end` (isEmpty), regression for delimiter misdetection bug
- [x] Empty cell `||` — `start === end`
- [x] ch on closing pipe — pipe not included in content slice (regression: `p >= ch` fix)

---

## `getEndOfCellContentByCellIndex(line, cellIndex)`

- [x] Valid index — returns correct end position
- [x] Out-of-range index — returns `-1`

---

## `getRightmostCellIndex(line)`

- [x] `| a | b | c |` — returns `2`
- [x] Single cell `| a |` — returns `0`

---

## `getCellIndex(line, ch)`

- [x] ch in first cell — returns `0`
- [x] ch in second cell — returns `1`
- [x] ch before any pipe — returns `0` (clamped)

---

## `getBeginningOfLinePosition(line, ch)`

- [x] Heading `## hello`, ch past prefix — returns index after `## `
- [x] Heading in unordered list `- ## hello` — returns index after `- ## `
- [x] Ordered list `1. item` — returns index after `1. `
- [x] Unordered list `- item` — returns index after `- `
- [x] Task list `- [ ] item` — returns index after `- [ ] `
- [x] Blockquote `> text` — returns index after `> `
- [x] Footnote `[^1]: note` — returns index after `[^1]: `
- [x] Plain text — returns `0`
- [x] Already at smart-home position — returns `0` (2-step toggle to absolute start)

---

## `getInCellLineInfo(line, ch)`

- [x] No `<br>` — `lineType: 'single'`, correct start/end
- [x] One `<br>`: ch in first segment — `lineType: 'first'`
- [x] One `<br>`: ch in last segment — `lineType: 'last'`
- [x] Two `<br>`: ch in middle segment — `lineType: 'middle'`
- [x] ch inside a `<br>` tag — assigned to preceding segment
- [x] Spaces-only segment — `isEmpty: true`

---

## `computePrevRowLine` / `computeNextRowLine`

### `computePrevRowLine(currentLine, prevLineInTable, prevLineText)`

- [x] `prevLineInTable: false` — returns `-1`
- [x] `prevLineInTable: true`, regular row — returns `currentLine - 1`
- [x] `prevLineInTable: true`, delimiter row (`| --- |`) — returns `currentLine - 2`
- [x] `prevLineInTable: true`, spaces-only `|     |` — treated as regular row, **not** delimiter (regression)

### `computeNextRowLine(currentLine, nextLineInTable, nextLineText, lineAfterNextInTable)`

- [x] `nextLineInTable: false` — returns `-1`
- [x] `nextLineInTable: true`, regular row — returns `currentLine + 1`
- [x] `nextLineInTable: true`, delimiter row, `lineAfterNextInTable: true` — returns `currentLine + 2`
- [x] `nextLineInTable: true`, delimiter row, `lineAfterNextInTable: false` (header-only table) — returns `-1`
- [x] `nextLineInTable: true`, spaces-only `|     |` — treated as regular row, **not** delimiter (regression)
