---
sidebar_position: 1
title: Command Reference
mode: for-everyone
---

# For everyone — Command Reference

For what each row switches on/off, see [Settings](/for-everyone/settings). This section covers what each key actually does.

## Navigation basics

| Key (macOS) | Key (Windows) | Function Summary |
| :--: | :--: | ----------------- |
| ↑ | ↑ | Column-aware: preserves column position across table row crossings and wrapped cells, instead of getting stuck at a cell boundary. |
| ↓ | ↓ | Column-aware — same as ↑ above. |
| Home | Home | 3-step Smart home: visual line edge → content start (skipping Markdown markers) → line start, table-aware throughout. |
| End | End | Table-aware: moves to the visual line edge or line end, entering/exiting a table cell correctly at its boundary. |
| Page&nbsp;Up | Page&nbsp;Up | Table-aware: scrolls a page while keeping the cursor at the same screen position, including inside wrapped table cells. |
| Page&nbsp;Down | Page&nbsp;Down | Same as Page Up above. |
| Cmd+↑ | Ctrl+Home | Document start — table-aware. |
| Cmd+↓ | Ctrl+End | Document end — table-aware. |

## Word commands

| Key (macOS) | Key (Windows) | Function Summary |
| :--: | :--: | ----------------- |
| Option+→ | Ctrl+→ | Word right — table-aware, CJK-aware (dictionary-based Chinese/Japanese word segmentation). |
| Option+← | Ctrl+← | Word left — table-aware, CJK-aware. |
| Option+⌫ | Ctrl+Backspace | Kill word left — table-aware, CJK-aware; stays within the current cell. |
| Option+⌦ | Ctrl+Delete | Kill word right — table-aware, CJK-aware; stays within the current cell. |

On macOS, the physical Delete key sends Backspace (⌫) — Kill word left uses Option plus that same key. The forward-delete key (⌦) used by Kill word right needs Fn+Delete on keyboards without a dedicated one.
