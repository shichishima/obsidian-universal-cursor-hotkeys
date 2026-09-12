---
sidebar_position: 5
title: Behavior Options
---

# Behavior Options

Shared settings referenced from [For everyone](/for-everyone/settings), [Vim mode](/vim-mode/settings), and [macOS-style (Emacs keybindings)](/macos-emacs-style/settings).

Each toggle lives on whichever tab(s) it's actually relevant to — see the columns below. A setting shown on more than one tab is the exact same value everywhere (toggling it on one tab changes it on the others too).

| Setting | Default | For everyone | Vim mode | Emacs | Description |
| ------- | :-----: | :----------: | :------: | :---: | ----------- |
| Smart home (standard) | ON | ✓ | ✓ | ✓ | **ON:** HOME skips leading Markdown syntax (lists, ordered lists, checkboxes, indents, blockquotes) to reach content start — Windows Home / macOS Cmd+← style.<br/>**OFF:** HOME moves directly to the start of the line — macOS / Emacs Ctrl+A style. |
| Smart home (advanced) | ON | ✓ | ✓ | ✓ | **ON:** also skips past headings (`# `), footnotes (`[^1]: `), and callout type markers (`[!type]`). Requires Smart home (standard) to be ON. |
| Smart join | OFF | — | ✓ | ✓ | **ON:** Kill Line join lands at the next line's content start, removing blockquote markers, list markers, and indentation. Pairs with Smart home (advanced) for headings and footnotes. Requires Smart home (standard) to be ON.<br/>**OFF:** joins the next line as-is. |
| Visual line movement | ON | ✓ | — | ✓ | *HOME/END only — including the bare Home/End keys under For everyone, which run the exact same command as Emacs's Ctrl+A/E. Toggle lives on the Emacs tab only; there's no separate copy on For everyone.*<br/>**ON:** the first HOME / END moves to the visual line edge.<br/>**OFF:** moves directly to the logical line start / end. |
| Cross-row navigation | ON | ✓ | — | ✓ | *LEFT/RIGHT/HOME/END, same shared-command caveat as Visual line movement above (For everyone only has bare Home/End, not Left/Right, so only that part applies there).*<br/>**ON:** LEFT / HOME at the first cell and RIGHT / END at the last cell wrap to the adjacent row.<br/>**OFF:** stops at the boundary. |
| Double-click word select | ON | ✓ | — | — | **ON:** double-clicking (mouse) CJK (Chinese/Japanese) text selects just the word at that position — dictionary-based, not the entire unbroken run. Dragging afterward extends the selection a word at a time. Applies everywhere regardless of which tab you're using.<br/>**OFF:** uses Obsidian's native double-click selection. |
