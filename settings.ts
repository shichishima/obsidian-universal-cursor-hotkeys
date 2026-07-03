import { App, Hotkey, Modifier, Platform, PluginSettingTab, Setting, ToggleComponent, sanitizeHTMLToDom } from 'obsidian';
import type universalCursorHotkeysPlugin from './main';

const PLUGIN_ID = 'universal-cursor-hotkeys';

interface CommandDef {
	block: 'cursor' | 'editing' | 'other';
	id: string;
	name: string;
	recommended: Hotkey | null;
}

const ctrl = (...keys: string[]): Hotkey => ({ modifiers: ['Ctrl' as Modifier], key: keys[0] });

const COMMAND_DEFS: readonly CommandDef[] = [
	{ block: 'cursor',  id: 'cursor-up',           name: 'UP',                  recommended: ctrl('P') },
	{ block: 'cursor',  id: 'cursor-down',          name: 'DOWN',                recommended: ctrl('N') },
	{ block: 'cursor',  id: 'cursor-left',          name: 'LEFT',                recommended: ctrl('B') },
	{ block: 'cursor',  id: 'cursor-right',         name: 'RIGHT',               recommended: ctrl('F') },
	{ block: 'cursor',  id: 'cursor-home',          name: 'HOME',                recommended: ctrl('A') },
	{ block: 'cursor',  id: 'cursor-end',           name: 'END',                 recommended: ctrl('E') },
	{ block: 'editing', id: 'kill-line',            name: 'Kill line',           recommended: ctrl('K') },
	{ block: 'editing', id: 'kill-region',          name: 'Kill region',         recommended: ctrl('W') },
	{ block: 'editing', id: 'yank',                 name: 'Yank',                recommended: ctrl('Y') },
	{ block: 'editing', id: 'delete-char',          name: 'Delete char',         recommended: ctrl('D') },
	{ block: 'other',   id: 'recenter-top-bottom',  name: 'Recenter-top-bottom', recommended: ctrl('L') },
	{ block: 'other',   id: 'recenter',             name: 'Recenter',            recommended: null },
	{ block: 'other',   id: 'page-down',            name: 'Page down',           recommended: null },
	{ block: 'other',   id: 'page-up',              name: 'Page up',             recommended: null },
	{ block: 'other',   id: 'select-all',           name: 'Select all',          recommended: null },
];

export class UniversalCursorHotkeysSettingTab extends PluginSettingTab {
	plugin: universalCursorHotkeysPlugin;

	constructor(app: App, plugin: universalCursorHotkeysPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		// Empty the container so Obsidian has nothing stale to restore
		this.containerEl.empty();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderHotkeyManager(containerEl);

		new Setting(containerEl)
			.setName('Visual line movement')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> HOME/END first moves to the visual line edge, then to the logical line start/end.<br>' +
				'<b>OFF:</b> Moves directly to the logical line start/end.'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.visualLineMovement)
				.onChange(async (value) => {
					this.plugin.settings.visualLineMovement = value;
					await this.plugin.saveSettings();
				}));

		let advancedEl: HTMLElement;
		let advancedToggle: ToggleComponent;
		let smartJoinEl: HTMLElement;
		let smartJoinToggle: ToggleComponent;
		const setStandardDisabled = (disabled: boolean) => {
			advancedEl.style.opacity       = disabled ? '0.4' : '';
			advancedEl.style.pointerEvents = disabled ? 'none' : '';
			smartJoinEl.style.opacity       = disabled ? '0.4' : '';
			smartJoinEl.style.pointerEvents = disabled ? 'none' : '';
			if (disabled && this.plugin.settings.smartHomeAdvanced) {
				this.plugin.settings.smartHomeAdvanced = false;
				advancedToggle.setValue(false);
				void this.plugin.saveSettings();
			}
			if (disabled && this.plugin.settings.smartJoin) {
				this.plugin.settings.smartJoin = false;
				smartJoinToggle.setValue(false);
				void this.plugin.saveSettings();
			}
		};

		new Setting(containerEl)
			.setName('Smart home (standard)')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> HOME skips leading Markdown syntax (lists, checkboxes, indents, etc.) to reach content start — Windows Home / macOS Cmd+← style.<br>' +
				'<b>OFF:</b> HOME moves directly to the start of the line — macOS / Emacs Ctrl+A style.'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.smartHomeStandard)
				.onChange(async (value) => {
					this.plugin.settings.smartHomeStandard = value;
					setStandardDisabled(!value);
					await this.plugin.saveSettings();
				}));

		advancedEl = new Setting(containerEl)
			.setName('Smart home (advanced)')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> Also skips past headings (<code>#</code>), footnotes (<code>[^1]:</code>), and callout type markers (<code>[!type]</code>).<br>' +
				'<i>Requires <b>Smart home (standard)</b> to be enabled.</i>'))
			.addToggle(toggle => {
				advancedToggle = toggle;
				toggle.setValue(this.plugin.settings.smartHomeAdvanced)
					.onChange(async (value) => {
						this.plugin.settings.smartHomeAdvanced = value;
						await this.plugin.saveSettings();
					});
			})
			.settingEl;

		smartJoinEl = new Setting(containerEl)
			.setName('Smart join')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> Kill Line join lands at the next line\'s content start, removing blockquote markers, list markers, and indentation. Pairs with Smart home (advanced) for headings and footnotes.<br>' +
				'<b>OFF:</b> Joins the next line as-is.<br>' +
				'<i>Requires <b>Smart home (standard)</b> to be enabled.</i>'))
			.addToggle(toggle => {
				smartJoinToggle = toggle;
				toggle.setValue(this.plugin.settings.smartJoin)
					.onChange(async (value) => {
						this.plugin.settings.smartJoin = value;
						await this.plugin.saveSettings();
					});
			})
			.settingEl;

		setStandardDisabled(!this.plugin.settings.smartHomeStandard);

		new Setting(containerEl)
			.setName('Cross-row navigation')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> LEFT/HOME at the leftmost cell and RIGHT/END at the rightmost cell wrap to the adjacent row.<br>' +
				'<b>OFF:</b> Stops at the boundary.'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.crossRowNavigation)
				.onChange(async (value) => {
					this.plugin.settings.crossRowNavigation = value;
					await this.plugin.saveSettings();
				}));

		containerEl.querySelectorAll<HTMLElement>('.setting-item-name')
			.forEach(el => { el.style.fontWeight = '600'; });
	}

	private renderHotkeyManager(containerEl: HTMLElement): void {
		let visible = true;
		const sectionEls: HTMLElement[] = [];
		const collect = (el: HTMLElement) => sectionEls.push(el);

		// Section header — desc contains the link to Obsidian's hotkeys settings
		new Setting(containerEl)
			.setName('Hotkey Setup Assistant')
			.then(setting => {
				setting.descEl.createSpan({ text: 'Quickly apply recommended hotkeys, group by group or individually.' });
				setting.descEl.createEl('br');
				setting.descEl.createSpan({ text: 'To assign a command to a key other than the recommended hotkey, use ' });
				const hotkeyLink = setting.descEl.createEl('a', { text: "Obsidian's built-in Hotkeys settings" });
				hotkeyLink.style.cssText = 'cursor:pointer;';
				hotkeyLink.addEventListener('click', (e) => {
					e.preventDefault();
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const s = (this.app as any).setting;
					s.open();
					const tab = s.openTabById('hotkeys');
					setTimeout(() => {
						const search = tab?.searchComponent;
						if (search) {
							search.setValue('universal-cursor-hotkeys');
							search.inputEl?.dispatchEvent(new Event('input'));
						}
					}, 0);
				});
				setting.descEl.createSpan({ text: '.' });
			})
			.addButton(btn => btn
				.setButtonText('Hide')
				.onClick(() => {
					visible = !visible;
					btn.setButtonText(visible ? 'Hide' : 'Show');
					for (const el of sectionEls) el.style.display = visible ? '' : 'none';
				}));

		type RowAction = 'overwrite' | 'set' | 'done' | 'none';
		interface HotkeyRow { name: string; key: string; current: string; status: string; action: RowAction }

		const MAC_MOD: Record<string, string> = { Ctrl: '⌃', Shift: '⇧', Alt: '⌥', Meta: '⌘', Mod: '⌘' };
		const WIN_MOD: Record<string, string> = { Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Win', Mod: 'Ctrl' };
		const KBD_CSS = 'display:inline-block; background:var(--background-modifier-border); border-radius:var(--radius-s, 4px); padding:1px 6px; font-size:0.85em; font-family:var(--font-interface);';
		const BORDER_THIN  = '1px solid var(--background-modifier-border)';
		const BORDER_THICK = '2px solid var(--background-modifier-border)';

		// bakedHotkeys stores modifiers as a string, not an array
		type BakedHotkey = { modifiers: string; key: string };
		type AnyHotkey   = { modifiers: string | string[]; key: string };

		const normMods = (mods: string | string[]): string[] =>
			Array.isArray(mods) ? mods : (mods ? mods.split(',') : []);

		const formatHotkey = (hk: AnyHotkey): string => {
			const mods = normMods(hk.modifiers);
			return Platform.isMacOS
				? mods.map(m => MAC_MOD[m] ?? m).join('') + ' ' + hk.key
				: [...mods.map(m => WIN_MOD[m] ?? m), hk.key].join('+');
		};

		// Canonical key for equality checks — sort modifiers, lowercase key
		const hotkeyId = (hk: AnyHotkey): string =>
			normMods(hk.modifiers).sort().join('+') + '+' + hk.key.toLowerCase();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hm = (this.app as any).hotkeyManager;
		// Re-bake so bakedIds/bakedHotkeys reflect the latest user changes
		if (typeof hm.bake === 'function') hm.bake();
		const bakedIds:     string[]      = hm.bakedIds     ?? [];
		const bakedHotkeys: BakedHotkey[] = hm.bakedHotkeys ?? [];

		// Reverse map: hotkeyId → all commandIds using that key
		const reverseMap = new Map<string, string[]>();
		for (let i = 0; i < bakedIds.length; i++) {
			const kid = hotkeyId(bakedHotkeys[i]);
			const list = reverseMap.get(kid);
			if (list) list.push(bakedIds[i]);
			else reverseMap.set(kid, [bakedIds[i]]);
		}

		// Get all hotkeys currently assigned to a command from baked data
		const effectiveHotkeys = (cmdId: string): BakedHotkey[] =>
			bakedIds.reduce<BakedHotkey[]>((acc, id, i) => {
				if (id === cmdId) acc.push(bakedHotkeys[i]);
				return acc;
			}, []);

		const computeRow = (def: CommandDef): HotkeyRow => {
			const fullId = `${PLUGIN_ID}:${def.id}`;
			const currentHotkeys = effectiveHotkeys(fullId);

			if (def.recommended === null) {
				return {
					name: def.name, key: '',
					current: currentHotkeys[0] ? formatHotkey(currentHotkeys[0]) : '',
					status: 'No recommendation', action: 'none',
				};
			}

			const recId  = hotkeyId(def.recommended);
			const recFmt = formatHotkey(def.recommended);
			const hasRec = currentHotkeys.some(hk => hotkeyId(hk) === recId);

			if (hasRec) {
				return { name: def.name, key: recFmt, current: recFmt, status: '✅ Set', action: 'done' };
			}

			if (currentHotkeys.length > 0) {
				return {
					name: def.name, key: recFmt,
					current: formatHotkey(currentHotkeys[0]),
					status: '⚙️ Custom key', action: 'done',
				};
			}

			// Not set — check for conflicts (multiple commands can share the same key)
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const cmds = (this.app as any).commands?.commands;
			const conflictIds = (reverseMap.get(recId) ?? []).filter(id => id !== fullId);
			if (conflictIds.length > 0) {
				const names = conflictIds.map(id => cmds?.[id]?.name ?? id).join(', ');
				const icon = conflictIds.length > 1 ? '🚨' : '⚠️';
				return {
					name: def.name, key: recFmt, current: '',
					status: `${icon} Conflict: ${names}`, action: 'overwrite',
				};
			}

			return { name: def.name, key: recFmt, current: '', status: 'No conflict', action: 'set' };
		};

		let individualVisible = false;
		const allActionBtns: HTMLElement[]    = [];
		const allActionHeaders: HTMLElement[] = [];
		const syncToggle = () => {
			for (const el of allActionBtns)    el.style.visibility = individualVisible ? 'visible' : 'hidden';
			for (const el of allActionHeaders) el.textContent      = individualVisible ? '▼ Individual' : '▶ Individual';
		};

		// Single shared table — all blocks share the same column widths
		const table = containerEl.createEl('table');
		table.style.cssText = 'width:100%; border-collapse:collapse;';
		collect(table);

		let isFirstBlock = true;
		const addBlock = (title: string, rows: HotkeyRow[]) => {
			const tbody = table.createEl('tbody');

			// Title row
			const titleRow = tbody.createEl('tr');
			titleRow.style.cssText = isFirstBlock ? '' : `border-top:${BORDER_THICK};`;
			isFirstBlock = false;
			const titleCell = titleRow.createEl('td');
			titleCell.colSpan = 5;
			titleCell.style.cssText = 'padding:6px 8px;';
			const titleFlex = titleCell.createDiv();
			titleFlex.style.cssText = 'display:flex; align-items:center; gap:10px;';
			titleFlex.createSpan({ text: title }).style.cssText = 'font-weight:600;';
			const setAllBtn = titleFlex.createEl('button', { text: 'Apply recommended' });
			setAllBtn.addClass('mod-cta');
			setAllBtn.style.cssText = 'font-size:0.85em; padding:2px 10px;';
			setAllBtn.addEventListener('click', () => {});

			// Column header row
			const headerRow = tbody.createEl('tr');
			headerRow.style.cssText = `border-bottom:${BORDER_THICK};`;
			for (const [i, h] of (['Command', 'Recommended Hotkey', 'Current Hotkey', 'Status', '▶'] as const).entries()) {
				const td = headerRow.createEl('td', { text: h });
				if (i === 4) {
					td.style.cssText = 'padding:2px 8px; font-size:0.8em; opacity:0.5; text-align:right; cursor:pointer; user-select:none; white-space:nowrap;';
					td.title = 'Toggle individual controls';
					td.textContent = '▶ Individual';
					td.addEventListener('click', () => { individualVisible = !individualVisible; syncToggle(); });
					allActionHeaders.push(td);
				} else {
					td.style.cssText = `padding:2px 8px; font-size:0.8em; opacity:0.5; padding-left:${i === 0 ? '40px' : '8px'};`;
				}
			}

			// Data rows
			for (const row of rows) {
				const tr = tbody.createEl('tr');
				tr.style.cssText = `border-bottom:${BORDER_THIN};`;

				tr.createEl('td', { text: row.name })
					.style.cssText = 'padding:2px 8px 2px 40px; white-space:nowrap;';

				const makeKeyCell = (td: HTMLElement, label: string) => {
					if (label) {
						td.createEl('kbd', { text: label }).style.cssText = KBD_CSS;
					} else {
						td.createSpan({ text: '—' }).style.cssText = 'opacity:0.5;';
					}
				};

				const tdKey = tr.createEl('td');
				tdKey.style.cssText = 'padding:2px 8px; white-space:nowrap;';
				makeKeyCell(tdKey, row.key);

				const tdCurrent = tr.createEl('td');
				tdCurrent.style.cssText = 'padding:2px 8px; white-space:nowrap;';
				makeKeyCell(tdCurrent, row.current);

				tr.createEl('td', { text: row.status })
					.style.cssText = 'padding:2px 8px; font-size:0.9em; width:100%;';

				const tdAction = tr.createEl('td');
				tdAction.style.cssText = 'padding:2px 8px; white-space:nowrap;';
				if (row.action === 'overwrite' || row.action === 'set') {
					const btn = tdAction.createEl('button', {
						text: row.action === 'overwrite' ? 'Override' : 'Set'
					});
					btn.addClass('mod-cta');
					btn.style.cssText = 'font-size:0.75em; padding:0 6px; line-height:1.4; min-width:5em; visibility:hidden;';
					btn.addEventListener('click', () => {});
					allActionBtns.push(btn);
				} else {
					const spacer = tdAction.createEl('button');
					spacer.style.cssText = 'font-size:0.75em; padding:0 6px; line-height:1.4; min-width:5em; visibility:hidden; pointer-events:none;';
				}
			}
		};

		addBlock('Cursor Movement', COMMAND_DEFS.filter(d => d.block === 'cursor').map(computeRow));
		addBlock('Editing',         COMMAND_DEFS.filter(d => d.block === 'editing').map(computeRow));
		addBlock('Other Hotkeys',   COMMAND_DEFS.filter(d => d.block === 'other').map(computeRow));

		// Displaced Commands table
		const dispTable = containerEl.createEl('table');
		dispTable.style.cssText = 'width:100%; border-collapse:collapse; margin-top:1em; margin-bottom:2em;';
		collect(dispTable);

		const dispTbody = dispTable.createEl('tbody');

		// Title row
		const dispTitleRow = dispTbody.createEl('tr');
		const dispTitleCell = dispTitleRow.createEl('td');
		dispTitleCell.colSpan = 4;
		dispTitleCell.style.cssText = 'padding:6px 8px;';
		dispTitleCell.createSpan({ text: 'Displaced Commands' }).style.cssText = 'font-weight:600;';

		// Header row
		const dispHeaderRow = dispTbody.createEl('tr');
		dispHeaderRow.style.cssText = `border-bottom:${BORDER_THICK};`;
		for (const [i, h] of (['Command', 'Hotkey', 'Action', ''] as const).entries()) {
			const td = dispHeaderRow.createEl('td', { text: h });
			td.style.cssText = `padding:2px 8px; font-size:0.8em; opacity:0.5; padding-left:${i === 0 ? '40px' : '8px'};`;
		}

		// Sample displaced rows (replaced with real data in step 3)
		const dispRows: { command: string; hk: Hotkey; action: string }[] = [
			{ command: 'Open command palette', hk: ctrl('P'), action: 'Assigned to UP' },
			{ command: 'Search current file',  hk: ctrl('F'), action: 'Assigned to RIGHT' },
			{ command: 'Select all',           hk: ctrl('A'), action: 'Assigned to HOME' },
		];

		for (const row of dispRows) {
			const tr = dispTbody.createEl('tr');
			tr.style.cssText = `border-bottom:${BORDER_THIN};`;

			tr.createEl('td', { text: row.command })
				.style.cssText = 'padding:2px 8px 2px 40px; white-space:nowrap;';

			const tdKey = tr.createEl('td');
			tdKey.style.cssText = 'padding:2px 8px; white-space:nowrap;';
			tdKey.createEl('kbd', { text: formatHotkey(row.hk) }).style.cssText = KBD_CSS;

			tr.createEl('td', { text: row.action })
				.style.cssText = 'padding:2px 8px; font-size:0.9em; width:100%;';

			const tdBtn = tr.createEl('td');
			tdBtn.style.cssText = 'padding:2px 8px; white-space:nowrap;';
			const restoreBtn = tdBtn.createEl('button', { text: 'Restore' });
			restoreBtn.addClass('mod-warning');
			restoreBtn.style.cssText = 'font-size:0.75em; padding:2px 8px;';
			restoreBtn.addEventListener('click', () => {});
		}
	}

	private setHtmlDesc(setting: Setting, html: string): Setting {
		return setting.setDesc(sanitizeHTMLToDom(html));
	}
}
