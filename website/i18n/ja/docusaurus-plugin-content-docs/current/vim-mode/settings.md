---
sidebar_position: 2
title: Vim mode — 設定
sidebar_label: 設定
description: 各設定項目の意味と各挙動オプションの説明
mode: vim-mode
---
# Vim mode — 設定
Obsidian の **設定** → コミュニティプラグイン **Universal Cursor Hotkeys** を選択 → 上部タブ **Vim mode** を開きます。

このページにある設定トグルのうち、Motion upgrades (8 つ) と Table commands のうちの 2 つ (Table structure と Table navigation) は、OFF → ON は即座に反映されますが、ON → OFF の際には完全に有効にするためにアプリの再起動が必要です。(必要な場合は **Restart** ボタンが表示されます)

## Motion upgrades (挙動のアップグレード) \{#motion-upgrades}
キーグループごとにトグルスイッチになっていて、それぞれのグループについて Obsidian 標準 Vim mode の挙動そのままとする (OFF) か、このプラグインのアップグレード挙動とする (ON) かを設定できます。

標準挙動とアップグレード挙動の違いについては [コマンドリファレンス](/vim-mode/command-reference#motion-upgrades) を参照してください。

| トグル                 | デフォルト | 説明                                                                             |
| ------------------- | :---: | ------------------------------------------------------------------------------ |
| `h` `l` `x` 文字移動 / 削除 |  ON   | —                                                                              |
| `j` `k` 行移動         |  ON   | —                                                                              |
| `w` `b` `e` 単語移動    |  ON   | —                                                                              |
| `gg` `G` ノート先頭 / 末尾   |  ON   | —                                                                              |
| `gj` `gk` 表示行移動     |  ON   | —                                                                              |
| `$` 行末に吸着           |  ON   | `j` / `k` 行移動または `gj` / `gk` 表示行移動が ON である必要があります。                               |
| `^` `I` 最初の非空白文字    |  ON   | Smart home 挙動をするためには Behavior options の「Smart home (standard)」が ON である必要があります。 |
| `J` 行の結合            |  ON   | Smart join 挙動をするためには Behavior options の「Smart join」が ON である必要があります。            |

## Table commands (テーブル関連コマンドの追加) \{#table-commands}
Table structure と Table navigation を同時に ON にするための **Apply both** ボタンがあります。(両方とも ON の場合は無効化されます)

| トグル                                  |      デフォルト       | 説明                                                                                                                                                                                |
| ------------------------------------ | :--------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Space` `t` Table structure (16 コマンド) |       OFF        | テーブルの構造操作のためのコマンドを利用できるようにします。<br/>詳細は [コマンドリファレンス](/vim-mode/command-reference#table-structure) を参照してください。                                                                        |
| `Space` `t` Table navigation (6 コマンド) |       OFF        | セル間のカーソル移動のためのコマンドを利用できるようにします。<br/>詳細は [コマンドリファレンス](/vim-mode/command-reference#table-navigation) を参照してください。                                                                      |
| リーダーキー                               | OFF<br/>(`Space`) | Table structure と Table navigation で使うリーダーキーを選びます。どちらかが ON のときだけ意味を持ちます。<br/><br/>**OFF:** `Space` (デフォルト)。元々のスペースキーの動作 (右に移動) が使えなくなります。<br/>**ON:** バックスラッシュ (`\`)。スペースキーの動作はそのまま使えます。 |

## Behavior options (挙動オプション)  \{#behavior-options}
上記の一部のトグルをより Markdown に配慮した挙動に拡張します。

同じ名称の設定項目は「For everyone」「Vim mode」「macOS (Emacs) style」で連動していて、一方で ON (または OFF) にすると他方でも連動して ON (または OFF) になります。

| 設定                         | デフォルト | 説明                                                                                                                                                                                                                                                     |
| -------------------------- | :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Smart&nbsp;home (standard) |  ON   | **ON:** `^` で先頭の Markdown 記法 (リスト、番号付きリスト、チェックボックス、インデント、引用) を飛ばした、本文テキストの先頭に移動します。`I` はその位置で挿入モードになります。<br/><br/>**OFF:** `^` が Markdown 記法を考慮せず、行の最初の非空白文字に移動します。`I` はその位置で挿入モードになります。                                                                   |
| Smart&nbsp;home (advanced) |  ON   | **ON:** `^` / `I` でのカーソル移動位置が Smart home (standard) の Markdown 考慮に加えて、見出し (`#`)、脚注 (`[^1]:`)、コールアウトの種類マーカー (`[!type]`) も追加で考慮します。Smart home (standard) が ON の場合のみ ON にできます。<br/><br/>**OFF:** 見出し行・脚注・コールアウトを考慮しません。                                         |
| Smart join                 |  OFF  | **ON:** `J` による行の結合において、次の行の先頭の Markdown を削除します。<br/>Smart home (standard) が ON である必要があります。<br/>引用マーカー・リストマーカー・インデントを削除するほか、Smart home (advanced) が ON の場合には見出しや脚注も削除します。<br/><br/>**OFF:** 次の行の先頭空白だけを削除して結合します。<br/><br/>ON / OFF どちらの場合でも結合時に空白を 1 つ挟みます。 |
