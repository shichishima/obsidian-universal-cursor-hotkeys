---
sidebar_position: 4
title: macOS (Emacs) style — Limitations
sidebar_label: Limitations
description: Known limitations of macOS-style (Emacs) keybindings — range-selection behavior, table-related quirks, and shortcut conflicts.
mode: macos-emacs-style
---
# macOS (Emacs) style — Limitations

## Range selection

- **(macOS) `Shift` + `control` + `P`/`N`/`B`/`F`/`A`/`E` stop at cell boundaries**
  - Within plain text or inside a single cell, holding `Shift` while pressing these shortcut keys extends the selection — but this isn't range selection applied to this plugin's UP/DOWN/LEFT/RIGHT/HOME/END commands. It's cursor movement/selection via Obsidian's keyboard shortcuts.
  - Because of this, there's no plugin-specific behavior here (crossing from a cell boundary into the adjacent cell).
  - For selection that spans cells (multi-cell selection), use `Shift` + the physical arrow keys instead.
- **(macOS) `Shift` + `option` + ←/→ don't apply CJK word splitting**
  - As above, holding `Shift` while pressing these shortcut keys extends the selection, but this is Obsidian's keyboard shortcut behavior.
  - Because of this, CJK word splitting isn't applied. (The selection extends as one block up to the next punctuation mark. For English text, the standard word-by-word selection behavior still applies.)
- **(Windows) `Shift` + `Ctrl` + `P`/`N`/`B`/`F`/`A`/`E` don't move the cursor**
  - Unless you explicitly assign them yourself, Windows has no command assigned to these hotkeys, so they don't do anything. (**Apply recommended** assigns `Ctrl` + `P`/`N`/`B`/`F`/`A`/`E` — `Shift` + `Ctrl` + `P`/`N`/`B`/`F`/`A`/`E` is another hotkey.)
  - Use `Shift` + ↑/↓/←/→ instead for range selection. Even if you've assigned the physical arrow keys themselves to UP/DOWN via Key Upgrades, combining them with `Shift` makes them a distinct key, so they're unaffected by that assignment.
- **(Windows) `Shift` + `Ctrl` + ←/→ don't support CJK word selection**
  - This is Obsidian's keyboard shortcut for word-unit range selection, and this plugin's CJK word splitting isn't applied to it. The selection extends as one block up to the next punctuation mark. For English text, the standard word-by-word selection behavior still applies.
- **Multi-cell cut, copy, and paste are not supported (Kill line/Kill region/Copy region/Yank)**
  - The commands this plugin provides are text-level operation commands — in a table, they only act on the text within each individual cell.
  - Cutting, copying, or pasting table structure via multi-cell selection is not supported.
  - To cut, copy, or paste table structure, use the OS's own standard cut/copy/paste shortcuts (`Ctrl` + `X`/`C`/`V` on Windows, `command` + `X`/`C`/`V` on macOS) or the right-click context menu.

## Table-related

- **Brief scroll when UP enters a tall wrapped cell in Live Preview:** when UP enters a cell whose wrapped content exceeds the screen height, the view momentarily scrolls to the top of the cell before jumping to the bottom visual line, its actual landing position. This is an inherent side effect of the two-step cursor placement this plugin uses to locate the bottom visual line within the cell widget.
- **Entering a table from plain text always lands in the leftmost cell:** when UP/DOWN moves from a plain-text line directly above (or below) a table into that table, it always lands in that row's leftmost cell. Before the cursor actually lands, Live Preview's table can't return per-character position information, so there's no way to tell which cell it should enter. It tries to preserve the cursor's horizontal position as much as possible within the leftmost cell, but it never enters the second cell or beyond (the furthest right it can reach is still the end of the leftmost cell). The cursor's horizontal position from before entering the table is remembered, and continues to be preserved through any up/down movement afterward.
- **Source Mode's table detection is simplistic:** in Source Mode, whether the cursor is inside a table is determined by a simple single-line string check (whether the line starts and ends with `|`).
  - It doesn't check across multiple lines — things like whether a header row exists, or whether a blank line precedes the table. The check looks at only a single line of text.
  - Because of this, unexpected behavior can occur when a line happens to match this pattern.
  - **The `|` at both ends of a table row can't be omitted:** [Obsidian's extended syntax](https://obsidian.md/help/advanced-syntax#Tables) lets you omit the leading and trailing `|` of a table row, but this plugin's Source Mode doesn't recognize that abbreviated syntax as a table. A row with both `|` omitted doesn't match the string check above, so it's treated as ordinary text.
  - By contrast, Live Preview, which uses the Markdown syntax tree, detects this correctly.

## Shortcut conflicts

- **(Windows) Obsidian's keyboard shortcuts aren't detected as conflicts:** the recommended hotkey assignment (the **Apply recommended** or **Set** button) overrides Obsidian's keyboard shortcuts `Ctrl` + `A` (Select all) and `Ctrl` + `Y` (Redo).
  - Obsidian hotkeys can detect duplicates among themselves, but because these are Obsidian's keyboard shortcuts, not hotkey assignments, they can't be listed under Displaced commands, and the **Restore** button can't bring them back either.
  - Assign the bundled Select all and Redo commands to a different key and use those instead, or, if you use them infrequently, run them from the Command Palette.
- **Hotkeys don't work outside the markdown editor:** a few examples below — this isn't an exhaustive list.
  - `Ctrl` + `B`/`F`/`A`/`E` don't work in the note title field.
  - `Ctrl` + `B`/`F`/`A`/`E`, `Ctrl` + `D`, and `Ctrl` + `K` don't work in the frontmatter property field.
  - In Excalidraw, `Ctrl` + `P`/`N`/`B`/`F`/`A`/`E` don't work while typing inside a text object.
- **Page down/Page up conflict with paste:** assigning `Ctrl` + `V` (Windows) or `command` + `V` (macOS) to Page down or Page up, as an Emacs-style hotkey, breaks `Ctrl` + `V`/`command` + `V` paste outside the markdown editor (e.g., in Excalidraw).
  - Within the markdown editor, the Yank command can substitute for paste in many cases, but Yank isn't available in those other views. Use the mouse's "right-click → Paste" instead.
  - Likewise, multi-cell cut/copy/paste can't be substituted for either, so it's recommended to keep the OS's standard cut/copy/paste shortcuts free.
