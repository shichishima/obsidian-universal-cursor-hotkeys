---
title: Vim mode
description: 基本的なカーソル移動コマンドをテーブル内でも正しく動作させ、単語移動を日本語の単語分割に対応させます
mode: vim-mode
---
# Vim mode

Obsidian 組み込みの Vim モードを使っているなら、ライブプレビューでのテーブルまわりでのカーソル移動に不具合があることに気づいているでしょう。

このプラグインはそれらを修正します。

あわせて、日本語の単語移動や Markdown 記法を考慮した行頭移動・行の結合など、ノート編集全般に効く改善も含みます。

**つづいては：** [コマンドリファレンス](/vim-mode/command-reference) | [設定](/vim-mode/settings) | [制限事項](/vim-mode/limitations)

<img width="610" height="610" alt="ライブプレビューのテーブル内を正しく移動するVimモード" src="https://github.com/user-attachments/assets/0533a2f4-e497-4d3d-af73-7b68f5edfa86" />

Obsidian 組み込みの **Vim のキー設定** （設定 → エディタ）を ON にするだけです。基本的な挙動のアップグレードはデフォルトで ON になっており、追加の設定は不要です。

テーブルの構造操作やセル間のカーソル移動も使いたい場合は、**設定 → Universal Cursor Hotkeys → Vim mode** を開いて **Apply both** をクリックしてください。
