---
title: Vim mode
description: h/l/j/k/w/b/e/gg/G/gj/gk などを修正し、Obsidian組み込みのVimモードがLive Previewのテーブル内でも正しく動作するようにします。
mode: vim-mode
---

# Vim mode

Obsidian組み込みのVimモードを使っているなら、このプラグインはよく知られたLive Previewのテーブル関連の不具合を修正します: `h`/`l`/`j`/`k`/`w`/`b`/`e`/`gg`/`G`/`gj`/`gk`が、文字数を数え間違えたり、行をまたげなかったり、誤った位置に着地したりすることなく、テーブルセル内でも正しく動作するようになります。

<img width="610" height="610" alt="Live Previewのテーブル内を正しく移動するVimモード" src="https://github.com/user-attachments/assets/0533a2f4-e497-4d3d-af73-7b68f5edfa86" />

Obsidian組み込みの **Vim key bindings**（設定 → エディタ）をONにするだけです。以下のモーション系のアップグレードはすべてデフォルトでONになっており、追加の設定は不要です。リーダーキーによるTable structure / Table navigationコマンド（デフォルトOFF）も使いたい場合は、**設定 → Universal Cursor Hotkeys → Vim mode** を開いて **Apply both** をクリックしてください。

関連: [コマンドリファレンス](/vim-mode/command-reference)、[設定](/vim-mode/settings)、[既知の制限](/vim-mode/limitations)、[動作オプション](/behavior-options)。
