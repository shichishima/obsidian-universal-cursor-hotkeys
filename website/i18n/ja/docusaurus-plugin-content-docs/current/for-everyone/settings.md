---
sidebar_position: 4
title: For everyone — 設定
sidebar_label: 設定
description: キー挙動強化の適用方法、設定画面の見方、各挙動オプションの説明
mode: for-everyone
---
import ApplyRecommended from '@site/docs/_partials/_settings-apply-recommended.mdx';

import SettingsStatus from '@site/docs/_partials/_settings-status.mdx';

import Individual from '@site/docs/_partials/_settings-individual.mdx';

import DisplacedCommands from '@site/docs/_partials/_displaced-commands.mdx';

import HotkeySettingsTable from '@site/docs/_partials/_settings-hotkey-settings-table.mdx';

# For everyone — 設定

Obsidian の **設定** → コミュニティプラグイン **Universal Cursor Hotkeys** を選択 → 上部タブ **For everyone** を開きます。

設定画面は大きく「[Hotkey settings (ホットキー設定)](/for-everyone/settings#hotkey-settings)」と「[Key upgrades (基本操作のアップグレード)](/for-everyone/settings#key-upgrades)」、「[Behavior options (挙動オプション)](/for-everyone/settings#behavior-options)」で構成されています。

通常、プラグインのホットキー割り当ては Obsidian 標準のホットキー設定画面で行いますが、このプラグインではプラグイン設定画面の中でホットキー割り当て状態の確認と推奨設定の一括割り当てが行えます。

## Hotkey settings (ホットキー設定) \{#hotkey-settings}
ここには 1 つのコマンドグループ (→[解説](/for-everyone/settings#command-groups)) と「Displaced commands」(→[解説](/for-everyone/settings#displaced-commands)) の計 2 つのブロックがあります。

### Apply recommended ボタン \{#apply-recommended}
コマンドグループ Add cursor の見出しの右側に **Apply recommended** ボタンがあります。これを押すとコマンドグループの推奨ホットキーを一括で割り当てます。

<ApplyRecommended />


### 画面の見方
<HotkeySettingsTable />

### コマンドグループ \{#command-groups}
プラグインが提供するコマンドとテーブル関連コマンドを 5 つのグループに分けて表示しています。

| コマンドグループ                                                 | コマンド数<br/>(うち推奨ホットキー数) | 説明                                                                             |
| -------------------------------------------------------- | :-------------------: | ------------------------------------------------------------------------------ |
| [Add cursor](/for-everyone/command-reference#add-cursor) |       2<br/>(2)        | マルチカーソルを追加するホットキーです。<br/>Obsidian 標準にも同様のコマンドがありますが挙動が不安定な場面があるため代替コマンドを用意しました。 |

コマンドグループ名はコマンドリファレンスの該当部分にリンクしています。各コマンドと推奨ホットキーはコマンドリファレンスを参照ください。

### Status 一覧 \{#status}
<SettingsStatus />

### Individual ボタン一覧 \{#individual}
<Individual />

### Displaced commands (退避されたコマンド) \{#displaced-commands}
<DisplacedCommands />

## Key upgrades (キーのアップグレード) \{#key-upgrades}

## Apply all ボタン
これより下にあるすべての設定トグルを ON にします。(Upgrade navigation basics × 8 つ、Upgrade word commands × 4 つ、Behavior options × 6 つ)

ただし、競合可能性があるもの (🔴Used ステータス) はスキップされます。

## Upgrade navigation basics (基本操作のアップグレード)
各キー設定は単純な ON / OFF トグルです。各キー設定の挙動変化の詳細は [キーのアップグレード (基本操作のアップグレード)](/for-everyone/key-upgrades#upgrade-navigation-basics) を参照してください。

ON にするとそのキーが対象コマンドのホットキーに追加されます。すでに対象コマンドにホットキーが割り当てられている場合は、それらはそのままに、このキーが追加登録されます。

OFF にするとそのキーの割り当てだけが削除されます。他のホットキー割り当ては変化しません。

### 各設定行の見方 \{#setting-status}

| ステータス      | トグル              | 意味                                                                                                                                                               |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (表示なし)     | OFF              | キーは標準挙動そのままで変更されていません。アップグレード挙動が割り当て可能な状態です。                                                                                                                     |
| (表示なし)     | ON               | キーがこのプラグインのアップグレード挙動に割り当てられています。                                                                                                                                 |
| 🔴Used     | OFF<br/>(disable) | このキーはすでに別のコマンドで使用されています。このため、このコマンドを追加で割り当てることができません。(ON にすることはできません)<br/>キーチップあるいはステータスをクリックすると Obsidian のホットキー設定画面に遷移するので、そこで割り当て中のコマンドを確認してください。               |
| 🔴Conflict | ON               | このキーにはアップグレードコマンドとそれ以外のコマンドの両方が割り当てられていて、現状すでに競合状態です。<br/>キーチップあるいはステータスをクリックしてホットキー設定画面に移動し、競合状態を整理してください。なおトグルスイッチを OFF にすると 🔴Used ステータスに変化し、そのままでは ON にできません。 |

## Upgrade word commands (単語操作のアップグレード)
各キー設定は単純な ON / OFF トグルです。各キー設定の挙動変化の詳細は [キーのアップグレード (単語操作のアップグレード)](/for-everyone/key-upgrades#upgrade-word-commands) を参照してください。

### 各設定行の見方
[(同上)](/for-everyone/settings#setting-status)

## Behavior options (挙動オプション) \{#behavior-options}
各種挙動を調整するトグルボタンです。

同じ名称の設定項目は「For everyone」「Vim mode」「macOS (Emacs) style」で連動していて、一方で ON (または OFF) にすると他方でも連動して ON (または OFF) になります。

| 設定                         | デフォルト | 説明                                                                                                                                                                                                                                          |
| -------------------------- | :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smart&nbsp;home (standard) |  ON   | **ON:** `Home` キーが先頭の Markdown 記法 (リスト、番号付きリスト、チェックボックス、インデント、引用) の手前、本文テキストの先頭に移動します。Windows の `Home` / macOS の `command` + ← と同様の挙動です。<br/><br/>**OFF:** `Home` キーは Markdown 記法を考慮せず、行の先頭に直接移動します。macOS / Emacs の `Ctrl` + `A` と同様の挙動です。       |
| Smart&nbsp;home (advanced) |  ON   | **ON:** Smart home (standard) の挙動に加えて、見出し (`#`)、脚注 (`[^1]:`)、コールアウトの種類マーカー (`[!type]`) も追加で考慮します。Smart home (standard) が ON の場合のみ ON にできます。<br/><br/>**OFF:** 見出し行・脚注・コールアウトを考慮しません。(素の `Home` と同等に論理行頭に移動します)                                         |
| Visual line movement       |  ON   | **ON:** 折り返しのある長い行で `Home` / `End` を押した際、1 段階目は表示行の先頭 / 末尾に移動します。<br/><br/>**OFF:** 折り返し行であっても `Home` / `End` は表示行を考慮しません。`Home` は行の先頭 (Smart home 設定により、論理行の先頭または本文テキストの先頭)、`End` は論理行の末尾に移動します。                                                 |
| Cross-row navigation       |  ON   | テーブル内での `Home` / `End` の挙動を調整します。<br/><br/>**ON:** 左端セルの先頭で `Home` を押すと、上の行の右端セル末尾に移動します。同様に、右端セル末尾で `End` を押すと下の行の左端セル先頭に移動します。<br/>行がない場合にはテーブルの外に脱出します。<br/>(← / → の挙動相当です)<br/><br/>**OFF:** `Home` / `End` でテーブル行移動せず、左端セル先頭または右端セル末尾で停止します。 |
| Double-click word select   |  ON   | マウスのダブルクリックによる単語選択の挙動を調整します。<br/><br/>**ON:** 辞書ベース単語分割により、マウスダブルクリック時に日本語の単語単位で範囲選択します。<br/>ダブルクリック後にドラッグすると、単語単位で選択範囲が拡張します。<br/><br/>**OFF:** Obsidian 標準のダブルクリック挙動です。日本語は漢字ひらがなを区別せずひとまとまりで選択されます。                                           |
| Table-aware Source Mode editing | ON | **ON:** ソースモードのテーブル内で、HOME / END、Kill line、Kill region / Copy region、Yank、Delete char、Transpose chars、Uppercase / Lowercase / Capitalize word、Kill word left / right、Select all の各コマンドがテーブル構造 (`\|` / `<br>`) を考慮して動作します。<br/><br/>**OFF:** テーブル行を単純なテキストとして扱い、これらのコマンドはテーブル構造を一切考慮しません。 |
