# Changelog

## [0.5.0] - 2026-05-xx

### Added
- **Kill Region (Ctrl+W):** Cuts the selected region to the kill cache and system clipboard. Table-aware: single-cell only; no-op for multi-row or cross-cell selections. Selecting text that spans a `<br>` separator in Live Preview removes the separator along with the selected text.
- **Delete Char (Ctrl+D):** Forward-deletes one character. In Live Preview table cells, stops at the cell boundary and joins in-cell sub-lines by removing the `<br>` tag when at the end of a non-last sub-line.
- **Recenter (Ctrl+L):** Scrolls the view so the cursor line is centered on screen. Works in plain text and inside table cells.
- **Page down / Page up:** Scrolls down or up one page, moving the cursor with it.

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
