---
sidebar_position: 2
title: For everyone — 設定
sidebar_label: 設定
description: 設定 → Universal Cursor Hotkeys から各For everyoneキーを有効にする方法と、Used/Conflictステータスバッジの意味。
mode: for-everyone
---

# For everyone — 設定

**設定 → Universal Cursor Hotkeys → For everyone** を開きます。各キーは単純なON/OFFトグルです: ONにするとそのキーが対象コマンドのホットキーに追加されます（既存のホットキーには影響しません）。OFFにすると、そのキーだけが削除されます。

**ステータス:** トグル自体の状態がすでにSet/Availableを表しているため、ステータスバッジが表示されるのは2つの競合ケースのみです:

| ステータス | 意味 |
|--------|---------|
| *(バッジなし)* | トグルON = キーが割り当てられ、上記のアップグレードされた挙動になります。トグルOFF = キーは標準の挙動のままで、割り当て可能な状態です。 |
| 🔴Used | そのキーはすでに別のコマンドで使用されています。空けるまでトグルは無効になります（キーのチップをクリックするとObsidianのHotkeysパネルにジャンプします）。 |
| 🔴Conflict | ここでも割り当てられていますが、他のコマンドにも*まだ*割り当てられている状態です。 |

**Apply all:** 上記のすべてのキーを一括でONにします（すでにONまたは競合しているものはスキップされます）。さらに、下記の[動作オプション](/behavior-options)もすべてONにします — VimモードやEmacs側の各Applyボタンが自分のタブのキー・コマンドしか触らないのとは異なり、これはタブ全体の先頭にあり、「このページの全部をONにする」という位置づけです。
