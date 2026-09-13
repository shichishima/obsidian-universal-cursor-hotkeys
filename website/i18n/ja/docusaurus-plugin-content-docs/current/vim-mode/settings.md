---
sidebar_position: 2
title: Vim mode — 設定
sidebar_label: 設定
description: 設定 → Universal Cursor Hotkeys から、各Vimモーションのアップグレードとリーダーキーのテーブルコマンドを有効にする方法。
mode: vim-mode
---

# Vim mode — 設定

**設定 → Universal Cursor Hotkeys → Vim mode** を開きます。macOSではVimのInsert/Normalどちらのモードでもネイティブにカーソルを動かせるものの、テーブルのことを知らない、推奨のCtrl+P/N/B/Fカーソルキーについては、[macOS (Emacs) style](/macos-emacs-style/settings)自身のHotkey settingsを参照してください。これらを割り当てると、両モードでのテーブルへの出入り・またぎが修正されます。

**モーションのアップグレード:** 各行が単純なON/OFFトグルです — 各モーションが独立しているため、一括ボタンはありません。各トグルが実際に何をするかは上記の[コマンドリファレンス](/vim-mode/command-reference)を参照してください。以下の表はON/OFFの判断そのものを扱います。トグルをOFFにすると、そのキーのvimネイティブな挙動に戻ります。

| トグル | デフォルト | 説明 |
| ------ | :-----: | ------------ |
| `h` `l` `x` 文字移動 | ON | — |
| `j` `k` 行移動 | ON | — |
| `w` `b` `e` 単語移動 | ON | — |
| `gg` `G` ドキュメント先頭/末尾 | ON | — |
| `gj` `gk` 表示行移動 | ON | — |
| `$` 行末（吸着する列位置） | ON | `j` `k` 行移動または`gj` `gk` 表示行移動がONである必要があります。 |
| `^` `I` 最初の非空白文字 | ON | Smart home (standard) がONである必要があります。 |
| `J` 行の結合 | ON | Smart join がONである必要があります。 |

**Table commands:** Table structureとTable navigationはそれぞれ独自のトグルを持ち、さらに両方を一度にONにする**Apply both**ボタンがあります（両方すでにONの場合は無効化されます）。どちらかをOFFにすると、そのリーダーキーコマンドの割り当てが解除されるだけです。

| トグル | デフォルト | 説明 |
| ------ | :-----: | ------------ |
| `Space` `t` Table structure（16コマンド） | OFF | [コマンドリファレンスへ →](/vim-mode/command-reference#table-structure) |
| `Space` `t` Table navigation（6コマンド） | OFF | [コマンドリファレンスへ →](/vim-mode/command-reference#table-navigation) |
| リーダーキー | OFF<br/>（`Space`） | **OFF:** `Space`（デフォルト）。<br/>**ON:** `\`。上記のTable structureまたはTable navigationがONの場合にのみ意味を持ちます。 |

こちらも共有: [動作オプション](/behavior-options) — Smart homeとSmart joinは、上記の一部のトグルをよりMarkdownに配慮した挙動に拡張します。

いずれかの項目をOFFにすると、vimのネイティブな挙動を完全に復元するためにObsidianの再起動が必要です（必要な場合はバナーで案内されます）。
