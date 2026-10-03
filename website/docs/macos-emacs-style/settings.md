---
sidebar_position: 4
title: macOS (Emacs) style — Settings
sidebar_label: Settings
description: How to assign hotkeys, how to read the settings screen, what each status badge and button means, and what each Behavior option does.
mode: macos-emacs-style
---
# macOS (Emacs) style — Settings
Open **Settings → Universal Cursor Hotkeys → macOS (Emacs) style**.

The settings screen is made up of two main parts: "[Hotkey settings](/macos-emacs-style/settings#hotkey-settings)" and "[Behavior options](/macos-emacs-style/settings#behavior-options)".

Normally a plugin's hotkeys are assigned from Obsidian's own standard Hotkeys panel, but this plugin's own settings screen also lets you check the current assignment state and bulk-apply the recommended hotkeys without leaving it.

## Hotkey settings \{#hotkey-settings}
This section has 6 blocks in total: the 5 command groups (→[details](/macos-emacs-style/settings#command-groups)) plus "Displaced commands" (→[details](/macos-emacs-style/settings#displaced-commands)).

### Apply recommended button \{#apply-recommended}
Each of the Cursor movement / Editing / Other hotkeys command group headings has an **Apply recommended** button to its right. Clicking it bulk-assigns that group's recommended hotkeys.

On a freshly installed Obsidian, it's fine to just click all 3 **Apply recommended** buttons as-is. On macOS, there are no hotkey conflicts in the default state. On Windows, any default hotkey that overlaps a recommended one (e.g. `Ctrl` + `P` for the command palette) gets sent to Displaced commands — but every one of those can be undone with **Restore**. (→[Displaced commands details](/macos-emacs-style/settings#displaced-commands))

If you've already customized your own hotkeys, a hotkey that gets bumped off a command that still has other hotkeys remaining (e.g. 🔵Used) won't be listed in Displaced commands and can't be brought back with **Restore**. If this concerns you, check each row's Status before clicking. (→[Status details](/macos-emacs-style/settings#status))

The bulk assignment only targets commands in that group that currently have zero hotkeys assigned (→[exception](/macos-emacs-style/settings#status-exception)). It has no effect on commands that are already assigned (✅Set, 🟢Custom) or that have no recommended hotkey at all (—).

If the recommended hotkey is already in use by a different command (🔵Used, 🟡Used, or 🔴Conflict — a recommended hotkey already split across multiple other commands), it's removed from those commands and assigned to this one instead. Any command left with zero remaining hotkeys is sent to Displaced commands.

### Reading the screen
Each command group is a table with the following columns.

| Item | Description |
| --- | --- |
| **Command** | The name of a command this plugin provides — the same name shown on Obsidian's own Hotkeys panel. |
| **Recommended Hotkey** | A minimal, Emacs-style recommended hotkey.<br/>Shows what **Apply recommended** would assign. |
| **Current Hotkey** | The hotkey(s) currently assigned. When there are several, some may be abbreviated — click the key chip to reveal them all. |
| **Status** | The current assignment state of this command's hotkey. ([details below](/macos-emacs-style/settings#status)) |
| **▶Individual** | Shows action buttons for fine-tuning individual commands. ([details below](/macos-emacs-style/settings#individual))<br/>Click **▶Individual** to reveal this column's buttons. (hidden by default) |

Clicking a command name or a key chip jumps to Obsidian's own Hotkeys panel, filtered to that command name or key.

### Command groups \{#command-groups}
The commands this plugin provides, plus table-related commands, are shown split into 5 groups.

| Command group | Commands<br/>(with a recommended hotkey) | Description |
| --- | :---: | --- |
| [Cursor movement](/macos-emacs-style/command-reference#cursor-movement) | 12<br/>(6) | The list of cursor-movement hotkeys.<br/>For some of these commands, "For everyone" also assigns a hotkey, on top of the recommended one shown here. |
| [Editing](/macos-emacs-style/command-reference#editing) | 14<br/>(5) | The list of editing hotkeys.<br/>For some of these commands, "For everyone" also assigns a hotkey, on top of the recommended one shown here. |
| [Other hotkeys](/macos-emacs-style/command-reference#other-hotkeys) | 2<br/>(1) | The list of miscellaneous hotkeys. |
| [Table structure](/macos-emacs-style/command-reference#table-structure) | 16<br/>(none) | The list of table-structure hotkeys. (collapsed by default)<br/><br/>These aren't commands this plugin provides — they're Obsidian's own standard table-structure commands, shown here in the same format purely for convenience.<br/>Also for convenience, there's a link into Obsidian's own Hotkeys panel, pre-filtered by the search term "table:".<br/><br/>There's no **Apply recommended** button here, since there's no recommended hotkey to apply. |
| [Table navigation](/macos-emacs-style/command-reference#table-navigation) | 6<br/>(none) | The list of table-navigation hotkeys. (collapsed by default)<br/><br/>There's no **Apply recommended** button here, since there's no recommended hotkey to apply. |

Each command group's name links to the matching section of the Command Reference. See the Command Reference for each command and its recommended hotkey.

### Status list \{#status}

| Status | Meaning | Individual button |
| --- | --- | --- |
| ✅Set | The recommended hotkey is assigned. | Open → |
| 🟢Custom | A non-recommended hotkey is assigned, with no conflict. | Open → |
| 🔵Available | The recommended hotkey is unassigned and isn't used by any other command, so it's safe to assign. | Set |
| 🔵Used | The recommended hotkey is currently in use by a different command.<br/>Assigning it removes the recommended hotkey from that command. (**Override** button)<br/>That command has more than one hotkey assigned, so removing this one won't leave it with no way to be triggered. | Override |
| 🟡Used | The recommended hotkey is currently in use by a different command.<br/>Assigning it removes the recommended hotkey from that command. (**Override** button)<br/>That command has only this recommended hotkey assigned, so removing it would leave that command with no hotkey to trigger it at all.<br/>(Assigning it sends that command to Displaced commands) | Override |
| 🔴Conflict | This is in a conflicted state.<br/>There are two possible patterns here:<br/><br/>(1) This command has a hotkey assigned, but that same hotkey is also assigned to a different command at the same time.<br/><br/>(2) This command has no hotkey assigned, but the recommended hotkey is assigned to more than one other command.<br/>Assigning the recommended hotkey via the **Override** button sends any command left with zero remaining hotkeys to Displaced commands. | (1)<br/>Open →<br/><br/>or<br/><br/>(2)<br/>Override |
| — | Shown when there's no recommended hotkey and the command has no hotkey assigned. | Open → |

<Anchor id="status-exception" />

**Exception:** For the 4 commands UP / DOWN / HOME / END, the bare key that "For everyone" assigns (↑, ↓, `Home`, `End`) doesn't count as an assignment for Status purposes. Even when only the bare key is assigned, it's still treated as "recommended hotkey unassigned", so the **Set**/**Override** button still appears.

**Why:** These commands are designed to have both the bare key and the recommended hotkey assigned at once — e.g. UP uses both ↑ and `Ctrl` + `P`, HOME uses both `Home` and `Ctrl` + `A`. If the bare key counted as an assignment, turning on "For everyone" first would make these commands register as "already assigned" (🟢Custom), blocking this tab's own **Apply recommended** and **Set**/**Override**, and the recommended hotkey could never be added on top.

### Individual buttons \{#individual}
Depending on the hotkey's current assignment state, one of the following 3 buttons appears, to either carry out the assignment or let you inspect the current state.

| Individual button | Description |
| --- | --- |
| **Set** | The recommended hotkey is free.<br/>Clicking **Set** assigns it. |
| **Override** | The recommended hotkey is currently assigned to a different command — that command's name is shown inline.<br/>Clicking **Override** removes the recommended hotkey from that command and assigns it to this one.<br/>Any command left with zero remaining hotkeys is sent to Displaced commands. (always the case for 🟡Used) |
| **Open →** | Jumps to Obsidian's own Hotkeys panel, filtered to this command's name. |

### Displaced commands \{#displaced-commands}
A list of commands that lost their one and only hotkey as a result of applying a recommended hotkey. Each entry has an **Assign** button to reassign it from Obsidian's own Hotkeys panel, and a **Restore** button to undo the recommended-hotkey assignment and return the key to its original command.

| Item | Description |
| --- | --- |
| **Command** | The name of the command that lost its hotkey when a recommended hotkey was applied. Clicking it opens Obsidian's own Hotkeys panel, filtered to that command name. |
| **Assign<br/>button** | Opens the same Hotkeys panel as above. Use it to assign a new hotkey. |
| **Hotkey** | The hotkey that was lost when the recommended hotkey was applied. Clicking it opens Obsidian's own Hotkeys panel, filtered to that key. |
| **Displaced by** | The name of this plugin's command that caused the Command column's command to be sent to "Displaced commands". Clicking it opens Obsidian's own Hotkeys panel, filtered to that command name.<br/>What was originally "Command's command → Hotkey key" has become:<br/>"Displaced by's command → Hotkey key"<br/>"Command's command → unassigned"<br/>— in other words, the Displaced by command has taken the Hotkey away. |
| **Restore<br/>button** | Currently it's "Displaced by's command → Hotkey key". This button turns that back into:<br/>"Command's command → Hotkey key"<br/>"Displaced by's command → unassigned"<br/>— restoring the original state from before the Hotkey was taken. |

This **Restore** button lets you undo an **Apply recommended** bulk assignment and return to the original hotkey state fairly safely, even afterward.

A command disappears from this table once it's been assigned any hotkey, whether via the **Assign** button, the **Restore** button, or Obsidian's own Hotkeys panel. This reflects the idea that "as long as some hotkey can trigger the command, that's fine" — it doesn't mean "you should assign it a hotkey just to clear it off this table".

For a command you can trigger by mouse, or one you use rarely enough that running it from the command palette is good enough, it's perfectly fine to just leave it sitting in Displaced commands.

## Behavior options \{#behavior-options}
Toggle buttons that fine-tune various behaviors.

Settings with the same name are shared across "For everyone", "Vim mode", and "macOS (Emacs) style" — turning one ON (or OFF) turns its counterpart ON (or OFF) on the other tabs too.

| Setting | Default | Description |
| --- | :---: | --- |
| Smart&nbsp;home (standard) | ON | **ON:** HOME moves to the content start, skipping any leading Markdown syntax (lists, numbered lists, checkboxes, indentation, blockquotes) — same as Windows' `Home` / macOS' `command` + ←.<br/><br/>**OFF:** HOME ignores Markdown syntax and moves straight to the start of the line — same as macOS/Emacs' `Ctrl` + `A`. |
| Smart&nbsp;home (advanced) | ON | **ON:** In addition to Smart home (standard)'s behavior, also skips past headings (`#`), footnotes (`[^1]:`), and callout type markers (`[!type]`). Can only be turned ON while Smart home (standard) is ON.<br/><br/>**OFF:** Heading lines, footnotes, and callouts aren't considered. (behaves the same as a plain `Home`) |
| Smart join | OFF | **ON:** When Kill line joins two lines together, it removes any leading Markdown from the start of the next line.<br/>Requires Smart home (standard) to be ON.<br/>Removes blockquote markers, list markers, and indentation; when Smart home (advanced) is also ON, it removes headings and footnotes too.<br/><br/>**OFF:** The next line is joined as-is. |
| Visual line movement | ON | **ON:** On a long, wrapped line, the first press of HOME/END moves to that visual line's start/end.<br/><br/>**OFF:** HOME/END ignore visual lines even on a wrapped line. HOME goes to the line start (the logical line start, or the content start, depending on the Smart home setting); END goes to the logical line's end. |
| Cross-row navigation | ON | Adjusts how LEFT/RIGHT/HOME/END behave inside a table.<br/><br/>**ON:** Pressing LEFT/HOME at the leftmost cell's start moves to the end of the rightmost cell in the row above. Likewise, pressing RIGHT/END at the rightmost cell's end moves to the start of the leftmost cell in the row below.<br/>If there's no such row, it exits the table.<br/>(Equivalent to the bare ←/→ keys' own behavior.)<br/><br/>**OFF:** LEFT/RIGHT/HOME/END don't cross table rows — they stop at the leftmost cell's start or the rightmost cell's end. |
