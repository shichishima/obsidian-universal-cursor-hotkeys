---
sidebar_position: 2
title: Vim mode — Settings
sidebar_label: Settings
description: What each Vim mode setting toggle does, and what each Behavior option means.
mode: vim-mode
---
# Vim mode — Settings

Open **Settings → Universal Cursor Hotkeys → Vim mode**.

Of the toggles on this page, Motion upgrades (8 of them) and 2 of the Table commands (Table structure and Table navigation) take effect immediately when switched OFF → ON, but switching them ON → OFF needs an app restart to fully take effect. (A **Restart** button appears when needed.)

## Motion upgrades \{#motion-upgrades}
Each key group has its own toggle switch, letting you choose whether that group keeps Obsidian's standard Vim mode behavior unchanged (OFF) or uses this plugin's upgraded behavior (ON).

For the differences between standard behavior and upgraded behavior, see the [Command Reference](/vim-mode/command-reference#motion-upgrades).

| Toggle | Default | Description |
| ------ | :---: | ------------ |
| `h` `l` `x` Character movement / deletion | ON | — |
| `j` `k` Line movement | ON | — |
| `w` `b` `e` Word motion | ON | — |
| `gg` `G` Note start/end | ON | — |
| `gj` `gk` Display-line movement | ON | — |
| `$` End of line (sticky column) | ON | Requires `j` `k` Line movement or `gj` `gk` Display-line movement to be ON. |
| `^` `I` First non-blank character | ON | To get Smart home behavior, Behavior options' "Smart home (standard)" must be ON. |
| `J` Join lines | ON | To get Smart join behavior, Behavior options' "Smart join" must be ON. |

## Table commands \{#table-commands}
There's an **Apply both** button that turns on Table structure and Table navigation at the same time. (Disabled once both are already ON.)

| Toggle | Default | Description |
| ------ | :---: | ------------ |
| `Space` `t` Table structure (16 commands) | OFF | Makes commands for operating on table structure available.<br/>See the [Command Reference](/vim-mode/command-reference#table-structure) for details. |
| `Space` `t` Table navigation (6 commands) | OFF | Makes commands for moving the cursor between cells available.<br/>See the [Command Reference](/vim-mode/command-reference#table-navigation) for details. |
| Leader key | OFF<br/>(`Space`) | Chooses the leader key used by Table structure and Table navigation. Only matters while either one is ON.<br/><br/>**OFF:** `Space` (default). The space key's original behavior (move right) becomes unavailable.<br/>**ON:** backslash (`\`). The space key's behavior stays available. |

## Behavior options \{#behavior-options}
Extends some of the toggles above to be more Markdown-aware.

Settings with the same name are shared across the For everyone, Vim mode, and macOS (Emacs) style tabs — turning one ON (or OFF) turns its counterpart ON (or OFF) on the other tabs too.

| Setting | Default | Description |
| ------- | :---: | ------------ |
| Smart&nbsp;home (standard) | ON | **ON:** `^` moves to the content start, skipping any leading Markdown syntax (lists, numbered lists, checkboxes, indentation, blockquotes). `I` enters Insert mode at that position.<br/><br/>**OFF:** `^` ignores Markdown syntax and moves to the line's first non-blank character. `I` enters Insert mode at that position. |
| Smart&nbsp;home (advanced) | ON | **ON:** In addition to Smart home (standard)'s Markdown handling, the cursor position for `^`/`I` also skips past headings (`#`), footnotes (`[^1]:`), and callout type markers (`[!type]`). Can only be turned ON while Smart home (standard) is ON.<br/><br/>**OFF:** Heading lines, footnotes, and callouts aren't considered. |
| Smart join | OFF | **ON:** When joining lines with `J`, removes the Markdown at the start of the next line.<br/>Requires Smart home (standard) to be ON.<br/>Removes blockquote markers, list markers, and indentation; also removes headings and footnotes when Smart home (advanced) is ON.<br/><br/>**OFF:** Joining only removes the next line's leading whitespace.<br/><br/>Either way, a single space is inserted between the joined lines. |
