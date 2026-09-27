---
sidebar_position: 3
title: For everyone — Limitations
sidebar_label: Limitations
description: A known limitation of Key Upgrades — turning on an arrow-key toggle can block arrow-key navigation in other views like Excalidraw.
mode: for-everyone
---

# For everyone — Limitations

- **Key Upgrades' arrow-key toggles can block arrow-key navigation in other views (e.g. Excalidraw):** once a key is bound to any command, Obsidian's hotkey manager claims that physical keystroke globally, regardless of which view is focused — so the key event never reaches a non-editor view's own key handling, such as Excalidraw's canvas navigation. Confirmed for the Up/Down toggle: turning it off restores normal arrow-key navigation in Excalidraw. The same mechanism likely affects the other Key Upgrades toggles too (Left/Right, Home, End, Page Up/Page Down), though this hasn't been individually confirmed for each one. If this affects a view you use, turn off the Key Upgrades toggle for that specific key.
