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
};
// Mac keyboard cap glyphs — Backspace/Delete have no equivalent glyph
// convention on Windows, which spells them out as plain words instead.
const MAC_KEY_DISP: Record<string, string> = {
	Backspace: '⌫', Delete: '⌦',
};
const MOD_ORDER: Record<string, number> = { Mod: 0, Ctrl: 1, Alt: 2, Shift: 3, Meta: 4 };

export const normMods = (mods: string | string[]): string[] =>
	Array.isArray(mods) ? mods : (mods ? mods.split(',') : []);

export const hotkeyId = (hk: AnyHotkey): string =>
	normMods(hk.modifiers).sort().join('+') + '+' + hk.key.toLowerCase();

export const formatHotkey = (hk: AnyHotkey, isMacOS = Platform.isMacOS): string => {
	const mods = normMods(hk.modifiers).sort((a, b) => (MOD_ORDER[a] ?? 9) - (MOD_ORDER[b] ?? 9));
	const key  = (isMacOS ? MAC_KEY_DISP[hk.key] : undefined) ?? KEY_DISP[hk.key] ?? hk.key;
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
// A per-OS (modifiers, key) pair. Every KeyUpgradeDef entry carries one of
// each — mac and win — uniformly, even bare entries where the two are
// identical, rather than special-casing "same key, different modifier" vs.
// "different key entirely" (Document start/end needs the latter: Cmd+Up on
// Mac, but Ctrl+*Home*, not Ctrl+Up, on Windows) at the type level.
export interface KeyUpgradeHotkey {
	modifiers: Modifier[];
	key: string;
}

export interface KeyUpgradeDef {
	group: 'navBasics' | 'wordCommands';
	label: string;
	commandId: string;
	mac: KeyUpgradeHotkey;
	win: KeyUpgradeHotkey;
}

export interface KeyUpgradeRow {
	fullId: string;
	targetHotkey: Hotkey;
	assigned: boolean;
	conflictIds: string[];
}

// isMacStyle mirrors formatHotkey's own isMacOS default-param pattern (an
// explicit override for tests, defaulting to the real runtime check) —
// Linux/Android follow the Windows-style (Ctrl-based) convention here, iOS
// follows the Mac-style (Option/Cmd-based) one, matching each platform's own
// real external-keyboard shortcut conventions rather than a literal
// isMacOS/isWin/isLinux/isIosApp/isAndroidApp 5-way split.
export const isMacStyle = (override = Platform.isMacOS || Platform.isIosApp): boolean => override;

export const computeKeyUpgradeRow = (
	def: KeyUpgradeDef,
	effectiveHotkeys: (cmdId: string) => BakedHotkey[],
	reverseMap: Map<string, string[]>,
	cmds: Record<string, { name: string }> | undefined,
	macStyle: boolean = isMacStyle(),
): KeyUpgradeRow => {
	const fullId  = `${PLUGIN_ID}:${def.commandId}`;
	const { modifiers, key } = macStyle ? def.mac : def.win;
	const targetHotkey: Hotkey = { modifiers, key };
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
// Navigation basics is bare-key (works identically on every OS, mac==win)
// except Document start/end, which — like every wordCommands entry — is
// OS-conditional (see KeyUpgradeHotkey's own doc comment).
// Order within each group matches COMMAND_DEFS's own QSA ordering (cursor
// block, then editing block) — QSA is treated as the canonical order.
const bare = (key: string): { mac: KeyUpgradeHotkey; win: KeyUpgradeHotkey } => {
	const hk = { modifiers: [] as Modifier[], key };
	return { mac: hk, win: hk };
};
const KEY_UPGRADE_DEFS: readonly KeyUpgradeDef[] = [
	{ group: 'navBasics', label: 'Column-aware',      commandId: 'cursor-up',   ...bare('ArrowUp')   },
	{ group: 'navBasics', label: 'Column-aware',      commandId: 'cursor-down', ...bare('ArrowDown') },
	{ group: 'navBasics', label: '3-step Smart home', commandId: 'cursor-home', ...bare('Home')      },
	{ group: 'navBasics', label: 'Table-aware',       commandId: 'cursor-end',  ...bare('End')       },
	// Windows' own document-start/end convention uses Home/End (Ctrl+Home /
	// Ctrl+End), not the arrow keys Mac's Cmd+Up/Down uses — the key itself
	// changes, not just the modifier. Still no conflict with the bare
	// Home/End rows above: Ctrl+Home and bare Home are different hotkeys.
	{ group: 'navBasics', label: 'Document start — table-aware',
		commandId: 'cursor-top',
		mac: { modifiers: ['Meta'], key: 'ArrowUp' }, win: { modifiers: ['Ctrl'], key: 'Home' } },
	{ group: 'navBasics', label: 'Document end — table-aware',
		commandId: 'cursor-bottom',
		mac: { modifiers: ['Meta'], key: 'ArrowDown' }, win: { modifiers: ['Ctrl'], key: 'End' } },
	{ group: 'navBasics', label: 'Table-aware',       commandId: 'page-up',     ...bare('PageUp')   },
	{ group: 'navBasics', label: 'Table-aware',       commandId: 'page-down',   ...bare('PageDown') },
	{ group: 'wordCommands', label: 'Word right — table & CJK aware',
		commandId: 'word-right',
		mac: { modifiers: ['Alt'], key: 'ArrowRight' }, win: { modifiers: ['Ctrl'], key: 'ArrowRight' } },
	{ group: 'wordCommands', label: 'Word left — table & CJK aware',
		commandId: 'word-left',
		mac: { modifiers: ['Alt'], key: 'ArrowLeft' }, win: { modifiers: ['Ctrl'], key: 'ArrowLeft' } },
	// Real macOS convention confirmed live (2026-08-28): Option, not Cmd. The
	// physical "delete" key on a Mac keyboard sends Backspace; Fn+that key
	// sends Delete (forward-delete) — no separate "Fn" modifier exists to
	// bind, Fn just changes which key code is sent. Windows' own word-delete
	// convention (Ctrl+Backspace/Delete) uses the same two physical keys, so
	// only the modifier differs here, unlike Document start/end above.
	{ group: 'wordCommands', label: 'Kill word left — table & CJK aware',
		commandId: 'kill-word-left',
		mac: { modifiers: ['Alt'], key: 'Backspace' }, win: { modifiers: ['Ctrl'], key: 'Backspace' } },
	{ group: 'wordCommands', label: 'Kill word right — table & CJK aware',
		commandId: 'kill-word-right',
		mac: { modifiers: ['Alt'], key: 'Delete' }, win: { modifiers: ['Ctrl'], key: 'Delete' } },
];

// Derived from KEY_UPGRADE_DEFS's own bare (mac==win, no-modifier) entries
// only — this exception mechanism exists specifically to let a bare
// physical key (e.g. Home) coexist on the same command as a modified
// QSA-recommended key (e.g. Ctrl-A) without either blocking the other's own
// "already assigned" status. OS-conditional entries (Word left/right,
// Document start/end, Kill word left/right) don't need it — those commands
// have no QSA `recommended` hotkey to disambiguate against in the first
// place.
const SPECIAL_KEY_EXCEPTION: Partial<Record<string, string>> = Object.fromEntries(
	KEY_UPGRADE_DEFS
		.filter(d => d.mac.modifiers.length === 0 && d.win.modifiers.length === 0)
		.map(d => [d.commandId, d.mac.key])
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
	private get cursorMovementVisible() { return this.plugin.settings.qsaCursorMovementVisible; }
	private set cursorMovementVisible(v: boolean) { this.plugin.settings.qsaCursorMovementVisible = v; void this.plugin.saveSettings(); }
	private get editingVisible() { return this.plugin.settings.qsaEditingVisible; }
	private set editingVisible(v: boolean) { this.plugin.settings.qsaEditingVisible = v; void this.plugin.saveSettings(); }
	private get otherHotkeysVisible() { return this.plugin.settings.qsaOtherHotkeysVisible; }
	private set otherHotkeysVisible(v: boolean) { this.plugin.settings.qsaOtherHotkeysVisible = v; void this.plugin.saveSettings(); }
	private get tableStructureVisible() { return this.plugin.settings.qsaTableStructureVisible; }
	private set tableStructureVisible(v: boolean) { this.plugin.settings.qsaTableStructureVisible = v; void this.plugin.saveSettings(); }
	private get tableNavVisible() { return this.plugin.settings.qsaTableNavVisible; }
	private set tableNavVisible(v: boolean) { this.plugin.settings.qsaTableNavVisible = v; void this.plugin.saveSettings(); }
	private get displacedVisible() { return this.plugin.settings.qsaDisplacedVisible; }
	private set displacedVisible(v: boolean) { this.plugin.settings.qsaDisplacedVisible = v; void this.plugin.saveSettings(); }
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

		// Must run before renderQsaFrame: it may flip activeTab (switching to
		// the Vim tab), which renderQsaFrame reads to decide which tab to render.
		this.maybeAutoExpandVimSection();

		this.renderQsaFrame(containerEl);

		containerEl.scrollTop = scrollTop;
	}

	// Behavior Options used to be one fixed block shown below all three tabs
	// regardless of which was active — but each option only actually affects
	// a subset of tabs (Smart home affects all three; Smart join affects
	// Vim's `J` and Emacs's Kill Line join-at-EOL step; Visual line movement
	// and Cross-row navigation are Emacs-only; Double-click word select is
	// the only genuinely tab-agnostic one). Moved into each relevant tab's
	// own content instead, so a tab never shows an option it has no bearing
	// on. Smart home (standard/advanced) is the one option shared by all
	// three tabs — rendered independently in each (same underlying setting,
	// same onChange), since only one tab's content exists in the DOM at a
	// time anyway.
	//
	// Each toggle renders as a row in that tab's own shared table (same "one
	// <table>, many <tbody> groups" idiom as renderKeyUpgradeGroup), not a
	// standalone Setting block — colspan merges every column but the last
	// into one cell so the toggle itself lands in the same column as every
	// other row's own toggle/action cell in that table (Key Upgrades: 4
	// columns → colspan 3; Vim: 3 → colspan 2; Emacs: 5 → colspan 4). The
	// merged cell still uses Obsidian's own .setting-item-name/
	// .setting-item-description classes, so the name/description keep
	// their normal Setting-block typography despite no longer living
	// inside an actual Setting.

	// Group title row — a new tbody appended to the tab's own table.
	// colspan = that table's full column count.
	private renderBehaviorOptionsTitle(table: HTMLElement, colspan: number): HTMLElement {
		const tbody = table.createEl('tbody');
		const titleCell = tbody.createEl('tr').createEl('td');
		titleCell.colSpan = colspan;
		titleCell.addClass('uch-title-cell', 'uch-behavior-title-cell');
		titleCell.createDiv({ text: 'Behavior options', cls: 'uch-title-text' });
		return tbody;
	}

	// One toggle row. No this.display() on change (unlike Key Upgrade rows)
	// — nothing else on screen depends on a Behavior option's own value, so
	// the toggle's own setValue() is enough, matching this block's original
	// (pre-table) Setting-based behavior.
	private renderBehaviorToggleRow(
		tbody: HTMLElement,
		colspan: number,
		name: string,
		descHtml: string,
		value: boolean,
		onChange: (value: boolean) => void,
	): { tr: HTMLTableRowElement; toggle: ToggleComponent } {
		const tr = tbody.createEl('tr');
		tr.addClass('uch-row-thin', 'uch-behavior-row');
		const td = tr.createEl('td', { cls: 'uch-behavior-cell' });
		td.colSpan = colspan;
		td.createDiv({ text: name, cls: 'setting-item-name' });
		td.createDiv({ cls: 'setting-item-description' }).appendChild(sanitizeHTMLToDom(descHtml));
		const tdToggle = tr.createEl('td', { cls: 'uch-cell-toggle' });
		const toggle = new ToggleComponent(tdToggle);
		toggle.setValue(value);
		toggle.onChange((v) => onChange(v));
		return { tr, toggle };
	}

	// Smart home (standard/advanced), optionally with Smart join alongside
	// it (Vim and Emacs both need Smart join; Key Upgrades' bare HOME has no
	// join-adjacent command, so it omits it). The standard→advanced/join
	// disable-cascade is scoped to whichever toggles this call actually
	// renders.
	private renderSmartHomeToggles(tbody: HTMLElement, colspan: number, includeSmartJoin: boolean): void {
		let advancedRow: HTMLTableRowElement;
		let advancedToggle: ToggleComponent;
		let joinRow: HTMLTableRowElement | undefined;
		let joinToggle: ToggleComponent | undefined;
		const setStandardDisabled = (disabled: boolean) => {
			advancedRow.style.opacity       = disabled ? '0.4' : '';
			advancedRow.style.pointerEvents = disabled ? 'none' : '';
			if (disabled && this.plugin.settings.smartHomeAdvanced) {
				this.plugin.settings.smartHomeAdvanced = false;
				advancedToggle.setValue(false);
				void this.plugin.saveSettings();
			}
			if (joinRow) {
				joinRow.style.opacity       = disabled ? '0.4' : '';
				joinRow.style.pointerEvents = disabled ? 'none' : '';
				if (disabled && this.plugin.settings.smartJoin) {
					this.plugin.settings.smartJoin = false;
					joinToggle!.setValue(false);
					void this.plugin.saveSettings();
				}
			}
		};

		this.renderBehaviorToggleRow(tbody, colspan, 'Smart home (standard)', '' +
			'<b>ON:</b> HOME skips leading Markdown syntax (lists, checkboxes, indents, etc.) to reach content start — Windows Home / macOS Cmd+← style.<br>' +
			'<b>OFF:</b> HOME moves directly to the start of the line — macOS / Emacs Ctrl+A style.',
			this.plugin.settings.smartHomeStandard,
			(value) => {
				this.plugin.settings.smartHomeStandard = value;
				setStandardDisabled(!value);
				void this.plugin.saveSettings();
			});

		const advancedResult = this.renderBehaviorToggleRow(tbody, colspan, 'Smart home (advanced)', '' +
			'<b>ON:</b> Also skips past headings (<code>#</code>), footnotes (<code>[^1]:</code>), and callout type markers (<code>[!type]</code>).<br>' +
			'<i>Requires <b>Smart home (standard)</b> to be enabled.</i>',
			this.plugin.settings.smartHomeAdvanced,
			(value) => {
				this.plugin.settings.smartHomeAdvanced = value;
				void this.plugin.saveSettings();
			});
		advancedRow = advancedResult.tr;
		advancedToggle = advancedResult.toggle;

		if (includeSmartJoin) {
			const joinResult = this.renderBehaviorToggleRow(tbody, colspan, 'Smart join', '' +
				'<b>ON:</b> Kill Line join (Emacs) and <code>J</code> (Vim) land at the next line\'s content start, removing blockquote markers, list markers, and indentation. Pairs with Smart home (advanced) for headings and footnotes.<br>' +
				'<b>OFF:</b> Joins the next line as-is.<br>' +
				'<i>Requires <b>Smart home (standard)</b> to be enabled.</i>',
				this.plugin.settings.smartJoin,
				(value) => {
					this.plugin.settings.smartJoin = value;
					void this.plugin.saveSettings();
				});
			joinRow = joinResult.tr;
			joinToggle = joinResult.toggle;
		}

		setStandardDisabled(!this.plugin.settings.smartHomeStandard);
	}

	// Emacs-only: LEFT/HOME/RIGHT/END row-wrapping behavior.
	private renderCrossRowNavigationToggle(tbody: HTMLElement, colspan: number): void {
		this.renderBehaviorToggleRow(tbody, colspan, 'Cross-row navigation', '' +
			'<b>ON:</b> LEFT/HOME at the leftmost cell and RIGHT/END at the rightmost cell wrap to the adjacent row.<br>' +
			'<b>OFF:</b> Stops at the boundary.',
			this.plugin.settings.crossRowNavigation,
			(value) => {
				this.plugin.settings.crossRowNavigation = value;
				void this.plugin.saveSettings();
			});
	}

	// Emacs-only: HOME/END's visual-line-first step.
	private renderVisualLineMovementToggle(tbody: HTMLElement, colspan: number): void {
		this.renderBehaviorToggleRow(tbody, colspan, 'Visual line movement', '' +
			'<b>ON:</b> HOME/END first moves to the visual line edge, then to the logical line start/end.<br>' +
			'<b>OFF:</b> Moves directly to the logical line start/end.',
			this.plugin.settings.visualLineMovement,
			(value) => {
				this.plugin.settings.visualLineMovement = value;
				void this.plugin.saveSettings();
			});
	}

	// Tab-agnostic: works the same regardless of Vim/Emacs/Key Upgrades usage
	// — lives in the "For everyone" tab as the one option genuinely for everyone.
	private renderDoubleClickWordSelectToggle(tbody: HTMLElement, colspan: number): void {
		this.renderBehaviorToggleRow(tbody, colspan, 'Double-click word select', '' +
			'<b>ON:</b> Selects just the CJK word at the click position, not the whole unbroken run — dragging extends a word at a time.<br>' +
			'<b>OFF:</b> Uses Obsidian\'s native double-click selection.',
			this.plugin.settings.cjkDoubleClickWordSelect,
			(value) => {
				this.plugin.settings.cjkDoubleClickWordSelect = value;
				void this.plugin.saveSettings();
			});
	}

	// One-time nudge: if the user opens settings with Obsidian's own "Vim key
	// bindings" core setting on and has never seen this auto-switch fire
	// before, switch to the Vim tab, since a Vim-mode user likely wants that
	// tab first. Never fires again afterward, so it never fights a user's
	// own later tab choice (see the vimAutoExpandDone doc comment in main.ts).
	private maybeAutoExpandVimSection(): void {
		if (this.plugin.settings.vimAutoExpandDone) return;
		const vault = (this.app as unknown as ObsidianInternals).vault;
		const vimModeOn = vault.getConfig?.('vimMode') === true;
		if (!vimModeOn) return;
		this.activeTab = 'vim';
		this.plugin.settings.vimAutoExpandDone = true;
		void this.plugin.saveSettings();
	}

	// Vim tab's compact toggle rows (key chip | short label | toggle) — no
	// status column like Key Upgrades' own table, since these aren't
	// key/command bindings with a conflict concept; just existing native vim
	// keys getting a behavior upgrade. tooltip surfaces a live prerequisite
	// (e.g. Smart home (standard) must be on) without repeating it as prose —
	// note the toggle itself isn't disabled by an unmet prerequisite, since
	// every one of these already self-gates at call time (falls back to
	// vim's own native behavior until the prerequisite is turned on).
	private renderVimToggleRow(tbody: HTMLElement, keys: string[], label: string, value: boolean, onChange: (value: boolean) => void, tooltip?: string): void {
		const tr = tbody.createEl('tr');
		tr.addClass('uch-row-thin');

		const tdKey = tr.createEl('td', { cls: 'uch-cell-name' });
		for (const k of keys) {
			tdKey.createSpan({ text: k, cls: 'uch-kbd' });
			tdKey.appendText(' ');
		}

		tr.createEl('td', { text: label, cls: 'uch-key-upgrade-label' });

		const tdToggle = tr.createEl('td', { cls: 'uch-cell-toggle' });
		if (tooltip) tdToggle.title = tooltip;
		const toggle = new ToggleComponent(tdToggle);
		toggle.setValue(value);
		toggle.onChange((v) => {
			onChange(v);
			this.display();
		});
	}

	// Vim tab's richer "Table commands" rows (Table structure/navigation) —
	// row 1 is the same 3-column shape as renderVimToggleRow (key chip |
	// label | toggle), so key chips and toggles still align with the Motion
	// Upgrades rows above in the same shared table; row 2 is a full-width,
	// indented detail row (ON/command-table/OFF), styled to match this
	// content's original look from before it lived in a table (a Setting's
	// own .setting-item-description sizing/color).
	private renderVimCommandRow(tbody: HTMLElement, keys: string[], label: string, detailHtml: string, value: boolean, onChange: (value: boolean) => void): void {
		const tr = tbody.createEl('tr');
		tr.addClass('uch-row-thin');

		// Key chip(s) + label share one cell — keeping them as separate
		// columns left an inconsistent gap depending on the leader key's own
		// width (e.g. "\" vs "Space"), and they read as one continuous label
		// anyway ("[Space] [t] Table structure...").
		const tdKey = tr.createEl('td', { cls: 'uch-cell-name' });
		tdKey.colSpan = 2;
		for (const k of keys) {
			tdKey.createSpan({ text: k, cls: 'uch-kbd' });
			tdKey.appendText(' ');
		}
		tdKey.createSpan({ text: label, cls: 'uch-key-upgrade-label' });

		const tdToggle = tr.createEl('td', { cls: 'uch-cell-toggle' });
		const toggle = new ToggleComponent(tdToggle);
		toggle.setValue(value);
		toggle.onChange((v) => {
			onChange(v);
			this.display();
		});

		const detailTr = tbody.createEl('tr');
		detailTr.addClass('uch-row-thin');
		const detailTd = detailTr.createEl('td', { cls: 'uch-vim-cmd-detail' });
		detailTd.colSpan = 3;
		detailTd.appendChild(sanitizeHTMLToDom(detailHtml));
	}

	// Vim mode tab content — the frame's own header/tab-bar (renderQsaFrame)
	// owns visibility now, so this only renders once the Vim tab is actually
	// selected; no own Show/Hide, no own visibility bookkeeping needed.
	private renderVimTabContent(containerEl: HTMLElement): void {
		const vimHeaderEl = containerEl.createDiv({ cls: 'uch-key-upgrades-section' });
		vimHeaderEl.createDiv({
			cls: 'uch-key-upgrades-desc',
			text: "Fixes Obsidian's built-in Vim mode's cursor behavior inside Markdown tables, and adds commands for table editing and navigation.",
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

		const vimTable = containerEl.createEl('table');
		vimTable.addClass('uch-table');

		const motionTbody = vimTable.createEl('tbody');
		const motionTitleCell = motionTbody.createEl('tr').createEl('td');
		motionTitleCell.colSpan = 3;
		motionTitleCell.addClass('uch-title-cell');
		motionTitleCell.createDiv({ text: 'Motion upgrades', cls: 'uch-title-text' });
		motionTitleCell.createDiv({
			text: "Each toggle below replaces one native motion in Obsidian's own built-in Vim mode — turning it off restores its original, unmodified behavior.",
			cls: 'uch-key-upgrade-group-desc',
		});
		motionTitleCell.createDiv({
			text: 'Smart home / Smart join extend cursor movement and line joining to be more Markdown-aware, once enabled further down this page.',
			cls: 'uch-key-upgrade-group-desc',
		});
		this.renderVimToggleRow(motionTbody, ['h', 'l', 'x'], 'Table-aware',
			this.plugin.settings.vimHlSupport,
			(v) => this.plugin.vimSupport.setHlEnabled(v));
		this.renderVimToggleRow(motionTbody, ['j', 'k'], 'Column-aware',
			this.plugin.settings.vimJkSupport,
			(v) => this.plugin.vimSupport.setJkEnabled(v));
		this.renderVimToggleRow(motionTbody, ['w', 'b', 'e'], 'Table & CJK aware',
			this.plugin.settings.vimWordSupport,
			(v) => this.plugin.vimSupport.setWordsEnabled(v));
		this.renderVimToggleRow(motionTbody, ['gg', 'G'], 'Table-aware',
			this.plugin.settings.vimGgSupport,
			(v) => this.plugin.vimSupport.setGgEnabled(v));
		this.renderVimToggleRow(motionTbody, ['gj', 'gk'], 'Column-aware',
			this.plugin.settings.vimDisplayLineSupport,
			(v) => this.plugin.vimSupport.setDisplayLinesEnabled(v));
		this.renderVimToggleRow(motionTbody, ['$'], 'Sticky column',
			this.plugin.settings.vimEolSupport,
			(v) => this.plugin.vimSupport.setEolEnabled(v));
		this.renderVimToggleRow(motionTbody, ['^', 'I'], 'Smart home',
			this.plugin.settings.vimCaretSupport,
			(v) => this.plugin.vimSupport.setCaretEnabled(v),
			'Requires Smart home (standard) to be enabled — also follows whatever Smart home (advanced) is set to.');
		this.renderVimToggleRow(motionTbody, ['J'], 'Smart join',
			this.plugin.settings.vimJoinSupport,
			(v) => this.plugin.vimSupport.setJoinEnabled(v),
			'Requires Smart join to be enabled.');
		const motionSpacerTd = motionTbody.createEl('tr').createEl('td', { cls: 'uch-block-spacer' });
		motionSpacerTd.colSpan = 3;

		const tableCmdTbody = vimTable.createEl('tbody');
		const tableCmdTitleCell = tableCmdTbody.createEl('tr').createEl('td');
		tableCmdTitleCell.colSpan = 3;
		tableCmdTitleCell.addClass('uch-title-cell');
		const tableCmdTitleFlex = tableCmdTitleCell.createDiv('uch-title-flex');
		tableCmdTitleFlex.createSpan({ text: 'Table commands', cls: 'uch-title-text' });
		const applyBothBtn = tableCmdTitleFlex.createEl('button', { text: 'Apply both' });
		applyBothBtn.addClass('mod-cta', 'uch-apply-btn');
		if (this.plugin.settings.vimTableStructureSupport && this.plugin.settings.vimTableNavigationSupport) {
			applyBothBtn.disabled = true;
		}
		applyBothBtn.addEventListener('click', () => {
			this.plugin.vimSupport.setTableStructureEnabled(true);
			this.plugin.vimSupport.setTableNavigationEnabled(true);
			this.display();
		});

		const leader = this.plugin.settings.vimLeaderUseBackslash ? '\\' : 'Space';
		const kbd = (s: string) => '<span class="uch-kbd">' + leader + '</span> <span class="uch-kbd">' + s + '</span>';
		const kbdMulti = (...keys: string[]) => '<span class="uch-kbd">' + leader + '</span> ' + keys.map(k => '<span class="uch-kbd">' + k + '</span>').join(' / ');

		this.renderVimCommandRow(tableCmdTbody, [leader, 't'], 'Table structure (16 commands)', '' +
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
			'<b>OFF:</b> No leader-key table structure commands are bound.',
			this.plugin.settings.vimTableStructureSupport,
			(v) => this.plugin.vimSupport.setTableStructureEnabled(v));

		this.renderVimCommandRow(tableCmdTbody, [leader, 't'], 'Table navigation (6 commands)', '' +
			'<b>ON:</b> Adds the commands below. While this is on, a bare press of the leader key no longer behaves as vim\'s own native binding (Space normally moves right).' +
			'<table class="uch-vim-cmd-table">' +
			'<tr><th></th><th>Row</th><th>Column</th></tr>' +
			'<tr><td>Move to cell</td><td>' + kbdMulti('t j', 't k') + '<br>(below/above)</td><td>' + kbdMulti('t h', 't l') + '<br>(left/right)</td></tr>' +
			'<tr><td>Exit table</td><td colspan="2">' + kbdMulti('t x', 't X') + '<br>(below/above)</td></tr>' +
			'</table>' +
			'<b>OFF:</b> No leader-key table navigation commands are bound.',
			this.plugin.settings.vimTableNavigationSupport,
			(v) => this.plugin.vimSupport.setTableNavigationEnabled(v));

		this.renderVimCommandRow(tableCmdTbody, [], 'Leader key', '' +
			'<b>ON:</b> Uses <span class="uch-kbd">\\</span> as leader key for the table structure/navigation commands above.<br>' +
			'<b>OFF:</b> Uses <span class="uch-kbd">Space</span> as leader key (default).<br>' +
			'<i>Only affects table structure/navigation above — has no effect on its own.</i>',
			this.plugin.settings.vimLeaderUseBackslash,
			(v) => this.plugin.vimSupport.setLeaderUseBackslash(v));

		const vimBehaviorTbody = this.renderBehaviorOptionsTitle(vimTable, 3);
		this.renderSmartHomeToggles(vimBehaviorTbody, 2, true);

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

	// Collapsible — every block under Hotkey settings shares the same ▶/▼
	// affordance (see renderCollapsibleBlock's own doc comment on why a
	// toggleable title, not a Show/Hide button, is used here), signaling
	// "this is a child of Hotkey settings" uniformly regardless of each
	// block's own default open/closed state. Split across header/content
	// tbody for the same reason renderCollapsibleBlock is: the title (and
	// its Apply recommended button) must stay visible even while the
	// content underneath is collapsed.
	private renderBlock(
		table: HTMLElement,
		title: string,
		entries: Array<{def: CommandDef; row: HotkeyRow}>,
		ctx: RenderCtx,
		visible: { get(): boolean; set(v: boolean): void },
	): HTMLTableSectionElement {
		const headerTbody = table.createEl('tbody');

		// Title row
		const titleRow = headerTbody.createEl('tr');
		const titleCell = titleRow.createEl('td');
		titleCell.colSpan = 5;
		titleCell.addClass('uch-title-cell');
		const titleFlex = titleCell.createDiv('uch-title-flex');
		const toggleLabel = titleFlex.createSpan({
			text: `${visible.get() ? '▼' : '▶'} ${title}`,
			cls: 'uch-title-text uch-block-toggle',
		});
		const setAllBtn = titleFlex.createEl('button', { text: 'Apply recommended' });
		setAllBtn.addClass('mod-cta', 'uch-apply-btn');
		if (!entries.some(e => e.row.action === 'set' || e.row.action === 'override'))
			setAllBtn.disabled = true;
		setAllBtn.addEventListener('click', () => { ctx.applyBlock(entries); });

		const contentTbody = table.createEl('tbody');
		contentTbody.toggleClass('uch-hidden', !visible.get());
		toggleLabel.addEventListener('click', () => {
			visible.set(!visible.get());
			toggleLabel.setText(`${visible.get() ? '▼' : '▶'} ${title}`);
			contentTbody.toggleClass('uch-hidden', !visible.get());
		});

		// Column header row
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

		// Data rows
		for (const { def, row } of entries) {
			this.renderDataRow(contentTbody, def, row, ctx);
		}

		if (entries.some(e => e.row.action === 'override')) {
			const noteRow = contentTbody.createEl('tr');
			const noteTd = noteRow.createEl('td', { cls: 'uch-override-note' });
			noteTd.colSpan = 5;
			noteTd.appendText('"');
			noteTd.createEl('strong', { text: 'Override', cls: 'uch-override-word' });
			noteTd.appendText('" reassigns the hotkey to this plugin\'s command, removing it from the command currently using it. Commands left with no remaining hotkeys appear in Displaced commands below.');
			ctx.allOverrideNotes.push(noteRow);
		}

		const spacerTd = contentTbody.createEl('tr').createEl('td', { cls: 'uch-block-spacer' });
		spacerTd.colSpan = 5;
		return contentTbody;
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
			tdStatus.createEl('a', { text: assigned ? '🔴Conflict' : '🔴Used', cls: 'uch-cmd-link' })
				.addEventListener('click', (e) => { e.preventDefault(); this.openHotkeysPanelByKey(targetHotkey); });
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
		titleCell.addClass('uch-title-cell', 'uch-title-cell-tall');
		// padding-top always stays fixed (from .uch-title-cell-tall) — only
		// padding-bottom toggles with collapse state, so the heading text's
		// own vertical position never moves when clicked, unlike the earlier
		// min-height/align-items:center approach (which re-centered the text
		// within a changing box height and made it visibly jump).
		titleCell.toggleClass('uch-title-cell-expanded', visible.get());
		const toggleLabel = titleCell.createSpan({
			text: `${visible.get() ? '▼' : '▶'} ${title}`,
			cls: 'uch-title-text uch-block-toggle',
		});

		const contentTbody = table.createEl('tbody');
		contentTbody.toggleClass('uch-hidden', !visible.get());
		toggleLabel.addEventListener('click', () => {
			visible.set(!visible.get());
			toggleLabel.setText(`${visible.get() ? '▼' : '▶'} ${title}`);
			titleCell.toggleClass('uch-title-cell-expanded', visible.get());
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

	// Always-visible 3-tab bar (general/vim/emacs, sharing activeTab) and
	// whichever one tab's own content. Only the active tab's DOM is ever
	// built (matching this file's existing "any state change -> full
	// containerEl.empty()+rebuild" idiom already used everywhere else), so
	// there's no separate hidden-tab visibility bookkeeping to maintain.
	private renderQsaFrame(containerEl: HTMLElement): void {
		const tabBar = containerEl.createDiv({ cls: 'uch-tab-bar' });
		const TABS: ReadonlyArray<{ id: 'general' | 'vim' | 'emacs'; label: string }> = [
			{ id: 'general', label: 'For everyone' },
			{ id: 'vim',   label: 'Vim mode' },
			{ id: 'emacs', label: 'macOS (Emacs) style' },
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

		// Pane heading + desc (desc contains the link to Obsidian's hotkeys settings)
		const emacsHeaderEl = containerEl.createDiv({ cls: 'uch-key-upgrades-section' });
		emacsHeaderEl.createDiv({ text: 'Hotkey settings', cls: 'uch-key-upgrades-title' });
		const emacsDescEl = emacsHeaderEl.createDiv({ cls: 'uch-key-upgrades-desc' });
		emacsDescEl.createSpan({ text: "Recreates macOS-style cursor and editing shortcuts using Obsidian's own hotkey system. (No hotkeys are assigned by default.) Set only the commands you want — group by group, or " });
		const indivLink = emacsDescEl.createEl('a', { text: 'Individually', cls: 'uch-inline-link' });
		indivLink.addEventListener('click', (e) => {
			e.preventDefault();
			this.individualVisible = true;
			syncToggle();
		});
		emacsDescEl.createSpan({ text: '. To assign a command to a key other than the recommended, use ' });
		const hotkeyLink = emacsDescEl.createEl('a', { text: "Obsidian's built-in hotkeys settings" });
		hotkeyLink.addClass('uch-inline-link');
		hotkeyLink.addEventListener('click', (e) => {
			e.preventDefault();
			this.openHotkeysPanelFor('universal-cursor-hotkeys');
		});
		emacsDescEl.createSpan({ text: '.' });

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

		this.renderBlock(table, 'Cursor movement', makeEntries('cursor'), ctx,
			{ get: () => this.cursorMovementVisible, set: v => { this.cursorMovementVisible = v; } });
		this.renderBlock(table, 'Editing',         makeEntries('editing'), ctx,
			{ get: () => this.editingVisible, set: v => { this.editingVisible = v; } });
		this.renderBlock(table, 'Other hotkeys',   makeEntries('other'), ctx,
			{ get: () => this.otherHotkeysVisible, set: v => { this.otherHotkeysVisible = v; } });
		const tableSearchTerm = getTableCommandSearchTerm();
		this.renderCollapsibleBlock(table, 'Table structure', makeEntries('tableStructure'), ctx,
			{ get: () => this.tableStructureVisible, set: v => { this.tableStructureVisible = v; } },
			tableSearchTerm == null ? undefined : linkRow => {
				linkRow.createSpan({ text: "These are Obsidian's own built-in table commands, not owned by this plugin — listed here for convenience. " });
				const searchLink = linkRow.createEl('a', { text: `Open in hotkeys settings (about "${tableSearchTerm}") →`, cls: 'uch-inline-link' });
				searchLink.addEventListener('click', (e) => {
					e.preventDefault();
					this.openHotkeysPanelFor(tableSearchTerm);
				});
			},
			new Set(['table-row-delete', 'table-col-delete']));
		this.renderCollapsibleBlock(table, 'Table navigation', makeEntries('tableNav'), ctx,
			{ get: () => this.tableNavVisible, set: v => { this.tableNavVisible = v; } });
		syncToggle();

		// Displaced commands table — collapsible like every other block under
		// Hotkey settings (see renderBlock's own doc comment on why).
		const dispTable = containerEl.createEl('table', { cls: 'uch-disp-table' });

		const dispHeaderTbody = dispTable.createEl('tbody');
		const dispTitleCell = dispHeaderTbody.createEl('tr').createEl('td', { cls: 'uch-title-cell uch-title-cell-tall' });
		dispTitleCell.colSpan = 5;
		dispTitleCell.toggleClass('uch-title-cell-expanded', this.displacedVisible);
		const dispToggleLabel = dispTitleCell.createSpan({
			text: `${this.displacedVisible ? '▼' : '▶'} Displaced commands`,
			cls: 'uch-title-text uch-block-toggle',
		});

		const dispTbody = dispTable.createEl('tbody');
		dispTbody.toggleClass('uch-hidden', !this.displacedVisible);
		dispToggleLabel.addEventListener('click', () => {
			this.displacedVisible = !this.displacedVisible;
			dispToggleLabel.setText(`${this.displacedVisible ? '▼' : '▶'} Displaced commands`);
			dispTitleCell.toggleClass('uch-title-cell-expanded', this.displacedVisible);
			dispTbody.toggleClass('uch-hidden', !this.displacedVisible);
		});

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

		const emacsBehaviorTbody = this.renderBehaviorOptionsTitle(dispTable, 5);
		this.renderSmartHomeToggles(emacsBehaviorTbody, 4, true);
		this.renderVisualLineMovementToggle(emacsBehaviorTbody, 4);
		this.renderCrossRowNavigationToggle(emacsBehaviorTbody, 4);
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
			text: "Give your everyday keys table-aware behavior and CJK-aware word splitting.",
			cls: 'uch-key-upgrades-desc',
		});

		const keyUpgradesTable = containerEl.createEl('table');
		keyUpgradesTable.addClass('uch-table', 'uch-key-upgrades-table');
		this.renderKeyUpgradeGroup(
			keyUpgradesTable, 'Upgrade navigation basics',
			null,
			NAV_BASICS_DEFS, keyUpgradeCtx,
		);
		this.renderKeyUpgradeGroup(
			keyUpgradesTable, 'Upgrade word commands',
			null,
			WORD_COMMAND_DEFS, keyUpgradeCtx,
		);

		const everyoneBehaviorTbody = this.renderBehaviorOptionsTitle(keyUpgradesTable, 4);
		this.renderSmartHomeToggles(everyoneBehaviorTbody, 3, false);
		this.renderDoubleClickWordSelectToggle(everyoneBehaviorTbody, 3);
	}
}
