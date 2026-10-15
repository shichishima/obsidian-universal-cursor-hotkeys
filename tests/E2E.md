# E2E Tests

Located in `tests/e2e/` (wdio-obsidian-service). Run with `npm run test:e2e`.

Covers only what the unit test suite (`tests/unit/`) can't: behavior that
depends on a real Obsidian/CM6 instance — real selection handling, real
DOM/focus transitions, real composition events, etc.

Runs serially (`maxInstances: 1` in `wdio.conf.mts`) — confirmed live that
running multiple Obsidian instances in parallel on this machine makes
table-entry-dependent tests flaky (cell-focus reconciliation not settling in
time), even with each spec sandboxed to its own instance.

All spec files run in one shared Obsidian instance (`specs` wrapped in a
single group array in `wdio.conf.mts`, listed in an explicit order —
lightest spec first as a warm-up, table-heavy specs last), instead of
relaunching Obsidian per file. Faster, and somewhat less flaky — table-entry
assertions can still intermittently fail even so (`inTableCell` settling
slower than any poll tried catches), roughly 1 in 4-6 full runs as of
2026-10-15. Not chased further than that; a real launch-focus-steal was also
investigated and dropped once the single-instance change made it a one-time
rather than per-file annoyance.

Each fixture note under `vaults/smoke/` starts with a `# heading` + `-`
bullet(s) describing what it's for, then a `---` separator, then the actual
test content. Specs read the first line after `---` and reference positions
relative to it, so the header above `---` can be freely edited without
shifting a spec's own hardcoded line offsets.

## Implemented

- `smoke.e2e.ts` — the plugin loads and registers its commands.
- `multiCursorHome.e2e.ts` — HOME keeps every cursor independent instead of
  collapsing to one (regression test for the fix/multi-cursor-collapse fix).
- `multiCursorTableCrossing.e2e.ts` — DOWN across a table boundary: a
  secondary alone crossing into the table is dropped; the primary crossing
  collapses the whole selection to one (the "primary cursor defines the
  view" policy). Note: a table needs a blank line before it to be recognized
  as a table at all by Obsidian's own markdown parser — confirmed live by
  checking the CM6 syntax tree directly after an initial fixture without one
  silently parsed as plain paragraph text.
- `exitTableSmartHome.e2e.ts` — "Exit table below" lands on the next line's
  Smart-Home position (e.g. right after a checkbox marker), not raw ch=0.
  Covers only the landing-position half of that fix's own commit — the
  also-fixed gj/gk flash on the same kind of line is frame-level visual
  timing, not reliably detectable through WDIO's own polling granularity,
  so that half is left to manual verification.

## Planned, in priority order

1. IME composition guard (commands must no-op mid-composition)
2. Key Upgrades hotkey assignment
3. Popout window support
4. Vim mode commands
