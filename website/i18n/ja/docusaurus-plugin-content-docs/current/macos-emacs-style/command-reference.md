---
sidebar_position: 1
title: macOS (Emacs) style — コマンドリファレンス
sidebar_label: コマンドリファレンス
description: macOS風(Emacs)の全コマンド、推奨ホットキー、そしてその機能 — カーソル移動、編集、テーブルコマンド。
mode: macos-emacs-style
---
# macOS (Emacs) style — コマンドリファレンス

[設定画面](/macos-emacs-style/settings) のコマンドグループごとのコマンド一覧と機能概要です。各コマンドの詳しい挙動は [コマンド詳細](/macos-emacs-style/command-details) を参照してください。

- コマンド名欄は Obsidian 標準のホットキー設定画面に表示される名称です。
	- それぞれのコマンド名は「コマンド詳細」ページの該当コマンドにリンクしています。
- 推奨ホットキー欄は **[Apply recommended](/macos-emacs-style/settings#apply-recommended)** ボタンまたは **Set** ボタンで割り当てられるキーです。
	- Windows の場合、一部は Obsidian 自身の標準ホットキーと重なっています。割り当て後は [Displaced commands](/macos-emacs-style/settings#displaced-commands) 欄で元のホットキーに割り当てられていたコマンドの状況を確認してください。
	- macOS の場合は `control` キーとして読み替えてください。
	- 「—」は推奨ホットキーが設定されていないことを示します。**Open →** ボタンを押して Obsidian 標準のホットキー設定画面を開き、お好みのホットキーを手動で割り当ててください。
- キーリピート欄が「✓」のコマンドはキーリピートに対応しています。

## Cursor movement (カーソル移動) \{#cursor-movement}

|                              コマンド名                               | 推奨<br/>ホットキー | 機能概要                                                                     | キー<br/>リピート |
| :--------------------------------------------------------------: | :----------: | ------------------------------------------------------------------------ | :---------: |
|        [UP](/macos-emacs-style/command-details#cursor-up)        | `Ctrl` + `P` | テキスト/セル間の移動や、テーブル・コールアウトへの進入(下から)・退出(上へ)を行います。テーブルの行をまたぐ際もカーソル横位置を維持します。 |      ✓      |
|      [DOWN](/macos-emacs-style/command-details#cursor-down)      | `Ctrl` + `N` | テキスト/セル間の移動や、テーブル・コールアウトへの進入(上から)・退出(下へ)を行います。テーブルの行をまたぐ際もカーソル横位置を維持します。 |      ✓      |
|      [LEFT](/macos-emacs-style/command-details#cursor-left)      | `Ctrl` + `B` | 文字単位で移動します。セルの先頭にいる場合は前のセルに移動します。                                        |      ✓      |
|     [RIGHT](/macos-emacs-style/command-details#cursor-right)     | `Ctrl` + `F` | 文字単位で移動します。セルの末尾にいる場合は次のセルに移動します。                                        |      ✓      |
|      [HOME](/macos-emacs-style/command-details#cursor-home)      | `Ctrl` + `A` | 表示行の端、本文の先頭、行の先頭の順に3段階で移動します。テーブル内ではセルの先頭から前のセルに移動します。                   |      ✓      |
|       [END](/macos-emacs-style/command-details#cursor-end)       | `Ctrl` + `E` | 表示行の端、行末の順に2段階で移動します。テーブル内ではセルの末尾から次のセルに移動します。                           |      ✓      |
|   [TOP](/macos-emacs-style/command-details#cursor-top-bottom)    |      —       | ノートの先頭へジャンプします。                                                          |             |
|  [BOTTOM](/macos-emacs-style/command-details#cursor-top-bottom)  |      —       | ノートの末尾へジャンプします。                                                          |             |
|    [Page up](/macos-emacs-style/command-details#page-up-down)    |      —       | 1ページ分上にスクロールします。カーソルは画面上の同じ位置にとどまります。テーブル内にも着地できます。                      |      ✓      |
|   [Page down](/macos-emacs-style/command-details#page-up-down)   |      —       | 1ページ分下にスクロールします。カーソルは画面上の同じ位置にとどまります。テーブル内にも着地できます。                      |      ✓      |
| [Word left](/macos-emacs-style/command-details#word-left-right)  |      —       | 単語単位で左に移動します。日本語でも単語単位に移動します。                                            |      ✓      |
| [Word right](/macos-emacs-style/command-details#word-left-right) |      —       | 単語単位で右に移動します。日本語でも単語単位に移動します。                                            |      ✓      |

## Editing (編集) \{#editing}

「Kill」は Emacs 用語でのカット操作です。このプラグインは OS のクリップボードを介して他のアプリともコピー & ペーストできます。連続して Kill した内容はクリップボードに蓄積され、まとめて貼り付けられます。

|                                   コマンド名                                    | 推奨<br/>ホットキー | 機能概要                                                      | キー<br/>リピート |
| :------------------------------------------------------------------------: | :----------: | --------------------------------------------------------- | :---------: |
|         [Kill line](/macos-emacs-style/command-details#kill-line)          | `Ctrl` + `K` | カーソルから行末までをKillします。連続した Kill は内容がクリップボードに蓄積されていきます。       |      ✓      |
|       [Kill region](/macos-emacs-style/command-details#kill-region)        | `Ctrl` + `W` | 選択範囲をKillします。                                             |             |
|       [Copy region](/macos-emacs-style/command-details#copy-region)        |      —       | 選択範囲を削除せずにコピーします。                                         |             |
|              [Yank](/macos-emacs-style/command-details#yank)               | `Ctrl` + `Y` | OS のクリップボード内容を貼り付けます。                                     |      ✓      |
|       [Delete char](/macos-emacs-style/command-details#delete-char)        | `Ctrl` + `D` | カーソルの右の1文字を削除します。                                         |      ✓      |
|            [Undo](/macos-emacs-style/command-details#undo-redo)            | `Ctrl` + `/` | 直前の変更を元に戻します。                                             |      ✓      |
|            [Redo](/macos-emacs-style/command-details#undo-redo)            |      —       | 直前に元に戻した変更をやり直します。                                        |      ✓      |
| [Kill word left](/macos-emacs-style/command-details#kill-word-left-right)  |      —       | カーソルから前の単語の先頭までをKillします。連続した Kill は内容がクリップボードに蓄積されていきます。  |      ✓      |
| [Kill word right](/macos-emacs-style/command-details#kill-word-left-right) |      —       | カーソルから次の単語の末尾までをKillします。連続した Kill は内容がクリップボードに蓄積されていきます。  |      ✓      |
|       [Uppercase word](/macos-emacs-style/command-details#word-case)       |      —       | 選択範囲を、あるいは選択範囲がなければカーソル位置の単語全体を大文字にします。単語分割は日本語に対応しています。  |      ✓      |
|       [Lowercase word](/macos-emacs-style/command-details#word-case)       |      —       | 選択範囲を、あるいは選択範囲がなければカーソル位置の単語全体を小文字にします。単語分割は日本語に対応しています。  |      ✓      |
|      [Capitalize word](/macos-emacs-style/command-details#word-case)       |      —       | 選択範囲の、あるいは選択範囲がなければカーソル位置の単語の先頭を大文字にします。単語分割は日本語に対応しています。 |      ✓      |
|   [Transpose chars](/macos-emacs-style/command-details#transpose-chars)    |      —       | カーソル前後の2文字を入れ替えます。行末やセル末尾では、代わりに直前の2文字を入れ替えます。絵文字・拡張漢字対応。 |      ✓      |
|        [Select all](/macos-emacs-style/command-details#select-all)         |      —       | `Ctrl` + `A` が HOME に割り当てられた場合の、Windows 向け全選択の代替コマンドです。   |             |

## Other hotkeys (その他のホットキー) \{#other-hotkeys}

|                                     コマンド名                                     | 推奨<br/>ホットキー | 機能概要                                   | キー<br/>リピート |
| :---------------------------------------------------------------------------: | :----------: | -------------------------------------- | :---------: |
| [Recenter-top-bottom](/macos-emacs-style/command-details#recenter-top-bottom) | `Ctrl` + `L` | カーソルのある行の表示位置を、押すたびに画面中央・上端・下端に切り替えます。 |             |
|            [Recenter](/macos-emacs-style/command-details#recenter)            |      —       | カーソルのある行が画面中央になるようにスクロールします。           |             |

## Table structure (テーブルの構造操作) \{#table-structure}

ここに挙げた16個のコマンドはこのプラグイン自身が持つコマンドではなく、Obsidian 組み込みのテーブル編集コマンドです。ここには参考として掲載しています。(設定画面の Hotkey settings と同様です)

ただし下表の「コマンド名」は英語版のものです。 Obsidian の言語設定により実際に表示されるコマンド名は異なります。

|        コマンド名        | 推奨<br/>ホットキー | 機能概要                                                |
| :-----------------: | :----------: | --------------------------------------------------- |
|  Insert row above   |      —       | 現在の行の上に新しい行を挿入します。                                  |
|  Insert row below   |      —       | 現在の行の下に新しい行を挿入します。                                  |
|     Move row up     |      —       | 現在の行を上に移動します。                                       |
|    Move row down    |      —       | 現在の行を下に移動します。                                       |
|    Duplicate row    |      —       | 現在の行を複製します。                                         |
|     Delete row      |      —       | 現在の行を削除します。                                         |
| Insert column left  |      —       | 現在の列の左に新しい列を挿入します。                                  |
| Insert column right |      —       | 現在の列の右に新しい列を挿入します。                                  |
|  Move column left   |      —       | 現在の列を左に移動します。                                       |
|  Move column right  |      —       | 現在の列を右に移動します。                                       |
|  Align column left  |      —       | 現在の列を左揃えにします。                                       |
| Align column center |      —       | 現在の列を中央揃えにします。                                      |
| Align column right  |      —       | 現在の列を右揃えにします。                                       |
|  Duplicate column   |      —       | 現在の列を複製します。                                         |
|    Delete column    |      —       | 現在の列を削除します。                                         |
|    Insert table     |      —       | カーソル位置に新しいテーブルを挿入します。ここに挙げたコマンドの中で唯一、テーブルの外でも動作します。 |

## Table navigation (セル間のカーソル移動) \{#table-navigation}

|                                 コマンド名                                 | 推奨<br/>ホットキー | 機能概要                 | キー<br/>リピート |
| :-------------------------------------------------------------------: | :----------: | -------------------- | :---------: |
| [Move to cell left](/macos-emacs-style/command-details#move-to-cell)  |      —       | 左隣のセルの先頭に移動します。      |      ✓      |
| [Move to cell right](/macos-emacs-style/command-details#move-to-cell) |      —       | 右隣のセルの先頭に移動します。      |      ✓      |
| [Move to cell below](/macos-emacs-style/command-details#move-to-cell) |      —       | 下の行の同じ列のセルの先頭に移動します。 |      ✓      |
| [Move to cell above](/macos-emacs-style/command-details#move-to-cell) |      —       | 上の行の同じ列のセルの先頭に移動します。 |      ✓      |
|   [Exit table below](/macos-emacs-style/command-details#exit-table)   |      —       | 今いるテーブルを下に抜け出します。    |      ✓      |
|   [Exit table above](/macos-emacs-style/command-details#exit-table)   |      —       | 今いるテーブルを上に抜け出します。    |      ✓      |
