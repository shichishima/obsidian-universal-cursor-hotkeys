---
title: For everyone
description: 将方向键、Home/End、Page Up/Down、单词移动键升级为支持表格和中文分词
mode: for-everyone
---
# For everyone

本插件并非只面向 Vim 用户或 Emacs 用户。

它不是新增专门的快捷键，而是升级你平时使用的键盘上“按键本身的动作”。

- ↑/↓：在表格中上下移动行时，保持光标的列位置。
- `Home`：即使在标题行（`#`）或脚注（`[^1]:`）中，也会考虑 Markdown 语法，移动到正文内容的开头。
- `Page Up`/`Page Down`：以前 `Page Up`/`Page Down` 无法停留在表格内，开启后，即使在表格内也能以大约一屏的距离移动光标。
- `Ctrl` + ←/→、`Ctrl` + `Backspace`/`Delete`（macOS 则为 `option` + ←/→、`option` + ⌫/⌦）：按单词单位的光标移动/删除现在也支持中文分词。

打开 Obsidian 的 **设置** → 选择第三方插件 **Universal Cursor Hotkeys** → 打开上方标签 **For everyone**，然后点击 **Apply all** 按钮。

**接下来：** [按键升级](/for-everyone/key-upgrades) | [设置](/for-everyone/settings) | [限制事项](/for-everyone/limitations)

![For everyone 标签中的 Apply all 按钮](/img/for-everyone-apply-all.png)
