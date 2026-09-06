# Universal Cursor Hotkeys — CJK-aware word navigation inside Obsidian's Markdown tables, with full Vim mode support
Your everyday arrow keys, Home/End, Page Up/Down, and word movement work smarter around Live Preview's Markdown tables, and handle CJK (Chinese/Japanese) text just as well. Vim mode and macOS-style (Emacs) keybindings get the same upgrade.

<img width="688" height="387" alt="Side-by-side demo: standard Obsidian vs. Universal Cursor Hotkeys navigating Markdown tables and CJK text" src="https://github.com/user-attachments/assets/b85426e8-e8be-451a-9766-fff410cb634e" />

## Overview

Obsidian's Live Preview breaks cursor behavior inside Markdown tables, and treats CJK (Chinese/Japanese) text as one long word instead of stopping at real word boundaries. This plugin fixes both — for everyday arrow-key navigation, Obsidian's built-in Vim mode, and macOS-style keyboard shortcuts (aka Emacs keybindings) alike, so Vim's own `h`/`j`/`k`/`l`/`w`/`b`/`e`/`gg`/`G` finally work correctly inside tables too. On the Emacs side, it also adds a full set of editing commands — Kill & Yank, case conversion, Recenter, and more — that don't exist natively in Obsidian.

**⌨️ [I use Obsidian's built-in Vim mode →](#vim-mode)**<br>
**🅴 [I use macOS-style keyboard shortcuts (Emacs keybindings) →](#macos-style-emacs-keybindings)**<br>
**🔑 [I just want better everyday cursor navigation →](#for-everyone)**

---

## For everyone

[Getting Started](#getting-started) | [Command Reference](#command-reference) | [Settings](#settings) | [Behavior Options](#behavior-options)

You don't need Vim mode or Emacs-style keybindings to benefit from this plugin. The keys you already use every day — arrow keys, Home, End, Page Up/Down, and word navigation — can get table-aware behavior and CJK-aware (Chinese/Japanese) word splitting too, without changing what any key does.

### Getting Started

[Command Reference](#command-reference) | [Settings](#settings) | [Behavior Options](#behavior-options)

Open **Settings → Universal Cursor Hotkeys → For everyone** and click **Apply all**.

### Command Reference

[Getting Started](#getting-started) | [Settings](#settings) | [Behavior Options](#behavior-options)

For what each row switches on/off, see [Settings](#settings) below. This section covers what each key actually does.

#### Navigation basics

| Key (macOS) | Key (Windows) | Function Summary |
| :--: | :--: | ----------------- |
| ↑ | ↑ | Column-aware: preserves column position across table row crossings and wrapped cells, instead of getting stuck at a cell boundary. |
| ↓ | ↓ | Column-aware — same as ↑ above. |
| Home | Home | 3-step Smart home: visual line edge → content start (skipping Markdown markers) → line start, table-aware throughout. |
| End | End | Table-aware: moves to the visual line edge or line end, entering/exiting a table cell correctly at its boundary. |
| Page&nbsp;Up | Page&nbsp;Up | Table-aware: scrolls a page while keeping the cursor at the same screen position, including inside wrapped table cells. |
| Page&nbsp;Down | Page&nbsp;Down | Same as Page Up above. |
| Cmd+↑ | Ctrl+Home | Document start — table-aware. |
| Cmd+↓ | Ctrl+End | Document end — table-aware. |

#### Word commands

| Key (macOS) | Key (Windows) | Function Summary |
| :--: | :--: | ----------------- |
| Option+→ | Ctrl+→ | Word right — table-aware, CJK-aware (dictionary-based Chinese/Japanese word segmentation). |
| Option+← | Ctrl+← | Word left — table-aware, CJK-aware. |
| Option+⌫ | Ctrl+Backspace | Kill word left — table-aware, CJK-aware; stays within the current cell. |
| Option+⌦ | Ctrl+Delete | Kill word right — table-aware, CJK-aware; stays within the current cell. |

On macOS, the physical Delete key sends Backspace (⌫) — Kill word left uses Option plus that same key. The forward-delete key (⌦) used by Kill word right needs Fn+Delete on keyboards without a dedicated one.

### Settings

[Getting Started](#getting-started) | [Command Reference](#command-reference) | [Behavior Options](#behavior-options)

Open **Settings → Universal Cursor Hotkeys → For everyone**. Each key is a plain on/off toggle: turning it on adds that key to the target command's hotkeys (without touching any hotkey it already has); turning it off removes just that key.

**Status:** the toggle's own position already shows Set/Available — a status badge only appears for the two conflict cases:

| Status | Meaning |
|--------|---------|
| *(no&nbsp;badge)* | Toggle ON = key is assigned and gains the upgraded behavior described above. Toggle OFF = key keeps its standard, unmodified behavior and is free to assign. |
| 🔴Used | Key is already used by a different command; the toggle is disabled until you free it up (click the key chip to jump to Obsidian's own Hotkeys panel). |
| 🔴Conflict | Key is assigned here too, but is *also* still held by another command. |

**Apply all:** turns on every key above in one click (skipping any that's already on or in conflict), and also turns on every [**Behavior Option**](#behavior-options) below — unlike Vim mode's/Emacs's own Apply buttons, which only ever touch their own tab's key/command list. This one sits at the top of the whole tab rather than scoped to one block, so it reads as "turn everything on this page on."

---

## Vim mode

[Getting Started](#getting-started-1) | [Command Reference](#command-reference-1) | [Settings](#settings-1) | [Limitations](#limitations) | [Behavior Options](#behavior-options)

If you use Obsidian's built-in Vim mode, this plugin fixes a set of well-known Live Preview table gaps: `h`/`l`/`j`/`k`/`w`/`b`/`e`/`gg`/`G`/`gj`/`gk` now work correctly inside table cells, instead of miscounting characters, refusing to cross rows, or landing in the wrong place.

<img width="610" height="610" alt="Vim mode navigating a Live Preview table correctly" src="https://github.com/user-attachments/assets/0533a2f4-e497-4d3d-af73-7b68f5edfa86" />

### Getting Started

[Command Reference](#command-reference-1) | [Settings](#settings-1) | [Limitations](#limitations) | [Behavior Options](#behavior-options)

Turn on Obsidian's built-in **Vim key bindings** (Settings → Editor) — that's it. All the motion upgrades below are already on by default, no setup needed. If you also want the leader-key Table structure/Table navigation commands (off by default), open **Settings → Universal Cursor Hotkeys → Vim mode** and click **Apply both**.

### Command Reference

[Getting Started](#getting-started-1) | [Settings](#settings-1) | [Limitations](#limitations) | [Behavior Options](#behavior-options)

For what each toggle switches on/off, see [Settings](#settings-1) below. This section covers what each key actually does.

#### Motion upgrades

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

#### Table structure

New leader-key commands (`<leader>` is `Space` by default, `\` optional) — not fixes to existing vim keys, but a thin wrapper around Obsidian's own built-in table commands. No-op outside a table cell, except `tm`. `tiJ`/`tiK` are aliases for `to`/`tO` — matching `tiH`/`tiL`'s own "`ti` + direction" column-insert convention.

| | Row | Column |
| --- | --- | --- |
| Insert | `<leader>to` / `<leader>tO`<br>`<leader>tiJ` / `<leader>tiK`<br>(below/above) | `<leader>tiH` / `<leader>tiL`<br>(left/right) |
| Move | `<leader>tK` / `<leader>tJ`<br>(up/down) | `<leader>tH` / `<leader>tL`<br>(left/right) |
| Delete | `<leader>tdd` | `<leader>tdc` |
| Duplicate | `<leader>tyyp` | `<leader>tyc` |
| Align | — | `<leader>tal` / `<leader>tac` / `<leader>tar`<br>(left/center/right) |

`<leader>tm` — insert a table; the only one here that also works outside an existing table.

#### Table navigation

New leader-key commands — pure cursor movement, original logic (not a wrapper around anything native). No-op outside a table cell.

| Keys | Function Summary |
| :--: | ----------------- |
| `<leader>tj` / `<leader>tk` | Jump to the cell below / above (same column), landing at its own content start — distinct from vim's native `j`/`k`, which preserve column position instead of jumping to content start. |
| `<leader>th` / `<leader>tl` | Jump to the cell to the left / right, landing at its own content start — no selection is created. Distinct from Obsidian's own built-in `Tab`/`Shift-Tab` cell navigation, which wraps to the next/previous row at a row's own left/right edge (and inserts a brand new row once it runs out of table) and selects the destination cell's entire content — `th`/`tl` always stay within the current row, no-op at its own left/right edge instead. |
| `<leader>tx` / `<leader>tX` | Exit the current table below / above — distinct from `gg`/`G`, which jump to the whole document's edge, not just past this table. |

### Settings

[Getting Started](#getting-started-1) | [Command Reference](#command-reference-1) | [Limitations](#limitations) | [Behavior Options](#behavior-options)

Open **Settings → Universal Cursor Hotkeys → Vim mode**. For the recommended Ctrl+P/N/B/F cursor keys — which already move the cursor in both Vim's Insert and Normal mode natively on macOS, but don't know about tables — see [macOS-style (Emacs keybindings)](#macos-style-emacs-keybindings)'s own Hotkey settings; assigning them fixes table entry and crossing in both modes.

**Motion upgrades:** each row is a plain on/off toggle — no bulk button here, since each motion is independent. See [Command Reference](#command-reference-1) above for what each toggle actually does; the table below covers the ON/OFF decision itself. Turning a toggle off restores vim's own native, unmodified behavior for that key.

| Toggle | Default | Description |
| ------ | :-----: | ------------ |
| `h` `l` `x` Character movement | ON | — |
| `j` `k` Line movement | ON | — |
| `w` `b` `e` Word motion | ON | — |
| `gg` `G` Document start/end | ON | — |
| `gj` `gk` Display-line movement | ON | — |
| `$` End of line (sticky column) | ON | Requires `j` `k` Line movement or `gj` `gk` Display-line movement to be ON. |
| `^` `I` First non-blank | ON | Requires Smart home (standard) to be ON. |
| `J` Join lines | ON | Requires Smart join to be ON. |

**Table commands:** Table structure and Table navigation each have their own toggle, plus a combined **Apply both** button that turns both on at once (disabled once both already are). Turning either off simply stops binding its leader-key commands.

| Toggle | Default | Description |
| ------ | :-----: | ------------ |
| `Space` `t` Table structure (16 commands) | OFF | [Command reference →](#table-structure) |
| `Space` `t` Table navigation (6 commands) | OFF | [Command reference →](#table-navigation) |
| Leader key | OFF<br>(`Space`) | **OFF:** `Space` (default).<br>**ON:** `\`. Only matters once Table structure or Table navigation above is on. |

Also shared here: [**Behavior Options**](#behavior-options) below — Smart home and Smart join extend some of the toggles above to be more Markdown-aware.

Turning an item off restarts Obsidian to fully restore vim's native behavior (a banner prompts this when needed).

### Limitations

[Getting Started](#getting-started-1) | [Command Reference](#command-reference-1) | [Settings](#settings-1) | [Behavior Options](#behavior-options)

- **A CJK input source can corrupt Vim's own key handling — not caused by this plugin:** With a CJK (e.g. romaji-based Japanese) input source active, a single press of a Vim motion key (commonly `g`, `j`, or `k`) can occasionally be misread — e.g. a single `g` behaving like `gg`, or `j`/`k` moving two lines instead of one. This is a known, upstream issue in Obsidian's underlying `codemirror-vim` engine ([issue #178](https://github.com/replit/codemirror-vim/issues/178)) and reproduces identically in vanilla Obsidian Vim mode with this plugin fully disabled. **Workaround:** switch to an ASCII/alphanumeric input source before using Vim motions.
- **`w`/`b`/`e` cross only one cell/row boundary per count:** A count like `5w` isn't fully precise once it needs to cross more than one cell or row boundary.
- **`gj`/`gk` do not support count prefixes across a crossing:** A count like `5gj` correctly steps through multiple visual lines within a single cell, but once the count needs to cross a row boundary or enter/exit a table, it stops consuming the count after that first crossing.
- **Entering a table from plain text always enters the leftmost cell:** `gj`/`gk` moving from a plain-text line into an adjacent table row always enters that row's leftmost cell — Obsidian's Live Preview table widget gives the outer editor no per-character position information for an unfocused table row, so there's no way to tell which cell a given column falls under before landing in one. The column *within* that cell is still preserved, matching row-to-row crossing within a table.
- **A count-prefixed `$` doesn't cross table rows:** `3$` stays within the current table cell rather than reaching the end of a line further down, the way real vim would outside a table.
- **For Obsidian's built-in Vim mode specifically:** not intended for use alongside a plugin that replaces or manages Vim's table-cell behavior on its own.
- **Turning on a toggle overrides your own binding:** if you've already customized one of these keys yourself, its toggle will override that customization while it's on.

---

## macOS-style (Emacs keybindings)

[Getting Started](#getting-started-2) | [Command Reference](#command-reference-2) | [Settings](#settings-2) | [Limitations](#limitations-1) | [Command Details](#command-details) | [Behavior Options](#behavior-options)

On macOS, cursor shortcuts — Ctrl+P (up), Ctrl+N (down), Ctrl+B/F (left/right), Ctrl+A/E (home/end), and Page Down/Up — work natively in Obsidian. This plugin restores them inside tables too, giving you seamless navigation just as physical cursor keys would — and Shift+Ctrl+P/N/B/F/A/E extend the selection the same way.

Windows users can enable the full set of macOS-style cursor shortcuts throughout Obsidian. Hotkey settings assigns all recommended hotkeys in three clicks.

Kill & Yank (Ctrl+K / Ctrl+Y) and Kill Region (Ctrl+W) bring the full Emacs editing workflow to Obsidian — and all three work seamlessly inside table cells, automatically handling newlines and pipe characters. Recenter-top-bottom (Ctrl+L) rounds out the workflow.

<table>
  <tr>
    <td align="center"><img width="350" height="270" alt="Enter and Exit tables" src="https://github.com/user-attachments/assets/6660fba8-a083-44d1-b1de-7f4753c8b5d9" /></td>
    <td align="center"><img width="350" height="270" alt="Smart home" src="https://github.com/user-attachments/assets/eaf49a42-396c-4676-a7fa-5c21cc1524fc" /></td>
  </tr>
  <tr>
    <td align="center"><img width="350" height="270" alt="Kill & Yank" src="https://github.com/user-attachments/assets/5b8d0de7-b6d2-42f4-a785-5b888fe7f1bf" /></td>
    <td align="center"><img width="350" height="270" alt="Smart join" src="https://github.com/user-attachments/assets/5a32e993-10a0-4ad8-b9f6-d6f71e0b8b86" /></td>
  </tr>
</table>

### Getting Started

[Command Reference](#command-reference-2) | [Settings](#settings-2) | [Limitations](#limitations-1) | [Command Details](#command-details) | [Behavior Options](#behavior-options)

No hotkeys are assigned by default.

**Quick setup (recommended):** Open **Settings → Universal Cursor Hotkeys → macOS (Emacs) style** and click **Apply recommended** for each of the three command groups — Cursor movement, Editing, and Other hotkeys. Three clicks and you're done.

**Manual setup:** Go to **Settings → Hotkeys**, search for "Universal Cursor Hotkeys", and assign keys individually.

### Command Reference

[Getting Started](#getting-started-2) | [Settings](#settings-2) | [Limitations](#limitations-1) | [Command Details](#command-details) | [Behavior Options](#behavior-options)

For detailed behavior of each command, see [Command Details](#command-details) below. Grouped the same way as Hotkey settings below.

#### Cursor movement

| Command Name | Recommended<br>Hotkey | Function Summary | Key<br>Repeat |
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

#### Editing

| Command Name | Recommended<br>Hotkey | Function Summary | Key<br>Repeat |
| :--------: | :----------------: | ---------------- | :---: |
| Kill line | Ctrl + K      | Kill from cursor to line end. Consecutive kills accumulate in the kill cache and clipboard. | ✓ |
| Kill region | Ctrl + W    | Cut the selected region to the kill cache. Table-aware: single-cell only; no-op for multi-row or cross-cell selections. |  |
| Copy region | —     | Copy the selected region to the kill cache without deleting it. Same table-aware constraints as Kill region. |  |
| Yank | Ctrl + Y           | Paste from the OS clipboard. Table-aware: converts newlines and pipes automatically. | ✓ |
| Delete char | Ctrl + D   | Forward-delete one character. Stops at cell boundary; joins sub-lines at `<br>` in Live Preview. | ✓ |
| Undo | Ctrl + /   | Undo the last change. | ✓ |
| Redo | —      | Redo the last undone change. | ✓ |
| Kill word left | — | Kill from cursor to the start of the previous word. Table-aware: stays within the current cell, no-op at the cell's own edge. | ✓ |
| Kill word right | — | Kill from cursor to the end of the next word. Table-aware: stays within the current cell, no-op at the cell's own edge. | ✓ |
| Uppercase word | — | Uppercase the selection, or the whole word at the cursor. Table-aware, CJK-aware. | ✓ |
| Lowercase word | — | Lowercase the selection, or the whole word at the cursor. Table-aware, CJK-aware. | ✓ |
| Capitalize word | — | Capitalize the selection (word by word), or the whole word at the cursor. Table-aware, CJK-aware. | ✓ |
| Transpose chars | — | Swap the two characters around the cursor; at the end of a line or cell, swaps the last two instead. Table-aware, Unicode-safe. | ✓ |
| Select all | —         | Windows replacement for Select all when Ctrl+A is reassigned to HOME. |  |

#### Other hotkeys

| Command Name | Recommended<br>Hotkey | Function Summary | Key<br>Repeat |
| :--------: | :----------------: | ---------------- | :---: |
| Recenter-top-bottom | Ctrl + L | Cycle the view so the cursor appears at the center, top, or bottom of the screen on successive presses. Resets on any other action. |  |
| Recenter | —         | Scroll the view so the cursor line is centered on screen. |  |

#### Table structure

Not commands this plugin owns — Obsidian's own built-in table-editing commands, listed here (mirroring Hotkey settings below) so they're easy to find and assign a hotkey to.

| Command Name | Recommended<br>Hotkey | Function Summary |
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

#### Table navigation

Six ordinary commands, assignable via **Settings → Hotkeys** or Hotkey settings below. No-op outside a table cell.

| Command Name | Recommended<br>Hotkey | Function Summary | Key<br>Repeat |
| :--------: | :----------------: | ---------------- | :---: |
| Move to cell left | — | Jumps to the adjacent cell to the left, landing at its own content start — no selection is created. Distinct from Obsidian's own built-in `Tab`/`Shift-Tab` cell navigation, which wraps to the next/previous row at a row's own left/right edge (inserting a new row once it runs out of table) and selects the destination cell's entire content. | ✓ |
| Move to cell right | — | Jumps to the adjacent cell to the right, landing at its own content start — no selection is created. Same distinction from `Tab`/`Shift-Tab` as Move to cell left. | ✓ |
| Move to cell below | — | Jumps directly to the cell in the row below (same table column), landing at its own content start. | ✓ |
| Move to cell above | — | Jumps directly to the cell in the row above (same table column), landing at its own content start. | ✓ |
| Exit table below | — | Exits the table to the line below — distinct from Cursor BOTTOM, which jumps to the whole document's end, not just past this table. | ✓ |
| Exit table above | — | Exits the table to the line above — distinct from Cursor TOP, which jumps to the whole document's start, not just past this table. | ✓ |

### Settings

[Getting Started](#getting-started-2) | [Command Reference](#command-reference-2) | [Limitations](#limitations-1) | [Command Details](#command-details) | [Behavior Options](#behavior-options)

Open **Settings → Universal Cursor Hotkeys → macOS (Emacs) style** to assign hotkeys without leaving the settings screen.

Each command group (Cursor movement, Editing, Other hotkeys, Table structure, Table navigation) is its own collapsible block: a **Command / Recommended Hotkey / Current Hotkey / Status** table, plus an **Individual** column header (▶) that reveals a per-row action button — hidden by default, since the block-level Apply button already covers the common case.

**Apply recommended:** each block has its own **Apply recommended** button that assigns every not-yet-set, non-conflicting hotkey in that group at once. (Table structure and Table navigation have no recommended hotkeys to apply, so they skip this button — Table structure instead links to Obsidian's own Hotkeys panel, filtered to table commands.)

**Live status:** Each row shows the current state of its hotkey:

| Status | Meaning |
|--------|---------|
| ✅Set | Recommended hotkey is assigned. |
| 🟢Custom | A non-recommended hotkey is assigned, with no conflict. |
| 🔵Available | Recommended hotkey is free to assign. |
| 🔵Used | Recommended hotkey is taken; applying it will not displace any command. |
| 🟡Used | Recommended hotkey is taken; applying it will displace one command. |
| 🔴Conflict | A conflict exists: a hotkey is currently assigned to more than one command. |

- **Command name / hotkey chips:** click either to open the hotkeys panel, filtered to that command or key.
- **Individual (▶):** reveals each row's own action button — **Set** (recommended hotkey is free), **Override** (takes the hotkey from whoever's currently using it — that command appears inline), or **Open →** (already set / no action needed here — just inspect it in Obsidian's own Hotkeys panel).

**Displaced commands:** Lists commands that would lose their only hotkey when recommended keys are applied. Each entry has an **Assign** button to reassign it via the hotkeys panel, and a **Restore** button to undo the displacement and return the key to its original command.

Also shared here: [**Behavior Options**](#behavior-options) below. Bare-key upgrades (arrow keys, Home/End/Page Up/Page Down, word navigation — no modifier needed) now live under [For everyone](#for-everyone) instead of this tab.

### Limitations

[Getting Started](#getting-started-2) | [Command Reference](#command-reference-2) | [Settings](#settings-2) | [Command Details](#command-details) | [Behavior Options](#behavior-options)

- **Range selection stops at table cell boundaries:** Shift+Ctrl+P/N/B/F/A/E extend the selection normally within plain text and within a single table cell. At a cell boundary, they neither cross into the adjacent cell (unlike plain Ctrl+B/F) nor extend the selection across cells (unlike Shift+Arrow keys). Use Shift+Arrow keys for cross-cell selection.

- **Brief scroll when entering a tall wrapped cell in Live Preview (UP):** When pressing UP into a cell whose wrapped content exceeds the screen height, the view momentarily scrolls to the cell start before jumping to the bottom visual line. This is an inherent side effect of the two-step navigation used to locate the bottom visual line within Obsidian's Live Preview table widget.

- **Multi-cell cut, copy, and paste are not supported (Kill Line / Kill Region / Copy Region / Yank):** Kill Line, Kill Region, Copy Region, and Yank are text-level operations; inside a table, they work on the text content within individual cells. Selecting multiple cells and attempting to cut, copy, or paste with these commands is not supported. For multi-cell cut, copy, and paste operations, use the right-click context menu instead.

- **Source Mode table detection is heuristic:** In Source Mode, table rows are identified by a simple string check (line starts and ends with `|`). Unlike Live Preview mode, which uses the syntax tree, this approach may produce unexpected behavior on lines that coincidentally match the pattern but are not part of a Markdown table.

- **Entering a table from plain text always enters the leftmost cell:** Cursor UP/DOWN moving from a plain-text line into an adjacent table row always enters that row's leftmost cell, matching Vim's own `gj`/`gk` — Obsidian's Live Preview table widget gives the outer editor no per-character position information for an unfocused table row, so there's no way to tell which cell a given column falls under before landing in one. The column *within* that cell is still preserved, matching row-to-row crossing within a table.

- **Shortcut Conflicts**
  - **On Windows — OS-level shortcuts not detected:** Ctrl+A (HOME) and Ctrl+Y (Yank) override the system Select all and Redo shortcuts respectively. Because these are OS-level defaults rather than Obsidian hotkeys, Hotkey settings cannot detect the conflict and will show them as available. The bundled **Select all** and **Redo** commands can be used as replacements — run them from the Command Palette or assign each a custom hotkey.
  - **Page down / Page up — paste conflict:** Assigning Ctrl+V (Windows) or Cmd+V (macOS) to Page down or Page up will break keyboard paste in non-editor plugin views (e.g., Excalidraw). Yank (Ctrl+Y) restores paste within the markdown editor, but cannot substitute for Cmd+V in those views. Right-click → Paste remains available as a workaround. It is recommended to assign these commands to keys that do not conflict with paste.

### Command Details

[Getting Started](#getting-started-2) | [Command Reference](#command-reference-2) | [Settings](#settings-2) | [Limitations](#limitations-1) | [Behavior Options](#behavior-options)

Note: (*) indicates behaviors specific to Live Preview mode.

<details>
<summary>Cursor UP</summary>

- **Within text:** Moves up to the previous visual line, equivalent to physical cursor keys.
- **From below a callout, image, embed, or thematic break (Live Preview) (*):** Enters the block and expands the markdown source, consistent with physical cursor key behavior. For callouts, the cursor must be on the empty line immediately below. For images and embeds (`![[...]]`, `![...](...)`), applies when the syntax starts at the beginning of the line. For thematic breaks (`---`, `***`, `___`), the cursor lands at the beginning of the break line.
- **From below a table (*):** If the cursor is on the line immediately below a table, it enters the table and moves to the left edge of the bottom visual line of the bottom-left cell.
- **Within a table cell (*):**
  - **First visual line:** Moves to the left edge of the bottom visual line of the cell directly above (same column). For non-wrapped cells, this is the cell start.
  - **On other visual lines:** Moves to the visual line above within the same cell, equivalent to physical cursor keys.
- **Exiting a table upward (*):** If in the top row of a table, exits the table to the line above.

</details>

<details>
<summary>Cursor DOWN</summary>

- **Within text:** Moves down one visual line, equivalent to physical cursor keys.
- **From above a callout, image, embed, or thematic break (Live Preview) (*):** Enters the block and expands the markdown source, consistent with physical cursor key behavior. For callouts, the next line must be a callout header (`> [!type]...`). For images and embeds (`![[...]]`, `![...](...)`), applies when the syntax starts at the beginning of the line. For thematic breaks (`---`, `***`, `___`), the cursor lands at the beginning of the break line.
- **From above a table (*):** If the cursor is on the line immediately above a table, it enters the table and moves to the beginning of the top-left cell.
- **Within a table cell (*):**
  - **On other visual lines:** Moves to the visual line below within the same cell, equivalent to physical cursor keys.
  - **Last visual line:** Jumps to the beginning of the cell in the row below (same column).
- **Exiting a table downward (*):** From the last visual line of any cell in the last row, moves the cursor out of the table to the beginning of the line below.

</details>

<details>
<summary>Cursor LEFT</summary>

- **Within text:** Moves left by one character, equivalent to physical cursor keys.
- **From below a table, at the line start (*):** Enters the table and moves to the end of the content in the bottom-right cell (bottom visual line).
- **Within a table cell (*):** Moves left one character within the cell content.
- **At the beginning of cell content (*):** Jumps to the end of the text in the cell on the left (same row).
- **In the leftmost cell, at the cell start (data row) (*):** Jumps to the end of the rightmost cell in the row above. (→ **Cross-Row Navigation** setting)
- **In the leftmost cell, at the cell start (header row) (*):** Exits the table to the line above. (→ **Cross-Row Navigation** setting)

</details>

<details>
<summary>Cursor RIGHT</summary>

- **Within text:** Moves right by one character, equivalent to physical cursor keys.
- **From above a table, at the line end (*):** Enters the table and moves to the beginning of the top-left cell.
- **Within a table cell (*):** Moves right one character within the cell content.
- **At the end of cell content (*):** Jumps to the beginning of the text in the cell to the right (same row).
- **In the rightmost cell, at the cell end (non-last row) (*):** Jumps to the beginning of the leftmost cell in the row below. (→ **Cross-Row Navigation** setting)
- **In the rightmost cell, at the cell end (last row) (*):** Exits the table to the line below. (→ **Cross-Row Navigation** setting)

</details>

<details>
<summary>Cursor HOME</summary>

- Moves toward the beginning of the line in up to 3 steps.
  - **Step 1:** Moves to the left edge of the current visual line (if the line wraps and the cursor is not on the first visual line). (→ **Visual Line Movement** setting)
  - **Step 2:** Moves to the content start, skipping Markdown markers — indentation, list markers (`- `, `* `, `+ `), checkboxes (`- [ ] `), ordered lists (`1. ` or `1) `), and blockquotes (`>`). With Smart home (advanced) ON, also skips heading markers (`# `), footnote indicators (`[^1]: `), and callout type markers (`[!type]`). (→ **Smart home** settings)
  - **Step 3:** Moves to the line start.
- **Within a table cell,** a further step applies:
  - At the start of a non-first in-cell line (after `<br>`): does not move further.
  - Jumps to the end of the text in the cell to the left (same row).
  - In the leftmost column: jumps to the rightmost cell in the row above. (→ **Cross-Row Navigation** setting)
  - In the header row, leftmost cell: exits the table to the line above.

</details>

<details>
<summary>Cursor END</summary>

- Moves toward the end of the line in up to 2 steps.
  - **Step 1:** Moves to the right edge of the current visual line (if the line wraps and the cursor is not on the last visual line). (→ **Visual Line Movement** setting)
  - **Step 2:** Moves to the line end.
- **Within a table cell,** a further step applies:
  - At the right edge of a non-last in-cell line (before `<br>`): does not move further.
  - Jumps to the start of the text in the cell to the right (same row).
  - In the rightmost column: jumps to the leftmost cell in the row below. (→ **Cross-Row Navigation** setting)
  - In the last row, rightmost cell: exits the table to the line below.
- **Within a table cell (Source Mode):**
  - **Cursor inside a `<br>` tag:** Jumps to the right edge of the next in-cell line, skipping the `<br>` tag.
  - **Cursor before the first `|` (ch=0):** Snaps to the content start of the first cell.

</details>

<details>
<summary>Cursor TOP / Cursor BOTTOM</summary>

- Jumps to the document's true beginning (TOP) or end (BOTTOM) — the buffer's own edge, not the current line's, so unlike Cursor HOME/END this does not apply Smart Home or skip any leading/trailing whitespace.
- **Table-aware (*):** If the target line is itself a table row, lands inside a cell's content rather than on the raw Markdown text — TOP in the **leftmost** cell (there's no position "before" that inside a rendered cell), BOTTOM in the **rightmost** cell's own end (the actual end of that row). Without this, a note starting with a table can land at the table's *last* row instead of its first when jumping to TOP; a note ending with a table can land at the *header* row instead of its last when jumping to BOTTOM.

</details>

<details>
<summary>Page down / Page up</summary>

- Scrolls the view down (Page down) or up (Page up) by one page.
- The cursor stays at the same screen position after scrolling.
- Works in plain text and inside Live Preview table cells, including soft-wrapped cells.

</details>

<details>
<summary>Word right / Word left</summary>

- **Within text:** Word right moves to the end of the next word; Word left moves to the start of the previous word — like Emacs's own `forward-word`/`backward-word`. Crosses line boundaries once no further word remains on the current line; does not stop on blank lines while crossing (only paragraph motion would; this plugin doesn't implement that).
- **CJK-aware:** Uses real morphological word boundaries, not just whitespace/punctuation splitting — a run of Chinese/Japanese text is segmented into its actual words rather than treated as one long word.
- **Within a table cell (*):** Searches the current cell first, including across `<br>`-separated in-cell lines, before crossing out of the cell.
- **At the edge of a cell's own content (*):** Jumps to the nearest word in the adjacent cell (same row), or, from a row's own edge cell, the adjacent row's opposite edge cell. Single cell/row crossing only.
- **Enters a table reached from plain text (*):** Word right landing on an adjacent table row enters its leftmost cell, at the first word's own end; Word left enters the rightmost cell, at the last word's own start — the same landing a cell-to-cell/row-to-row crossing already uses.

</details>

<details>
<summary>Kill Line</summary>

- **Outside a table:**
  - **Cursor not at line end:** Kills from the cursor to the end of the logical line. The killed text is copied to the kill cache and the system clipboard.
  - **Cursor at line end:** Kills the newline and joins with the next line.
  - **At end of file:** No operation.
- **Within a table cell (Live Preview or Source Mode):**
  - **Cursor not at in-cell line end:** Kills from the cursor to the end of the current in-cell line (up to `<br>` or `|`).
  - **At the end of an in-cell line (before `<br>`):** Deletes the `<br>` tag, joining the current in-cell line with the next.
  - **At the end of the last in-cell line (cell boundary):** No operation.
- **Smart join:** When **Smart join** is ON, the join strips everything to the left of the next line's content start — blockquote markers, list markers, indentation, and (with **Smart home (advanced)** ON) headings and footnotes. Applies both outside tables and inside table cells (`<br>` joins).
- **Consecutive kills:** Each successive Kill Line appends to the kill cache rather than replacing it. Any other editing action (cursor movement, typing, mouse click) resets the accumulation.
- **Interaction with standard copy/cut:** Pressing Ctrl+C or Ctrl+X clears the kill cache, breaking the consecutive-kill chain.

</details>

<details>
<summary>Kill Region</summary>

- **Outside a table:** Kills (cuts) the selected text and copies it to the kill cache and the system clipboard. The selection can span multiple lines.
- **Empty selection:** No operation.
- **Within a table cell (Live Preview or Source Mode):**
  - **Single-cell selection:** Kills the selected text within the cell. The kill cache stores normalized text (`<br>` → `\n`, `\|` → `|`).
  - **Multi-row selection (spanning multiple table rows):** No operation.
  - **Cross-cell selection (from and to in different cells):** No operation.
  - **Selection including `<br>` (Live Preview):** The `<br>` separator is removed along with the selected text, joining the surrounding sub-lines.
- **Kill chain:** Kill Region always resets the consecutive-kill chain. Killed text replaces the kill cache rather than appending to it.

</details>

<details>
<summary>Copy Region</summary>

- Same selection validation as Kill Region (empty selection: no operation; within a table, single-cell selection only — multi-row or cross-cell selections: no operation), but never deletes anything — the selection stays exactly as it was.
- Copies to the kill cache and the system clipboard, same table-normalized text (`<br>` → `\n`, `\|` → `|`) as Kill Region.
- **Kill chain:** Like Kill Region, always resets the consecutive-kill chain rather than appending to it.

</details>

<details>
<summary>Yank</summary>

- **Pastes from the OS clipboard** at the cursor position. Content copied via standard Ctrl+C / Ctrl+X, Kill Line, Kill Region, Copy Region, or Kill word left/right is accessible through Yank.
- **Outside a table:** Inserts the clipboard text as-is.
- **Within a table cell (Live Preview or Source Mode):** Newlines (`\n`) are converted to `<br>` and pipe characters (`|`) are escaped to `\|` before insertion to prevent breaking the table structure.
- **Empty clipboard:** No operation.

</details>

<details>
<summary>Delete Char</summary>

- **Within text:** Deletes the character at the cursor position (forward delete).
- **Within a table cell (Live Preview):**
  - **Within cell content:** Deletes one character forward.
  - **At the end of a non-last in-cell line (before `<br>`):** Deletes the `<br>` tag, joining the current sub-line with the next.
  - **At the end of the last in-cell line (cell boundary):** No operation.
- **Within a table cell (Source Mode):** Deletes one character forward without HTML tag awareness. No operation at the cell content boundary (before trailing whitespace and `|`).

</details>

<details>
<summary>Undo / Redo</summary>

- Thin wrappers around Obsidian's own undo/redo history — no table-aware or CJK-aware logic involved, since undo/redo operate on the whole document's edit history rather than any specific cell or word.
- **Why these exist as commands at all:** Obsidian's own Ctrl+Z / Ctrl+Shift+Z work, but aren't backed by an assignable Command — they come from CodeMirror's own internal keymap, invisible to Obsidian's Hotkeys settings and the Command palette. These commands make Undo/Redo assignable to any key you like, the same way every other command in this plugin is.

</details>

<details>
<summary>Kill Word Left / Kill Word Right</summary>

- **Within text:** Kill word right removes from the cursor to the end of the next word; Kill word left removes from the cursor to the start of the previous word. Crosses line boundaries freely — a plain-text document has no structural edge to stop at — except a table row, which it stops before rather than killing into.
- **Within a table cell (Live Preview or Source Mode):** A cell's own multiple `<br>`-separated lines are one continuous piece of text, same as plain-text lines — killing crosses them freely, removing the `<br>` along the way. **The cell itself is the real boundary:** a different cell (or row) is a different piece of content, so killing stops (no operation) once there's no word left anywhere in the current cell, rather than reaching into the next cell.
- **Kill chain:** Participates in the same consecutive-kill chain as Kill Line — repeated Kill word presses (or a mix with Kill Line) accumulate into one kill cache entry. Kill word right appends to the end of the cache; Kill word left prepends to the front, so the accumulated text stays in the same order it appeared in the buffer.

</details>

<details>
<summary>Uppercase word / Lowercase word / Capitalize word</summary>

- **With a selection:** Transforms the selected text. Uppercase/Lowercase apply per character; Capitalize applies per word (uppercases each word's first character, lowercases the rest), leaving whitespace and punctuation between words untouched. This selection-handling mirrors modern Emacs's own `upcase-dwim`/`downcase-dwim`/`capitalize-dwim` (the actual `M-u`/`M-l`/`M-c` defaults in current Emacs) — unlike the classic `upcase-word`/`downcase-word`/`capitalize-word`, which don't look at the region at all.
- **Without a selection:** Transforms the whole word at the cursor, regardless of which character the cursor is on — this differs from both the classic and dwim commands, which only affect the cursor position through the end of the word in the no-selection case.
- **Table-aware:** Crosses cell/row boundaries the same way Word right does when there's no word left in the current cell, including entering a table reached from plain text.
- **CJK-aware:** Uses the same word-boundary detection as Word right/left and Kill word, so full-width and mixed full-width/half-width text is handled correctly.

</details>

<details>
<summary>Transpose Chars</summary>

- **Within text:** Swaps the two characters around the cursor and moves the cursor past them — repeated presses drag a character rightward through the text, matching real Emacs's `transpose-chars`.
- **At the end of a line, in-cell line, or cell:** Instead of a no-op, swaps the last two characters before that position and leaves the cursor there — also matching real Emacs, and what makes repeating the command at a line/cell end useful (it toggles the last two characters back and forth).
- **Table-aware:** Cell and `<br>` boundaries are hard stops — unlike Word right/left or case conversion, this command never crosses into an adjacent cell or row, since swapping arbitrary adjacent characters could otherwise swap a `|` or part of a `<br>` tag with real content.
- **Unicode-safe:** Character boundaries are computed via the same grapheme-cluster-aware primitive CodeMirror's own `transposeChars` uses internally, so multi-byte characters (emoji, rare CJK ideographs) are swapped as whole units rather than corrupted.

</details>

<details>
<summary>Select all</summary>

- **Outside a table:** Selects the entire document, same as Obsidian's native Select all.
- **Within a table cell:** Selects only the content of the current cell, not the whole document — matching what native Obsidian's own Select all already does in Live Preview.
- **Why this command exists:** On Windows, Hotkey settings' recommended Ctrl+A → HOME assignment overrides the OS-level Select all shortcut with no built-in fallback (see Limitations → Shortcut Conflicts). This command restores one — run it from the Command Palette or assign it a custom hotkey.

</details>

<details>
<summary>Recenter-top-bottom</summary>

- Cycles the scroll position on successive presses so the cursor appears at the **center**, **top**, or **bottom** of the screen.
- Any other action (typing, cursor movement, mouse click) resets the cycle back to center.
- The cursor position does not change.
- Works the same regardless of cursor position — plain text or inside a table cell.

</details>

<details>
<summary>Recenter</summary>

- Scrolls the view so that the line the cursor is on appears at the vertical center of the screen. The cursor position does not change.
- Works the same regardless of cursor position — plain text or inside a table cell.

</details>

<details>
<summary>Move to cell left / right / above / below</summary>

- Jumps directly to the adjacent cell in the given direction, landing at that cell's own content start — no selection is created.
- **Left/right:** Distinct from Obsidian's own built-in `Tab`/`Shift-Tab` cell navigation, which wraps to the next/previous row at a row's own left/right edge (inserting a new row once it runs out of table) and selects the destination cell's entire content. Move to cell left/right always stays within the current row instead.
- **At a table edge** (leftmost/rightmost cell for left/right, first/last row for above/below): no operation, rather than wrapping or leaving the table.
- **No-op outside a table cell.**

</details>

<details>
<summary>Exit table above / below</summary>

- Moves the cursor out of the table entirely, to the line immediately above (Exit table above) or below (Exit table below) — distinct from Cursor TOP/BOTTOM, which jump to the whole document's true start/end, not just past this one table.
- Lands using the same Smart Home–aware positioning as this plugin's other table-adjacent landings.
- **No-op outside a table cell.**
- **If the table runs all the way to the document's last line (Exit table below):** Appends a blank line and lands there, matching Cursor DOWN's own end-of-file behavior.
- **If the table starts at the document's very first line (Exit table above):** There's no line above to exit to; instead of a no-op, lands on the table's own topmost row, leftmost cell (Smart Home–refined) — the furthest point actually reachable, matching Cursor TOP's own intent of always reaching the document's real first line.

</details>

---

## Behavior Options

[For everyone](#for-everyone) | [Vim mode](#vim-mode) | [macOS-style (Emacs keybindings)](#macos-style-emacs-keybindings)

Each toggle lives on whichever tab(s) it's actually relevant to — see the columns below. A setting shown on more than one tab is the exact same value everywhere (toggling it on one tab changes it on the others too).

| Setting | Default | For everyone | Vim mode | Emacs | Description |
| ------- | :-----: | :----------: | :------: | :---: | ----------- |
| Smart home (standard) | ON | ✓ | ✓ | ✓ | **ON:** HOME skips leading Markdown syntax (lists, ordered lists, checkboxes, indents, blockquotes) to reach content start — Windows Home / macOS Cmd+← style.<br>**OFF:** HOME moves directly to the start of the line — macOS / Emacs Ctrl+A style. |
| Smart home (advanced) | ON | ✓ | ✓ | ✓ | **ON:** also skips past headings (`# `), footnotes (`[^1]: `), and callout type markers (`[!type]`). Requires Smart home (standard) to be ON. |
| Smart join | OFF | — | ✓ | ✓ | **ON:** Kill Line join lands at the next line's content start, removing blockquote markers, list markers, and indentation. Pairs with Smart home (advanced) for headings and footnotes. Requires Smart home (standard) to be ON.<br>**OFF:** joins the next line as-is. |
| Visual line movement | ON | ✓ | — | ✓ | *HOME/END only — including the bare Home/End keys under For everyone, which run the exact same command as Emacs's Ctrl+A/E. Toggle lives on the Emacs tab only; there's no separate copy on For everyone.*<br>**ON:** the first HOME / END moves to the visual line edge.<br>**OFF:** moves directly to the logical line start / end. |
| Cross-row navigation | ON | ✓ | — | ✓ | *LEFT/RIGHT/HOME/END, same shared-command caveat as Visual line movement above (For everyone only has bare Home/End, not Left/Right, so only that part applies there).*<br>**ON:** LEFT / HOME at the first cell and RIGHT / END at the last cell wrap to the adjacent row.<br>**OFF:** stops at the boundary. |
| Double-click word select | ON | ✓ | — | — | **ON:** double-clicking (mouse) CJK (Chinese/Japanese) text selects just the word at that position — dictionary-based, not the entire unbroken run. Dragging afterward extends the selection a word at a time. Applies everywhere regardless of which tab you're using.<br>**OFF:** uses Obsidian's native double-click selection. |

---

## Acknowledgments
- The code and documentation for this plugin were developed with the assistance of AI.
