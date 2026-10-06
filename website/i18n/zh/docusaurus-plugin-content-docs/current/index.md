---
sidebar_position: 1
sidebar_label: 首页
slug: /
title: Universal Cursor Hotkeys
description: 支持 Markdown 表格和中文分词的光标操作增强插件。按键本身的功能强化、Vim 模式支持，以及 Emacs 快捷键与编辑命令组。
---
import ModeTabs from '@site/src/components/ModeTabs';

# Universal Cursor Hotkeys

**支持 Markdown 表格和中文分词的光标操作增强插件。按键本身的功能强化、Vim 模式支持，以及 Emacs 快捷键与编辑命令组。**

<ModeTabs sticky={false} />

将你平时使用的方向键、`Home`/`End` 键、`Page Up`/`Page Down` 键进一步针对 Markdown 做优化，并让它们在实时预览的 Markdown 表格中也能正确工作。同时也支持默认情况下无法正确识别的中文分词。同样适配 Vim 模式。此外，还提供一整套 macOS 风格的键盘快捷键（Emacs 快捷键）。

<img width="688" height="387" alt="标准 Obsidian 与 Universal Cursor Hotkeys 的对比演示：在 Markdown 表格与 CJK 文本中的光标移动" src="https://github.com/user-attachments/assets/b85426e8-e8be-451a-9766-fff410cb634e" />

## 概述

Obsidian 的实时预览做得非常出色，Markdown 表格的显示与编辑都相当完善，但光标操作方面仍留有不少不完善之处。此外，单词操作仅依赖空格来分词，像中文这样的文本会被当作一整段连续的单词来处理。

本插件修复了这两个问题，带来更流畅的光标移动体验。除了修正通常无法更改的光标键自身的行为之外，还让 Obsidian 内置 Vim 模式的光标移动支持表格，并提供大量 Emacs 风格的光标移动与编辑命令，让 macOS 风格的键盘快捷键也能在 Windows 环境中使用。

## 🔑 [只想让日常光标操作更好用 →](/for-everyone)
- 针对 Markdown 优化 `Home` 键的行为
- 让 `Page Up`/`Page Down` 在 Markdown 表格中也能正确工作
- 让 `Ctrl` + ←/→、`Ctrl` + `Backspace`/`Delete` 也能对中文文本实现按单词单位的光标移动与删除

## ⌨️ [正在使用 Obsidian 内置的 Vim 模式 →](/vim-mode)
- 用 `j`/`k` 在表格行间上下移动，用 `w`/`b`/`e` 在表格列间前后移动
- 让 `w`/`b`/`e` 也能按中文的单词单位移动
- 即使在表格中，也能用 `gg`/`G` 移动到笔记的开头/末尾
- 新增与表格操作相关的命令

## 🅴 [想使用 macOS 风格的键盘快捷键（Emacs 快捷键） →](/macos-emacs-style)
- 让 `Ctrl` + `P`/`N`/`B`/`F` 也能在 Markdown 表格内移动光标
- 带剪贴板联动、具备累积功能的 Kill & Yank
- 通过 Recenter-top-bottom 实现屏幕居中

## 致谢

本插件的代码及文档均在 AI 的协助下完成。
