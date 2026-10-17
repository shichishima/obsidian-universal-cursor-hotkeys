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

#### `setMarkNativeCollapseClearing.e2e.ts`

Native physical cursor movement (bare arrow keys, Home/End, Page Up/Down,
...) clears `markActive` when it collapses an active selection — same
gap/fix shape as the two specs above, but with no fixed key list: every
one of `@codemirror/commands`' own plain-movement commands dispatches
through the same shared `setSel` helper, tagged `userEvent: "select"`
(confirmed by reading that source directly), so one check in the
`EditorView.updateListener` in `main.ts` covers all of them.

- This plugin's own extend/collapse dispatches (the 5 `extendMark*`
  functions, plus `collapseActiveSelectionToHead` shared by Set-mark's own
  re-press and Ctrl-G) use a more specific `"select.uch"` tag instead of
  bare `"select"`, specifically so the new rule can't misfire on them.
  Confirmed via scratch diagnostic logging that CM6 tags a native collapse
  and this plugin's own extend identically (both bare `"select"`) when
  they weren't yet distinguished by tag.
- Two of this plugin's own legitimate actions would otherwise have been
  wrongly caught by a plain "selection went non-empty -> empty" check, and
  are covered as explicit regression cases here: Set-mark's own re-press
  (`markActive` is set `true` *before* its own collapse-to-head dispatch
  collapses the prior selection to empty) and extending one way then back
  to the exact anchor (a real non-empty -> empty transition that's this
  plugin's own doing, not a native collapse). Confirmed both would
  genuinely fail without the `"select.uch"` tag distinction (temporarily
  reverted just the tag rename, kept the new rule active — both failed as
  expected; restored).
- Requiring an actual non-empty -> empty transition (not just "ended up
  empty") also deliberately leaves Set-mark's own still-empty state (armed
  right after Ctrl-Space but not yet extended) alone if a native key moves
  the bare cursor at that point — out of scope, not the gap that was
  reported.

#### `setMarkShiftArrowUnification.e2e.ts`

Shift+Arrow range-selection now arms `markActive` immediately, the same
way a mouse drag already does — unifying Shift+cursor selection with this
plugin's own Set-mark under one shared selection model. Before this, the
first Ctrl-B/F/N/P/A/E after a Shift-selection just collapsed it (matching
the universal "first press on an active selection collapses in place"
convention); only the second press moved, plainly.

- Shift+Arrow dispatches through `@codemirror/commands`' `extendSel`
  helper, tagged bare `userEvent: "select"` — the same family as plain
  movement and this plugin's own `"select.uch"`-tagged extends. The
  distinguishing signal (confirmed via scratch diagnostic logging, not
  kept) is the anchor: `extendSel` always preserves it while moving the
  head, while a plain arrow key collapsing an existing selection actually
  moves the anchor to meet the new head. Filtering to "anchor unchanged,
  resulting non-empty, tag is `select` but not `select.pointer`/
  `select.uch`" isolates exactly this case.
- Shrinking a Shift-selection back to empty (e.g. Shift+ArrowLeft after
  Shift+ArrowRight) correctly clears `markActive` too — no special
  handling needed, it's the same non-empty -> empty native collapse rule
  `setMarkNativeCollapseClearing.e2e.ts` above already covers (that rule
  doesn't check anchor, only the tag and the emptiness transition).
- Also covers a real false positive the anchor check alone would have
  missed: native `selectAll` (Ctrl-A/Cmd-A) always dispatches `anchor: 0,
  head: doc.length` under the same bare `"select"` tag — if the cursor
  already sat at position 0, "anchor unchanged" passes by coincidence
  (confirmed live before the fix: simulating that exact dispatch armed the
  mark). Fixed by excluding "the whole buffer, start to end" from the arm
  rule. This is a deliberate, narrow trade — a genuine Shift-Ctrl-End
  extend starting from position 0 in a short document is
  state-identical to `selectAll` and is sacrificed too (falls back to the
  older, still-correct collapse-first behavior there) — covered by a
  second case confirming the exclusion doesn't over-reach: the same
  extend from a non-zero position still arms correctly.
- A broader audit of every other range-selection mechanism (mouse
  double-/triple-click, Shift+Click, Shift+Home/End/PageUp/PageDown/
  Ctrl+Home/Ctrl+End) found no further gaps — all of them either already
  share the mouse-click/drag's own `"select.pointer"` tag (confirmed via
  reading `@codemirror/view`'s `MouseSelection.select()`: every mouse
  gesture, click/double/triple-click/drag/shift-click, dispatches through
  that one method unconditionally) or the same anchor-preserving
  `extendSel`/`"select"` shape as Shift+Arrow (confirmed via reading
  `@codemirror/commands` directly — `selectLineBoundaryBackward/Forward`,
  `selectPageUp/Down` all call `extendSel`; `selectDocStart/End` don't,
  but still pass the *prior* anchor through explicitly, so they still
  satisfy the same check). `selectAll` was the one exception that needed
  the explicit exclusion above.
- That audit covered native/mouse mechanisms reacting to this plugin's
  Set-mark; a follow-up question (does this plugin's *own* TOP/BOTTOM
  command correctly interact with an active mark) found one more real
  gap, fixed separately — see `setMarkBufferEdge.e2e.ts` below.

#### `setMarkBufferEdge.e2e.ts`

TOP/BOTTOM (`jumpToBufferEdge`) now extends to the buffer edge when the
mark is active, instead of silently leaving `markActive` stuck `true`
while jumping the selection to an unrelated position.

- Unlike every other command this plugin's own Set-mark extends, TOP/
  BOTTOM had no `markActive` check *at all*, and its own dispatch is
  tagged `"move"`, not `"select"` — invisible to the generic
  native-collapse-clearing rule too (that rule only watches `"select"`-
  tagged transactions). This was originally assumed safe ("just collapses
  harmlessly," per the 2026-10-16 planning note's own category B), but
  that assumption was wrong specifically for TOP/BOTTOM, since the
  resulting stuck-`true` `markActive` could cause a wildly wrong extend
  on the next Ctrl-B/F/N/P/A/E.
- Fixing it properly (extend, not just clear) was motivated by a real
  Emacs idiom: Set-mark at a note's own start, then BOTTOM, selects the
  whole note in two keystrokes.
- **User intent is always the real document edge, even from inside a
  table cell** — corrected after an initial implementation clamped to
  the cell's own content edge instead (reasoning that "buffer edge" has
  no meaning inside a cell's separate `EditorState`, same as every other
  in-cell extend command's own clamp policy). The user pointed out this
  doesn't match real usage: extending from inside a cell should exit the
  cell and reach the true document boundary, including the whole
  containing table in the result — the mirror case of Ctrl-N/P's own
  `moveVertically`-based extend, which already treats an unfocused table
  as one atomic block when crossing INTO it from outside.
- **The "whole table, atomic" policy also means the anchor can't stay at
  the exact character position Set-mark was pressed at in-cell** —
  spotted by the user after the first version of this fix shipped:
  marking inside a table's own last row, then BOTTOM, left the header
  and delimiter rows *above* the marked row out of the selection, only
  extending forward from that one exact spot. Fixed by snapping the
  anchor to the table's own far edge in the direction *opposite* the
  extend (`findTableOwnEdge` in `main.ts`) — BOTTOM snaps to the table's
  own first line, TOP to its own last line — so the whole table is swept
  in regardless of which row/cell inside it the mark was originally set.
- Reaching the real boundary from inside a cell requires actually exiting
  the cell to the outer view — a single CM6 range can't span the cell's
  own inner `EditorState` and the outer one at once. A direct
  dispatch-then-focus races against Obsidian's own async cell-exit
  reconciliation (confirmed live: moving DOM focus off a cell always
  eventually collapses whatever selection was in place back to a point,
  regardless of dispatch ordering). Fixed with the same "two frames of
  deferral" convention already used elsewhere in this codebase for
  cell-focus reconciliation (see `nudgeInnerViewVisible`'s own identical
  reasoning in `main.ts`): collapse to the target first, let that
  settle, then apply the real anchor/head in a second, later dispatch.
- **A macOS sleep/display-off state while running this suite produces
  misleading, deterministic-looking failures that are not a real bug**:
  this spec's in-cell test failed 100% of the time (not intermittently)
  with a *wrong anchor value* (not just a collapsed one) while the Mac
  was asleep/the display was off, and passed 100% of the time (14/14
  across two batches) once re-run with the machine actively awake.
  Electron's `requestAnimationFrame` throttling while not visible is the
  suspected mechanism — the two-frame deferral above assumes real frames
  actually fire promptly. If this test ever fails during unattended/
  overnight runs, check the machine's power state before assuming a
  regression.
- Page Up/Down's own interaction with an active mark was investigated at
  the same time and found to already work correctly via the existing
  generic native-collapse rule (confirmed live: a page-down while marked
  collapses and clears the mark, same as a bare arrow key) — no fix
  needed there. Whether Page Up/Down should instead *extend* the mark
  (and how to handle landing mid-table if so) is a separate, still-open
  design question, deliberately deferred.

## Planned, in priority order

1. Popout window support
2. Vim mode commands
