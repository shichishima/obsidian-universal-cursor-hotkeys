---
title: For everyone
description: Upgrade cursor keys, Home/End, Page Up/Down, and word-movement keys to be table-aware and CJK-aware (Chinese/Japanese)
mode: for-everyone
---
# For everyone

This plugin is not just for Vim or Emacs users.

It doesn't add a special new shortcut to learn — it upgrades the behavior of the keys themselves, on the keyboard you already use every day.

- ↑/↓: Preserves cursor position when moving across table rows.
- `Home`: Markdown-aware — moves to the start of the text content even on heading lines (`#`) or footnotes (`[^1]:`).
- `Page Up`/`Page Down`: Previously, `Page Up`/`Page Down` could never land inside a table — turn this on and the cursor moves about one screen's worth even when that lands inside a table.
- `Ctrl` + ←/→, `Ctrl` + `Backspace`/`Delete` (`option` + ←/→, `option` + ⌫/⌦ on macOS): Adds CJK (Chinese/Japanese) word-boundary support to word-based cursor movement and deletion.

Open **Settings → Universal Cursor Hotkeys → For everyone** and click **Apply all**.

**See also:** [Key Upgrades](/for-everyone/key-upgrades) | [Settings](/for-everyone/settings) | [Limitations](/for-everyone/limitations)

![The Apply all button on the For everyone tab](/img/for-everyone-apply-all.png)
