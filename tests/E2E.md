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

#### `uppercaseWordMultiCursor.e2e.ts`

Uppercase/Lowercase/Capitalize word's own multi-cursor rewrite
(`transformWordOrSelectionNonTable`/`InTableLP`, replacing the old
`transformWordNonTable`/`transformWordInTableLP`/`transformSelection`):
each range resolves its own selection-vs-word mode independently, rather
than the whole command deciding once based on primary alone.

- **(1) Mixed mode**: a range with a real selection and a range with a
  plain cursor both transform in the same dispatch — the core scenario
  this rewrite was for.
- **(2) Primary invalid, secondary still runs**: primary's own selection
  crossing a Source Mode table's cell boundary no longer blocks a valid
  secondary range — a real behavior change from the old single-cursor
  implementation (previously, an invalid primary made the whole command
  no-op). Requires genuine Source Mode, not just Live Preview's own
  `isTableLineSourceMode` heuristic skip — switched via
  `view.setState({...state, source: true}, {history: false})`, no prior
  precedent in this suite for forcing Source Mode, confirmed live via a
  scratch check before relying on it.
- **(3) Multiple selections in one cell**: dispatches two real ranges
  directly to the cell's own inner `EditorView` (`editor.activeCM`) via
  `require('@codemirror/state')`'s `EditorSelection` — no native command
  can add a second cursor inside a table cell yet (a separate, tracked
  idea), so this is the only way to drive a genuine multi-range selection
  there. **Confirmed live via `require` inside `executeObsidian`'s
  callback** — works because Obsidian's renderer has Node integration.
- **Found a real timing race, not just flakiness**: dispatching the
  cell's own multi-range selection immediately after `inTableCell`
  becomes `true` raced against Obsidian's own async cell-focus
  reconciliation, which can silently collapse the freshly-dispatched
  selection back down to one range before the following command reads
  it — confirmed via an instrumented poll (12/12 reproductions without a
  wait, 0/12 with one). Fixed with the same two-`requestAnimationFrame`
  settle wait this plugin's own code already uses elsewhere for the
  identical race (e.g. `exitCellWithSelection`).
- Full-suite runs this landed in also surfaced a batch of 9 unrelated
  failures (TOP/BOTTOM, Page Up/Down, checkbox landing, kill-region+undo)
  the first time it ran as part of the full suite — traced to the Mac
  having been idle long enough for the display to sleep (confirmed via
  `ioreg`'s `HIDIdleTime`, ~13.6 minutes with no physical input), not a
  real regression; all green once the machine was confirmed awake. Same
  class of false failure already documented above for other specs in
  this suite — check the machine's power state first for any sudden,
  broad batch of failures spanning unrelated commands.

#### `killYankMultiCursor.e2e.ts`

Kill Line/Kill Region/Kill Word/Copy Region/Yank's own multi-cursor
rewrite (`killLineOuter`/`killLineInTableLP`, `killRegion`/
`killRegionInTableLP`, `killWordOuter`/`killWordInTableLP`, `copyRegion`/
`copyRegionInTableLP`, `yankOuter`/`yankInTableLP`): each range
kills/copies/yanks independently, joined with `\n` into one shared
kill-cache entry (matching native Obsidian's own observed multi-cut
behavior), with Yank distributing one piece per cursor when the
clipboard's own line count matches the current cursor count. 5 scenarios
drive the real commands through the real system clipboard and real CM6
dispatch — something the unit test suite's own mocked clipboard/dispatch
can't truly verify.

- **(1)/(2) Kill region / Kill line round-trip (outer)**: two selections
  (or two points) killed together, then two other cursors Yank — each
  gets its own piece back, confirming the real clipboard write/read
  round-trip, not just the pure per-range logic.
- **(3) Cell word round-trip**: inside one table cell, Kill word at two
  positions, then Yank at the (position-shifted) same two spots —
  reconstructs the original cell text exactly byte-for-byte, the
  strongest possible confirmation that position remapping through a real
  `ChangeSet` behaves correctly end-to-end.
- **(4) Yank count mismatch**: clipboard line count doesn't match cursor
  count — duplicates the whole text at every cursor, confirming the
  fallback path (not just the common-case match).
- **(5) Outer kill → inner yank**: a multi-cursor Kill Region outside a
  table, then a multi-cursor Yank inside a table cell — confirms the
  kill-cache/clipboard contract actually bridges the outer/inner boundary
  (`yankOuter` and `yankInTableLP` are separate code paths; this is the
  one scenario that exercises both together).
- **Found the same class of flaky-test issue as `setMarkPageUpDown.e2e.ts`,
  not a dispatch-timing race**: scenarios (3)/(5) intermittently failed
  with `activeCM` reading back as the *outer* view entirely (not just a
  stale dispatch) — an instrumented 12-run batch traced this to
  `waitForInTableCell`'s own 2000ms default timeout occasionally being
  too tight under load (its own timeout is silently swallowed), not a
  race around the dispatch itself. Fixed by passing a longer timeout
  (`waitForInTableCell(true, 5000)`) to this helper for these two
  scenarios, matching the earlier `setMarkPageUpDown.e2e.ts` fix exactly
  — confirmed via log evidence before changing anything, per usual.

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
- **A table sitting directly at the document's own start/end, with no
  buffering blank line, used to leave `inTableCell` permanently stuck
  `true` after an in-cell extend** — found by the user after the above
  shipped. Root cause: the cell-exit mechanism's own throwaway collapse
  dispatch (see above) used the real target position (`0`/`doc.length`)
  as its landing spot, which — only when a table happens to occupy that
  exact boundary — is ALSO inside a table, so the "exit" itself lands
  back in table territory instead of safe plain text. The eventual
  selection's own anchor/head values turned out numerically correct
  either way (confirmed via direct comparison against the un-fixed
  code) — only `inTableCell` itself stayed wrongly stuck `true`. Fixed
  by landing the throwaway collapse one step past the table's own edge
  (`findOffsetPastWholeTableHorizontal`, the same scan this plugin's own
  horizontal-extend table-skip already uses) instead of directly on the
  real target.
  - Also investigated and ruled out as a real possibility before landing
    on this fix: whether a leading/trailing blank line is actually
    *required* for correct behavior here (as it would be for the
    equivalent native mouse-drag case — a plain mouse drag from inside a
    cell to the literal document boundary appears to hit the same kind
    of limitation, though that specific comparison wasn't conclusively
    verified via a reliable automated drag simulation). It isn't
    required for this plugin's own Set-mark extend — the fix above
    handles the no-blank-line case correctly on its own.
  - Two new tests added (table at the literal note start, TOP; table at
    the literal note end, BOTTOM), using `editor.setValue` on a
    dedicated fixture file each (not a shared one — reusing a fixture
    another spec also opens caused real cross-test corruption the first
    time this was tried: `setValue` on a shared file leaks into that
    file's next `openFixtureAndGetContentStart` within the same session,
    surfacing as a `"no --- separator found"` error in a totally
    unrelated, later-running spec).

#### `setMarkPageUpDown.e2e.ts`

Page Up/Down now extends the mark instead of collapsing/clearing it (see
`setMarkBufferEdge.e2e.ts`'s own note above — this was the "separate,
still-open design question" deferred from that increment).

- Policy, per the user's own breakdown: (1) outer source, outer landing —
  any table crossed along the way is swept in atomically, free via the
  same pixel-block mechanism Ctrl-N/P's own vertical extend already
  relies on; (2) outer source, landing inside a table — snaps past that
  table's own far edge (the one actually being passed through) instead of
  ending up focused inside a cell; (3) inner source (starting inside a
  cell) — the current table is swept in as a whole block (anchor snaps to
  its own back edge, same `findTableOwnEdge` convention as
  `setMarkBufferEdge.e2e.ts`), and the head still reaches the exact same
  spot a plain Page Down/Up from that same cell would (escaping a table
  consumes part of the page budget rather than adding extra distance on
  top of a full page — confirmed as the intended interpretation, not the
  alternative where exiting the table would restart a fresh page's worth
  of travel beyond it).
- Implementation reuses `scrollPage`'s own already-proven pixel-measurement/
  table-aware step logic unchanged, rather than reimplementing it as a
  pure function (not feasible — it depends on real rendered coordinates).
  `extendMarkPage` temporarily sets `markActive = false`, calls `scrollPage`
  to let it run its own plain-cursor branch, reads back the real settled
  landing via a new `onSettled` callback parameter added to `scrollPage`
  (reading any earlier risks catching a position Obsidian's own Live
  Preview normalizer is still mid-correcting), restores `markActive`, then
  applies the real extend as a separate, final dispatch — matching every
  other `extendMark*` command's own "this plugin's own dispatch, never
  `scrollPage`'s internal ones" convention.
- The "exit a cell while applying a selection that spans past it" mechanism
  from `setMarkBufferEdge.e2e.ts` (collapse to a safe throwaway position,
  `focusAfterCursorMove`, wait two RAF frames, then dispatch the real
  final selection) was extracted into a shared helper,
  `exitCellWithSelection`, now used by both that command's own in-cell
  branch and this one's "landed inside a table" branch. Verified as a
  pure, non-regressing refactor (`setMarkBufferEdge.e2e.ts` still 5/5
  before and after).
- **Multi-cursor is deliberately out of scope**, same simplification
  `setMarkBufferEdge.e2e.ts`'s own in-cell branch already makes. Checking
  the *plain* (non-mark) multi-cursor behavior first turned out to matter:
  the fast path (native `cursorPageUp`/`cursorPageDown`, no tables/
  callouts in view) already preserves multi-cursor correctly, but the
  slow path (`scrollPage`'s own step loop, used whenever a table/callout/
  embed is in view) collapses it — a real, pre-existing bug in that step
  loop's own Phase 4 LP-normalizer-correction dispatch (a single-range
  `{anchor, head}` object, not one range per cursor). The user ruled
  multi-cursor + Set-mark + table-crossing Page Up/Down a separate,
  accepted limitation rather than blocking this increment on fixing that
  pre-existing bug too.
- **Testing methodology**: Page Up/Down's landing position is a real pixel
  measurement against whatever height the viewport happens to be — not
  something to hardcode a line number for reliably across environments.
  Every test that cares where it actually landed measures a *plain*
  (non-mark) Page Down/Up from the same starting point first, on a freshly
  rebuilt identical document, then compares the marked version's own head
  against that measurement, rather than a fixed expected value.
- **An intermittent `waitUntil condition timed out after 2000ms` failure
  in the "inner source" test (roughly 1 in 10 runs) turned out not to be a
  bug**: instrumenting the failure to dump the actual live state at the
  moment of timeout showed the selection and `inTableCell` had *already*
  reached the exact correct final values — the settle itself was correct,
  just occasionally running past the 2000ms budget under load (dozens of
  isolated instrumented runs never exceeded ~500ms). Fixed by raising the
  budget to 5000ms for this test's own two `waitUntil` calls, not by
  changing any implementation code.

### Recenter

#### `recenterWithSetMark.e2e.ts`

A real bug found right after 0.12.0 shipped (2026-10-22), reported by the user
from real-machine usage: Recenter/Recenter top-bottom centered on the
Set-mark anchor (mark) instead of the actual cursor (head) whenever a real
selection was active.

- **Root cause**: `getCursorScreenY()`'s main-window branch read the browser's
  native `window.getSelection()` range via `sel.getRangeAt(0).getBoundingClientRect()`.
  That's correct for an empty (collapsed) selection, but once a real,
  non-empty selection exists, the native Range spans anchor..head — its
  bounding rect is the *union* box of the whole selection, not the head's own
  position. With a forward selection (anchor/mark above, head/cursor below on
  screen), the union box's own `.top` lands at the mark, not the cursor.
- Confirmed live before fixing (per this project's own "no implementation
  without log evidence" convention): Set-mark → extend 20 lines down →
  Recenter left `scrollTop` completely unchanged (the mark, already near the
  top, was judged as "no scroll needed"), with the real cursor measured via
  `coordsAtPos` sitting near the bottom of the viewport instead of centered.
- **Fix**: collapse to `sel.focusNode`/`sel.focusOffset` (the Selection API's
  own "where the caret end sits" properties, independent of anchor) before
  building the Range, rather than using whatever `getRangeAt(0)` already
  spans. The rest of the function's existing fallback chain (zero-height
  rect → `coordsAtPos` → element rect) is unchanged and still applies,
  since a collapsed-at-focus Range can hit the same zero-height case the
  already-collapsed (no-selection) case always could.
- Test measures a real scroll happened (`scrollTop` changes) and that the
  actual head lands within half a line of the viewport's vertical center,
  using `coordsAtPos` rather than a hardcoded expected pixel value (the exact
  center depends on the real rendered `clientHeight`).

### Add cursor

#### `addCursorAboveBelow.e2e.ts`

`addCursorOnView` (Add cursor above/below): a from-scratch reimplementation,
not a delegation to native Obsidian. Two separate findings about native's
own `editor:add-cursor-below`/`-above`, confirmed live via throwaway
diagnostics (not kept): (1) native steps by **logical line + character
column**, not visual (soft-wrapped) line/pixel goal-column — placing the
cursor mid-way through a long word-wrapped line and pressing `below` jumps
straight to the exact same character column on the *next logical line*,
skipping every remaining visual sub-line of the current one, unlike plain
arrow-key Down (and this plugin's own Ctrl-N/P), which are visual/pixel-
based. This is the *intended*, use-case-appropriate design for "add a
cursor per line to batch-edit several lines" (user-identified, not
assumed) — not a bug. (2) despite that correct design, native's own
line-index arithmetic has a genuine off-by-one bug, confirmed across
several different line lengths, that skips an extra logical line every
press (line 0 → 2 → 4, never landing on 1 or 3). This command
re-implements the intended behavior directly via CM6's own
`Text.lineAt`/`Text.line` (not `view.moveVertically` — an earlier
pixel-goal-column-based version was built, shipped, then replaced once this
distinction surfaced), with the target column clamped by **character
count** against the target line's own length. No memory of any "original"
column is kept across presses, by design — confirmed explicitly intended:
repeated presses aren't guaranteed to be consecutive, so remembering an
original intent across a clamp isn't a coherent idea the way a real
pixel-based goalColumn is for vertical motion; each press just clamps
whatever the current primary's own column actually is.

- **(1) Outer: character-column clamp + stacking, both directions**:
  through lines of alternating length, confirming the clamped character
  column from one press carries forward *as-is* into the next (no
  un-clamping/memory) — e.g. clamped to column 5 on a short line, the
  *next* press clamps that same 5 against the following line, not the
  original column.
- **(2) Inner: table cell real `<br>` sub-lines above/below + stacking +
  boundary**: uses a cell with two literal `<br>` separators (three real
  sub-lines) rather than a single word-wrapped line — under logical-line
  semantics a word-wrapped-only cell has no "next line" to step to at all
  (confirmed live: real multi-line table cells via `<br>` are a common
  case, not a rare one, so this is the scenario that actually matters).
  The cell's own first/last sub-line no-ops; otherwise stacks correctly up
  to the cell's own content end. **Found two real races along the way,
  both fixed in production code** (discovered during the earlier
  pixel-goal-column-based version, still apply unchanged to the current
  logical-line one since neither is about the step computation itself):
  a bare `userEvent: 'select'`-tagged dispatch into a table cell's own
  inner view silently lost the *oldest* range on the second+ press inside
  that cell (confirmed via a monkey-patched `dispatch` to inspect the real
  transaction a genuine Option/Alt-click sends when adding a cursor — it
  tags itself `select.pointer` and never loses a range; rewriting only the
  tag on an otherwise-identical dispatch reproduced the fix in isolation).
  `select.pointer` itself can't be reused (this file's own `updateListener`
  unconditionally forces `markActive` to the new main range's emptiness for
  that tag), but `select.uch` — this plugin's own existing tag for a
  programmatic selection-shape change — fixes the same loss and is already
  exempted from every `markActive` side effect that listener has. A
  *second*, separate race: any preceding command run against a table
  cell's own inner view (even a no-op `add-cursor-above`) can leave an
  async Obsidian-internal resync pending that clobbers whatever we
  dispatch next if it lands first — fixed by deferring the in-cell
  branch's whole body by 2 animation frames (same category as
  `exitCellWithSelection`'s own deferral elsewhere in this file), confirmed
  via instrumented diagnostic logging before implementing (dispatching
  immediately reproduced the loss on the very first add-cursor press after
  *any* preceding in-cell command, not just a prior add-cursor one).
  Because of this defer, the test itself must also wait 2 animation frames
  before reading the result after every in-cell add-cursor command.
- **(3) Set-mark interaction**: a newly added cursor joins a non-empty
  mark-extended selection as a fresh, not-yet-extended mark point
  (`anchor === head`) without touching the existing selection or
  `markActive` — the next Ctrl-N/P then extends *both* ranges in one
  dispatch, confirmed end-to-end (not just unit-mocked), since
  `extendMarkVertically` already treats every range in the selection
  uniformly and needed no new code for this to work. (This scenario
  doesn't exercise the logical-line-vs-visual distinction at all — Ctrl-N/P
  itself stays visual/pixel-based, unchanged.)
- **(4) Outer: buffer end boundary**: lands at the end of the buffer's own
  last line, no-ops on a second press. Only the END direction is tested at
  a real buffer edge — every fixture in this suite carries a heading +
  description block above its own `---` separator, so "the first line
  after `---`" is never genuinely the whole document's own first line, and
  a true "nothing above at all" case can't be built from the shared
  `openFixtureAndGetContentStart` helper. The START direction's own no-op
  guard is the identical code path regardless of direction, already
  covered by the unit test suite.
- **A trailing newline at the fixture's own end mattered**: with one, CM6
  sees an extra, empty final logical line past "last line of this
  document", so `add-cursor-below` correctly moves into *that* line
  instead of no-opping — confirmed live, fixed by saving the fixture
  without a trailing newline.
- **Intermittent table-entry flakiness, same class already documented
  above for `setMarkPageUpDown.e2e.ts`**: `waitForInTableCell(true)`
  confirms the flag flipped, but the landing dispatch itself can still race
  ahead of Obsidian's own table-widget rendering settling — fixed with the
  same double-rAF wait `exitTableSmartHome.e2e.ts` already established for
  this exact race, applied once right after `waitForInTableCell` in this
  spec's scenario (2).

### Vim motions

#### `vimJkGgGjGk.e2e.ts`

First real-Obsidian coverage for any Vim motion this plugin overrides —
every existing unit test for these (`vimMoveByLinesInCell.test.ts`,
`vimMoveByDisplayLinesInCell.test.ts`, etc.) mocks CM6 entirely. Covers the
"Priority 1" slice of Vim motion upgrades: `j`/`k`, `gj`/`gk`, `gg`/`G`, `$`
sticky goal — all scoped to table-crossing/table-cell behavior (outside
tables these are vanilla codemirror-vim, unmodified).

- **(1)** `j` crossing outer text → table header row → data row → outer
  text again, column preserved throughout.
- **(2)** `gj`/`gk` moving through a cell's own real `<br>`-separated
  sub-lines, then crossing the row boundary (one more `gk` from the cell's
  first sub-line lands in the row above — same convention as plain `k`).
- **(3)** `gg`/`G` reaching the real document's first/last line.
- **(4)** `$`'s sticky goal surviving a `j` that crosses a table row,
  landing at each cell's own content end (not a fixed raw `ch`).
- **A real gotcha hit while writing this suite, not a plugin bug**: every
  table fixture here needs a blank line before it. Without one (even with
  a heading, not just plain prose, directly above), Obsidian's Live Preview
  table widget silently does not render at all — confirmed by querying for
  `.cm-table-widget` elements in the live DOM. Skipping that blank line
  looks exactly like "vim's own `j` can't enter a table" (cursor frozen,
  zero movement, repeatable across longer pauses and repeated presses, not
  a timing issue) when the real problem is "there's no table to enter."
  Caught before writing any real assertions, not after.
- **Column assertions read live content instead of hardcoding `ch`
  numbers**: Obsidian's own table auto-formatter can rewrite a fixture's
  column padding on disk the first time its table is rendered/touched —
  confirmed live, the same table read back with different padding across
  separate fresh-file-open runs within the same suite run. Assertions
  either check cell *content* (`.toContain`) or compare a column position
  against a value captured live at the start of that same test, never a
  literal number.
- **A real, still-unresolved cross-spec flakiness, found 2026-10-23**:
  test (1)'s final column-preservation assertion passes reliably
  standalone but deterministically reads a wrong value when run as part
  of the full suite — some state from an earlier spec leaks in and
  corrupts the goal column specifically on the table-exit step, landing
  at the end of the first word on the destination line instead of the
  real preserved column. Ruled out: stale `vim.lastHPos` at the *start*
  of the chain (confirmed via diagnostic logging that it reads correctly
  even immediately before the real chain begins, with or without a
  `j`-then-`k` reseed first) — the leak happens later, specific to
  crossing out of the table. Not yet root-caused; documented inline at
  the assertion itself rather than fixed or skipped. Full writeup in the
  assistant's own memory (`project_vim_e2e_cross_spec_column_leak`).

#### `vimWordMotions.e2e.ts`

Priority-2 Vim motion coverage: `w`/`b`/`e` (and by extension `W`/`B`/`E`/
`ge`/`gE`, which share the exact same `moveByWords` override, distinguished
only by `motionArgs`) — scoped to table-crossing/CJK behavior, the same
"first real-Obsidian coverage" rationale as the Priority-1 suite above.

- **(1)** `w` crossing a cell's own real `<br>`-separated sub-lines, then
  the adjacent cell (same row), then the next row's first cell, then
  exiting the table entirely from its last cell.
- **(2)** `b` crossing the identical boundaries backward.
- **(3)** `e` landing on a word's own *end* character, not its start.
- **(4)** `w` through a CJK cell uses real dictionary-based segmentation
  (`日本語の文章です` stops partway through, at `の` — a script-boundary-
  only classifier would instead treat the whole run as one word and skip
  straight past it).
- Unlike Priority 1's own `moveByLines` override, `moveByWords` has **no
  "entering a table from plain text" handling at all** — confirmed by
  reading `vim-support.ts` directly: `scheduleWordCrossing` is only
  triggered `if (... editorNow?.inTableCell)`, i.e. only when *already*
  inside a cell and hitting its boundary (crossing to the adjacent cell/
  row, or exiting the table). Every test here accordingly starts already
  positioned inside a cell, rather than testing entry from outer text (not
  a gap in this suite — it reflects a real, deliberate scope cut in the
  implementation itself, matching this plugin's own documented "vim's
  own word-motion behavior" framing, which only ever describes the *exit*
  direction).
- No table-rendering mistake this time (the Priority-1 lesson was applied
  up front: every table fixture here has its blank line from the start) —
  confirmed once via the same `.cm-table-widget` DOM query before writing
  any real assertions, not caught after the fact a second time.

#### `vimCaretJoinChar.e2e.ts`

Priority-3 Vim motion coverage: `h`/`l`/`x` (grapheme-aware, cell-boundary
clamped), `^`/`I` (Smart home reuse), `J` (Smart join reuse).

- **(1)/(2)** `l`/`x` step over a whole emoji grapheme (2 UTF-16 surrogate
  units) as one move/one deletion, never landing or leaving a leftover
  mid-character — confirmed by checking the resulting character at the
  cursor, not a hardcoded string length (this table's own column padding
  can shift once an earlier test in the same spec file has touched it,
  same gotcha as `vimJkGgGjGk.e2e.ts`). `l` also crosses the cell boundary
  correctly at the cell's own true last character, then the row, then
  exits the table — the same shape already confirmed for `w` above, now
  confirmed for `l` too.
- **(3)** `^` reuses Smart home's own content-start logic (skips a leading
  checkbox marker). **A real WebDriverIO gap, not a plugin bug**: `browser
  .keys(['^'])` does not reliably reach codemirror-vim's own keymap for
  this specific shifted-digit character — confirmed live (stayed
  completely motionless from an unambiguous starting position, tried
  twice). A synthetic `keydown` with the correct `key`/`code`/`shiftKey`
  triple (`key: '^', code: 'Digit6', shiftKey: true`) works correctly —
  used instead.
- **(4)** `J` with Smart join turned on strips the next line's list marker
  (`- `) instead of vim's own default whitespace-only join, still
  inserting the usual single space. Smart join defaults to **off** in
  this plugin's own settings — the test flips it on, asserts, then
  restores it to off in a `finally` block regardless of outcome (shared
  Obsidian instance across the rest of the suite).

**Not yet covered** (deferred to later increments, see the user's own
4-tier priority breakdown from 2026-10-22): the leader-key table-structure/
table-navigation commands (`<leader>t...`) — the last tier.

1. Popout window support
