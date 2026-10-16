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
region (never enters a cell).

- A hand-rolled "scan past the table" fallback turned out unnecessary —
  CM6's own `moveVertically` already treats an unfocused table as one
  visual line.

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

## Planned, in priority order

1. Set-mark: LEFT/RIGHT, HOME/END, Word left/right extension
2. Popout window support
3. Vim mode commands
