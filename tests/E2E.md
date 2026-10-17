# E2E Tests

Located in `tests/e2e/` (wdio-obsidian-service). Run with `npm run test:e2e`.

- **Scope**: only what `tests/unit/` can't cover — real Obsidian/CM6
  behavior (selection handling, DOM/focus transitions, composition events).
- **Execution**:
  - `maxInstances: 1` — parallel Obsidian instances made table-entry
    assertions flaky (cell-focus reconciliation not settling in time).
  - All specs share one Obsidian instance (`specs` wrapped in one group in
    `wdio.conf.mts`, lightest-first order) instead of relaunching per file.
    Faster, somewhat less flaky — table-entry assertions can still
    intermittently fail, rate varies run to run.
- **Fixtures** (`vaults/smoke/*.md`): `# heading` + `-` bullet(s) + `---` +
  test content. Specs locate the first line after `---` at runtime, so the
  header can be edited freely without shifting a spec's hardcoded offsets.

## Implemented

### Plumbing

#### `smoke.e2e.ts`

Plugin loads, commands register.

### Multi-cursor

#### `multiCursorHome.e2e.ts`

HOME keeps every cursor independent (no collapse to one).

#### `multiCursorTableCrossing.e2e.ts`

DOWN across a table boundary: secondary-alone-crosses → dropped;
primary-crosses → collapses to one ("primary defines the view" policy).

- A table needs a blank line before it to be recognized as a table at all
  (confirmed via the CM6 syntax tree).

### Table navigation

#### `exitTableSmartHome.e2e.ts`

"Exit table below" lands on the Smart-Home position, not raw ch=0.

- Covers landing position only; the gj/gk flash fix is frame-level timing,
  left to manual verification.
- Originally shipped with two `browser.pause(3000)` calls. Retuned
  (2026-10-17): the first one (before entering the table) turned out
  unnecessary — removing it entirely passed 18/19 isolated runs, the one
  failure traced to the test machine itself losing focus mid-run (switching
  virtual desktops), not the spec. The second one (after
  `waitForInTableCell(true)`, before `table-exit-down`) IS genuinely
  load-bearing — zero pause there flaked in two independent batches (roughly
  half failures each) — but didn't need 3000ms: 10ms/100ms/1500ms all
  passed 6/6 in isolation. Replaced with a deterministic double
  `requestAnimationFrame` wait instead of a magic-number pause (confirmed
  just as reliable, 20/20 isolated runs, still red/green-catches the
  underlying fix). Unlike `undoInCellVLStale.e2e.ts` below, one of this
  spec's two waits is genuinely necessary — just not as a blind timeout.

#### `undoInCellVLStale.e2e.ts`

In a word-wrapped (long, single hard-line) table cell, double-click a
word on the first visual line → Ctrl-W → Cmd-Z → Ctrl-N stays in the same
cell instead of exiting to the (empty) cell below.

- Real bug, found by investigating a user report — reproduced first with
  the exact content copied from their own repro note (not kept as the
  fixture; later replaced with a minimal built-for-this-test table). An
  even earlier, `<br>`-created-sub-lines fixture did *not* reproduce it —
  plain soft-wrap within one hard line is the specific condition.
- Root cause: native `goDown`'s own convention, independent of this
  plugin — a selection collapses in place on the first Down press without
  also moving (confirmed with the plugin disabled entirely: Cmd-X, Cmd-Z,
  bare physical Down arrow, same result). Undo restores the original
  (non-empty) selection, so the immediately-following `goDown` just
  collapses it, which `moveCursorDownInTable`'s own "no visible movement
  = nothing below" fallback misread as hitting content end.
- `coordsAtPos` on a not-yet-focused table row resolves to wherever the
  table's own first row starts (same "whole unfocused table is one
  collapsed visual block" behavior already confirmed for `moveVertically`
  during Set-mark's own table-skip work) — reach a specific cell via real
  `table-cell-down`/`table-cell-right` navigation, not a direct coordinate
  click.
- Unlike most other table-entry-dependent specs here, this one needs no
  `browser.pause(...)` settle time at all — confirmed with 13+ isolated
  runs and repeated full-suite runs, zero flakes either way, roughly
  halving the suite's own total E2E time. Every step here acts on a
  position this plugin's own commands just produced synchronously,
  unlike specs that click/navigate into a freshly-opened file's table
  before anything has had a chance to render yet.

### IME

#### `imeComposition.e2e.ts`

HOME no-ops while composing, works normally once composition ends.

- Real IME composition isn't drivable via WDIO; sets
  `cm.inputState.composing` directly instead.

### Settings

#### `keyUpgradesToggle.e2e.ts`

Toggling a Key Upgrades row calls the real `hotkeyManager.setHotkeys`, not
just the settings UI's display state.

- `app.setting.openTabById()` never attaches its container to the live
  document here; appends it to `document.body` manually before clicking.

### Set-mark

#### `setMarkTableSkip.e2e.ts`

Set-mark + Ctrl-N across a table lands with the whole table inside the
region (never enters a cell). Also covers Ctrl-F/Ctrl-B and Alt-F/Alt-B
(same waypoints, approached horizontally/by word).

- For Ctrl-N: a hand-rolled "scan past the table" fallback turned out
  unnecessary — CM6's own `moveVertically` already treats an unfocused
  table as one visual line.
- For Ctrl-F/Ctrl-B: the opposite finding — `EditorView.moveByChar`
  operates on raw logical lines with no visual-block awareness, so it
  does *not* skip a table for free. A real scan
  (`findOffsetPastWholeTableHorizontal`) was needed and is exercised here.
- For Alt-F/Alt-B: word movement uses its own engine entirely
  (`word-segmentation.ts`, not a native CM6 primitive), but its existing
  per-range search function already reports "search reached a table row"
  as its own outcome, so this reuses the *same*
  `findOffsetPastWholeTableHorizontal` scan as Ctrl-F/Ctrl-B — no new
  table-detection logic needed. Word-granularity landings go one step
  further than the char-based test: the final word on the far side ends
  up selected too.

#### `setMarkMouseAndLeafChange.e2e.ts`

Plain click clears the mark; mouse drag arms it from the drag's own
selection; active-leaf-change always clears it.

- `new MouseEvent(...)` defaults `detail` to 0, which CM6 reads as a
  triple-click — needs `detail: 1` explicitly.
- `markActive` can leak between `it`s sharing one instance if an earlier
  assertion fails — each test resets it explicitly.
- Regression found+fixed here: a real mouse-drag selection's resulting
  range carries a native `goalColumn` of `-1` (not no-goal), which
  `moveVertically` trusted as a real pixel offset, landing every post-drag
  Ctrl-N/P at column 0. Fixed in `extendMarkVertically` by only trusting a
  non-negative `goalColumn`.

#### `setMarkEscapeKeydown.e2e.ts`

Native Escape (CM6's own `simplifySelection`) collapses the selection;
this plugin's own passive `keydown` listener clears `markActive` as a
side effect, so a later extend command does a plain move instead of
silently re-arming a new region.

- A bare-ESC Key Upgrade (claiming the key globally via
  `app.hotkeyManager.setHotkeys`) was tried first and reverted — it broke
  Escape in non-CM6 contexts that rely on it natively (Excalidraw, the
  note title field's own deselect). The passive listener never calls
  `preventDefault`/`stopPropagation`, so native Escape handling everywhere
  is untouched.
- Dispatches a real `KeyboardEvent('keydown', { key: 'Escape' })` on
  `cm.contentDOM` (where CM6's own key handling lives), not a synthetic
  command call — confirms the event actually bubbles to this plugin's
  `document`-level listener.

#### `setMarkNativeClipboardAndDelete.e2e.ts`

Native copy/cut/paste/Backspace/Delete each clear `markActive` as a side
effect, same gap/fix shape as bare Escape above — none of these are this
plugin's own commands, so none would otherwise reach a command callback.

- Backspace/Delete clear unconditionally (same precedent as this plugin's
  own Delete char command), not only when a selection was actually
  present — confirmed via scratch testing that CM6's own contentDOM-level
  keymap handling for these two keys runs *before* any bubble-phase
  `document` listener, so a conditional check there would already see the
  post-deletion, collapsed selection. A capture-phase listener could read
  the pre-deletion state instead, but was judged not worth the extra
  complexity once the unconditional clear was confirmed to have no real
  downside.
- copy/cut/paste don't have that ordering problem — confirmed via scratch
  testing that CM6's own contentDOM-level handling for these three never
  calls `stopPropagation`, so a plain bubble-phase `document` listener
  reliably sees all of them after CM6's own handling completes, same as
  Escape.
- One line per case in the fixture
  (`SetMarkNativeClipboardAndDelete.md`), since cut/paste/Backspace/Delete
  are destructive — keeps an earlier test's edit from affecting a later
  one even if it persists across `openFixtureAndGetContentStart`'s
  fresh-leaf reopen.

## Planned, in priority order

1. Popout window support
2. Vim mode commands
