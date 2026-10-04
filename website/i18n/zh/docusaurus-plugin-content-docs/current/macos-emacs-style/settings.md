---
sidebar_position: 4
title: macOS (Emacs) style — 设置
sidebar_label: 设置
description: 快捷键的分配方法、设置页面的说明、状态徽章和按钮的含义，以及各行为选项的说明
mode: macos-emacs-style
---
# macOS (Emacs) style — 设置
打开 Obsidian 的 **设置** → 选择第三方插件 **Universal Cursor Hotkeys** → 打开上方标签 **macOS (Emacs) style**。

设置页面大致由 [Hotkey settings（快捷键设置）](/macos-emacs-style/settings#hotkey-settings) 和 [Behavior options（行为选项）](/macos-emacs-style/settings#behavior-options) 两部分构成。

通常插件的快捷键分配会在 Obsidian 标准的快捷键设置页面中进行，但本插件可以在插件设置页面内确认快捷键的分配状态，并一次性应用推荐设置。

## Hotkey settings（快捷键设置） \{#hotkey-settings}
这里共有 5 个命令分组（→[说明](/macos-emacs-style/settings#command-groups)）和 Displaced commands（→[说明](/macos-emacs-style/settings#displaced-commands)），合计 6 个区块。

### Apply recommended 按钮 \{#apply-recommended}
命令分组 Cursor movement / Editing / Other hotkeys 的标题右侧各有一个 **Apply recommended** 按钮，共 3 个。点击后会一次性分配该命令分组的推荐快捷键。

如果是刚安装完毕的 Obsidian，可以直接点击这 3 个 **Apply recommended**。macOS 下初始状态不存在快捷键冲突。在 Windows 下，与推荐快捷键重叠的默认快捷键（例如命令面板的 `Ctrl` + `P`）会被归入 Displaced commands，但这些都可以通过 **Restore** 恢复原状。（→[Displaced commands 说明](/macos-emacs-style/settings#displaced-commands)）

如果你已经自行自定义过快捷键，那么对于仍保留其他快捷键的命令（如 🔵Used 等），被移除的快捷键不会出现在 Displaced commands 中，也无法用 **Restore** 恢复。如果担心这一点，请在点击前先确认各行的 Status。（→[Status 说明](/macos-emacs-style/settings#status)）

一次性分配的对象，是该命令分组中尚未分配任何快捷键的命令（→[有例外](/macos-emacs-style/settings#status-exception)）。已经分配了快捷键的命令（✅Set、🟢Custom）以及没有推荐快捷键的命令（—）不受影响。

如果推荐快捷键正被其他命令占用（🔵Used、🟡Used，或推荐快捷键同时分配给多个其他命令的 🔴Conflict），则会从那些命令中移除推荐快捷键，改为分配给这里的命令。失去所有快捷键的命令会被归入 Displaced commands。

### 页面说明
每个命令分组都是一个包含以下项目的表格。

| 项目 | 说明 |
| --- | --- |
| **Command** | 本插件提供的命令名称。与 Obsidian 标准快捷键设置页面中显示的名称相同。 |
| **Recommended Hotkey** | Emacs 风格的最低限度推荐快捷键。<br/>表示 **Apply recommended** 将会分配的内容。 |
| **Current Hotkey** | 当前已分配的快捷键。如果数量较多，可能会省略部分显示。要查看全部内容，请点击按键标签。 |
| **Status** | 表示该命令的快捷键分配状态。（[后述](/macos-emacs-style/settings#status)） |
| **▶Individual** | 显示用于逐项调整单个命令的操作按钮。（[后述](/macos-emacs-style/settings#individual)）<br/>请点击 **▶Individual** 使该列显示调整用的按钮。（默认不显示） |

点击命令名称或按键标签，会跳转到 Obsidian 标准快捷键设置页面，并以该命令名称或按键筛选。

### 命令分组 \{#command-groups}
本插件提供的命令和表格相关命令，被分为以下 5 个分组显示。

| 命令分组 | 命令数<br/>（其中含推荐快捷键数） | 说明 |
| --- | :---: | --- |
| [Cursor movement](/macos-emacs-style/command-reference#cursor-movement) | 12<br/>（6） | 光标移动相关快捷键列表。<br/>部分命令除此处显示的推荐快捷键外，还会从 For everyone 额外分配快捷键。 |
| [Editing](/macos-emacs-style/command-reference#editing) | 14<br/>（5） | 编辑相关快捷键列表。<br/>部分命令除此处显示的推荐快捷键外，还会从 For everyone 额外分配快捷键。 |
| [Other hotkeys](/macos-emacs-style/command-reference#other-hotkeys) | 2<br/>（1） | 其他快捷键列表。 |
| [Table structure](/macos-emacs-style/command-reference#table-structure) | 16<br/>（无） | 表格结构操作相关快捷键列表。（初始状态为折叠）<br/><br/>此处列出的并非本插件提供的命令，而是为方便起见，以相同格式展示 Obsidian 标准的表格结构操作命令。<br/>同样为方便起见，这里设置了指向 Obsidian 标准快捷键设置页面的链接（以搜索关键词 "表格:" 筛选）。<br/><br/>由于没有需要应用的推荐快捷键，因此没有 **Apply recommended** 按钮。 |
| [Table navigation](/macos-emacs-style/command-reference#table-navigation) | 6<br/>（无） | 表格内移动相关快捷键列表。（初始状态为折叠）<br/><br/>由于没有需要应用的推荐快捷键，因此没有 **Apply recommended** 按钮。 |

命令分组名称链接到命令参考中对应的部分。各命令及其推荐快捷键请参阅命令参考。

### Status 一览 \{#status}

| 状态 | 含义 | Individual 按钮 |
| --- | --- | --- |
| ✅Set | 已分配推荐快捷键。 | Open → |
| 🟢Custom | 已分配非推荐快捷键，且不存在冲突。 | Open → |
| 🔵Available | 推荐快捷键尚未分配，且未被其他命令使用，可以安全分配。 | Set |
| 🔵Used | 推荐快捷键当前正被其他命令使用。<br/>分配推荐快捷键会从该命令中移除此快捷键。（**Override** 按钮）<br/>由于该命令还分配了其他快捷键，移除后该命令仍可正常启动。 | Override |
| 🟡Used | 推荐快捷键当前正被其他命令使用。<br/>分配推荐快捷键会从该命令中移除此快捷键。（**Override** 按钮）<br/>由于该命令仅分配了这一个推荐快捷键，移除后该命令将失去可用于启动的快捷键。<br/>（分配后，该命令会被归入 Displaced commands） | Override |
| 🔴Conflict | 处于冲突状态。<br/>有以下两种情况：<br/><br/>(1) 该命令已分配快捷键，但同一快捷键同时也分配给了其他命令。<br/><br/>(2) 该命令尚未分配快捷键，但推荐快捷键同时分配给了多个其他命令。<br/>通过 **Override** 按钮分配推荐快捷键后，失去所有快捷键的命令会被归入 Displaced commands。 | (1)<br/>Open →<br/><br/>或<br/><br/>(2)<br/>Override |
| — | 没有推荐快捷键，且该命令尚未分配任何快捷键时，显示为 "—"。 | Open → |

<Anchor id="status-exception" />

**例外：** 对于 UP / DOWN / HOME / END 这 4 个命令，判断 Status 时不会将 **For everyone** 分配的原始按键（↑、↓、`Home`、`End`）计入已分配。即使只分配了原始按键，也会视为推荐快捷键尚未分配，显示 **Set** / **Override** 按钮。

**原因：** 这些命令的设计是同时分配原始按键和推荐快捷键一起使用，例如“UP 为 ↑ 和 `Ctrl` + `P`”“HOME 为 `Home` 和 `Ctrl` + `A`”。如果将原始按键计入已分配，那么当先开启 **For everyone** 时，这些命令会被判定为“已分配（🟢Custom）”，导致这一侧的 **Apply recommended** 或 **Set** / **Override** 无法生效，也就无法再额外分配推荐快捷键。

### Individual 按钮一览 \{#individual}
根据快捷键的分配状态，会显示以下 3 种按钮之一，用于执行分配或确认状态。

| Individual 按钮 | 说明 |
| --- | --- |
| **Set** | 推荐快捷键处于空闲状态。<br/>点击 **Set** 按钮即可分配推荐快捷键。 |
| **Override** | 推荐快捷键当前分配给了其他命令，占用中的命令名会以内联形式显示。<br/>点击 **Override** 按钮，会从占用中的命令上移除推荐快捷键，并分配给这个命令。<br/>失去所有快捷键的命令会被归入 Displaced commands。（🟡Used 必定属于这种情况） |
| **Open →** | 跳转到 Obsidian 标准快捷键设置页面，并以该命令名称筛选。 |

### Displaced commands（被移除快捷键的命令） \{#displaced-commands}
这是因应用推荐快捷键而失去了唯一一个快捷键的命令列表。每一项都有用于通过 Obsidian 标准快捷键设置页面重新分配快捷键的 **Assign** 按钮，以及撤销推荐快捷键的分配、将按键归还给原命令的 **Restore** 按钮。

| 项目 | 说明 |
| --- | --- |
| **Command** | 因应用推荐快捷键而失去快捷键的命令名称。点击会打开以该命令名称筛选的 Obsidian 标准快捷键设置页面。 |
| **Assign<br/>按钮** | 与上面相同，打开快捷键设置页面，用于重新分配新的快捷键。 |
| **Hotkey** | 因应用推荐快捷键而失去的快捷键。点击会打开以该按键筛选的 Obsidian 标准快捷键设置页面。 |
| **Displaced by** | 导致 Command 列中的命令被归入 Displaced commands 的原因，即本插件的那个命令名称。点击会打开以该命令名称筛选的 Obsidian 标准快捷键设置页面。<br/>原本是 “Command 的命令 → Hotkey 按键”，<br/>现在变成 “Displaced by 的命令 → Hotkey 按键”<br/>“Command 的命令 → 解除分配”，<br/>也就是 Displaced by 的命令夺走了 Hotkey。 |
| **Restore<br/>按钮** | 当前状态是 “Displaced by 的命令 → Hotkey 按键”，点击后会将其还原为<br/>“Command 的命令 → Hotkey 按键”<br/>“Displaced by 的命令 → 解除分配”，<br/>也就是恢复到 Hotkey 被夺走之前的原始状态。 |

通过这个 **Restore** 按钮，即使在使用 **Apply recommended** 一次性分配之后，也可以相对安全地恢复原来的快捷键状态。

当 Command 列中的命令通过 **Assign** 按钮、**Restore** 按钮或标准快捷键设置页面被分配了快捷键后，会从该表格中消失。这是基于 “只要该命令能够通过某个快捷键启动就没有问题” 的设计理念，并不意味着 “必须分配快捷键才应该让它从表格中消失”。

对于可以用鼠标操作完成、或使用频率较低、从命令面板执行就已足够的命令，让它继续留在 Displaced commands 中也是可以的。

## Behavior options（行为选项） \{#behavior-options}
用于调整各种行为的开关按钮。

**For everyone**、**Vim mode**、**macOS (Emacs) style** 中名称相同的设置项是联动的：在其中一处设为 ON（或 OFF），另一处也会同步变为 ON（或 OFF）。

| 设置 | 默认值 | 说明 |
| --- | :---: | --- |
| Smart&nbsp;home (standard) | ON | **ON：** 按下 HOME 命令会跳过行首的 Markdown 语法（列表、编号列表、复选框、缩进、引用），移动到正文文本的开头。与 Windows 的 `Home` / macOS 的 `command` + ← 行为相同。<br/><br/>**OFF：** HOME 命令不考虑 Markdown 语法，直接移动到行首。与 macOS/Emacs 的 `Ctrl` + `A` 行为相同。 |
| Smart&nbsp;home (advanced) | ON | **ON：** 除 Smart home (standard) 的行为外，还会额外考虑标题（`#`）、脚注（`[^1]:`）、标注类型标记（`[!type]`）。仅当 Smart home (standard) 为 ON 时才能开启。<br/><br/>**OFF：** 不考虑标题行、脚注、标注。（与普通的 `Home` 行为相同） |
| Smart join | OFF | **ON：** 使用 Kill line 命令合并两行时，会删除下一行开头的 Markdown 语法。<br/>需要 Smart home (standard) 为 ON。<br/>除删除引用标记、列表标记、缩进外，若 Smart home (advanced) 为 ON，还会删除标题和脚注。<br/><br/>**OFF：** 直接合并下一行，不做处理。 |
| Visual line movement | ON | **ON：** 在自动换行的长行中执行 HOME / END 时，第一步会先移动到显示行的开头/末尾。<br/><br/>**OFF：** 即使该行会自动换行，HOME / END 也不考虑显示行。HOME 移动到行首（根据 Smart home 设置，为逻辑行首或正文文本开头），END 移动到逻辑行末尾。 |
| Cross-row navigation | ON | 调整表格内 LEFT / RIGHT / HOME / END 的行为。<br/><br/>**ON：** 在最左侧单元格开头执行 LEFT / HOME，会移动到上一行最右侧单元格的末尾。同样，在最右侧单元格末尾执行 RIGHT / END，会移动到下一行最左侧单元格的开头。<br/>如果没有对应的行，则会脱出表格。<br/>（相当于原始按键 ←/→ 的行为）<br/><br/>**OFF：** LEFT / RIGHT / HOME / END 不会跨表格行移动，会停留在最左侧单元格开头或最右侧单元格末尾。 |
