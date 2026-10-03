---
sidebar_position: 1
title: macOS (Emacs) style — Command Reference
sidebar_label: Command Reference
description: A full list of every macOS-style (Emacs) command, what it does, and its recommended hotkey.
mode: macos-emacs-style
---
# macOS (Emacs) style — Command Reference

Commands and function summaries, grouped the same way as on the [Settings](/macos-emacs-style/settings) page. For detailed behavior of each command, see [Command Details](/macos-emacs-style/command-details).

- The Command Name column shows the name as it appears on Obsidian's own Hotkeys panel.
  - Each command name links to that command's entry on the Command Details page.
- The Recommended Hotkey column shows the key assigned by the **[Apply recommended](/macos-emacs-style/settings#apply-recommended)** button or the **Set** button.
  - On Windows, some of these overlap with Obsidian's own standard hotkeys. After applying, check the [Displaced commands](/macos-emacs-style/settings#displaced-commands) list to see what happened to the command that previously held that hotkey.
  - On macOS, read `Ctrl` as `control`.
  - "—" means no recommended hotkey is set. Click the **Open →** button to open Obsidian's own Hotkeys panel and assign a hotkey of your choice manually.
- Commands with "✓" in the Key Repeat column support key repeat.

## Cursor movement \{#cursor-movement}

|                              Command Name                               | Recommended<br/>Hotkey | Function Summary                                                                                                                       | Key<br/>Repeat |
| :-----------------------------------------------------------------: | :--------------: | ---------------------------------------------------------------------------------------------------------------------------------------- | :-------: |
|        [UP](/macos-emacs-style/command-details#cursor-up)        |   `Ctrl` + `P`    | Moves between text/cells, and enters tables and callouts (from below) or exits them (upward). Preserves the cursor's horizontal position when crossing a table row.      |     ✓     |
|      [DOWN](/macos-emacs-style/command-details#cursor-down)      |   `Ctrl` + `N`    | Moves between text/cells, and enters tables and callouts (from above) or exits them (downward). Preserves the cursor's horizontal position when crossing a table row.    |     ✓     |
|      [LEFT](/macos-emacs-style/command-details#cursor-left)      |   `Ctrl` + `B`    | Moves by character. Jumps to the previous cell when at a cell's start.                                                                   |     ✓     |
|     [RIGHT](/macos-emacs-style/command-details#cursor-right)     |   `Ctrl` + `F`    | Moves by character. Jumps to the next cell when at a cell's end.                                                                         |     ✓     |
|      [HOME](/macos-emacs-style/command-details#cursor-home)      |   `Ctrl` + `A`    | Moves in three steps, in order: the visual line edge, the content start, then the line start. Inside a table, jumps from a cell's start to the previous cell. |     ✓     |
|       [END](/macos-emacs-style/command-details#cursor-end)       |   `Ctrl` + `E`    | Moves in two steps, in order: the visual line edge, then the line end. Inside a table, jumps from a cell's end to the next cell.          |     ✓     |
|   [TOP](/macos-emacs-style/command-details#cursor-top-bottom)    |         —         | Jumps to the start of the note.                                                                                                      |           |
|  [BOTTOM](/macos-emacs-style/command-details#cursor-top-bottom)  |         —         | Jumps to the end of the note.                                                                                                        |           |
|    [Page up](/macos-emacs-style/command-details#page-up-down)    |         —         | Scrolls up by one page. The cursor stays at the same position on screen. Can land inside a table.                                        |     ✓     |
|   [Page down](/macos-emacs-style/command-details#page-up-down)   |         —         | Scrolls down by one page. The cursor stays at the same position on screen. Can land inside a table.                                       |     ✓     |
| [Word left](/macos-emacs-style/command-details#word-left-right)  |         —         | Moves left by word, using dictionary-based segmentation so CJK (Chinese/Japanese) text is also split into real words.                   |     ✓     |
| [Word right](/macos-emacs-style/command-details#word-left-right) |         —         | Moves right by word, using dictionary-based segmentation so CJK (Chinese/Japanese) text is also split into real words.                  |     ✓     |

## Editing \{#editing}

"Kill" is Emacs terminology for a cut operation. This plugin goes through the OS clipboard, so you can copy and paste across other apps too. Content from consecutive kills accumulates in the clipboard and can be pasted all together.

|                                    Command Name                                     | Recommended<br/>Hotkey | Function Summary                                                                                  | Key<br/>Repeat |
| :------------------------------------------------------------------------------: | :--------------: | ----------------------------------------------------------------------------------------------- | :-------: |
|         [Kill line](/macos-emacs-style/command-details#kill-line)          |   `Ctrl` + `K`    | Kills from the cursor to the end of the line. Consecutive kills accumulate their content in the clipboard. |     ✓     |
|       [Kill region](/macos-emacs-style/command-details#kill-region)        |   `Ctrl` + `W`    | Kills the selected region.                                                                        |           |
|       [Copy region](/macos-emacs-style/command-details#copy-region)        |         —         | Copies the selected region without deleting it.                                                   |           |
|              [Yank](/macos-emacs-style/command-details#yank)               |   `Ctrl` + `Y`    | Pastes the contents of the OS clipboard.                                                           |     ✓     |
|       [Delete char](/macos-emacs-style/command-details#delete-char)        |   `Ctrl` + `D`    | Deletes the one character to the right of the cursor.                                             |     ✓     |
|            [Undo](/macos-emacs-style/command-details#undo-redo)            |   `Ctrl` + `/`    | Undoes the last change.                                                                            |     ✓     |
|            [Redo](/macos-emacs-style/command-details#undo-redo)            |         —         | Redoes the last undone change.                                                                     |     ✓     |
| [Kill word left](/macos-emacs-style/command-details#kill-word-left-right)  |         —         | Kills from the cursor to the start of the previous word. Consecutive kills accumulate their content in the clipboard. |     ✓     |
| [Kill word right](/macos-emacs-style/command-details#kill-word-left-right) |         —         | Kills from the cursor to the end of the next word. Consecutive kills accumulate their content in the clipboard.       |     ✓     |
|       [Uppercase word](/macos-emacs-style/command-details#word-case)       |         —         | Uppercases the selection, or — if there is no selection — the entire word at the cursor. Word splitting supports CJK (Chinese/Japanese) text. |     ✓     |
|       [Lowercase word](/macos-emacs-style/command-details#word-case)       |         —         | Lowercases the selection, or — if there is no selection — the entire word at the cursor. Word splitting supports CJK (Chinese/Japanese) text. |     ✓     |
|      [Capitalize word](/macos-emacs-style/command-details#word-case)       |         —         | Capitalizes the selection word by word, or — if there is no selection — the word at the cursor. Word splitting supports CJK (Chinese/Japanese) text. |     ✓     |
|   [Transpose chars](/macos-emacs-style/command-details#transpose-chars)    |         —         | Swaps the two characters around the cursor. At the end of a line or cell, swaps the previous two characters instead. Unicode-safe. |     ✓     |
|        [Select all](/macos-emacs-style/command-details#select-all)         |         —         | A Windows-only replacement for Select all, for when `Ctrl` + `A` has been assigned to HOME.       |           |

## Other hotkeys \{#other-hotkeys}

|                                      Command Name                                      | Recommended<br/>Hotkey | Function Summary                                                                              | Key<br/>Repeat |
| :---------------------------------------------------------------------------------: | :--------------: | -------------------------------------------------------------------------------------------- | :-------: |
| [Recenter-top-bottom](/macos-emacs-style/command-details#recenter-top-bottom) |   `Ctrl` + `L`    | Cycles the display position of the cursor's line between the screen's center, top, and bottom with each press. |           |
|            [Recenter](/macos-emacs-style/command-details#recenter)            |         —         | Scrolls so the cursor's line is centered on screen.                                           |           |

## Table structure \{#table-structure}

The 16 commands listed here are not commands this plugin owns — they're Obsidian's own built-in table-editing commands, included here for reference. (Same as the Hotkey settings section on the Settings page.)

Note that the Command Name column below uses the English-language names. The name actually displayed depends on Obsidian's own language setting.

|     Command Name     | Recommended<br/>Hotkey | Function Summary                                                                        |
| :-------------------: | :--------------: | ----------------------------------------------------------------------------------------- |
|   Insert row above    |         —         | Inserts a new row above the current row.                                                  |
|   Insert row below    |         —         | Inserts a new row below the current row.                                                  |
|      Move row up      |         —         | Moves the current row up.                                                                 |
|     Move row down     |         —         | Moves the current row down.                                                               |
|     Duplicate row     |         —         | Duplicates the current row.                                                               |
|      Delete row       |         —         | Deletes the current row.                                                                  |
|  Insert column left   |         —         | Inserts a new column to the left of the current column.                                   |
|  Insert column right  |         —         | Inserts a new column to the right of the current column.                                  |
|   Move column left    |         —         | Moves the current column left.                                                            |
|   Move column right   |         —         | Moves the current column right.                                                           |
|   Align column left   |         —         | Left-aligns the current column.                                                           |
|  Align column center  |         —         | Center-aligns the current column.                                                         |
|  Align column right   |         —         | Right-aligns the current column.                                                          |
|   Duplicate column    |         —         | Duplicates the current column.                                                            |
|     Delete column     |         —         | Deletes the current column.                                                               |
|      Insert table      |         —         | Inserts a new table at the cursor position. The only command listed here that also works outside a table. |

## Table navigation \{#table-navigation}

|                                   Command Name                                   | Recommended<br/>Hotkey | Function Summary                                             | Key<br/>Repeat |
| :---------------------------------------------------------------------------: | :--------------: | ------------------------------------------------------------ | :-------: |
| [Move to cell left](/macos-emacs-style/command-details#move-to-cell)  |         —         | Moves to the start of the cell to the left.                   |     ✓     |
| [Move to cell right](/macos-emacs-style/command-details#move-to-cell) |         —         | Moves to the start of the cell to the right.                  |     ✓     |
| [Move to cell below](/macos-emacs-style/command-details#move-to-cell) |         —         | Moves to the start of the cell in the same column, one row down. |     ✓     |
| [Move to cell above](/macos-emacs-style/command-details#move-to-cell) |         —         | Moves to the start of the cell in the same column, one row up.   |     ✓     |
|   [Exit table below](/macos-emacs-style/command-details#exit-table)   |         —         | Exits the current table downward.                              |     ✓     |
|   [Exit table above](/macos-emacs-style/command-details#exit-table)   |         —         | Exits the current table upward.                                |     ✓     |
