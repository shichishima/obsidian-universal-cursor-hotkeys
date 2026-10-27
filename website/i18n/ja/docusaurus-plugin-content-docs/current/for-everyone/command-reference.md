---
sidebar_position: 1
title: For everyone — コマンドリファレンス
sidebar_label: コマンドリファレンス
description: For everyone の全コマンドの一覧、機能紹介、推奨ホットキー
mode: for-everyone
---
# For everyone — コマンドリファレンス

[設定画面](/for-everyone/settings) のコマンドグループごとのコマンド一覧と機能概要です。各コマンドの詳しい挙動は [コマンド詳細](/command-details) を参照してください。

- コマンド名欄は Obsidian 標準のホットキー設定画面に表示される名称です。
	- それぞれのコマンド名は「コマンド詳細」ページの該当コマンドにリンクしています。
- 推奨ホットキー欄は **[Apply recommended](/for-everyone/settings#apply-recommended)** ボタンまたは **Set** ボタンで割り当てられるキーです。
	- Windows の場合、一部は Obsidian 自身の標準ホットキーと重なっています。割り当て後は [Displaced commands](/for-everyone/settings#displaced-commands) 欄で元のホットキーに割り当てられていたコマンドの状況を確認してください。
	- macOS の場合は `control` キーとして読み替えてください。
	- 「—」は推奨ホットキーが設定されていないことを示します。**Open →** ボタンを押して Obsidian 標準のホットキー設定画面を開き、お好みのホットキーを手動で割り当ててください。
- キーリピート欄が「✓」のコマンドはキーリピートに対応しています。

## Add cursor (カーソル追加) \{#add-cursor}

この 2 つのコマンドは Obsidian 標準の「上にカーソルを追加」「下にカーソルを追加」のもつ不安定な挙動を回避するために再実装したものです。

|                            コマンド名                            | 推奨<br/>ホットキー<br/>(macOS) | 推奨<br/>ホットキー<br/>(Windows) | 機能概要                       | キー<br/>リピート |
| :---------------------------------------------------------: | :--------------------: | :----------------------: | -------------------------- | :--------: |
| [Add cursor above](/command-details#add-cursor-above-below) |      `option` + ↑      |        `Alt` + ↑         | 現在のカーソルの上の行にマルチカーソルを追加します。 |     ✓      |
| [Add cursor below](/command-details#add-cursor-above-below) |      `option` + ↓      |        `Alt` + ↓         | 現在のカーソルの下の行にマルチカーソルを追加します。 |     ✓      |
