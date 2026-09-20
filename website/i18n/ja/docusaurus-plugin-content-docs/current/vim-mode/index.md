---
title: Vim mode
description: h/l/j/k/w/b/e/gg/G/gj/gk などを修正し、Obsidian組み込みのVimモードがLive Previewのテーブル内でも正しく動作するようにします。
mode: vim-mode
---
# Vim mode

Obsidian組み込みのVimモードを使っているなら、Live Previewモードでのテーブルまわりでのカーソル移動に不具合があることに気づいているでしょう。

このプラグインはそれらを修正します。

あわせて、日本語の単語移動やMarkdown記法を考慮した行頭移動・行の結合など、ノート編集全般に効く改善も含みます。

**つづいては：** [コマンドリファレンス](/vim-mode/command-reference) | [設定](/vim-mode/settings) | [制限事項](/vim-mode/limitations)

<img width="610" height="610" alt="Live Previewのテーブル内を正しく移動するVimモード" src="https://github.com/user-attachments/assets/0533a2f4-e497-4d3d-af73-7b68f5edfa86" />

Obsidian組み込みの **Vimのキー設定**（設定 → エディタ）をONにするだけです。基本的な挙動のアップグレードはデフォルトでONになっており、追加の設定は不要です。

テーブルの構造操作やセル間のカーソル移動も使いたい場合は、**設定 → Universal Cursor Hotkeys → Vim mode** を開いて **Apply both** をクリックしてください。
