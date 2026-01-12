# Universal Cursor Hotkeys
Hotkey command set for cursor navigation. It also supports moving between Markdown table cells in Live Preview mode.


## Why this plugin?
In the standard Obsidian environment (especially on macOS), the Ctrl-PNBF/AE shortcuts often fail to work as expected within Markdown tables while in Live Preview mode.
This plugin provides hotkey commands for that purpose, enabling movement between table cells just as you would with physical cursor keys.
The commands ensure a consistent navigation experience across your entire note, supporting fluid movement in both plain text paragraphs and table cells.

Windows users can also use this plugin to enable Emacs-style cursor movement.
(Note: You must manually assign the commands in the hotkey settings; please resolve any conflicts with existing system shortcuts, such as Ctrl-A for "Select All," as needed).


## Key Features
- **Seamless Table Navigation:** Move between table cells and jump in/out of tables using the same keys as text editing.
- **Cross-Platform Compatibility:** Enable macOS-style (Emacs) navigation for Windows users.
- **Essential Movement Commands:** Includes support for Up (Ctrl-P), Down (Ctrl-N), Left (Ctrl-B), Right (Ctrl-F), Home (Ctrl-A), and End (Ctrl-E).
- **Smart Home Position:** The Home command (Ctrl-A) is optimized for Markdown, intelligently moving the cursor to the start of the content by accounting for heading characters (`# `), list markers, and footnote indicators (`[^1]: `).


## How to Setup
- **Enable the Plugin:** After installation, enable "Universal Cursor Hotkeys" in your community plugins list.
- **Assign Hotkeys:** Go to the plugin settings and click the "+" button to register and assign your preferred keys (e.g., Ctrl-P, Ctrl-N) to each command.

### Note:
- No hotkeys are assigned by default. You must manually set them to enable the navigation.
- **Windows Users**: Assigning Ctrl+A or Ctrl+F will overwrite standard OS shortcuts like "Select All" or "Find".

## Recommended Hotkey Map
For more information on how each command behaves, please refer to the Command Details section below.

| Command Name | Recommended<br>Hotkey | Function Summary |
| :--------: | :----------------: | ---------------- |
| UP    | Ctrl + P           | Smart UP: Text/Cell movement and Table entry (from bottom) & exit (from top). |
| DOWN  | Ctrl + N           | Smart DOWN: Text/Cell movement and Table entry (from top) & exit (from bottom). |
| LEFT  | Ctrl + B           | Smart LEFT: Move by character or jump to the previous cell. |
| RIGHT | Ctrl + F           | Smart RIGHT: Move by character or jump to the next cell. |
| HOME  | Ctrl + A           | Smart HOME: Jump to content start (skips markers) or previous cell. |
| END   | Ctrl + E           | Smart END: Jump to the end of the logical line or next cell. |

## Command Details
Note: (*) indicates behaviors specific to Markdown tables in Live Preview mode.

### Cursor UP
- **Within text**: Moves up to the previous visual line, equivalent to physical cursor keys.
- **From below table (*)**: If the cursor is on the line immediately below a table, it enters the table and moves to the beginning of the bottom-left cell.
- **Within a table cell (First line) (*)**: If at the first visual line of a cell, it moves to the beginning of the current cell.
- **To row above (*)**: If already at the beginning of a cell, it moves to the beginning of the cell in the row directly above.
- **Exit table upward (*)**: If at the beginning of a header cell (top row), it exits the table to the line above.

### Cursor DOWN
- **Within text**: Moves down to the next visual line, equivalent to physical cursor keys.
- **From above table (*)**: If the cursor is on the line immediately above a table, it enters the table and moves to the beginning of the top-left cell.
- **To row below (*)**: Jumps to the beginning of the cell in the row below, regardless of the current cursor position. This differs from physical cursor keys, which follow each visual line.
- **Exit table downward (*)**: From any position in the last row, moves the cursor out of the table to the beginning of the line below.

### Cursor LEFT
- **Within text**: Moves left one character, or moves to the previous visual line at the start of a line, equivalent to physical cursor keys.
- **Within a table cell (*):** Moves to the previous visual line if the text is wrapped, equivalent to physical cursor keys.
- **At the beginning of a cell (*):** Jumps to the end of the text in the cell to the left.
- **In the leftmost cell (*):** Stops at the beginning of the text. Unlike physical cursor keys, it will not move to the row above or exit the table.

### Cursor RIGHT
- **Within text**: Moves right one character, or moves to the next visual line at the end of a line, equivalent to physical cursor keys.
- **Within a table cell (*)**: Moves to the next visual line if the text is wrapped, equivalent to physical cursor keys.
- **At the end of a cell (*)**: Jumps to the beginning of the text in the cell to the right.
- **In the rightmost cell (*)**: Stops at the end of the text. Unlike physical cursor keys, it will not move to the row below or exit the table.

### Cursor HOME
- **Within text**: Jumps to the start of the actual content by skipping Markdown markers:
  - **Lists & Quotes**: Skips indentation (leading whitespace), unordered list markers (`- `, `* `), checkboxes (`- [ ] `), ordered lists (`1. ` or `1) `), and blockquotes (`>`).
  - **Headings & Footnotes**: Skips heading markers (`# `) and footnote indicators (`[^1]: `). Unlike the standard HOME key, which moves directly to the absolute beginning of the line, this command stops first at the beginning of the text content.
  - **At the start of content**: If the cursor is already at the beginning of the text content, it moves to the absolute beginning of the logical line.
- **Within a table cell (*)**: Jumps to the beginning of the text in the same cell. Note: Unlike the "Within text" behavior, this does not skip Markdown markers, as markers such as list items (`- `) or checkboxes (`- [ ] `) are not rendered as functional elements within tables in Live Preview. It also does not move to the start of the visual line.
- **At the beginning of a cell (*)**: Jumps to the end of the text in the cell to the left.
- **In the leftmost cell (*)**: Stops at the beginning of the text. It will not move to the row above.

### Cursor END
- **Within text**: Moves the cursor to the end of the logical line (the entire paragraph), regardless of visual line wrapping.
- **Within a table cell (*)**: Jumps to the end of the text in the same cell. Note: It does not move to the end of the visual line.
- **At the end of a cell (*)**: Jumps to the beginning of the text in the cell to the right.
- **In the rightmost cell (*)**: Stops at the end of the text. It will not move to the row below.


## Limitations
- **No Word-Level Navigation**: Movement by word (e.g., Option/Ctrl + Left/Right) is currently not supported.
- **No Visual Line Navigation for HOME/END**: Cursor HOME and Cursor END move directly to the beginning or end of the actual logical line (the entire paragraph), rather than the visually wrapped line.
- **No Key Repeat Support**: Each command executes only upon the initial key press.
  - **On macOS**: When a key is held down, subsequent movements are handled by the OS. Consequently, specialized table navigation (like cell-to-cell jumps) will not apply during repetition.
  - **On Windows**: Key repeat is not supported for these commands; they will only execute once per press.
- **Shortcut Conflicts (Windows)**: On Windows, these commands may conflict with system defaults (e.g., Ctrl-A for Select All). Users must manually resolve these conflicts in the settings.

