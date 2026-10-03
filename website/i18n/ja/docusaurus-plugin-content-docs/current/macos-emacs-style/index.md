---
title: macOS (Emacs) style
description: macOS 標準のカーソル移動ショートカットをテーブル内でも正しく動作させ、Emacs 風の編集コマンド群を追加します
mode: macos-emacs-style
---
# macOS (Emacs) style

macOS ではショートカット `control` + `P` / `N` / `B` / `F` でノート内でカーソル移動できますが、Markdown テーブルの中ではカーソルキーと違って正しく機能しません。このプラグインはカーソルキーに相当するホットキーコマンドを提供し、これらのショートカットにホットキーとして割り当てることでテーブル内でも正しくカーソル操作できるようにします。

また Emacs の主要な編集コマンドをひと通り揃えていますので、Kill & Yank や Recenter が Obsidian の中で使えるようになります。

Windows ユーザーも macOS 風のカーソル移動を使いたい場合や Emacs 風のキー操作を使いたい場合にこのプラグインのコマンドが役に立つはずです。

**つづいては：** [コマンドリファレンス](/macos-emacs-style/command-reference) | [コマンド詳細](/macos-emacs-style/command-details) | [設定](/macos-emacs-style/settings) | [制限事項](/macos-emacs-style/limitations)

<table>

  <tr>

    <td align="center"><img width="350" height="270" alt="テーブルへの出入り" src="https://github.com/user-attachments/assets/6660fba8-a083-44d1-b1de-7f4753c8b5d9" /></td>

    <td align="center"><img width="350" height="270" alt="Smart home の様子" src="https://github.com/user-attachments/assets/eaf49a42-396c-4676-a7fa-5c21cc1524fc" /></td>

  </tr>

  <tr>

    <td align="center"><img width="350" height="270" alt="Kill &amp; Yank の様子" src="https://github.com/user-attachments/assets/5b8d0de7-b6d2-42f4-a785-5b888fe7f1bf" /></td>

    <td align="center"><img width="350" height="270" alt="Smart join の様子" src="https://github.com/user-attachments/assets/5a32e993-10a0-4ad8-b9f6-d6f71e0b8b86" /></td>

  </tr>

</table>

デフォルトではホットキーは何も割り当てられていません。カーソル移動 + α の最低限の推奨ホットキーについては「**クイックセットアップ**」としてボタンを 3 回押すだけで設定完了です。

Obsidian の **設定** → コミュニティプラグイン **Universal Cursor Hotkeys** を選択 → 上部タブ **macOS (Emacs) style** を開いて、3 つのコマンドグループ (Cursor movement、Editing、Other hotkeys) それぞれで **Apply recommended** ボタンを押してください。3 クリックで完了します。

一部のコマンドについては、純粋な Emacs 機能を再現するだけでなく Obsidian に最適化して Markdown ノート編集機能を強化しています。上の動作デモの「Smart home」や「Smart join」は純粋なテキストエディタではない Markdown エディタならではの機能となっています。設定の調整で純粋動作に変えることもできますので [設定](/macos-emacs-style/settings#behavior-options) をあわせてご覧ください。
