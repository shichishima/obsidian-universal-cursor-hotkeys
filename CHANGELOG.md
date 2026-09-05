# Changelog

## [Unreleased]

### Fixed

- **Ctrl-N/Ctrl-P now preserve the cursor's column when crossing table row boundaries, matching Vim's own `gj`/`gk` convention:** previously, crossing into the row above/below, exiting the table entirely into plain text, or entering a table fresh from plain text, always landed at the cell's or line's own content start, discarding whichever column the cursor was actually at. This also fixes the column being silently forgotten when a crossing happens to pass through a blank or short line, or when moving within a single cell across its own blank `<br>`-separated sub-lines. Entering a table fresh from plain text still always enters the leftmost cell (matching Vim's own `gj`/`gk`, which has the same restriction for the same reason — Obsidian's Live Preview table widget gives the outer editor no per-character position information for an unfocused table row), but the column within that cell is now preserved too.
- **Quick setup assistant's "Override" no longer displaces a disabled plugin's stale hotkey entry:** a disabled plugin's leftover hotkey mapping was being treated as a real conflict to take over, even though it isn't shown as one and restoring it later does nothing (the command isn't actually registered).
- **`gj`/`gk` now preserve the goal column correctly in Obsidian popout windows ("Open in new window"):** previously, crossing a table row or entering a table with `gj`/`gk` in a popout could reset it (landing at the start or end of the line instead), because the correction step's own deferred read ran too early relative to the freshly-created table cell's own inner view. Fixed by lengthening that wait to match the two-frame delay already used elsewhere in this codebase for the same class of Obsidian-internal reconciliation. Also switched every `setTimeout`/`requestAnimationFrame` call in this plugin from the bare `window` global to Obsidian's own popout-aware `activeWindow`/`activeDocument` — the bare global always resolves to the *main* window regardless of which window is actually being edited in, which is the correct fix per Obsidian's own API guidance even though it wasn't the cause of the `gj`/`gk` bug above.

## [0.10.2] - 2026-09-01

### Fixed

- **`gg`/`G` (document start/end) now preserve Vim's Visual/Visual Line selection:** previously, jumping to the document's start or end while in Visual or Visual Line mode collapsed the selection back to a single point, silently dropping out of Visual mode. `G` (forward) had a second bug on top of that: it also visually landed one line short of the true last line, because our own follow-up selection dispatch got reinterpreted by Vim's own external-selection handling (the same logic that syncs a mouse-drag selection) and shifted back by one character.
- **`gg`/`G` in Visual/Visual Line mode now match Obsidian's own native Vim behavior around tables:** landing on a table row used to still collapse the selection (cell-precision landing, a Normal-mode-only feature, was running unconditionally). Now skipped entirely while a selection is active — Vim's own native selection extends across the table's raw text instead, the same way it does with no table-precision handling involved at all. `G` onto a table with nothing after it still adds a blank line first (fixing a Live Preview rendering glitch — an unstyled, full-table-height caret with nowhere real to sit), but now keeps the selection through it instead of dropping it, and yank/delete/case-conversion (`y`/`d`/`c`/`gu`/`gU`/`g~`) run on the exact same range that's highlighted.

## [0.10.1] - 2026-08-27

### Fixed

- **CJK double-click-drag now segments correctly when the drag starts on non-CJK text:** previously, double-clicking an English-only line then dragging into an adjacent CJK (Chinese/Japanese) line never segmented the CJK side — starting the gesture on non-CJK text handed the whole drag to Obsidian's native handler. Also fixes a related same-line case: dragging from CJK text into plain English text now extends to the whole word, instead of stopping at the exact drag position.

## [0.10.0] - 2026-08-23

### Added

- **Table structure (Vim side):** New leader-key commands under Vim support, wrapping Obsidian's own built-in table commands — `Space` is the leader by default (`\` optional).
  - `tJ`/`tK` move the current row down/up, `tH`/`tL` move the current column left/right.
  - `tiJ`/`tiK` insert a row below/above, `tiH`/`tiL` insert a column left/right.
  - `to`/`tO` insert a row below/above (alias).
  - `tdd` deletes the current row, `tdc` deletes the current column.
  - `tyyp` duplicates the current row, `tyc` duplicates the current column.
  - `tal`/`tac`/`tar` align the current column left/center/right.
  - `tm` inserts a table (the only one of the sixteen that also works outside an existing table).
- **Table navigation (Vim side):** New leader-key commands, also under Vim support — pure cursor movement, no-op outside a table cell.
  - `th`/`tj`/`tk`/`tl` jump straight to the adjacent cell, landing at its own content start — a coarser, spreadsheet-style jump distinct from vim's native `j`/`k` (which preserve column position instead).
  - `tx`/`tX` exit the current table below/above (distinct from `gg`/`G`, which jump to the whole document's edge, not just past this table).
- **Table structure (Emacs side):** The Quick setup assistant now also lists Obsidian's own sixteen built-in table-structure commands (insert/move/delete/duplicate row or column, column alignment, insert table) in a collapsible section, so they're easy to find and assign a hotkey to even though this plugin doesn't own them. No "Apply recommended" (nothing to recommend for someone else's commands) — instead a link opens Obsidian's Hotkeys panel pre-filtered to the table-command group.
- **Table navigation (Emacs side):** Also available on the Emacs side as six ordinary commands (Move to cell left/right/below/above, Exit table below/above), listed in their own collapsible "Table navigation" section of the Quick setup assistant — no recommended hotkey, assignable via Settings → Hotkeys or the Quick setup assistant, same as Redo.
- **Double-click word select (Behavior Options):** Double-clicking CJK (Chinese/Japanese) text now selects the dictionary-segmented word at that position (same Intl.Segmenter engine as Word right/left and Vim's `w`/`b`/`e`), instead of Obsidian's native double-click, which treats an entire unbroken run of CJK characters as one "word" since there's no whitespace between them. Also fixes the same case for a Latin term embedded in CJK prose (e.g. "API" inside a Japanese sentence). Dragging after the double-click extends the selection a whole word at a time. On by default; Latin-only text is unaffected either way.

### Changed

- **Vim support: the native motion-fix toggles, plus Join lines, are now on by default for new installs** — Character movement, Line movement, Word motion, Document start/end, Display-line movement, End of line (sticky column), First non-blank (Smart home), and Join lines. The motion-fix toggles only change behavior inside Live Preview table cells (already-broken native Vim behavior), so the risk of silently overriding a real custom binding is low; Join lines self-gates on its own Smart join prerequisite (still off by default) and falls back to vim's native join until Smart join is turned on. Table structure and Table navigation remain off by default — both bind a leader-key sequence on top of Vim's own native `Space` binding. Existing installs keep whatever values are already saved; this only affects fresh installs.
- **First non-blank/Join lines toggles no longer gray out when their Smart home (standard)/Smart join prerequisite is off:** both already self-gated live at call time (falling back to vim's native behavior until the prerequisite is on), so the grayout was cosmetic only — it just forced an unnecessary two-step enable sequence.

### Fixed

- **Vim `u` / Ctrl-R now undo/redo table-structure changes from inside a table cell:** previously only reached whichever cell's own local undo history was active, which has no record of structural edits (row/column insert/delete) — the only way to undo one was to leave the cell first. Now delegates to Obsidian's own outer-document Undo/Redo (the same one Cmd+Z and this plugin's own Undo/Redo commands use) while inside a table cell.
- **Table structure `tdd` (delete row) now leaves the cursor on the row that took the deleted one's place** — matching vim's own `dd` convention — instead of jumping back to the table's first row.
- **`G` now appends a blank line at a note-ending table, instead of landing inside it:** previously landed inside the table's own last row when a note ended with a table, unlike `tx`'s own identical EOF case (append a blank line and exit). `gg` is unaffected (asymmetric, matching `tx`/`tX`'s own precedent), as are count-prefixed jumps like `5G`, which target a specific line rather than "the end".
- **Vim support's "Apply all" now turns on First non-blank/Join lines unconditionally:** previously skipped either one if its own Smart home (standard)/Smart join prerequisite was off at the time — both already fall back safely to vim's native behavior in that case, so there was no correctness reason to skip them.
- **Settings tab no longer jumps to the top on every toggle:** scroll position is now preserved across the tab's internal re-renders.

## [0.9.0] - 2026-08-14

### Added

- **Word commands:** New commands, table-aware and built on a new word-boundary engine (real morphological word boundaries, not just whitespace/punctuation splitting) — so CJK text (Chinese/Japanese/Korean) is handled correctly. The same engine also fixes Vim's own `w`/`b`/`e`; see Fixed, below.
  - **Word right / Word left:** Like Emacs's own `forward-word`/`backward-word`. Crosses cell/row boundaries the same way Ctrl+B/F already do.
  - **Kill word left / Kill word right:** Like Emacs's own `backward-kill-word`/`kill-word`. Participates in the same consecutive-kill chain as Kill line. Unlike Word right/left, stays within the current cell — stops (no-op) at its edge rather than reaching into a different cell or table row.
  - **Uppercase word / Lowercase word / Capitalize word:** Like Emacs's own `upcase-word`/`downcase-word`/`capitalize-word`, but transform the whole word at the cursor rather than just from the cursor to the word's end. Transforms the selection instead when one is active. Crosses cell/row boundaries the same way Word right does.
- **Cursor TOP / Cursor BOTTOM:** New commands, like Emacs's own `beginning-of-buffer`/`end-of-buffer` — the buffer's true edge, not Smart-Home-adjusted like Cursor HOME/END. Table-aware: TOP lands in a table row's leftmost cell, BOTTOM in its rightmost cell's own end.
- **Copy region:** New command, like Emacs's own `kill-ring-save`. Same table-aware validation as Kill region (single-cell only), but never deletes — the selection stays intact.
- **Transpose chars:** New command, like Emacs's own `transpose-chars`. Repeated presses drag a character rightward through the text; at a line/cell end, swaps the last two characters instead. Table-aware: cell and `<br>` boundaries are hard stops. Unicode-safe — multi-byte characters (emoji, rare CJK ideographs) are swapped as whole units.
- **Undo / Redo:** New commands. Obsidian's own Ctrl+Z / Ctrl+Shift+Z work but aren't backed by an assignable Command, so they can't be rebound via Settings → Hotkeys; these thin wrappers make Undo/Redo assignable like any other command in this plugin. Undo defaults to Ctrl+/ (a real Emacs binding); Redo has no recommended hotkey.
- **Quick setup assistant:** Commands with no recommended hotkey now also show an **Open →** button (previously shown only once a hotkey was already assigned) — same as clicking the command name, both open the Hotkeys panel filtered to this plugin's commands.

### Fixed

- **Vim `w`/`b`/`e` (and `W`/`B`/`E`/`ge`/`gE`) now segment CJK text properly:** built on the same word-boundary engine introduced above — Word motion previously treated a whole run of Chinese/Japanese/Korean characters as one giant word (0.8.0 documented this as "ASCII words only"). Applies both to in-cell motion and to landing after a table row/cell crossing.
- **Vim `gg`/`G` now apply Smart Home inside table cells too:** Landing on a table row previously only skipped leading whitespace, ignoring the Smart home (standard/advanced) settings that already applied everywhere else `gg`/`G` land — e.g. jumping to a note whose first row starts with a list-marker-like cell no longer stops one character early.

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
