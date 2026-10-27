---
sidebar_position: 4
title: For everyone — 设置
sidebar_label: 设置
description: 按键行为强化的应用方法、设置页面的说明，以及各项行为选项的说明
mode: for-everyone
---
import ApplyRecommended from '../_partials/_settings-apply-recommended.mdx';
import SettingsStatus from '../_partials/_settings-status.mdx';
import HotkeySettingsTable from '../_partials/_settings-hotkey-settings-table.mdx';
import DisplacedCommands from '../_partials/_displaced-commands.mdx';
import Individual from '../_partials/_settings-individual.mdx';

# For everyone — 设置

打开 Obsidian 的 **设置** → 选择社区插件 **Universal Cursor Hotkeys** → 打开上方标签 **For everyone**。

设置页面大致由 [Hotkey settings（快捷键设置）](/for-everyone/settings#hotkey-settings)、[Key upgrades（按键升级）](/for-everyone/settings#key-upgrades) 和 [Behavior options（行为选项）](/for-everyone/settings#behavior-options) 三部分构成。

通常插件的快捷键分配会在 Obsidian 标准的快捷键设置页面中进行，但本插件可以在插件设置页面内确认快捷键的分配状态，并一次性应用推荐设置。

## Hotkey settings（快捷键设置） \{#hotkey-settings}
这里共有 1 个命令分组（→[说明](/for-everyone/settings#command-groups)）和 Displaced commands（→[说明](/for-everyone/settings#displaced-commands)），合计 2 个区块。

### Apply recommended 按钮 \{#apply-recommended}
命令分组 Add cursor 的标题右侧有一个 **Apply recommended** 按钮。点击后会一次性分配该命令分组的推荐快捷键。

<ApplyRecommended />

### 页面说明
<HotkeySettingsTable />

### 命令分组 \{#command-groups}
本插件提供的命令和表格相关命令，被分为以下分组显示。

| 命令分组 | 命令数<br/>（其中含推荐快捷键数） | 说明 |
| --- | :---: | --- |
| [Add cursor](/for-everyone/command-reference#add-cursor) | 2<br/>（2） | 用于添加多光标的快捷键。<br/>Obsidian 标准也有类似命令，但新增光标的位置有时不稳定，在表格内有时还无法使用，因此本插件提供了替代命令。 |

命令分组名称链接到命令参考中对应的部分。各命令及其推荐快捷键请参阅命令参考。

### Status 一览 \{#status}
<SettingsStatus />

### Individual 按钮一览 \{#individual}
<Individual />

### Displaced commands（被移除快捷键的命令） \{#displaced-commands}
<DisplacedCommands />

## Key upgrades（按键升级） \{#key-upgrades}

## Apply all 按钮
将这之下的所有设置开关设为 ON。（Upgrade navigation basics × 8 个、Upgrade word commands × 4 个、Behavior options × 6 个）

不过，存在冲突可能性的项目（🔴Used 状态）会被跳过。

## Upgrade navigation basics（基础操作升级）
各个按键设置都是简单的 ON/OFF 开关。各按键设置的具体行为变化，请参阅 [按键升级（基础操作升级）](/for-everyone/key-upgrades#upgrade-navigation-basics)。

开启后，该按键会被添加到对应命令的快捷键中。如果该命令已经分配了快捷键，则会保留原有分配，并额外追加这个按键。

关闭后，只会移除该按键的分配，其他快捷键分配不受影响。

### 各设置行的说明 \{#setting-status}

| 状态 | 开关 | 含义 |
| --- | --- | --- |
| （无显示） | OFF | 该按键保持标准行为，未被更改。处于可分配升级行为的状态。 |
| （无显示） | ON | 该按键已分配给本插件的升级行为。 |
| 🔴Used | OFF<br/>（disable） | 该按键已被其他命令占用，因此无法再额外分配给这个命令。（无法设为 ON）<br/>点击按键标签或状态即可跳转到 Obsidian 的快捷键设置页面，请在那里确认当前占用该按键的命令。 |
| 🔴Conflict | ON | 这个按键同时分配了升级命令和其他命令，目前已经处于冲突状态。<br/>点击按键标签或状态，跳转到快捷键设置页面，整理冲突状态。另外，将开关设为 OFF 后，状态会变为 🔴Used，此时无法直接设为 ON。 |

## Upgrade word commands（单词操作升级）
各个按键设置都是简单的 ON/OFF 开关。各按键设置的具体行为变化，请参阅 [按键升级（单词操作升级）](/for-everyone/key-upgrades#upgrade-word-commands)。

### 各设置行的说明
[（同上）](/for-everyone/settings#setting-status)

## Behavior options（行为选项）\{#behavior-options}
用于调整各种行为的开关按钮。

**For everyone**、**Vim mode**、**macOS (Emacs) style** 中名称相同的设置项是联动的：在其中一处设为 ON（或 OFF），另一处也会同步变为 ON（或 OFF）。

| 设置 | 默认值 | 说明 |
| --- | :---: | --- |
| Smart&nbsp;home (standard) | ON | **ON：** 按下 `Home` 键会跳过行首的 Markdown 语法（列表、编号列表、复选框、缩进、引用），移动到正文文本的开头。与 Windows 的 `Home` / macOS 的 `command` + ← 行为相同。<br/><br/>**OFF：** `Home` 键不考虑 Markdown 语法，直接移动到行首。与 macOS/Emacs 的 `Ctrl` + `A` 行为相同。 |
| Smart&nbsp;home (advanced) | ON | **ON：** 除 Smart home (standard) 的行为外，还会额外考虑标题（`#`）、脚注（`[^1]:`）、标注类型标记（`[!type]`）。仅当 Smart home (standard) 为 ON 时才能开启。<br/><br/>**OFF：** 不考虑标题行、脚注、标注。（与普通的 `Home` 相同，移动到逻辑行首） |
| Visual line movement | ON | **ON：** 在自动换行的长行中按下 `Home`/`End` 时，第一步会先移动到显示行的开头/末尾。<br/><br/>**OFF：** 即使该行会自动换行，`Home`/`End` 也不考虑显示行。`Home` 移动到行首（根据 Smart home 设置，为逻辑行首或正文文本开头），`End` 移动到逻辑行末尾。 |
| Cross-row navigation | ON | 调整表格内 `Home`/`End` 的行为。<br/><br/>**ON：** 在最左侧单元格开头按下 `Home`，会移动到上一行最右侧单元格的末尾。同样，在最右侧单元格末尾按下 `End`，会移动到下一行最左侧单元格的开头。<br/>如果没有对应的行，则会脱出表格。<br/>（相当于 ←/→ 的行为）<br/><br/>**OFF：** `Home`/`End` 不会跨表格行移动，会停留在最左侧单元格开头或最右侧单元格末尾。 |
| Double-click word select | ON | 调整鼠标双击进行单词选择的行为。<br/><br/>**ON：** 基于词典的分词，鼠标双击时会按中文单词为单位选中范围。<br/>双击后拖动，选中范围会按单词单位扩展。<br/><br/>**OFF：** Obsidian 标准的双击行为。中文不区分词语边界，会作为一整段选中。 |
| Table-aware Source Mode editing | ON | **ON：** 在源代码模式的表格内，HOME / END、Kill line、Kill region / Copy region、Yank、Delete char、Transpose chars、Uppercase / Lowercase / Capitalize word、Kill word left / right、Select all 等命令都会考虑表格结构（`\|` / `<br>`）。<br/><br/>**OFF：** 将表格行作为纯文本处理，这些命令完全不考虑表格结构。 |
