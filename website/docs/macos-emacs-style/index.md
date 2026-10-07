---
title: macOS (Emacs) style
description: Makes the standard cursor-movement shortcuts on macOS work correctly inside tables too, and adds a full set of Emacs-style editing commands
mode: macos-emacs-style
---
# macOS (Emacs) style

On macOS, the shortcuts `control` + `P`/`N`/`B`/`F` let you move the cursor within a note, but unlike the physical cursor keys, they don't work correctly inside Markdown tables. This plugin provides hotkey commands equivalent to the cursor keys, and assigning these shortcuts to them as hotkeys lets you move the cursor correctly inside tables too.

It also includes a full set of Emacs's major editing commands, so Kill & Yank and Recenter become available right inside Obsidian.

Windows users will also find this plugin's commands useful if they want macOS-style cursor movement, or Emacs-style key bindings.

**See also:** [Command Reference](/macos-emacs-style/command-reference) | [Command Details](/macos-emacs-style/command-details) | [Settings](/macos-emacs-style/settings) | [Limitations](/macos-emacs-style/limitations)

<table>

  <tr>

    <td align="center"><img width="350" height="270" alt="Enter and exit tables" src="https://github.com/user-attachments/assets/6660fba8-a083-44d1-b1de-7f4753c8b5d9" /></td>

    <td align="center"><img width="350" height="270" alt="Smart home" src="https://github.com/user-attachments/assets/eaf49a42-396c-4676-a7fa-5c21cc1524fc" /></td>

  </tr>

  <tr>

    <td align="center"><img width="350" height="270" alt="Kill &amp; Yank" src="https://github.com/user-attachments/assets/5b8d0de7-b6d2-42f4-a785-5b888fe7f1bf" /></td>

    <td align="center"><img width="350" height="270" alt="Smart join" src="https://github.com/user-attachments/assets/5a32e993-10a0-4ad8-b9f6-d6f71e0b8b86" /></td>

  </tr>

</table>

No hotkeys are assigned by default. For a minimal recommended hotkey set — cursor movement plus a few extras — **Quick setup** takes just three button clicks to finish.

Open **Settings → Universal Cursor Hotkeys → macOS (Emacs) style** and click **Apply recommended** for each of the three command groups — Cursor movement, Editing, and Other hotkeys. Three clicks and you're done.

Some commands go beyond simply reproducing pure Emacs functionality — they're optimized for Obsidian and enhanced for Markdown note editing. **Smart home** and **Smart join** in the demos above are features unique to a Markdown editor, which a plain text editor wouldn't have. These can also be switched back to pure, unmodified behavior via settings, so check [Settings](/macos-emacs-style/settings#behavior-options) too.
