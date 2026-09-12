---
sidebar_position: 3
title: Limitations
---

# Vim mode — Limitations

- **A CJK input source can corrupt Vim's own key handling — not caused by this plugin:** With a CJK (e.g. romaji-based Japanese) input source active, a single press of a Vim motion key (commonly `g`, `j`, or `k`) can occasionally be misread — e.g. a single `g` behaving like `gg`, or `j`/`k` moving two lines instead of one. This is a known, upstream issue in Obsidian's underlying `codemirror-vim` engine ([issue #178](https://github.com/replit/codemirror-vim/issues/178)) and reproduces identically in vanilla Obsidian Vim mode with this plugin fully disabled. **Workaround:** switch to an ASCII/alphanumeric input source before using Vim motions.
- **`w`/`b`/`e` cross only one cell/row boundary per count:** A count like `5w` isn't fully precise once it needs to cross more than one cell or row boundary.
- **`gj`/`gk` do not support count prefixes across a crossing:** A count like `5gj` correctly steps through multiple visual lines within a single cell, but once the count needs to cross a row boundary or enter/exit a table, it stops consuming the count after that first crossing.
- **Entering a table from plain text always enters the leftmost cell:** `gj`/`gk` moving from a plain-text line into an adjacent table row always enters that row's leftmost cell — Obsidian's Live Preview table widget gives the outer editor no per-character position information for an unfocused table row, so there's no way to tell which cell a given column falls under before landing in one. The column *within* that cell is still preserved, matching row-to-row crossing within a table.
- **A count-prefixed `$` doesn't cross table rows:** `3$` stays within the current table cell rather than reaching the end of a line further down, the way real vim would outside a table.
- **For Obsidian's built-in Vim mode specifically:** not intended for use alongside a plugin that replaces or manages Vim's table-cell behavior on its own.
- **Turning on a toggle overrides your own binding:** if you've already customized one of these keys yourself, its toggle will override that customization while it's on.
