---
sidebar_position: 1
sidebar_label: Top
slug: /
title: Overview
---

import ModeTabs from '@site/src/components/ModeTabs';

# Universal Cursor Hotkeys

**Markdown table-aware cursor navigation & Chinese/Japanese word splitting — for Vim mode, for Emacs keybindings, and for Everyone.**

<ModeTabs sticky={false} />

Your everyday arrow keys, Home/End, Page Up/Down, and word movement work smarter around Live Preview's Markdown tables, and handle CJK (Chinese/Japanese) text just as well. Vim mode and macOS-style (Emacs) keybindings get the same upgrade.

<img width="688" height="387" alt="Side-by-side demo: standard Obsidian vs. Universal Cursor Hotkeys navigating Markdown tables and CJK text" src="https://github.com/user-attachments/assets/b85426e8-e8be-451a-9766-fff410cb634e" />

## Overview

Obsidian's Live Preview breaks cursor behavior inside Markdown tables, and treats CJK (Chinese/Japanese) text as one long word instead of stopping at real word boundaries. This plugin fixes both — for everyday arrow-key navigation, Obsidian's built-in Vim mode, and macOS-style keyboard shortcuts (aka Emacs keybindings) alike, so Vim's own `h`/`j`/`k`/`l`/`w`/`b`/`e`/`gg`/`G` finally work correctly inside tables too. On the Emacs side, it also adds a full set of editing commands — Kill & Yank, case conversion, Recenter, and more — that don't exist natively in Obsidian.

**🔑 [I just want better everyday cursor navigation →](/for-everyone)**

**⌨️ [I use Obsidian's built-in Vim mode →](/vim-mode)**

**🅴 [I use macOS-style keyboard shortcuts (Emacs keybindings) →](/macos-emacs-style)**

## Acknowledgments

- The code and documentation for this plugin were developed with the assistance of AI.
