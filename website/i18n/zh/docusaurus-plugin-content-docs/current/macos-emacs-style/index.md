---
title: macOS (Emacs) style
description: 让 macOS 标准的光标移动快捷键在表格内也能正确工作，并新增一整套 Emacs 风格的编辑命令
mode: macos-emacs-style
---
# macOS (Emacs) style

在 macOS 上，你可以用快捷键 `control` + `P` / `N` / `B` / `F` 在笔记内移动光标，但与方向键不同，这些快捷键在 Markdown 表格内无法正确工作。本插件提供了与方向键作用相同的快捷键命令，只需将这些快捷键分配给对应命令，即可让它们在表格内也能正确地进行光标操作。

此外，本插件还完整提供了 Emacs 的主要编辑命令，让 Kill & Yank 和 Recenter 也能在 Obsidian 中使用。

如果 Windows 用户也想使用 macOS 风格的光标移动，或者想使用 Emacs 风格的按键操作，本插件提供的命令同样会很有帮助。

**接下来：** [命令参考](/macos-emacs-style/command-reference) | [命令详情](/macos-emacs-style/command-details) | [设置](/macos-emacs-style/settings) | [限制事项](/macos-emacs-style/limitations)

<table>

  <tr>

    <td align="center"><img width="350" height="270" alt="进出表格" src="https://github.com/user-attachments/assets/6660fba8-a083-44d1-b1de-7f4753c8b5d9" /></td>

    <td align="center"><img width="350" height="270" alt="Smart home 演示" src="https://github.com/user-attachments/assets/eaf49a42-396c-4676-a7fa-5c21cc1524fc" /></td>

  </tr>

  <tr>

    <td align="center"><img width="350" height="270" alt="Kill &amp; Yank 演示" src="https://github.com/user-attachments/assets/5b8d0de7-b6d2-42f4-a785-5b888fe7f1bf" /></td>

    <td align="center"><img width="350" height="270" alt="Smart join 演示" src="https://github.com/user-attachments/assets/5a32e993-10a0-4ad8-b9f6-d6f71e0b8b86" /></td>

  </tr>

</table>

默认情况下不会分配任何快捷键。关于光标移动加上一点其他功能的最低限度推荐快捷键，只需进行“快速设置”——按 3 次按钮即可完成设置。

打开 Obsidian 的 **设置** → 选择第三方插件 **Universal Cursor Hotkeys** → 打开上方标签 **macOS (Emacs) style**，然后分别在 3 个命令组（Cursor movement、Editing、Other hotkeys）中点击 **Apply recommended** 按钮。3 次点击即可完成。

部分命令不仅重现了纯粹的 Emacs 原生功能，还针对 Obsidian 进行了优化，强化了 Markdown 笔记的编辑体验。上面演示中的 Smart home 和 Smart join，就是 Markdown 编辑器（而非纯文本编辑器）才有的功能。你也可以通过调整设置改回纯粹的原始行为，详情请参阅 [设置](/macos-emacs-style/settings#behavior-options)。
