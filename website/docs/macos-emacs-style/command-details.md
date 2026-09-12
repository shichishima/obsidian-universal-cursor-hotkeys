---
sidebar_position: 4
title: Command Details
mode: macos-emacs-style
---

# macOS (Emacs) style — Command Details

Note: (*) indicates behaviors specific to Live Preview mode.

<details>
<summary>Cursor UP</summary>

- **Within text:** Moves up to the previous visual line, equivalent to physical cursor keys.
- **From below a callout, image, embed, or thematic break (Live Preview) (\*):** Enters the block and expands the markdown source, consistent with physical cursor key behavior. For callouts, the cursor must be on the empty line immediately below. For images and embeds (`![[...]]`, `![...](...)`), applies when the syntax starts at the beginning of the line. For thematic breaks (`---`, `***`, `___`), the cursor lands at the beginning of the break line.
- **From below a table (\*):** If the cursor is on the line immediately below a table, it enters the table and moves to the left edge of the bottom visual line of the bottom-left cell.
- **Within a table cell (\*):**
  - **First visual line:** Moves to the left edge of the bottom visual line of the cell directly above (same column). For non-wrapped cells, this is the cell start.
  - **On other visual lines:** Moves to the visual line above within the same cell, equivalent to physical cursor keys.
- **Exiting a table upward (\*):** If in the top row of a table, exits the table to the line above.

</details>

<details>
<summary>Cursor DOWN</summary>

- **Within text:** Moves down one visual line, equivalent to physical cursor keys.
- **From above a callout, image, embed, or thematic break (Live Preview) (\*):** Enters the block and expands the markdown source, consistent with physical cursor key behavior. For callouts, the next line must be a callout header (`> [!type]...`). For images and embeds (`![[...]]`, `![...](...)`), applies when the syntax starts at the beginning of the line. For thematic breaks (`---`, `***`, `___`), the cursor lands at the beginning of the break line.
- **From above a table (\*):** If the cursor is on the line immediately above a table, it enters the table and moves to the beginning of the top-left cell.
- **Within a table cell (\*):**
  - **On other visual lines:** Moves to the visual line below within the same cell, equivalent to physical cursor keys.
  - **Last visual line:** Jumps to the beginning of the cell in the row below (same column).
- **Exiting a table downward (\*):** From the last visual line of any cell in the last row, moves the cursor out of the table to the beginning of the line below.

</details>

<details>
<summary>Cursor LEFT</summary>

- **Within text:** Moves left by one character, equivalent to physical cursor keys.
- **From below a table, at the line start (\*):** Enters the table and moves to the end of the content in the bottom-right cell (bottom visual line).
- **Within a table cell (\*):** Moves left one character within the cell content.
- **At the beginning of cell content (\*):** Jumps to the end of the text in the cell on the left (same row).
- **In the leftmost cell, at the cell start (data row) (\*):** Jumps to the end of the rightmost cell in the row above. (→ **Cross-Row Navigation** setting)
- **In the leftmost cell, at the cell start (header row) (\*):** Exits the table to the line above. (→ **Cross-Row Navigation** setting)

</details>

<details>
<summary>Cursor RIGHT</summary>

- **Within text:** Moves right by one character, equivalent to physical cursor keys.
- **From above a table, at the line end (\*):** Enters the table and moves to the beginning of the top-left cell.
- **Within a table cell (\*):** Moves right one character within the cell content.
- **At the end of cell content (\*):** Jumps to the beginning of the text in the cell to the right (same row).
- **In the rightmost cell, at the cell end (non-last row) (\*):** Jumps to the beginning of the leftmost cell in the row below. (→ **Cross-Row Navigation** setting)
- **In the rightmost cell, at the cell end (last row) (\*):** Exits the table to the line below. (→ **Cross-Row Navigation** setting)

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
- **Table-aware (\*):** If the target line is itself a table row, lands inside a cell's content rather than on the raw Markdown text — TOP in the **leftmost** cell (there's no position "before" that inside a rendered cell), BOTTOM in the **rightmost** cell's own end (the actual end of that row). Without this, a note starting with a table can land at the table's *last* row instead of its first when jumping to TOP; a note ending with a table can land at the *header* row instead of its last when jumping to BOTTOM.

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
- **Within a table cell (\*):** Searches the current cell first, including across `<br>`-separated in-cell lines, before crossing out of the cell.
- **At the edge of a cell's own content (\*):** Jumps to the nearest word in the adjacent cell (same row), or, from a row's own edge cell, the adjacent row's opposite edge cell. Single cell/row crossing only.
- **Enters a table reached from plain text (\*):** Word right landing on an adjacent table row enters its leftmost cell, at the first word's own end; Word left enters the rightmost cell, at the last word's own start — the same landing a cell-to-cell/row-to-row crossing already uses.

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
- **Why this command exists:** On Windows, Hotkey settings' recommended Ctrl+A → HOME assignment overrides the OS-level Select all shortcut with no built-in fallback (see [Limitations → Shortcut Conflicts](/macos-emacs-style/limitations)). This command restores one — run it from the Command Palette or assign it a custom hotkey.

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
