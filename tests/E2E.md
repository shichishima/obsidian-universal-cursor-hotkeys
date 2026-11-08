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
  - **Full-suite runs are de-prioritized by explicit user direction
    (2026-11-06)**: the suite's own runtime has grown long enough that a
    full run meaningfully increases exposure to a confirmed, unrelated
    source of flakiness — the test Electron window not being visible/
    foregrounded during an unattended run (see e.g.
    `propertyValueEditKillYank.e2e.ts`'s own section below for one
    documented instance). A short, targeted run (new spec(s) in
    isolation, then the directly affected regression set) occupies the
    foreground for much less time and is correspondingly far less likely
    to hit this — ensuring the test window actually has focus before a
    full run, and relying on targeted runs as the primary day-to-day
    confidence signal, produces BETTER overall quality than running the
    full suite reflexively after every small change. Reserve full-suite
    runs for less frequent checkpoints (e.g. before a multi-branch merge
    sequence wraps up), not as a per-commit gate.
  - `npm run test:e2e:popout` (`E2E_POPOUT=1`) reroutes every
    `openFixtureAndGetContentStart` call through one shared popout window
    instead of the main window, letting the whole existing suite run
    unmodified against a popout — for occasional manual sweeps, not a
    standing/permanent second pass (doubles runtime, most specs have no
    popout-sensitive code path). Surfaced one confirmed real bug (now fixed,
    see `setMarkPopoutNativeClearing.e2e.ts` below) and one test-infra
    limitation: `setMarkMouseAndLeafChange.e2e.ts`'s own `browser.execute`-
    based `mouseGesture` helper throws `__name is not defined` against a
    popout window — looks like an esbuild/`wdio-obsidian-service` helper-
    injection gap specific to secondary windows, not a plugin bug; those 3
    mouse-based tests can't be verified this way.
- **Fixtures** (`vaults/smoke/*.md`): `# heading` + `-` bullet(s) + `---` +
  test content. Specs locate the first line after `---` at runtime, so the
  header can be edited freely without shifting a spec's hardcoded offsets.

## Implemented

### Plumbing

#### `smoke.e2e.ts`

Plugin loads, commands register.

#### `scopeReconciliation.e2e.ts`

A real concern raised about `propertyRowScope`/`titleScope` (0.13.0
Feature 1's own custom Scope-push mechanism): both are pushed/popped
PURELY by `focusin`/`focusout` (see `registerWindowDomListeners`) —
nothing anywhere forces a pop independent of that pair actually firing
in the expected order. If a stuck scope ever sat permanently on top of
`app.keymap`'s own window stack, EVERY hotkey (not just this plugin's
own) would be affected — confirmed from first principles (see
`project_property_name_edit_scope_dispatch_bug`'s own "Scope-push beats
global command resolution; only the TOP scope is ever consulted"
finding): a stuck custom Scope on top means the dispatcher never even
reaches Obsidian's own global command resolution for anything that
Scope doesn't explicitly register, since a non-`false` return defers to
NATIVE handling directly, not to a lower scope.

Live testing across five real switching scenarios — a same-leaf
`openFile`, repeated rapid switches across widget types (text/pill/
multi-select-input) in a loop, a REAL file-explorer click, switching
away from a Bases cell-selection-mode view, and switching ACTIVE LEAF
to an already-open split (never destroying the first leaf's own DOM at
all) — could NOT reproduce a stuck scope; `focusout` fired correctly
and popped cleanly in every one. Since a genuinely stuck scope
requires `focusout` to NOT fire at all, which can't be forced via any
real, browser-faithful focus change (any real focus change fires it),
this spec tests the safety net directly instead of the exact
real-world trigger: manually puts `propertyRowScope` into the precise
"stuck" state (re-pushed onto the real Keymap stack and reassigned on
the plugin instance, with `document.activeElement` already pointing
elsewhere) and confirms `reconcileScopesWithFocus()` — wired to both
`active-leaf-change` and `file-open` (file-open specifically covers
opening a new file into the leaf that's ALREADY active, which
`active-leaf-change` alone does NOT fire for, confirmed live) — pops
and clears it.

- **(1)** The stuck-scope state is cleaned up.
- **(2)** Regression: firing `file-open` for an UNRELATED second leaf
  does not tear down a different leaf's own genuinely-still-valid,
  currently-focused `propertyRowScope` — confirms the reconciler
  checks the right document/window's own `activeElement`, not a global
  "any scope exists" check that would be too aggressive.

Built red-green: temporarily removing the `active-leaf-change`/
`file-open` listeners reproduces test (1) failing (the manually-stuck
scope stays stuck forever), restoring them makes both pass.

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

- Real bug, found via live testing — reproduced first with the exact
  content copied from the original repro note (not kept as the
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

#### `setMarkPopoutNativeClearing.e2e.ts`

Same 5 native events as `setMarkNativeClipboardAndDelete.e2e.ts` above, plus
Escape, dispatched inside a real popout window — regression coverage for a
confirmed real bug found via an `E2E_POPOUT` full-suite sweep: `main.ts`'s
markActive-clearing listeners (copy/cut/paste/Backspace/Delete/Escape, now
`registerWindowDomListeners`) were registered once against the main
window's own `document` at plugin load time, so a popout window's own,
separate `document` never got the same listeners — none of these native
actions cleared `markActive` while editing inside a popout. Fixed by
re-registering the same listeners on every window as it opens
(`app.workspace.on('window-open', ...)`).

- Doesn't need `E2E_POPOUT=1` — always runs, opening its own popout
  directly via the newly-exported `openFixtureInPopoutAndGetContentStart`
  regardless of that env var, then closing it in `after` (`closePopoutWindow`,
  which switches back to the main window) so later specs in this suite's
  own shared instance aren't left running against a stale popout.
- A freshly-created popout leaf's view mode isn't guaranteed to be Live
  Preview without an explicit view state — confirmed live via a screenshot
  showing the file menu's own "Source mode" item checked. Fixed inside
  `openFixtureInPopoutAndGetContentStart` itself by passing
  `{ state: { mode: 'source', source: false } }` to `openFile`.
- One line per case in the fixture (`SetMarkPopoutNativeClearing.md`), same
  reasoning as the main-window version above.

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
  in-cell extend command's own clamp policy). That doesn't match real
  usage: extending from inside a cell should exit the
  cell and reach the true document boundary, including the whole
  containing table in the result — the mirror case of Ctrl-N/P's own
  `moveVertically`-based extend, which already treats an unfocused table
  as one atomic block when crossing INTO it from outside.
- **The "whole table, atomic" policy also means the anchor can't stay at
  the exact character position Set-mark was pressed at in-cell** —
  spotted after the first version of this fix shipped:
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
  `true` after an in-cell extend** — found after the above
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

- Policy: (1) outer source, outer landing —
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

#### `setMarkClearingGaps.e2e.ts`

Three real gaps found by auditing every command against real Emacs's own
`deactivate-mark` convention (transient-mark-mode deactivates the mark after
virtually any command unless it explicitly opts out) — not assumed,
cross-checked against this plugin's own source for each command, then
confirmed live before fixing (per the project's own "no implementation
without log evidence" rule).

- **Kill line previously left `markActive` armed**: unlike Kill region/Copy
  region/Yank (which already clear it), Kill line's own implementation
  never referenced `markActive` at all. Root cause: Kill line never looks
  at the current selection's extent in the first place (real `kill-line`
  always kills from point to end of line, selection or not), so the
  original Category A design ("clear mark for commands that *consume the
  selection*") never flagged it — but real Emacs still deactivates the mark
  as a side effect of kill-line regardless, since that's the *default* for
  virtually every editing command, not something tied to whether a
  selection existed. Fixed by clearing unconditionally at the top of
  `killLine`, matching Delete char/Transpose chars/Kill word's own pattern.
- **Move to cell left/right/above/below and Exit table above/below (6
  commands, shared `table-navigation.ts` implementation) previously left a
  "zombie" armed mark**: confirmed live via a scratch diagnostic (captured
  `markActive` and the inner view's own selection before/after) that these
  commands collapse an active selection via plain `Editor.setCursor()`, not
  a CM6 transaction tagged `"select"` — so the existing generic
  native-collapse-clearing listener (`setMarkNativeCollapseClearing.e2e.ts`)
  never catches it. The very next extend command (e.g. Ctrl-F) then
  silently started a *new* region from the cell just landed on, instead of
  just moving. These are plain point-movement commands, not part of the
  Set-mark extend family, so they now clear `markActive` unconditionally at
  each command's own top level in `main.ts` (not inside the shared
  `table-navigation.ts`, which stays markActive-unaware by design — see its
  own file header comment on why it has no view-layer/owner coupling).
- **Select all previously left `markActive` untouched — the opposite
  direction of a gap from the other two above**: real Emacs's
  `mark-whole-buffer` (the actual `C-x h` command Select all stands in for)
  doesn't deactivate an existing mark, it *activates* a fresh one spanning
  the whole buffer. So the fix here is to *arm* `markActive` (matching how
  a mouse drag or Shift+Arrow already auto-arms it) after a genuine
  (non-no-op) Select all, not to leave it alone. Verified the armed mark is
  genuinely usable, not just the flag: the next extend command continues
  from Select all's own resulting selection (compared as document offsets,
  not hardcoded line numbers, so this doesn't depend on the fixture's own
  exact trailing-newline layout).

### Recenter

#### `recenterWithSetMark.e2e.ts`

A real bug found right after 0.12.0 shipped (2026-10-22) from
real-machine usage: Recenter/Recenter top-bottom centered on the
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
- **A real bug, found and fixed 2026-10-23**: test (1)'s final
  column-preservation assertion used to pass reliably standalone but
  deterministically read a wrong value when run as part of the full
  suite — initially suspected as cross-spec state leaking in from an
  earlier spec, but diagnostic-logging instrumentation traced it to a
  same-test async race instead: `scheduleTableEntry`'s own column resync
  was deferred via `setTimeout`+`requestAnimationFrame`, and under the
  full suite's accumulated load that deferred callback could lose the
  race against the *next* keystroke, leaving the goal column unseeded and
  falling back to the just-landed cell's own clamped position. Fixed by
  making table entry's resync run synchronously — re-verified live (an
  inherited doc comment had claimed this would crash vim.js's
  `clipCursorToContent`, but that was never independently tested for the
  entry path specifically; four full-suite runs with the synchronous
  version produced zero crashes). Full writeup in the assistant's own
  memory (`project_vim_e2e_cross_spec_column_leak`).

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

#### `vimLeaderTableCommands.e2e.ts`

Priority-4 (last tier) coverage: the leader-key table-structure/table-
navigation commands, off by default — enabled per test via `vimSupport`'s
own `setTableStructureEnabled`/`setTableNavigationEnabled` setters (same
ones the Settings UI calls), restored to off in a `finally` block.

- **(1)** `tj`/`tl`/`tk`/`th`: direct cell-to-cell jumps (down/right/up/
  left), a full round trip back to the start, each landing at that cell's
  own content start. Table navigation is "pure cursor movement, original
  logic" per this plugin's own docs (not a wrapper around anything
  native) — all 6 commands in this family get real coverage here plus
  `tx` below, matching that real-Obsidian-coverage case.
- **(2)** `tx` exits the table below, landing outside it (`tX`, exiting
  above, shares the identical wiring, not separately re-tested).
- **(3)** `tdd` (one representative sample of the 17 table-*structure**
  commands) deletes the current row via Obsidian's own built-in command.
  Confirmed by reading `vim-support.ts` directly that every one of those
  17 shares a single factory (`tableCommandAction`) which just gates on
  `inTableCell` and delegates to Obsidian's own built-in command by ID —
  no mutation logic of this plugin's own — so this one sample confirms
  the leader-key-to-native-command dispatch mechanism itself works live;
  the other 16 aren't each individually re-verified.

This completes real-Obsidian E2E coverage for all 4 priority tiers of the
Vim motion/command upgrades (started 2026-10-22, finished 2026-10-23).

#### `vimTableUndoRedo.e2e.ts`

Follow-up found by reviewing the whole Vim surface after the 4 tiers
above: `u`/`Ctrl-r` inside a table cell delegate to `Editor.undo()`/
`redo()` (real, outer-level CM6 undo/redo) instead of vim's own cell-
scoped default — confirmed by reading `vim-support.ts` directly — because
a per-cell inner view's own local history has no record of table-
structure edits (row/column insert/delete), which are applied at the
outer level. Only unit-tested (mocked) before this.

- **(1)** A second, immediate `u` press still works. This is the
  documented bug this delegation itself was built to avoid: Obsidian's own
  `Editor.undo()`/`redo()` leaves the just-restored range *selected* (real
  CM6 behavior), and vim.js's own default keymap routes a bare `u` to a
  *different* (visual-mode) binding while a selection is live — so the
  very next `u` could silently no-op instead of reaching undo again.
  `tableUndo`'s own fix collapses that selection right after delegating;
  this confirms it still holds.
- **(2)** `u` correctly walks back through a structural edit (`tdd`, table-
  structure) and an earlier plain-text edit, in the correct reverse order
  — the "plain-text edit → table-structure edit → plain-text edit chain
  seamlessly" claim from the same code comment, exercised for real.

#### `vimSpaceLeakGuard.e2e.ts`

Also found reviewing the whole surface: the 0.11.2 "bare Space inserts a
literal space" fix, only ever covered as a unit test before this. Root
cause, confirmed by reading `vim-support.ts` directly: turning on table-
structure/navigation support removes Space's own native vim.js binding
(a `keyToKey` synonym for `l`) to make room for `<Space>t...` leader
sequences, via `unmap()` — which has no read-back API, so that native
binding can never be restored, even after turning the feature back off.
Without the leak-guard, an incomplete leader attempt (e.g. a stray Space
press matching no full sequence) then falls through to CM6's default
text-insertion handling, inserting a literal space.

- Toggles table navigation on then off, then presses a single bare Space
  — confirms the document is completely unchanged (no literal space
  inserted). The leak-guard's own persistence (it deliberately stays
  installed even after the feature is toggled back off, since the native
  binding's removal is permanent for the session either way) is exactly
  what this confirms actually holds up, not just the guard existing while
  the feature is still nominally on.

### Character-level commands outside Vim mode

Found by reviewing the whole E2E suite for the same "mock can't verify
this" pattern the Vim work above kept surfacing — three more areas with
zero real-Obsidian coverage, only ever unit-tested (mocked CM6).

#### `deleteCharCellBr.e2e.ts`

Delete char (Ctrl-D) inside a table cell's own `<br>`-separated sub-lines.
Its grapheme-cluster-awareness is inherited for free from CM6's own
`deleteCharForward` (not re-verified here) — the real plugin-specific risk
is the `<br>` handling in `deleteCharInTableLP`.

- At the end of a non-last sub-line, joins it with the next (deletes the
  `<br>` as one unit, not partially).
- At the true end of the cell (last sub-line's own end), no-ops rather
  than crossing into the adjacent cell.
- Needs two separate dedicated fixtures (`DeleteCharCellBrJoin.md`/
  `DeleteCharCellBrEnd.md`) — the first test mutates the shared vault copy
  of the fixture it opens, so the second test's own search-by-content
  would otherwise silently match nothing (same gotcha already documented
  for `vimWordMotions.e2e.ts` etc., but this is the first time it bit two
  tests *within the same spec file* rather than across separate files).

#### `transposeCharsCellBr.e2e.ts`

Transpose chars (Alt-T, no default key) inside a table cell's own `<br>`-
separated sub-lines. Confirmed by reading `main.ts` directly: only the
true cell boundary (the opening `|`) is a hard stop — a `<br>` boundary is
crossable and swapped as one atomic 4-character unit, never partially.

- **(1)** Crossing a `<br>` swaps it as one unit — `"A<br>B<br>CD"` at the
  start of `"B"` becomes `"AB<br><br>CD"`, exactly the worked example from
  the code's own comment.
- **(2)** At the true start of the cell, no-ops rather than reaching
  outside it.
- **(3)** At the end of the last sub-line, swaps the last two characters
  there (real Emacs end-of-line special case) — needed widening the last
  sub-line to 2 characters (`"CD"`, not `"C"`) to actually have two
  characters to swap; the first attempt with a 1-character last sub-line
  just exercised `swapLastTwoInRange`'s own "fewer than two clusters"
  no-op guard instead, which looked identical to a bug at a glance.
- Needs 3 separate dedicated fixtures, same reason as `deleteCharCellBr
  .e2e.ts` above (test (1) mutates its own fixture's content).

#### `transposeCharsMultiCursor.e2e.ts`

fix/transpose-chars-multicursor: previously, only the mid-line case was
multi-cursor-safe (delegating straight to CM6's own stock `transposeChars`,
which handles every range on its own via `changeByRange`) — the at-line-end
override (`swapLastTwoInRange`) and both table branches only ever looked at
the PRIMARY cursor/range, silently ignoring every other one whenever the
primary happened to land in one of those branches. Rewritten as pure
per-range resolve functions (same shape as Kill line's own
`resolveKillLineRangeOuter`/`InCell`/`SourceMode`) so every range resolves
independently and all changes dispatch together in one transaction. The
unit test suite covers the pure per-range logic (`resolveTransposeChars
RangeInView`/`SourceMode`) directly, including a byte-for-byte replication
of CM6's own stock `transposeChars` formula (read straight from
`@codemirror/commands`' own source to confirm it); these two scenarios
drive the real command through a real CM6 multi-range selection on real
Obsidian instead.

- **(1) outer:** one mid-line range and one at-line-end range both
  transpose in the same command — the exact combination that previously
  only transposed whichever one was primary.
- **(2) inner (table cell):** two ranges in the same cell's own `<br>`
  sub-lines (one mid-segment, one at a segment end crossing into the next
  `<br>`) both transpose independently.
- Needs 2 separate dedicated fixtures (same reason as `transposeCharsCellBr
  .e2e.ts` above).
- **A real, deterministic cold-start gotcha, not a bug in the fix itself**:
  running test (2) standalone (as the very first command issued to a
  freshly launched Obsidian instance) never transitions `inTableCell` to
  `true` even after a 3-second poll, even though the table widget itself
  is confirmed rendered (`.cm-table-widget` present) and the outer cursor
  correctly lands on the table row's own line/ch — some part of the
  cell-focus reconciliation genuinely needs more than a fresh instance's
  very first interaction to settle. Confirmed harmless by running the full
  suite three times in a row with this spec in its rightful position
  (after 26 preceding specs' own warm-up): both tests pass every time.
  Matches this suite's own established "smoke test first as a de-facto
  warm-up" principle — just a sharper edge of it than usual.

#### `cjkDoubleClickWordSelect.e2e.ts`

CJK double-click word selection (`cjk-word-select.ts`) — CM6's own built-in
double-click (`groupAt`) has no word boundary at all within a run of
kanji/hiragana/katakana, so this plugin intercepts `EditorView
.mouseSelectionStyle` to use the same `Intl.Segmenter`-based engine as
Word left/right and Vim `w`/`b`/`e`. A scripted `setCursor`+command can't
reach this code path at all — it needs a real mouse gesture (`detail: 2`,
matching CM6's own `getClickType()` reading, same pitfall already
documented in `setMarkMouseAndLeafChange.e2e.ts` for single-click).

- **(1)** Double-clicking inside `"日本語"` selects just that word, not
  the whole run including the following `"の"` particle.
- **(2)** Double-clicking `"Emacs"` embedded in Japanese prose (`"日本語の
  Emacsとは異なる扱いです"`) isolates just that word — reproduces a real,
  previously-fixed bug (confirmed live 2026-08-22, per the source file's
  own doc comment): an earlier version only checked whether the *clicked*
  character itself was CJK, and `"Emacs"` itself has none, so it declined
  to intervene and left CM6's native run (merged with the surrounding
  Japanese) in place. The actual fix scans outward to the native word-
  class run first, then checks whether *that run* contains a CJK
  character anywhere — this test is what actually holds that fix in place
  against a regression now.
- **(3)** Double-clicking inside `"異なる"` (a verb+auxiliary morpheme)
  selects the whole unit, not split further by the segmenter.

### Title field (0.13.0 Feature 1)

Ctrl-P/N crossing between the note body and the `.inline-title` field (a
plain contenteditable, not CM6).

**Why the NOTE isn't just opened in place from a committed fixture, the
way every other spec in this suite does it**: every other spec's fixture
FILENAME is just an arbitrary label (`MultiCursorHome.md`) — the actual
test content lives in the file's BODY, after the `# heading`/`-`
bullets/`---` separator, and the spec opens that exact file. These specs
test the TITLE itself, and the title's own text IS the note's filename,
so the note under test needs a filename that carries the literal string
under test (a specific short string, an exact ch0 target, 140+ characters
to force wrapping) — not a stable, readable label a committed file could
keep. Kill line's own specs go further: Obsidian renames the file to
match as the title is edited, so testing directly against a committed
fixture would rename it on disk on every run. So the NOTE is created on
the fly with `app.vault.create` under whatever title text the test
needs, and deleted again in `after`.

The note's BODY content, though, still lives in a normal committed
`vaults/smoke/*.md` fixture, same `# heading`/`-` bullets/`---`
convention as everywhere else — `readFixtureBody` (in `helpers.ts`,
alongside `openFixtureAndGetContentStart`) reads everything after a given
fixture's own `---` as a plain string, which the spec then passes
straight into `app.vault.create`'s own content argument. Each such
fixture's own filename ends in `...Fixture.md` specifically to avoid
colliding with the dynamically-created note's own path — several of these
specs name their note very close to the fixture it reads from.

This plugin ships with no default hotkeys, and the title-field Scope
specifically reads whatever bindings are currently configured
(`hotkeyManager.bakedHotkeys`), so these specs call
`hotkeyManager.setHotkeys`/`bake()` before dispatching a real
`KeyboardEvent` (bubbles:true) to whichever element has focus — same
technique `setMarkEscapeKeydown.e2e.ts` already uses for a native key, but
needed here even for a Ctrl-letter *command* key, since a plain
`executeObsidianCommand` call bypasses the Scope/Keymap push-stack
entirely and would never exercise the title-specific handler at all.

#### `titleCrossingShort.e2e.ts`

A short, unwrapped title — isolates the pixel-coordinate math from the
VL-wrap-boundary ambiguity covered separately below.

- **(1)** Body line 0 ch 0 crosses into the title at exactly offset 0.
  Before normalizing by each side's own line-start X (instead of matching
  raw absolute screen pixels), this overshot into the title by roughly the
  body's own line-number gutter width.
- **(2)** A goal column from deep in a later line survives crossing a
  blank line before reaching the title (reads CM6's own native
  `goalColumn`, the same field `execPreservingGoalColumn` already
  preserves for table-row crossings, instead of the blank line's own
  already-collapsed ch-0 position), then round-trips back exactly via
  Ctrl-A (title Home) → Ctrl-N: the escape-to-body landing seeds CM6's
  `goalColumn` directly via a `cm.dispatch` carrying
  `EditorSelection.cursor`'s own 4th param, since a plain
  `editor.setCursor` carries no goalColumn at all.

#### `titleCrossingWrapped.e2e.ts`

A title long enough to wrap across 4 visual lines. Direct regression test
for a real bug found live during development: chaining Ctrl-P upward
through the title's own visual lines skipped one extra line per press
(landing two visual lines up instead of one). Root cause was the
ambiguous-VL-boundary-offset nudge (the same "a collapsed caret at a wrap
boundary always renders via the line being left, regardless of how it was
reached" limitation documented in `titleMoveToLineBoundary`'s own comment)
nudging in the wrong direction for the backward/Ctrl-P case — the fix
nudges forward unconditionally, since the ambiguous pair is always "(line
above, target line)" with the target line second, true for Ctrl-P
stepping up through intermediate lines just as much as Ctrl-N stepping
down.

- Asserts the FULL exact sequence of visual-line top coordinates while
  chaining Ctrl-P up then Ctrl-N back down — a skip is only visible as a
  missing intermediate step, not just a wrong final position.
- Also covers: landing on the title's true first line (offset 0) after
  walking all the way up: a true no-op once there (nothing above —
  frontmatter is out of scope for this feature); the down-chain retracing
  the exact same visual lines in reverse; and the final Ctrl-N escaping
  into the body.

#### `titleCrossingPopout.e2e.ts`

Confirms Ctrl-P/N title<->body crossing works the same inside a popout
window — its own separate document/DOM, not just another view onto the
main window's. This category of bug has bitten this plugin before (see
`setMarkPopoutNativeClearing.e2e.ts`): a listener registered once against
the main window's own document at plugin load time can silently never
reach a later-opened popout's own document. The title Scope is
pushed/popped via `registerWindowDomListeners`, which is already wired
per-window — this is the regression test confirming that actually holds
for the title-crossing feature specifically, not just the
markActive-clearing listeners it was originally fixed for.

- Doesn't reuse `openFixtureInPopoutAndGetContentStart` (that helper opens
  an EXISTING committed fixture by path) — the note has to be created
  with a controlled filename first (title = filename, same reasoning as
  the two specs above), so this spec opens its own popout directly via
  `app.workspace.openPopoutLeaf()`, closing it in `after`.

#### `titleKillLine.e2e.ts`

Ctrl-K (Kill line) in the title field — the first content-*mutating*
command to reach the title, everything before this was pure cursor
movement. Uses `document.execCommand('delete', false)` rather than
`Range.deleteContents()` — confirmed live the former integrates with the
title's own native undo stack while the latter does not. Shares the exact
same kill-ring (`killCache`/`isKillChaining`) as the body's own Kill line.

- **(1)** Kills from the cursor to the title's own end; a second Ctrl-K
  right at the new end is a no-op (the title is always logically ONE
  line, so unlike the body's own Smart-join-into-the-next-line case,
  there's no "next line" to join with here).
- **(2)** Ctrl-Z (native undo) correctly restores the killed text.
- **(3)/(4)** Direct regression coverage for a real gap found while
  building this: `isKillChaining`'s own auto-reset is wired entirely
  through CM6's `updateListener`, which never fires for the title at all
  (plain contenteditable, not CM6) — every non-kill title command
  (`titleMoveToLineBoundary`/`titleMoveChar`/`titleMoveLine`) needed an
  explicit reset added, or a kill chain in the title would never break.
  **(3)** confirms a kill in the title followed immediately by a kill in
  the body (no intervening command) still chains into one kill-ring
  entry; **(4)** confirms an intervening title movement between them
  correctly breaks the chain (the body's kill overwrites rather than
  appends).
- Moving focus between the title and the body fires real native
  focus/blur events that push/pop this plugin's own title Scope (same
  wiring the real feature relies on) — `editor.focus()` is required
  before `executeObsidianCommand` on the body will actually fire its
  `editorCallback` at all (confirmed live: `editor.setCursor` alone
  updates CM6's own state but doesn't move DOM focus away from the
  title, so the editorCallback silently never ran).
- Each test's post-kill title lands on a DIFFERENT prefix, not just
  cosmetic — an earlier draft had every test converge on the same name
  ("Kill"), and Obsidian's own rename-on-blur collided with the previous
  test's leftover file of that name, silently breaking everything
  downstream in that test. `openNote` deletes both the original and the
  expected post-kill filename up front, and `after` cleans up both too.
- `openNote`'s own wait after opening the note polls for this plugin's
  `titleScope` field to actually become non-null, instead of a fixed
  pause — confirmed live a flat 300ms pause here was genuinely flaky
  (title.focus()'s own focusin handler pushes the title Scope
  asynchronously enough relative to a freshly-opened leaf that 300ms
  wasn't always enough margin), failing as "nothing happened at all" on
  a test's very first keypress. Found while building
  `titleKillWord.e2e.ts` below, which hits the identical `openNote`
  shape; retrofitted here too.

#### `titleKillWord.e2e.ts`

Alt-D (Kill word right) / Alt-Backspace (Kill word left) in the title
field. Deliberately does NOT reuse `word-segmentation.ts` (the
`Intl.Segmenter`-based engine Word left/right and Vim `w`/`b`/`e` need on
the body side, since CM6's own native word-class boundary has no CJK
awareness at all) — confirmed live the title's own native
`Selection.modify('extend', ..., 'word')` already segments CJK correctly
on its own, same as physical Option-←/→ in the title.

- **(1)** Kills exactly one word forward/backward from the cursor; a
  no-op right at the title's own start/end.
- **(2)** Ctrl-Z (native undo) correctly restores the killed word — same
  `execCommand('delete', false)` mechanism as Kill line.
- **(3)** The direct regression test for the CJK finding above. Killing
  an embedded English word (e.g. "Emacs") wouldn't actually test CJK
  segmentation — the real test is whether a run of kanji/hiragana
  ("異なる扱いです") gets split at all, rather than killed as one
  indivisible block (the exact failure mode `word-segmentation.ts` exists
  to prevent on the body side). Two consecutive kills split it into
  "異なる" then "扱い" — genuinely word-aware, though NOT an identical
  split to the body's own custom segmenter (see
  `cjkDoubleClickWordSelect.e2e.ts`, which keeps "異なる" as one
  verb+auxiliary unit the same way, but doesn't split "扱いです" further
  the way the title's native boundary does) — different engines, both
  real word segmentation, asserting the title's own actual behavior
  rather than that it matches the body's. Uses its own minimal title
  text ("異なる扱いです" alone, confirmed live to segment identically to
  the same substring embedded in `cjkDoubleClickWordSelect.e2e.ts`'s own
  longer fixture text) rather than reusing that spec's full string —
  the "日本語の"/"Emacs" portions there exist for ITS OWN separate checks
  (a pure CJK run, an embedded English word), not this one.
- **(4)** A backward kill prepends, building the kill-ring in buffer
  order across two consecutive backward kills (`updateKillCache`'s own
  `prepend = !forward`, matching the body's own `killWordOuter`
  convention) — also surfaces a real, confirmed nuance: a backward kill
  starting from the true end of the title text excludes the preceding
  space, but a second backward kill starting right after a space (left
  over from the first) DOES pull that space in, a common word-delete
  convention (e.g. Ctrl+Backspace in many editors) rather than a bug.

#### `titleDeleteChar.e2e.ts`

0.13.0 Feature 1: Ctrl-D (Delete char) in the title field — entirely new
for this context, unlike every other command added to the title field
so far (all of which already existed on at least the body side before
being ported here, giving an existing implementation to reuse). Unlike
Kill line/word (which always collapse to point first, discarding any
active selection on purpose), Delete char does NOT touch the mark's own
extend/move distinction and deletes whatever's already selected if a
selection exists — matching real Emacs's `delete-char`, which also
ignores the mark, and matching the body's own `deleteChar`
(`deleteCharForward`), which never checks `markActive` either.

A real subtlety found while implementing (not a bug, a genuine platform
behavior to guard against): `document.execCommand('delete')` on a
COLLAPSED selection defaults to a BACKWARD (backspace-like) deletion,
not a no-op. Naively extending-then-deleting (`Selection.modify('extend',
'forward', 'character')` then `execCommand('delete')`) would therefore
delete the WRONG (preceding) character at the title's own absolute end,
where there's nothing to extend into and the selection stays collapsed.
Fixed by checking whether the extend attempt actually left the collapsed
state before calling `execCommand` at all — test (2) below is the direct
regression coverage.

- **(1)** Deletes the character after the cursor.
- **(2)** A true no-op at the title's own end — the specific regression
  this command's own implementation needed to guard against.
- **(3)** Deletes an entire active (non-collapsed) selection, not one
  extra character past it.
- **(4)** Integrates with the title's own native undo stack.

#### `propertyValueEditDeleteChar.e2e.ts`

0.13.0 Feature 1, property-value-editing sub-phase: Ctrl-D (Delete char)
inside a text property's own value-edit widget. Reuses `titleDeleteChar`
as-is — entirely new for BOTH the title field and this widget (unlike
Kill word, which already existed on the title side before this phase),
so there's no "title already proved it" precedent to lean on here, only
the underlying Selection API mechanism already used throughout this
whole sub-feature. `suppressFallback` is set, same reasoning as every
other mutating value-edit command here.

- **(1)** Deletes the character after the cursor.
- **(2)** A true no-op at the value's own end.
- **(3)** Deletes an entire active (non-collapsed) selection, not one
  extra character past it.
- **(4)** Regression: Ctrl-D on the row itself (item-selection mode)
  does nothing.

**(5), added after a real post-ship bug report from real-machine
usage**: rapid Ctrl-D ×3 then physical Cmd-Z ×3 left the widget
unresponsive — Ctrl-G didn't even work. Confirmed this needed real
`browser.keys()` to reproduce at all (synthetic `dispatchEvent()`
didn't trigger it during investigation, same lesson as every other
Keymap-adjacent investigation in this sub-feature) and specifically
needed a starting offset of 1+ (not the value's very first character —
why offset 0 doesn't trigger it was never root-caused, but irrelevant
to the fix below).

**Root cause**: native Undo (Cmd-Z) mutates the widget via the
browser's own undo manager — confirmed live it still fires a real
`input` event (3 rapid Cmd-Z presses → 3 `input` events, same count as
3 rapid Ctrl-D presses). Obsidian's own property-value suggestion
dropdown reacts to THAT exactly the same way it reacts to this plugin's
own mutating commands (see this file's own `propertyValueEditKillYank.
e2e.ts` section for the original finding) — but Undo is never
dispatched by this plugin itself, so the original fix (an explicit
`reclaimPropertyRowScopeAfterMutation()` call added individually after
each mutating command) had no command-level call site to attach to for
Undo/Redo at all.

**Fix, more general than the original**: moved the reclaim logic out
of each individual command and into a single document-level `input`
listener (`registerWindowDomListeners`), scoped to
`PROPERTY_VALUE_EDIT_SELECTOR` targets. Reacting to the real `input`
event itself, regardless of cause, covers every mutation path
uniformly — this plugin's own commands, native Undo/Redo, and even
plain typing — rather than requiring every future mutating command to
remember to add its own reclaim call. The individual
`reclaimPropertyRowScopeAfterMutation()` calls previously scattered
across `kill-line`/`kill-region`/`kill-word-left`/`kill-word-right`/
`yank`/`delete-char` in `buildPropertyRowScope` were all removed as
redundant once this landed.

Both specs' full affected-regression run plus a full-suite pass (187
tests) confirmed clean.

#### `titleWordMotion.e2e.ts`

0.13.0 Feature 1: Alt-F/Alt-B (Word right/left) in the title field — the
last remaining title/property command-parity gap, entirely new for this
context (same as Delete char). Reuses `titleSelectionModify` as-is
(already handles the `markActive` `'extend'`/`'move'` branch internally)
with `'word'` granularity and the same `'left'`/`'right'` (not
`'forward'`/`'backward'`) direction convention `titleMoveChar` already
uses — confirmed already correct for `'word'` granularity by
`titleKillWord`'s own existing call, so no new direction-mapping
question here. Same native word-boundary mechanism already confirmed
CJK-safe without a custom segmenter.

- **(1)** Alt-F moves forward to the end of the next word.
- **(2)** Alt-B moves backward to the start of the previous word.
- **(3)** CJK: a run of kanji/hiragana is crossed word by word via
  native word-boundary logic, same as Kill word.
- **(4)** Set-mark + Alt-F extends a real selection, matching every
  other movement command's own mark-extend behavior — unlike Kill word
  (which ignores the mark on purpose, matching real Emacs's own
  `kill-word`), Word left/right is pure movement and must respect
  `markActive` the same way Ctrl-B/F/A/E already do.
- **(5)** A true no-op at the title's own start/end.

#### `propertyValueEditWordMotion.e2e.ts`

0.13.0 Feature 1, property-value-editing sub-phase: Alt-F/Alt-B (Word
right/left) inside a text property's own value-edit widget. Reuses
`titleMoveWord` as-is — entirely new for BOTH the title field and this
widget (same as Delete char), so there's no "title already proved it"
precedent to lean on here, only the underlying Selection API mechanism
already used throughout this whole sub-feature. `suppressFallback` is
set, same reasoning as every other command here with no sensible
row/heading/Add-button behavior.

- **(1)** Alt-F moves forward to the end of the next word.
- **(2)** Alt-B moves backward to the start of the previous word.
- **(3)** Set-mark + Alt-F extends a real selection, matching every
  other movement command's own mark-extend behavior.
- **(4)** Regression: Alt-F/Alt-B on the row itself (item-selection
  mode) do nothing.

Both new specs passed cleanly on first run and on a repeat run (5/5 and
4/4). A full affected-regression run across 14 spec files (property +
title) showed every NEW test in this sub-feature clean, with scattered
failures confined entirely to older, already-well-established specs
(`propertyItemSelection`, `propertyCtrlBf`, `propertyCtrlG`,
`propertyValueEditSetMark`) — consistent with this suite's own
documented environment-focus flakiness (the test Electron window not
being visible/foregrounded during an unattended run), not a regression.
**Going forward, per explicit user direction: de-prioritize full-suite
runs (long-running, more exposure to this exact flakiness) in favor of
targeted, short-duration runs (new spec(s) in isolation, then the
directly affected regression set) as the primary confidence signal** —
a full-suite pass is no longer treated as a required gate for every
small change.

#### `propertyOtherTypesCtrlGPnbf.e2e.ts`

0.13.0 Feature 1, property-value-editing follow-up phase: extends
Ctrl-G (exit) to checkbox/date/datetime/list(multitext)/tags/aliases (6
types), and Ctrl-P/N/B/F to date/datetime/list/tags/aliases (5, checkbox
excluded — no cursor concept at all). See project memory
`project_property_other_types_ctrl_g_pnbf_scope` for the original
scope decision.

**A major, scope-correcting finding from live diagnostic probes run
BEFORE implementing anything** (per this project's own "no
implementation without log evidence" discipline — the original scope
memo's own "cursor-key equivalent via simple dispatch delegation"
framing turned out to be WRONG, not just unverified): confirmed via a
direct comparison (synthetic `dispatchEvent()` vs. a real
`browser.keys()` press, same technique used throughout this whole
sub-feature's own investigations) that **a dispatched `ArrowUp` does
NOT step a native `<input type="date">`'s own value at all** — a real
physical press increments it (e.g. the year sub-field), a dispatched
one leaves it completely unchanged. This is the exact same "browsers
only perform a key's own default action for TRUSTED events" wall
already known from the title/text-type work (see
`project_frontmatter_property_dom_survey`'s own Category B finding:
these inputs also have zero Selection API), just confirmed here for
the OTHER half of the plan (native key-equivalent dispatch) that the
original scope memo had assumed would work as a fallback. There is
**no implementation possible for Ctrl-P/N/B/F on date/datetime with
any public API** — this is a genuine, unfixable platform wall, not an
engineering gap. The SAME dispatch-doesn't-trigger-native-movement
wall was separately confirmed for the multi-select trailing chip's own
contenteditable too (dispatching `ArrowLeft` there doesn't move the
caret either) — but that one DOES have a real Selection API (confirmed
live), so real movement is achieved there by reusing
`titleMoveChar`/`propertyValueEditMoveLine` exactly as-is, the same
mechanism the text type already uses, NOT a "simpler cursor-key
delegation" the way checkbox/date/datetime needed to settle for.

New selector constants (`PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR`,
`PROPERTY_MULTISELECT_INPUT_SELECTOR`, `PROPERTY_DATE_TYPE_SELECTOR`,
`PROPERTY_CURSOR_PNBF_SELECTOR`, `PROPERTY_ANY_VALUE_WIDGET_SELECTOR`)
and a new `valueEditSelector` parameter on `buildPropertyRowScope`'s
own `bind()` helper (defaulting to the original text-only selector for
every pre-existing call site, unchanged) — only the `keyboard-quit` and
`cursor-up`/`cursor-down`/`cursor-left`/`cursor-right` calls pass a
broader selector explicitly, since those are the only commands this
phase actually extends. Two new wrapper methods
(`propertyMoveLineOrNoop`/`propertyMoveCharOrNoop`) guard the
date/datetime no-op case before delegating to the existing
`propertyValueEditMoveLine`/`titleMoveChar` for text/multi-select.

- **(1.\*)** Ctrl-G exits from all 7 types back to item-selection mode
  — one parameterized test per type (checkbox/date/datetime/number/
  list/tags/aliases).
- **(2)**/**(3)** Ctrl-F/B/P/N on date/datetime are a true no-op — both
  the value and focus stay completely unchanged across all four keys.
- **(4)** Ctrl-F actually moves the caret within the multi-select
  trailing chip, confirming the same Selection API mechanism as the
  text type works here unchanged.
- **(5)** Regression: Ctrl-F on checkbox falls through safely (checkbox
  is deliberately excluded from `PROPERTY_CURSOR_PNBF_SELECTOR`, so it
  hits the generic native-dispatch fallback instead — confirmed this is
  harmless, no crash, no unwanted state change).

**`number` added in a follow-up fix, same day — a real gap, not a
deliberate exclusion**: `number` was never part of this phase's
original 6-type list at all (the original scope decision only ever
named checkbox/date/datetime/list/tags/aliases) — found that Ctrl-G
didn't work on the number type after the rest of this phase had
already shipped. Shares the exact same no-Selection-API wall as
date/datetime, and was never in scope for Ctrl-PNBF either way, so it
only joins `PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR`.

**A second real bug found while adding it, in this phase's own
already-shipped code, not the new addition itself**:
`PROPERTY_ANY_VALUE_WIDGET_SELECTOR` had been built as
`` `${PROPERTY_CURSOR_PNBF_SELECTOR}, input[type="checkbox"]` `` — a
separate, hardcoded construction that never actually referenced
`PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR` at all. So adding `number` to
`PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR` alone had zero effect on the
selector `keyboard-quit`'s own `bind()` call (and `PROPERTY_PANEL_SCOPE_SELECTOR`)
actually use — confirmed live test (1.mynumber) still failed
(`Expected: true, Received: false`) after that first edit. Fixed by
rebuilding `PROPERTY_ANY_VALUE_WIDGET_SELECTOR` directly from
`PROPERTY_VALUE_EDIT_SELECTOR` + `PROPERTY_MULTISELECT_INPUT_SELECTOR`
+ `PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR` instead, so any future addition
to the latter propagates automatically rather than needing a second,
easy-to-forget manual update.

All 11 tests passed on the first run (after the real fix) and a repeat
run. Verified via a short, targeted affected-regression set (4 spec
files, 31 tests, all clean) rather than a full-suite pass, per this
file's own "Execution" policy above.

**Test (6) added later, same phase: a real gap in list/tags/aliases'
own multi-select widget**: ArrowLeft/Right from the trailing input
moves real DOM focus onto an already-committed "pill" (chip,
`.multi-select-pill`) — confirmed live, a focus target that didn't
match `PROPERTY_PANEL_SCOPE_SELECTOR` at all. The `focusout` handler's
own check (matching the INPUT on its way out of focus) popped
`propertyRowScope` the moment a pill gained focus, and nothing re-pushed
it (pills weren't in the selector either), leaving Ctrl-G — and every
other command — completely dead from there. Confirmed live that a
pill's own native Escape only steps back to the trailing input (one
level), different from every other type's "Ctrl-G always exits
straight to item selection" convention — this made a special pill-only
exit handler SEEM necessary at first, but turned out not to be: the
existing generic handler's own synthetic Escape redispatch, once the
scope simply stays alive, already reaches the row directly on its own
(the pill's native "step back to input" behavior only fires for
TRUSTED keydowns, confirmed by this redispatch reaching the row instead
— a real, live-confirmed example of the "synthetic dispatch behaves
differently from a trusted press" wall cutting the OTHER way for once,
simplifying the fix rather than complicating it). Fixed with a single
selector addition: `.multi-select-pill` added to
`PROPERTY_ANY_VALUE_WIDGET_SELECTOR` (new constant
`PROPERTY_MULTISELECT_PILL_SELECTOR`), no handler changes at all. Built
red-green twice — once for a speculative special-case branch (removed
after confirming it was unnecessary), once for the actual selector
fix.

**Test (7), same day, a direct follow-up question**: if Ctrl-G can
already be handled from a focused pill, shouldn't Ctrl-B/F work from
there too? Confirmed live BEFORE touching any code: a dispatched (synthetic)
`ArrowLeft`/`ArrowRight` on a focused pill moves focus to the adjacent
pill, exactly like a real `browser.keys()` press does — unlike the
pill's own Escape-to-input step (test (6)'s own finding), pill-to-pill
arrow navigation is NOT trusted-events-only. Once confirmed, checked
whether the plugin's own Ctrl-B/F hotkeys already reached this via
`cursor-left`/`cursor-right`'s existing generic native-dispatch
fallback (the same mechanism item-selection mode's own row/heading/
Add-button already rely on, and the same one that made test (6)'s own
fix a single selector addition) — they did, with ZERO code changes at
all, since test (6)'s own fix already put pills inside
`PROPERTY_PANEL_SCOPE_SELECTOR`, and nothing in
`PROPERTY_CURSOR_LR_SELECTOR` matches a pill more specifically to
intercept the fallback. This test exists purely to lock in behavior
that was already shipped by test (6)'s own fix, confirmed red-green
against the SAME selector change (removing `PROPERTY_MULTISELECT_PILL_SELECTOR`
from `PROPERTY_ANY_VALUE_WIDGET_SELECTOR` reproduces both (6) and (7)
failing together).

**Test (8), same day, a direct follow-up**: in the crossing
chain row-selection-mode → Ctrl-F → an unnamed intermediate mode →
physical-cursor-only ← → pill-selection-mode, could that
physical-cursor-only leg also become Ctrl-B, and what IS that
intermediate mode anyway? It's the multi-select
widget's own trailing input (`.multi-select-input`, the always-present
contenteditable where a NEW, not-yet-committed item is typed — every
property type's Ctrl-F from its own row lands in this exact same kind
of "value-edit" widget, this one's just specific to list/tags/aliases).
The ONE crossing Ctrl-B/F didn't already cover for free (unlike test
(7)'s own pill-to-pill and pill-to-input directions) was physical-arrow-
only: a real ArrowLeft at the input's own start (caret position 0, no
typed text) hands focus to the preceding pill, but `titleMoveChar`'s own
`Selection.modify('move', 'left', 'character')` is a true no-op there
(nothing to move INTO within the input's own text — the pill is a
separate DOM sibling).

Fixed with a new `isSelectionAtStartOf()` helper (compares a Range from
the element's own start to the current focus position; empty means "at
the start") plus a boundary branch in `propertyMoveCharOrNoop` that
focuses `el.previousElementSibling` DIRECTLY when it matches
`PROPERTY_MULTISELECT_PILL_SELECTOR`, rather than delegating to a
native-equivalent `ArrowLeft` dispatch the way other cross-element
escapes in this plugin do. A dispatch-based version was tried FIRST and
seemed to fail intermittently depending on test context — turned out to
be a RED HERRING: extensive live instrumentation (temporary
`console.log`s and `window` globals in the production code, since
console output itself proved unreliable to capture reliably mid-
investigation) confirmed the dispatch-based fix actually worked
correctly every time; the real bug was in the TEST's own assertion,
reusing `snap()`'s `row.querySelector('.multi-select-pill')` with a
TWO-pill list — `querySelector` always resolves to the FIRST pill in
DOM order, not whichever one actually has focus, so the assertion
compared against the wrong element even when the fix worked perfectly.
Switched the fix to direct `.focus()` anyway (simpler, no dependency on
how Obsidian's own native handler is wired) once this was untangled,
and fixed the test to check `document.activeElement` directly instead
of reusing `snap()`.

Also confirmed live, not assumed: this crossing is conditional on the
input being genuinely EMPTY — a real `ArrowLeft` with uncommitted typed
text still at caret position 0 stays within the input rather than
escaping (Obsidian's own native behavior), and `isSelectionAtStartOf()`
already respects this correctly (it compares actual text content before
the caret, so typed text there makes it return `false` regardless of
the caret's own offset being 0 relative to that text). Skipped while a
mark is active, matching the "stay in place" convention a marked
selection already has at every other cross-widget boundary in this
plugin. Built red-green (commenting out the boundary branch entirely
reproduces the escape not happening, confirmed via the corrected
assertion).

**Test (9), same day, another direct follow-up**: a report that
pressing Ctrl-N inside `myList`'s own trailing input (which highlights
Obsidian's own "previously used values" suggester once it's showing)
left Ctrl-P/N/B/F AND Ctrl-G unresponsive, recoverable only via a real
physical Escape. Confirmed live this is the SAME scope-shadowing class
already fixed for the text value-edit widget
(`propertyValueEditKillYank.e2e.ts`'s own test (8)) — the suggester
pushes its own Scope on top of `propertyRowScope` — but triggered by a
DIFFERENT path this time: simply typing a character matching an
EXISTING value elsewhere in the vault shows the suggester, and neither
that keystroke nor Ctrl-N/G themselves produce any `input` event (no
text mutation happens), so the EXISTING `'input'`-only reclaim listener
never covered this path at all, regardless of widget type.

Fixed with a parallel `'keydown'`-based reclaim trigger (same
underlying `reclaimPropertyRowScopeAfterMutation()` as the existing
`'input'` listener, just triggered on a broader, non-mutation-specific
event) — covers this and every other shadowing cause uniformly, the
same way the `'input'` listener already covers every MUTATING cause
uniformly. Built red-green (commenting out the new listener reproduces
Ctrl-G staying permanently stuck even after two presses; restoring it
makes a single Ctrl-G press after the typed character work correctly).

**Test (10), same investigation, a separate gap**: `tags`' own "previously
used values" suggester shows a popup as soon as a matching character is
typed, but confirmed live it has ZERO keyboard navigation of its own at
all — a real physical `ArrowDown`, this plugin's own Ctrl-N, and a real
physical `Enter` all left its `.is-selected` class completely unchanged
across a multi-item list, and `Enter` didn't commit the highlighted item
either, it just inserted the literally-typed prefix as a brand-new pill
with the suggester left open. The physical-arrow gap is an accepted
platform limitation (same class as date/datetime's own no-op above), but
Ctrl-N/P having no effect either was a real gap worth closing.

Confirmed live before implementing: a synthetic `MouseEvent('click')`
dispatched on a `.suggestion-item` DOES reliably complete the typed
prefix to that item's own full value — unlike synthetic `KeyboardEvent`s
elsewhere in this codebase, which are well-established as unreliable for
anything Keymap-adjacent, a synthetic mouse click on this plain DOM list
behaves exactly like a real one. Built a from-scratch keyboard-navigation
layer on top of it: `getVisibleSuggesterItems()`/`propertyNavigateSuggester()`
move the suggester's own `.is-selected` class between `.suggestion-item`
siblings (Ctrl-N/P, via a new branch in `propertyMoveLineOrNoop`), clamped
at both ends rather than wrapping — matching this plugin's boundary
convention everywhere else, not native's own (nonexistent) behavior — and
a new bare `scope.register([], 'Enter', ...)` directly on
`propertyRowScope` (same precedent as the existing bare-Escape pass-
through) commits the highlighted item via that synthetic click, passing
Enter through untouched whenever no suggester is visible.

One live-confirmed surprise baked into the test: Obsidian's own suggester
already auto-highlights the FIRST item by default when it renders (`.is-
selected` is already present on page load), it just ignores every
keyboard input that would normally move it — so Ctrl-N's own first press
moves to the SECOND item, not the first; the test's own initial assertion
reflects this rather than assuming `.is-selected` starts absent. Built
red-green (commenting out both the new `propertyMoveLineOrNoop` branch
and the bare-Enter handler reproduces Ctrl-N/P and Enter all doing
nothing to the suggester; restoring them makes navigation, boundary
clamping, and Enter-commit all work, while Enter with no suggester
visible stays completely ordinary native typing).

**Test (11), found while using test (10)'s own feature**: navigating
past the suggester's own visible window left the newly-highlighted item
scrolled out of view entirely — toggling `.is-selected` alone doesn't
auto-scroll the way a real native list's own keyboard navigation would.
Fixed with `items[nextIndex].scrollIntoView({ block: 'nearest' })` in
`propertyNavigateSuggester`, right after moving the class (`'nearest'`
rather than `'center'`/`'start'` so it doesn't scroll at all once the
item is already fully visible, matching real native list behavior).
Seeds 15 matching values to force real overflow, then checks the
highlighted item's own bounding rect stays within the suggester's
scrollable window after repeated Ctrl-N (with a 1px tolerance —
confirmed live `scrollIntoView` can leave a sub-pixel gap even when the
item is fully, visually within view). Built red-green (commenting out
the `scrollIntoView` call reproduces the item ending up outside the
visible window after enough presses).

#### `propertyNameEdit.e2e.ts`

0.13.0 Feature 1, property NAME (key) editing phase: the property's own
name field (`.metadata-property-key-input`) is a real `<input
type="text">`, unlike the title field and the text value-edit widget
(both contenteditable) — `document.getSelection()` doesn't apply to a
form control's internal text at all, so every handler
(`propertyKeyMoveChar`/`MoveToLineBoundary`/`MoveWord`/`SetMark`/
`KeyboardQuit`/`KillLine`/`KillWord`/`DeleteChar`/`CopyRegion`/
`KillRegion`/`Yank`) is its own new implementation working through the
input's own `selectionStart`/`selectionEnd`/`selectionDirection` triple
instead of a Range. Confirmed live (temp diagnostic, deleted after)
that `execCommand('delete'/'insertText')` still respects that triple
exactly like it respects `document.getSelection()` for a
contenteditable, including persistence to frontmatter after blur — same
technique as the title field's own Kill/Yank.

Ctrl-P/N (cursor-up/down) have no "up/down" meaning on a single-line
field by itself, matching this phase's own scope decision — EXCEPT
while this field's own suggester is visible, where they now navigate
it (test (14), added later alongside the same feature for the
multi-select value-suggester — see
`propertyOtherTypesCtrlGPnbf.e2e.ts`'s own test (10)).

**A real regression was found and fixed while wiring this up, caught
entirely by re-testing `propertyItemSelection.e2e.ts`** (3/6 tests
failing, confirmed NOT pre-existing via a clean-`develop` A/B
comparison): this input has its own native two-stage Escape handling
(close its own name-suggester dropdown first, exit to the row second).
Live diagnostics (scope-stack depth dumps, `plugin.propertyRowScope`
identity checks) traced this to a genuine Obsidian dispatcher behavior:
merely having `propertyRowScope` pushed on TOP of the window stack —
regardless of what, if anything, it registers for bare Escape —
collapses that native two-stage behavior into one stage, because the
dispatcher only ever consults the TOP scope for a given key; the
input's own underlying suggester-scope (further down the stack) stops
being reachable at all once ours is on top.

A plain, non-Scope `keydown` listener was tried next, reasoning that
none of this phase's commands (Ctrl-B/F/Home/End/Alt-B/F/Ctrl-Space/
Ctrl-G/K/W/Y/Alt-Backspace/D/Ctrl-D) have any pre-existing native claim
to lose precedence against — confirmed live this assumption was WRONG:
Obsidian's own global command-hotkey resolution claims (stops
propagation for) ANY key combo matching a REGISTERED command's hotkey
REGARDLESS of whether an editor is focused, since cursor-left/right/
home/end/etc. are the exact same commandIds already used elsewhere in
this plugin. A raw `addEventListener` dump showed the second key of a
real `Ctrl+F` combo never arriving at the document level at all once
`cursor-right` had a real hotkey assigned. Back to `app.keymap`'s Scope
system.

The actual fix: an unconditional `scope.register([], 'Escape', ...)`
pass-through registration in `buildPropertyRowScope`, returning `true`
(defer to native handling) specifically when the target matches
`PROPERTY_KEY_EDIT_SELECTOR`. This alone caused a SECOND real
regression (`propertyCtrlG.e2e.ts` / `propertyOtherTypesCtrlGPnbf.e2e.ts`,
4-7 tests failing depending on the exact variant tried): `false`
(swallow) for every other target broke `keyboard-quit`'s own
internal native-Escape RE-DISPATCH, which every OTHER value-widget type
(checkbox/date/list/etc.) and item-selection mode's own row/heading/
Add-button rely on to actually perform their exit — a Scope handler
can't otherwise distinguish that re-dispatch from a genuine external
Escape (both are equally synthetic from the DOM's own perspective, so
not even `isTrusted` helps). Fixed by tagging the re-dispatch with a
custom property (`UCH_INTERNAL_ESCAPE_REDISPATCH_FLAG`) at BOTH
dispatch sites that needed it — `bind()`'s own generic native-dispatch
fallback (the one item-selection mode's row/heading/Add-button
actually go through) and `keyboard-quit`'s own handler (the one
checkbox/date/list/key-edit go through) — and checking for that tag
first, unconditionally returning `true` when present. Missing either
tag site reproduced one of the two regressions; both tagged together
resolved both with no further regressions found across a 7-file/49-test
sweep (this spec plus `propertyItemSelection`, `propertyCtrlG`,
`propertyOtherTypesCtrlGPnbf`, `propertyValueEditMovement`,
`titleCrossingShort`, `titleKillWord`).

- **(1)**/**(2)**/**(3)** Ctrl-B/F, Home/End, Alt-F/Alt-B move the caret
  by character/line-boundary/word respectively, reusing
  `findWordSpanOnLine` (word-segmentation.ts) directly on `.value` for
  word motion (CJK-safe, same engine as the body's own Emacs word
  motion) rather than any Selection-API mechanism.
- **(4)**/**(5)** Ctrl-Space arms the mark and Ctrl-F extends a real
  selection; Ctrl-G clears it without exiting the field.
- **(6)**/**(7)** Ctrl-K kills from caret to end (persisting the rename
  after blur, confirming `execCommand` + `selectionStart`/`End` really
  does reach Obsidian's own commit-on-blur logic); Ctrl-Y yanks it back.
- **(8)**/**(9)** Alt-Backspace/Alt-D kill one word at a time; Ctrl-D
  deletes the character after point.
- **(10)**/**(11)** Alt-W copies the active selection without deleting
  it; Ctrl-W kills it.
- **(12)** A real Escape (no Ctrl-G at all) still exits to
  item-selection mode on its own, confirming the fix didn't disturb the
  native two-stage behavior it was built to preserve.

**(13) added in a follow-up fix, same day — a real bug found live**:
pressing Ctrl-D at the second character then Cmd-Z left the input
unresponsive — the exact same
scope-shadowing bug already fixed for the text value-edit widget
(`propertyValueEditDeleteChar.e2e.ts`'s own test (5)) — this input's
own native autocomplete/suggester reacts to the real `input` event
from `execCommand('delete')` or the browser's own native Undo by
pushing its OWN Scope on top of `propertyRowScope`, exactly like the
text widget's suggester. The existing document-level `input` reclaim
listener was scoped to `PROPERTY_VALUE_EDIT_SELECTOR` only (this input
didn't exist yet when that fix shipped) — broadened to
`PROPERTY_TEXT_LIKE_EDIT_SELECTOR` to cover both. Confirmed red before
the fix (reverting the selector back to `PROPERTY_VALUE_EDIT_SELECTOR`
reproduces test (13) failing) and green after.

**Test (14), added later**: this field's own "previously used property
names" suggester (`.suggestion-container.mod-property-key`) was
confirmed live to share the exact same DOM shape and the exact same
total absence of keyboard support as the multi-select value-
suggester's own (see `propertyOtherTypesCtrlGPnbf.e2e.ts`'s own test
(10) for that original investigation) — a real physical ArrowDown,
Ctrl-N, and Enter all left it completely unresponsive. Fixed for free
by broadening `PROPERTY_SUGGESTER_SELECTOR` to match both suggester
types, plus widening cursor-up/down's own `valueEditSelector` to reach
this input (via `PROPERTY_CURSOR_LR_SELECTOR`, already built for
Ctrl-B/F) — `propertyMoveLineOrNoop`'s key-edit branch navigates the
suggester when one is visible and stays a true no-op otherwise
(preserving the existing scope decision above), and the SAME bare-Enter
handler on `propertyRowScope` now also matches this input. No new
commit mechanism needed at all, just broadening three existing
selectors. Built red-green (reverting cursor-up/down's own selector
back to `PROPERTY_CURSOR_PNBF_SELECTOR` reproduces Ctrl-N/P doing
nothing to this suggester).

#### `basesPropertyEditing.e2e.ts`

0.13.0 Feature 1, Bases re-verification (deferred from the original
property-value-editing phase, finally picked up once the whole
property-text-editing surface — including property NAME editing —
shipped). A DOM survey (temp diagnostic specs, deleted after) confirmed
live that a Bases table view's own per-cell value widgets reuse the
EXACT same DOM classes as the single-note Properties panel:
`.metadata-input-longtext` for text, `input[type="checkbox"/"date"/"number"]`
for those types, `.multi-select-input` for list/tags/aliases — every
command bound in `buildPropertyRowScope` matches on these LEAF element
classes directly, with no dependency on the Properties panel's own
`.metadata-property` row wrapper existing at all. So none of this
needed new code — confirmed by this spec exercising real commands
end-to-end (not just checking DOM classes match): cursor movement,
Kill-line/Yank round-trip, Ctrl-G exit from text/checkbox/date cells,
the scope-shadowing fix (same regression class as
`propertyValueEditDeleteChar.e2e.ts`/`propertyNameEdit.e2e.ts`'s own
test (13), confirmed it ALSO just works here for free), and
Selection-API movement in a list cell's own trailing chip.

**Confirmed NOT covered, same DOM survey, test (6)**: a Bases column's
own header (the property NAME) is a plain, non-editable
`.bases-table-header-name` div — nothing like
`.metadata-property-key-input`. Bases renames a column through its own
menu-based UI, not an inline text input. The property NAME-editing
phase's commands genuinely don't apply here — not a gap to fix, a real,
confirmed scope boundary.

**Also found and fixed while running this spec's own first draft,
unrelated to the DOM-class investigation above**: a bare physical
Escape, with `keyboard-quit` left completely unmapped (the true
out-of-the-box default), stopped exiting any property/Bases value
widget at all — see `propertyCtrlG.e2e.ts` test (7) and
`project_property_name_edit_scope_dispatch_bug`'s own 5th-bug writeup
for the full story; this spec's own test (3)/(4) (Ctrl-G, scope-
shadowing) only pass today because they explicitly map `keyboard-quit`
to Ctrl-G rather than relying on a bare Escape.

#### `basesCellNavigation.e2e.ts`

0.13.0 Feature 1, Bases follow-up, same day as the re-verification
above: a Bases table view's own "cell selection mode" (reached via
Escape from a cell's edit mode — confirmed free of charge via the
bare-Escape fix above) keeps real DOM focus on one shared
`.bases-table-container` element for the WHOLE table, never on any
individual cell. Confirmed live (DOM survey, temp diagnostic specs,
deleted after) that physical arrow keys move an internal "active cell"
marker while this container stays focused throughout, and that a
SYNTHETIC `Arrow*` dispatch on this SAME container reproduces it
exactly — verified by pressing Enter afterward and checking which cell
actually entered edit mode, the only reliable way to observe the
internal marker from outside (it carries no stable, directly-queryable
attribute of its own, though a `.bases-table-active-cell` CSS class
does transiently exist on the relevant `.bases-td`).

Implementation: `.bases-table-container` was added to a new
`BASES_TABLE_CONTAINER_SELECTOR` constant, merged into
`PROPERTY_PANEL_SCOPE_SELECTOR` (NOT `PROPERTY_PANEL_FOCUS_SELECTOR`
itself — deliberately kept separate from the bare-Escape pass-through
registration's own check, since there's no reason to swallow a bare
Escape on this target). **No new handler code was needed at all**:
cursor-up/down/left/right's own EXISTING generic native-dispatch
fallback (the same one Properties' row/heading/Add-button already
use) picks this target up automatically, since nothing else in
`buildPropertyRowScope`'s `bind()` calls matches it more specifically.

Built red-green: temporarily removing `BASES_TABLE_CONTAINER_SELECTOR`
from `PROPERTY_PANEL_SCOPE_SELECTOR` reproduced the test failing
(Ctrl-F did nothing, cell stayed on `myText` instead of moving to
`myNumber`), restoring it made it pass. The test itself needed a
`filters:` clause scoping the `.base` file to just its own 2 notes —
an earlier, unfiltered draft showed the whole vault's ~40 other files
too, making row-index-based assertions unreliable.

#### `basesRecenter.e2e.ts`

0.13.0 Feature 1, Bases follow-up, same day as the cell-navigation spec
above: Ctrl-L (recenter / recenter-top-bottom) in cell-selection mode.
Unlike cell navigation, Bases has NO native equivalent for Ctrl-L at
all — this is a genuinely new implementation, not a native-dispatch
delegation, and needed real custom scroll-math code.

Confirmed live (temp diagnostic specs, deleted after) that
`.bases-table-container` (the element that stays focused throughout
cell-selection mode) is NOT itself the scrollable element — its own
`scrollHeight`/`clientHeight` are always equal, even with 200 rows. The
real scrollable ancestor is its own PARENT, `.bases-view` (found via an
ancestor-chain walk: the only element with `overflow: auto` and
`scrollHeight > clientHeight`). The active cell is found via
`.bases-table-active-cell`, present directly in the DOM at all times —
no need to press Enter to detect it.

The scroll-to-Y formula is `scrollTop + (rect.top - scrollRect.top) -
targetY` (see the real regression below for why the `- scrollRect.top`
term is NOT skippable, despite an early, now-corrected belief that it
canceled out algebraically). `.bases-view`'s own header (`.bases-thead`) is `position: sticky`,
permanently occupying the top of its viewport — factored into the
"center" and "top" targets (subtracted from available height / added as
a floor, respectively), but not "bottom" (unaffected by the sticky
header).

Two new commands reuse this same scroll math:
`recenterBases`/`recenterTopBottomBases`, bound via two new `bind()`
calls in `buildPropertyRowScope` on `BASES_TABLE_CONTAINER_SELECTOR`
with `suppressFallback` set (unlike cursor-up/down/left/right, there's
no meaningful native Ctrl-L behavior to fall back to, so a bare
native-dispatch fallback would risk triggering something unrelated).
`recenter-top-bottom` shares the body's own `_recenterStep` counter — a
user is only ever in one context (body or Bases) at a time, so one
counter behaves the same as a separate per-context one would, with less
code.

Built red-green: temporarily commenting out both new `bind()` calls
reproduced both tests failing (the active cell stayed at its original
scroll position instead of moving to center/top/bottom), restoring them
made both pass.

**Real regression, found live right after this feature first shipped**:
"top" landed clear behind the sticky header, "bottom" stopped short
with visible slack beneath it. Root cause: `recenterBasesScrollTo`'s
scroll-to-Y formula (`scrollTop + rect.top - targetY`) treated `rect.top`
(page-viewport-relative) and `targetY` (computed in `.bases-view`-LOCAL
coordinates, 0 at its own top edge) as the same coordinate frame — only
true when `.bases-view` itself sits at page y=0. The very first draft of
this spec opened the Bases leaf as the window's ONLY leaf, where that
happened to hold (coincidentally — the earlier pixel-exact diagnostic
confirmation was tautological, not genuine evidence `.bases-view` was at
y=0; the formula lands the cell's page-relative top AT `targetY` by
construction, regardless of where `.bases-view` itself sits), so the
bug was invisible to it. In a real vault (or this spec's own now-split
setup below a markdown leaf) `.bases-view`'s own
`getBoundingClientRect().top` is nonzero, and the missing
`- scrollRect.top` term made every target land that many pixels too
high on screen. Fixed by adding it back:
`scrollTop + (rect.top - scrollRect.top) - targetY`, confirmed live via
a temp diagnostic (forcing a split leaf) showing the drift tracked
`-scrollRect.top` exactly, and zero drift after the fix.

This spec was rewritten to open the Bases leaf in a split below a
markdown leaf specifically so `.bases-view`'s own offset is nonzero
going forward, and its own assertions now compare a `localTop`
(`rect.top - scrollRect.top`) against the local target instead of
`rect.top` directly — the same latent assumption had leaked into the
spec's own checks, not just the production code. Re-verified red-green
again after the fix: temporarily removing the `- scrollRect.top` term
reproduced both tests failing by the same ~116px drift the live report
described, restoring it made both pass again, confirmed alongside
`basesCellNavigation.e2e.ts`/`basesPropertyEditing.e2e.ts`/
`recenterWithSetMark.e2e.ts`.

**Second live report, same day**: the top/bottom margin felt too
generous. Cause: `recenterTopBottomBases` reused the note body's own
`RECENTER_TOP_BOTTOM_MARGIN_LINES` (2) directly against `rowHeight` —
2 full table ROWS of margin, not 2 text lines, reads as excessive for a
table. Fixed with a separate, smaller
`RECENTER_TOP_BOTTOM_MARGIN_ROWS_BASES` (1). While investigating this,
a live DOM dump also found a real latent bug in the SAME line:
`rowHeight` was computed via `cellEl.closest('.bases-tr')
?.getBoundingClientRect().height ?? 30` — but `.bases-table-active-cell`
has NO `.bases-tr` ancestor at all in this Obsidian version's Bases DOM
(`.bases-tbody` holds `.bases-td` cells directly; `.bases-tr` exists
elsewhere, used only for click-targeting in these specs' own
selectors). `closest()` always silently returned `null`, so `rowHeight`
was always the hardcoded `30` fallback — invisible until now because
30 happens to be close to the real ~28px row height. Fixed by reading
the active cell's OWN `getBoundingClientRect().height` directly instead
of looking for a nonexistent ancestor.

**Two further live reports, same day, both resolved as expected
boundary behavior, not bugs**: first "TOP's position should be higher,"
then (after the margin/rowHeight fix above) "BOTTOM's position isn't
right." Temporary `console.log` instrumentation was added directly to
`recenterBasesScrollTo`/`recenterTopBottomBases` (removed again once
the reports were resolved) to capture real values from the live
session, rather than relying on E2E reproduction — a dedicated E2E
diagnostic (both a raw `scrollTop` assignment and the real command,
polled for 2-3s with zero further input) could NOT reproduce any
spontaneous drift, so the only way to get real data was logging the
actual production code path. The captured logs showed the formula's
own arithmetic was 100% self-consistent in both reports (every
`beforeScrollTop` matched the previous step's own `newScrollTop`
exactly, down to sub-pixel precision) — the "wrong" position in both
cases was `Math.max(0, ...)` correctly clamping a would-be NEGATIVE
scroll value, meaning the clicked row was too close to one edge of the
WHOLE table (not the currently-visible screen) for `center` (1st report)
or `bottom` (2nd report) to be geometrically achievable — the exact
same boundary behavior `scrollToCursorAtY` already has for the note
body near the start/end of a document. A single, non-repeating ~130px
inter-step discrepancy also appeared in the very first captured log
(contradicting the "self-consistent" pattern above) but never recurred
in the second capture and couldn't be reproduced by automation either;
left unexplained, most likely incidental to that one session.

Set-mark (Ctrl-Space) in the title field. Unlike the body's own CM6-based
Set-mark (which needs its own anchor-tracking machinery), the title's
native Selection already distinguishes anchor from focus on its own —
arming the mark just collapses to the current focus, and every existing
movement command already calls `Selection.modify` with `'extend'` instead
of `'move'` whenever `markActive` is true (the same native mechanism a
real Shift+Arrow keypress uses). The title<->body boundary is never
crossed while a mark is active, in either direction — same "exit = stay
in place" convention `extendMarkInCell` already uses at a table cell's
own boundary, since a marked selection can't span two separate DOM
editing roots (CM6's own `EditorSelection` vs the title's native
`Selection`). Kill commands deactivate the mark unconditionally, same as
the body's own convention.

- **(1)** Ctrl-F/B extend a native selection from a fixed anchor; Ctrl-A/E
  extend to the line boundary.
- **(2)** The direct regression test for a real bug found live during
  development: Ctrl-P/N's own "did we move to a new visual line"
  detection read `sel.getRangeAt(0)` directly, which reflects the WHOLE
  anchor-to-focus range once a mark is active (often a single rect
  spanning most of a line) rather than "where does the caret/focus
  currently render" — every marked Ctrl-P/N silently became a no-op as a
  result. Fixed by reading a dedicated collapsed-at-focus range
  throughout (`titleFocusRects`). Asserts the chain is monotonically
  non-decreasing and eventually stabilizes (not the exact offsets/VL
  count themselves, since the test window's own width isn't perfectly
  reproducible across separate E2E runs), confirms the anchor never
  moves and the title is never escaped from, then chains Ctrl-P back down
  to the anchor itself.
- **(2b)** Direct regression test for a second real bug found live:
  extending in the direction OPPOSITE the selection's current extension
  (Ctrl-F then Ctrl-P, or Ctrl-B then Ctrl-N) — a single
  `Selection.modify('extend', ..., 'line')` call only retracts focus back
  to the anchor in that situation (confirmed live via a direct native-API
  probe), it doesn't continue past the anchor into the new direction
  until a SECOND call. Without `titleMoveLine` detecting this (focus
  landed exactly on the anchor it started the call at) and re-issuing the
  modify() call once more, both of these silently collapsed the whole
  selection back to the Set-mark position instead of moving at all.
- **(2c)** A second real bug found live right after (2b)'s own fix
  shipped: that fix unconditionally retried the modify() call whenever
  the first one retracted focus exactly onto the anchor — correct when
  the anchor sits on the SAME line the call started on (a trivial
  same-line retraction, nothing moved yet), but wrong once a chain of
  reversals puts the anchor on a genuinely DIFFERENT line: retracting
  onto it there already IS the real, complete one-line move, and
  retrying anyway continued past the anchor into a further line, silently
  skipping one entire visual line on every SECOND reversal in a row
  (e.g. Ctrl-F, Ctrl-P, Ctrl-N chained together). Fixed by only retrying
  when the first call's own retraction did NOT already cross a visual
  line boundary. Needs a title wrapping across 3+ visual lines — (2b)'s
  own 2-line title can't distinguish this bug from (2b)'s own fix.
- **(3)** Kill line clears the mark and kills from the cursor (focus),
  not from the selection's own range-start — another real bug this
  surfaced: `titleKillLine` used to read `getRangeAt(0)`'s own
  `startOffset` directly, which is the range's lower-order boundary, not
  necessarily point/focus, whenever the mark's anchor sits after its
  focus. Fixed by collapsing to focus first, same pattern `titleKillWord`
  already used.
- **(4)** Ctrl-G (keyboard-quit) clears the mark and collapses to focus,
  WITHOUT leaving the title — deliberately not mirroring native physical
  Escape's own behavior there (confirmed live: it blurs the title
  entirely, jumping back to wherever the cursor was in the body before
  the title was ever entered, untouched Obsidian-native behavior — see
  the bare-ESC Key Upgrade revert note elsewhere in `src/main.ts`). Set-
  mark cancellation only, nothing else.

#### `titleRegion.e2e.ts`

Ctrl-W (Kill region) / Alt-W (Copy region) in the title field. Unlike the
body's own `killRegion`/`copyRegion` (which need multi-cursor handling),
these operate on whatever native Selection is currently active regardless
of how it got there (Set-mark extend, a mouse drag, Shift+Arrow) — a
native Selection only ever has one range, so there's no per-range loop
needed at all.

- **(1)** Copy region copies the Set-mark selection without mutating the
  title, and clears the mark.
- **(2)** Kill region deletes the Set-mark selection, kills it (no
  chaining with any prior kill-ring content — always overwrites, same as
  the body's own convention), and clears the mark.
- **(3)** The direct confirmation that this isn't special-cased to
  Set-mark-created selections: Kill region correctly operates on a native
  Selection built directly via `setBaseAndExtent` (a mouse-drag
  equivalent), with Set-mark never pressed at all.

#### `titleYank.e2e.ts`

Ctrl-Y (Yank) in the title field — the last item in the Kill/Yank roadmap.
`titleYank` uses `document.execCommand('insertText', false, text)` —
confirmed live (via a throwaway probe comparing it against a real
`ClipboardEvent('paste', ...)`) to behave identically to native Cmd-V
paste in the title for an embedded (non-trailing) newline, dropping it
entirely rather than replacing it with a space. But a kill-ring entry
ENDING in a newline hits a genuine Chromium contenteditable bug on
insert, confirmed live to affect a real native Cmd-V paste identically
(not just this plugin's own `execCommand` call) — see test (5). Unlike
the body's own `yank`/`yankOuter` (which needs per-range multi-cursor
handling and Markdown-table/list-marker-dedup logic), the title only ever
has one native Selection, and `execCommand('insertText')` already does
the right thing whether the selection is collapsed or not.

- **(1)** Yank inserts the kill-ring content at a collapsed cursor
  position, and clears an active Set-mark (`markActive`) and
  `isKillChaining`, same convention as every other title-mutating command.
- **(2)** Yank replaces an active, non-collapsed native selection (built
  directly via `setBaseAndExtent`, not Set-mark) instead of inserting at a
  point — confirms `execCommand('insertText')`'s documented
  selection-replacement behavior holds in this context.
- **(3)** Cross-context round trip: Kill line in the BODY populates the
  shared kill-ring (`killCache`), then Yank in the TITLE retrieves it —
  the reverse direction of `titleKillLine.e2e.ts` test (3) (title kills,
  body yanks). Confirms the kill-ring is genuinely shared plugin-level
  state, not duplicated per context.
- **(4)** Yank integrates with the title's own native undo stack (Ctrl-Z
  right after a Yank restores the pre-yank text), same pattern already
  confirmed for Kill line/Kill word/Kill region.
- **(5)** Regression for a real bug found live: a kill-ring entry
  ending in a newline (e.g. two Ctrl-Ks in the body — first kills the
  line's own text, second kills the line break itself) corrupts the
  title's native Selection on insert if the newline reaches
  `execCommand('insertText')` unstripped — the selection's focus/anchor
  land on the title's own container `<div>` instead of its text node, and
  the title's native undo stack silently stops working for every
  subsequent edit. Confirmed via a throwaway repro probe to affect a real
  native Cmd-V paste of the same content identically, so `titleYank` now
  strips newlines itself before calling `execCommand('insertText')`
  rather than trusting the browser. This test asserts both halves: the
  resulting selection lands on a real text node, and undo still works
  right after.
- **(6)** Yank prefers the real OS clipboard over `killCache` when they
  diverge — simulates copying something outside Obsidian after an earlier
  in-app kill (`killCache` is set directly, without touching the
  clipboard, and the inserted text is the clipboard's own value).
  Confirms `titleYank`'s `clipboard.readText()`-first design actually
  takes effect, not just that it happens to agree with `killCache` in
  every other test (which always seeds both to the same value).
- **(7)** Yank falls back to `killCache` when
  `navigator.clipboard.readText()` throws — monkey-patches `readText` to
  reject for the duration of the test (restored in a `finally` so it
  doesn't leak into later tests sharing this same Obsidian instance),
  exercising the one branch of `titleYank`'s own try/catch that every
  other test leaves untouched (`readText()` always succeeds in this E2E
  harness otherwise).
- **(8)** Strips an embedded (non-trailing) newline too, e.g. "AB\nCD" —
  distinct from test (5)'s trailing-newline case: a multi-line body Kill
  region would produce a kill-ring entry with a newline in the middle, not
  just at the end. Same regression guard as test (5) (selection lands on
  a real text node, undo still works).
- **(9)** Yank is a safe no-op when the kill-ring is empty (both
  `killCache` and the clipboard) — covers `titleYank`'s own early-return
  guard.

#### `titleKillYankPopout.e2e.ts`

Confirms Set-mark, Kill region, and Yank in the title field all work
inside a popout window's own separate document. `titleCrossingPopout.e2e.ts`
already covers this for pure cursor movement (Ctrl-P/N); the title Scope's
per-window registration (`registerWindowDomListeners`, wired through
`app.workspace.on('window-open', ...)`) was designed to cover every title
command in a popout "for free," but `titleKillLine.e2e.ts`/
`titleKillWord.e2e.ts`/`titleSetMark.e2e.ts`/`titleRegion.e2e.ts`/
`titleYank.e2e.ts` only ever run against the main window, so that
architectural expectation had never actually been exercised for anything
content-mutating. Rather than duplicating each of those specs' own
assertions a second time inside a popout, this is a single combined test
chaining Set-mark extend → Kill region → Yank (round-trips back to the
exact original title) → Kill line, in one popout session — enough to
prove the shared mechanism isn't accidentally scoped to the main window
only, without re-testing logic already covered elsewhere.

1. Popout window support

### Frontmatter Properties panel (0.13.0 Feature 1)

#### `propertyItemSelection.e2e.ts`

Phase 1 of the frontmatter sub-phase: Ctrl-N/P drive the same row-to-row
focus navigation a Properties-panel row's own "item selection mode"
already does for physical ArrowUp/ArrowDown. Item selection mode is
reached by pressing Escape twice from inside a property's text-editing
state — confirmed live this collapses `document.activeElement` to the
`.metadata-property` row DIV itself (`tabIndex=0`), distinct from any of
its own text-editing descendants having focus. The pushed Scope is keyed
to an EXACT match on the row element (not `.closest()`), specifically so
ordinary text editing inside a property never activates this
row-navigation scope. Ctrl-N/P dispatch a synthetic native
ArrowDown/ArrowUp `KeyboardEvent` on the focused row rather than
hand-rolling sibling-element lookup + `.focus()` — the boundary behavior
(tests (2)/(3)) is whatever Obsidian's own native handler already does,
confirmed live: ArrowUp at the first row moves to the "Properties"
heading above; ArrowDown at the last row moves to the "Add property"
button below. Neither is UCH-authored, just inherited for free.

- **(1)** Ctrl-N/P move focus between sibling property rows in order.
- **(2)** Ctrl-P at the first row moves to the Properties heading, same
  as physical ArrowUp.
- **(3)** Ctrl-N at the last row moves to the Add-property button, same
  as physical ArrowDown.
- **(4)** Ctrl-N/P do nothing to row focus while ordinary text editing is
  active (not item-selection mode) — the direct regression coverage for
  the exact-match (not `.closest()`) Scope-push condition.
- **(5)** Ctrl-N at the Properties heading moves into the first property
  row — confirms the heading is a full member of the navigable chain,
  not a dead end. **Real symptom found on Windows
  (2026-11-04), fix NOT YET CONFIRMED**: the original implementation
  (`bind('cursor-down', 'ArrowDown', undefined, ...)`, no heading
  handler at all — a plain synthetic ArrowDown dispatch on the heading,
  trusting Obsidian's own native handler to move focus into the first
  row) reportedly didn't move focus on Windows at all, even with a
  byte-identical build confirmed against macOS (verified on both
  Obsidian 1.14.5 and 1.15.0 there, neither reproduced it — root cause
  on Windows still unconfirmed). Since this dispatch-and-trust behavior
  existed unchanged since this plugin's very first heading/Add-button
  support, any real gap here isn't something introduced by the later
  `propertyHeadingCtrlN` goal-column work. Changed to focus the first
  `.metadata-property` row directly instead of dispatching and hoping —
  strictly more robust regardless of whether it resolves the Windows
  symptom, since it drops the dependency on how Obsidian's own handler
  processes a synthetic event. This test's own assertion (focus lands on
  the first row) didn't need to change, only the mechanism reaching that
  result did.
- **(6)** Ctrl-P at the Add-property button moves into the last property
  row — same, for the Add-button.

Note on test helper structure: `enterItemSelectionMode`'s focus + two
Escape presses are bundled into a single `executeObsidian` call rather
than three separate round trips — confirmed live that the multi-round-trip
style can intermittently race with the Properties panel still settling
right after a freshly (re-)opened note, specifically affecting tests
(2)/(3) only when run immediately after test (1) in the same shared
instance (passed in isolation, failed in file order) — a single bundled
script has no such gap.

#### `propertyCtrlBf.e2e.ts`

Phase 2 of the frontmatter sub-phase: Ctrl-B/F in Properties-panel
item-selection mode delegate straight to native ArrowLeft/ArrowRight, the
same pattern `propertyItemSelection.e2e.ts` uses for Ctrl-N/P. Unlike
Ctrl-N/P, no custom per-element handler is needed anywhere in this
chain — confirmed live before writing these tests (red-green: these
tests were written and run against the pre-fix code first, confirming
they failed for the right reason, before the one-line `buildPropertyRowScope`
addition that makes them pass):

- `.metadata-properties-heading`: Left collapses, Right expands the
  whole Properties block. **Not a toggle** — Right at an already-expanded
  heading, and Left at an already-collapsed one, are both a confirmed
  no-op.
- `.metadata-property`: Left enters the row's own native name-edit mode
  (always an `<input class="metadata-property-key-input">`, regardless of
  property type), Right enters its value-edit mode (the widget varies by
  type — e.g. a contenteditable `.metadata-input-longtext` DIV for text,
  a plain `<input>` for number).
- `.metadata-add-button`: both directions are a confirmed no-op.

Also confirmed live: the number of Escape presses needed to return from
an edit mode back to the row varies by property type AND direction (text:
2 for both name- and value-edit; number/tags value-edit: 1) — this is
Obsidian's own native behavior, not something this feature controls, so
test (1) below uses an adaptive `returnToRow()` helper (presses Escape up
to 3 times, checking after each) instead of a hardcoded count.

- **(1)** Ctrl-B enters native name-edit mode; after returning to the row
  via Escape, Ctrl-F enters native value-edit mode — exercises both
  directions on the same row, with the Escape-back step in between.
- **(2)** Ctrl-B at the Properties heading collapses the panel.
- **(3)** Ctrl-F at the Properties heading expands a collapsed panel, and
  is confirmed a no-op on a second press once already expanded (not a
  toggle).
- **(4)** Regression, **updated 2026-11-05**: Ctrl-B/F while actually
  editing the value text move the cursor WITHIN it (reusing
  `titleMoveChar`, same as the title field) rather than doing nothing or
  changing which element has focus — this used to assert the opposite
  (did nothing at all) before `propertyRowScope`'s own push/pop condition
  was broadened to also cover the value-edit widget for
  `propertyValueEditMovement.e2e.ts`'s own work; the row-focus guard
  itself (name-edit entry / row navigation NOT triggered) still holds,
  only the "nothing happens at all" half of the old claim changed.
- **(5)** Regression: a note WITHOUT frontmatter is unaffected — Ctrl-B
  still moves the body cursor one character left.
- **(6)** Regression: Ctrl-B/F at the Add-button are a no-op (matches
  native).

#### `propertyCtrlG.e2e.ts`

Phase 3 of the frontmatter sub-phase: Ctrl-G (`keyboard-quit`) in
Properties-panel item-selection mode delegates straight to native
Escape, the same "delegate to native key" pattern Ctrl-B/F and Ctrl-N/P
already use for this panel. Unlike cursor-up/down, there's no
goal-column concern here at all — confirmed live before writing these
tests: native Escape from ANY element in the chain (a row, the heading,
the Add-button — panel expanded or collapsed, doesn't matter) simply
returns DOM focus to the body. CM6's own cursor position was never
touched while focus was in Properties (entering item-selection mode
never moves it), so it's restored exactly where it already was. Built
red-green: these tests were written and run against the pre-fix code
first (4 of 6 failing — Ctrl-G simply wasn't intercepted, so focus never
left Properties at all), then the one-line `buildPropertyRowScope`
addition made all 6 pass.

- **(1)** Ctrl-G on a property row escapes to the body, restoring its
  own existing cursor position (not a fixed one).
- **(2)** Ctrl-G at the Properties heading escapes to the body the same
  way.
- **(3)** Ctrl-G at the Add-button escapes to the body the same way.
- **(4)** Ctrl-G at the heading, panel COLLAPSED, still escapes to the
  body the same way — collapsed treated as a normal-case variant from
  the start, not a reactive edge case.
- **(5)** **Updated 2026-11-05**: Ctrl-G also escapes from inside the
  value-edit widget itself, back to item-selection mode — this used to
  assert the opposite (scoped out, confirmed unreachable at the time).
  That earlier finding was based on testing with synthetic
  `dispatchEvent()` calls, which turned out to be an unreliable way to
  test anything touching Obsidian's own Keymap resolution; real
  `browser.keys()` presses, combined with correctly broadening
  `propertyRowScope`'s own push/pop condition (done for
  `propertyValueEditMovement.e2e.ts`'s work), show it reaching fine. See
  that spec's own file-level comment and project memory
  (`project_property_value_edit_real_key_interception_dead_end`) for the
  full corrected mechanism.
- **(6)** Regression: a note WITHOUT frontmatter is unaffected —
  Ctrl-G still clears an active Set-mark selection in the body exactly
  as before.

**(7) added 2026-11-07, found while verifying Bases support**: the
property-name-edit phase's own bare-Escape pass-through registration in
`buildPropertyRowScope` checked "is this the key-edit input?" and
swallowed every other target otherwise — including a text value widget
with NO hotkey assigned to `keyboard-quit` at all, the true
out-of-the-box default. Before that phase shipped, nothing was
registered for bare Escape unless `keyboard-quit` itself had a hotkey,
so a genuine external Escape always fell through to each widget's own
native handling untouched. Fixed by checking the OPPOSITE condition:
swallow ONLY for item-selection mode's own row/heading/Add-button
(still required by tests (1)-(6) above and
`propertyItemSelection.e2e.ts`), defer to native for every other
value-editing widget regardless of type — this also covers Bases' own
cells for free (same classes, see `basesPropertyEditing.e2e.ts`). Built
red-green: confirmed failing against the old (key-edit-only) condition,
passing after.

#### `propertyKeyUpgradeInterference.e2e.ts`

Real bug found testing on Windows (2026-11-05) with the
"↓↑ column-aware" Key Upgrade enabled (bare ArrowUp/ArrowDown also bound
to `cursor-up`/`cursor-down`, alongside Ctrl-N/P). `buildPropertyRowScope`'s
own `bind()` helper iterates EVERY effective hotkey for a command via
`getEffectiveHotkeysFor()` — which then also picks up that Key Upgrade's
own bare-arrow hotkey, registering a Scope handler for it too. Since
Ctrl-N/P's own native-delegation mechanism is to dispatch a SYNTHETIC
bare `ArrowDown`/`ArrowUp` as its own last step, that synthetic dispatch
re-enters this SAME scope's own just-registered handler for that exact
(no modifiers, key) combo — confirmed live this silently swallows the
whole chain: the real native row navigation never actually runs at all,
with symptoms matching exactly what was reported (row-to-row navigation
completely dead; heading<->first-row only worked in the direction
`propertyHeadingCtrlN`'s explicit `.focus()` fix from the day before
happened to sidestep, by coincidence, since it doesn't dispatch anything;
body<->Add-button worked because that crossing's own code path is
largely outside this scope). Could not reproduce on macOS until
deliberately replicating the Key Upgrade's exact hotkey configuration
via `hm.setHotkeys()` — once replicated, reproduced immediately and
consistently.

Fixed by skipping registration of exactly the hotkey that would
self-collide with the dispatch key (`hk.modifiers.length === 0 &&
hk.key === key`), not bare hotkeys in general — a vim-style bare 'j'/'k'
binding to the same command is completely unaffected, since dispatching
`'ArrowDown'` from a `'j'`-triggered handler doesn't re-enter anything
registered under `'j'`. Built red-green: written and confirmed failing
against the pre-fix code first (via `git stash`, rebuilding, re-running,
then restoring the fix), all 3 failing for the right reason before the
fix made them pass.

- **(1)** Ctrl-N/P still move focus between sibling property rows when
  the bare ArrowUp/Down Key Upgrade is also enabled.
- **(2)** Ctrl-P from the first row still reaches the heading, with the
  Key Upgrade enabled.
- **(3)** Ctrl-N from the Add-button still lands on the body's real
  first line (ch 0), with the Key Upgrade enabled — NOT a "restore the
  previous cursor position" operation (that's Ctrl-G/Escape's own job);
  this test's first draft asserted the wrong expected value by
  conflating the two, caught by the test itself failing even after the
  real fix landed.

**Resolved on its own, not investigated further**: a separate, likely
cosmetic observation from the same Windows report — with the Key Upgrade
OFF entirely, the Add-button's own focus ring didn't visually render
when it should be focused. The user confirmed this stopped happening by
the time this was revisited — no code change was made for it, so it was
presumably a transient rendering/`:focus-visible` quirk rather than a
real bug.

#### `propertyValueEditMovement.e2e.ts`

0.13.0 Feature 1, property-value-editing sub-phase, Phase 1: Ctrl-F/B
(char move) and Ctrl-A/E (line boundary) inside a text property's own
value-edit widget (`.metadata-input-longtext`, a contenteditable DIV —
confirmed live this is the exact same widget Bases table cells use for
inline text editing too, so this feature covers Bases for free, no extra
code). Reuses `titleMoveChar`/`titleMoveToLineBoundary` as-is from the
title field's own implementation — both already operate purely through
`Selection.modify()` on the element's own `ownerDocument`, with no actual
title-specific assumption baked in.

**A full architecture dead-end, then a correction, on the way here** (see
project memory `project_property_value_edit_real_key_interception_dead_end`
for the complete writeup): an EARLIER attempt (Phase 0, on a now-deleted
branch) built a raw `view.containerEl` keydown listener, based on a
finding that Obsidian blocks Ctrl-modified keydowns from this widget
before they reach `app.keymap`. That finding turned out to be a
**synthetic-`dispatchEvent()` testing artifact** — reading Obsidian's own
app bundle directly (`strings`/`grep` on the cached `.asar`, no
extraction tool needed) found its `Keymap` class registers exactly one
`window`-level capture `keydown` listener (`onKeyEvent`) at app startup;
it checks the CURRENT scope for the active window, and if nothing is
pushed, that's the ROOT scope — which already has the real global
command hotkey registered, so it wins the race before any
`view.containerEl` listener ever gets a chance, **regardless of widget
type**. Pushing an actual `Scope` (exactly what `propertyRowScope`
already does for item-selection mode) gets checked FIRST instead,
confirmed live with real `browser.keys()` presses (not synthetic
dispatch, which gave unreliable, inconsistent results for this whole
investigation).

**A second, real timing bug found building the corrected version**: this
widget pushes its OWN `Scope` on focus too (bare Arrow/PageUp/PageDown/
Home, for its own multi-line text navigation) — pushing
`propertyRowScope` synchronously on `focusin` lost the race against it,
landing our push BEFORE the widget's own (confirmed live via the window
scope stack's own `prevScopes`/`scope` state), burying ours underneath
with no parent-chain fallback to ever reach it. Fixed with the same
2-RAF defer pattern already used elsewhere in this file for analogous
focus-settling races (e.g. `addCursorOnView`'s own call site) — deferring
`propertyRowScope`'s push by one frame, specifically for this widget,
lets the widget's own push land first.

- **(1)** Ctrl-F moves the cursor one character right.
- **(2)** Ctrl-B moves the cursor one character left.
- **(3)** Ctrl-A moves to the start of the value.
- **(4)** Ctrl-E moves to the end of the value.
- **(5)** Regression: a bare (no Ctrl) `"f"` keypress still types
  normally, not intercepted as movement.
- **(6)** Regression: Ctrl-N/P on a value with only ONE visual line are
  a true no-op (the cursor doesn't jump to an end) — see below for why
  this test's own framing changed.
- **(7)** Ctrl-N/P move by VISUAL line within a wrapped value, and stop
  at its own first/last visual line.
- **(8)** Regression: a note WITHOUT frontmatter is unaffected —
  Ctrl-N/P still move the body cursor between real lines.

Also found and fixed along the way: `propertyCtrlBf.e2e.ts`'s own test
(4) and `propertyCtrlG.e2e.ts`'s own test (5) both asserted the OLD,
now-incorrect behavior (Ctrl-B/F/G doing nothing from inside the
value-edit widget) — both updated to confirm the new, correct behavior
instead, in the same commit as this spec.

**2026-11-06, Ctrl-N/P added**: a real gap surfaced in this
spec's own original test (6), which had locked it in as "intended" — a text
property's value-edit widget (`.metadata-input-longtext`, i.e.
"longtext") genuinely word-wraps across multiple VISUAL lines, so
Ctrl-N/P (previous/next line) has real meaning there, unlike the
title field. Added by reusing `titleMoveLine` as-is (already generic
over any `HTMLElement`), wrapped in a new `propertyValueEditMoveLine`
that restores the prior anchor/focus pair whenever `titleMoveLine`
reports no movement.

**A real bug found while adding this**: `titleMoveLine`'s own `false`
return ("no line to move to") does NOT mean the selection was left
untouched — confirmed live its internal
`Selection.modify('move', dir, 'line')` call still mutates the real
selection (jumping to the value's own end/start) even when the
function decides afterward there's no visual-line change to finish
landing on. This was invisible for the title field's own Ctrl-N/P (the
only existing caller before this): a `false` there always leads to
escaping to the body/heading, which replaces the selection anyway, so
the modify() call's own side effect never mattered. The value-edit
widget has nowhere to escape to (every other command here is
deliberately within-widget-only), so a boundary press needed a TRUE
no-op — `propertyValueEditMoveLine` captures the anchor/focus pair
before calling `titleMoveLine` and restores it via `setBaseAndExtent`
whenever that call reports no movement. Test (6)'s own original
assertion (`focusOffset` unchanged) is what caught this — it started
failing (`Expected: 5, Received: 11`, jumped to the value's own end)
the moment Ctrl-N/P were first wired up, before this fix landed. Built
red-green: confirmed failing against the pre-fix build, passing after.

#### `propertyValueEditSetMark.e2e.ts`

0.13.0 Feature 1, property-value-editing sub-phase, Phase 2: Set-mark
(Ctrl-Space) inside a text property's own value-edit widget. Reuses
`titleSetMark` as-is from the title field's own implementation — it arms
`markActive` and collapses the native Selection to its own current focus
(the anchor point); `titleMoveChar`/`titleMoveToLineBoundary` (shipped in
`propertyValueEditMovement.e2e.ts` above) already check `markActive` via
`titleSelectionModify`'s own `'extend'` vs `'move'` branch, so movement
immediately starts extending a real selection once armed, confirmed live
before writing these tests by calling the plugin's own private methods
directly. Also extends `keyboard-quit` (Ctrl-G, already shipped) with a
value-edit-specific handler: real Emacs's C-g is a universal ABORT, so it
must also clear any armed mark (reusing `titleKeyboardQuit`) before doing
the native-Escape exit everything else in this panel already does.

**A real bug found while writing test (6)** (regression: Ctrl-Space on
the plain row should be a harmless no-op): `bind()`'s native-dispatch
fallback — used whenever a bound key's target doesn't match any of
`valueEditHandler`/`headingHandler`/`addButtonHandler` — only ever
constructed `new KeyboardEvent('keydown', { key, ... })`, dropping every
modifier flag from the real triggering event. For Arrow/Escape (every
other command bound here) this went unnoticed, since neither has
modifier-sensitive native behavior on a row. Set-mark's own key (Space)
is different: confirmed live via a diagnostic probe (dispatching a bare
Space directly on a focused row) that Obsidian's own row listener treats
a bare Space keydown as "start typing," moving focus straight into the
value-edit widget and inserting it — so a real Ctrl+Space press on the
row was silently re-dispatching as a bare Space and switching into edit
mode, the exact "accidental mode switch" this plugin should never cause.

An initial, broader fix attempt (passing the real event's modifier flags
through on every fallback dispatch, not just this one) was tried and
reverted — it broke the Arrow/Escape delegation other already-shipped
tests depend on (native row-to-row navigation and native Escape-exit
apparently only match an *unmodified* key on their own internal
listeners; adding `ctrlKey: true` to those dispatches made them silently
stop working, confirmed by a full regression run before reverting).
**Final fix**: a new `suppressFallback` parameter on `bind()`, set only
for the `set-mark` call — when a target matches none of the three
handlers, the fallback dispatch is skipped entirely (a true no-op)
instead of falling through to a native dispatch that was never actually
harmless for this one key.

- **(1)** Ctrl-Space then Ctrl-F extends a real selection forward.
- **(2)** Ctrl-Space then Ctrl-B extends a real selection backward.
- **(3)** Ctrl-Space then Ctrl-A extends the selection to the start of
  the value.
- **(4)** Ctrl-Space then Ctrl-E extends the selection to the end of the
  value.
- **(5)** Ctrl-G clears an active mark AND exits to item-selection mode,
  in one press.
- **(6)** Regression: Ctrl-Space on the row itself (item-selection mode)
  does nothing — the test that caught the fallback-dispatch bug above.

#### `propertyValueEditKillYank.e2e.ts`

0.13.0 Feature 1, property-value-editing sub-phase, Phase 3: Kill-line
(Ctrl-K), Kill-region (Ctrl-W), Copy-region (Alt-W), and Yank (Ctrl-Y)
inside a text property's own value-edit widget. Reuses
`titleKillLine`/`titleKillRegion`/`titleCopyRegion`/`titleYank` as-is
from the title field's own implementation — all four already operate
purely through the Selection API on the element's own `ownerDocument`,
with zero title-specific assumption baked in, same precedent as every
other value-edit handler shipped in `propertyValueEditMovement.e2e.ts`/
`propertyValueEditSetMark.e2e.ts`. Kill-word (Alt-D/Alt-Backspace) is
deliberately NOT included — out of scope per this sub-feature's own
explicit scope decision. All four are bound with
`suppressFallback` (see `propertyValueEditSetMark.e2e.ts`'s own section
above for why) — their base keys are plain letters, same dropped-
modifier risk Set-mark's own Ctrl-Space already found and fixed.

**Two real bugs found while writing this spec, both in the TEST itself,
not the implementation**:
- An initial `pressCtrl` helper hardcoded its dispatch target to the
  value-edit widget (copied from `titleRegion.e2e.ts`/`titleYank.e2e.ts`'s
  own pattern, where that's correct — the title only ever has one
  possible target). Test (6) below (the row no-op regression) focuses
  the plain row instead, so hardcoding the dispatch target made it
  silently test the wrong element the whole time, passing for the wrong
  reason. Fixed by dispatching on `document.activeElement` instead —
  whatever currently has real DOM focus, matching how a real keypress
  actually targets.
- Tests seeding `killCache` directly (to control what Ctrl-Y inserts)
  forgot that `titleYank` (reused here) prefers the real OS clipboard
  over `killCache` when they diverge — confirmed behavior, already
  covered by `titleYank.e2e.ts`'s own test (6). A leftover clipboard
  value from an earlier test in this same shared instance (Copy
  region's own `navigator.clipboard.writeText` call) won every time
  until the test also seeded the clipboard directly, matching
  `titleYank.e2e.ts`'s own `openNote` precedent.

- **(1)** Ctrl-K kills from the cursor to the value's own end, into the
  shared kill-ring.
- **(2)** Ctrl-W (Kill region) deletes the Set-mark selection and clears
  the mark.
- **(3)** Alt-W (Copy region) copies the Set-mark selection without
  mutating the value, and clears the mark.
- **(4)** Ctrl-Y inserts the kill-ring content at a collapsed cursor.
- **(5)** Ctrl-Y replaces an active (non-collapsed) selection instead of
  inserting at a point.
- **(6)** Regression: Ctrl-K/Ctrl-W/Ctrl-Y on the row itself
  (item-selection mode) do nothing — the test that caught the
  hardcoded-dispatch-target bug above.
- **(7)** Cross-context: Kill line in the body populates the shared
  kill-ring, Yank in the value-edit widget retrieves it — same
  shared-kill-ring confirmation as `titleKillLine.e2e.ts`'s own test (3)
  and `titleYank.e2e.ts`'s own test (3), now for the Properties
  value-edit widget specifically.

**A real, substantial bug found AFTER this commit shipped, from
real-machine usage**: pressing Ctrl-A → Ctrl-K → Ctrl-Y
twice in a row left the cursor completely unresponsive — including
Ctrl-G, which had been working fine up to that point — with only a
physical Escape press able to recover. Confirmed live via a throwaway
diagnostic spec (dumping `app.keymap`'s own window-scope stack —
`getWindowStack(activeWindow).scope` — at every step of the repro, read
by reconstructing the internal field names
`.scope`/`.prevScopes`/`.parent` first identified while investigating
the original property-value-editing architecture, see
`project_property_value_edit_real_key_interception_dead_end` in the
assistant's own memory): Obsidian's own property-value suggestion
dropdown (visible the moment the widget gets focus, suggesting
previously-used values for that property key) reacts to the real
`input` event Ctrl-K/Ctrl-Y's own `execCommand` triggers by pushing ITS
OWN `Scope` on top of `propertyRowScope`. DOM focus never actually left
the value-edit widget (confirmed: `document.activeElement` stayed the
same throughout), so `propertyRowScope` was still technically pushed —
just shadowed underneath the suggester's own scope, silently breaking
every command bound here until a physical Escape closed the dropdown
and popped its scope as an unrelated side effect of Obsidian's own
code.

Also checked and ruled out as a separate concern during the same
investigation: `titleKillLine`'s own `execCommand('delete')`, when it
empties this specific widget completely, leaves behind a literal stray
`"\n"` in the DOM (confirmed live — this widget is Obsidian's own
multi-line-capable contenteditable, unlike the title field's single-line
one, where this was never observed) — but this is purely a transient
DOM-rendering artifact, confirmed NOT to reach the real saved file
(read back directly via `app.vault.read` after blurring away from the
widget: the frontmatter correctly serializes to an empty `myText:`,
with no stray newline). No fix needed for this part.

**Fix**: a new `reclaimPropertyRowScopeAfterMutation` method (see its
own comment in `main.ts`), called after every mutating value-edit
command (`kill-line`/`kill-region`/`yank` — `copy-region` never
mutates the DOM, so it never triggers the dropdown's reactive push and
needs no reclaim). After a 2-frame defer (same margin used elsewhere in
this file for analogous focus/render-settling races — long enough for
the suggester's own reactive push to have already happened), it checks
whether the window's current scope is still ours; if something else
has taken over, it pops THAT scope specifically. **Confirmed live this
is the correct fix shape, not just "any fix that passes"**: an earlier
attempt that instead force-pushed a fresh copy of `propertyRowScope` on
top also recovered Ctrl-G, but would have left a stale duplicate
sitting in `prevScopes` forever (the suggester's own eventual
`popScope` call for its own scope would then find itself no longer on
top and silently no-op, leaking the stack) — popping the foreign scope
directly instead restores `propertyRowScope` to the top cleanly, with
no leftover growth, confirmed via the same diagnostic's own
`prevScopes.length` reading before and after.

- **(8)** Regression: repeated Ctrl-A/Ctrl-K/Ctrl-Y cycles don't let the
  suggestion dropdown shadow the Scope — the round trip stays lossless
  AND Ctrl-G still works afterward. Built red-green: confirmed failing
  (`Expected: true, Received: false`) against the pre-fix build before
  implementing `reclaimPropertyRowScopeAfterMutation`, passing after.

#### `propertyValueEditKillWord.e2e.ts`

0.13.0 Feature 1, property-value-editing sub-phase: Kill word left/right
(Alt-Backspace / Alt-D) inside a text property's own value-edit widget.
Reuses `titleKillWord` as-is from the title field's own implementation —
already generic over any `HTMLElement` via its own `ownerDocument`'s
Selection API, same precedent as every value-edit handler shipped
earlier in this sub-feature. This command was initially scoped OUT of
property-value-editing entirely (an explicit decision when
the sub-feature was first scoped), then revisited once a side-by-side
comparison against the title field's own command set surfaced the gap
— the title already had Kill word, property-value-editing didn't,
with no principled reason for the asymmetry once noticed.

Same CJK finding as `titleKillWord.e2e.ts` applies here unchanged (same
underlying function, same native `Selection.modify('extend', ...,
'word')` mechanism) — confirmed live via test (3), not just assumed
from the title's own already-passing result.

`suppressFallback` is set (same reasoning as every other mutating
value-edit command here) and `reclaimPropertyRowScopeAfterMutation` is
called afterward (same mutating-command treatment as kill-line/
kill-region/yank — Obsidian's own property-value suggestion dropdown
can shadow `propertyRowScope` after any real mutating `execCommand`,
see `propertyValueEditKillYank.e2e.ts`'s own section above for the
full writeup).

- **(1)** Alt-D kills one word forward.
- **(2)** Alt-Backspace kills one word backward; a true no-op at the
  value's own start.
- **(3)** CJK: a run of kanji/hiragana is split word by word via the
  widget's own native word-boundary logic, same as the title field.
- **(4)** Regression: Alt-D/Alt-Backspace on the row itself
  (item-selection mode) do nothing.

Built on a fresh `feat/property-kill-word` branch, the first of three
planned branches closing the remaining title/property-value-editing
command-parity gaps (Kill word here; Delete char and Word left/right —
both entirely new for both contexts, not just a property-side
reuse — planned as two further branches). All 4 tests passed on the
first run (expected: pure reuse of an already-proven function, no new
mechanism). A full-suite run immediately after this branch's work hit
a broad, unrelated failure cluster (propertyCtrlBf/G, Set-mark, Kill/
Yank, titleCrossingFrontmatter, etc. — not just this new file) with
every affected spec's own runtime inflated 5-10x normal (e.g. Set-mark
30s → 3m 41s) — traced to the test Electron window not being visible/
focused during an unattended background run (frontmost app was
Terminal), matching the already-documented
`requestAnimationFrame`-throttling-while-hidden mechanism (see
[[feedback_e2e_check_machine_awake_before_debugging]]/
`setMarkBufferEdge.e2e.ts`'s own note on this). Re-running the exact
same regression set with the window actually visible came back fully
clean (61/61, normal runtimes) — confirmed not a real regression.

#### `titleCrossingFrontmatter.e2e.ts`

Extends the already-shipped title<->body crossing
(`titleCrossingShort.e2e.ts`/`titleCrossingWrapped.e2e.ts`) to route
through the Properties panel instead, whenever the note actually has
frontmatter. Building this surfaced a real, substantial bug found and
fixed along the way, not just new feature code:

- **Pre-existing bug, unrelated to this feature**: both crossing sites
  (the `cursor-up` handler's own call to `escapeUpToTitle`, and
  `titleMoveLineOrEscapeToBody`) hardcoded "line 0"/position 0 as "the
  body's own first line." When frontmatter exists, position 0 is the
  frontmatter's own opening `---`, not real body content — Live Preview
  silently clamps any attempt to place a cursor there to the real first
  body line, so the old `cursor.line === 0` check could never be
  satisfied and Ctrl-P at the top of a frontmatter-having note's body did
  nothing at all. Fixed with a new `getFirstBodyLine()` helper (reads
  `frontmatterPosition` from the file's cached metadata).
- **A second, more dangerous bug found while building the fix itself**:
  the first attempt checked `.metadata-properties-heading`/
  `.metadata-add-button`'s mere DOM PRESENCE to decide "does a Properties
  panel exist to redirect to." Confirmed live this is wrong — both
  elements exist in the DOM (just hidden, `offsetParent === null`) even
  for a note with **no frontmatter at all**, so that check wrongly
  redirected `.focus()` to a hidden, unfocusable element on every
  frontmatter-less note, silently breaking the ALREADY-SHIPPED
  title<->body crossing for the common case. Test (4) below is the
  direct regression catch for this — it failed before the fix (checked
  via `getFirstBodyLine() > 0` AND `offsetParent !== null` together
  instead of DOM presence alone), confirming it as a real regression,
  not a hypothetical one.
- **A third real bug, found testing with a third-party
  title-caret plugin installed**: focusing the heading alone does NOT
  clear `window.getSelection()` — it silently kept pointing at the
  title's own old position (confirmed live: `rangeCount` stayed `1`,
  `anchorNode` still inside the title), which that third-party plugin
  (reading the native Selection directly, independent of this plugin's
  own DOM focus) kept rendering a stale cursor from, visible until the
  Selection changed again elsewhere entirely (e.g. once the real cursor
  reached the body). CM6's own cursor rendering is unaffected by this
  (it's independent of `window.getSelection()`), so this never showed up
  as a UCH-visible symptom — only a plugin that reads the raw Selection
  for its own rendering would notice. Fixed by explicitly clearing it
  (`removeAllRanges()`) in the same branch that moves focus to the
  heading. Test (1) below asserts this directly.
- **A fourth real bug**: the fix for the second bug above
  only ever checked the Add-button's own visibility to decide "land in
  Properties." Confirmed live that COLLAPSING the Properties panel hides
  the Add-button (and every row) — `offsetParent` becomes `null` — but
  the heading itself stays visible, just gaining an `is-collapsed` class.
  So a collapsed (but still genuinely present) Properties panel fell all
  the way through to `escapeUpToTitle`, skipping Properties entirely even
  though it's still visibly there, just closed. Fixed by falling back to
  the heading when the Add-button isn't usable but the heading still is.
  Test (3b) below is the direct regression catch.
- **A fifth real bug**: `getFirstBodyLine()` read
  `frontmatterPosition` unconditionally, regardless of editing mode.
  Source Mode has no Properties GUI panel at all — frontmatter there is
  just plain text, like any other line — but `frontmatterPosition` still
  exists in the file's cached metadata even in Source Mode. So the body's
  own literal line 0 (the opening `---`) never satisfied
  `cursor.line === firstBodyLine` (which pointed past it), and the
  title's own Ctrl-N landed INSIDE line 0 instead of stopping there
  (since the "is there a heading to land on" check read frontmatter
  position the same unconditional way). Fixed by having
  `getFirstBodyLine()` return `0` unconditionally outside Live Preview —
  Source Mode gets zero special-casing, exactly matching how a
  frontmatter-less note already behaved. Test (5) below is the direct
  regression catch.
- **A sixth real bug — a pre-existing mechanism bug
  surfaced (not introduced) by this session's work**: the `cursor-up`
  handler read CM6's own `goalColumn` AFTER calling
  `execPreservingGoalColumn(editor, 'goUp')`, but confirmed live that
  CM6 itself RESETS `goalColumn` to `null` the moment `'goUp'` hits
  "nowhere further to go" (already at the document's own absolute top
  line) — exactly the moment escaping to the title needs it most. A wide
  goal column established several Ctrl-P presses back (e.g. starting on
  a long body line) was silently lost the instant the cursor crossed a
  short line (most easily hit via frontmatter's own `---` line in Source
  Mode, though always theoretically reachable for any frontmatter-less
  note too) right before escaping, landing in the title at a narrow
  column instead of the original wide one. Fixed by capturing
  `goalColumn` BEFORE the exec call, not after. Test (6) below is the
  direct regression catch.
- **A symmetry fix (not a bug)**: crossing via the
  Properties panel originally always landed at a FIXED position on the
  far side — the title's own end going up, `ch=0` going down — instead
  of preserving the goal column the way the existing no-frontmatter
  body<->title crossing already does. Fixed with a new `propertyGoalX`
  field: stores the goal in the body's own screen-pixel space regardless
  of which direction it's traveling, converting to title-space only at
  the final landing point (`propertyHeadingEscapeToTitle`) using the
  same gutter-normalization formula `escapeUpToTitle` already uses; the
  reverse direction (`propertyAddButtonEscapeToBody`) seeds CM6's own
  native `goalColumn` the same way `titleMoveLineOrEscapeToBody` already
  does. Test (7) below is the direct coverage, round-tripping through
  the full panel in both directions.
- **A seventh real bug, found right after the symmetry fix
  above shipped**: `cursor-down`'s `bind()` call for the heading had no
  `headingHandler` at all, only a plain native-dispatch fallback — which
  works fine when the panel is EXPANDED (native ArrowDown already moves
  into the first row), but when the panel is COLLAPSED, the Add-button
  and every row are hidden (`offsetParent === null`), so that native
  dispatch instead escapes straight past them into the body — through a
  path that knows nothing about `propertyGoalX`, silently landing at
  `ch 0` and losing a column that otherwise survived all the way from the
  title. Fixed with a new `propertyHeadingCtrlN` handler: expanded panel
  still gets the unchanged plain dispatch, collapsed panel reuses
  `propertyAddButtonEscapeToBody`'s own goal-column-aware body-landing
  logic directly (it only ever used its element argument for the
  native-dispatch fallback, so the heading works just as well there as
  the real Add-button). Test (8) below is the direct regression catch —
  built red-green, written and confirmed failing (landing at `ch 0`)
  against the pre-fix code first.

- **(1)** Title, Ctrl-N at its own last visual line, escapes to the
  Properties heading (not straight to the body) when frontmatter exists,
  and leaves no stale `window.getSelection()` pointing back into the
  title (see the third bug above).
- **(2)** Properties heading, Ctrl-P, lands a collapsed cursor at the
  title's own end — not native ArrowUp's own select-the-whole-title
  (an explicit design decision; every other
  Ctrl-N/P crossing in this plugin lands a collapsed cursor, never a
  selection, so this keeps that convention rather than copying native's
  own divergent behavior here). This test's own repro never establishes
  a goal column first, so it covers the "end" fallback specifically; the
  preserved-goal path is covered separately by test (7).
- **(2b)** Regression for a real bug found live: test (2)'s own
  original landing code used `sel.collapse(title,
  title.childNodes.length)`, which put the selection's focus/anchor on
  the title's own container `<div>` — an ELEMENT, child-index-based
  position — rather than its text node (the same bug class already found
  and fixed for `titleYank`'s own newline handling). `titleMoveLine`
  (which `titleMoveLineOrEscapeToBody` calls first, to decide whether
  there's more title left to move through) misjudged that
  element-anchored position as "there's still room to move," silently
  eating the first Ctrl-N press right back out of the title — a second
  press was needed before it actually escaped. Fixed by having
  `propertyHeadingEscapeToTitle` use `Selection.modify('move', 'forward',
  'documentboundary')` instead, which always lands on a real text node.
  This test asserts both halves: the selection after heading Ctrl-P lands
  on a text node, and the very next Ctrl-N escapes on the first press.
- **(3)** Body's real first line, ch 0, Ctrl-P, escapes to the
  Properties Add-button when frontmatter exists.
- **(3b)** Regression: Ctrl-P at body top lands on the Properties
  heading (not the title) when the panel is COLLAPSED (see the fourth
  bug above).
- **(4)** Regression: a note WITHOUT frontmatter is completely
  unaffected — Ctrl-P at body ch 0 still escapes straight to the title,
  landing a collapsed cursor exactly as it already did before this
  session's work (see the second bug above for why this specific test
  earns its keep).
- **(5)** Regression: in Source Mode, frontmatter is treated as plain
  text — no Properties routing at all, title<->body crossing still works
  at the file's literal line 0 (see the fifth bug above).
- **(6)** Regression: a wide goal column (established on a long body
  line, several Ctrl-P presses back) survives the escape to the title
  even after crossing a short line (frontmatter's own `---`, in Source
  Mode) right before escaping (see the sixth bug above).
- **(7)** The `propertyGoalX` symmetry fix (see above): a wide goal
  column established on the body survives a full round trip through the
  Properties panel — up through the Add-button, the one property row,
  and the heading, into the title at the equivalent column (not the
  title's own end) — and back down the same way, landing at the EXACT
  original body position, not just "the first body line."
- **(8)** The `propertyHeadingCtrlN` fix (see the seventh bug above): a
  column established directly in the title (not derived from a prior
  body visit) survives escaping down through a COLLAPSED Properties
  panel into the body, landing well past `ch 0`.
