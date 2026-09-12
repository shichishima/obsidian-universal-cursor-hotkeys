---
sidebar_position: 1
title: Command Reference
---

# macOS (Emacs) style — Command Reference

For detailed behavior of each command, see [Command Details](/macos-emacs-style/command-details). Grouped the same way as Hotkey settings below.

## Cursor movement

| Command Name | Recommended<br/>Hotkey | Function Summary | Key<br/>Repeat |
| :--------: | :----------------: | ---------------- | :---: |
| UP    | Ctrl + P           | Smart UP: Text/Cell movement, Table & callout entry (from below) & exit (from top). | ✓ |
| DOWN  | Ctrl + N           | Smart DOWN: Text/Cell movement, Table & callout entry (from above) & exit (from bottom). | ✓ |
| LEFT  | Ctrl + B           | Smart LEFT: Move by character or jump to the previous cell. | ✓ |
| RIGHT | Ctrl + F           | Smart RIGHT: Move by character or jump to the next cell. | ✓ |
| HOME  | Ctrl + A           | Smart HOME: Moves to the visual line edge, content start, or line start in steps; jumps to the previous cell inside a table. | ✓ |
| END   | Ctrl + E           | Smart END: Moves to the visual line edge or line end in steps; jumps to the next cell inside a table. | ✓ |
| TOP | —          | Jumps to the very start of the document. Table-aware. |  |
| BOTTOM | —        | Jumps to the very end of the document. Table-aware. |  |
| Page up | —        | Scroll up one page; the cursor stays at the same screen position. Bare PageUp can be set in the plugin's Settings. | ✓ |
| Page down | —        | Scroll down one page; the cursor stays at the same screen position. Bare PageDown can be set in the plugin's Settings. | ✓ |
| Word right | —        | Moves forward by word. Table-aware, CJK-aware. | ✓ |
| Word left | —         | Moves backward by word. Table-aware, CJK-aware. | ✓ |

## Editing

| Command Name | Recommended<br/>Hotkey | Function Summary | Key<br/>Repeat |
| :--------: | :----------------: | ---------------- | :---: |
| Kill line | Ctrl + K      | Kill from cursor to line end. Consecutive kills accumulate in the kill cache and clipboard. | ✓ |
| Kill region | Ctrl + W    | Cut the selected region to the kill cache. Table-aware: single-cell only; no-op for multi-row or cross-cell selections. |  |
| Copy region | —     | Copy the selected region to the kill cache without deleting it. Same table-aware constraints as Kill region. |  |
| Yank | Ctrl + Y           | Paste from the OS clipboard. Table-aware: converts newlines and pipes automatically. | ✓ |
| Delete char | Ctrl + D   | Forward-delete one character. Stops at cell boundary; joins sub-lines at `<br/>` in Live Preview. | ✓ |
| Undo | Ctrl + /   | Undo the last change. | ✓ |
| Redo | —      | Redo the last undone change. | ✓ |
| Kill word left | — | Kill from cursor to the start of the previous word. Table-aware: stays within the current cell, no-op at the cell's own edge. | ✓ |
| Kill word right | — | Kill from cursor to the end of the next word. Table-aware: stays within the current cell, no-op at the cell's own edge. | ✓ |
| Uppercase word | — | Uppercase the selection, or the whole word at the cursor. Table-aware, CJK-aware. | ✓ |
| Lowercase word | — | Lowercase the selection, or the whole word at the cursor. Table-aware, CJK-aware. | ✓ |
| Capitalize word | — | Capitalize the selection (word by word), or the whole word at the cursor. Table-aware, CJK-aware. | ✓ |
| Transpose chars | — | Swap the two characters around the cursor; at the end of a line or cell, swaps the last two instead. Table-aware, Unicode-safe. | ✓ |
| Select all | —         | Windows replacement for Select all when Ctrl+A is reassigned to HOME. |  |

## Other hotkeys

| Command Name | Recommended<br/>Hotkey | Function Summary | Key<br/>Repeat |
| :--------: | :----------------: | ---------------- | :---: |
| Recenter-top-bottom | Ctrl + L | Cycle the view so the cursor appears at the center, top, or bottom of the screen on successive presses. Resets on any other action. |  |
| Recenter | —         | Scroll the view so the cursor line is centered on screen. |  |

## Table structure

Not commands this plugin owns — Obsidian's own built-in table-editing commands, listed here (mirroring Hotkey settings below) so they're easy to find and assign a hotkey to.

| Command Name | Recommended<br/>Hotkey | Function Summary |
| :--------: | :----------------: | ---------------- |
| Insert row above | — | Inserts a new row above the current one. |
| Insert row below | — | Inserts a new row below the current one. |
| Move row up | — | Moves the current row up. |
| Move row down | — | Moves the current row down. |
| Duplicate row | — | Duplicates the current row. |
| Delete row | — | Deletes the current row. |
| Insert column left | — | Inserts a new column to the left of the current one. |
| Insert column right | — | Inserts a new column to the right of the current one. |
| Move column left | — | Moves the current column left. |
| Move column right | — | Moves the current column right. |
| Align column left | — | Left-aligns the current column. |
| Align column center | — | Center-aligns the current column. |
| Align column right | — | Right-aligns the current column. |
| Duplicate column | — | Duplicates the current column. |
| Delete column | — | Deletes the current column. |
| Insert table | — | Inserts a new table at the cursor — the only one here that also works outside an existing table. |

## Table navigation

Six ordinary commands, assignable via **Settings → Hotkeys** or Hotkey settings below. No-op outside a table cell.

| Command Name | Recommended<br/>Hotkey | Function Summary | Key<br/>Repeat |
| :--------: | :----------------: | ---------------- | :---: |
| Move to cell left | — | Jumps to the adjacent cell to the left, landing at its own content start — no selection is created. Distinct from Obsidian's own built-in `Tab`/`Shift-Tab` cell navigation, which wraps to the next/previous row at a row's own left/right edge (inserting a new row once it runs out of table) and selects the destination cell's entire content. | ✓ |
| Move to cell right | — | Jumps to the adjacent cell to the right, landing at its own content start — no selection is created. Same distinction from `Tab`/`Shift-Tab` as Move to cell left. | ✓ |
| Move to cell below | — | Jumps directly to the cell in the row below (same table column), landing at its own content start. | ✓ |
| Move to cell above | — | Jumps directly to the cell in the row above (same table column), landing at its own content start. | ✓ |
| Exit table below | — | Exits the table to the line below — distinct from Cursor BOTTOM, which jumps to the whole document's end, not just past this table. | ✓ |
| Exit table above | — | Exits the table to the line above — distinct from Cursor TOP, which jumps to the whole document's start, not just past this table. | ✓ |
