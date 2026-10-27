---
sidebar_position: 3
title: macOS (Emacs) style — 設定
sidebar_label: 設定
description: ホットキーの割り当て方法、設定画面の見方、ステータスバッジとボタンの意味、各挙動オプションの説明
mode: macos-emacs-style
---
import ApplyRecommended from '../_partials/_settings-apply-recommended.mdx';

import SettingsStatus from '../_partials/_settings-status.mdx';

import HotkeySettingsTable from '../_partials/_settings-hotkey-settings-table.mdx';

import DisplacedCommands from '../_partials/_displaced-commands.mdx';

import Individual from '../_partials/_settings-individual.mdx';

# macOS (Emacs) style — 設定
Obsidian の **設定** → コミュニティプラグイン **Universal Cursor Hotkeys** を選択 → 上部タブ **macOS (Emacs) style** を開きます。

設定画面は大きく「[Hotkey settings (ホットキー設定)](/macos-emacs-style/settings#hotkey-settings)」と「[Behavior options (挙動オプション)](/macos-emacs-style/settings#behavior-options)」で構成されています。

通常、プラグインのホットキー割り当ては Obsidian 標準のホットキー設定画面で行いますが、このプラグインではプラグイン設定画面の中でホットキー割り当て状態の確認と推奨設定の一括割り当てが行えます。

## Hotkey settings (ホットキー設定) \{#hotkey-settings}
ここには 5 つのコマンドグループ (→[解説](/macos-emacs-style/settings#command-groups)) と「Displaced commands」(→[解説](/macos-emacs-style/settings#displaced-commands)) の計 6 つのブロックがあります。

### Apply recommended ボタン \{#apply-recommended}
コマンドグループ Cursor movement / Editing / Other hotkeys の見出しの右側に 3 つの **Apply recommended** ボタンがあります。これを押すとそのコマンドグループの推奨ホットキーを一括で割り当てます。

<ApplyRecommended />

### 画面の見方
<HotkeySettingsTable />

### コマンドグループ \{#command-groups}
プラグインが提供するコマンドとテーブル関連コマンドを 5 つのグループに分けて表示しています。

| コマンドグループ                                                                  | コマンド数<br/>(うち推奨ホットキー数) | 説明                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | :-------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Cursor movement](/macos-emacs-style/command-reference#cursor-movement)   |       12<br/>(6)       | カーソル移動系ホットキーのリストです。<br/>一部のコマンドに対しては、ここで示される推奨ホットキーに加えて「For everyone」からもホットキー割り当てが行われます。                                                                                                                                                                       |
| [Editing](/macos-emacs-style/command-reference#editing)                   |       14<br/>(5)       | 編集系ホットキーのリストです。<br/>一部のコマンドに対しては、ここで示される推奨ホットキーに加えて「For everyone」からもホットキー割り当てが行われます。                                                                                                                                                                           |
| [Other hotkeys](/macos-emacs-style/command-reference#other-hotkeys)       |       2<br/>(1)        | その他のホットキーのリストです。                                                                                                                                                                                                                                              |
| [Table structure](/macos-emacs-style/command-reference#table-structure)   |      16<br/>(なし)       | テーブル構造操作系ホットキーのリストです。(初期状態では閉じられています)<br/><br/>ここに掲載しているのはこのプラグインが提供するコマンドではありません。Obsidian 標準のテーブル構造操作コマンドを利便性のために同じ形式で表示しています。<br/>同じく利便性のため、Obsidian 標準のホットキー設定画面へのリンク (検索キーワード「表:」で絞った状態) を設置しています。<br/><br/>適用すべき推奨ホットキーがないため **Apply recommended** ボタンはありません。 |
| [Table navigation](/macos-emacs-style/command-reference#table-navigation) |       6<br/>(なし)       | テーブル移動系ホットキーのリストです。(初期状態では閉じられています)<br/><br/>適用すべき推奨ホットキーがないため **Apply recommended** ボタンはありません。                                                                                                                                                                 |

コマンドグループ名はコマンドリファレンスの該当部分にリンクしています。各コマンドと推奨ホットキーはコマンドリファレンスを参照ください。

### Status 一覧 \{#status}
<SettingsStatus />

<Anchor id="status-exception" />

**例外：** UP / DOWN / HOME / END の 4 つのコマンドでは「For everyone」が割り当てる素のキー (↑、↓、`Home`、`End`) を Status の判定で割り当てとして数えません。素のキーだけが割り当てられている場合も推奨ホットキーが未割り当ての状態として扱い、**Set** / **Override** ボタンが出ます。

**理由：** これらのコマンドは「UP は ↑ と `Ctrl` + `P`」「HOME は `Home` と `Ctrl` + `A`」のように、素のキーと推奨ホットキーの両方を割り当てて使うことを想定しています。もし素のキーを割り当てとして数えると「For everyone」を先に ON にした場合にこれらのコマンドが「割り当て済み (🟢Custom)」と判定され、こちら側の **Apply recommended** や **Set** / **Override** が適用できず、推奨ホットキーの追加割り当てができなくなってしまうためです。

### Individual ボタン一覧 \{#individual}
<Individual />

### Displaced commands (退避されたコマンド) \{#displaced-commands}
<DisplacedCommands />

## Behavior options (挙動オプション)  \{#behavior-options}
各種挙動を調整するトグルボタンです。

同じ名称の設定項目は「For everyone」「Vim mode」「macOS (Emacs) style」で連動していて、一方で ON (または OFF) にすると他方でも連動して ON (または OFF) になります。

| 設定                         | デフォルト | 説明                                                                                                                                                                                                                                                                                    |
| -------------------------- | :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smart&nbsp;home (standard) |  ON   | **ON:** HOME コマンドが先頭の Markdown 記法 (リスト、番号付きリスト、チェックボックス、インデント、引用) の手前、本文テキストの先頭に移動します。Windows の `Home` / macOS の `command` + ← と同様の挙動です。<br/><br/>**OFF:** HOME コマンドは Markdown 記法を考慮せず、行の先頭に直接移動します。macOS / Emacs の `Ctrl` + `A` と同様の挙動です。                                                  |
| Smart&nbsp;home (advanced) |  ON   | **ON:** Smart home (standard) の挙動に加えて、見出し (`#`)、脚注 (`[^1]:`)、コールアウトの種類マーカー (`[!type]`) も追加で考慮します。Smart home (standard) が ON の場合のみ ON にできます。<br/><br/>**OFF:** 見出し行・脚注・コールアウトを考慮しません。(素の `Home` と同等に動作します)                                                                                    |
| Smart join                 |  OFF  | **ON:** Kill line コマンドによる行の結合において、次の行の先頭の Markdown を削除します。<br/>Smart home (standard) が ON である必要があります。<br/>引用マーカー・リストマーカー・インデントを削除するほか、Smart home (advanced) が ON の場合には見出しや脚注も削除します。<br/><br/>**OFF:** 次の行をそのまま結合します。                                                                      |
| Visual line movement       |  ON   | **ON:** 折り返しのある長い行で HOME / END を実行した際、1 段階目は表示行の先頭 / 末尾に移動します。<br/><br/>**OFF:** 折り返し行であっても HOME / END は表示行を考慮しません。HOME は行の先頭 (Smart home 設定により、論理行の先頭または本文テキストの先頭)、END は論理行の末尾に移動します。                                                                                                     |
| Cross-row navigation       |  ON   | テーブル内での LEFT / RIGHT / HOME / END の挙動を調整します。<br/><br/>**ON:** 左端セルの先頭で LEFT / HOME を実行すると、上の行の右端セル末尾に移動します。同様に、右端セル末尾で RIGHT / END を実行すると下の行の左端セル先頭に移動します。<br/>行がない場合にはテーブルの外に脱出します。<br/>(素のキー ← / → の挙動相当です)<br/><br/>**OFF:** LEFT / RIGHT / HOME / END でテーブル行移動せず、左端セル先頭または右端セル末尾で停止します。 |
| Table-aware Source Mode editing | ON | **ON:** ソースモードのテーブル内で、HOME / END、Kill line、Kill region / Copy region、Yank、Delete char、Transpose chars、Uppercase / Lowercase / Capitalize word、Kill word left / right、Select all の各コマンドがテーブル構造 (`\|` / `<br>`) を考慮して動作します。<br/><br/>**OFF:** テーブル行を単純なテキストとして扱い、これらのコマンドはテーブル構造を一切考慮しません。 |

