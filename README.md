# Universal Cursor Hotkeys
macOS/Emacs-style navigation and Kill & Yank — seamlessly across Markdown tables.

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

## Overview

Navigate your entire note with Ctrl+P/N/B/F — including inside Markdown tables.
On macOS, these shortcuts stop working the moment your cursor enters a table in Live Preview mode. This plugin fixes that, providing seamless movement between table cells just as you would with physical cursor keys.

Windows users can also use this plugin to enable Emacs-style cursor movement.

Kill & Yank (Ctrl+K / Ctrl+Y) and Kill Region (Ctrl+W) bring the full Emacs editing workflow to Obsidian — and all three work seamlessly inside table cells, automatically handling newlines and pipe characters.


## Install & Setup

### Installation

1. Open **Settings → Community plugins** and click **Browse**.
2. Search for **Universal Cursor Hotkeys** and click **Install**.
3. Click **Enable** to activate the plugin.

### Assign Hotkeys

Go to **Settings → Hotkeys**, search for "Universal Cursor Hotkeys", and assign your preferred keys (e.g., Ctrl+P, Ctrl+N) to each command.

### Note:
- No hotkeys are assigned by default. You must manually set them to enable the navigation.
- **Windows Users**: Assigning Ctrl+A or Ctrl+F will overwrite standard OS shortcuts like "Select all" or "Find".


## Command Reference

For detailed behavior of each command, see [Command Details](#command-details) below.

| Command Name | Recommended<br>Hotkey | Function Summary |
| :--------: | :----------------: | ---------------- |
| UP    | Ctrl + P           | Smart UP: Text/Cell movement and Table entry (from bottom) & exit (from top). |
| DOWN  | Ctrl + N           | Smart DOWN: Text/Cell movement and Table entry (from top) & exit (from bottom). |
| LEFT  | Ctrl + B           | Smart LEFT: Move by character or jump to the previous cell. |
| RIGHT | Ctrl + F           | Smart RIGHT: Move by character or jump to the next cell. |
| HOME  | Ctrl + A           | Smart HOME: Visual-line-aware; jumps to content start (skips markers) or previous cell. |
| END   | Ctrl + E           | Smart END: Visual-line-aware; jumps to end of visual/logical line or next cell. |
| Kill line | Ctrl + K      | Kill from cursor to line end. Consecutive kills accumulate in the kill cache and clipboard. |
| Kill region | Ctrl + W    | Cut the selected region to the kill cache. Table-aware: single-cell only; no-op for multi-row or cross-cell selections. |
| Yank | Ctrl + Y           | Paste from the OS clipboard. Table-aware: converts newlines and pipes automatically. |
| Delete char | Ctrl + D   | Forward-delete one character. Stops at cell boundary; joins sub-lines at `<br>` in Live Preview. |
| Recenter | Ctrl + L      | Scroll the view so the cursor line is centered on screen. |
| Page down | (None)        | Scroll down one page, moving the cursor with it. ⚠️ Assigning Ctrl+V breaks paste in non-editor plugin views (e.g., Excalidraw) (Windows). |
| Page up | (None)        | Scroll up one page, moving the cursor with it. ⚠️ Assigning Cmd+V breaks paste in non-editor plugin views (macOS). |
| Select all | (None)        | For Windows users: Restores "Select all" functionality if Ctrl+A is reassigned to HOME. Assign a custom key or run from the command palette. |


## Settings

| Setting | Default | Description |
| ------- | :-----: | ----------- |
| Visual line movement | ON | **ON:** the first HOME / END moves to the visual line edge.<br>**OFF:** moves directly to the logical line start / end. |
| Smart home (standard) | ON | **ON:** HOME skips leading Markdown syntax (lists, ordered lists, checkboxes, indents, blockquotes) to reach content start — Windows Home / macOS Cmd+← style.<br>**OFF:** HOME moves directly to the start of the line — macOS / Emacs Ctrl+A style. |
| Smart home (advanced) | ON | **ON:** also skips past headings (`# `) and footnotes (`[^1]: `). Requires Smart home (standard) to be ON. |
| Smart join | OFF | **ON:** Kill Line join lands at the next line's content start, removing blockquote markers, list markers, and indentation. Pairs with Smart home (advanced) for headings and footnotes. Requires Smart home (standard) to be ON.<br>**OFF:** joins the next line as-is. |
| Cross-row navigation | ON | **ON:** LEFT / HOME at the first cell and RIGHT / END at the last cell wrap to the adjacent row.<br>**OFF:** stops at the boundary. |


## Limitations
- **No Word-Level Navigation:** Movement by word (e.g., Option/Ctrl + Left/Right) is currently not supported.
- **No Range Selection:** Shift+modifier combinations (e.g., Shift+Ctrl+P/N/B/F/A/E) for extending the selection are not supported. Use Shift+Arrow keys instead.
- **Brief scroll flash when entering a tall wrapped cell in Live Preview (UP):** When pressing UP into a cell whose wrapped content exceeds the screen height, the view momentarily scrolls to the cell start before jumping to the bottom visual line. This is an inherent side effect of the two-step navigation used to locate the bottom visual line within Obsidian's Live Preview table widget.
- **Ctrl+N may exit one visual line early in soft-wrapped table cells (DOWN):** In Live Preview tables, when the cursor is on the second-to-last visual line past the column corresponding to the last visual line's end-of-content, Ctrl+N exits to the next row instead of advancing one visual line. Both this case and being on the last visual line itself cause `goDown` to clip to the same end-of-content position; the two states are indistinguishable via any CM6 API inside the Live Preview table widget.
- **Multi-cell cut, copy, and paste are not supported (Kill Line / Kill Region / Yank):** Kill Line, Kill Region, and Yank are text-level operations; inside a table, they work on the text content within individual cells. Selecting multiple cells and attempting to cut or paste with these commands is not supported. For multi-cell cut, copy, and paste operations, use the right-click context menu instead.
- **Source Mode table detection is heuristic:** In Source Mode, table rows are identified by a simple string check (line starts and ends with `|`). Unlike Live Preview mode, which uses the syntax tree, this approach may produce unexpected behavior on lines that coincidentally match the pattern but are not part of a Markdown table.
- **Shortcut Conflicts**
  - **On Windows:** Assigning Ctrl+A (HOME) overrides the system Select all shortcut. Use the bundled "Select all" command (run from the command palette or assign it a custom hotkey) as a replacement.
  - **Page down / Page up — paste conflict:** Assigning Ctrl+V (Windows) or Cmd+V (macOS) to Page down or Page up will break keyboard paste in non-editor plugin views (e.g., Excalidraw). Yank (Ctrl+Y) restores paste within the markdown editor, but cannot substitute for Cmd+V in those views. Right-click → Paste remains available as a workaround. It is recommended to assign these commands to keys that do not conflict with paste.


## Command Details

Note: (*) indicates behaviors specific to Markdown tables in Live Preview mode.

<details>
<summary>Cursor UP</summary>

- **Within text:** Moves up to the previous visual line, equivalent to physical cursor keys.
- **From below a table (*):** If the cursor is on the line immediately below a table, it enters the table and moves to the left edge of the bottom visual line of the bottom-left cell.
- **Within a table cell (*):**
  - **First visual line:** Moves to the left edge of the bottom visual line of the cell directly above (same column). For non-wrapped cells, this is the cell start.
  - **On other visual lines:** Moves to the visual line above within the same cell, equivalent to physical cursor keys.
- **Exiting a table upward (*):** If in the top row of a table, exits the table to the line above.

</details>

<details>
<summary>Cursor DOWN</summary>

- **Within text:** Moves down one visual line, equivalent to physical cursor keys.
- **From above a table (*):** If the cursor is on the line immediately above a table, it enters the table and moves to the beginning of the top-left cell.
- **Within a table cell (*):**
  - **On other visual lines:** Moves to the visual line below within the same cell, equivalent to physical cursor keys.
  - **Last visual line:** Jumps to the beginning of the cell in the row below (same column).
- **Exiting a table downward (*):** From the last visual line of any cell in the last row, moves the cursor out of the table to the beginning of the line below.

</details>

<details>
<summary>Cursor LEFT</summary>

- **Within text:** Moves left by one character, equivalent to physical cursor keys.
- **Within a table cell (*):** Moves left one character within the cell content.
- **At the beginning of cell content (*):** Jumps to the end of the text in the cell on the left (same row).
- **In the leftmost cell, at the cell start (data row) (*):** Jumps to the end of the rightmost cell in the row above. (→ **Cross-Row Navigation**)
- **In the leftmost cell, at the cell start (header row) (*):** Exits the table to the line above. (→ **Cross-Row Navigation**)

</details>

<details>
<summary>Cursor RIGHT</summary>

- **Within text:** Moves right by one character, equivalent to physical cursor keys.
- **Within a table cell (*):** Moves right one character within the cell content.
- **At the end of cell content (*):** Jumps to the beginning of the text in the cell to the right (same row).
- **In the rightmost cell, at the cell end (non-last row) (*):** Jumps to the beginning of the leftmost cell in the row below. (→ **Cross-Row Navigation**)
- **In the rightmost cell, at the cell end (last row) (*):** Exits the table to the line below. (→ **Cross-Row Navigation**)

</details>

<details>
<summary>Cursor HOME</summary>

- **Within text:** Moves to the beginning of the line in **3 steps**.
  - **Step 1:** Moves to the start of the current visual line (if wrapped). (→ **Visual Line Movement**)
  - **Step 2:** Moves to the start of the actual content, skipping markers such as indentation, list markers (`- `, `* `, `+ `), checkboxes (`- [ ] `), ordered lists (`1. ` or `1) `), blockquotes (`>`), heading markers (`# `), and footnote indicators (`[^1]: `). (→ **Smart home** settings)
  - **Step 3:** Moves to the absolute beginning of the logical line (ch=0).
- **Within a table cell:** Moves to the beginning of the current in-cell line (the sub-line within a `<br>`-separated cell), respecting the **Smart home** settings.
  - **At the beginning of a non-first in-cell line (after `<br>`):** Does not move any further.
  - **At the beginning of the first in-cell line:** Jumps to the end of the text in the cell to the left, or to the previous row's rightmost cell if in the leftmost column. (→ **Cross-Row Navigation**)
  - **In the header row, leftmost cell, at the cell start:** Exits the table to the line above. (→ **Cross-Row Navigation**)

</details>

<details>
<summary>Cursor END</summary>

- **Within text:** Moves to the end of the line in **2 steps** (visual-line-aware).
  - **Step 1:** Moves to the end of the current visual line (if wrapped). (→ **Visual Line Movement**)
  - **Step 2:** Moves to the end of the logical line (the entire paragraph).
- **Within a table cell:** Moves to the right edge of the current in-cell line (visual-line-**un**aware).
  - **At the right edge of a non-last in-cell line (before `<br>`):** Does not move any further.
  - **At the right edge of the last in-cell line:** Jumps to the beginning of the text in the cell to the right, or to the next row's leftmost cell if in the rightmost column. (→ **Cross-Row Navigation**)
  - **In the last row, rightmost cell, at cell end:** Exits the table to the line below. (→ **Cross-Row Navigation**)
  - **In Source Mode, cursor inside a `<br>` tag:** Jumps to the right edge of the next in-cell line, skipping the `<br>` tag.
  - **In Source Mode, cursor before the first `|` (ch=0):** Snaps to the content start of the first cell.

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
<summary>Yank</summary>

- **Pastes from the OS clipboard** at the cursor position. Content copied via standard Ctrl+C / Ctrl+X, Kill Line, or Kill Region is accessible through Yank.
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
<summary>Recenter</summary>

- Scrolls the view so that the line the cursor is on appears at the vertical center of the screen. The cursor position does not change.
- Works the same regardless of cursor position — plain text or inside a table cell.

</details>

<details>
<summary>Page down / Page up</summary>

- Scrolls the view down (Page down) or up (Page up) by one page, moving the cursor with it.
- Behavior is independent of cursor position — works the same in plain text and inside table cells.

</details>


## Acknowledgments
- The code and documentation for this plugin were developed with the assistance of AI.
