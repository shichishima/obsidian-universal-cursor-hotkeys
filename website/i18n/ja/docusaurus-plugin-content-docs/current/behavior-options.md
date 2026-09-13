---
sidebar_position: 5
title: 動作オプション
description: 「For everyone」「Vimモード」「macOS (Emacs) style」から共通で参照される設定 — Smart home、Smart join、Visual line movement、Cross-row navigation、Double-click word select。
show_mode_tabs: true
---

# 動作オプション

[For everyone](/for-everyone/settings)、[Vim mode](/vim-mode/settings)、[macOS (Emacs) style](/macos-emacs-style/settings)から共通で参照される設定です。

各トグルは実際に関係するタブにのみ表示されます — 下表の列を参照してください。複数のタブに表示されている設定は、どのタブでも常に同じ値を共有します（一方のタブで切り替えると、他のタブでも変わります）。

| 設定 | デフォルト | For everyone | Vim mode | Emacs | 説明 |
| ------- | :-----: | :----------: | :------: | :---: | ----------- |
| Smart home (standard) | ON | ✓ | ✓ | ✓ | **ON:** HOMEキーが先頭のMarkdown記法（リスト、番号付きリスト、チェックボックス、インデント、引用）を飛び越えて本文の先頭に移動します — Windowsの Home / macOSの Cmd+← と同様の挙動です。<br/>**OFF:** HOMEキーは行の先頭に直接移動します — macOS / Emacsの Ctrl+A と同様の挙動です。 |
| Smart home (advanced) | ON | ✓ | ✓ | ✓ | **ON:** 見出し（`# `）、脚注（`[^1]: `）、コールアウトの種類マーカー（`[!type]`）も追加で飛び越します。Smart home (standard) がONである必要があります。 |
| Smart join | OFF | — | ✓ | ✓ | **ON:** Kill Line による行の結合先が次の行の本文の先頭になり、引用マーカー・リストマーカー・インデントを取り除きます。見出しや脚注にはSmart home (advanced)と組み合わせて対応します。Smart home (standard) がONである必要があります。<br/>**OFF:** 次の行をそのまま結合します。 |
| Visual line movement | ON | ✓ | — | ✓ | *HOME/ENDのみが対象 — For everyone側の素のHome/Endキーも含みます（EmacsのCtrl+A/Eとまったく同じコマンドを実行しているため）。トグル自体はEmacsタブにのみ存在し、For everyone側に別コピーはありません。*<br/>**ON:** 最初のHOME / ENDで、表示行の端に移動します。<br/>**OFF:** 論理行の先頭・末尾に直接移動します。 |
| Cross-row navigation | ON | ✓ | — | ✓ | *LEFT/RIGHT/HOME/ENDが対象で、Visual line movementと同様の「共有コマンド」上の注意点があります（For everyoneには素のHome/Endしかなく、Left/Rightは無いため、該当部分のみ適用されます）。*<br/>**ON:** 先頭セルでのLEFT / HOME、末尾セルでのRIGHT / ENDが、隣接する行へ回り込みます。<br/>**OFF:** 境界で止まります。 |
| Double-click word select | ON | ✓ | — | — | **ON:** CJK（中国語・日本語）テキストをダブルクリック（マウス）すると、その位置の単語だけが選択されます — 辞書ベースの分割で、ひと続きの文字列全体ではありません。その後ドラッグすると、単語単位で選択が拡張されます。どのタブを使っていても常に適用されます。<br/>**OFF:** Obsidianネイティブのダブルクリック選択を使用します。 |
