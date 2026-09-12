---
sidebar_position: 1
title: Command Reference
mode: vim-mode
---

# Vim mode — Command Reference

For what each toggle switches on/off, see [Settings](/vim-mode/settings). This section covers what each key actually does.

## Motion upgrades

Fixes to Vim's own native keys, scoped to Live Preview table cells — outside a table, these are all unchanged from vanilla Vim.

| Keys | Function Summary |
| :--: | ----------------- |
| `h` `l` `x` | Moves/deletes by character correctly inside table cells — no multi-byte miscounting, no wrong jumps at line boundaries. |
| `j` `k` | Crosses into the next/previous table row, preserving column position (vim's own goal column) throughout, instead of getting stuck at the cell boundary; also stops correctly at the right line within a multi-line (wrapped) cell. |
| `w` `b` `e` (and `W`/`B`/`E`/`ge`/`gE`) | Crosses cell/row boundaries — reaching the end of the table exits into the surrounding text, matching vim's own document-wide word-motion behavior instead of getting stuck at the table's edge. CJK-aware (dictionary-based Chinese/Japanese word segmentation), not just script-boundary-based like vanilla vim. |
| `gg` `G` | Always reaches the note's actual first/last line, including exiting a table cell entirely; lands at the Smart-Home-aware content position if that line happens to be a table row. If the note ends with a table, `G` appends a blank line and lands there instead of landing inside the table (matching `tx`'s own EOF behavior below) — `gg` has no symmetric "prepend a line" case. |
| `gj` `gk` | The visual-line (display-line) equivalent of `j`/`k` above — moves by visual line inside table cells instead of getting stuck, tracking the visual column across wrapped lines. |
| `$` | Sticky end-of-line goal column when followed by `j`/`k` or `gj`/`gk`, matching real vim's own behavior, including across table row crossings. `D`/`C` share the same underlying motion. |
| `^` `I` | Reuses Smart home's own content-start logic instead of vim's plain whitespace-only skip. How much it skips depends on the Behavior Options: **Smart home (standard)** skips list/checkbox markers, indentation, and blockquote markers; **Smart home (advanced)** additionally skips headings, footnotes, and callout type markers. |
| `J` | Reuses Smart join's own line-joining logic instead of vim's plain whitespace-only join, still inserting vim's usual single space. Depends on the Behavior Options' **Smart join** setting: when it's on, strips the next line's Markdown syntax (blockquote/list markers, indentation) instead of just whitespace. |

## Table structure

New leader-key commands (`<leader>` is `Space` by default, `\` optional) — not fixes to existing vim keys, but a thin wrapper around Obsidian's own built-in table commands. No-op outside a table cell, except `tm`. `tiJ`/`tiK` are aliases for `to`/`tO` — matching `tiH`/`tiL`'s own "`ti` + direction" column-insert convention.

| | Row | Column |
| --- | --- | --- |
| Insert | `<leader>to` / `<leader>tO`<br/>`<leader>tiJ` / `<leader>tiK`<br/>(below/above) | `<leader>tiH` / `<leader>tiL`<br/>(left/right) |
| Move | `<leader>tK` / `<leader>tJ`<br/>(up/down) | `<leader>tH` / `<leader>tL`<br/>(left/right) |
| Delete | `<leader>tdd` | `<leader>tdc` |
| Duplicate | `<leader>tyyp` | `<leader>tyc` |
| Align | — | `<leader>tal` / `<leader>tac` / `<leader>tar`<br/>(left/center/right) |

`<leader>tm` — insert a table; the only one here that also works outside an existing table.

## Table navigation

New leader-key commands — pure cursor movement, original logic (not a wrapper around anything native). No-op outside a table cell.

| Keys | Function Summary |
| :--: | ----------------- |
| `<leader>tj` / `<leader>tk` | Jump to the cell below / above (same column), landing at its own content start — distinct from vim's native `j`/`k`, which preserve column position instead of jumping to content start. |
| `<leader>th` / `<leader>tl` | Jump to the cell to the left / right, landing at its own content start — no selection is created. Distinct from Obsidian's own built-in `Tab`/`Shift-Tab` cell navigation, which wraps to the next/previous row at a row's own left/right edge (and inserts a brand new row once it runs out of table) and selects the destination cell's entire content — `th`/`tl` always stay within the current row, no-op at its own left/right edge instead. |
| `<leader>tx` / `<leader>tX` | Exit the current table below / above — distinct from `gg`/`G`, which jump to the whole document's edge, not just past this table. |
