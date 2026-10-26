---
sidebar_position: 3
title: macOS (Emacs) style — 设置
sidebar_label: 设置
description: 快捷键的分配方法、设置页面的说明、状态徽章和按钮的含义，以及各行为选项的说明
mode: macos-emacs-style
---
import ApplyRecommended from '../_partials/_settings-apply-recommended.mdx';
import SettingsStatus from '../_partials/_settings-status.mdx';
import HotkeySettingsTable from '../_partials/_settings-hotkey-settings-table.mdx';
import DisplacedCommands from '../_partials/_displaced-commands.mdx';
import Individual from '../_partials/_settings-individual.mdx';

# macOS (Emacs) style — 设置
打开 Obsidian 的 **设置** → 选择第三方插件 **Universal Cursor Hotkeys** → 打开上方标签 **macOS (Emacs) style**。

设置页面大致由 [Hotkey settings（快捷键设置）](/macos-emacs-style/settings#hotkey-settings) 和 [Behavior options（行为选项）](/macos-emacs-style/settings#behavior-options) 两部分构成。

通常插件的快捷键分配会在 Obsidian 标准的快捷键设置页面中进行，但本插件可以在插件设置页面内确认快捷键的分配状态，并一次性应用推荐设置。

## Hotkey settings（快捷键设置） \{#hotkey-settings}
这里共有 5 个命令分组（→[说明](/macos-emacs-style/settings#command-groups)）和 Displaced commands（→[说明](/macos-emacs-style/settings#displaced-commands)），合计 6 个区块。

### Apply recommended 按钮 \{#apply-recommended}
命令分组 Cursor movement / Editing / Other hotkeys 的标题右侧各有一个 **Apply recommended** 按钮，共 3 个。点击后会一次性分配该命令分组的推荐快捷键。

<ApplyRecommended />

### 页面说明
<HotkeySettingsTable />

### 命令分组 \{#command-groups}
本插件提供的命令和表格相关命令，被分为以下 5 个分组显示。

| 命令分组 | 命令数<br/>（其中含推荐快捷键数） | 说明 |
| --- | :---: | --- |
| [Cursor movement](/macos-emacs-style/command-reference#cursor-movement) | 12<br/>（6） | 光标移动相关快捷键列表。<br/>部分命令除此处显示的推荐快捷键外，还会从 For everyone 额外分配快捷键。 |
| [Editing](/macos-emacs-style/command-reference#editing) | 14<br/>（5） | 编辑相关快捷键列表。<br/>部分命令除此处显示的推荐快捷键外，还会从 For everyone 额外分配快捷键。 |
| [Other hotkeys](/macos-emacs-style/command-reference#other-hotkeys) | 2<br/>（1） | 其他快捷键列表。 |
| [Table structure](/macos-emacs-style/command-reference#table-structure) | 16<br/>（无） | 表格结构操作相关快捷键列表。（初始状态为折叠）<br/><br/>此处列出的并非本插件提供的命令，而是为方便起见，以相同格式展示 Obsidian 标准的表格结构操作命令。<br/>同样为方便起见，这里设置了指向 Obsidian 标准快捷键设置页面的链接（以搜索关键词 "表格:" 筛选）。<br/><br/>由于没有需要应用的推荐快捷键，因此没有 **Apply recommended** 按钮。 |
| [Table navigation](/macos-emacs-style/command-reference#table-navigation) | 6<br/>（无） | 表格内移动相关快捷键列表。（初始状态为折叠）<br/><br/>由于没有需要应用的推荐快捷键，因此没有 **Apply recommended** 按钮。 |

命令分组名称链接到命令参考中对应的部分。各命令及其推荐快捷键请参阅命令参考。

### Status 一览 \{#status}
<SettingsStatus />

<Anchor id="status-exception" />

**例外：** 对于 UP / DOWN / HOME / END 这 4 个命令，判断 Status 时不会将 **For everyone** 分配的原始按键（↑、↓、`Home`、`End`）计入已分配。即使只分配了原始按键，也会视为推荐快捷键尚未分配，显示 **Set** / **Override** 按钮。

**原因：** 这些命令的设计是同时分配原始按键和推荐快捷键一起使用，例如“UP 为 ↑ 和 `Ctrl` + `P`”“HOME 为 `Home` 和 `Ctrl` + `A`”。如果将原始按键计入已分配，那么当先开启 **For everyone** 时，这些命令会被判定为“已分配（🟢Custom）”，导致这一侧的 **Apply recommended** 或 **Set** / **Override** 无法生效，也就无法再额外分配推荐快捷键。

### Individual 按钮一览 \{#individual}
<Individual />

### Displaced commands（被移除快捷键的命令） \{#displaced-commands}
<DisplacedCommands />

## Behavior options（行为选项） \{#behavior-options}
用于调整各种行为的开关按钮。

**For everyone**、**Vim mode**、**macOS (Emacs) style** 中名称相同的设置项是联动的：在其中一处设为 ON（或 OFF），另一处也会同步变为 ON（或 OFF）。

| 设置 | 默认值 | 说明 |
| --- | :---: | --- |
| Smart&nbsp;home (standard) | ON | **ON：** 按下 HOME 命令会跳过行首的 Markdown 语法（列表、编号列表、复选框、缩进、引用），移动到正文文本的开头。与 Windows 的 `Home` / macOS 的 `command` + ← 行为相同。<br/><br/>**OFF：** HOME 命令不考虑 Markdown 语法，直接移动到行首。与 macOS/Emacs 的 `Ctrl` + `A` 行为相同。 |
| Smart&nbsp;home (advanced) | ON | **ON：** 除 Smart home (standard) 的行为外，还会额外考虑标题（`#`）、脚注（`[^1]:`）、标注类型标记（`[!type]`）。仅当 Smart home (standard) 为 ON 时才能开启。<br/><br/>**OFF：** 不考虑标题行、脚注、标注。（与普通的 `Home` 行为相同） |
| Smart join | OFF | **ON：** 使用 Kill line 命令合并两行时，会删除下一行开头的 Markdown 语法。<br/>需要 Smart home (standard) 为 ON。<br/>除删除引用标记、列表标记、缩进外，若 Smart home (advanced) 为 ON，还会删除标题和脚注。<br/><br/>**OFF：** 直接合并下一行，不做处理。 |
| Visual line movement | ON | **ON：** 在自动换行的长行中执行 HOME / END 时，第一步会先移动到显示行的开头/末尾。<br/><br/>**OFF：** 即使该行会自动换行，HOME / END 也不考虑显示行。HOME 移动到行首（根据 Smart home 设置，为逻辑行首或正文文本开头），END 移动到逻辑行末尾。 |
| Cross-row navigation | ON | 调整表格内 LEFT / RIGHT / HOME / END 的行为。<br/><br/>**ON：** 在最左侧单元格开头执行 LEFT / HOME，会移动到上一行最右侧单元格的末尾。同样，在最右侧单元格末尾执行 RIGHT / END，会移动到下一行最左侧单元格的开头。<br/>如果没有对应的行，则会脱出表格。<br/>（相当于原始按键 ←/→ 的行为）<br/><br/>**OFF：** LEFT / RIGHT / HOME / END 不会跨表格行移动，会停留在最左侧单元格开头或最右侧单元格末尾。 |
| Table-aware Source Mode editing | ON | **ON：** 在源代码模式的表格内，HOME / END、Kill line、Kill region / Copy region、Yank、Delete char、Transpose chars、Uppercase / Lowercase / Capitalize word、Kill word left / right、Select all 等命令都会考虑表格结构（`\|` / `<br>`）。<br/><br/>**OFF：** 将表格行作为纯文本处理，这些命令完全不考虑表格结构。 |
