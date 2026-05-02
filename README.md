# Universal Cursor Hotkeys
Hotkey command set for macOS and Emacs-style cursor navigation and text editing. Supports seamless movement between Markdown table cells, with table-aware Kill & Yank for efficient editing.

<table>
  <tr>
    <td align="center"><img width="450" src="https://github.com/user-attachments/assets/9e3cc803-2d95-47d9-9c7a-e205ab7b8c2b"/></td>
    <td align="center"><img width="450" src="https://github.com/user-attachments/assets/f976b69a-779d-4ad3-a49b-a673278fe8da"/></td>
  </tr>
  <tr>
    <td align="center"><img width="450" src="https://github.com/user-attachments/assets/14b0be17-67f3-4fe2-ae48-37808509b4bf"/></td>
  </tr>
</table>

## Why this plugin?
In the standard Obsidian environment (especially on macOS), the Ctrl+P/N/B/F and Ctrl+A/E shortcuts often fail to work as expected within Markdown tables while in Live Preview mode.
This plugin provides hotkey commands for that purpose, enabling movement between table cells just as you would with physical cursor keys.
The commands ensure a consistent navigation experience across your entire note, supporting fluid movement in both plain text paragraphs and table cells.

Windows users can also use this plugin to enable Emacs-style cursor movement.
(Note: You must manually assign the commands in the hotkey settings; please resolve any conflicts with existing system shortcuts, such as Ctrl+A for "Select all," as needed).

Kill & Yank (Ctrl+K / Ctrl+Y) bring the full editing workflow into Obsidian. Kill from the cursor to the end of a line, chain multiple kills to accumulate text, then Yank it all back wherever you need it. Both commands work inside table cells too — including multi-line cells that use `<br>` — automatically handling newlines and pipe characters so your table structure is never broken.


## Key Features
- **Seamless Table Navigation:** Move between table cells and jump in/out of tables using the same keys as text editing.
- **Cross-Platform Compatibility:** Enable macOS-style (Emacs) navigation for Windows users.
- **Essential Movement Commands:** Includes support for Up (Ctrl+P), Down (Ctrl+N), Left (Ctrl+B), Right (Ctrl+F), Home (Ctrl+A), and End (Ctrl+E).
- **Visual-Line-Aware HOME/END:** On soft-wrapped lines, HOME stops at the start of the current visual line on the first press, then moves to the content start on the next. END stops at the end of the current visual line on the first press, then moves to the logical line end on the next.
- **Smart Home Position:** The Home command (Ctrl+A) is optimized for Markdown, intelligently moving the cursor to the start of the content by accounting for heading characters (`# `), list markers (`- `), and footnote indicators (`[^1]: `).
- **Select All Command:** Includes a dedicated "Select all" command to replace the default Ctrl+A behavior when the hotkey is reassigned.
- **Kill Line:** Kills from the cursor to the end of the line (or end of the in-cell line inside a table). Consecutive kills append to the kill cache and the system clipboard. Works in both Live Preview and Source Mode.
- **Yank:** Pastes from the OS clipboard at the cursor position. When yanking into a table cell (Live Preview or Source Mode), newlines and pipe characters are automatically converted to preserve table structure.

## How to Setup
- **Enable the Plugin:** After installation, enable "Universal Cursor Hotkeys" in your community plugins list.
- **Assign Hotkeys:** Go to the plugin settings and click the hotkey button to register and assign your preferred keys (e.g., Ctrl+P, Ctrl+N) to each command.

### Note:
- No hotkeys are assigned by default. You must manually set them to enable the navigation.
- **Windows Users**: Assigning Ctrl+A or Ctrl+F will overwrite standard OS shortcuts like "Select all" or "Find".

## Recommended Hotkey Map
For more information on how each command behaves, please refer to the Command Details section below.

| Command Name | Recommended<br>Hotkey | Function Summary |
| :--------: | :----------------: | ---------------- |
| UP    | Ctrl + P           | Smart UP: Text/Cell movement and Table entry (from bottom) & exit (from top). |
| DOWN  | Ctrl + N           | Smart DOWN: Text/Cell movement and Table entry (from top) & exit (from bottom). |
| LEFT  | Ctrl + B           | Smart LEFT: Move by character or jump to the previous cell. |
| RIGHT | Ctrl + F           | Smart RIGHT: Move by character or jump to the next cell. |
| HOME  | Ctrl + A           | Smart home: Visual-line-aware; jumps to content start (skips markers) or previous cell. |
| END   | Ctrl + E           | Smart END: Visual-line-aware; jumps to end of visual/logical line or next cell. |
| Select all | (None)        | For Windows users: Restores "Select all" functionality if Ctrl+A is reassigned to HOME. Assign a custom key or run from the command palette. |
| Kill line | Ctrl + K      | Kill from cursor to line end. Consecutive kills accumulate in the kill cache and clipboard. |
| Yank | Ctrl + Y      | Paste from the OS clipboard. Table-aware: converts newlines and pipes automatically. |

## Command Details
Note: (*) indicates behaviors specific to Markdown tables in Live Preview mode.

### Cursor UP
- **Within text:** Moves up to the previous visual line, equivalent to physical cursor keys.
- **From below a table (*):** If the cursor is on the line immediately below a table, it enters the table and moves to the left edge of the bottom visual line of the bottom-left cell.
- **Within a table cell (*):**
  - **First visual line:** Moves to the left edge of the bottom visual line of the cell directly above (same column). For non-wrapped cells, this is the cell start.
  - **On other visual lines:** Moves to the visual line above within the same cell, equivalent to physical cursor keys.
- **Exiting a table upward (*):** If in the top row of a table, exits the table to the line above.

### Cursor DOWN
- **Within text:** Moves down one visual line, equivalent to physical cursor keys.
- **From above a table (*):** If the cursor is on the line immediately above a table, it enters the table and moves to the beginning of the top-left cell.
- **Within a table cell (*):**
  - **On other visual lines:** Moves to the visual line below within the same cell, equivalent to physical cursor keys.
  - **Last visual line:** Jumps to the beginning of the cell in the row below (same column).
- **Exiting a table downward (*):** From the last visual line of any cell in the last row, moves the cursor out of the table to the beginning of the line below.

### Cursor LEFT
- **Within text:** Moves left by one character, equivalent to physical cursor keys.
- **Within a table cell (*):** Moves left one character within the cell content.
- **At the beginning of cell content (*):** Jumps to the end of the text in the cell on the left (same row).
- **In the leftmost cell, at the cell start (data row) (*):** Jumps to the end of the rightmost cell in the row above. (→ **Cross-Row Navigation**)
- **In the leftmost cell, at the cell start (header row) (*):** Exits the table to the line above. (→ **Cross-Row Navigation**)

### Cursor RIGHT
- **Within text:** Moves right by one character, equivalent to physical cursor keys.
- **Within a table cell (*):** Moves right one character within the cell content.
- **At the end of cell content (*):** Jumps to the beginning of the text in the cell to the right (same row).
- **In the rightmost cell, at the cell end (non-last row) (*):** Jumps to the beginning of the leftmost cell in the row below. (→ **Cross-Row Navigation**)
- **In the rightmost cell, at the cell end (last row) (*):** Exits the table to the line below. (→ **Cross-Row Navigation**)

### Cursor HOME
- **Within text:** Moves to the beginning of the line in **3 steps**.
  - **Step 1:** Moves to the start of the current visual line (if wrapped). (→ **Visual Line Movement**)
  - **Step 2:** Moves to the start of the actual content, skipping markers such as indentation, list markers (`- `, `* `, `+ `), checkboxes (`- [ ] `), ordered lists (`1. ` or `1) `), blockquotes (`>`), heading markers (`# `), and footnote indicators (`[^1]: `). (→ **Smart home** settings)
  - **Step 3:** Moves to the absolute beginning of the logical line (ch=0).
- **Within a table cell:** Moves to the beginning of the current in-cell line (the sub-line within a `<br>`-separated cell), respecting the **Smart home** settings.
  - **At the beginning of a non-first in-cell line (after `<br>`):** Does not move any further.
  - **At the beginning of the first in-cell line:** Jumps to the end of the text in the cell to the left, or to the previous row's rightmost cell if in the leftmost column. (→ **Cross-Row Navigation**)
  - **In the header row, leftmost cell, at the cell start:** Exits the table to the line above. (→ **Cross-Row Navigation**)

### Cursor END
- **Within text:** Moves to the end of the line in **2 steps** (visual-line-aware).
  - **Step 1:** Moves to the end of the current visual line (if wrapped). (→ **Visual Line Movement**)
  - **Step 2:** Moves to the end of the logical line (the entire paragraph).
- **Within a table cell:** Moves to the right edge of the current in-cell line (visual-line-**un**aware).
  - **At the right edge of a non-last in-cell line (before `<br>`):** Does not move any further.
  - **At the right edge of the last in-cell line:** Jumps to the beginning of the text in the cell to the right, or to the next row's leftmost cell if in the rightmost column. (→ **Cross-Row Navigation**)
  - **In the last row, rightmost cell, at cell end:** Exits the table to the line below. (→ **Cross-Row Navigation**)
  - **In Source Mode, cursor inside a `<br>` tag:** Jumps to the right edge of the next in-cell line, skipping the `<br>` tag.
  - **In Source Mode, cursor before the first `|` (ch=0):** Snaps to the content start of the first cell.

### Kill Line

- **Within text, cursor not at line end:** Kills from the cursor to the end of the logical line. The killed text is copied to the kill cache and the system clipboard.
- **Within text, cursor at line end:** Kills the newline and joins with the next line. When **Smart home (standard)** is ON, any leading whitespace at the start of the next line is also killed.
- **At end of file:** No operation.
- **Within a table cell:**
  - **Cursor not at in-cell line end:** Kills from the cursor to the end of the current in-cell line (up to `<br>` or `|`).
  - **At the end of an in-cell line (before `<br>`):** Deletes the `<br>` tag, joining the current in-cell line with the next.
  - **At the end of the last in-cell line (cell boundary):** No operation.
- **Consecutive kills:** Each successive Kill Line appends to the kill cache rather than replacing it. Any other editing action (cursor movement, typing, mouse click) resets the accumulation.
- **Interaction with standard copy/cut:** Pressing Ctrl+C or Ctrl+X clears the kill cache, breaking the consecutive-kill chain.

### Yank

- **Pastes from the OS clipboard** at the cursor position. Content copied via standard Ctrl+C / Ctrl+X or Kill Line is accessible through Yank.
- **Outside a table:** Inserts the clipboard text as-is.
- **Within a table cell (Live Preview or Source Mode):** Newlines (`\n`) are converted to `<br>` and pipe characters (`|`) are escaped to `\|` before insertion to prevent breaking the table structure.
- **Empty clipboard:** No operation.

## Settings

| Setting | Default | Description |
| ------- | :-----: | ----------- |
| Visual Line Movement | ON | **ON:** the first HOME / END moves to the visual line edge.<br>**OFF:** moves directly to the logical line start / end. |
| Smart home (standard) | ON | **ON:** HOME jumps past leading Markdown syntax (lists, ordered lists, checkboxes, indents, blockquotes). Kill Line also trims leading whitespace when joining lines.<br>**OFF:** moves directly to the start of the line. Kill Line joins lines as-is, preserving leading whitespace. |
| Smart home (advanced) | ON | **ON:** also skips past headings (`# `) and footnotes (`[^1]: `). Requires Smart home (standard) to be ON. |
| Cross-Row Navigation | ON | **ON:** LEFT / HOME at the first cell and RIGHT / END at the last cell wrap to the adjacent row.<br>**OFF:** stops at the boundary. |

## Limitations
- **No Word-Level Navigation:** Movement by word (e.g., Option/Ctrl + Left/Right) is currently not supported.
- **No Range Selection:** Shift+modifier combinations (e.g., Shift+Ctrl+P/N/B/F/A/E) for extending the selection are not supported. Use Shift+Arrow keys instead.
- **Brief scroll flash when entering a tall wrapped cell (UP):** When pressing UP into a cell whose wrapped content exceeds the screen height, the view momentarily scrolls to the cell start before jumping to the bottom visual line. This is an inherent side effect of the two-step navigation used to locate the bottom visual line within Obsidian's Live Preview table widget.
- **Ctrl+N may exit one visual line early in soft-wrapped table cells (DOWN) (*):** When the cursor is on the second-to-last visual line past the column corresponding to the last visual line's end-of-content, Ctrl+N exits to the next row instead of advancing one visual line. Both this case and being on the last visual line itself cause `goDown` to clip to the same end-of-content position; the two states are indistinguishable via any CM6 API inside the Live Preview table widget.
- **Shortcut Conflicts (Windows):** On Windows, these commands may conflict with system defaults (e.g., Ctrl+A for Select all). Users must manually resolve these conflicts in the settings. A dedicated "Select all" command is provided by this plugin to restore this functionality.
## Acknowledgments
- The code and documentation for this plugin were developed with the assistance of AI.
