---
title: macOS (Emacs) style
description: macOSネイティブのカーソルショートカットをテーブル内でも復元し、Kill & Yank・大文字小文字変換・Recenterなど、Emacs風の編集ワークフロー一式を追加します。
mode: macos-emacs-style
---

# macOS (Emacs) style

macOSでは、カーソルショートカット — Ctrl+P（上）、Ctrl+N（下）、Ctrl+B/F（左/右）、Ctrl+A/E（Home/End）、Page Down/Up — がObsidian上でネイティブに動作します。このプラグインはそれらをテーブル内でも復元し、物理的なカーソルキーと同じようにシームレスなナビゲーションを実現します — Shift+Ctrl+P/N/B/F/A/Eによる選択範囲の拡張も同様です。

Windowsユーザーは、Obsidian全体でmacOS風のカーソルショートカット一式を有効化できます。Hotkey settingsなら、推奨されるすべてのホットキーをたった3クリックで割り当てられます。

Kill & Yank（Ctrl+K / Ctrl+Y）とKill Region（Ctrl+W）は、Emacsの編集ワークフローをそのままObsidianに持ち込みます — この3つはいずれもテーブルセル内でシームレスに動作し、改行やパイプ文字も自動的に処理します。Recenter-top-bottom（Ctrl+L）がこのワークフローを締めくくります。

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

デフォルトではホットキーは何も割り当てられていません。

**クイックセットアップ（推奨）:** **設定 → Universal Cursor Hotkeys → macOS (Emacs) style** を開き、3つのコマンドグループ（Cursor movement、Editing、Other hotkeys）それぞれについて **Apply recommended** をクリックしてください。3クリックで完了します。

**手動セットアップ:** **設定 → Hotkeys** を開き、「Universal Cursor Hotkeys」で検索して、個別にキーを割り当てます。

関連: [コマンドリファレンス](/macos-emacs-style/command-reference)、[設定](/macos-emacs-style/settings)、[既知の制限](/macos-emacs-style/limitations)、[コマンド詳細](/macos-emacs-style/command-details)、[動作オプション](/behavior-options)。
