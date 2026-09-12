---
sidebar_position: 2
title: Settings
---

# macOS (Emacs) style — Settings

Open **Settings → Universal Cursor Hotkeys → macOS (Emacs) style** to assign hotkeys without leaving the settings screen.

Each command group (Cursor movement, Editing, Other hotkeys, Table structure, Table navigation) is its own collapsible block: a **Command / Recommended Hotkey / Current Hotkey / Status** table, plus an **Individual** column header (▶) that reveals a per-row action button — hidden by default, since the block-level Apply button already covers the common case.

**Apply recommended:** each block has its own **Apply recommended** button that assigns every not-yet-set, non-conflicting hotkey in that group at once. (Table structure and Table navigation have no recommended hotkeys to apply, so they skip this button — Table structure instead links to Obsidian's own Hotkeys panel, filtered to table commands.)

**Live status:** Each row shows the current state of its hotkey:

| Status | Meaning |
|--------|---------|
| ✅Set | Recommended hotkey is assigned. |
| 🟢Custom | A non-recommended hotkey is assigned, with no conflict. |
| 🔵Available | Recommended hotkey is free to assign. |
| 🔵Used | Recommended hotkey is taken; applying it will not displace any command. |
| 🟡Used | Recommended hotkey is taken; applying it will displace one command. |
| 🔴Conflict | A conflict exists: a hotkey is currently assigned to more than one command. |

- **Command name / hotkey chips:** click either to open the hotkeys panel, filtered to that command or key.
- **Individual (▶):** reveals each row's own action button — **Set** (recommended hotkey is free), **Override** (takes the hotkey from whoever's currently using it — that command appears inline), or **Open →** (already set / no action needed here — just inspect it in Obsidian's own Hotkeys panel).

**Displaced commands:** Lists commands that would lose their only hotkey when recommended keys are applied. Each entry has an **Assign** button to reassign it via the hotkeys panel, and a **Restore** button to undo the displacement and return the key to its original command.

Also shared here: [Behavior Options](/behavior-options). Bare-key upgrades (arrow keys, Home/End/Page Up/Page Down, word navigation — no modifier needed) now live under [For everyone](/for-everyone) instead of this tab.
