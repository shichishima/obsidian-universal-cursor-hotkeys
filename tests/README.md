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
| `moveCursorHomeInTable` | ⚙️ | ☑ | `setCursorViaCm` / `moveToLeftCellEnd` mocked — tests Standard/Advanced smart home within cells |
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
| `moveCursorDownInTable` | ⚙️ | ☑ | `goDown` result classified by post-move cursor position; CM6 visual-line state mocked via `getCursor` sequence |
| `moveCursorDownIntoTable` | 🚫 | ☐ | `goDown` crossing table boundary |

---

### Ctrl-B / Ctrl-F — cell boundary helpers

| Method | Testable | Tested | Notes |
|--------|----------|--------|-------|
| `moveToLeftCellEnd` | ⚙️ | ☑ | `getPrevRowLine` mocked; `setCursorViaCm` spied — tests `crossRowNavigation` OFF/ON branching |
| `moveToRightCellStart` | ⚙️ | ☑ | `getNextRowLine` mocked; `setCursorViaCm` spied — tests `crossRowNavigation` OFF/ON branching |

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

## Test file structure

### `linePosition.test.ts` — 167 tests

Tests `getBeginningOfLinePosition(line, ch)`.

**Settings matrix × line categories × rows.** Four settings modes are defined once and looped over all categories:

```
settingsMatrix
  Adv.          smartHomeStandard=true,  smartHomeAdvanced=true
  Std.          smartHomeStandard=true,  smartHomeAdvanced=false
  OFF (Adv=ON)  smartHomeStandard=false, smartHomeAdvanced=true
  OFF (Adv=OFF) smartHomeStandard=false, smartHomeAdvanced=false
```

Each row is a tuple `[line, ch, advExpected, stdExpected, offExpected]`. A 2nd-step test (cursor at smart-home position → toggles to ch=0) is auto-generated unless `skipAutoStep2: true`.

To add a case: append a row to an existing category, or add a new category object.

---

### `rowNavigation.test.ts` — 15 tests

Tests `computePrevRowLine` and `computeNextRowLine`.

**Tuple arrays, one `it` per row.**

```typescript
// computePrevRowLine: [prevLineInTable, prevLineText, expected]
[true, '| --- |', 3]   // delimiter → skip 2 lines
[true, '|     |', 4]   // spaces-only: NOT a delimiter

// computeNextRowLine: [nextLineInTable, nextLineText, lineAfterNextInTable, expected]
[true, '| --- |', true,  7]   // delimiter + row exists → skip 2
[true, '| --- |', false, -1]  // header-only table → no target
```

---

### `tableHelpers.test.ts` — 27 tests

Tests cell-level helpers: `TABLE_DELIMITER_REGEX`, `getCellBounds`, `getStartOfCellContent`, `getEndOfCellContent`, `getPipePositions`, `getRightmostCellIndex`, `getCellIndex`, `getEndOfCellContentByCellIndex`, `getInCellLineInfo`.

**Key design:** `getStartOfCellContent` and `getEndOfCellContent` share a single tuple table — same input, both outputs verified in one `it`:

```typescript
// [line, ch, expectedStart, expectedEnd]
['| hello |', 3, 2, 7]   // normal cell
['|     |',   3, 1, 1]   // isEmpty: start === end
```

`getInCellLineInfo` uses individual `it` blocks because it returns a struct.

---

### `moveCursorEndNonTable.test.ts` — 20 tests

Tests `moveCursorEndNonTable` (Ctrl-E / End, non-table context).

**Scenario matrix with `vlTrue` / `vlFalse` columns.** Each row defines a scenario and its expected outcome under both `visualLineMovement` values. The runner iterates `[vl=true, vl=false]` for every row:

```typescript
type EndRow = {
  desc: string
  cm?:  { vlHead, vlAssoc, currentHead, cursorCh, lineText }
  noCm?: { line, ch }
  vlTrue:  { dispatch?, setCursor? }   // visualLineMovement: true
  vlFalse: { dispatch?, setCursor? }   // visualLineMovement: false
}
```

`dispatch: { head, assoc }` asserts `cm.dispatch` was called with that cursor. `dispatch: null` asserts it was **not** called. Same convention for `setCursor`.

Test names are auto-generated: `[vl=true] cm: cursor before VL end — dispatch to VL end`.

To add a scenario: append a row to `matrix` with both `vlTrue` and `vlFalse` outcomes filled in.

---

### `crossRowNavigation.test.ts` — 6 tests

Tests the `crossRowNavigation` setting branch in `moveToLeftCellEnd` and `moveToRightCellStart`.

**Test line:** `'| a | b |'` — 2 cells, pipes at ch 0 / 4 / 8, cell 0 start = 2, end = 3; cell 1 start = 6, end = 7.

`setCursorViaCm` is replaced with `vi.fn()`. `getPrevRowLine` / `getNextRowLine` are mocked where needed to isolate the setting branch from `isPositionInTable`.

| Scenario | crossRowNavigation | Expected |
|---|:---:|---|
| `moveToLeftCellEnd` — leftmost cell | OFF | `setCursorViaCm` not called |
| `moveToLeftCellEnd` — non-leftmost cell | OFF | called with left cell end (same row) |
| `moveToLeftCellEnd` — leftmost cell (data row) | ON | called with previous row rightmost cell end |
| `moveToRightCellStart` — rightmost cell | OFF | `setCursorViaCm` not called |
| `moveToRightCellStart` — non-rightmost cell | OFF | called with right cell start (same row) |
| `moveToRightCellStart` — rightmost cell (non-last row) | ON | called with next row leftmost cell start |

---

### `moveCursorHomeInTable.test.ts` — 11 tests

Tests `moveCursorHomeInTable` (Ctrl-A / Home, in-table context).

**Two-level matrix: cell line → rows per settings / cursor position.**
`setCursorViaCm` and `moveToLeftCellEnd` are replaced with `vi.fn()`.

Three cell lines are tested:

| Cell line | `startOfInCellLine` | smart home position |
|---|:---:|:---:|
| `\| plain \|` | ch 2 | — (no prefix) |
| `\| - item \|` | ch 2 (`-`) | ch 4 (`i`) — Standard |
| `\| # heading \|` | ch 2 (`#`) | ch 4 (`h`) — Advanced |

Each group covers the 3-step sequence where applicable:

- cursor past smart home → `setCursorViaCm` at smart home
- cursor at smart home → `setCursorViaCm` at `startOfInCellLine`
- cursor at `startOfInCellLine` → `moveToLeftCellEnd` called

To add a case: append a row to an existing group's `rows`, or add a new `Group` object.

---

### `moveCursorHomeNonTable.test.ts` — 23 tests

Tests `moveCursorHomeNonTable` (Ctrl-A / Home, non-table context).

**Same matrix pattern as `moveCursorEndNonTable`.** Each row covers one scenario across `vl=true` and `vl=false`:

```typescript
type HomeRow = {
  desc: string
  cm?:  { currentHead, lineFrom, vlStartHead, vlStartAssoc, lineText, cursorCh }
  noCm?: { lineText, ch }
  vlTrue:  { dispatch?, setCursor? }
  vlFalse: { dispatch?, setCursor? }
}
```

Cases in `matrix` cover: VL2+ dispatch (Case 1a), VL left-edge fallthrough (Case 1b), VL1 fallthrough (Case 2), heading 2-step toggle, and the footnote widget regression (vlCh=2 < lineSmartHomePos=6).

A separate `smartHomeStandard = false` describe block verifies that all positions collapse to ch=0 when smart home is disabled.

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

---

## `moveCursorDownInTable` — Ctrl-N (in-table)

CM6 visual-line state is simulated by controlling the `getCursor` return sequence before/after `exec('goDown')`.

### empty cell

- [x] Empty cell (`|  |`, cursor at content start) — no `goDown`, `setCursorToNextRow` called

### first / middle segment (`<br>`-separated cell)

- [x] `type=first` — `goDown` called once, `setCursorToNextRow` NOT called
- [x] `type=middle` — `goDown` called once, `setCursorToNextRow` NOT called

### pre-eoc check (cursor at/past eoc before goDown)

- [x] `type=single`, `ch=eoc` — no `goDown`, `setCursorToNextRow` called
- [x] `type=single`, `ch>eoc` — no `goDown`, `setCursorToNextRow` called
- [x] `type=last`, `ch=eoc` — no `goDown`, `setCursorToNextRow` called

### goDown exits to a different line

- [x] Lands on delimiter row — `setCursorToNextRow` called
- [x] Lands on normal (non-table) line — `setCursorToNextRow` NOT called

### goDown stays on same line — no-op (file-end table)

- [x] `type=single`, `ch` unchanged after `goDown` — `setCursorToNextRow` called
- [x] `type=last`, `ch` unchanged after `goDown` — `setCursorToNextRow` called

### goDown stays on same line — ch advances within cell (soft-wrap VL advance)

- [x] `type=single`, `ch` moves to `< eoc` — `setCursorToNextRow` NOT called
- [x] `type=last`, `ch` moves to `< eoc` — `setCursorToNextRow` NOT called

### goDown stays on same line — ch clips to eoc (VL_N indicator)

- [x] `ch` after `goDown` equals `eoc` — `setCursorToNextRow` called
- [x] `ch` after `goDown` exceeds `eoc` — `setCursorToNextRow` called
