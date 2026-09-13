---
sidebar_position: 1
title: For everyone — コマンドリファレンス
sidebar_label: コマンドリファレンス
description: For everyoneの各キーが実際に何をするか — 列位置を保つ矢印キー、Smart Home、テーブル対応のPage Up/Down、CJK対応の単語移動。
mode: for-everyone
---

# For everyone — コマンドリファレンス

各行がON/OFFで何を切り替えるかは[設定](/for-everyone/settings)を参照してください。このページでは各キーが実際に何をするかを説明します。

## 基本ナビゲーション

| キー (macOS) | キー (Windows) | 機能概要 |
| :--: | :--: | ----------------- |
| ↑ | ↑ | 列位置を保持: テーブルの行をまたいだり折り返されたセルを移動する際も列位置を維持し、セルの境界で止まってしまうことがありません。 |
| ↓ | ↓ | 列位置を保持 — ↑と同様です。 |
| Home | Home | 3段階のSmart home: 表示行の端 → 本文の先頭（Markdown記法を飛び越え）→ 行の先頭、という順で、テーブル内でも一貫して動作します。 |
| End | End | テーブル対応: 表示行の端または行末に移動し、その境界でのテーブルセルへの出入りも正しく処理します。 |
| Page&nbsp;Up | Page&nbsp;Up | テーブル対応: 画面上の同じ位置にカーソルを保ったままページをスクロールします。折り返されたテーブルセル内でも同様です。 |
| Page&nbsp;Down | Page&nbsp;Down | Page Upと同様です。 |
| Cmd+↑ | Ctrl+Home | ドキュメントの先頭へ — テーブル対応。 |
| Cmd+↓ | Ctrl+End | ドキュメントの末尾へ — テーブル対応。 |

## 単語コマンド

| キー (macOS) | キー (Windows) | 機能概要 |
| :--: | :--: | ----------------- |
| Option+→ | Ctrl+→ | Word right（単語単位で右に移動） — テーブル対応、CJK対応（辞書ベースの中国語・日本語の単語分割）。 |
| Option+← | Ctrl+← | Word left（単語単位で左に移動） — テーブル対応、CJK対応。 |
| Option+⌫ | Ctrl+Backspace | Kill word left（前の単語を削除） — テーブル対応、CJK対応。現在のセル内にとどまります。 |
| Option+⌦ | Ctrl+Delete | Kill word right（次の単語を削除） — テーブル対応、CJK対応。現在のセル内にとどまります。 |

macOSでは、物理的なDeleteキーはBackspace（⌫）を送信します — Kill word leftはOptionとこの同じキーを組み合わせます。Kill word rightが使う前方削除キー（⌦）は、専用キーのないキーボードではFn+Deleteが必要です。
