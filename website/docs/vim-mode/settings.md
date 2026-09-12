---
sidebar_position: 2
title: Settings
mode: vim-mode
---

# Vim mode — Settings

Open **Settings → Universal Cursor Hotkeys → Vim mode**. For the recommended Ctrl+P/N/B/F cursor keys — which already move the cursor in both Vim's Insert and Normal mode natively on macOS, but don't know about tables — see [macOS-style (Emacs keybindings)](/macos-emacs-style/settings)'s own Hotkey settings; assigning them fixes table entry and crossing in both modes.

**Motion upgrades:** each row is a plain on/off toggle — no bulk button here, since each motion is independent. See [Command Reference](/vim-mode/command-reference) above for what each toggle actually does; the table below covers the ON/OFF decision itself. Turning a toggle off restores vim's own native, unmodified behavior for that key.

| Toggle | Default | Description |
| ------ | :-----: | ------------ |
| `h` `l` `x` Character movement | ON | — |
| `j` `k` Line movement | ON | — |
| `w` `b` `e` Word motion | ON | — |
| `gg` `G` Document start/end | ON | — |
| `gj` `gk` Display-line movement | ON | — |
| `$` End of line (sticky column) | ON | Requires `j` `k` Line movement or `gj` `gk` Display-line movement to be ON. |
| `^` `I` First non-blank | ON | Requires Smart home (standard) to be ON. |
| `J` Join lines | ON | Requires Smart join to be ON. |

**Table commands:** Table structure and Table navigation each have their own toggle, plus a combined **Apply both** button that turns both on at once (disabled once both already are). Turning either off simply stops binding its leader-key commands.

| Toggle | Default | Description |
| ------ | :-----: | ------------ |
| `Space` `t` Table structure (16 commands) | OFF | [Command reference →](/vim-mode/command-reference#table-structure) |
| `Space` `t` Table navigation (6 commands) | OFF | [Command reference →](/vim-mode/command-reference#table-navigation) |
| Leader key | OFF<br/>(`Space`) | **OFF:** `Space` (default).<br/>**ON:** `\`. Only matters once Table structure or Table navigation above is on. |

Also shared here: [Behavior Options](/behavior-options) — Smart home and Smart join extend some of the toggles above to be more Markdown-aware.

Turning an item off restarts Obsidian to fully restore vim's native behavior (a banner prompts this when needed).
