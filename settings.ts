import { App, Hotkey, Modifier, Platform, PluginSettingTab, Setting, ToggleComponent, sanitizeHTMLToDom } from 'obsidian';
import type universalCursorHotkeysPlugin from './main';

const PLUGIN_ID = 'universal-cursor-hotkeys';

export interface CommandDef {
	block: 'cursor' | 'editing' | 'other' | 'tableStructure' | 'tableNav';
	id: string;
	name: string;
	recommended: Hotkey | null;
	// Explicit full command ID override — for commands this plugin doesn't
	// own (e.g. Obsidian's own native editor:table-* commands, listed in the
	// tableStructure block). When absent, the full ID is derived as
	// `${PLUGIN_ID}:${id}` as before (every other block's own defs).
	fullId?: string;
}

// The one place that knows how to turn a CommandDef into its real command
// ID — see CommandDef's own fullId doc comment for why this isn't always
// just a PLUGIN_ID prefix.
const getFullId = (def: CommandDef): string => def.fullId ?? `${PLUGIN_ID}:${def.id}`;

// The tableStructure block's own "Open in Hotkeys settings" link (in place of
// "Apply recommended" — this plugin doesn't own these commands, so there's
// nothing of its own to apply) searches Obsidian's real Hotkeys panel for
// its own native table-command group's own name prefix, locale-aware.
// Live-verified (user testing) for ja/en/en-gb. The remaining entries are
// each that locale's own translation of Obsidian's "Table:" command-group
// prefix, keyword + ':' — except fr, which uses French typographic spacing
// (keyword + ' :'). Any locale not listed here gets no link at all (see
// getTableCommandSearchTerm) rather than a guessed/silently-wrong term.
const TABLE_SEARCH_TERM_BY_LOCALE: Record<string, string> = {
	cs: 'Tabulka:',
	de: 'Tabelle:',
	en: 'table:',
	es: 'Tabla:',
	fr: 'Tableau :',
	id: 'Tabel:',
	it: 'Tabella:',
	ja: '表:',
	ko: '표:',
	nl: 'Tabel:',
	pl: 'Tabela:',
	pt: 'Tabela:',
	ro: 'Tabel:',
	ru: 'Таблица:',
	tr: 'Tablo:',
	uk: 'Таблиця:',
	vi: 'Bảng:',
	zh: '表格:',
};

// Obsidian sets moment's own locale to match its own UI language setting —
// an established (if undocumented) technique for reading it, same as many
// community plugins use for their own i18n. Live-verified (user testing).
const getObsidianLocale = (): string =>
	(window as unknown as { moment?: { locale(): string } }).moment?.locale() ?? 'en';

// Returns null for any locale not in TABLE_SEARCH_TERM_BY_LOCALE — the call
// site skips rendering the link entirely rather than falling back to a term
// that may not actually match that locale's own Hotkeys panel text.
const getTableCommandSearchTerm = (): string | null => {
	const base = getObsidianLocale().split('-')[0];
	return TABLE_SEARCH_TERM_BY_LOCALE[base] ?? null;
};

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
	commands?: { commands: Record<string, { name: string }>; executeCommandById?(id: string): boolean };
	setting: {
		open(): void;
		openTabById(id: string): HotkeySettingTab | null;
	};
	// Core config store (vault-level app settings, e.g. Obsidian's own "Vim key
	// bindings" toggle under key 'vimMode') — undocumented, read-only use here.
	vault: { getConfig?(key: string): unknown };
}

const MAC_MOD:  Record<string, string> = { Ctrl: '⌃', Shift: '⇧', Alt: '⌥', Meta: '⌘', Mod: '⌘' };
const WIN_MOD:  Record<string, string> = { Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Win', Mod: 'Ctrl' };
const KEY_DISP: Record<string, string> = {
	PageDown: 'Page Down', PageUp: 'Page Up',
	ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
	Backspace: '⌫', Delete: '⌦',
};
const MOD_ORDER: Record<string, number> = { Mod: 0, Ctrl: 1, Alt: 2, Shift: 3, Meta: 4 };

export const normMods = (mods: string | string[]): string[] =>
	Array.isArray(mods) ? mods : (mods ? mods.split(',') : []);

export const hotkeyId = (hk: AnyHotkey): string =>
	normMods(hk.modifiers).sort().join('+') + '+' + hk.key.toLowerCase();

export const formatHotkey = (hk: AnyHotkey, isMacOS = Platform.isMacOS): string => {
	const mods = normMods(hk.modifiers).sort((a, b) => (MOD_ORDER[a] ?? 9) - (MOD_ORDER[b] ?? 9));
	const key  = KEY_DISP[hk.key] ?? hk.key;
	return isMacOS
		? mods.map(m => MAC_MOD[m] ?? m).join('') + ' ' + key
		: [...mods.map(m => WIN_MOD[m] ?? m), key].join('+');
};

// SPECIAL_KEY_EXCEPTION is declared further below (derived from
// KEY_UPGRADE_DEFS) — computeRow/selectCurrentChips below only reference it
// inside their own function bodies, which don't run until display() calls
// them, long after the whole module (including that later declaration) has
// finished evaluating.

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
	const fullId = getFullId(def);
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
		const primaryHk   = currentHotkeys[0];
		const customId    = hotkeyId(primaryHk);
		const conflictIds = (reverseMap.get(customId) ?? []).filter(id => id !== fullId && cmds?.[id] !== undefined);
		if (conflictIds.length > 0) {
			return {
				name: def.name, key: recFmt,
				current: formatHotkey(primaryHk),
				extraCount: allCurrentHotkeys.length - 1,
				status: '🔴Conflict: ', conflictIds, action: 'done',
			};
		}
		return {
			name: def.name, key: recFmt,
			current: formatHotkey(primaryHk),
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

// Key Upgrades — physical/native keys (bare, for now — Home/End/Page Up/Page
// Down) reinforced with table- and CJK-aware behavior, for users who don't
// care about Vim/Emacs conventions. Unlike COMMAND_DEFS/computeRow (command
// is the subject, "which key should this command have"), the mapping here is
// key-first and always 1:1, additive-only, never displacing another
// command's binding — so the status model collapses to two independent
// booleans (is this exact key currently on the target command; is this exact
// key also held by some other command) rather than QSA's fuller
// recommended-vs-custom-key vocabulary. See computeRow's own doc history for
// why that fuller vocabulary doesn't apply here.
export interface KeyUpgradeDef {
	group: 'navBasics' | 'wordCommands';
	label: string;
	commandId: string;
	// Mac-only for now (2026-08-28 first pass) — Ctrl/Alt/Meta all resolve to
	// their literal Windows/Linux meaning if this ever runs there (Alt stays
	// Alt, Meta stays the Windows key), not yet OS-conditional. Bare
	// (modifiers: []) entries like Home/End are unaffected by that, since a
	// bare key means the same physical key on every OS.
	modifiers: Modifier[];
	key: string;
}

export interface KeyUpgradeRow {
	fullId: string;
	targetHotkey: Hotkey;
	assigned: boolean;
	conflictIds: string[];
}

export const computeKeyUpgradeRow = (
	def: KeyUpgradeDef,
	effectiveHotkeys: (cmdId: string) => BakedHotkey[],
	reverseMap: Map<string, string[]>,
	cmds: Record<string, { name: string }> | undefined,
): KeyUpgradeRow => {
	const fullId  = `${PLUGIN_ID}:${def.commandId}`;
	const targetHotkey: Hotkey = { modifiers: def.modifiers, key: def.key };
	const keyId   = hotkeyId(targetHotkey);
	const assigned = effectiveHotkeys(fullId).some(hk => hotkeyId(hk) === keyId);
	const conflictIds = (reverseMap.get(keyId) ?? []).filter(id => id !== fullId && cmds?.[id] !== undefined);
	return { fullId, targetHotkey, assigned, conflictIds };
};

// Single source of truth for every Key Upgrades entry — also drives
// SPECIAL_KEY_EXCEPTION below (derived, not hand-duplicated), so a bare-key
// entry added here automatically gets the same "Apply recommended still
// applies the Ctrl-combo even though the bare key is already set" treatment
// Home/End/Page Up/Page Down already had, without a second place to
// remember to update (missed once already, for Up/Down — see git history).
// Navigation basics is bare-key (works identically on every OS); Word
// commands is Mac-only for now (2026-08-28 first pass) — see KeyUpgradeDef's
// own doc comment. OS-conditional Windows/Linux equivalents are a
// deliberately deferred follow-up, not yet built.
// Order within each group matches COMMAND_DEFS's own QSA ordering (cursor
// block, then editing block) — QSA is treated as the canonical order.
const KEY_UPGRADE_DEFS: readonly KeyUpgradeDef[] = [
	{ group: 'navBasics', label: 'Column-aware',      commandId: 'cursor-up',   modifiers: [], key: 'ArrowUp'   },
	{ group: 'navBasics', label: 'Column-aware',      commandId: 'cursor-down', modifiers: [], key: 'ArrowDown' },
	{ group: 'navBasics', label: '3-step Smart home', commandId: 'cursor-home', modifiers: [], key: 'Home'     },
	{ group: 'navBasics', label: 'Table-aware',       commandId: 'cursor-end',  modifiers: [], key: 'End'      },
	{ group: 'navBasics', label: 'Document start - table-aware', commandId: 'cursor-top',    modifiers: ['Meta'], key: 'ArrowUp'   },
	{ group: 'navBasics', label: 'Document end - table-aware',   commandId: 'cursor-bottom', modifiers: ['Meta'], key: 'ArrowDown' },
	{ group: 'navBasics', label: 'Table-aware',       commandId: 'page-up',     modifiers: [], key: 'PageUp'   },
	{ group: 'navBasics', label: 'Table-aware',       commandId: 'page-down',   modifiers: [], key: 'PageDown' },
	{ group: 'wordCommands', label: 'Word right - table & CJK aware', commandId: 'word-right', modifiers: ['Alt'], key: 'ArrowRight' },
	{ group: 'wordCommands', label: 'Word left - table & CJK aware',  commandId: 'word-left',  modifiers: ['Alt'], key: 'ArrowLeft'  },
	// Real macOS convention confirmed live (2026-08-28): Option, not Cmd. The
	// physical "delete" key on a Mac keyboard sends Backspace; Fn+that key
	// sends Delete (forward-delete) — no separate "Fn" modifier exists to
	// bind, Fn just changes which key code is sent.
	{ group: 'wordCommands', label: 'Kill word left - table & CJK aware',  commandId: 'kill-word-left',  modifiers: ['Alt'], key: 'Backspace' },
	{ group: 'wordCommands', label: 'Kill word right - table & CJK aware', commandId: 'kill-word-right', modifiers: ['Alt'], key: 'Delete'    },
];

// Derived from KEY_UPGRADE_DEFS's own bare (no-modifier) entries only — this
// exception mechanism exists specifically to let a bare physical key (e.g.
// Home) coexist on the same command as a modified QSA-recommended key (e.g.
// Ctrl-A) without either blocking the other's own "already assigned"
// status. Modifier-bearing entries (Word left/right, Document start/end,
// Kill word left/right) don't need it — those commands have no QSA
// `recommended` hotkey to disambiguate against in the first place.
const SPECIAL_KEY_EXCEPTION: Partial<Record<string, string>> = Object.fromEntries(
	KEY_UPGRADE_DEFS.filter(d => d.modifiers.length === 0).map(d => [d.commandId, d.key])
);

const ctrl = (...keys: string[]): Hotkey => ({ modifiers: ['Ctrl'], key: keys[0] });

const COMMAND_DEFS: readonly CommandDef[] = [
	{ block: 'cursor',  id: 'cursor-up',           name: 'UP',                  recommended: ctrl('P') },
	{ block: 'cursor',  id: 'cursor-down',          name: 'DOWN',                recommended: ctrl('N') },
	{ block: 'cursor',  id: 'cursor-left',          name: 'LEFT',                recommended: ctrl('B') },
	{ block: 'cursor',  id: 'cursor-right',         name: 'RIGHT',               recommended: ctrl('F') },
	{ block: 'cursor',  id: 'cursor-home',          name: 'HOME',                recommended: ctrl('A') },
	{ block: 'cursor',  id: 'cursor-end',           name: 'END',                 recommended: ctrl('E') },
	{ block: 'cursor',  id: 'cursor-top',           name: 'TOP',                 recommended: null },
	{ block: 'cursor',  id: 'cursor-bottom',        name: 'BOTTOM',              recommended: null },
	{ block: 'cursor',  id: 'page-up',              name: 'Page up',             recommended: null },
	{ block: 'cursor',  id: 'page-down',            name: 'Page down',           recommended: null },
	{ block: 'cursor',  id: 'word-right',           name: 'Word right',          recommended: null },
	{ block: 'cursor',  id: 'word-left',            name: 'Word left',           recommended: null },
	{ block: 'editing', id: 'kill-line',            name: 'Kill line',           recommended: ctrl('K') },
	{ block: 'editing', id: 'kill-region',          name: 'Kill region',         recommended: ctrl('W') },
	{ block: 'editing', id: 'copy-region',          name: 'Copy region',         recommended: null },
	{ block: 'editing', id: 'yank',                 name: 'Yank',                recommended: ctrl('Y') },
	{ block: 'editing', id: 'delete-char',          name: 'Delete char',         recommended: ctrl('D') },
	{ block: 'editing', id: 'undo',                 name: 'Undo',                recommended: ctrl('/') },
	{ block: 'editing', id: 'redo',                 name: 'Redo',                recommended: null },
	{ block: 'editing', id: 'kill-word-left',       name: 'Kill word left',      recommended: null },
	{ block: 'editing', id: 'kill-word-right',      name: 'Kill word right',     recommended: null },
	{ block: 'editing', id: 'uppercase-word',       name: 'Uppercase word',      recommended: null },
	{ block: 'editing', id: 'lowercase-word',       name: 'Lowercase word',      recommended: null },
	{ block: 'editing', id: 'capitalize-word',      name: 'Capitalize word',     recommended: null },
	{ block: 'editing', id: 'transpose-chars',      name: 'Transpose chars',     recommended: null },
	{ block: 'editing', id: 'select-all',           name: 'Select all',          recommended: null },
	{ block: 'other',   id: 'recenter-top-bottom',  name: 'Recenter-top-bottom', recommended: ctrl('L') },
	{ block: 'other',   id: 'recenter',             name: 'Recenter',            recommended: null },

	// Obsidian's own native table commands — not owned by this plugin (no
	// recommended hotkey is offered for any of these; see
	// renderCollapsibleBlock's own titleAction for why: existing assignments
	// are just made visible here, matching this same 16-command set
	// candidate A's own Vim leader-key commands already wrap). Listed before
	// tableNav below: basic table-editing operations first, the more
	// auxiliary cell-navigation convenience commands after.
	{ block: 'tableStructure', id: 'table-row-before',        fullId: 'editor:table-row-before',        name: 'Insert row above',    recommended: null },
	{ block: 'tableStructure', id: 'table-row-after',         fullId: 'editor:table-row-after',         name: 'Insert row below',    recommended: null },
	{ block: 'tableStructure', id: 'table-row-up',            fullId: 'editor:table-row-up',             name: 'Move row up',         recommended: null },
	{ block: 'tableStructure', id: 'table-row-down',          fullId: 'editor:table-row-down',           name: 'Move row down',       recommended: null },
	{ block: 'tableStructure', id: 'table-row-copy',          fullId: 'editor:table-row-copy',           name: 'Duplicate row',       recommended: null },
	{ block: 'tableStructure', id: 'table-row-delete',        fullId: 'editor:table-row-delete',         name: 'Delete row',          recommended: null },
	{ block: 'tableStructure', id: 'table-col-before',        fullId: 'editor:table-col-before',         name: 'Insert column left',  recommended: null },
	{ block: 'tableStructure', id: 'table-col-after',         fullId: 'editor:table-col-after',          name: 'Insert column right', recommended: null },
	{ block: 'tableStructure', id: 'table-col-left',          fullId: 'editor:table-col-left',           name: 'Move column left',    recommended: null },
	{ block: 'tableStructure', id: 'table-col-right',         fullId: 'editor:table-col-right',          name: 'Move column right',   recommended: null },
	{ block: 'tableStructure', id: 'table-col-align-left',    fullId: 'editor:table-col-align-left',     name: 'Align column left',   recommended: null },
	{ block: 'tableStructure', id: 'table-col-align-center',  fullId: 'editor:table-col-align-center',   name: 'Align column center', recommended: null },
	{ block: 'tableStructure', id: 'table-col-align-right',   fullId: 'editor:table-col-align-right',    name: 'Align column right',  recommended: null },
	{ block: 'tableStructure', id: 'table-col-copy',          fullId: 'editor:table-col-copy',           name: 'Duplicate column',    recommended: null },
	{ block: 'tableStructure', id: 'table-col-delete',        fullId: 'editor:table-col-delete',         name: 'Delete column',       recommended: null },
	{ block: 'tableStructure', id: 'insert-table',            fullId: 'editor:insert-table',             name: 'Insert table',        recommended: null },

	// Pure cursor movement — no-op outside a table cell (see
	// table-navigation.ts). recommended: null throughout is a deliberate
	// choice not to push a default, not "not owned" like tableStructure
	// above — no Hotkeys-search link needed for this block (see
	// renderCollapsibleBlock's own titleAction parameter).
	{ block: 'tableNav', id: 'table-cell-left',      name: 'Move to cell left',   recommended: null },
	{ block: 'tableNav', id: 'table-cell-right',     name: 'Move to cell right',  recommended: null },
	{ block: 'tableNav', id: 'table-cell-down',      name: 'Move to cell below',  recommended: null },
	{ block: 'tableNav', id: 'table-cell-up',        name: 'Move to cell above',  recommended: null },
	{ block: 'tableNav', id: 'table-exit-down',      name: 'Exit table below',    recommended: null },
	{ block: 'tableNav', id: 'table-exit-up',        name: 'Exit table above',    recommended: null },
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

interface KeyUpgradeCtx {
	hm: HotkeyManager;
	effectiveHotkeys: (id: string) => BakedHotkey[];
	reverseMap: Map<string, string[]>;
	cmds: Record<string, { name: string }> | undefined;
	toHotkey: (hk: BakedHotkey) => Hotkey;
}

export class UniversalCursorHotkeysSettingTab extends PluginSettingTab {
	plugin: universalCursorHotkeysPlugin;
	private get individualVisible() { return this.plugin.settings.qsaIndividualVisible; }
	private set individualVisible(v: boolean) { this.plugin.settings.qsaIndividualVisible = v; void this.plugin.saveSettings(); }
	private get sectionVisible() { return this.plugin.settings.qsaSectionVisible; }
	private set sectionVisible(v: boolean) { this.plugin.settings.qsaSectionVisible = v; void this.plugin.saveSettings(); }
	private get tableStructureVisible() { return this.plugin.settings.qsaTableStructureVisible; }
	private set tableStructureVisible(v: boolean) { this.plugin.settings.qsaTableStructureVisible = v; void this.plugin.saveSettings(); }
	private get tableNavVisible() { return this.plugin.settings.qsaTableNavVisible; }
	private set tableNavVisible(v: boolean) { this.plugin.settings.qsaTableNavVisible = v; void this.plugin.saveSettings(); }
	private get activeTab() { return this.plugin.settings.activeSettingsTab; }
	private set activeTab(v: 'general' | 'vim' | 'emacs') { this.plugin.settings.activeSettingsTab = v; void this.plugin.saveSettings(); }

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
		// containerEl is itself Obsidian's own scrollable .vertical-tab-content
		// element — a full re-render (containerEl.empty() + rebuild, triggered
		// by many toggles' own onChange) otherwise resets scroll position to 0
		// with no restoration, causing a visible jump on every such toggle.
		const scrollTop = containerEl.scrollTop;
		containerEl.empty();

		// Must run before renderQsaFrame: it may flip sectionVisible/activeTab
		// (opening the frame onto the Vim tab), and renderQsaFrame reads both
		// to decide how it renders.
		this.maybeAutoExpandVimSection();

		this.renderQsaFrame(containerEl);

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

		new Setting(containerEl)
			.setName('Double-click word select')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> Selects just the CJK word at the click position, not the whole unbroken run — dragging extends a word at a time.<br>' +
				'<b>OFF:</b> Uses Obsidian\'s native double-click selection.'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.cjkDoubleClickWordSelect)
				.onChange(async (value) => {
					this.plugin.settings.cjkDoubleClickWordSelect = value;
					await this.plugin.saveSettings();
				}));

		setStandardDisabled(!this.plugin.settings.smartHomeStandard);
		containerEl.scrollTop = scrollTop;
	}

	// One-time nudge: if the user opens settings with Obsidian's own "Vim key
	// bindings" core setting on and has never seen this auto-switch fire
	// before, open the QSA frame (if closed) and switch it to the Vim tab,
	// since a Vim-mode user likely wants that tab first. Never fires again
	// afterward, so it never fights a user's own later tab/Show-Hide choice
	// (see the vimAutoExpandDone doc comment in main.ts).
	private maybeAutoExpandVimSection(): void {
		if (this.plugin.settings.vimAutoExpandDone) return;
		const vault = (this.app as unknown as ObsidianInternals).vault;
		const vimModeOn = vault.getConfig?.('vimMode') === true;
		if (!vimModeOn) return;
		this.sectionVisible = true;
		this.activeTab = 'vim';
		this.plugin.settings.vimAutoExpandDone = true;
		void this.plugin.saveSettings();
	}

	// keys: e.g. ['h','l','x']. label: e.g. 'Character movement'.
	private setKeyChipName(setting: Setting, keys: string[], label: string): void {
		const nameEl = setting.nameEl;
		nameEl.empty();
		for (const key of keys) {
			nameEl.createSpan({ text: key, cls: 'uch-kbd' });
			nameEl.appendText(' ');
		}
		nameEl.appendText(label);
	}

	// Every Vim toggle "Apply all" sets — used to compute its own disabled
	// state (already fully applied?). Every setting here triggers a full
	// this.display() re-render on its own change, which recomputes this
	// fresh, so no separate update path is needed beyond that.
	private eligibleVimSettings(): boolean[] {
		const s = this.plugin.settings;
		return [s.vimHlSupport, s.vimJkSupport, s.vimWordSupport, s.vimGgSupport, s.vimDisplayLineSupport, s.vimEolSupport, s.vimTableStructureSupport, s.vimTableNavigationSupport, s.vimCaretSupport, s.vimJoinSupport];
	}

	// Vim mode tab content — the frame's own header/tab-bar (renderQsaFrame)
	// owns visibility now, so this only renders once the Vim tab is actually
	// selected; no own Show/Hide, no own visibility bookkeeping needed.
	private renderVimTabContent(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Vim support')
			.then(setting => {
				setting.nameEl.createSpan({ text: 'experimental', cls: 'uch-vim-badge' });
				this.setHtmlDesc(setting,
					'Fixes native gaps in Obsidian\'s built-in Vim mode inside Live Preview table cells, ' +
					'extends a few motions with this plugin\'s Smart home / Smart join, ' +
					'and adds leader-key commands for table structure editing and cell navigation.');
			});

		const restartBanner = new Setting(containerEl)
			.setClass('uch-vim-item')
			.setClass('uch-vim-restart-banner')
			.then(setting => setting.nameEl.createSpan({
				text: 'A Vim item was turned off — restart Obsidian to fully apply it.',
				cls: 'uch-vim-restart-text',
			}))
			.addButton(btn => btn
				.setButtonText('Restart')
				.setCta()
				.onClick(() => {
					(this.app as unknown as ObsidianInternals).commands?.executeCommandById?.('app:reload');
				}));
		restartBanner.settingEl.toggleClass('uch-hidden', !this.plugin.vimSupport.needsRestart);

		new Setting(containerEl)
			.setClass('uch-vim-item')
			.setName('Leader key')
			.then(setting => this.setHtmlDesc(setting, '' +
				'<b>ON:</b> Table structure/navigation commands below use <span class="uch-kbd">\\</span> as the leader key.<br>' +
				'<b>OFF:</b> Uses <span class="uch-kbd">Space</span> as the leader key (default).<br>' +
				'<i>Only affects table structure/navigation below — has no effect on its own.</i>'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.vimLeaderUseBackslash)
				.onChange((value) => {
					this.plugin.vimSupport.setLeaderUseBackslash(value);
					this.display();
				}));

		// "Apply all" — turns on every item below unconditionally. `^`/`I` and
		// `J` are included regardless of their own prerequisite (Smart home
		// (standard) / Smart join, both outside this section) — both self-gate
		// live at call time (falling back to vim's own native behavior when
		// their prerequisite is off), so there's no correctness reason to skip
		// them, only a cosmetic one this button doesn't need to care about.
		new Setting(containerEl)
			.setClass('uch-vim-item')
			.setName('Apply all')
			.then(setting => this.setHtmlDesc(setting, 'Turns on everything below.'))
			.addButton(btn => {
				btn.setButtonText('Apply all');
				btn.setCta();
				btn.setDisabled(this.eligibleVimSettings().every(v => v));
				btn.onClick(() => {
					this.plugin.vimSupport.setHlEnabled(true);
					this.plugin.vimSupport.setJkEnabled(true);
					this.plugin.vimSupport.setWordsEnabled(true);
					this.plugin.vimSupport.setGgEnabled(true);
					this.plugin.vimSupport.setDisplayLinesEnabled(true);
					this.plugin.vimSupport.setEolEnabled(true);
					this.plugin.vimSupport.setTableStructureEnabled(true);
					this.plugin.vimSupport.setTableNavigationEnabled(true);
					this.plugin.vimSupport.setCaretEnabled(true);
					this.plugin.vimSupport.setJoinEnabled(true);
					this.display();
				});
			});

		new Setting(containerEl)
			.setClass('uch-vim-item')
			.then(setting => {
				this.setKeyChipName(setting, ['h', 'l', 'x'], 'Character movement');
				this.setHtmlDesc(setting, '' +
					'<b>ON:</b> Moves by character correctly inside table cells — no multi-byte miscounting, no wrong jumps at line boundaries. ' +
					'<span class="uch-kbd">x</span> behaves the same way at cell boundaries.<br>' +
					'<b>OFF:</b> Vim\'s own native <span class="uch-kbd">h</span> <span class="uch-kbd">l</span> <span class="uch-kbd">x</span>, unchanged.');
			})
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.vimHlSupport)
				.onChange((value) => {
					this.plugin.vimSupport.setHlEnabled(value);
					this.display();
				}));

		new Setting(containerEl)
			.setClass('uch-vim-item')
			.then(setting => {
				this.setKeyChipName(setting, ['j', 'k'], 'Line movement');
				this.setHtmlDesc(setting, '' +
					'<b>ON:</b> Crosses row boundaries the same way Ctrl+N/P already do, and stops correctly inside multi-line cells — preserving column position throughout.<br>' +
					'<b>OFF:</b> Vim\'s own native <span class="uch-kbd">j</span> <span class="uch-kbd">k</span>, unchanged.');
			})
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.vimJkSupport)
				.onChange((value) => {
					this.plugin.vimSupport.setJkEnabled(value);
					this.display();
				}));

		new Setting(containerEl)
			.setClass('uch-vim-item')
			.then(setting => {
				this.setKeyChipName(setting, ['w', 'b', 'e'], 'Word motion');
				this.setHtmlDesc(setting, '' +
					'<b>ON:</b> Crosses cell/row boundaries the same way vim\'s own word motions cross lines — reaching the end of the table exits into the surrounding text, matching vim\'s own document-wide behavior.<br>' +
					'<b>OFF:</b> Vim\'s own native <span class="uch-kbd">w</span> <span class="uch-kbd">b</span> <span class="uch-kbd">e</span> (and <span class="uch-kbd">W</span>/<span class="uch-kbd">B</span>/<span class="uch-kbd">E</span>/<span class="uch-kbd">ge</span>/<span class="uch-kbd">gE</span>), unchanged.');
			})
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.vimWordSupport)
				.onChange((value) => {
					this.plugin.vimSupport.setWordsEnabled(value);
					this.display();
				}));

		new Setting(containerEl)
			.setClass('uch-vim-item')
			.then(setting => {
				this.setKeyChipName(setting, ['gg', 'G'], 'Document start/end')
				this.setHtmlDesc(setting, '' +
					'<b>ON:</b> Always reaches the note\'s actual first/last line — including exiting a table cell entirely, and landing correctly inside a table row if the note happens to start or end with one.<br>' +
					'<b>OFF:</b> Vim\'s own native <span class="uch-kbd">gg</span> <span class="uch-kbd">G</span>, unchanged.');
			})
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.vimGgSupport)
				.onChange((value) => {
					this.plugin.vimSupport.setGgEnabled(value);
					this.display();
				}));

		new Setting(containerEl)
			.setClass('uch-vim-item')
			.then(setting => {
				this.setKeyChipName(setting, ['gj', 'gk'], 'Display-line movement');
				this.setHtmlDesc(setting, '' +
					'<b>ON:</b> Moves by visual line inside table cells the same way Ctrl+N/P already do, tracking the visual column across wrapped lines.<br>' +
					'<b>OFF:</b> Vim\'s own native <span class="uch-kbd">gj</span> <span class="uch-kbd">gk</span>, unchanged.');
			})
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.vimDisplayLineSupport)
				.onChange((value) => {
					this.plugin.vimSupport.setDisplayLinesEnabled(value);
					this.display();
				}));

		new Setting(containerEl)
			.setClass('uch-vim-item')
			.then(setting => {
				this.setKeyChipName(setting, ['$'], 'End of line (sticky column)');
				this.setHtmlDesc(setting, '' +
					'<b>ON:</b> Sticks to each line\'s own end when followed by j/k or gj/gk, matching real vim\'s own "always this line\'s end" goal column — including across table row crossings. Requires j/k or gj/gk to be enabled. (<span class="uch-kbd">D</span>/<span class="uch-kbd">C</span> share this motion but behave the same either way.)<br>' +
					'<b>OFF:</b> Vim\'s own native <span class="uch-kbd">$</span>, unchanged.');
			})
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.vimEolSupport)
				.onChange((value) => {
					this.plugin.vimSupport.setEolEnabled(value);
					this.display();
				}));

		new Setting(containerEl)
			.setClass('uch-vim-item')
			.then(setting => {
				this.setKeyChipName(setting, ['^', 'I'], 'First non-blank (Smart home)');
				this.setHtmlDesc(setting, '' +
					'<b>ON:</b> Reuses Smart home above — skips leading Markdown syntax instead of just whitespace, to reach the real content start.<br>' +
					'<b>OFF:</b> Vim\'s own native <span class="uch-kbd">^</span> <span class="uch-kbd">I</span>, unchanged.<br>' +
					'<i>Requires <b>Smart home (standard)</b> to be enabled — also follows whatever <b>Smart home (advanced)</b> is set to.</i>');
			})
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.vimCaretSupport)
				.onChange((value) => {
					this.plugin.vimSupport.setCaretEnabled(value);
					this.display();
				}));

		new Setting(containerEl)
			.setClass('uch-vim-item')
			.then(setting => {
				this.setKeyChipName(setting, ['J'], 'Join lines (Smart join)');
				this.setHtmlDesc(setting, '' +
					'<b>ON:</b> Reuses Smart join above — strips the next line\'s Markdown syntax instead of just whitespace, still inserting vim\'s usual single space.<br>' +
					'<b>OFF:</b> Vim\'s own native join, unchanged.<br>' +
					'<i>Requires <b>Smart join</b> to be enabled.</i>');
			})
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.vimJoinSupport)
				.onChange((value) => {
					this.plugin.vimSupport.setJoinEnabled(value);
					this.display();
				}));

		new Setting(containerEl)
			.setClass('uch-vim-item')
			.then(setting => {
				const leader = this.plugin.settings.vimLeaderUseBackslash ? '\\' : 'Space';
				this.setKeyChipName(setting, [leader, 't'], 'Table structure (16 commands)');
				const kbd = (s: string) => '<span class="uch-kbd">' + leader + '</span> <span class="uch-kbd">' + s + '</span>';
				const kbdMulti = (...keys: string[]) => '<span class="uch-kbd">' + leader + '</span> ' + keys.map(k => '<span class="uch-kbd">' + k + '</span>').join(' / ');
				this.setHtmlDesc(setting, '' +
					'<b>ON:</b> Wraps the commands below. While this is on, a bare press of the leader key no longer behaves as vim\'s own native binding (Space normally moves right).' +
					'<table class="uch-vim-cmd-table">' +
					'<tr><th></th><th>Row</th><th>Column</th></tr>' +
					'<tr><td>Insert</td><td>' + kbdMulti('t o', 't O') + '<br>' + kbdMulti('t i J', 't i K') + '<br>(below/above)</td><td>' + kbdMulti('t i H', 't i L') + '<br>(left/right)</td></tr>' +
					'<tr><td>Move</td><td>' + kbdMulti('t K', 't J') + '<br>(up/down)</td><td>' + kbdMulti('t H', 't L') + '<br>(left/right)</td></tr>' +
					'<tr><td>Delete</td><td>' + kbd('t d d') + '</td><td>' + kbd('t d c') + '</td></tr>' +
					'<tr><td>Duplicate</td><td>' + kbd('t y y p') + '</td><td>' + kbd('t y c') + '</td></tr>' +
					'<tr><td>Align</td><td></td><td>' + kbdMulti('t a l', 't a c', 't a r') + '<br>(left/center/right)</td></tr>' +
					'<tr><td>Insert table</td><td colspan="2">' + kbd('t m') + '</td></tr>' +
					'</table>' +
					'<b>OFF:</b> No leader-key table structure commands are bound.');
			})
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.vimTableStructureSupport)
				.onChange((value) => {
					this.plugin.vimSupport.setTableStructureEnabled(value);
					this.display();
				}));

		new Setting(containerEl)
			.setClass('uch-vim-item')
			.then(setting => {
				const leader = this.plugin.settings.vimLeaderUseBackslash ? '\\' : 'Space';
				this.setKeyChipName(setting, [leader, 't'], 'Table navigation (6 commands)');
				const kbdMulti = (...keys: string[]) => '<span class="uch-kbd">' + leader + '</span> ' + keys.map(k => '<span class="uch-kbd">' + k + '</span>').join(' / ');
				this.setHtmlDesc(setting, '' +
					'<b>ON:</b> Adds the commands below. While this is on, a bare press of the leader key no longer behaves as vim\'s own native binding (Space normally moves right).' +
					'<table class="uch-vim-cmd-table">' +
					'<tr><th></th><th>Row</th><th>Column</th></tr>' +
					'<tr><td>Move to cell</td><td>' + kbdMulti('t j', 't k') + '<br>(below/above)</td><td>' + kbdMulti('t h', 't l') + '<br>(left/right)</td></tr>' +
					'<tr><td>Exit table</td><td colspan="2">' + kbdMulti('t x', 't X') + '<br>(below/above)</td></tr>' +
					'</table>' +
					'<b>OFF:</b> No leader-key table navigation commands are bound.');
			})
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.vimTableNavigationSupport)
				.onChange((value) => {
					this.plugin.vimSupport.setTableNavigationEnabled(value);
					this.display();
				}));

		const limitationsEl = containerEl.createDiv({ cls: 'uch-vim-limitations' });
		limitationsEl.createDiv({ text: 'Limitations', cls: 'uch-vim-limitations-title' });
		const list = limitationsEl.createEl('ul');
		list.appendChild(sanitizeHTMLToDom('<li>For Obsidian\'s built-in Vim mode specifically — not intended for use alongside a plugin that replaces or manages Vim\'s table-cell behavior on its own.</li>'));
		list.createEl('li', { text: 'If you\'ve already customized one of these keys yourself, having its toggle on will override your binding.' });
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

	private renderDataRow(tbody: HTMLElement, def: CommandDef, row: HotkeyRow, ctx: RenderCtx): HTMLTableRowElement {
		const tr = tbody.createEl('tr');
		tr.addClass('uch-row-thin');

		const tdName = tr.createEl('td', { cls: 'uch-cell-name' });
		const fullId = getFullId(def);
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
		} else if (row.action === 'done' || row.action === 'none') {
			const btn = tdAction.createEl('button', { text: 'Open →' });
			btn.addClass('uch-open-btn');
			btn.addEventListener('click', () => openHotkeysPanel());
			ctx.allActionBtns.push(btn);
		} else {
			tdAction.createEl('button', { cls: 'uch-set-btn-spacer' });
		}

		return tr;
	}

	private renderBlock(table: HTMLElement, title: string, entries: Array<{def: CommandDef; row: HotkeyRow}>, ctx: RenderCtx): HTMLTableSectionElement {
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
		return tbody;
	}

	// One Key Upgrades row: key chip | status (only for Conflict/Used — Set/
	// Available are conveyed by the toggle's own on/off state, no badge
	// needed) | toggle. Toggling on appends the bare key to the target
	// command's hotkeys (additive, never displaces); toggling off removes
	// just this one key. Disabled when the key is held by another command and
	// not yet on the target command (Used) — turning it on here would create
	// a fresh conflict this section is designed to never produce; Conflict
	// (already on both) stays togglable off, since that only ever resolves
	// this command's own side.
	private renderKeyUpgradeRow(tbody: HTMLElement, def: KeyUpgradeDef, ctx: KeyUpgradeCtx): HTMLTableRowElement {
		const { fullId, targetHotkey, assigned, conflictIds } = computeKeyUpgradeRow(def, ctx.effectiveHotkeys, ctx.reverseMap, ctx.cmds);
		const hasConflict = conflictIds.length > 0;

		const tr = tbody.createEl('tr');
		tr.addClass('uch-row-thin');

		const tdKey = tr.createEl('td', { cls: 'uch-cell-name' });
		this.makeKeyCell(tdKey, formatHotkey(targetHotkey), () => this.openHotkeysPanelByKey(targetHotkey));

		tr.createEl('td', { text: def.label, cls: 'uch-key-upgrade-label' });

		const tdStatus = tr.createEl('td', { cls: 'uch-key-upgrade-status' });
		if (hasConflict) {
			tdStatus.setText(assigned ? '🔴Conflict' : '🔴Used');
		}

		const tdToggle = tr.createEl('td', { cls: 'uch-cell-toggle' });
		const toggle = new ToggleComponent(tdToggle);
		toggle.setValue(assigned);
		toggle.setDisabled(!assigned && hasConflict);
		if (!assigned && hasConflict) {
			tdToggle.title = 'Already used by another command — free it up in Hotkeys settings first.';
		}
		toggle.onChange((value) => {
			ctx.hm.setHotkeys(fullId, value
				? [...ctx.effectiveHotkeys(fullId).map(ctx.toHotkey), targetHotkey]
				: ctx.effectiveHotkeys(fullId).filter(hk => hotkeyId(hk) !== hotkeyId(targetHotkey)).map(ctx.toHotkey));
			ctx.hm.save();
			ctx.hm.bake();
			void this.plugin.saveSettings();
			this.display();
		});

		return tr;
	}

	// One Key Upgrades group: a title + one-line description of what the
	// group's keys get upgraded to do, then one row per key. Command-family
	// pairs (e.g. a future Word left/right entry) share one description here
	// rather than repeating it per row, since the row itself only needs to
	// show the key and its assignment state.
	private renderKeyUpgradeGroup(table: HTMLElement, title: string, desc: string | null, defs: readonly KeyUpgradeDef[], ctx: KeyUpgradeCtx): HTMLTableSectionElement {
		const tbody = table.createEl('tbody');

		const titleRow = tbody.createEl('tr');
		const titleCell = titleRow.createEl('td');
		titleCell.colSpan = 4;
		titleCell.addClass('uch-title-cell');
		titleCell.createDiv({ text: title, cls: 'uch-title-text' });
		if (desc !== null) titleCell.createDiv({ text: desc, cls: 'uch-key-upgrade-group-desc' });

		for (const def of defs) {
			this.renderKeyUpgradeRow(tbody, def, ctx);
		}

		const spacerTd = tbody.createEl('tr').createEl('td', { cls: 'uch-block-spacer' });
		spacerTd.colSpan = 4;
		return tbody;
	}

	// Collapsible variant of renderBlock, for blocks whose entries this
	// plugin doesn't own/control the default for — reuses renderDataRow
	// (identical per-row shape) but not renderBlock's own title row:
	// "Apply recommended" would always be disabled when every entry has
	// recommended: null, so callers pass their own optional titleAction
	// (e.g. Table structure's link into Obsidian's Hotkeys panel) instead,
	// rendered as its own row (indented to match the Command column) below
	// the title row, inside contentTbody — so it collapses along with the
	// rest of the block, not stuck in the always-visible header. Table
	// navigation passes none at all, per explicit design decision — its own
	// per-row "Open →" buttons already suffice. Split across *two* <tbody>s
	// sharing the same <table> (HTML tables support multiple) rather than
	// one, unlike the 3 core blocks above: the toggle itself must stay
	// visible even while the content underneath it is collapsed, so it
	// can't live inside the same tbody being hidden. Toggled via a
	// ▶/▼-prefixed title (mirrors the existing "▶ Individual" column-header
	// convention below), not a Show/Hide button — those are reserved for
	// top-level blocks (the whole QSA section, the whole Vim support
	// section), not these nested sub-blocks.
	private renderCollapsibleBlock(
		table: HTMLElement,
		title: string,
		entries: Array<{def: CommandDef; row: HotkeyRow}>,
		ctx: RenderCtx,
		visible: { get(): boolean; set(v: boolean): void },
		titleAction?: (linkRow: HTMLElement) => void,
		// Command ids after which a thicker group-separator border is drawn
		// (same uch-row-thick weight as the row under the column headers) —
		// e.g. Table structure's own row-ops/column-ops/insert-table group
		// boundaries, matching Obsidian's native right-click table menu's
		// own grouping.
		thickBorderAfterIds?: ReadonlySet<string>,
	): void {
		const headerTbody = table.createEl('tbody');
		const titleRow = headerTbody.createEl('tr');
		const titleCell = titleRow.createEl('td');
		titleCell.colSpan = 5;
		titleCell.addClass('uch-title-cell');
		const toggleLabel = titleCell.createSpan({
			text: `${visible.get() ? '▼' : '▶'} ${title}`,
			cls: 'uch-title-text uch-block-toggle',
		});

		const contentTbody = table.createEl('tbody');
		contentTbody.toggleClass('uch-hidden', !visible.get());
		toggleLabel.addEventListener('click', () => {
			visible.set(!visible.get());
			toggleLabel.setText(`${visible.get() ? '▼' : '▶'} ${title}`);
			contentTbody.toggleClass('uch-hidden', !visible.get());
		});

		if (titleAction) {
			const linkRow = contentTbody.createEl('tr').createEl('td', { cls: 'uch-block-link-row' });
			linkRow.colSpan = 5;
			titleAction(linkRow);
		}

		const headerRow = contentTbody.createEl('tr');
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

		for (const { def, row } of entries) {
			const tr = this.renderDataRow(contentTbody, def, row, ctx);
			if (thickBorderAfterIds?.has(def.id)) tr.addClass('uch-row-thick');
		}

		const spacerTd = contentTbody.createEl('tr').createEl('td', { cls: 'uch-block-spacer' });
		spacerTd.colSpan = 5;
	}

	// The QSA frame: one shared open/close control (sectionVisible), then —
	// once open — a 3-tab bar (general/vim/emacs, sharing activeTab) and
	// whichever one tab's own content. Only the active tab's DOM is ever
	// built (matching this file's existing "any state change -> full
	// containerEl.empty()+rebuild" idiom already used everywhere else), so
	// there's no separate hidden-tab visibility bookkeeping to maintain.
	private renderQsaFrame(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Quick setup assistant')
			.addButton(btn => {
				btn.setButtonText(this.sectionVisible ? 'Hide' : 'Show');
				btn.onClick(() => {
					this.sectionVisible = !this.sectionVisible;
					this.display();
				});
			});

		if (!this.sectionVisible) return;

		const tabBar = containerEl.createDiv({ cls: 'uch-tab-bar' });
		const TABS: ReadonlyArray<{ id: 'general' | 'vim' | 'emacs'; label: string }> = [
			{ id: 'general', label: 'Key Upgrades' },
			{ id: 'vim',   label: 'Vim mode' },
			{ id: 'emacs', label: 'macOS-style (Emacs keybindings)' },
		];
		for (const tab of TABS) {
			const tabBtn = tabBar.createEl('button', { text: tab.label, cls: 'uch-tab-btn' });
			if (this.activeTab === tab.id) tabBtn.addClass('uch-tab-btn-active');
			tabBtn.addEventListener('click', () => {
				this.activeTab = tab.id;
				this.display();
			});
		}

		if (this.activeTab === 'vim') {
			this.renderVimTabContent(containerEl);
			return;
		}

		// Shared hotkey-manager infra — needed by both the 'all' (Key
		// Upgrades) and 'emacs' (QSA table) tabs.
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

		if (this.activeTab === 'emacs') {
			this.renderEmacsTabContent(containerEl, hm, effectiveHotkeys, reverseMap, cmds, toHotkey);
		} else {
			this.renderKeyUpgradesTabContent(containerEl, hm, effectiveHotkeys, reverseMap, cmds, toHotkey);
		}
	}

	// macOS-style tab: the original Emacs-QSA table plus Displaced commands.
	private renderEmacsTabContent(
		containerEl: HTMLElement,
		hm: HotkeyManager,
		effectiveHotkeys: (cmdId: string) => BakedHotkey[],
		reverseMap: Map<string, string[]>,
		cmds: Record<string, { name: string }> | undefined,
		toHotkey: (hk: BakedHotkey) => Hotkey,
	): void {
		// Remove displaced commands whose original command now has any hotkey assigned
		this.plugin.settings.qsaDisplacedCommands = this.plugin.settings.qsaDisplacedCommands.filter(
			d => effectiveHotkeys(d.commandId).length === 0
		);

		// Desc contains the link to Obsidian's hotkeys settings
		new Setting(containerEl)
			.setName('No hotkeys are assigned by default')
			.then(setting => {
				setting.descEl.createSpan({ text: 'Set only the commands you want — group by group, or ' });
				const indivLink = setting.descEl.createEl('a', { text: 'Individually', cls: 'uch-inline-link' });
				indivLink.addEventListener('click', (e) => {
					e.preventDefault();
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
				});

		const applyEntry = (def: CommandDef, row: HotkeyRow) => {
			const fullId = getFullId(def);
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

		const makeEntries = (block: CommandDef['block']) =>
			COMMAND_DEFS.filter(d => d.block === block).map(def => ({ def, row: computeRow(def, effectiveHotkeys, reverseMap, cmds) }));

		this.renderBlock(table, 'Cursor movement', makeEntries('cursor'), ctx);
		this.renderBlock(table, 'Editing',         makeEntries('editing'), ctx);
		this.renderBlock(table, 'Other hotkeys',   makeEntries('other'), ctx);
		const tableSearchTerm = getTableCommandSearchTerm();
		this.renderCollapsibleBlock(table, 'Table structure', makeEntries('tableStructure'), ctx,
			{ get: () => this.tableStructureVisible, set: v => { this.tableStructureVisible = v; } },
			tableSearchTerm == null ? undefined : linkRow => {
				const searchLink = linkRow.createEl('a', { text: 'Open in hotkeys settings →', cls: 'uch-inline-link' });
				searchLink.addEventListener('click', (e) => {
					e.preventDefault();
					this.openHotkeysPanelFor(tableSearchTerm);
				});
			},
			new Set(['table-row-delete', 'table-col-delete']));
		this.renderCollapsibleBlock(table, 'Table navigation', makeEntries('tableNav'), ctx,
			{ get: () => this.tableNavVisible, set: v => { this.tableNavVisible = v; } });
		syncToggle();

		// Displaced commands table
		const dispTable = containerEl.createEl('table', { cls: 'uch-disp-table' });

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
	}

	// "for All users" tab — see computeKeyUpgradeRow's own doc comment for why
	// this is key-first rather than command-first like the Emacs tab's QSA
	// table. The actual defs live in the module-level KEY_UPGRADE_DEFS (also
	// feeds SPECIAL_KEY_EXCEPTION above) — just grouped here for rendering.
	private renderKeyUpgradesTabContent(
		containerEl: HTMLElement,
		hm: HotkeyManager,
		effectiveHotkeys: (cmdId: string) => BakedHotkey[],
		reverseMap: Map<string, string[]>,
		cmds: Record<string, { name: string }> | undefined,
		toHotkey: (hk: BakedHotkey) => Hotkey,
	): void {
		const NAV_BASICS_DEFS    = KEY_UPGRADE_DEFS.filter(d => d.group === 'navBasics');
		const WORD_COMMAND_DEFS  = KEY_UPGRADE_DEFS.filter(d => d.group === 'wordCommands');

		const keyUpgradeCtx: KeyUpgradeCtx = { hm, effectiveHotkeys, reverseMap, cmds, toHotkey };

		const keyUpgradesEl = containerEl.createDiv({ cls: 'uch-key-upgrades-section' });
		const keyUpgradesTitleFlex = keyUpgradesEl.createDiv('uch-title-flex');
		keyUpgradesTitleFlex.createSpan({ text: 'Key Upgrades', cls: 'uch-key-upgrades-title' });
		const eligible = KEY_UPGRADE_DEFS.filter(def => {
			const row = computeKeyUpgradeRow(def, keyUpgradeCtx.effectiveHotkeys, keyUpgradeCtx.reverseMap, keyUpgradeCtx.cmds);
			return !row.assigned && row.conflictIds.length === 0;
		});
		const applyAllBtn = keyUpgradesTitleFlex.createEl('button', { text: 'Apply all' });
		applyAllBtn.addClass('mod-cta', 'uch-apply-btn');
		if (eligible.length === 0) applyAllBtn.disabled = true;
		applyAllBtn.addEventListener('click', () => {
			for (const def of eligible) {
				const row = computeKeyUpgradeRow(def, keyUpgradeCtx.effectiveHotkeys, keyUpgradeCtx.reverseMap, keyUpgradeCtx.cmds);
				hm.setHotkeys(row.fullId, [...keyUpgradeCtx.effectiveHotkeys(row.fullId).map(toHotkey), row.targetHotkey]);
			}
			hm.save();
			hm.bake();
			void this.plugin.saveSettings();
			this.display();
		});

		keyUpgradesEl.createDiv({
			text: "Give your everyday keys table- and CJK-aware behavior. Some of these physical keys can't be reassigned in Obsidian's own Hotkeys panel; toggle them on here instead.",
			cls: 'uch-key-upgrades-desc',
		});

		const keyUpgradesTable = keyUpgradesEl.createEl('table');
		keyUpgradesTable.addClass('uch-table');
		this.renderKeyUpgradeGroup(
			keyUpgradesTable, 'Navigation basics',
			null,
			NAV_BASICS_DEFS, keyUpgradeCtx,
		);
		this.renderKeyUpgradeGroup(
			keyUpgradesTable, 'Word commands',
			"Chinese/Japanese word boundaries, which standard navigation and deletion don't recognize",
			WORD_COMMAND_DEFS, keyUpgradeCtx,
		);
	}

	private setHtmlDesc(setting: Setting, html: string): Setting {
		return setting.setDesc(sanitizeHTMLToDom(html));
	}
}
