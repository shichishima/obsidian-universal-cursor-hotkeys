---
sidebar_position: 2
title: Vim mode — 设置
sidebar_label: 设置
description: 各设置项目的含义及各行为选项的说明
mode: vim-mode
---
# Vim mode — 设置
打开 Obsidian 的 **设置** → 选择第三方插件 **Universal Cursor Hotkeys** → 打开上方标签 **Vim mode**。

本页面中的设置开关里，Motion upgrades（共 8 个）以及 Table commands 中的 2 个（Table structure 和 Table navigation），从 OFF → ON 会立即生效；但从 ON → OFF 时，需要重启应用才能完全生效。（需要重启时会显示 **Restart** 按钮）

## Motion upgrades（行为升级） \{#motion-upgrades}
每个按键分组都有各自的开关，可以选择保持 Obsidian 标准 Vim mode 的原有行为（OFF），还是改用本插件的升级行为（ON）。

关于标准行为与升级行为的差异，请参阅 [命令参考](/vim-mode/command-reference#motion-upgrades)。

| 开关                 | 默认值 | 说明                                                                      |
| ------------------- | :---: | ------------------------------------------------------------------------ |
| `h` `l` `x` 字符移动/删除 |  ON   | —                                                                        |
| `j` `k` 行移动         |  ON   | —                                                                        |
| `w` `b` `e` 单词移动    |  ON   | —                                                                        |
| `gg` `G` 笔记开头/末尾    |  ON   | —                                                                        |
| `gj` `gk` 显示行移动     |  ON   | —                                                                        |
| `$` 吸附到行末           |  ON   | 需要 `j`/`k` 行移动或 `gj`/`gk` 显示行移动为 ON。                                     |
| `^` `I` 首个非空白字符    |  ON   | 若要使用 Smart home 行为，需要先在 Behavior options 中将 Smart home (standard) 设为 ON。 |
| `J` 连接行            |  ON   | 若要使用 Smart join 行为，需要先在 Behavior options 中将 Smart join 设为 ON。            |

## Table commands（新增表格相关命令） \{#table-commands}
有一个 **Apply both** 按钮，可以同时将 Table structure 和 Table navigation 设为 ON。（当两者都已经是 ON 时，该按钮会处于禁用状态。）

| 开关                                 |        默认值        | 说明                                                                                                                                                                      |
| ------------------------------------ | :----------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Space` `t` Table structure（16 个命令） |         OFF         | 启用用于表格结构操作的命令。<br/>详见 [命令参考](/vim-mode/command-reference#table-structure)。                                                                                          |
| `Space` `t` Table navigation（6 个命令） |         OFF         | 启用用于在单元格之间移动光标的命令。<br/>详见 [命令参考](/vim-mode/command-reference#table-navigation)。                                                                                      |
| Leader 键                            | OFF<br/>（`Space`） | 选择 Table structure 和 Table navigation 所使用的 Leader 键。只有其中一项为 ON 时才有意义。<br/><br/>**OFF：** `Space`（默认）。原本空格键的动作（向右移动）将无法使用。<br/>**ON：** 反斜杠（`\`）。空格键的动作仍可照常使用。 |

## Behavior options（行为选项） \{#behavior-options}
将上方部分开关扩展为更加兼顾 Markdown 语法的行为。

**For everyone**、**Vim mode**、**macOS (Emacs) style** 中名称相同的设置项是联动的：在其中一处设为 ON（或 OFF），另一处也会同步变为 ON（或 OFF）。

| 设置                         | 默认值 | 说明                                                                                                                                                                                                                                      |
| -------------------------- | :---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smart&nbsp;home (standard) |  ON   | **ON：** 按下 `^` 会跳过行首的 Markdown 语法（列表、编号列表、复选框、缩进、引用），移动到正文文本的开头。`I` 会在该位置进入插入模式。<br/><br/>**OFF：** `^` 不考虑 Markdown 语法，移动到行首的第一个非空白字符。`I` 会在该位置进入插入模式。                                                                                      |
| Smart&nbsp;home (advanced) |  ON   | **ON：** `^`/`I` 的光标移动位置，除 Smart home (standard) 所考虑的 Markdown 语法外，还会额外考虑标题（`#`）、脚注（`[^1]:`）、标注类型标记（`[!type]`）。仅当 Smart home (standard) 为 ON 时才能开启。<br/><br/>**OFF：** 不考虑标题行、脚注、标注。                                                                       |
| Smart join                 |  OFF  | **ON：** 使用 `J` 连接两行时，会删除下一行开头的 Markdown 语法。<br/>需要 Smart home (standard) 为 ON。<br/>除删除引用标记、列表标记、缩进外，若 Smart home (advanced) 为 ON，还会删除标题和脚注。<br/><br/>**OFF：** 连接时只删除下一行开头的空白。<br/><br/>无论 ON/OFF，连接时都会插入 1 个空格。 |
