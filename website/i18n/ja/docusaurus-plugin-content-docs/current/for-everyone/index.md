---
title: For everyone
description: 普段から使っている矢印キー・Home・End・Page Up/Down・単語移動を、テーブル対応・CJK対応にアップグレード — VimモードもmacOS風キーバインドも不要です。
mode: for-everyone
---
# For everyone

このプラグインは、VimユーザやEmacsユーザだけに向けたものではありません。

特別なショートカットではなく、普段使っているキーボードの「キー自体の動作」をアップグレードします。

- ↑ / ↓ ： テーブルの行移動時にカーソル位置を維持します。
- `Home` ： 見出し行(`#`)や脚注(`[^1]:`)でもMarkdownを考慮してテキスト本文の先頭に移動します。
- `Page Up` / `Page Down` ： これまでは `Page Up` / `Page Down` はテーブル内に着地できませんでしたが、ONにするとテーブル内であってもおよそ一画面分カーソル移動します。
- `Ctrl` + ← / →、`Ctrl` + `Backspace` / `Delete` (macOSなら `option` + ← / →、`option` + ⌫ / ⌦) ：単語単位のカーソル移動/削除が日本語の単語にも対応します。

Obsidianの **設定** → コミュニティプラグイン **Universal Cursor Hotkeys** を選択 → 上部タブ **For everyone** を開いて、**Apply all** ボタンをクリックしてください。

(ここにスクショ、For everyoneのApply allボタン)

**つづいては：**
-  [キーのアップグレード](/for-everyone/key-upgrades) ： どのキーがどのように挙動アップグレードするのか
- [設定](/for-everyone/settings) ： 設定画面の見方
