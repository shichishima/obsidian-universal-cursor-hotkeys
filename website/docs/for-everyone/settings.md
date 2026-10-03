---
sidebar_position: 2
title: For everyone — Settings
sidebar_label: Settings
description: How to apply Key Upgrades, how to read the settings screen, and what each Behavior option means.
mode: for-everyone
---
# For everyone — Settings

Open **Settings → Universal Cursor Hotkeys → For everyone**.

## Apply all button
Turns on every toggle on this page — 8 in Upgrade navigation basics, 4 in Upgrade word commands, and 5 in Behavior options.

Keys that could conflict (🔴Used status) are skipped.

## Upgrade navigation basics
Each key here is a plain on/off toggle. For what each one actually changes, see [Key Upgrades — Navigation basics upgrade](/for-everyone/key-upgrades#upgrade-navigation-basics).

Turning a toggle ON adds that key to the target command's hotkeys. If the command already has other hotkeys assigned, they're left as-is — this key is simply added alongside them.

Turning it OFF removes just that key's assignment. Any other hotkey assignments on the command are left unchanged.

### Reading each setting row \{#setting-status}

| Status | Toggle | Meaning |
| --- | --- | --- |
| *(no badge)* | OFF | The key still has its standard, unmodified behavior. It's free to be assigned the upgraded behavior. |
| *(no badge)* | ON | The key is assigned to this plugin's upgraded behavior. |
| 🔴Used | OFF<br/>(disabled) | This key is already used by a different command, so it can't be assigned here too (the toggle can't be turned ON).<br/>Click the key chip or the status badge to jump to Obsidian's own Hotkeys panel and check which command currently holds it. |
| 🔴Conflict | ON | The upgrade command is assigned to both this key and another command at the same time — it's already in a conflicted state.<br/>Click the key chip or the status badge to jump to the Hotkeys panel and resolve the conflict. Turning the toggle OFF changes its status to 🔴Used, and it can't simply be turned back ON from there. |

## Upgrade word commands
Each key here is a plain on/off toggle too. For what each one actually changes, see [Key Upgrades — Word commands upgrade](/for-everyone/key-upgrades#upgrade-word-commands).

### Reading each setting row
[(Same as above)](/for-everyone/settings#setting-status)

## Behavior options \{#behavior-options}
Toggle buttons that fine-tune various behaviors.

Settings with the same name are shared across the For everyone, Vim mode, and macOS (Emacs) style tabs — turning one ON (or OFF) turns its counterpart ON (or OFF) on the other tabs too.

| Toggle | Default | Description |
| --- | :---: | --- |
| Smart&nbsp;home (standard) | ON | **ON:** `Home` moves to the content start, skipping any leading Markdown syntax (lists, numbered lists, checkboxes, indentation, blockquotes) — same as Windows' `Home` / macOS' `command` + ←.<br/><br/>**OFF:** `Home` ignores Markdown syntax entirely and moves straight to the start of the line — same as macOS/Emacs' `Ctrl` + `A`. |
| Smart&nbsp;home (advanced) | ON | **ON:** In addition to Smart home (standard)'s behavior, also skips past headings (`#`), footnotes (`[^1]:`), and callout type markers (`[!type]`). Can only be turned ON while Smart home (standard) is ON.<br/><br/>**OFF:** Heading lines, footnotes, and callouts aren't considered (moves to the logical line start, same as a plain `Home`). |
| Visual line movement | ON | **ON:** On a long, wrapped line, pressing `Home`/`End` moves to that visual line's start/end as the first step.<br/><br/>**OFF:** `Home`/`End` ignore visual lines even on a wrapped line. `Home` goes to the line start (the logical line start, or the content start, depending on the Smart home setting), and `End` goes to the logical line's end. |
| Cross-row navigation | ON | Adjusts how `Home`/`End` behave inside a table.<br/><br/>**ON:** Pressing `Home` at the leftmost cell's start moves to the end of the rightmost cell in the row above. Likewise, pressing `End` at the rightmost cell's end moves to the start of the leftmost cell in the row below.<br/>If there's no such row, it exits the table.<br/>(Equivalent to ←/→'s own behavior.)<br/><br/>**OFF:** `Home`/`End` don't cross table rows — they stop at the leftmost cell's start or the rightmost cell's end. |
| Double-click word select | ON | Adjusts how double-clicking with the mouse selects a word.<br/><br/>**ON:** Dictionary-based word segmentation selects exactly one CJK (Chinese/Japanese) word per double-click.<br/>Dragging after the double-click extends the selection one word at a time.<br/><br/>**OFF:** Obsidian's standard double-click behavior — a run of kanji, hiragana, and the like is selected as a single unbroken word, without distinguishing CJK word boundaries. |
