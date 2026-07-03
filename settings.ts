import { App, Platform, PluginSettingTab, Setting, ToggleComponent, sanitizeHTMLToDom } from 'obsidian';
import type universalCursorHotkeysPlugin from './main';

export class UniversalCursorHotkeysSettingTab extends PluginSettingTab {
	plugin: universalCursorHotkeysPlugin;

	constructor(app: App, plugin: universalCursorHotkeysPlugin) {
		super(app, plugin);
		this.plugin = plugin;
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

		const MAC_SYMBOLS: Record<string, string> = { Ctrl: '⌃', Shift: '⇧', Alt: '⌥', Meta: '⌘', Cmd: '⌘' };
		const BORDER_THIN  = '1px solid var(--background-modifier-border)';
		const BORDER_THICK = '2px solid var(--background-modifier-border)';

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

				const tdKey = tr.createEl('td');
				tdKey.style.cssText = 'padding:2px 8px; white-space:nowrap;';
				if (row.key) {
					const parts = row.key.split('+');
					const hotkeyLabel = Platform.isMacOS
						? parts.slice(0, -1).map(p => MAC_SYMBOLS[p] ?? p).join('') + ' ' + parts[parts.length - 1]
						: row.key;
					const kbd = tdKey.createEl('kbd', { text: hotkeyLabel });
					kbd.style.cssText = 'display:inline-block; background:var(--background-modifier-border); border-radius:var(--radius-s, 4px); padding:1px 6px; font-size:0.85em; font-family:var(--font-interface);';
				} else {
					tdKey.createSpan({ text: '—' }).style.cssText = 'opacity:0.5;';
				}

				const tdCurrent = tr.createEl('td');
				tdCurrent.style.cssText = 'padding:2px 8px; white-space:nowrap;';
				if (row.current) {
					const cParts = row.current.split('+');
					const cLabel = Platform.isMacOS
						? cParts.slice(0, -1).map(p => MAC_SYMBOLS[p] ?? p).join('') + ' ' + cParts[cParts.length - 1]
						: row.current;
					const cKbd = tdCurrent.createEl('kbd', { text: cLabel });
					cKbd.style.cssText = 'display:inline-block; background:var(--background-modifier-border); border-radius:var(--radius-s, 4px); padding:1px 6px; font-size:0.85em; font-family:var(--font-interface);';
				} else {
					tdCurrent.createSpan({ text: '—' }).style.cssText = 'opacity:0.5;';
				}

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

		addBlock('Cursor Movement', [
			{ name: 'UP',    key: 'Ctrl+P', current: '',        status: '⚠️ Conflict: Open command palette', action: 'overwrite' },
			{ name: 'DOWN',  key: 'Ctrl+N', current: '',        status: 'No conflict',                       action: 'set' },
			{ name: 'LEFT',  key: 'Ctrl+B', current: 'Ctrl+B',  status: '✅ Set',                             action: 'done' },
			{ name: 'RIGHT', key: 'Ctrl+F', current: 'Ctrl+U',  status: '⚙️ Custom key',                     action: 'done' },
			{ name: 'HOME',  key: 'Ctrl+A', current: 'Ctrl+A',  status: '✅ Set',                             action: 'done' },
			{ name: 'END',   key: 'Ctrl+E', current: '',        status: 'No conflict',                       action: 'set' },
		]);

		addBlock('Editing', [
			{ name: 'Kill line',   key: 'Ctrl+K', current: 'Ctrl+K', status: '✅ Set',      action: 'done' },
			{ name: 'Kill region', key: 'Ctrl+W', current: '',       status: 'No conflict', action: 'set' },
			{ name: 'Yank',        key: 'Ctrl+Y', current: '',       status: 'No conflict', action: 'set' },
			{ name: 'Delete char', key: 'Ctrl+D', current: '',       status: 'No conflict', action: 'set' },
		]);

		addBlock('Other Hotkeys', [
			{ name: 'Recenter-top-bottom', key: 'Ctrl+L', current: '',  status: 'No conflict',      action: 'set' },
			{ name: 'Recenter',            key: '',        current: '',  status: 'No recommendation', action: 'none' },
			{ name: 'Page down',           key: '',        current: '',  status: 'No recommendation', action: 'none' },
			{ name: 'Page up',             key: '',        current: '',  status: 'No recommendation', action: 'none' },
			{ name: 'Select all',          key: '',        current: '',  status: 'No recommendation', action: 'none' },
		]);

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

		// Sample data rows
		const dispRows = [
			{ command: 'Open command palette', key: 'Ctrl+P', action: 'Assigned to UP' },
			{ command: 'Search current file',  key: 'Ctrl+F', action: 'Assigned to RIGHT' },
			{ command: 'Select all',           key: 'Ctrl+A', action: 'Assigned to HOME' },
		];

		for (const row of dispRows) {
			const tr = dispTbody.createEl('tr');
			tr.style.cssText = `border-bottom:${BORDER_THIN};`;

			tr.createEl('td', { text: row.command })
				.style.cssText = 'padding:2px 8px 2px 40px; white-space:nowrap;';

			const tdKey = tr.createEl('td');
			tdKey.style.cssText = 'padding:2px 8px; white-space:nowrap;';
			const dParts = row.key.split('+');
			const dLabel = Platform.isMacOS
				? dParts.slice(0, -1).map(p => MAC_SYMBOLS[p] ?? p).join('') + ' ' + dParts[dParts.length - 1]
				: row.key;
			const dKbd = tdKey.createEl('kbd', { text: dLabel });
			dKbd.style.cssText = 'display:inline-block; background:var(--background-modifier-border); border-radius:var(--radius-s, 4px); padding:1px 6px; font-size:0.85em; font-family:var(--font-interface);';

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
