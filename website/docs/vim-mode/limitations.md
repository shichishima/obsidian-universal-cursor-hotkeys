---
sidebar_position: 3
title: Vim mode — Limitations
sidebar_label: Limitations
description: Known limitations of Vim mode — count-prefix movement limits, conflicts with other plugins, and misrecognized key input while a CJK IME is on.
mode: vim-mode
---
# Vim mode — Limitations

## Movement across tables

- **A count prefix on `w`/`b`/`e` stops once it crosses a cell or row boundary:** even with a count like `5w`, the remaining count is discarded the moment it crosses a cell or row boundary.
- **A count prefix on `gj`/`gk` also stops partway once it crosses a row:** likewise, a count like `5gj` moves correctly across multiple visual lines within a single cell, but the remaining count is discarded the moment it crosses a row boundary or enters/exits a table.
- **A count-prefixed `$` doesn't cross table rows:** `3$` stays within the current cell instead of reaching the end of a line several rows down, the way it would outside a table.
- **Entering a table from plain text always lands in the leftmost cell:** using `j`/`k`/`gj`/`gk` to move from a plain-text line directly above (or below) a table into that table always lands in that row's leftmost cell. Before the cursor actually lands, Obsidian's Live Preview table widget can't return per-character position information, so there's no way to tell which cell it should enter. It still tries to preserve the cursor's horizontal position as much as possible within the leftmost cell, but it never enters the second cell or beyond (the furthest right it can reach is still the end of the leftmost cell). The cursor's horizontal position from before entering the table is remembered, and continues to be preserved through any up/down movement afterward.

## Settings and other plugins

- **Turning on a settings toggle overrides any custom binding you've already set for the same key:** if you've already customized one of these keys yourself, that customization is overridden while the toggle is on.
- **While the leader key is `Space`, `Space` on its own loses its original behavior:** while Table structure or Table navigation is on, pressing `Space` by itself no longer performs its original action (move right). Turning the toggle back off doesn't restore it — until you restart Obsidian, pressing `Space` in Normal mode inserts a literal space instead. Restarting Obsidian fixes it. Setting the leader key to `\` avoids this entirely. See [Settings](/vim-mode/settings) for details.
- **Not designed to work alongside a plugin that replaces Vim's own table-cell behavior:** this plugin targets Obsidian's standard, built-in Vim mode specifically.

## Not caused by this plugin

- **A CJK input method (IME) being on can cause Vim's key input to be misread:** with a CJK input method active, pressing a Vim motion key (mainly `g`, `j`, or `k`) just once can sometimes be misread as a repeated key press. For example, pressing `g` once can be treated as `gg`, or `j`/`k` can move two lines instead of one. This is a known issue in the Vim engine Obsidian uses internally (`codemirror-vim`) ([issue #178](https://github.com/replit/codemirror-vim/issues/178)), and it reproduces the same way in Obsidian's standard, built-in Vim mode even with this plugin completely disabled. **Workaround:** switch to an ASCII/alphanumeric input source before using Vim motions.
