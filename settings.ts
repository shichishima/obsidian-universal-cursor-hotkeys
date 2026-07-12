import { App, ButtonComponent, Hotkey, Modifier, Platform, PluginSettingTab, Setting, ToggleComponent, sanitizeHTMLToDom } from 'obsidian';
import type universalCursorHotkeysPlugin from './main';

const PLUGIN_ID = 'universal-cursor-hotkeys';

export interface CommandDef {
	block: 'cursor' | 'editing' | 'other';
	id: string;
	name: string;
	recommended: Hotkey | null;
}

export type RowAction = 'override' | 'set' | 'done' | 'none';
export interface HotkeyRow { name: string; key: string; current: string; extraCount: number; status: string; conflictIds: string[]; action: RowAction }
export type BakedHotkey = { modifiers: string; key: string };
export type AnyHotkey   = { modifiers: string | string[]; key: string };

// Obsidian internal APIs — not exposed in obsidian.d.ts
interface HotkeyManager {
	bake(): void;
	save(): void;
	bakedIds:     string[];
	bakedHotkeys: BakedHotkey[];
	setHotkeys(commandId: string, hotkeys: Hotkey[]): void;
}
interface HotkeySettingTab {
	searchComponent?: { setValue(v: string): void; inputEl?: HTMLInputElement };
	setActiveHotkeyFilter?(filter: { modifiers: string[]; key: string }): void;
	setHotkeyFilter?(filter: { modifiers: string[]; key: string }): void;
}
interface ObsidianInternals {
	hotkeyManager: HotkeyManager;
	commands?: { commands: Record<string, { name: string }> };
	setting: {
		open(): void;
		openTabById(id: string): HotkeySettingTab | null;
	};
}

const MAC_MOD:  Record<string, string> = { Ctrl: '⌃', Shift: '⇧', Alt: '⌥', Meta: '⌘', Mod: '⌘' };
const WIN_MOD:  Record<string, string> = { Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Win', Mod: 'Ctrl' };
const KEY_DISP: Record<string, string> = { PageDown: 'Page Down', PageUp: 'Page Up' };

export const normMods = (mods: string | string[]): string[] =>
	Array.isArray(mods) ? mods : (mods ? mods.split(',') : []);

export const hotkeyId = (hk: AnyHotkey): string =>
	normMods(hk.modifiers).sort().join('+') + '+' + hk.key.toLowerCase();

export const formatHotkey = (hk: AnyHotkey, isMacOS = Platform.isMacOS): string => {
	const mods = normMods(hk.modifiers);
	const key  = KEY_DISP[hk.key] ?? hk.key;
	return isMacOS
		? mods.map(m => MAC_MOD[m] ?? m).join('') + ' ' + key
		: [...mods.map(m => WIN_MOD[m] ?? m), key].join('+');
};

const SPECIAL_KEY_EXCEPTION: Partial<Record<string, string>> = {
	'cursor-home': 'Home',
	'cursor-end':  'End',
	'page-up':     'PageUp',
	'page-down':   'PageDown',
};

export const selectCurrentChips = (
	allHks: BakedHotkey[],
	recommended: Hotkey | null,
	exKey: string | undefined,
): { chips: BakedHotkey[]; remaining: BakedHotkey[] } => {
	const recHkId = recommended ? hotkeyId(recommended) : null;

	const modifiedCand = recHkId
		? allHks.find(hk => hotkeyId(hk) === recHkId) ?? allHks.find(hk => normMods(hk.modifiers).length > 0)
		: allHks.find(hk => normMods(hk.modifiers).length > 0);
	const bareCand = exKey
		? allHks.find(hk => normMods(hk.modifiers).length === 0 && hk.key === exKey) ?? allHks.find(hk => normMods(hk.modifiers).length === 0)
		: allHks.find(hk => normMods(hk.modifiers).length === 0);

	const shownSet = new Set([
		modifiedCand ? hotkeyId(modifiedCand) : null,
		bareCand     ? hotkeyId(bareCand) : null,
	].filter((x): x is string => x !== null));
	const remaining = allHks.filter(hk => !shownSet.has(hotkeyId(hk)));

	const chips = (recommended !== null
		? [modifiedCand, bareCand]
		: [bareCand, modifiedCand]
	).filter((hk): hk is BakedHotkey => hk != null);

	return { chips, remaining };
};

export const computeRow = (
	def: CommandDef,
	effectiveHotkeys: (cmdId: string) => BakedHotkey[],
	reverseMap: Map<string, string[]>,
	cmds: Record<string, { name: string }> | undefined,
): HotkeyRow => {
	const fullId = `${PLUGIN_ID}:${def.id}`;
	const allCurrentHotkeys = effectiveHotkeys(fullId);
	const exceptionKey = SPECIAL_KEY_EXCEPTION[def.id];
	const currentHotkeys = exceptionKey
		? allCurrentHotkeys.filter(hk => !(normMods(hk.modifiers).length === 0 && hk.key === exceptionKey))
		: allCurrentHotkeys;

	if (def.recommended === null) {
		if (allCurrentHotkeys.length > 0) {
			return {
				name: def.name, key: '',
				current: formatHotkey(allCurrentHotkeys[0]),
				extraCount: allCurrentHotkeys.length - 1,
				status: '🟢Custom', conflictIds: [], action: 'done',
			};
		}
		return {
			name: def.name, key: '',
			current: '', extraCount: 0,
			status: '—', conflictIds: [], action: 'none',
		};
	}

	const recId  = hotkeyId(def.recommended);
	const recFmt = formatHotkey(def.recommended);
	const hasRec = currentHotkeys.some(hk => hotkeyId(hk) === recId);

	if (hasRec) {
		const conflictIds = (reverseMap.get(recId) ?? []).filter(id => id !== fullId && cmds?.[id] !== undefined);
		if (conflictIds.length > 0) {
			return { name: def.name, key: recFmt, current: recFmt, extraCount: allCurrentHotkeys.length - 1, status: '🔴Conflict: ', conflictIds, action: 'done' };
		}
		return { name: def.name, key: recFmt, current: recFmt, extraCount: allCurrentHotkeys.length - 1, status: '✅Set', conflictIds: [], action: 'done' };
	}

	if (currentHotkeys.length > 0) {
		return {
			name: def.name, key: recFmt,
			current: formatHotkey(currentHotkeys[0]),
			extraCount: allCurrentHotkeys.length - 1,
			status: '🟢Custom', conflictIds: [], action: 'done',
		};
	}

	const currentDisplay = allCurrentHotkeys[0] ? formatHotkey(allCurrentHotkeys[0]) : '';
	const extraCount = Math.max(0, allCurrentHotkeys.length - 1);

	const conflictIds = (reverseMap.get(recId) ?? []).filter(id => id !== fullId && cmds?.[id] !== undefined);
	if (conflictIds.length >= 2) {
		return { name: def.name, key: recFmt, current: currentDisplay, extraCount, status: '🔴Conflict: ', conflictIds, action: 'override' };
	}
	if (conflictIds.length === 1) {
		const displaced = effectiveHotkeys(conflictIds[0]).length === 1;
		const status = displaced ? '🟡Used: ' : '🔵Used: ';
		return { name: def.name, key: recFmt, current: currentDisplay, extraCount, status, conflictIds, action: 'override' };
	}

	return { name: def.name, key: recFmt, current: currentDisplay, extraCount, status: '🔵Available', conflictIds: [], action: 'set' };
};

const ctrl = (...keys: string[]): Hotkey => ({ modifiers: ['Ctrl'], key: keys[0] });

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

export interface DisplacedCommand {
	commandId:      string;
	commandName:    string;
	hotkey:         Hotkey;
	uchCommandId:   string;
	uchCommandName: string;
}

interface RenderCtx {
	hm: HotkeyManager;
	effectiveHotkeys: (id: string) => BakedHotkey[];
	cmds: Record<string, { name: string }> | undefined;
	applyEntry: (def: CommandDef, row: HotkeyRow) => void;
	applyBlock: (entries: Array<{def: CommandDef; row: HotkeyRow}>) => void;
	allActionBtns: HTMLElement[];
	allActionHeaders: HTMLElement[];
	allOverrideNotes: HTMLElement[];
	syncToggle: () => void;
}

export class UniversalCursorHotkeysSettingTab extends PluginSettingTab {
	plugin: universalCursorHotkeysPlugin;
	private get individualVisible() { return this.plugin.settings.qsaIndividualVisible; }
	private set individualVisible(v: boolean) { this.plugin.settings.qsaIndividualVisible = v; void this.plugin.saveSettings(); }
	private get sectionVisible() { return this.plugin.settings.qsaSectionVisible; }
	private set sectionVisible(v: boolean) { this.plugin.settings.qsaSectionVisible = v; void this.plugin.saveSettings(); }

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

	}

	private openHotkeysPanelFor(query: string): void {
		const s = (this.app as unknown as ObsidianInternals).setting;
		s.open();
		const tab = s.openTabById('hotkeys');
		window.setTimeout(() => {
			const search = tab?.searchComponent;
			if (search) {
				search.setValue(query);
				search.inputEl?.dispatchEvent(new Event('input'));
			}
		}, 0);
	}

	private openHotkeysPanelByKey(hk: AnyHotkey): void {
		const s = (this.app as unknown as ObsidianInternals).setting;
		s.open();
		const tab = s.openTabById('hotkeys');
		const mods = normMods(hk.modifiers);
		const filterArg = { modifiers: mods, key: hk.key };
		window.setTimeout(() => {
			if (typeof tab?.setActiveHotkeyFilter === 'function') {
				// Obsidian 1.13+
				tab.setActiveHotkeyFilter(filterArg);
			} else if (typeof tab?.setHotkeyFilter === 'function') {
				// Obsidian 1.12
				tab.setHotkeyFilter(filterArg);
			}
		}, 0);
	}

	private makeKeyCell(td: HTMLElement, label: string, onClick?: () => void): void {
		if (label) {
			const kbd = td.createEl('kbd', { text: label, cls: 'uch-kbd' });
			if (onClick) {
				kbd.addClass('uch-kbd-link');
				kbd.addEventListener('click', onClick);
			}
		} else {
			td.createSpan({ text: '—', cls: 'uch-empty-dash' });
		}
	}

	private renderDataRow(tbody: HTMLElement, def: CommandDef, row: HotkeyRow, ctx: RenderCtx): void {
		const tr = tbody.createEl('tr');
		tr.addClass('uch-row-thin');

		const tdName = tr.createEl('td', { cls: 'uch-cell-name' });
		const fullId = `${PLUGIN_ID}:${def.id}`;
		const openHotkeysPanel = () => this.openHotkeysPanelFor(ctx.cmds?.[fullId]?.name ?? def.name);
		const nameLink = tdName.createEl('a', { text: row.name, cls: 'uch-cmd-link' });
		nameLink.addEventListener('click', (e) => { e.preventDefault(); openHotkeysPanel(); });

		const tdKey = tr.createEl('td', { cls: 'uch-cell-key' });
		this.makeKeyCell(tdKey, row.key, def.recommended ? () => this.openHotkeysPanelByKey(def.recommended!) : undefined);

		const tdCurrent = tr.createEl('td', { cls: 'uch-cell-key' });
		const currentWrap = tdCurrent.createDiv({ cls: 'uch-key-stack' });
		const allHks = ctx.effectiveHotkeys(fullId);
		const { chips, remaining: chipRemaining } = selectCurrentChips(
			allHks, def.recommended, SPECIAL_KEY_EXCEPTION[def.id],
		);

		if (chips.length === 0) {
			currentWrap.createSpan({ text: '—', cls: 'uch-empty-dash' });
		} else {
			for (const hk of chips) {
				this.makeKeyCell(currentWrap, formatHotkey(hk), () => this.openHotkeysPanelByKey(hk));
			}
			if (chipRemaining.length > 0) {
				currentWrap.createEl('a', { text: `+${chipRemaining.length} more`, cls: 'uch-more-link' })
					.addEventListener('click', (e) => { e.preventDefault(); openHotkeysPanel(); });
			}
		}

		const tdStatus = tr.createEl('td', { cls: 'uch-cell-status' });
		if (row.conflictIds.length > 0) {
			tdStatus.createSpan({ text: row.status });
			for (const [i, conflictId] of row.conflictIds.entries()) {
				if (i > 0) tdStatus.createSpan({ text: ', ' });
				const conflictName = ctx.cmds?.[conflictId]?.name ?? conflictId;
				tdStatus.createEl('a', { text: conflictName, cls: 'uch-cmd-link' })
					.addEventListener('click', (e) => { e.preventDefault(); this.openHotkeysPanelFor(conflictName); });
			}
		} else {
			tdStatus.setText(row.status);
		}

		const tdAction = tr.createEl('td', { cls: 'uch-cell-action' });
		if (row.action === 'override' || row.action === 'set') {
			const btn = tdAction.createEl('button', {
				text: row.action === 'override' ? 'Override' : 'Set'
			});
			btn.addClass('mod-cta', 'uch-set-btn');
			if (row.action === 'override') {
				btn.addClass('uch-override-btn');
				btn.addEventListener('mouseenter', () => tbody.addClass('uch-override-active'));
				btn.addEventListener('mouseleave', () => tbody.removeClass('uch-override-active'));
			}
			btn.addEventListener('click', () => {
				ctx.applyEntry(def, row);
				ctx.hm.save();
				ctx.hm.bake();
				void this.plugin.saveSettings();
				this.display();
			});
			ctx.allActionBtns.push(btn);
		} else if (row.action === 'done') {
			const btn = tdAction.createEl('button', { text: 'Open →' });
			btn.addClass('uch-open-btn');
			btn.addEventListener('click', () => openHotkeysPanel());
			ctx.allActionBtns.push(btn);
		} else {
			tdAction.createEl('button', { cls: 'uch-set-btn-spacer' });
		}
	}

	private renderBlock(table: HTMLElement, title: string, entries: Array<{def: CommandDef; row: HotkeyRow}>, ctx: RenderCtx): void {
		const tbody = table.createEl('tbody');

		// Title row
		const titleRow = tbody.createEl('tr');
		const titleCell = titleRow.createEl('td');
		titleCell.colSpan = 5;
		titleCell.addClass('uch-title-cell');
		const titleFlex = titleCell.createDiv('uch-title-flex');
		titleFlex.createSpan({ text: title, cls: 'uch-title-text' });
		const setAllBtn = titleFlex.createEl('button', { text: 'Apply recommended' });
		setAllBtn.addClass('mod-cta', 'uch-apply-btn');
		if (!entries.some(e => e.row.action === 'set' || e.row.action === 'override'))
			setAllBtn.disabled = true;
		setAllBtn.addEventListener('click', () => { ctx.applyBlock(entries); });

		// Column header row
		const headerRow = tbody.createEl('tr');
		headerRow.addClass('uch-row-thick');
		for (const [i, h] of (['Command', 'Recommended Hotkey', 'Current Hotkey', 'Status', '▶'] as const).entries()) {
			const td = headerRow.createEl('td', { text: h });
			if (i === 4) {
				td.addClass('uch-col-header', 'uch-col-header-action');
				td.title = 'Toggle individual controls';
				td.textContent = '▶ Individual';
				td.addEventListener('click', () => { this.individualVisible = !this.individualVisible; ctx.syncToggle(); });
				ctx.allActionHeaders.push(td);
			} else {
				td.addClass('uch-col-header');
				if (i === 0) td.addClass('uch-col-header-first');
			}
		}

		// Data rows
		for (const { def, row } of entries) {
			this.renderDataRow(tbody, def, row, ctx);
		}

		if (entries.some(e => e.row.action === 'override')) {
			const noteRow = tbody.createEl('tr');
			const noteTd = noteRow.createEl('td', { cls: 'uch-override-note' });
			noteTd.colSpan = 5;
			noteTd.appendText('"');
			noteTd.createEl('strong', { text: 'Override', cls: 'uch-override-word' });
			noteTd.appendText('" reassigns the hotkey to this plugin\'s command, removing it from the command currently using it. Commands left with no remaining hotkeys appear in Displaced commands below.');
			ctx.allOverrideNotes.push(noteRow);
		}

		const spacerTd = tbody.createEl('tr').createEl('td', { cls: 'uch-block-spacer' });
		spacerTd.colSpan = 5;
	}

	private renderHotkeyManager(containerEl: HTMLElement): void {
		const sectionEls: HTMLElement[] = [];
		const collect = (el: HTMLElement) => sectionEls.push(el);
		let showHideBtn: ButtonComponent;

		// Section header — desc contains the link to Obsidian's hotkeys settings
		new Setting(containerEl)
			.setName('Quick setup assistant')
			.then(setting => {
				setting.descEl.createSpan({ text: 'No hotkeys are assigned by default. Set only the commands you want — group by group, or ' });
				const indivLink = setting.descEl.createEl('a', { text: 'Individually', cls: 'uch-inline-link' });
				indivLink.addEventListener('click', (e) => {
					e.preventDefault();
					if (!this.sectionVisible) {
						this.sectionVisible = true;
						showHideBtn.setButtonText('Hide');
						for (const el of sectionEls) el.removeClass('uch-hidden');
					}
					this.individualVisible = true;
					syncToggle();
				});
				setting.descEl.createSpan({ text: '.' });
				setting.descEl.createEl('br');
				setting.descEl.createSpan({ text: 'To assign a command to a key other than the recommended, use ' });
				const hotkeyLink = setting.descEl.createEl('a', { text: "Obsidian's built-in hotkeys settings" });
				hotkeyLink.addClass('uch-inline-link');
				hotkeyLink.addEventListener('click', (e) => {
					e.preventDefault();
					this.openHotkeysPanelFor('universal-cursor-hotkeys');
				});
				setting.descEl.createSpan({ text: '.' });
				})
			.addButton(btn => {
				showHideBtn = btn;
				btn.setButtonText(this.sectionVisible ? 'Hide' : 'Show');
				btn.onClick(() => {
					this.sectionVisible = !this.sectionVisible;
					btn.setButtonText(this.sectionVisible ? 'Hide' : 'Show');
					for (const el of sectionEls) el.toggleClass('uch-hidden', !this.sectionVisible);
				});
			});

		const app = this.app as unknown as ObsidianInternals;
		const hm  = app.hotkeyManager;
		// Re-bake so bakedIds/bakedHotkeys reflect the latest user changes
		hm.bake();
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

		const cmds = app.commands?.commands;

		const toHotkey = (hk: BakedHotkey): Hotkey => ({
			modifiers: normMods(hk.modifiers) as Modifier[],
			key: hk.key,
		});

		// Remove displaced commands whose original command now has any hotkey assigned
		this.plugin.settings.qsaDisplacedCommands = this.plugin.settings.qsaDisplacedCommands.filter(
			d => effectiveHotkeys(d.commandId).length === 0
		);

		const applyEntry = (def: CommandDef, row: HotkeyRow) => {
			const fullId = `${PLUGIN_ID}:${def.id}`;
			const recId  = hotkeyId(def.recommended!);
			if (row.action === 'override') {
				for (const conflictId of (reverseMap.get(recId) ?? []).filter(id => id !== fullId)) {
					hm.setHotkeys(conflictId,
						effectiveHotkeys(conflictId).filter(hk => hotkeyId(hk) !== recId).map(toHotkey));
					if (!this.plugin.settings.qsaDisplacedCommands.some(d => d.commandId === conflictId && hotkeyId(d.hotkey) === recId)) {
						this.plugin.settings.qsaDisplacedCommands.push({
							commandId:      conflictId,
							commandName:    cmds?.[conflictId]?.name ?? conflictId,
							hotkey:         def.recommended!,
							uchCommandId:   def.id,
							uchCommandName: def.name,
						});
					}
				}
			}
			hm.setHotkeys(fullId, [...effectiveHotkeys(fullId).map(toHotkey), def.recommended!]);
		};

		const applyBlock = (entries: Array<{def: CommandDef; row: HotkeyRow}>) => {
			for (const { def, row } of entries) {
				if (row.action !== 'set' && row.action !== 'override') continue;
				applyEntry(def, row);
			}
			hm.save();
			hm.bake();
			void this.plugin.saveSettings();
			this.display();
		};

		const restoreDisplaced = (d: DisplacedCommand) => {
			const dId = hotkeyId(d.hotkey);
			const uchFullId = `${PLUGIN_ID}:${d.uchCommandId}`;
			hm.setHotkeys(uchFullId,
				effectiveHotkeys(uchFullId).filter(hk => hotkeyId(hk) !== dId).map(toHotkey));
			hm.setHotkeys(d.commandId,
				[...effectiveHotkeys(d.commandId).map(toHotkey), d.hotkey]);
			this.plugin.settings.qsaDisplacedCommands = this.plugin.settings.qsaDisplacedCommands.filter(x => x !== d);
			hm.save();
			hm.bake();
			void this.plugin.saveSettings();
			this.display();
		};

		const allActionBtns: HTMLElement[]    = [];
		const allActionHeaders: HTMLElement[] = [];
		const allOverrideNotes: HTMLElement[] = [];
		const syncToggle = () => {
			for (const el of allActionBtns)    el.toggleClass('uch-vis-hidden', !this.individualVisible);
			for (const el of allActionHeaders) el.textContent = this.individualVisible ? '▼ Individual' : '▶ Individual';
			for (const el of allOverrideNotes) el.toggleClass('uch-hidden', !this.individualVisible);
		};

		const ctx: RenderCtx = { hm, effectiveHotkeys, cmds, applyEntry, applyBlock, allActionBtns, allActionHeaders, allOverrideNotes, syncToggle };

		// Single shared table — all blocks share the same column widths
		const table = containerEl.createEl('table');
		table.addClass('uch-table');
		collect(table);

		const makeEntries = (block: CommandDef['block']) =>
			COMMAND_DEFS.filter(d => d.block === block).map(def => ({ def, row: computeRow(def, effectiveHotkeys, reverseMap, cmds) }));

		this.renderBlock(table, 'Cursor movement', makeEntries('cursor'), ctx);
		this.renderBlock(table, 'Editing',         makeEntries('editing'), ctx);
		this.renderBlock(table, 'Other hotkeys',   makeEntries('other'), ctx);
		syncToggle();

		// Displaced commands table
		const dispTable = containerEl.createEl('table', { cls: 'uch-disp-table' });
		collect(dispTable);

		const dispTbody = dispTable.createEl('tbody');

		// Title row
		const dispTitleCell = dispTbody.createEl('tr').createEl('td', { cls: 'uch-title-cell' });
		dispTitleCell.colSpan = 5;
		dispTitleCell.createSpan({ text: 'Displaced commands', cls: 'uch-title-text' });

		// Description row
		const dispDescTd = dispTbody.createEl('tr').createEl('td', { cls: 'uch-disp-desc' });
		dispDescTd.colSpan = 5;
		const dispDescList = dispDescTd.createEl('ul');
		for (const text of [
			'Commands left with no hotkeys after Override are listed here.',
			'Click a command name or use Assign to open Hotkeys settings and reassign a hotkey.',
			'Commands still reachable via Command Palette or mouse can safely be left as-is.',
		]) {
			dispDescList.createEl('li', { text });
		}

		// Header row
		const dispHeaderRow = dispTbody.createEl('tr');
		dispHeaderRow.addClass('uch-row-thick');
		for (const [i, h] of (['Command', '', 'Hotkey', 'Displaced by', ''] as const).entries()) {
			const td = dispHeaderRow.createEl('td', { text: h, cls: 'uch-col-header' });
			if (i === 0) td.addClass('uch-col-header-first');
		}

		for (const d of this.plugin.settings.qsaDisplacedCommands) {
			const tr = dispTbody.createEl('tr');
			tr.addClass('uch-row-thin');
			const dispName = tr.createEl('td', { cls: 'uch-cell-name' })
				.createEl('a', { text: d.commandName, cls: 'uch-cmd-link uch-disp-name' });
			dispName.addEventListener('click', (e) => { e.preventDefault(); this.openHotkeysPanelFor(d.commandName); });
			const assignBtn = tr.createEl('td', { cls: 'uch-cell-action' })
				.createEl('button', { text: 'Assign' });
			assignBtn.addClass('mod-cta', 'uch-restore-btn', 'uch-assign-btn');
			assignBtn.addEventListener('click', () => { this.openHotkeysPanelFor(d.commandName); });
			const addDispHover    = () => tr.addClass('uch-disp-hover');
			const removeDispHover = () => tr.removeClass('uch-disp-hover');
			dispName.addEventListener('mouseenter', addDispHover);
			dispName.addEventListener('mouseleave', removeDispHover);
			assignBtn.addEventListener('mouseenter', addDispHover);
			assignBtn.addEventListener('mouseleave', removeDispHover);
			const tdKey = tr.createEl('td', { cls: 'uch-cell-key' });
			const dispKbd = tdKey.createEl('kbd', { text: formatHotkey(d.hotkey), cls: 'uch-kbd' });
			dispKbd.addClass('uch-kbd-link');
			dispKbd.addEventListener('click', () => this.openHotkeysPanelByKey(d.hotkey));
			tr.createEl('td', { cls: 'uch-cell-status' })
				.createEl('a', { text: d.uchCommandName, cls: 'uch-cmd-link' })
				.addEventListener('click', (e) => { e.preventDefault(); this.openHotkeysPanelFor(d.uchCommandName); });
			const restoreBtn = tr.createEl('td', { cls: 'uch-cell-action' })
				.createEl('button', { text: 'Restore' });
			restoreBtn.addClass('mod-warning', 'uch-restore-btn');
			restoreBtn.addEventListener('click', () => { restoreDisplaced(d); });
		}

		if (this.plugin.settings.qsaDisplacedCommands.length === 0) {
			const noDisp = dispTbody.createEl('tr', { cls: 'uch-row-thin' }).createEl('td', { text: 'No displaced commands.', cls: 'uch-no-displaced' });
			noDisp.colSpan = 5;
		}

		// Special Key Assignments
		const SPECIAL_DEFS: Array<{ label: string; commandId: string; key: string }> = [
			{ label: 'Set Home',      commandId: 'cursor-home', key: 'Home'     },
			{ label: 'Set End',       commandId: 'cursor-end',  key: 'End'      },
			{ label: 'Set Page Down', commandId: 'page-down',   key: 'PageDown' },
			{ label: 'Set Page Up',   commandId: 'page-up',     key: 'PageUp'   },
		];

		const specialEl = containerEl.createDiv({ cls: 'uch-special-section' });
		specialEl.createDiv({ text: 'Special key assignments', cls: 'uch-special-title' });
		specialEl.createDiv({
			text: "These keys cannot be set in Obsidian's hotkeys panel. Assign them here.",
			cls: 'uch-special-desc',
		});

		const specialBtnRow = specialEl.createDiv({ cls: 'uch-special-btns' });
		for (const def of SPECIAL_DEFS) {
			const fullId  = `${PLUGIN_ID}:${def.commandId}`;
			const bareKey: Hotkey = { modifiers: [], key: def.key };
			const isSet   = effectiveHotkeys(fullId).some(hk => hotkeyId(hk) === hotkeyId(bareKey));
			const btn     = specialBtnRow.createEl('button', { text: isSet ? `${def.label} ✅` : def.label });
			if (!isSet) btn.addClass('mod-cta');
			btn.disabled  = isSet;
			if (!isSet) {
				btn.addEventListener('click', () => {
					hm.setHotkeys(fullId, [...effectiveHotkeys(fullId).map(toHotkey), bareKey]);
					hm.save();
					hm.bake();
					void this.plugin.saveSettings();
					this.display();
				});
			}
		}
		collect(specialEl);
		for (const el of sectionEls) el.toggleClass('uch-hidden', !this.sectionVisible);
	}

	private setHtmlDesc(setting: Setting, html: string): Setting {
		return setting.setDesc(sanitizeHTMLToDom(html));
	}
}
