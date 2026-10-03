---
sidebar_position: 1
sidebar_label: Top
slug: /
title: Universal Cursor Hotkeys
description: Markdown table-aware cursor navigation & Chinese/Japanese word splitting — for Vim mode, for Emacs keybindings, and for Everyone.
---

import ModeTabs from '@site/src/components/ModeTabs';

# Universal Cursor Hotkeys

**Markdown table-aware cursor navigation & Chinese/Japanese word splitting — for Vim mode, for Emacs keybindings, and for Everyone.**

<ModeTabs sticky={false} />

We make the arrow keys, `Home`/`End`, and `Page Up`/`Page Down` keys you already use every day Markdown-aware and table-aware inside Live Preview. We also add CJK (Chinese/Japanese) word-boundary support — which doesn't work correctly out of the box. Vim mode gets the same treatment, and on top of that, we provide a full set of hotkeys for macOS-style keyboard shortcuts (Emacs keybindings).

<img width="688" height="387" alt="Side-by-side demo: standard Obsidian vs. Universal Cursor Hotkeys navigating Markdown tables and CJK text" src="https://github.com/user-attachments/assets/b85426e8-e8be-451a-9766-fff410cb634e" />

## Overview

Obsidian's Live Preview does a great job with Markdown tables — both rendering and editing — but cursor behavior inside them still has real gaps. Word-based operations also only recognize space-separated words, treating CJK (Chinese/Japanese) text as one long word instead of stopping at real word boundaries.

This plugin fixes both, for smoother cursor movement overall. It patches the cursor keys' own behavior — something you can't normally customize — and makes Obsidian's built-in Vim mode table-aware too, so Vim's own `h`/`j`/`k`/`l`/`w`/`b`/`e`/`gg`/`G` finally work correctly inside tables. It also adds a large set of Emacs-style cursor movement and editing commands — Kill & Yank, case conversion, Recenter, and more — bringing macOS-style keyboard shortcuts to Windows as well.

## 🔑 [I just want better everyday cursor navigation →](/for-everyone)
- Make `Home` Markdown-aware
- Make `Page Up`/`Page Down` work correctly inside Markdown tables
- Add CJK (Chinese/Japanese) word-boundary support to `Ctrl` + ←/→ and `Ctrl` + `Backspace`/`Delete`

## ⌨️ [I use Obsidian's built-in Vim mode →](/vim-mode)
- Move table rows up/down with `j`/`k`; move across cells with `w`/`b`/`e`
- Add CJK (Chinese/Japanese) word-boundary support to `w`/`b`/`e`
- Jump to the start/end of the note with `gg`/`G`, even from inside a table
- Add table-structure editing commands

## 🅴 [I use macOS-style keyboard shortcuts (Emacs keybindings) →](/macos-emacs-style)
- Make `Ctrl` + `P`/`N`/`B`/`F` work correctly inside Markdown tables
- Kill & Yank, with OS-clipboard integration and accumulation
- Screen centering via Recenter-top-bottom

## Acknowledgments

- The code and documentation for this plugin were developed with the assistance of AI.
