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
