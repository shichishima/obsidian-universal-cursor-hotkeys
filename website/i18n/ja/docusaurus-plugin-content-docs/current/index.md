---
sidebar_position: 1
sidebar_label: トップ
slug: /
title: Universal Cursor Hotkeys
description: Markdownテーブルに対応したカーソルナビゲーションと中国語・日本語の単語分割 — Vimモードでも、Emacsキーバインドでも、そしてすべてのユーザーに。
---

import ModeTabs from '@site/src/components/ModeTabs';

# Universal Cursor Hotkeys

**Markdownテーブルに対応したカーソルナビゲーションと中国語・日本語の単語分割 — Vimモードでも、Emacsキーバインドでも、そしてすべてのユーザーに。**

<ModeTabs sticky={false} />

普段使っている矢印キー・Home/End・Page Up/Down・単語移動が、Live PreviewのMarkdownテーブル周りでもっと賢く動作するようになり、CJK（中国語・日本語）テキストも同じように正しく扱えます。Vimモードとmacs風（Emacs）キーバインドにも同じアップグレードが適用されます。

<img width="688" height="387" alt="標準のObsidianとUniversal Cursor Hotkeysを比較したデモ: Markdownテーブルおよび CJK テキストでのカーソル移動" src="https://github.com/user-attachments/assets/b85426e8-e8be-451a-9766-fff410cb634e" />

## 概要

Obsidianの Live Preview は Markdown テーブル内でのカーソル動作を崩してしまい、CJK（中国語・日本語）テキストを実際の単語境界で区切らず、ひと続きの長い単語として扱ってしまいます。このプラグインはその両方を修正します — 普段の矢印キー操作でも、Obsidian組み込みのVimモードでも、macOS風のキーボードショートカット（Emacsキーバインド）でも同様に。Vim自身の `h`/`j`/`k`/`l`/`w`/`b`/`e`/`gg`/`G` も、ついにテーブル内で正しく動作するようになります。Emacs側では、Obsidianにネイティブには存在しないKill & Yank、大文字・小文字変換、Recenterなど、編集コマンド一式も追加されます。

**🔑 [とにかく普段のカーソル操作を良くしたい →](/for-everyone)**

**⌨️ [Obsidian組み込みのVimモードを使っている →](/vim-mode)**

**🅴 [macOS風のキーボードショートカット（Emacsキーバインド）を使っている →](/macos-emacs-style)**

## 謝辞

- このプラグインのコードおよびドキュメントは、AIの支援を受けて作成されました。
