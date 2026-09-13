---
sidebar_position: 2
title: macOS (Emacs) style — 設定
sidebar_label: 設定
description: 設定 → Universal Cursor Hotkeys から macOS風（Emacs）のホットキーを割り当てる方法と、各ステータスバッジの意味。
mode: macos-emacs-style
---

# macOS (Emacs) style — 設定

**設定 → Universal Cursor Hotkeys → macOS (Emacs) style** を開くと、設定画面を離れずにホットキーを割り当てられます。

各コマンドグループ（Cursor movement、Editing、Other hotkeys、Table structure、Table navigation）はそれぞれ独立した折りたたみ可能なブロックで、**Command / Recommended Hotkey / Current Hotkey / Status** の表と、行ごとのアクションボタンを表示する **Individual** 列ヘッダー（▶）があります — ブロック単位のApplyボタンがすでによくあるケースをカバーしているため、デフォルトでは非表示になっています。

**Apply recommended:** 各ブロックには独自の **Apply recommended** ボタンがあり、そのグループ内でまだ設定されていない、競合のないホットキーを一括で割り当てます。（Table structureとTable navigationには適用すべき推奨ホットキーがないため、このボタンはありません — Table structureの代わりに、テーブルコマンドに絞り込まれたObsidian自身のHotkeysパネルへのリンクがあります。）

**ライブステータス:** 各行にはそのホットキーの現在の状態が表示されます:

| ステータス | 意味 |
|--------|---------|
| ✅Set | 推奨ホットキーが割り当てられています。 |
| 🟢Custom | 推奨ではないホットキーが割り当てられていて、競合はありません。 |
| 🔵Available | 推奨ホットキーが未割り当てで、割り当て可能です。 |
| 🔵Used | 推奨ホットキーはすでに使用されていますが、適用しても他のコマンドを奪いません。 |
| 🟡Used | 推奨ホットキーはすでに使用されており、適用すると1つのコマンドから奪うことになります。 |
| 🔴Conflict | 競合が存在します: 1つのホットキーが複数のコマンドに割り当てられています。 |

- **コマンド名・ホットキーのチップ:** どちらをクリックしても、そのコマンドまたはキーに絞り込まれたHotkeysパネルが開きます。
- **Individual（▶）:** 各行のアクションボタンを表示します — **Set**（推奨ホットキーが空いている場合）、**Override**（現在それを使っているコマンドから奪います — そのコマンド名がインラインで表示されます）、または **Open →**（すでに設定済み・操作不要 — Obsidian自身のHotkeysパネルで確認するだけです）。

**Displaced commands:** 推奨キーを適用すると唯一のホットキーを失うことになるコマンドの一覧です。各項目には、Hotkeysパネルから再割り当てするための **Assign** ボタンと、割り当て解除を取り消して元のコマンドにキーを戻す **Restore** ボタンがあります。

こちらも共有: [動作オプション](/behavior-options)。修飾キー不要のキー（矢印キー、Home/End/Page Up/Page Down、単語移動）のアップグレードは、現在このタブではなく[For everyone](/for-everyone)にあります。
