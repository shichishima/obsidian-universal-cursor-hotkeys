---
sidebar_position: 1
title: macOS (Emacs) style — 命令参考
sidebar_label: 命令参考
description: macOS 风格（Emacs）全部命令的一览、功能介绍与推荐快捷键
mode: macos-emacs-style
---
# macOS (Emacs) style — 命令参考

本页是按照 [设置页面](/macos-emacs-style/settings) 的命令分组列出的命令一览与功能概述。各命令的详细行为请参阅 [命令详情](/macos-emacs-style/command-details)。

- 命令名称栏显示的是 Obsidian 标准快捷键设置页面中显示的名称。
  - 各个命令名称都链接到 **命令详情** 页面中的相应命令。
- 推荐快捷键栏是通过 **Apply recommended** 按钮或 **Set** 按钮分配的按键。
  - 在 Windows 上，部分快捷键与 Obsidian 自身的标准快捷键重叠。分配后，请在 [Displaced commands](/macos-emacs-style/settings#displaced-commands) 栏确认原本分配给该快捷键的命令状态。
  - 在 macOS 上，请将其替换为 `control` 键。
  - "—" 表示尚未设置推荐快捷键。请点击 **Open →** 按钮，打开 Obsidian 标准快捷键设置页面，手动分配你想要的快捷键。
- 按键重复栏显示 "✓" 的命令表示支持按键重复。

## Cursor movement（光标移动）\{#cursor-movement}

|                               命令名称                                | 推荐<br/>快捷键 | 功能概述                                                       | 按键<br/>重复 |
| :-----------------------------------------------------------------: | :--------: | ------------------------------------------------------------ | :------: |
|        [UP](/macos-emacs-style/command-details#cursor-up)           | `Ctrl` + `P` | 进行文本/单元格之间的移动，以及表格、标注的进入（从下方）与退出（向上）。跨越表格行时也会保持光标的横向位置。 |    ✓     |
|      [DOWN](/macos-emacs-style/command-details#cursor-down)         | `Ctrl` + `N` | 进行文本/单元格之间的移动，以及表格、标注的进入（从上方）与退出（向下）。跨越表格行时也会保持光标的横向位置。 |    ✓     |
|      [LEFT](/macos-emacs-style/command-details#cursor-left)         | `Ctrl` + `B` | 按字符单位向左移动。位于单元格开头时，会移动到前一个单元格。                                 |    ✓     |
|     [RIGHT](/macos-emacs-style/command-details#cursor-right)        | `Ctrl` + `F` | 按字符单位向右移动。位于单元格末尾时，会移动到下一个单元格。                                 |    ✓     |
|      [HOME](/macos-emacs-style/command-details#cursor-home)         | `Ctrl` + `A` | 按显示行左端、正文开头、行首的顺序，分 3 个阶段移动。表格内会从单元格开头移动到前一个单元格。             |    ✓     |
|       [END](/macos-emacs-style/command-details#cursor-end)          | `Ctrl` + `E` | 按显示行右端、行末的顺序，分 2 个阶段移动。表格内会从单元格末尾移动到下一个单元格。                  |    ✓     |
|   [TOP](/macos-emacs-style/command-details#cursor-top-bottom)       |     —      | 跳转到笔记的开头。                                                     |          |
|  [BOTTOM](/macos-emacs-style/command-details#cursor-top-bottom)     |     —      | 跳转到笔记的末尾。                                                     |          |
|    [Page up](/macos-emacs-style/command-details#page-up-down)       |     —      | 向上滚动 1 页。光标会保持在屏幕上的同一位置。也能落在表格内部。                             |    ✓     |
|   [Page down](/macos-emacs-style/command-details#page-up-down)      |     —      | 向下滚动 1 页。光标会保持在屏幕上的同一位置。也能落在表格内部。                             |    ✓     |
|  [Word left](/macos-emacs-style/command-details#word-left-right)    |     —      | 按单词单位向左移动。支持中文分词。                                             |    ✓     |
| [Word right](/macos-emacs-style/command-details#word-left-right)    |     —      | 按单词单位向右移动。支持中文分词。                                             |    ✓     |

## Editing（编辑）\{#editing}

Kill 是 Emacs 术语中的剪切操作。本插件可以通过系统剪贴板，与其他应用程序之间进行复制和粘贴。连续执行的 Kill 会使内容不断累积到剪贴板中，可以一次性整体粘贴。

|                                    命令名称                                     | 推荐<br/>快捷键 | 功能概述                                             | 按键<br/>重复 |
| :--------------------------------------------------------------------------: | :--------: | -------------------------------------------------- | :------: |
|          [Kill line](/macos-emacs-style/command-details#kill-line)           | `Ctrl` + `K` | Kill 从光标到行末的内容。在行末执行时会删除换行符并与下一行合并。连续执行的 Kill 会使内容不断累积到剪贴板中。             |    ✓     |
|        [Kill region](/macos-emacs-style/command-details#kill-region)         | `Ctrl` + `W` | Kill 选中的范围。                                        |          |
|        [Copy region](/macos-emacs-style/command-details#copy-region)         |     —      | 复制选中的范围，但不会将其删除。                                    |          |
|               [Yank](/macos-emacs-style/command-details#yank)                | `Ctrl` + `Y` | 粘贴系统剪贴板中的内容。                                     |    ✓     |
|        [Delete char](/macos-emacs-style/command-details#delete-char)         | `Ctrl` + `D` | 删除光标右侧的 1 个字符。                                     |    ✓     |
|             [Undo](/macos-emacs-style/command-details#undo-redo)             | `Ctrl` + `/` | 撤销上一次的更改。                                          |    ✓     |
|             [Redo](/macos-emacs-style/command-details#undo-redo)             |     —      | 重做上一次撤销的更改。                                         |    ✓     |
|  [Kill word left](/macos-emacs-style/command-details#kill-word-left-right)   |     —      | Kill 从光标到前一个单词开头的内容。连续执行的 Kill 会使内容不断累积到剪贴板中。        |    ✓     |
| [Kill word right](/macos-emacs-style/command-details#kill-word-left-right)   |     —      | Kill 从光标到下一个单词末尾的内容。连续执行的 Kill 会使内容不断累积到剪贴板中。        |    ✓     |
|       [Uppercase word](/macos-emacs-style/command-details#word-case)         |     —      | 将选中范围、或没有选区时光标所在位置的整个单词转换为大写。支持中文分词。                |    ✓     |
|       [Lowercase word](/macos-emacs-style/command-details#word-case)         |     —      | 将选中范围、或没有选区时光标所在位置的整个单词转换为小写。支持中文分词。                |    ✓     |
|      [Capitalize word](/macos-emacs-style/command-details#word-case)         |     —      | 将选中范围内（逐词）、或没有选区时光标所在单词的开头字母转换为大写。支持中文分词。           |    ✓     |
|    [Transpose chars](/macos-emacs-style/command-details#transpose-chars)     |     —      | 交换光标前后的 2 个字符。在行末或单元格末尾时，则改为交换前面的 2 个字符。支持表情符号与扩展汉字。 |    ✓     |
|         [Select all](/macos-emacs-style/command-details#select-all)          |     —      | 当 `Ctrl` + `A` 被分配给 HOME 时，用于 Windows 的全选替代命令。       |          |

## Other hotkeys（其他快捷键）\{#other-hotkeys}

|                                      命令名称                                      | 推荐<br/>快捷键 | 功能概述                                | 按键<br/>重复 |
| :------------------------------------------------------------------------------: | :--------: | ------------------------------------- | :------: |
| [Recenter-top-bottom](/macos-emacs-style/command-details#recenter-top-bottom)    | `Ctrl` + `L` | 每次按下时，会在屏幕中央、上端、下端之间切换光标所在行的显示位置。 |          |
|             [Recenter](/macos-emacs-style/command-details#recenter)              |     —      | 滚动画面，使光标所在行位于屏幕中央。                 |          |

## Table structure（表格结构操作）\{#table-structure}

这里列出的 16 个命令并非本插件自身拥有的命令，而是 Obsidian 内置的表格编辑命令。这里仅作为参考列出。（与设置页面的 Hotkey settings 相同）

不过，下表中的 "命令名称" 是英文版的名称。根据 Obsidian 的语言设置，实际显示的命令名称可能有所不同。

|        命令名称        | 推荐<br/>快捷键 | 功能概述                                      |
| :-----------------: | :--------: | ------------------------------------------- |
|  Insert row above   |     —      | 在当前行的上方插入新行。                              |
|  Insert row below   |     —      | 在当前行的下方插入新行。                              |
|     Move row up     |     —      | 将当前行向上移动。                                  |
|    Move row down    |     —      | 将当前行向下移动。                                  |
|    Duplicate row    |     —      | 复制当前行。                                     |
|     Delete row      |     —      | 删除当前行。                                     |
| Insert column left  |     —      | 在当前列的左侧插入新列。                              |
| Insert column right |     —      | 在当前列的右侧插入新列。                              |
|  Move column left   |     —      | 将当前列向左移动。                                  |
|  Move column right  |     —      | 将当前列向右移动。                                  |
|  Align column left  |     —      | 将当前列设为左对齐。                                 |
| Align column center |     —      | 将当前列设为居中对齐。                                |
| Align column right  |     —      | 将当前列设为右对齐。                                 |
|  Duplicate column   |     —      | 复制当前列。                                     |
|    Delete column    |     —      | 删除当前列。                                     |
|    Insert table     |     —      | 在光标位置插入新表格。是这里列出的命令中唯一一个即使在表格外也能执行的命令。 |

## Table navigation（单元格间的光标移动）\{#table-navigation}

仅执行单元格间的光标移动。在表格单元格以外不会执行任何操作。

|                                  命令名称                                  | 推荐<br/>快捷键 | 功能概述                | 按键<br/>重复 |
| :-----------------------------------------------------------------------: | :--------: | --------------------- | :------: |
|  [Move to cell left](/macos-emacs-style/command-details#move-to-cell)     |     —      | 移动到左侧相邻单元格的开头。与 `Shift` + `Tab` 不同，不会选中目标单元格的文本。       |    ✓     |
| [Move to cell right](/macos-emacs-style/command-details#move-to-cell)     |     —      | 移动到右侧相邻单元格的开头。与 `Tab` 不同，不会选中目标单元格的文本。       |    ✓     |
| [Move to cell below](/macos-emacs-style/command-details#move-to-cell)     |     —      | 移动到下一行同一列单元格的开头。     |    ✓     |
| [Move to cell above](/macos-emacs-style/command-details#move-to-cell)     |     —      | 移动到上一行同一列单元格的开头。     |    ✓     |
|   [Exit table below](/macos-emacs-style/command-details#exit-table)       |     —      | 向下脱出当前所在的表格。         |    ✓     |
|   [Exit table above](/macos-emacs-style/command-details#exit-table)       |     —      | 向上脱出当前所在的表格。         |    ✓     |
