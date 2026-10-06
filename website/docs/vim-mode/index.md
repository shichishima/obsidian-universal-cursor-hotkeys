---
title: Vim mode
description: Makes basic cursor-movement commands work correctly inside tables too, and adds CJK (Chinese/Japanese) word-segmentation support to word movement
mode: vim-mode
---
# Vim mode

If you use Obsidian's built-in Vim mode, you've probably noticed issues with cursor movement around tables in Live Preview.

This plugin fixes them.

It also includes improvements that benefit note editing more broadly — CJK (Chinese/Japanese) word movement, and Markdown-aware line-start movement and line joining.

**See also:** [Command Reference](/vim-mode/command-reference) | [Settings](/vim-mode/settings) | [Limitations](/vim-mode/limitations)

<img width="610" height="610" alt="Vim mode navigating a Live Preview table correctly" src="https://github.com/user-attachments/assets/0533a2f4-e497-4d3d-af73-7b68f5edfa86" />

Just turn on Obsidian's built-in **Vim key bindings** (Settings → Editor). The basic behavior upgrades are already ON by default, so no additional setup is needed.

If you also want to use table structure operations and cell-to-cell cursor movement, open **Settings → Universal Cursor Hotkeys → Vim mode** and click **Apply both**.
