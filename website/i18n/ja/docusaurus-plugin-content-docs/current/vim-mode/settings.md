---
sidebar_position: 2
title: Vim mode — 設定
sidebar_label: 設定
description: 設定 → Universal Cursor Hotkeys から、各Vimモーションのアップグレードとリーダーキーのテーブルコマンドを有効にする方法。
mode: vim-mode
---
# Vim mode — 設定
Obsidianの **設定** → コミュニティプラグイン **Universal Cursor Hotkeys** を選択 → 上部タブ **Vim mode** を開きます。

このページにある設定トグルのうち、Motion upgrades (8つ)と Table commands のうちの2つ(Table structure と Table navigation)は、OFF→ONは即座に反映されますが、ON→OFFの際には完全に有効にするためにアプリの再起動が必要です。(必要な場合は「Restart」ボタンが表示されます)

## Motion upgrades (挙動のアップグレード) \{#motion-upgrades}
キーグループごとにトグルスイッチになっていて、それぞれのグループについてObsidian標準Vim modeの挙動そのままとする(OFF)か、このプラグインのアップグレード挙動とする(ON)かを設定できます。

標準挙動とアップグレード挙動の違いについては [コマンドリファレンス](/vim-mode/command-reference#motion-upgrades) を参照してください。

| トグル                 | デフォルト | 説明                                                                          |
| ------------------- | :---: | --------------------------------------------------------------------------- |
| `h` `l` `x` 文字移動/削除 |  ON   | —                                                                           |
| `j` `k` 行移動         |  ON   | —                                                                           |
| `w` `b` `e` 単語移動    |  ON   | —                                                                           |
| `gg` `G` ノート先頭/末尾   |  ON   | —                                                                           |
| `gj` `gk` 表示行移動     |  ON   | —                                                                           |
| `$` 行末に吸着           |  ON   | `j` / `k` 行移動または `gj` / `gk` 表示行移動がONである必要があります。                            |
| `^` `I` 最初の非空白文字    |  ON   | Smart home挙動をするためには Behavior options の「Smart home (standard)」がONである必要があります。 |
| `J` 行の結合            |  ON   | Smart join挙動をするためには Behavior options の「Smart join」がONである必要があります。            |

## Table commands (テーブル関連コマンドの追加) \{#table-commands}
Table structure と Table navigation を同時にONにするための **Apply both** ボタンがあります。(両方ともONの場合は無効化されます)

| トグル                                  |      デフォルト       | 説明                                                                                                                                                                              |
| ------------------------------------ | :--------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Space` `t` Table structure (16コマンド) |       OFF        | テーブルの構造操作のためのコマンドを利用できるようにします。<br/>詳細は [コマンドリファレンス](/vim-mode/command-reference#table-structure) を参照してください。                                                                      |
| `Space` `t` Table navigation (6コマンド) |       OFF        | セル間のカーソル移動のためのコマンドを利用できるようにします。<br/>詳細は [コマンドリファレンス](/vim-mode/command-reference#table-navigation) を参照してください。                                                                    |
| リーダーキー                               | OFF<br/>(`Space`) | Table structure と Table navigation で使うリーダーキーを選びます。どちらかがONのときだけ意味を持ちます。<br/><br/>**OFF:** `Space`(デフォルト)。元々のスペースキーの動作(右に移動)が使えなくなります。<br/>**ON:** バックスラッシュ(`\`)。スペースキーの動作はそのまま使えます。 |

## Behavior options (挙動オプション)  \{#behavior-options}
上記の一部のトグルをよりMarkdownに配慮した挙動に拡張します。

同じ名称の設定項目は「For everyone」「Vim mode」「macOS (Emacs) style」で連動していて、一方でON(またはOFF)にすると他方でも連動してON(またはOFF)になります。

| 設定                         | デフォルト | 説明                                                                                                                                                                                                                                          |
| -------------------------- | :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smart&nbsp;home (standard) |  ON   | **ON:** `^` で先頭のMarkdown記法(リスト、番号付きリスト、チェックボックス、インデント、引用)を飛ばした、本文テキストの先頭に移動します。`I` はその位置で挿入モードになります。<br/><br/>**OFF:** `^` がMarkdown記法を考慮せず、行の最初の非空白文字に移動します。`I` はその位置で挿入モードになります。                                                            |
| Smart&nbsp;home (advanced) |  ON   | **ON:** `^` / `I` でのカーソル移動位置が Smart home (standard) のMarkdown考慮に加えて、見出し(`#`)、脚注(`[^1]:`)、コールアウトの種類マーカー(`[!type]`)も追加で考慮します。Smart home (standard) がONの場合のみONにできます。<br/><br/>**OFF:** 見出し行・脚注・コールアウトを考慮しません。                                    |
| Smart join                 |  OFF  | **ON:** `J` による行の結合において、次の行の先頭のMarkdownを削除します。<br/>Smart home (standard) がONである必要があります。<br/>引用マーカー・リストマーカー・インデントを削除するほか、Smart home (advanced) がONの場合には見出しや脚注も削除します。<br/><br/>**OFF:** 次の行の先頭空白だけを削除して結合します。<br/><br/>ON/OFFどちらの場合でも結合時に空白を1つ挟みます。 |
