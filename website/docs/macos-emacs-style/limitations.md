---
sidebar_position: 3
title: Limitations
---

# macOS (Emacs) style — Limitations

- **Range selection stops at table cell boundaries:** Shift+Ctrl+P/N/B/F/A/E extend the selection normally within plain text and within a single table cell. At a cell boundary, they neither cross into the adjacent cell (unlike plain Ctrl+B/F) nor extend the selection across cells (unlike Shift+Arrow keys). Use Shift+Arrow keys for cross-cell selection.

- **Brief scroll when entering a tall wrapped cell in Live Preview (UP):** When pressing UP into a cell whose wrapped content exceeds the screen height, the view momentarily scrolls to the cell start before jumping to the bottom visual line. This is an inherent side effect of the two-step navigation used to locate the bottom visual line within Obsidian's Live Preview table widget.

- **Multi-cell cut, copy, and paste are not supported (Kill Line / Kill Region / Copy Region / Yank):** Kill Line, Kill Region, Copy Region, and Yank are text-level operations; inside a table, they work on the text content within individual cells. Selecting multiple cells and attempting to cut, copy, or paste with these commands is not supported. For multi-cell cut, copy, and paste operations, use the right-click context menu instead.

- **Source Mode table detection is heuristic:** In Source Mode, table rows are identified by a simple string check (line starts and ends with `|`). Unlike Live Preview mode, which uses the syntax tree, this approach may produce unexpected behavior on lines that coincidentally match the pattern but are not part of a Markdown table.

- **Entering a table from plain text always enters the leftmost cell:** Cursor UP/DOWN moving from a plain-text line into an adjacent table row always enters that row's leftmost cell, matching Vim's own `gj`/`gk` — Obsidian's Live Preview table widget gives the outer editor no per-character position information for an unfocused table row, so there's no way to tell which cell a given column falls under before landing in one. The column *within* that cell is still preserved, matching row-to-row crossing within a table.

- **Shortcut Conflicts**
  - **On Windows — OS-level shortcuts not detected:** Ctrl+A (HOME) and Ctrl+Y (Yank) override the system Select all and Redo shortcuts respectively. Because these are OS-level defaults rather than Obsidian hotkeys, Hotkey settings cannot detect the conflict and will show them as available. The bundled **Select all** and **Redo** commands can be used as replacements — run them from the Command Palette or assign each a custom hotkey.
  - **Page down / Page up — paste conflict:** Assigning Ctrl+V (Windows) or Cmd+V (macOS) to Page down or Page up will break keyboard paste in non-editor plugin views (e.g., Excalidraw). Yank (Ctrl+Y) restores paste within the markdown editor, but cannot substitute for Cmd+V in those views. Right-click → Paste remains available as a workaround. It is recommended to assign these commands to keys that do not conflict with paste.
