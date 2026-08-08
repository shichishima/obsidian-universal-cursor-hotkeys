# Changelog

## [Unreleased]

### Added

- **Word right / Word left:** New commands, like Emacs's own `forward-word`/`backward-word`. Table-aware, crossing cell/row boundaries the same way Ctrl+B/F already do; CJK-aware, using real morphological word boundaries.
- **Cursor TOP / Cursor BOTTOM:** New commands, like Emacs's own `beginning-of-buffer`/`end-of-buffer` — the buffer's true edge, not Smart-Home-adjusted like Cursor HOME/END. Table-aware: TOP lands in a table row's leftmost cell, BOTTOM in its rightmost cell's own end.

### Fixed

- **Vim `w`/`b`/`e` (and `W`/`B`/`E`/`ge`/`gE`) now segment CJK text properly:** Word motion previously treated a whole run of Japanese/Chinese/Korean characters as one giant word (0.8.0 documented this as "ASCII words only"); it now uses real morphological word boundaries. Applies both to in-cell motion and to landing after a table row/cell crossing.

## [0.8.0] - 2026-08-02

### Added

- **Vim support (experimental):** New Settings section. Fixes several known gaps in Live Preview table cells for Obsidian's built-in Vim mode. Off by default; each item below is an independent toggle.
  - `h`/`l`/`x`: Moves by character correctly across multi-byte text and at cell/line boundaries.
  - `j`/`k`: Crosses row boundaries the same way Ctrl+N/P already do, preserving column position.
  - `w`/`b`/`e` (and `W`/`B`/`E`/`ge`/`gE`): Crosses cell/row boundaries the same way vim's own word motions cross lines. ASCII words only.
  - `gg`/`G`: Always reaches the note's actual first/last line, including exiting a table cell entirely.
  - `gj`/`gk`: Moves by visual line inside table cells the same way Ctrl+N/P already do, tracking the visual column across wrapped lines.
  - `$`: Sticky end-of-line goal column when followed by j/k or gj/gk, including across table row crossings. `D`/`C` share the same underlying motion but behave the same either way.
  - `^`/`I`: Reuses Smart home to skip Markdown syntax, not just whitespace.
  - `J`: Reuses Smart join to strip blockquote/list markers and indentation on join.
  - **Apply all:** Turns on everything eligible in one click — skips `^`/`I` or `J` if their own Smart home (standard) / Smart join prerequisite is currently off.

### Fixed

- **Corrected documentation — range selection is supported:** Shift+Ctrl+P/N/B/F/A/E extend the selection normally, both in plain text and inside table cells — this always worked; an earlier README incorrectly listed it as unsupported. (Crossing a table cell boundary is the one remaining edge case; see Limitations.)

## [0.7.0] - 2026-07-13

### Added

- **Quick setup assistant:** New hotkey management screen in Settings. **Apply recommended** assigns all recommended hotkeys for a command group in one click. Each row shows the live assignment status of its recommended hotkey. You can undo applied hotkeys via **Restore** in the Displaced commands section.
- **Special key assignments:** Assign bare Home, End, Page Down, and Page Up keys directly from the Settings screen — Obsidian's hotkeys panel does not support modifier-free keys.

## [0.6.1] - 2026-06-27

### Performance

- **Page down / Page up:** When the scroll range contains no tables, callouts, or embeds, now uses the same mechanism as the physical Page Up/Down keys, significantly reducing scroll latency.

### Compatibility

- Verified compatible with Obsidian 1.13.

## [0.6.0] - 2026-06-06

### Added

- HOME and END are now visual-line-aware inside soft-wrapped Live Preview table cells. With Visual Line Movement ON, the first press moves to the visual line edge before proceeding to the content start or the adjacent cell.
- **Ctrl+P and Ctrl+N now enter callout blocks, images, embeds, and thematic breaks (`---`, `***`, `___`) in Live Preview mode.** Previously, these lines were skipped entirely. For images and embeds (`![[...]]`, `![...](...)`), this applies when the syntax starts at the beginning of the line; the markdown source is expanded on entry, consistent with physical cursor key behavior.
- Smart home (Advanced): HOME inside a callout header line (`> [!type] Title`) now stops at the title start as an extra step before falling back to the blockquote prefix position.
- **Recenter top-bottom:** Cycles the view so the cursor appears at the center, top, or bottom of the screen on successive presses. Resets on any other action. Recommended hotkey: Ctrl+L.

### Fixed

- Ctrl+N no longer exits a soft-wrapped table cell one visual line too early.
- Ctrl+F and Ctrl+B no longer cause unwanted scrolling when entering a Live Preview table from outside.
- Smart Home (Advanced): footnote prefix detection now uses a non-greedy match, fixing incorrect cursor placement when a line contains a second `]:` sequence (e.g., inside an inline code span).

### Changed

- **Ctrl+B from below a table:** Now lands at the end of the rightmost cell in the last row (bottom visual line), consistent with moving backward through the document. Previously landed at the start of the leftmost cell, same as Ctrl+P.
- **Page down / Page up:** Reimplemented using step-by-step cursor movement instead of a direct CM6 command. The cursor now stays at the same screen position after scrolling, and movement correctly passes through Live Preview table cells rather than skipping over them.
- Internal refactor: cursor operations inside Live Preview table cells now use the inner EditorView directly. No user-facing behavior change.

## [0.5.0] - 2026-05-21

### Added
- **Kill Region (Ctrl+W):** Cuts the selected region to the kill cache and system clipboard. Table-aware: single-cell only; no-op for multi-row or cross-cell selections. Selecting text that spans a `<br>` separator in Live Preview removes the separator along with the selected text.
- **Delete Char (Ctrl+D):** Forward-deletes one character. In Live Preview table cells, stops at the cell boundary and joins in-cell sub-lines by removing the `<br>` tag when at the end of a non-last sub-line.
- **Recenter (Ctrl+L):** Scrolls the view so the cursor line is centered on screen. Works in plain text and inside table cells.
- **Page down / Page up:** Scrolls down or up one page, moving the cursor with it.
- **Select all (table-aware):** When the cursor is inside a table cell, selects only the content of that cell rather than the entire document.
- **Smart Home in nested blockquotes:** HOME now navigates inside nested blockquotes (`>>`, `> > >`, etc.), recognizing inner markup (headings, lists, task lists, ordered lists, footnotes) in the same way as regular lines.
- **Smart join (default OFF):** When Kill Line joins the next line, strips everything to the left of the next line's content start — blockquote markers, list markers, indentation, and (with Smart home (advanced) ON) headings and footnotes. Controlled independently of Smart home; disabled when Smart home (standard) is OFF.

### Changed
- **Smart home (standard):** Kill Line join behavior is no longer tied to this setting. Description updated to clarify the Windows Home / macOS Cmd+← analogy.

## [0.4.2] - 2026-05-13

### Changed
- Addressed Obsidian plugin review feedback.

## [0.4.1] - 2026-05-09

### Fixed
- **Kill chain not reset by Yank and cursor movement:** Yank and cursor-movement commands now correctly break the consecutive-kill accumulation, consistent with Emacs behavior.
- **Yank cursor position after pasting text ending with a newline:** Cursor no longer jumps to the next cell when yanking content that ends with `\n` into a table cell.

## [0.4.0] - 2026-05-04

### Added
- **Kill Line (Ctrl+K):** Kills from the cursor to the end of the logical line. Consecutive kills accumulate in the kill cache and system clipboard. Inside a table cell, kill stops at the in-cell line boundary (`<br>` or `|`). Killing at the end of an in-cell line (before `<br>`) removes the `<br>` tag, joining the two in-cell lines. Works in both Live Preview and Source Mode.
- **Yank (Ctrl+Y):** Pastes from the OS clipboard. Inside a table cell (Live Preview or Source Mode), newlines are converted to `<br>` and pipe characters are escaped to `\|` to preserve table structure.
- **Source Mode table support for HOME/END (Ctrl+A/E):** HOME and END now navigate in-cell lines and trigger cross-row navigation inside Markdown tables in Source Mode, consistent with Live Preview behavior. In Source Mode, END also skips past a `<br>` tag when the cursor is positioned inside it.

### Changed
- **Smart home (standard) setting** now also controls Kill Line join behavior: when ON, leading whitespace on the next line is included in the kill when joining lines at end-of-line.

## [0.3.0] - 2026-05-02

### Added
- Settings screen with four toggle options: Visual line movement, Smart home (standard), Smart home (advanced), and Cross-row navigation.
- Smart home now works inside table cells, skipping in-cell line boundaries.

## [0.2.3] - 2026-04-18

### Fixed
- Ctrl+N behavior in the bottom row of tables.

## [0.2.2] - 2026-04-13

### Fixed
- Footnote Smart Home incorrectly jumping to ch=0 due to a Live Preview widget artifact.

## [0.2.1] - 2025-01-28

### Added
- "Select all" command to restore Ctrl+A select-all functionality when reassigned to HOME.

### Fixed
- Cursor movement from empty table cells.
- Table exit conditions for file-end and header-only tables.
- Unified delimiter-line regex for more reliable table detection.
- Unstable `cm.dispatch` behavior in empty cells.

## [0.2.0] - 2026-04-04

### Added
- Visual-line-aware UP/DOWN navigation for soft-wrapped table cells.
- Visual-line-aware HOME (Ctrl+A) and END (Ctrl+E) for soft-wrapped lines outside tables.
- In-cell HOME and END support.

### Fixed
- Multiple table navigation bugs in cursor-up movement.
- Cursor placement when entering a wrapped table cell from above.

## [0.1.0] - 2026-01-12

### Added
- Initial release.
- Ctrl+P/N/B/F/A/E cursor navigation commands for text and Markdown table cells in Live Preview mode.
- Smart Home with Markdown marker skipping (lists, checkboxes, blockquotes, headings, footnotes).
- Seamless table entry and exit in all directions.
- Cross-row navigation (wrapping between rows via LEFT/RIGHT/HOME/END).
