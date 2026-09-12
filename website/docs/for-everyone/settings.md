---
sidebar_position: 2
title: Settings
mode: for-everyone
---

# For everyone — Settings

Open **Settings → Universal Cursor Hotkeys → For everyone**. Each key is a plain on/off toggle: turning it on adds that key to the target command's hotkeys (without touching any hotkey it already has); turning it off removes just that key.

**Status:** the toggle's own position already shows Set/Available — a status badge only appears for the two conflict cases:

| Status | Meaning |
|--------|---------|
| *(no&nbsp;badge)* | Toggle ON = key is assigned and gains the upgraded behavior described above. Toggle OFF = key keeps its standard, unmodified behavior and is free to assign. |
| 🔴Used | Key is already used by a different command; the toggle is disabled until you free it up (click the key chip to jump to Obsidian's own Hotkeys panel). |
| 🔴Conflict | Key is assigned here too, but is *also* still held by another command. |

**Apply all:** turns on every key above in one click (skipping any that's already on or in conflict), and also turns on every [Behavior Option](/behavior-options) below — unlike Vim mode's/Emacs's own Apply buttons, which only ever touch their own tab's key/command list. This one sits at the top of the whole tab rather than scoped to one block, so it reads as "turn everything on this page on."
