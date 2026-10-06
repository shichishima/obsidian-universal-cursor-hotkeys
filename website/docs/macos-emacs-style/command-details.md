---
sidebar_position: 2
title: macOS (Emacs) style — Command Details
sidebar_label: Command Details
description: Detailed behavior of every command this plugin provides (differences from standard behavior)
mode: macos-emacs-style
---
# macOS (Emacs) style — Command Details

Unless noted otherwise, descriptions of tables, callouts, images, embeds, and thematic breaks describe Live Preview behavior. Where a behavior is specific to Source Mode, it's called out within that command's own entry.

## Cursor movement \{#cursor-movement}

<Anchor id="cursor-up" />
<details>
<summary>UP</summary>

This command is designed to behave the same as the physical ↑ cursor key. In some situations it goes further than the physical ↑ key, with additional table and Markdown awareness.

This UP command can be assigned to the physical ↑ key itself from the "For everyone" screen, but "the physical ↑ key" below always means the ↑ key in its own unmodified state — i.e., without this command assigned to it.

**Behavior matching the physical ↑ key**

Moving from the following locations behaves the same as the physical ↑ key.

- **Within text:** Moves up to the previous visual line.
- **Below a blockquote, callout, image, embed, or thematic break:** Enters the block from below and expands its Markdown source.
  - For blockquotes and callouts, the block must end with a blank (or whitespace-only) line immediately below it. If a list line or similar follows directly, UP cannot enter the block.
  - For images and embeds (`![[...]]`, `![...](...)`), this applies only when the syntax starts at the beginning of the line.
  - For thematic breaks (`---`, `***`, `___`), the cursor lands at the start of that line.
  - Obsidian's macOS shortcut `Ctrl` + `P` behaves differently from the physical ↑ key here — it passed straight through this block and moved above it instead.
- **The first line of a table's header row:** Exits the table and moves to the line above.
  - Preserves the cursor's horizontal position as closely as possible.
  - Obsidian's macOS shortcut `Ctrl` + `P` behaves differently from the physical ↑ key here — from the second character or later within a cell, it moved to the start of the cell instead of exiting the table. From the start of the cell, it exits the table the same as the physical ↑ key.
  - If the table sits at the very start of the note, the physical ↑ key adds a blank line above the note and lands there, but this plugin's UP does not add a blank line — it moves to the start of the cell instead.
- **The second or later in-cell line of table cell text:** Moves up one line within the same cell.
  - Preserves the cursor's horizontal position as closely as possible.

**Behavior differing from the physical ↑ key**

UP differs from the physical ↑ key in the following ways — these are the points with extra table and Markdown awareness.
- **The first in-cell line of table cell text:** Moves to the last line of the cell directly above.
  - Preserves the cursor's original horizontal position as closely as possible.
  - The physical ↑ key also moves to the last line of the cell directly above, but it always lands at the left edge regardless of horizontal position.
  - Obsidian's macOS shortcut `Ctrl` + `P` doesn't move to the cell above at all — it moves to the start of the same cell instead. What happens after that is unstable: it may stay there, or it may exit the table.
- **Below a table:** Enters the table from below and moves to the bottom visual line of the bottom-left cell.
  - Preserves the cursor's original horizontal position as closely as possible.
  - If the horizontal position is further right than the width of the bottom-left cell, it lands at the end of that cell's last line instead.
  - The physical ↑ key also enters the bottom-left cell, but which line it lands on is unstable — it can be the last line or the first line, depending on the cursor's previous position.

</details>

<Anchor id="cursor-down" />
<details>
<summary>DOWN</summary>

This command is designed to behave the same as the physical ↓ cursor key. In some situations it goes further than the physical ↓ key, with additional table and Markdown awareness.

This DOWN command can be assigned to the physical ↓ key itself from the "For everyone" screen, but "the physical ↓ key" below always means the ↓ key in its own unmodified state — i.e., without this command assigned to it.

**Behavior matching the physical ↓ key**

Moving from the following locations behaves the same as the physical ↓ key.

- **Within text:** Moves down to the next visual line.
- **Above a callout:** Enters the block from above and expands its Markdown source.
  - Applies when the next line is a callout header line (`> [!type]...`).
- **Above an image, embed, or thematic break:** Enters the block from above and expands its Markdown source.
  - For images and embeds (`![[...]]`, `![...](...)`), this applies only when the syntax starts at the beginning of the line.
  - For thematic breaks (`---`, `***`, `___`), the cursor lands at the start of that line.
- **The second-to-last or earlier in-cell line of table cell text:** Moves down one line within the same cell.
  - Preserves the cursor's horizontal position as closely as possible.
- **A table's last row:** Exits the table and moves to the line below.
  - Preserves the cursor's horizontal position as closely as possible.
  - If the table sits at the very end of the note, a line is added below and the cursor lands there. (Same behavior as the physical ↓ key.)

**Behavior differing from the physical ↓ key**

DOWN differs from the physical ↓ key in the following ways — these are the points with extra table and Markdown awareness.
- **Above a table:** Enters the table from above and moves to the first visual line of the top-left cell.
  - Preserves the cursor's original horizontal position as closely as possible.
  - If the horizontal position is further right than the width of the top-left cell, it lands at the end of that cell's first line instead.
  - The physical ↓ key also enters the top-left cell, but it always lands at the left edge regardless of horizontal position.
- **The last in-cell line of table cell text:** Moves to the first visual line of the cell directly below.
  - Preserves the cursor's original horizontal position as closely as possible.
  - The physical ↓ key also moves to the cell below, but it always lands at the start of the cell.
  - Obsidian's macOS shortcut `Ctrl` + `N` doesn't move to the cell below at all — it moves to the end of the same cell instead. What happens after that is unstable: it may stay there, or it may exit the table.

</details>

<Anchor id="cursor-left" />
<details>
<summary>LEFT</summary>

This command is designed to behave the same as the physical ← cursor key. In some situations it goes further than the physical ← key, with additional table awareness.

**Behavior matching the physical ← key**

Moving from the following locations behaves the same as the physical ← key.
- **Within text, or partway through a cell's content:** Moves left by one character.
- **At the start of a table cell:**
  - **The leftmost cell of the header row:** Exits above the table.
    - If the Cross-row navigation setting is OFF, stays at the start of the cell instead.
    - If the table sits at the very start of the note, the physical ← key adds a blank line above the note and lands there, but this LEFT command does not add a blank line — nothing happens. (The same constraint as the UP command.)
  - **The leftmost cell of any other row:** Moves to the end of the rightmost cell in the row above.
    - If the Cross-row navigation setting is OFF, stays at the start of the cell instead.
  - **The start of the second or later cell:** Moves to the end of the cell to the left.

**Behavior differing from the physical ← key**

LEFT differs from the physical ← key under the following conditions / in the following places.
- **At the start of the line directly below a table:** Enters the table and moves to the end of the bottom-right cell.
  - The physical ← key landed at the left edge of the bottom-left cell's last visual line instead.
- **At the start of the leftmost cell, when the Cross-row navigation setting is OFF:**
  - Neither of the two leftmost-cell-start cases above (header row, other rows) crosses a row boundary. (The physical ← key always crosses row boundaries.)

</details>

<Anchor id="cursor-right" />
<details>
<summary>RIGHT</summary>

This command is designed to behave the same as the physical → cursor key. In some situations it goes further than the physical → key, with additional table awareness.

**Behavior matching the physical → key**

Moving from the following locations behaves the same as the physical → key.
- **Within text, or partway through a cell's content:** Moves right by one character.
- **At the end of a table cell:**
  - **The end of any non-rightmost cell:** Moves to the start of the cell to the right.
  - **The end of the rightmost cell, on any non-last row:** Moves to the start of the leftmost cell in the row below.
    - If the Cross-row navigation setting is OFF, stays at the end of the cell instead.
  - **The end of the rightmost cell, on the last row:** Exits below the table.
    - If the Cross-row navigation setting is OFF, stays at the end of the cell instead.
    - If the table sits at the very end of the note, a line is added below and the cursor lands there. This is the same behavior as the DOWN command, unlike LEFT's constraint at the start of the note.
- **At the end of the line directly above a table:** Enters the table and moves to the start of the leftmost cell in the header row.

**Behavior differing from the physical → key**

RIGHT differs from the physical → key under the following conditions.
- **At the end of the rightmost cell, when the Cross-row navigation setting is OFF:**
  - Neither of the two rightmost-cell-end cases above (last row, other rows) crosses a row boundary. (The physical → key always crosses row boundaries.)

</details>

<Anchor id="cursor-home" />
<details>
<summary>HOME</summary>

This command is designed to behave the same as the physical `Home` key (`fn` + ← on macOS). In some situations it goes further than the physical `Home` key, with additional table and Markdown awareness.

This HOME command can be assigned to the physical `Home` key itself from the "For everyone" screen, but "the physical `Home` key" below always means the `Home` key in its own unmodified state — i.e., without this command assigned to it.

**Behavior matching the physical `Home` key**

Within a plain-text line or a table cell's line, moves toward the start of the line in up to 3 steps.
- **Step 1:** Moves to the left edge of the current visual line. (When long text wraps across visual lines and the cursor isn't on the first visual line.)
- **Step 2:** Moves to the content start — the position between the line's leading Markdown markers and the body text.
  - Indentation, list markers (`- `, `+ `, `* `), checkboxes (`- [ ] `), ordered-list markers (`1. `, `1) `), and blockquote markers (`> `) are all skipped, stopping immediately before the body text — including nested blockquotes and indented variants.
  - When a blockquote is followed by a list, ordered-list, or checkbox marker (e.g. `> - `), Live Preview doesn't render the list marker or checkbox, but Smart home's own detection still treats it as leading Markdown together with the blockquote marker, and moves to the position between that marker and the body text. (Same behavior as the physical `Home` key.)
- **Step 3:** Moves to the start of the line (the logical line's start).

Running HOME again at a plain-text logical line's start doesn't move the cursor any further.

**Behavior differing from the physical `Home` key**

Regarding the 3-step behavior in plain text and table cells, HOME differs from the physical `Home` key as follows. The default behavior matches the physical `Home` key, but the finer details are adjustable via settings. (→ [Smart home / Visual line movement settings](/macos-emacs-style/settings#behavior-options))
- **Step 1 difference:** With Visual line movement OFF, the move to the first visual line's left edge is skipped.
- **Step 2 difference:** With Smart home (standard) OFF, the leading-Markdown consideration in Step 2 is skipped entirely.
- **Step 2 difference:** With Smart home (standard) ON and Smart home (advanced) also ON (the default), more kinds of leading Markdown are considered. In addition to the markers above, headings (`# `), footnotes (`[^1]: `), and callout type markers (`[!type] `) are also considered.
  - A list combined with a heading (`- # `) or a blockquote combined with a heading (`> # `, which isn't rendered as a heading) also stops between the heading marker and the body text.

At the start of a table cell (the first in-cell line, when the cell has multiple lines), HOME behaves differently from the physical `Home` key.
- **The leftmost cell of the header row, at its start:** Exits the table and moves to the line above.
  - This is the behavior when Cross-row navigation (ON by default) is enabled.
  - With Cross-row navigation OFF, stays at the start of the leftmost cell without exiting the table, same as the physical `Home` key.
  - If the table sits at the very start of the note, it stays at the start of the leftmost cell without exiting the table regardless of the Cross-row navigation setting.
- **The start of the second or later cell:** Moves to the end of the cell to the left in the same row.
- **The leftmost cell of the second or later row, at its start:** Moves to the end of the rightmost cell in the row above.
  - This is the behavior when Cross-row navigation (ON by default) is enabled.
  - With Cross-row navigation OFF, stays at the start of the leftmost cell without moving to the row above, same as the physical `Home` key.
- For reference, **the start of a non-first in-cell line:** Doesn't move any further. Same as the physical `Home` key.

**Behavior in Source Mode**

In Source Mode, HOME behaves as follows within a table. Everything from the second point onward matches Live Preview.
- **Before the first `|`:** HOME doesn't execute — nothing happens.
- **The start of a non-first in-cell line (immediately after `<br>`):** Doesn't move any further. (Same as Live Preview.)
- **The start of the first in-cell line:** Same as Live Preview — moves to the end of the cell to the left, or (in the leftmost cell) to the end of the rightmost cell in the row above / exits the table. (The Cross-row navigation setting and the start-of-note constraint also apply the same way.)
- **Otherwise:** Moves to immediately before the cell's raw Markdown markers (the body text's start), or to the start of the in-cell line.

</details>

<Anchor id="cursor-end" />
<details>
<summary>END</summary>

This command is designed to behave the same as the physical `End` key (`fn` + → on macOS). In some situations it goes further than the physical `End` key, with additional table awareness.

This END command can be assigned to the physical `End` key itself from the "For everyone" screen, but "the physical `End` key" below always means the `End` key in its own unmodified state — i.e., without this command assigned to it.

**Behavior matching the physical `End` key**

Within a plain-text line or a table cell's line, moves toward the end of the line in up to 2 steps.
- **Step 1:** Moves to the right edge of the current visual line. (When long text wraps across visual lines and the cursor isn't on the last visual line.)
- **Step 2:** Moves to the end of the line (the logical line's end).

Running END again at a plain-text logical line's end doesn't move the cursor any further.

**Behavior differing from the physical `End` key**

Regarding the 2-step behavior in plain text and table cells, END differs from the physical `End` key as follows. The default behavior matches the physical `End` key, but the finer details are adjustable via settings. (→ [Visual line movement setting](/macos-emacs-style/settings#behavior-options))
- **Step 1 difference:** With Visual line movement OFF, the move to the first visual line's right edge is skipped.

At the end of a table cell (the last in-cell line, when the cell has multiple lines), END behaves differently from the physical `End` key. The physical `End` key stays at the end of the cell and never moves to an adjacent cell or row.
- **The end of any non-rightmost cell:** Moves to the start of the cell to the right in the same row.
- **The end of the rightmost cell, on any non-last row:** Moves to the start of the leftmost cell in the row below.
  - This is the behavior when Cross-row navigation (ON by default) is enabled.
  - With Cross-row navigation OFF, stays at the end of the rightmost cell without moving to the row below, same as the physical `End` key.
- **The end of the rightmost cell, on the last row:** Exits the table and moves to the line below.
  - This is the behavior when Cross-row navigation (ON by default) is enabled.
  - With Cross-row navigation OFF, stays at the end of the rightmost cell without exiting the table, same as the physical `End` key.
  - If the table sits at the very end of the note, a line is added below and the cursor lands there. (Same behavior as the DOWN command.)
- For reference, **the end of a non-last in-cell line:** Doesn't move any further. Same as the physical `End` key.

**Behavior in Source Mode**

In Source Mode, END behaves as follows within a table.
- **Before the first `|`:** Moves to the start of the first cell's body text. (Unlike HOME, this case is not a no-op.)
- **Partway through a `<br>` tag:** Moves past the `<br>` tag to the right edge of the next in-cell line.

</details>

<Anchor id="cursor-top-bottom" />
<details>
<summary>TOP / BOTTOM</summary>

This command is designed to behave the same as `Ctrl` + `Home`/`End` on Windows, or `command` + ↑/↓ on macOS. In some situations it goes further than these physical keys, with additional table awareness.

The TOP / BOTTOM commands can be assigned to these same keys from the "For everyone" screen, but "the physical keys" below always means these keys in their own unmodified state — i.e., without these commands assigned to them.

**Behavior matching the physical keys**

Outside a table, moves to the start of the note (TOP) or the end of the note (BOTTOM). Smart home is not applied for the TOP command.

**Behavior differing from the physical keys**

If a table sits at the start or end of the note, this differs from the physical keys by moving to a more natural "start"/"end".
- **TOP:** Moves to the start of the leftmost cell in the header row.
  - The physical keys (`Ctrl` + `Home` / `command` + ↑) moved to the table's last row instead, when the note started with a table.
- **BOTTOM:** Moves to the end of the rightmost cell in the table's bottom row.
  - The physical keys (`Ctrl` + `End` / `command` + ↓) moved to the start of the header row instead, when the note ended with a table.

</details>

<Anchor id="page-up-down" />
<details>
<summary>Page down / Page up</summary>

This command is designed to behave the same as the physical `Page Down`/`Page Up` keys (`fn` + ↓/↑ on macOS). In some situations it goes further than these physical keys, with additional table awareness.

These Page down / Page up commands can be assigned to these same keys from the "For everyone" screen, but "the physical keys" below always means these keys in their own unmodified state — i.e., without these commands assigned to them.

**Behavior matching the physical keys**

If the scrolled range contains only plain text (no tables, callouts, or embeds), scrolls the view down (Page down) or up (Page up) by one screen. The cursor stays at the same position on screen after scrolling.

**Behavior differing from the physical keys**

If the scrolled range includes a table, callout, or embed (`![[...]]`), the cursor moves correctly even when the one-screen destination falls inside that table, callout, or similar block.

This is achieved by repeating the UP / DOWN command enough times to cover one screen.

The physical keys (`Page Down`/`Page Up`, `fn` + ↓/↑) always moved the cursor all the way outside the table, even in cases where it should properly land inside it.

</details>

<Anchor id="word-left-right" />
<details>
<summary>Word left / Word right</summary>

This command is designed to behave the same as `Ctrl` + ←/→ on Windows, or `option` + ←/→ on macOS. In some situations it goes further than these physical keys, with additional table and CJK (Chinese/Japanese) awareness.

This command can be assigned to these same keys from the "For everyone" screen, but "the physical keys" below always means these keys in their own unmodified state — i.e., without this command assigned to them.

**Behavior matching the physical keys**
- **Within plain text and in-cell text:** Word left moves to the start of the (previous) word; Word right moves to the end of the (next) word.
  - Crosses a line boundary once no word remains on the current line.
  - Skips blank lines while crossing line boundaries.
  - Within a table, moves from the start/end of the in-cell text to the end/start of the adjacent cell, and — when the Cross-row navigation setting is ON — from the left/right edge of a row to the opposite edge of the adjacent row.
- **Entering a table:** When moving from plain text into a table, Word left enters the bottom-right cell; Word right enters the header row's leftmost cell.
- **Exiting a table:** When Word left, in the header row's leftmost cell, tries to look for a further previous word — or Word right, in the bottom row's rightmost cell, tries to look for a further next word — it exits the table and moves to the line above/below.
  - With the Cross-row navigation setting OFF, it stays at the start/end of the cell instead of exiting the table.
  - If the table sits at the very start of the note (Word left), it doesn't exit — nothing happens. (Same as UP / LEFT / HOME.)
  - If the table sits at the very end of the note (Word right), a blank line is added below the table and the cursor moves there.

**Behavior differing from the physical keys**
- **Landing position when entering a table:** Word left lands at the start of the last word in the bottom-right cell; Word right lands at the end of the first word in the header row's leftmost cell.
  - This follows the same convention as crossing a line boundary in plain text. The physical keys land at the start/end of a word in plain text, but when entering a table they simply stopped at the start/end of the cell instead.
- **The start/end of a cell:** Moves to the word at the end/start of the cell to the left/right.
  - The physical keys never cross cell boundaries.
- **CJK (Chinese/Japanese) word segmentation:** Moves by word using dictionary-based segmentation, so CJK (Chinese/Japanese) text is also split into real words.
  - The physical keys only split on whitespace and punctuation, so a run of CJK (Chinese/Japanese) text was recognized as a single long word.

</details>

## Editing \{#editing}

<Anchor id="kill-line" />
<details>
<summary>Kill line</summary>

This command is designed to reproduce the behavior of Emacs's kill-line. Unlike the macOS version of Obsidian's own `control` + `K`, consecutive kills accumulate their content so it can be pasted back with `Ctrl` + `Y`. On the other hand, unlike real Emacs's kill-line, it doesn't maintain a kill ring (a history-aware buffer) — instead it goes through the OS clipboard, so you can copy & paste with other apps too.

**Kill line's specific behavior**

- **Outside a table, and within a Live Preview cell:**
  - Here, "end of line" within a Live Preview cell refers to a position created by a `Shift` + `Enter` line break.
  - The killed text is saved to the OS clipboard.
  - **When the cursor isn't at the end of the line:** Kills from the cursor position to the end of the line or the end of the cell.
  - **When the cursor is at the end of the line:** Kills the line break, joining with the next line.
  - **At the end of the file, or the end of the cell:** Does nothing.
- **Within a table cell in Source Mode:**
  - In Source Mode, "end of line" refers to the position immediately before a `<br>` tag. (A `Shift` + `Enter` break in Live Preview is displayed as `<br>` in Source Mode.)
  - The killed text is saved to the OS clipboard, but `<br>` is converted to a line break and `\|` to `|` before saving.
  - **When the cursor isn't at the end of the line:** Kills from the cursor position to the end of the line or the end of the cell.
  - **At the end of an in-cell line (immediately before `<br>`):** Kills the `<br>` tag, joining with the next in-cell line. (Visually, the "`<br>`" disappears and the text closes up.)
  - **At the end of the cell (the cell boundary):** Does nothing.
- **Consecutive kills:** Running Kill line repeatedly in a row appends each kill's content onto the OS clipboard.
  - Any editing operation other than a consecutive kill stops the accumulation. (Cursor movement, typing, mouse clicks.)
  - If the OS has a clipboard history feature, each consecutive kill is recorded there in sequence.
- **Interaction with the OS's copy/cut:** Pressing `Ctrl` + `C`/`X` on Windows or `command` + `C`/`X` on macOS stops the consecutive-kill behavior.

**Smart join**

A setting lets you make line joining Markdown-aware.
- **Smart join:** When Smart join is ON in the settings screen, joining a line first removes any leading Markdown from the start of the next line.
  - What gets removed matches the Markdown syntax that Smart home skips over.
  - With Smart home (standard) ON, list markers, ordered-list markers, checkboxes, indentation, and blockquote markers are removed.
  - With Smart home (advanced) also ON, headings, footnotes, and callout markers are removed as well.

For example, with "`|`" as the cursor position,

```
- List item text|   (running Kill line here)
    - Second list item
```
this becomes:

```
- List item textSecond list item
```
Similarly, for a blockquote:

```
> Quoted text|   (running Kill line here)
> Second line of the quote
```
this becomes:

```
> Quoted textSecond line of the quote
```

</details>

<Anchor id="kill-region" />
<details>
<summary>Kill region</summary>

Kills (cuts) the selected text and saves it to the OS clipboard. This command corresponds to Emacs's kill-region (`C-w`).

**Kill region's specific behavior**

- **When the selection is empty:** Does nothing.
- **Outside a table, and within a Live Preview cell:** Kills the selected text.
  - The selection can span multiple lines.
  - Within a Live Preview cell, the selection must stay inside the same cell. If the selection crosses a cell boundary, or crosses a table row boundary, nothing happens. Within the same cell, the selection may cross a `Shift` + `Enter` line break.
- **Within a table cell in Source Mode:** Kills the selected text.
  - The selection must stay inside the same cell. If the selection crosses the `|` cell boundary, nothing happens.
  - Within the same cell, the selection may cross a `<br>`. In this case `<br>` is converted to a line break and `\|` to `|` before saving to the clipboard.
- **Stopping consecutive kills:** Kill region always resets the consecutive-kill accumulation. The killed text replaces the clipboard's previous contents instead of being appended to it.

**Difference from the OS's standard cut**

- **A selection spanning multiple cells:** The OS's standard cut (`Ctrl` + `X`/`command` + `X`) treats this as a structural, cell-based operation, but Kill region doesn't support a selection spanning multiple cells. (It does nothing.)
- **Within a table cell in Source Mode, the clipboard's contents:** The OS's standard cut copies `<br>` and `\|` to the clipboard as-is. Kill region recognizes that the kill is happening inside a table even in Source Mode, and converts these to a line break and `|` before saving.

</details>

<Anchor id="copy-region" />
<details>
<summary>Copy region</summary>

Copies the selected text to the OS clipboard. Unlike Kill region, the text isn't deleted.

**Copy region's specific behavior**

- **When the selection is empty:** Does nothing.
- **Outside a table, and within a Live Preview cell:** Copies the selected text.
  - The selection can span multiple lines.
  - Within a Live Preview cell, the selection must stay inside the same cell. If the selection crosses a cell boundary, or crosses a table row boundary, nothing happens. Within the same cell, the selection may cross a `Shift` + `Enter` line break.
- **Within a table cell in Source Mode:** Copies the selected text.
  - The selection must stay inside the same cell. If the selection crosses the `|` cell boundary, nothing happens.
  - Within the same cell, the selection may cross a `<br>`. In this case `<br>` is converted to a line break and `\|` to `|` before saving to the clipboard.
- **Stopping consecutive kills:** Like Kill region, this always resets the consecutive-kill accumulation. What's saved also replaces the clipboard's existing contents instead of being appended to it.

**Difference from the OS's standard copy**

- **A selection spanning multiple cells:** The OS's standard copy (`Ctrl` + `C`/`command` + `C`) treats this as a structural, cell-based operation, but Copy region doesn't support a selection spanning multiple cells. (It does nothing.)
- **Within a table cell in Source Mode, the clipboard's contents:** The OS's standard copy copies `<br>` and `\|` to the clipboard as-is. Copy region recognizes that the copy is happening inside a table even in Source Mode, and converts these to a line break and `|` before saving.

</details>

<Anchor id="yank" />
<details>
<summary>Yank</summary>

Pastes the OS clipboard's contents at the cursor position. This command corresponds to Emacs's yank (`C-y`).

**Yank's specific behavior**

- **When the clipboard is empty:** Does nothing. If reading the clipboard fails, it uses the content of the most recent Kill/Copy instead.
- **Outside a table, and within a Live Preview cell:** Pastes the clipboard's contents as-is. Within a Live Preview cell, any line breaks (`\n`) it contains become in-cell line breaks (the same kind `Shift` + `Enter` creates).
- **Within a table cell in Source Mode:** To avoid breaking the table structure, line breaks are escaped to `<br>` and pipe characters (`|`) to `\|` before pasting.
- **Stopping consecutive kills:** Yank also always resets the consecutive-kill accumulation.

**Difference from the OS's standard paste**

- **Outside a table, and within a Live Preview cell:** When pasting text, there's no difference between the OS's standard paste and Yank. Multi-line text and text containing pipe characters (`|`) are both inserted correctly.
- **When multiple cells are stored on the clipboard:** When you cut/copy multiple cells, the OS clipboard stores them as table structure. The OS's standard paste can paste this back as a table, but Yank just pastes the table's Markdown source code. (Pasting it into plain text displays it as a table, but pasting it into a cell inserts the table's raw Markdown source.)
- **When an image is stored on the clipboard:** If the OS clipboard contains an image, the OS's standard paste saves the image file into the vault and inserts an embed link (`![[filename saved in the vault]]`), but Yank just pastes the filename as plain text.
- **Within a table cell in Source Mode:** The OS's standard paste inserts line breaks and pipe characters as-is without converting them, so pasting multi-line text or text containing pipe characters breaks the table structure. Yank converts line breaks to `<br>` and pipe characters to `\|` before inserting, so the table structure is preserved.

</details>

<Anchor id="delete-char" />
<details>
<summary>Delete char</summary>

This command is designed to behave the same as the physical `Delete` key (⌦, or `fn` + ⌫, on macOS).

**Behavior matching the physical `Delete` key**

Moving from the following locations behaves the same as the physical `Delete` key.

- **Within text, and within a Live Preview cell:**
  - Deletes the character at the cursor position. (Forward deletion.)
  - At the end of a line, deletes the line break, joining with the next line.
  - Within a Live Preview cell, a `Shift` + `Enter` break counts as the end of a line, but at the end of the cell, does nothing (it never continues into the next cell).

**Behavior differing from the physical `Delete` key**

Delete char differs from the physical `Delete` key in the following way.

- **Within a table cell in Source Mode:** The physical `Delete` key doesn't take the cell boundary (`|`) into account, so it deletes the `|` and surrounding spaces one character at a time. This command, by contrast, recognizes that it's inside a table and doesn't delete the boundary characters.

</details>

<Anchor id="undo-redo" />
<details>
<summary>Undo / Redo</summary>

These two commands are simply Obsidian's own "Undo" and "Redo." They just step the entire note's edit history backward/forward, with no special table-aware or CJK-aware handling targeting specific cells or words.

**Why these are provided as commands**

Undo is `Ctrl` + `Z` on Windows and `command` + `Z` on macOS; Redo is `Ctrl` + `Shift` + `Z` or `Ctrl` + `Y` on Windows and `command` + `Shift` + `Z` on macOS — but none of these appear in Obsidian's standard Hotkeys panel or command palette. As a result, they can't be reassigned to another key (an Emacs-equivalent key, for example).

This plugin provides them as commands so they can be assigned to any key you like, the same as every other command.

</details>

<Anchor id="kill-word-left-right" />
<details>
<summary>Kill word left / Kill word right</summary>

These two commands kill text word by word. CJK (Chinese/Japanese) text is also handled correctly via dictionary-based word segmentation.

These commands can be assigned to the physical keys (`Ctrl` + `Backspace`/`Delete` on Windows, `option` + ⌫/⌦ on macOS) from the "For everyone" screen, but what follows compares against those same keys in their own unmodified state — i.e., without this command assigned to them.

**Behavior matching the physical keys**

- **Within text, and within a Live Preview cell:**
  - Kill word left kills from the start of the word on the left to the cursor; Kill word right kills from the cursor to the end of the word on the right.
  - From the start/end of a line, continues on into the next line.
  - Within a Live Preview cell, a `Shift` + `Enter` break counts as the start/end of a line, but it never continues past the start/end of the cell into the previous/next cell.

**Behavior differing from the physical keys**

- **Clipboard integration and consecutive kills:** The deleted text is saved to the clipboard.
  - As with Kill line, consecutive kills accumulate the deleted content in the clipboard. Kill word and Kill line can be mixed together.
  - Kill word left adds the deleted word to the front of the clipboard content, and Kill word right adds it to the end. The accumulated text keeps its original word order within the clipboard.
  - Deleting a word with the physical key doesn't integrate with the clipboard, so it can't be pasted back later.
- **CJK (Chinese/Japanese) handling:** Recognizes CJK words using dictionary-based segmentation.
  - Because this command uses dictionary-based word segmentation, it deletes CJK text word by word too.
  - The physical key only recognizes whitespace and punctuation as boundaries, so a run of CJK (Chinese/Japanese) text is treated as a single long word and deleted all at once.
- **Doesn't enter a table:** This command stops just before a table and never enters it.
  - With the physical key, deleting a word — especially from below a table — can delete the entire table.
- **Within a table cell in Source Mode:** Recognizes that it's inside a table and stops before the `|` cell boundary.
  - It treats `<br>` breaks within a cell as line breaks and `|` as the cell boundary. Just as it stops without crossing a cell boundary in Live Preview, in Source Mode it never deletes or crosses a `|` either.
  - With the physical key, a table in Source Mode is just plain text, so it keeps deleting through the `|` characters too, breaking the table.

</details>

<Anchor id="word-case" />
<details>
<summary>Uppercase word / Lowercase word / Capitalize word</summary>

Converts the text at the cursor position, or in the selection, to uppercase, lowercase, or capitalized form. These commands use DWIM (do-what-i-mean) behavior based on modern Emacs's own `upcase-dwim`/`downcase-dwim`/`capitalize-dwim` (`M-u`/`M-l`/`M-c`).

- **When there's a selection:** Converts the selected text.
  - Uppercase/Lowercase ignore word boundaries and uniformly uppercase/lowercase every character in the selection.
  - Capitalize uppercases only the first character of each word and lowercases the rest. (Whitespace and punctuation between words are left as-is.)
  - After converting, the cursor moves to the end of the selection.
- **When there's no selection:** Converts the word at the cursor position, or the one to its right.
  - After converting, the cursor moves to the end of the word.
  - This differs from both the classic and DWIM versions of Emacs's own behavior. Emacs only converts from the cursor position to the end of the word, but this command converts the entire word even when the cursor is partway through it.
- **Table-aware:** Like Word right, it enters a table, crosses cell boundaries, and exits a table while searching for a word to convert.
  - With the Cross-row navigation setting OFF, it stops without crossing a row boundary, and never exits the table either.
  - These commands do nothing when multiple cells are selected.
- **Full-width character support:** Full-width alphabetic characters are converted the same way as half-width ones. Full-width and half-width characters may be mixed.

</details>

<Anchor id="transpose-chars" />
<details>
<summary>Transpose chars</summary>

Swaps the two characters immediately before and after the cursor. This command reproduces Emacs's `transpose-chars` (`C-t`).

- **Partway through a line:** Swaps the two characters on either side of the cursor, and the cursor moves to just after the swapped pair.
  - Pressing it repeatedly drags one character to the right, one step at a time.
- **At the end of a line:** There's no character after the cursor, so it instead swaps the two characters immediately before the end of the line.
  - If the line has fewer than 2 characters, nothing can be swapped, so nothing happens.
  - With 2 or more characters, it swaps them and the cursor stays at the end of the line, so repeating it keeps swapping the same two characters back and forth.
- **At the start of a line:** Swaps the line break to the cursor's left (belonging to the previous line) with the character to the cursor's right at the start of the line.
  - As a result, the first character of the line appears to get pulled up into the previous line.
  - After the swap, the cursor sits right after the line break — which, in effect, means it stays at the start of the line without moving.
  - Repeating this pulls characters up to the line above one at a time; once the line becomes empty, it becomes the end of a 0-character line, and nothing further happens after that.
- **At the very start or end of the note:** There's no character on one side to swap with, so nothing happens.
- **Table-aware in Source Mode:** Within a table, the `|` to the left of a cell is treated as the start of the note, and `<br>` and the `|` to the right of a cell are treated as the end of a line. These characters never move, so the table is never broken.
- **Unicode-safe:** Characters that internally span multiple character units — such as emoji — are treated and swapped as a single character. (Surrogate pairs like "🟩"/"𠮷", and emoji with variation selectors like "☺️".)

</details>

<Anchor id="select-all" />
<details>
<summary>Select all</summary>

This command corresponds to Obsidian's own "Select all."

**Behavior matching "Select all"**
- **Outside a table:** Selects the entire note.
- **Within a table cell (Live Preview):** Selects the entire content of the current cell instead of the entire note.

**Behavior differing from "Select all"**
- **Within a table cell (Source Mode):** Even in Source Mode, this recognizes that it's inside a table and selects the entire content of the current cell instead of the entire note.
  - The whitespace at the start and end of the cell is excluded from the selection.
  - The standard "Select all" doesn't recognize tables and selects the entire note instead.

**Why this is provided as a command**

Obsidian's standard "Select all" shortcut is `Ctrl` + `A` on Windows, but that's the Recommended Hotkey for the HOME command. Applying the Recommended Hotkey overwrites that shortcut — yet "Select all" itself isn't a command you can assign a hotkey to, so a new command had to be provided to let you run it on a different key.

(The same reason as Undo/Redo.)

</details>

## Other hotkeys \{#other-hotkeys}

<Anchor id="recenter-top-bottom" />
<details>
<summary>Recenter-top-bottom</summary>

Scrolls so the cursor's line is centered on screen. Pressing it again cycles through top, bottom, and center again. This corresponds to modern Emacs's own `recenter-top-bottom` (`C-l`).

- **Cyclic behavior:** Each press cycles the scroll position in the order center → top (with a 2-line margin) → bottom (with a 2-line margin), then back to center and repeats.
  - The cursor's position itself doesn't change. Only the scroll position moves.
  - This works the same way whether the cursor is in plain text or inside a table.
- **Cycle reset:** Any editing operation — a keystroke, cursor movement, a mouse click, and so on — resets the cycle, so the next press starts again from center.
  - Running Kill line or Kill word left/right does not reset the cycle.
  - Kill region, Copy region, and Yank do reset the cycle.

</details>

<Anchor id="recenter" />
<details>
<summary>Recenter</summary>

Scrolls so the cursor's line is centered on screen. This corresponds to classic Emacs's own `recenter` (`C-l`).

- **Specific behavior:** Scrolls so the cursor's line sits at the vertical center of the screen.
  - The cursor's position itself doesn't change. Only the scroll position moves.
  - This works the same way whether the cursor is in plain text or inside a table.

No Recommended Hotkey is set for this command, so if you'd prefer the style where the scroll position always stays centered, assign a hotkey manually from the **Open →** button on the plugin's settings screen.

</details>

## Table navigation \{#table-navigation}

<Anchor id="move-to-cell" />
<details>
<summary>Move to cell left / right / above / below</summary>

Moves to the adjacent cell in the specified direction.

**Move to cell's specific behavior**
- Lands the cursor at the start of the destination cell.
- **Left/right direction:** Always stays within the current row. Does nothing at the left/right edge of the row. (Never wraps into the adjacent row.)
- **Up/down direction:** Moves to the row above/below while keeping the same column (cell position). Does nothing on the table's first/last row.
- Only works within a table in Live Preview. Does nothing outside a table, or in Source Mode.

**Difference from Obsidian's standard cell movement (`Tab`/`Shift` + `Tab`)**
- Obsidian's standard right/left movement via `Tab` (the cell to the right) / `Shift` + `Tab` (the cell to the left):
  - Selects the entire content of the destination cell.
  - Wraps into the row below/above from the edge of a row.
  - When doing so, inserts a new row if it wraps past the bottom/top edge of the table.
- Move to cell right / Move to cell left:
  - Doesn't select a range when moving between cells.
  - Always stays within the current row. (Never wraps.)

</details>

<Anchor id="exit-table" />
<details>
<summary>Exit table above / below</summary>

Moves outside the current table.

- Exit table above lands on the line directly above the table; Exit table below lands on the line directly below it.
- **If the table sits at the very start of the note (Exit table above):** Since there's no line above to exit to, it lands at the start of the leftmost cell in the table's header row instead.
  - Smart home skips over any leading Markdown at the start of the cell.
- **If the table sits at the very end of the note (Exit table below):** A blank line is added at the end of the note and the cursor lands there.
- Only works within a table in Live Preview. Does nothing outside a table, or in Source Mode.

</details>
