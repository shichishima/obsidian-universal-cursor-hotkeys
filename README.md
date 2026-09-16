# Universal Cursor Hotkeys — CJK-aware word navigation inside Obsidian's Markdown tables, with full Vim mode support
Your everyday arrow keys, Home/End, Page Up/Down, and word movement work smarter around Live Preview's Markdown tables, and handle CJK (Chinese/Japanese) text just as well. Vim mode and macOS-style (Emacs) keybindings get the same upgrade.

<img width="688" height="387" alt="Side-by-side demo: standard Obsidian vs. Universal Cursor Hotkeys navigating Markdown tables and CJK text" src="https://github.com/user-attachments/assets/b85426e8-e8be-451a-9766-fff410cb634e" />

## Overview

Your everyday arrow keys and Page Up/Down finally behave correctly around Live Preview's tables. Home adapts to Markdown. Chinese and Japanese (CJK) text is handled correctly. Vim mode gets cursor movement that actually works inside tables. macOS-style, Emacs-flavored cursor and editing hotkeys come as a full set.

This plugin raises the baseline for cursor movement in Obsidian itself.

## How do you use Obsidian? Pick one of the three below

First, **For everyone** — upgrades the cursor keys and Home/End you already use, as they are. Chinese/Japanese word-splitting support lives here too.

A **Vim mode** user? This makes Obsidian's built-in Vim mode handle Markdown tables naturally. Chinese/Japanese word-splitting support for Vim mode lives here too.

Want **macOS**-style shortcuts on Windows too? Or want **more Emacs keybindings**?

Read whichever section below fits you.

---

## For everyone

You don't need Vim mode or Emacs-style keybindings to benefit from this plugin.

**Getting started:** Open **Settings → Universal Cursor Hotkeys → For everyone** and click **Apply all**.

<img width="600" height="467" alt="For everyone settings tab, with the Apply all button highlighted" src="https://github.com/user-attachments/assets/44085eab-9e76-402c-a39d-f3aaa3a17756" />

**What it does:**
- **↑ / ↓** — column-aware: keeps your column position across table rows instead of snapping to a cell's start.
- **Home** — Smart home skips past Markdown syntax (lists, headings, blockquotes, and more) to land on the real content.
- **Page Up / Page Down** — previously couldn't land inside a table at all. Turn this on and it scrolls a full screen at a time, keeping the cursor in view, table cells included.
- **Ctrl+←/→, Ctrl+Backspace/Delete** (macOS: Option+←/→, Option+Delete) — move and delete by word, Chinese/Japanese included (dictionary-based word segmentation).
- **Double-click (mouse)** — also Chinese/Japanese-aware: selects just the word under the cursor, not the whole unbroken run.

Every key here is purely additive — turning one on adds that key to the target command's hotkeys, without removing any it already has. You can always check what's assigned — and turn it off — in **Settings → Hotkeys**.

📖 Full documentation → [For everyone](https://shichishima.github.io/obsidian-universal-cursor-hotkeys/for-everyone)

---

## Vim mode

If you use Obsidian's built-in Vim mode, you already know the quirks of Live Preview tables. This plugin fixes them.

<img width="610" height="610" alt="Vim mode navigating a Live Preview table correctly" src="https://github.com/user-attachments/assets/0533a2f4-e497-4d3d-af73-7b68f5edfa86" />

**Getting started:** Turn on Obsidian's built-in **Vim key bindings** (Settings → Editor) — that's it. All the motion upgrades are on by default, no setup needed. If you also want the leader-key Table structure/Table navigation commands (off by default), open **Settings → Universal Cursor Hotkeys → Vim mode** and click **Apply both**.

**What it does:**
- **`h`/`j`/`k`/`l`** (and `gj`/`gk`) all work correctly inside table cells: `j`/`k`/`gj`/`gk` cross table rows, while `h`/`l` correctly stop at the cell's own edge instead (`w`/`b`/`e` below are the ones that cross cells).
- **`w`/`b`/`e`** cross table cells and rows too, with CJK-aware (Chinese/Japanese) word segmentation.
- **`gg`/`G`** reach the note's real first/last line, even from inside a table.
- **Leader-key commands** (`Space t...`) insert, delete, move, duplicate, and align table rows/columns, plus jump straight cell-to-cell (`<leader>tj/tk/th/tl`) — all without leaving Vim's own keys.

Everything above is scoped to table cells — outside a table, Vim mode behaves exactly as it always has. Each fix is a plain on/off toggle, so turning one off restores Obsidian's Vim mode to its native behavior immediately.

📖 Full documentation → [Vim mode](https://shichishima.github.io/obsidian-universal-cursor-hotkeys/vim-mode)

---

## macOS-style (Emacs keybindings)

On macOS, Ctrl+P/N/B/F move the cursor everywhere in your notes — except inside tables. Once bound to hotkeys, this plugin's commands make that movement work inside tables too.

Kill & Yank and a full set of Emacs-style cursor and editing commands are included, so macOS and Windows alike get the complete workflow.

There's also Markdown-aware smart behavior built in — give Smart home and Smart join a try.

<table>
  <tr>
    <td align="center"><img width="350" height="270" alt="Smart home" src="https://github.com/user-attachments/assets/eaf49a42-396c-4676-a7fa-5c21cc1524fc" /></td>
    <td align="center"><img width="350" height="270" alt="Smart join" src="https://github.com/user-attachments/assets/5a32e993-10a0-4ad8-b9f6-d6f71e0b8b86" /></td>
  </tr>
</table>

**Getting started:** Open **Settings → Universal Cursor Hotkeys → macOS (Emacs) style** and click **Apply recommended** for each of the three command groups — three clicks and you're done. (Manual setup via **Settings → Hotkeys** works too.)

Also worth a look: turn on **Smart home (advanced)** to cleanly skip past Markdown headings, or **Smart join** if you often use Kill line on list items.

**What it does:**
- **Ctrl+P/N/B/F/A/E** move like physical cursor keys, even inside tables.
- **Kill & Yank (Ctrl+K/Y)** — consecutive kills accumulate; **Kill Region (Ctrl+W)** handles table cell newlines and pipe characters automatically too.
- **Case conversion** (dwim-style upcase/downcase/capitalize), **Transpose chars**, **Recenter-top-bottom**, and more round out the full Emacs editing workflow.

Like For everyone, these are ordinary Obsidian Commands bound to real hotkeys — visible and reassignable any time in **Settings → Hotkeys**.

📖 Full documentation → [macOS-style (Emacs) keybindings](https://shichishima.github.io/obsidian-universal-cursor-hotkeys/macos-emacs-style)

---

Obsidian's Live Preview is genuinely great, I think, and it renders and edits Markdown tables well. It just falls a little short in this one specific way — and that one thing seems to weigh on its reputation more than it should. This plugin exists to close that gap and make Obsidian's Live Preview that much better. If it helps your everyday note-taking in Obsidian, that's exactly what it's here for.

## Acknowledgments
- The code and documentation for this plugin were developed with the assistance of AI.
