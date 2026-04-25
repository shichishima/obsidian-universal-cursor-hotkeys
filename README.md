# Universal Cursor Hotkeys
Hotkey command set for cursor navigation. It also supports moving between Markdown table cells in Live Preview mode.


## Why this plugin?
In the standard Obsidian environment (especially on macOS), the Ctrl+P/N/B/F and Ctrl+A/E shortcuts often fail to work as expected within Markdown tables while in Live Preview mode.
This plugin provides hotkey commands for that purpose, enabling movement between table cells just as you would with physical cursor keys.
The commands ensure a consistent navigation experience across your entire note, supporting fluid movement in both plain text paragraphs and table cells.

Windows users can also use this plugin to enable Emacs-style cursor movement.
(Note: You must manually assign the commands in the hotkey settings; please resolve any conflicts with existing system shortcuts, such as Ctrl+A for "Select all," as needed).


## Key Features
- **Seamless Table Navigation:** Move between table cells and jump in/out of tables using the same keys as text editing.
- **Cross-Platform Compatibility:** Enable macOS-style (Emacs) navigation for Windows users.
- **Essential Movement Commands:** Includes support for Up (Ctrl+P), Down (Ctrl+N), Left (Ctrl+B), Right (Ctrl+F), Home (Ctrl+A), and End (Ctrl+E).
- **Visual-Line-Aware HOME/END:** On soft-wrapped lines, HOME stops at the start of the current visual line on the first press, then moves to the content start on the next. END stops at the end of the current visual line on the first press, then moves to the logical line end on the next.
- **Smart Home Position:** The Home command (Ctrl+A) is optimized for Markdown, intelligently moving the cursor to the start of the content by accounting for heading characters (`# `), list markers (`- `), and footnote indicators (`[^1]: `).
- **Select All Command:** Includes a dedicated "Select all" command to replace the default Ctrl+A behavior when the hotkey is reassigned.

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
| HOME  | Ctrl + A           | Smart HOME: Visual-line-aware; jumps to content start (skips markers) or previous cell. |
| END   | Ctrl + E           | Smart END: Visual-line-aware; jumps to end of visual/logical line or next cell. |
| Select all | (None)        | For Windows users: Restores "Select all" functionality if Ctrl+A is reassigned to HOME. Assign a custom key or run from the command palette. |

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
- **In the leftmost cell, at the cell start (data row) (*):** Jumps to the end of the rightmost cell in the row above.
- **In the leftmost cell, at the cell start (header row) (*):** Exits the table to the line above.

### Cursor RIGHT
- **Within text:** Moves right by one character, equivalent to physical cursor keys.
- **Within a table cell (*):** Moves right one character within the cell content.
- **At the end of cell content (*):** Jumps to the beginning of the text in the cell to the right (same row).
- **In the rightmost cell, at the cell end (non-last row) (*):** Jumps to the beginning of the leftmost cell in the row below.
- **In the rightmost cell, at the cell end (last row) (*):** Exits the table to the line below.

### Cursor HOME
- **Within text:** Moves to the beginning of the line in **3 steps**.
  - **Step 1:** Moves to the start of the current visual line (if wrapped).
  - **Step 2:** Moves to the start of the actual content, skipping markers such as indentation, list markers (`- `, `* `, `+ `), checkboxes (`- [ ] `), ordered lists (`1. ` or `1) `), blockquotes (`>`), heading markers (`# `), and footnote indicators (`[^1]: `).
  - **Step 3:** Moves to the absolute beginning of the logical line (ch=0).
- **Within a table cell (*):** Moves to the beginning of the current in-cell line (the sub-line within a `<br>`-separated cell). Does not skip Markdown markers.
  - **At the beginning of an in-cell line (*):** Jumps to the end of the text in the cell to the left, or to the previous row's rightmost cell if in the leftmost column.
  - **In the header row, leftmost cell, at the cell start (*):** Exits the table to the line above.

### Cursor END
- **Within text:** Moves to the end of the line in **2 steps** (visual-line-aware).
  - **Step 1:** Moves to the end of the current visual line (if wrapped).
  - **Step 2:** Moves to the end of the logical line (the entire paragraph).
- **Within a table cell (*):** Moves to the right edge of the in-cell line (visual-line-**un**aware).
  - **At the end of bottom in-cell line (*):** Jumps to the beginning of the text in the cell to the right, or to the next row's leftmost cell if in the rightmost column.
  - **At the right edge of a non-bottom in-cell line:** Does not move any further.
  - **In the last row, rightmost cell, at cell end (*):** Exits the table to the line below.

## Limitations
- **No Word-Level Navigation:** Movement by word (e.g., Option/Ctrl + Left/Right) is currently not supported.
- **No Range Selection:** Shift+modifier combinations (e.g., Shift+Ctrl+P/N/B/F/A/E) for extending the selection are not supported. Use Shift+Arrow keys instead.
- **Brief scroll flash when entering a tall wrapped cell (UP):** When pressing UP into a cell whose wrapped content exceeds the screen height, the view momentarily scrolls to the cell start before jumping to the bottom visual line. This is an inherent side effect of the two-step navigation used to locate the bottom visual line within Obsidian's Live Preview table widget.
- **Ctrl+N may exit one visual line early in soft-wrapped table cells (DOWN) (*):** When the cursor is on the second-to-last visual line past the column corresponding to the last visual line's end-of-content, Ctrl+N exits to the next row instead of advancing one visual line. Both this case and being on the last visual line itself cause `goDown` to clip to the same end-of-content position; the two states are indistinguishable via any CM6 API inside the Live Preview table widget.
- **Shortcut Conflicts (Windows):** On Windows, these commands may conflict with system defaults (e.g., Ctrl+A for Select all). Users must manually resolve these conflicts in the settings. A dedicated "Select all" command is provided by this plugin to restore this functionality.

## Acknowledgments
- The code and documentation for this plugin were developed with the assistance of AI.
