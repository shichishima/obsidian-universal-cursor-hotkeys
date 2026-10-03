---
sidebar_position: 1
sidebar_label: トップ
slug: /
title: Universal Cursor Hotkeys
description: Markdown テーブルと日本語に対応したカーソル操作強化プラグイン。キー自体の機能強化、Vim モード対応、そして Emacs キーバインドと編集コマンド群。
---
import ModeTabs from '@site/src/components/ModeTabs';

# Universal Cursor Hotkeys

**Markdown テーブルと日本語に対応したカーソル操作強化プラグイン。キー自体の機能強化、Vim モード対応、そして Emacs キーバインドと編集コマンド群。**

<ModeTabs sticky={false} />

普段使っている矢印キー・ `Home` / `End` キー・ `Page Up` / `Page Down` キーを、より Markdown に最適化し、ライブプレビューでの Markdown テーブルに対応させます。標準では正しく動作しなかった日本語テキストの単語分割もサポートします。Vimモードにも対応。加えてmacOS 風のキーボードショートカット(Emacs キーバインド)のホットキー一式を提供します。

<img width="688" height="387" alt="標準のObsidianとUniversal Cursor Hotkeysを比較したデモ: Markdownテーブルおよび CJK テキストでのカーソル移動" src="https://github.com/user-attachments/assets/b85426e8-e8be-451a-9766-fff410cb634e" />

## 概要

Obsidian のライブプレビューはとても良くできていて、Markdown テーブルの表示も編集も素晴らしいのですが、カーソル操作には不完全な点が多く残っています。また単語操作はスペース区切りでしか認識せず、日本語の文章ではひと続きの長い単語として扱ってしまいます。

このプラグインはその両方を修正し、より快適なカーソル移動を実現します。通常は変更できないカーソルキー自体の挙動を修正するほか、Obsidian 組込みの Vim モードのカーソル移動をテーブルに対応させ、また Emacs 風のカーソル移動と編集コマンドを多数用意して macOS 風のキーボードショートカットを Windows 環境でも使えるようにします。

## 🔑 [とにかく普段のカーソル操作を良くしたい →](/for-everyone)
- `Home` キーの挙動を Markdown に最適化する
- `Page Up` / `Page Down` を Markdown テーブルでも正しく動作させる
- `Ctrl` + ← / →、`Ctrl` + `Backspace` / `Delete` で日本語でも単語単位でのカーソル移動と削除をできるようにする

## ⌨️ [Obsidian 組み込みの Vim モードを使っている →](/vim-mode)
- `j` / `k` でテーブルの行を上下移動する。`w` / `b` / `e` でテーブルのカラムを前後移動する
- `w` / `b` / `e` で日本語の単語単位で移動できるようにする
- テーブルの中にいても `gg` / `G` でノートの先頭/末尾に移動できるようにする
- テーブル操作関連のコマンドを追加する

## 🅴 [macOS 風のキーボードショートカット(Emacs キーバインド)を使いたい →](/macos-emacs-style)
- `Ctrl` + `P` / `N` / `B` / `F` で Markdown テーブル内でもカーソル移動できるようにする
- クリップボードと連動した蓄積機能付きの Kill & Yank
- Recenter-top-bottom での画面センタリング

## 付記

このプラグインのコードおよびドキュメントは AI の支援を受けて作成しています。
