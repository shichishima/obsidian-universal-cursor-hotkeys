---
sidebar_position: 3
title: macOS (Emacs) style — Settings
sidebar_label: Settings
description: How to assign hotkeys, how to read the settings screen, what each status badge and button means, and what each Behavior option does.
mode: macos-emacs-style
---
import ApplyRecommended from '../_partials/_settings-apply-recommended.mdx';
import SettingsStatus from '../_partials/_settings-status.mdx';
import HotkeySettingsTable from '../_partials/_settings-hotkey-settings-table.mdx';
import DisplacedCommands from '../_partials/_displaced-commands.mdx';
import Individual from '../_partials/_settings-individual.mdx';

# macOS (Emacs) style — Settings
Open **Settings → Universal Cursor Hotkeys → macOS (Emacs) style**.

The settings screen is made up of two main parts: "[Hotkey settings](/macos-emacs-style/settings#hotkey-settings)" and "[Behavior options](/macos-emacs-style/settings#behavior-options)".

Normally a plugin's hotkeys are assigned from Obsidian's own standard Hotkeys panel, but this plugin's own settings screen also lets you check the current assignment state and bulk-apply the recommended hotkeys without leaving it.

## Hotkey settings \{#hotkey-settings}
This section has 6 blocks in total: the 5 command groups (→[details](/macos-emacs-style/settings#command-groups)) plus "Displaced commands" (→[details](/macos-emacs-style/settings#displaced-commands)).

### Apply recommended button \{#apply-recommended}
Each of the Cursor movement / Editing / Other hotkeys command group headings has an **Apply recommended** button to its right. Clicking it bulk-assigns that group's recommended hotkeys.

<ApplyRecommended />

### Reading the screen
<HotkeySettingsTable />

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
<SettingsStatus />

<Anchor id="status-exception" />

**Exception:** For the 4 commands UP / DOWN / HOME / END, the bare key that "For everyone" assigns (↑, ↓, `Home`, `End`) doesn't count as an assignment for Status purposes. Even when only the bare key is assigned, it's still treated as "recommended hotkey unassigned", so the **Set**/**Override** button still appears.

**Why:** These commands are designed to have both the bare key and the recommended hotkey assigned at once — e.g. UP uses both ↑ and `Ctrl` + `P`, HOME uses both `Home` and `Ctrl` + `A`. If the bare key counted as an assignment, turning on "For everyone" first would make these commands register as "already assigned" (🟢Custom), blocking this tab's own **Apply recommended** and **Set**/**Override**, and the recommended hotkey could never be added on top.

### Individual buttons \{#individual}
<Individual />

### Displaced commands \{#displaced-commands}
<DisplacedCommands />

## Behavior options \{#behavior-options}
Toggle buttons that fine-tune various behaviors.

Settings with the same name are shared across "For everyone", "Vim mode", and "macOS (Emacs) style" — turning one ON (or OFF) turns its counterpart ON (or OFF) on the other tabs too.

| Setting | Default | Description |
| --- | :---: | --- |
| Smart&nbsp;home (standard) | ON | **ON:** HOME moves to the content start, skipping any leading Markdown syntax (lists, numbered lists, checkboxes, indentation, blockquotes) — the same as `Home` on Windows / `command` + ← on macOS.<br/><br/>**OFF:** HOME ignores Markdown syntax and moves straight to the start of the line — the same as `Ctrl` + `A` on macOS/Emacs. |
| Smart&nbsp;home (advanced) | ON | **ON:** In addition to Smart home (standard)'s behavior, also skips past headings (`#`), footnotes (`[^1]:`), and callout type markers (`[!type]`). Can only be turned ON while Smart home (standard) is ON.<br/><br/>**OFF:** Heading lines, footnotes, and callouts aren't considered. (behaves the same as a plain `Home`) |
| Smart join | OFF | **ON:** When Kill line joins two lines together, it removes any leading Markdown from the start of the next line.<br/>Requires Smart home (standard) to be ON.<br/>Removes blockquote markers, list markers, and indentation; when Smart home (advanced) is also ON, it removes headings and footnotes too.<br/><br/>**OFF:** The next line is joined as-is. |
| Visual line movement | ON | **ON:** On a long, wrapped line, the first press of HOME/END moves to that visual line's start/end.<br/><br/>**OFF:** HOME/END ignore visual lines even on a wrapped line. HOME goes to the line start (the logical line start, or the content start, depending on the Smart home setting); END goes to the logical line's end. |
| Cross-row navigation | ON | Adjusts how LEFT/RIGHT/HOME/END behave inside a table.<br/><br/>**ON:** Pressing LEFT/HOME at the leftmost cell's start moves to the end of the rightmost cell in the row above. Likewise, pressing RIGHT/END at the rightmost cell's end moves to the start of the leftmost cell in the row below.<br/>If there's no such row, it exits the table.<br/>(Equivalent to the bare ←/→ keys' own behavior.)<br/><br/>**OFF:** LEFT/RIGHT/HOME/END don't cross table rows — they stop at the leftmost cell's start or the rightmost cell's end. |
