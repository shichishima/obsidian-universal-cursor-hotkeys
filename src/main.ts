import { Editor, Plugin, MarkdownView, Scope, Modifier } from 'obsidian';
import { UniversalCursorHotkeysSettingTab, DisplacedCommand } from './settings';
import { VimSupport } from './vim-support';
import { InCellLineInfo, getCellBounds, getStartOfCellContent, getEndOfCellContent,
	getEndOfCellContentByCellIndex, getRightmostCellIndex, getCellIndex, getChByCellIndex,
	getInCellLineInfo, getPipePositions } from './table-cell-utils';
import { setTimeoutOnActiveWindow, requestAnimationFrameOnActiveWindow } from './dom-timers';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from "@codemirror/view";
import { EditorSelection, SelectionRange, Transaction, findClusterBreak } from '@codemirror/state';
import { deleteCharForward, cursorPageDown, cursorPageUp } from '@codemirror/commands';
import { getWordSpans, getBigWordSpans, findWordSpanOnLine } from './word-segmentation';
import { exitTable, jumpAdjacentCell } from './table-navigation';
import { cjkWordSelectionStyle } from './cjk-word-select';

// 0.13.0 Feature 1: the note title field is a plain contenteditable, no
// CM6 involved. `[contenteditable='true']` excludes any read-only-mode
// rendering of the same class, matching ksanrse/obsidian-custom-cursor's
// own selector for the same element.
const TITLE_SELECTOR = ".inline-title[contenteditable='true']";

// 0.13.0 Feature 1, frontmatter sub-phase: a Properties-panel row, in its
// own "item selection mode" (confirmed live: Escape twice from inside a
// property's text editing collapses focus to the row DIV itself,
// tabIndex=0 — distinct from any of its own text-editing descendants
// having focus, which is a separate, later phase's concern). Also
// matches the panel's own heading ("Properties") and its trailing
// "Add property" button — both are real tabIndex=0 focus targets in the
// same row-to-row ArrowUp/Down navigation chain, confirmed live.
const PROPERTY_PANEL_FOCUS_SELECTOR =
	'.metadata-property, .metadata-properties-heading, .metadata-add-button';

// Bases re-verification follow-up: a Bases table view's own "cell
// selection mode" (reached via Escape from a cell's edit mode, or by
// clicking a cell and immediately pressing Escape) keeps real DOM
// focus on this one container element for the whole table, NEVER on
// any individual cell — confirmed live that physical arrow keys move
// an internal "active cell" marker (a CSS class on the relevant
// `.bases-td`, confirmed present via a DOM search) while this
// container stays focused throughout. Confirmed live (not assumed)
// that a SYNTHETIC ArrowUp/Down/Left/Right dispatch on this container,
// while it has focus, moves that same internal marker exactly like a
// real press does — verified by pressing Enter afterward and checking
// which cell actually entered edit mode. This is the same "delegate to
// native key" mechanism already used throughout this plugin (Key
// Upgrades, Properties item-selection's own Ctrl-N/P-as-Arrow
// dispatch) — grouped into PROPERTY_PANEL_FOCUS_SELECTOR alongside
// Properties' own row/heading/Add-button, since it plays the exact
// same role (a focused, non-editing "navigation mode" container that
// Ctrl-P/N/B/F should delegate to a native arrow-key dispatch for),
// even though it comes from an unrelated feature.
const BASES_TABLE_CONTAINER_SELECTOR = '.bases-table-container';

// 0.13.0 Feature 1, property-value-editing sub-phase: a text property's
// own VALUE-edit widget ("metadata-input-longtext", a contenteditable
// DIV) — confirmed live this is the exact same element Bases table
// cells use for inline text editing too, so this covers both for free.
// Deliberately narrower than PROPERTY_PANEL_FOCUS_SELECTOR (item
// selection mode, the row itself) — this is the row's VALUE actually
// being edited. Does NOT match the name/key-edit INPUT — see
// PROPERTY_KEY_EDIT_SELECTOR below, its own later phase.
const PROPERTY_VALUE_EDIT_SELECTOR = '.metadata-input-longtext';

// 0.13.0 Feature 1, property NAME (key) editing phase: the property's
// own name field, "metadata-property-key-input" — a real <input
// type="text">, NOT a contenteditable like PROPERTY_VALUE_EDIT_SELECTOR
// or the title field. Confirmed live this means document.getSelection()
// doesn't apply to its internal text at all (a plain <input>'s own
// selection is a separate, form-control-internal model exposed via
// selectionStart/selectionEnd/setSelectionRange/selectionDirection) —
// every handler for this selector is its own, new implementation
// (propertyKeyMoveChar etc.), not a reuse of titleMoveChar/
// titleSelectionModify. execCommand('delete'/'insertText') DOES still
// respect this element's own selectionStart/selectionEnd exactly like
// it respects document.getSelection() for a contenteditable, confirmed
// live (including persistence to frontmatter after blur) — so Kill/
// Yank reuse the exact same execCommand technique as the title field,
// just targeting this element's own selection model instead.
//
// A real regression (caught by propertyItemSelection.e2e.ts) was found
// and fixed while wiring this up: this input has its OWN native
// two-stage Escape handling (close its own name-suggester dropdown
// first, exit to the row second). A plain document-level keydown
// listener (bypassing app.keymap's Scope system entirely) was tried
// first, reasoning that none of this phase's commands have any
// pre-existing native/Obsidian claim to lose precedence against — but
// that assumption was WRONG: Obsidian's own global command-hotkey
// resolution claims (stops propagation for) ANY key combo that matches
// a REGISTERED command's hotkey, REGARDLESS of whether an editor is
// actually focused, confirmed live with a raw addEventListener dump
// showing the second key of a Ctrl+F combo never arriving at all once
// cursor-right had a real hotkey assigned — since cursor-left/right/
// home/end/etc. are the exact same commandIds already used elsewhere in
// this plugin (all with real, user-assignable hotkeys), a plain
// listener can never reach them this way. Back to app.keymap's Scope
// system it is — see UCH_INTERNAL_ESCAPE_REDISPATCH_FLAG's own comment
// for how the OTHER half of this (not breaking the native two-stage
// Escape, and not breaking keyboard-quit's own re-dispatch for every
// OTHER value-widget type sharing the same scope instance) is resolved.
const PROPERTY_KEY_EDIT_SELECTOR = '.metadata-property-key-input';

// 0.13.0 Feature 1, property-value-editing's own follow-up phase:
// checkbox/date/datetime/number's own value-edit elements. Confirmed
// live (diagnostic probes, not assumed) that date/datetime have NO
// usable Selection API at all AND that a synthetic-dispatched Arrow
// key does NOT trigger their native stepping behavior either (their
// own segmented year/month/day stepping is a genuine browser-engine
// default action, gated on trusted events — same category as plain
// text-caret movement, confirmed NOT reproducible via dispatchEvent(),
// only via a real browser.keys() press). number shares the same
// no-Selection-API wall (per project_frontmatter_property_dom_survey's
// own Category B finding) and was never in this phase's own Ctrl-PNBF
// scope to begin with (the user's own list only ever named date/
// datetime/list/tags/aliases for that). So all four get Ctrl-G (exit)
// only — no Ctrl-PNBF at all, there's nothing a plugin can do here
// with any public API. number was missing from this selector entirely
// until a real user report ("numberでCtrl-Gが効かない") caught the
// gap — confirmed live the same manual-Escape-dispatch mechanism
// already proven for the other three works identically here too.
// Root cause of a real, user-reported "Ctrl-PNBF stops working after
// disabling/re-enabling the plugin" bug (2026-11-12): this selector
// matched by bare `type` attribute alone, with no class scoping at all
// -- unlike every other selector in this file. Obsidian's own generic
// Setting-API toggle switch (used for the Community plugins enable/
// disable switch itself, and for every other boolean setting across
// the whole app, including other plugins' own settings tabs) is also
// a plain `<input type="checkbox">` with no distinguishing class.
// Confirmed live via [UCH-reload-diag]: clicking that exact toggle to
// re-enable this plugin leaves IT focused, `reconcileScopesWithFocus()`
// (run at the end of onload()) sees it, matches it against this
// selector, and wrongly pushes propertyRowScope for it -- which then
// sits on top of the real stack swallowing keys (Ctrl-F included) that
// should have reached whatever's genuinely focused instead. Scoped to
// each property-specific class instead (confirmed in Obsidian's own
// app.js: `metadata-input-checkbox`, `metadata-input-text.mod-date`,
// `metadata-input-text.mod-datetime`, `metadata-input-number`) so a
// same-typed input anywhere outside the metadata/Bases editor can never
// match this again.
const PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR =
	'input.metadata-input-checkbox, input.metadata-input-text.mod-date, input.metadata-input-text.mod-datetime, input.metadata-input-number';

// multitext/tags/aliases all share this one trailing, currently-being-
// composed chip (a real contenteditable DIV) — confirmed live it DOES
// support the same Selection API the text type's own value-edit widget
// uses (titleMoveChar/titleMoveWord etc. already work there unchanged,
// no multi-select-specific logic needed), unlike checkbox/date/datetime
// above. Doesn't cover the already-committed pills themselves (opaque,
// non-editable chips) — pill-to-pill navigation is a separate, still
// unexplored question, out of scope for this phase.
const PROPERTY_MULTISELECT_INPUT_SELECTOR = '.multi-select-input';

// A committed list/tags/aliases "pill" (chip) — opaque, non-editable,
// confirmed live to receive real DOM focus when ArrowLeft/Right is
// pressed from the trailing input at its own start/end (see
// PROPERTY_MULTISELECT_INPUT_SELECTOR's own comment on why pill-to-pill
// navigation itself stays out of scope). Added to
// PROPERTY_ANY_VALUE_WIDGET_SELECTOR below purely so propertyRowScope
// doesn't get torn down while a pill has focus — confirmed live it
// otherwise does (via the focusout handler's own
// PROPERTY_PANEL_SCOPE_SELECTOR check matching the INPUT on its way
// out), silently breaking Ctrl-G (and every other command) the moment
// ArrowLeft/Right moves focus onto an existing pill, user-reported.
const PROPERTY_MULTISELECT_PILL_SELECTOR = '.multi-select-pill';

// The multi-select trailing input's own "previously used values"
// suggester (confirmed live via a DOM dump: a `.suggestion-container
// mod-property-value` holding `.suggestion-item` DIVs, one of which
// carries `.is-selected` once more than one item is present — a
// single-item list doesn't seem to mark anything as selected at all,
// confirmed live). Scoped to `.mod-property-value`/`.mod-property-key`
// specifically, not every `.suggestion-container` in Obsidian (e.g. the
// command palette uses the same base class) — this plugin has no
// business touching any OTHER suggester type.
//
// `.mod-property-key` (the name/key-edit field's own "previously used
// property names" suggester) was confirmed live to share the exact
// same DOM shape and the exact same lack of keyboard support — a real
// physical ArrowDown, this plugin's own Ctrl-N, and a real physical
// Enter all left `.is-selected` unchanged, and Enter inserted the
// literally-typed text instead of committing the highlighted item,
// same as `.mod-property-value`. So the same from-scratch navigation
// below covers both for free, just by broadening this one selector.
//
// Confirmed live this dropdown supports NO keyboard navigation
// whatsoever, native OR otherwise: a real physical ArrowDown, this
// plugin's own Ctrl-N, and a real physical Enter all left
// `.is-selected` on the exact same item it started on, and Enter
// didn't commit the highlighted item either — it just inserted
// whatever was literally typed as a brand-new pill, with the
// suggester still open afterward. It's a pure mouse-click-only UI
// component, which is WHY Ctrl-N/P navigation and Enter-to-commit
// below have to be implemented from scratch (toggling `.is-selected`
// ourselves, committing via a synthetic click on the highlighted item
// — confirmed live a synthetic MouseEvent('click') DOES correctly
// complete the typed prefix to the clicked item's own full value, the
// same as a real click would).
const PROPERTY_SUGGESTER_SELECTOR = '.suggestion-container.mod-property-value, .suggestion-container.mod-property-key';
const PROPERTY_SUGGESTER_ITEM_SELECTOR = '.suggestion-item';
const PROPERTY_SUGGESTER_SELECTED_CLASS = 'is-selected';

// date/datetime specifically (a subset of PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR) —
// used by PROPERTY_CURSOR_PNBF_SELECTOR below, which needs these two
// but NOT checkbox (checkbox has no cursor concept at all, explicitly
// excluded from Ctrl-PNBF by the user's own scope decision).
const PROPERTY_DATE_TYPE_SELECTOR = 'input[type="date"], input[type="datetime-local"]';

// Ctrl-P/N/B/F's own matching selector: text + multiselect get real
// Selection-API movement; date/datetime are included here too but
// their own handler is a true no-op (see propertyMoveCharOrNoop/
// propertyMoveLineOrNoop) — included so the keypress is still
// swallowed cleanly by this plugin's own scope rather than falling
// through to a native-dispatch fallback that does nothing useful
// anyway. Checkbox is deliberately NOT part of this one.
const PROPERTY_CURSOR_PNBF_SELECTOR =
	`${PROPERTY_VALUE_EDIT_SELECTOR}, ${PROPERTY_MULTISELECT_INPUT_SELECTOR}, ${PROPERTY_DATE_TYPE_SELECTOR}`;

// Ctrl-B/F's own matching selector: everything Ctrl-P/N/B/F already
// covers, PLUS the name/key-edit input. Also reused as cursor-up/down's
// own valueEditSelector (see those bind() calls below) — a plain
// single-line field still has no sensible "move to a different visual
// line" meaning of its own, so propertyMoveLineOrNoop's own key-edit
// branch stays a no-op there; the only reason cursor-up/down need to
// reach this input at all now is to navigate ITS OWN suggester
// (PROPERTY_SUGGESTER_SELECTOR) when one happens to be open, the exact
// same "cursor-key commands step in as suggester navigation while a
// suggester covers the field's own normal meaning" pattern multi-select
// already has.
const PROPERTY_CURSOR_LR_SELECTOR =
	`${PROPERTY_CURSOR_PNBF_SELECTOR}, ${PROPERTY_KEY_EDIT_SELECTOR}`;

// Every command that's meaningful on BOTH the text value-edit widget
// (contenteditable) and the name/key-edit input (plain <input>) — Home/
// End, Word left/right, Set-mark, Kill-line/region/Copy-region/Yank,
// Kill word, Delete char. Each handler bound with this selector
// branches internally on PROPERTY_KEY_EDIT_SELECTOR to pick the right
// implementation (propertyKeyXxx for the input, titleXxx reused as-is
// for the contenteditable) — same text-editing COMMAND set, two
// different underlying selection models.
const PROPERTY_TEXT_LIKE_EDIT_SELECTOR =
	`${PROPERTY_VALUE_EDIT_SELECTOR}, ${PROPERTY_KEY_EDIT_SELECTOR}`;

// Ctrl-G's own matching selector: every value-widget type, built
// directly from PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR (not derived from
// PROPERTY_CURSOR_PNBF_SELECTOR + a hardcoded checkbox addendum, which
// is how a real bug slipped in here — adding `number` to
// PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR alone had NO effect on this
// constant, since it never referenced that one at all, confirmed live
// when Ctrl-G still didn't work for number even after that edit).
// Ctrl-G's own scope is strictly broader than Ctrl-PNBF's (includes
// every type in PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR, not just the two
// PROPERTY_CURSOR_PNBF_SELECTOR happens to also cover), plus the name/
// key-edit input.
const PROPERTY_ANY_VALUE_WIDGET_SELECTOR =
	`${PROPERTY_VALUE_EDIT_SELECTOR}, ${PROPERTY_MULTISELECT_INPUT_SELECTOR}, ${PROPERTY_MULTISELECT_PILL_SELECTOR}, ${PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR}, ${PROPERTY_KEY_EDIT_SELECTOR}`;

// The combined set of elements that keep propertyRowScope pushed.
// Exact-match only (not .closest()) throughout — every element in both
// selectors above is itself the real focus target, never a descendant
// of one, so there's no need to climb the tree.
const PROPERTY_PANEL_SCOPE_SELECTOR =
	`${PROPERTY_PANEL_FOCUS_SELECTOR}, ${PROPERTY_ANY_VALUE_WIDGET_SELECTOR}, ${BASES_TABLE_CONTAINER_SELECTOR}`;

// Tags a synthetic KeyboardEvent as THIS plugin's own internal
// re-dispatch (the "re-fire a native Escape to drive the actual UI
// transition" convention keyboard-quit's own bind() handler ends
// with, below) — distinguishes it from a genuine external bare Escape
// (a real physical press, or a test's own synthetic simulation of
// one) at the point buildPropertyRowScope's own bare-Escape pass-
// through registration sees it. Both kinds of event are equally
// "synthetic" from the DOM's own perspective (isTrusted: false for
// both in an E2E harness), so isTrusted can't tell them apart — this
// explicit tag is the only reliable signal. See that registration's
// own comment for why this distinction is needed at all.
const UCH_INTERNAL_ESCAPE_REDISPATCH_FLAG = '__uchInternalEscapeRedispatch';

// Extend the Obsidian Editor interface to include the internal CodeMirror 6 instance (EditorView)
declare module "obsidian" {
	interface Editor {
		cm: EditorView;
		inTableCell: boolean;
		// Active CM view: the inner EditorView when inTableCell is true, otherwise editor.cm.
		activeCM: EditorView;
	}
}


interface UniversalCursorHotkeysSettings {
	visualLineMovement: boolean;
	smartHomeStandard: boolean;
	smartHomeAdvanced: boolean;
	smartJoin: boolean;
	crossRowNavigation: boolean;
	// Double-click word selection, CJK-aware (Intl.Segmenter, same engine as
	// word-right/left and Vim w/b/e) — only intervenes when the click lands
	// on a Hiragana/Katakana/CJK-Ideograph character; every other case falls
	// through to CM6's own default. On by default: this corrects an
	// objectively broken native result (an entire unbroken CJK run selected
	// as one "word") rather than introducing an opinionated new behavior —
	// same category as Smart home (standard)/Visual line movement/Cross-row
	// navigation above, not Smart join (which stays opt-in precisely because
	// it makes a markdown-aware judgment call). Latin-only text is
	// unaffected either way.
	cjkDoubleClickWordSelect: boolean;
	// Gates isTableLineSourceMode()'s own return value — on by default
	// (preserves existing behavior). OFF disables Source Mode table-row
	// awareness entirely for every command that checks it (HOME/END, Select
	// all, Delete char, Transpose chars, Kill line, Kill word left/right,
	// Uppercase/Lowercase/Capitalize word, Kill region/Copy region, Yank,
	// and Vim's own tx/tX), so a table row in Source Mode behaves exactly
	// like any other line — e.g. HOME lands at the line's own literal ch=0
	// instead of stopping at cell content start. Live Preview is completely
	// unaffected either way (isTableLineSourceMode is only ever checked
	// alongside !isLivePreviewMode()).
	tableAwareSourceModeEditing: boolean;
	qsaDisplacedCommands: DisplacedCommand[];
	qsaIndividualVisible: boolean;
	// Every block under Hotkey settings is collapsible now (uniform ▶/▼
	// affordance signaling "this is a child of Hotkey settings"), but the
	// default open/closed state per block is unchanged from before that:
	// the 3 core command blocks and Displaced commands stay open by
	// default; Table structure/Table navigation stay closed (secondary,
	// supplementary sections not owned by this plugin).
	qsaCursorMovementVisible: boolean;
	qsaEditingVisible: boolean;
	qsaOtherHotkeysVisible: boolean;
	qsaTableStructureVisible: boolean;
	qsaTableNavVisible: boolean;
	qsaDisplacedVisible: boolean;
	// "Add cursor" block on the For everyone tab (settings.ts's
	// renderKeyUpgradesTabContent) — a real Obsidian command block (unlike
	// Key Upgrades above it), reusing the same QSA renderBlock machinery as
	// the macOS tab's own 3 core blocks. Open by default, same as those.
	qsaAddCursorVisible: boolean;
	vimHlSupport: boolean;
	vimJkSupport: boolean;
	vimJoinSupport: boolean;
	vimCaretSupport: boolean;
	vimWordSupport: boolean;
	vimGgSupport: boolean;
	vimDisplayLineSupport: boolean;
	vimEolSupport: boolean;
	// Bundles the leader-key table-structure commands (currently just
	// insert-row-below — more follow the same wiring later). Off by
	// default like every other Vim feature.
	vimTableStructureSupport: boolean;
	// Pure cursor movement (exit table, jump to adjacent cell) — see
	// vim-support.ts's own doc comment for how this differs from
	// vimTableStructureSupport above.
	vimTableNavigationSupport: boolean;
	// Leader key for table-structure/table-navigation commands. false
	// (default) = Space; true = backslash. Only has an effect once one of
	// those is on — a preference, not an on/off feature of its own.
	vimLeaderUseBackslash: boolean;
	// Always-visible 3-tab bar (settings.ts's renderQsaFrame) — this selects
	// which one is currently showing. 'general' = For everyone (no Vim/Emacs
	// knowledge needed), 'vim' = Vim mode, 'emacs' = macOS (Emacs) style.
	activeSettingsTab: 'general' | 'vim' | 'emacs';
	// Whether the settings tab has already auto-switched to the Vim tab, on
	// the theory that a Vim-mode user wants to land there first, in response
	// to Obsidian's own "Vim key bindings" core setting being on. Fires at
	// most once ever, so it never fights a user's own subsequent manual tab
	// choice.
	vimAutoExpandDone: boolean;
}

const DEFAULT_SETTINGS: UniversalCursorHotkeysSettings = {
	visualLineMovement: true,
	smartHomeStandard: true,
	smartHomeAdvanced: true,
	smartJoin: false,
	crossRowNavigation: true,
	cjkDoubleClickWordSelect: true,
	tableAwareSourceModeEditing: true,
	qsaDisplacedCommands: [],
	qsaIndividualVisible: false,
	qsaCursorMovementVisible: true,
	qsaEditingVisible: true,
	qsaOtherHotkeysVisible: true,
	qsaTableStructureVisible: false,
	qsaTableNavVisible: false,
	qsaDisplacedVisible: true,
	qsaAddCursorVisible: true,
	vimHlSupport: true,
	vimJkSupport: true,
	vimJoinSupport: true,
	vimCaretSupport: true,
	vimWordSupport: true,
	vimGgSupport: true,
	vimDisplayLineSupport: true,
	vimEolSupport: true,
	vimTableStructureSupport: false,
	vimTableNavigationSupport: false,
	vimLeaderUseBackslash: false,
	activeSettingsTab: 'general',
	vimAutoExpandDone: false,
};


export default class universalCursorHotkeysPlugin extends Plugin {

	settings: UniversalCursorHotkeysSettings;

	private readonly TABLE_DELIMITER_REGEX = /^\s*\|?[:\s]*?-+[:\s-]*\|[:\s-|]*$/;
	// Lines of margin above/below cursor for recenter-top-bottom top/bottom positions.
	private readonly RECENTER_TOP_BOTTOM_MARGIN_LINES = 2;
	// Bases table rows are much taller than a text line, so reusing
	// RECENTER_TOP_BOTTOM_MARGIN_LINES directly against rowHeight (2 full
	// ROWS of margin) read as excessive -- a separate, smaller margin for
	// the Bases table's own top/bottom positions.
	private readonly RECENTER_TOP_BOTTOM_MARGIN_ROWS_BASES = 1;

	vimSupport: VimSupport;

	private isKillChaining: boolean = false;
	private isDispatchingKill: boolean = false;
	private killCache: string = '';
	private _recenterStep = 0; // 0=center, 1=top, 2=bottom

	// Emacs-style Set-mark: session-only, not persisted to settings (real
	// Emacs's own mark is per-buffer, non-persistent too). The mark position
	// itself is never stored separately — it's just whichever range's
	// anchor is already sitting at the point Set mark was pressed; motion
	// commands extend the selection from there while this is true.
	private markActive: boolean = false;

	// 0.13.0 Feature 1, step 1: Ctrl-A/E in the note title field (plain
	// contenteditable, no CM6 there). Rebuilt fresh on every focusin into
	// the title and discarded on focusout — see buildTitleScope's own
	// comment for why this is cheap (reads only this short, fixed command
	// list's current hotkeys, not Obsidian's or UCH's full hotkey table).
	private titleScope: Scope | null = null;

	// 0.13.0 Feature 1, frontmatter sub-phase: pushed/popped the same way
	// as titleScope above, but keyed to a Properties-panel row's own
	// "item selection mode" (see PROPERTY_PANEL_FOCUS_SELECTOR) instead of the
	// title field.
	private propertyRowScope: Scope | null = null;

	// 0.13.0 Feature 1, frontmatter sub-phase: a goal-column equivalent
	// for crossings that pass THROUGH the Properties panel (body<->title
	// now that Properties sits between them). Always stored in BODY's
	// own screen-pixel space (the same shape escapeUpToTitle's own
	// `targetX` parameter expects), regardless of whether it was
	// established from the body side (stored directly) or the title side
	// (converted to body-space before storing, using the same
	// gutter-normalization formula titleMoveLineOrEscapeToBody already
	// uses for its own direct body landing) — this way only ONE
	// direction of conversion (body-space -> title-space) is ever needed,
	// at the single point where it finally lands in the title. Set when
	// entering Properties from either side, consumed (and reset to null)
	// the moment it's actually used to land a cursor in title or body;
	// while merely navigating row-to-row within Properties it's just
	// carried through unused, since no row has horizontal text to target.
	private propertyGoalX: number | null = null;

	// Goal-column equivalent for the title's own vertical (Ctrl-P/N)
	// movement — same idea as execPreservingGoalColumn's goalColumn for
	// the body: the ORIGINAL horizontal pixel position a vertical move
	// started from, kept across a chain of vertical moves through
	// possibly-shorter visual lines (which clamp/"crop" the rendered
	// column), reapplied once a wide-enough line is reached again rather
	// than being lost. Set when a vertical move starts fresh (including
	// crossing in from the body); cleared by any horizontal move
	// (Ctrl-B/F, Home/End), by leaving the title, or on focusout.
	private titleGoalX: number | null = null;

	// Guards every editorCallback below against firing mid-IME-composition.
	// Confirmed live (2026-09-26): during active composition, CM6's own
	// `composing` flag stays true even once the IME itself stops consuming
	// further Ctrl+letter presses (e.g. after a few Ctrl-N/Ctrl-P candidate
	// cycles) and lets them reach Obsidian's command dispatcher instead —
	// so every one of this plugin's editor commands must no-op while either
	// the outer view or the focused table cell's inner view reports
	// composing, rather than only checking on entry.
	private isComposing(editor: Editor): boolean {
		return !!(editor.cm?.composing || editor.activeCM?.composing);
	}

	async onload() {
		await this.loadSettings();
		this.vimSupport = new VimSupport(this);
		this.addSettingTab(new UniversalCursorHotkeysSettingTab(this.app, this));

		this.addCommand({
			id: 'cursor-home',
			name: 'HOME',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.moveCursorHome(editor)
			}
		});

		this.addCommand({
			id: 'cursor-end',
			name: 'END',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.moveCursorEnd(editor)
			}
		});

		this.addCommand({
			id: 'cursor-up',
			name: 'UP',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.moveCursorUp(editor)
			}
		});

		this.addCommand({
			id: 'cursor-down',
			name: 'DOWN',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.moveCursorDown(editor)
			}
		});

		this.addCommand({
			id: 'cursor-left',
			name: 'LEFT',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.moveCursorLeft(editor)
			}
		});

		this.addCommand({
			id: 'cursor-right',
			name: 'RIGHT',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.moveCursorRight(editor)
			}
		});

		this.addCommand({
			id: 'cursor-top',
			name: 'TOP',
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.jumpToBufferEdge(editor, false)
			}
		});

		this.addCommand({
			id: 'cursor-bottom',
			name: 'BOTTOM',
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.jumpToBufferEdge(editor, true)
			}
		});

		this.addCommand({
			id: 'word-right',
			name: 'Word right',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.moveCursorWord(editor, true)
			}
		});

		this.addCommand({
			id: 'word-left',
			name: 'Word left',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.moveCursorWord(editor, false)
			}
		});

		this.addCommand({
			id: "select-all",
			name: "Select all",
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.selectAll(editor);
			},
		});

		this.addCommand({
			id: 'delete-char',
			name: 'Delete char',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.deleteChar(editor);
			}
		});

		this.addCommand({
			id: 'transpose-chars',
			name: 'Transpose chars',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.transposeChars(editor);
			}
		});

		this.addCommand({
			id: 'undo',
			name: 'Undo',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.markActive = false;
				editor.undo();
			}
		});

		this.addCommand({
			id: 'redo',
			name: 'Redo',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.markActive = false;
				editor.redo();
			}
		});

		// Table navigation — shares its implementation with the Vim leader-key
		// commands of the same name (tx/tX/th/tj/tk/tl, see table-navigation.ts)
		// rather than duplicating the logic; this file already implements
		// TableNavHost (isLinePartOfTable/getBeginningOfLinePosition/
		// crossTableRowForCell are all defined below), so `this` is passed
		// directly. No recommended hotkey, same as Redo above — these are
		// opt-in via Settings → Hotkeys / the Quick setup assistant, not bound
		// by default.
		this.addCommand({
			id: 'table-cell-left',
			name: 'Move to cell left',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				// jumpAdjacentCell/exitTable (table-navigation.ts, all six
				// commands below) dispatch via the plain Editor.setCursor
				// API, not a tagged CM6 transaction this plugin's own
				// generic native-collapse-clearing listener can recognize —
				// confirmed live (fix/set-mark-clearing-gaps) that an active
				// Set-mark selection survives these as a "zombie" armed mark
				// that silently re-arms a new region on the next extend
				// command. These are plain point-movement commands, not
				// part of the Set-mark extend family, so they clear
				// unconditionally here, matching every other non-extending
				// movement in this plugin.
				this.markActive = false;
				if (editor.inTableCell) jumpAdjacentCell(editor, this, 'h');
			}
		});

		this.addCommand({
			id: 'table-cell-right',
			name: 'Move to cell right',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				// See table-cell-left's own comment above.
				this.markActive = false;
				if (editor.inTableCell) jumpAdjacentCell(editor, this, 'l');
			}
		});

		this.addCommand({
			id: 'table-cell-down',
			name: 'Move to cell below',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				// See table-cell-left's own comment above.
				this.markActive = false;
				if (editor.inTableCell) jumpAdjacentCell(editor, this, 'j');
			}
		});

		this.addCommand({
			id: 'table-cell-up',
			name: 'Move to cell above',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				// See table-cell-left's own comment above.
				this.markActive = false;
				if (editor.inTableCell) jumpAdjacentCell(editor, this, 'k');
			}
		});

		this.addCommand({
			id: 'table-exit-down',
			name: 'Exit table below',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				// See table-cell-left's own comment above.
				this.markActive = false;
				const inSourceTable = this.isSourceModeTableLine(editor.getLine(editor.getCursor().line));
				if (editor.inTableCell || inSourceTable) exitTable(editor, this, true);
			}
		});

		this.addCommand({
			id: 'table-exit-up',
			name: 'Exit table above',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				// See table-cell-left's own comment above.
				this.markActive = false;
				const inSourceTable = this.isSourceModeTableLine(editor.getLine(editor.getCursor().line));
				if (editor.inTableCell || inSourceTable) exitTable(editor, this, false);
			}
		});

		this.addCommand({
			id: 'kill-region',
			name: 'Kill region',
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.killRegion(editor);
			}
		});

		this.addCommand({
			id: 'copy-region',
			name: 'Copy region',
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.copyRegion(editor);
			}
		});

		this.addCommand({
			id: 'kill-line',
			name: 'Kill line',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.killLine(editor);
			}
		});

		this.addCommand({
			id: 'kill-word-left',
			name: 'Kill word left',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.killWord(editor, false);
			}
		});

		this.addCommand({
			id: 'kill-word-right',
			name: 'Kill word right',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.killWord(editor, true);
			}
		});

		this.addCommand({
			id: 'uppercase-word',
			name: 'Uppercase word',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.transformWord(editor, s => s.toUpperCase());
			}
		});

		this.addCommand({
			id: 'lowercase-word',
			name: 'Lowercase word',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.transformWord(editor, s => s.toLowerCase());
			}
		});

		this.addCommand({
			id: 'capitalize-word',
			name: 'Capitalize word',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				this.transformWord(editor, s => universalCursorHotkeysPlugin.capitalizeText(s));
			}
		});

		this.addCommand({
			id: 'yank',
			name: 'Yank',
			repeatable: true,
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.isComposing(editor)) return;
				void this.yank(editor);
			}
		});

		this.addCommand({
			id: 'page-down',
			name: 'Page down',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.pageDown(editor);
			}
		});

		this.addCommand({
			id: 'page-up',
			name: 'Page up',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.pageUp(editor);
			}
		});

		this.addCommand({
			id: 'recenter',
			name: 'Recenter',
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.recenter(editor);
			}
		});

		this.addCommand({
			id: 'recenter-top-bottom',
			name: 'Recenter top-bottom',
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.recenterTopBottom(editor);
			}
		});

		this.addCommand({
			id: 'set-mark',
			name: 'Set mark',
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.setMark(editor);
			}
		});

		this.addCommand({
			id: 'keyboard-quit',
			name: 'Deselect',
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.keyboardQuit(editor);
			}
		});

		// No recommended hotkey yet — undecided (candidates: Option-↓/↑ on
		// macOS, Alt-↓/↑ on Windows). Opt-in via Settings → Hotkeys for now.
		this.addCommand({
			id: 'add-cursor-below',
			name: 'Add cursor below',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.addCursorVertically(editor, true);
			}
		});

		this.addCommand({
			id: 'add-cursor-above',
			name: 'Add cursor above',
			repeatable: true,
			editorCallback: (editor: Editor) => {
				if (this.isComposing(editor)) return;
				this.addCursorVertically(editor, false);
			}
		});

		this.registerEditorExtension(
			EditorView.updateListener.of((update) => {
				// Mouse click/drag: the "select.pointer" tag covers both (CM6
				// tags them identically); a click collapses to an empty
				// selection and clears the mark, a drag leaves a real
				// selection in place and that selection itself becomes the
				// new region (no anchor-setting code needed beyond flipping
				// the flag — the drag's own anchor/head already are it).
				if (update.selectionSet && update.transactions.some(tr => tr.isUserEvent('select.pointer'))) {
					this.markActive = !update.state.selection.main.empty;
				}

				// Shift+Arrow (and anything else sharing CM6's own
				// extendSel/"select" tag while preserving the anchor) arms
				// the mark exactly like mouse drag just above — same
				// proactive precedent, same reasoning: the anchor staying
				// put while the head moves, ending non-empty, means
				// something other than this plugin just extended a
				// selection from a fixed anchor. Confirmed live (scratch
				// diagnostic, not kept) that Shift+ArrowRight dispatches
				// with the bare "select" tag and leaves the anchor
				// untouched — unlike a plain arrow key collapsing an
				// existing selection, which actually *moves* the anchor to
				// meet the new head (confirmed via the same diagnostic),
				// so that case can't accidentally satisfy this check too.
				// Once armed this way, this plugin's own Ctrl-B/F/N/P/A/E
				// extend from the exact same anchor/head CM6 already
				// tracks — no separate anchor-setting code needed, unifying
				// Shift+cursor range-selection with this plugin's own
				// Set-mark under one shared selection model (something
				// emacs-text-editor, a competing plugin, doesn't offer).
				// Confirmed by reading @codemirror/commands directly that
				// every Shift-bound selection command this plugin doesn't
				// already own (char/line/page/line-boundary/doc-boundary)
				// goes through this same anchor-preserving shape, so this
				// one check covers all of them without enumerating keys —
				// Shift+Ctrl+Home/End (selectDocStart/End) don't call the
				// shared extendSel helper the others do, but still pass the
				// *same* prior anchor through explicitly, so they still
				// satisfy this check.
				//
				// Native selectAll (Ctrl-A/Cmd-A, if bound outside this
				// plugin's own "Select all" command) is a real, confirmed
				// false-positive risk this anchor check alone doesn't
				// catch: it always dispatches anchor 0/head doc.length
				// under the same bare "select" tag, and if the cursor
				// already happened to sit at position 0, the "anchor
				// unchanged" check above passes purely by coincidence
				// (confirmed live: simulating that exact dispatch armed
				// the mark). selectAll's own resulting range is
				// state-identical to a genuine Shift-Ctrl-End extend made
				// from position 0 in a short document — nothing in the
				// transaction or resulting state can tell those two apart,
				// so excluding "the whole buffer, start to end" is a
				// deliberate, narrow trade: it only sacrifices arming for
				// that one indistinguishable case, falling back to the
				// older (still correct, just non-proactive) collapse-first
				// behavior there, while fixing the much more commonly hit
				// selectAll collision.
				const mainRange = update.state.selection.main;
				const spansWholeBuffer = mainRange.from === 0 && mainRange.to === update.state.doc.length;
				if (update.selectionSet && !this.markActive &&
					update.startState.selection.main.anchor === mainRange.anchor &&
					!mainRange.empty && !spansWholeBuffer &&
					update.transactions.some(tr =>
						tr.isUserEvent('select') && !tr.isUserEvent('select.pointer') && !tr.isUserEvent('select.uch')
					)
				) {
					this.markActive = true;
				}

				// Native physical cursor movement (bare arrow keys, Home/End,
				// Page Up/Down, etc. — none of this plugin's own commands)
				// collapses an active selection on the first press without
				// extending it, same as Escape/cut/copy/paste/Backspace/Delete
				// above, and the same gap applies: none of these reach a
				// command callback that could clear markActive. Unlike those,
				// there's no fixed key list to listen for — every one of
				// @codemirror/commands' own plain-movement commands (arrows,
				// Home/End, Page Up/Down, Ctrl-Home/End, ...) dispatches
				// through the same shared `setSel` helper, tagged `userEvent:
				// "select"` (confirmed by reading that source directly), so
				// one check here covers all of them without enumerating keys.
				//
				// This plugin's own extend/collapse dispatches (the 5
				// extendMark* functions plus collapseActiveSelectionToHead,
				// shared by Set-mark's own re-press and Ctrl-G) use the more
				// specific `"select.uch"` tag instead of bare `"select"` —
				// confirmed via scratch diagnostic logging that plain `tr.
				// isUserEvent('select')` cannot tell these apart from a
				// native collapse by tag alone, since CM6 tags both
				// identically. The distinction matters for two real,
				// traced-through cases that would otherwise misfire: Set-
				// mark's own re-press (markActive is set true *before*
				// collapseActiveSelectionToHead's own dispatch collapses the
				// prior selection to empty) and extending one way then back
				// to the exact anchor (a legitimate non-empty -> empty
				// transition that is this plugin's own doing, not a native
				// collapse). Requiring an actual non-empty -> empty
				// transition (not just "ended up empty") also leaves
				// Set-mark's own still-empty state (armed but not yet
				// extended) alone — deliberately out of scope, see the
				// 2026-10-17 planning note.
				if (update.selectionSet && this.markActive &&
					!update.startState.selection.main.empty && update.state.selection.main.empty &&
					update.transactions.some(tr =>
						tr.isUserEvent('select') && !tr.isUserEvent('select.pointer') && !tr.isUserEvent('select.uch')
					)
				) {
					this.markActive = false;
				}

				if (!this.isKillChaining && this._recenterStep === 0) return;
				if (!update.docChanged && !update.selectionSet) return;
				// Only reset on genuine user actions (keystrokes, arrow keys, etc.).
				// Programmatic dispatches (our own, Obsidian's table editor re-dispatches)
				// carry no Transaction.userEvent annotation and are ignored here.
				const isUserAction = update.transactions.some(
					tr => tr.annotation(Transaction.userEvent) !== undefined
				);
				if (isUserAction && !this.isDispatchingKill) {
					this.isKillChaining = false;
					this._recenterStep = 0;
				}
			})
		);

		this.registerEditorExtension(
			EditorView.mouseSelectionStyle.of(
				cjkWordSelectionStyle(() => this.settings.cjkDoubleClickWordSelect)
			)
		);

		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this.markActive = false;
			this.reconcileScopesWithFocus();
		}));
		// Extra safety net alongside active-leaf-change above: opening a
		// NEW FILE into the leaf that's ALREADY active doesn't fire
		// active-leaf-change at all (confirmed live — that event is about
		// which LEAF has focus, not which file is open in it), so
		// file-open is the one workspace-level signal that reliably fires
		// for that specific transition too.
		this.registerEvent(this.app.workspace.on('file-open', () => {
			this.reconcileScopesWithFocus();
		}));

		// registerWindowDomListeners below is registered once here for the
		// main window, and again for every popout as it opens (confirmed
		// live via a dedicated E2E_POPOUT suite pass: without the
		// 'window-open' half, a popout's own native copy/cut/paste/
		// Backspace/Delete/Escape never reached these listeners at all).
		//
		// Deliberately the bare global `document`, NOT `activeDocument`,
		// for this first call -- confirmed live (2026-11-12) this is a
		// real, user-reported, multi-machine/multi-version bug, not an
		// edge case: `activeDocument` resolves to "whichever window is
		// currently active" at the moment it's READ, and if this plugin
		// gets enabled from the Community plugins toggle in Settings
		// (Settings has its own, separate document from Obsidian's own
		// perspective), `activeDocument` at this exact point in onload()
		// resolves to THAT document, not the main workspace one --
		// confirmed via a raw, unwrapped addEventListener placed directly
		// on the value this used to receive, which never once fired for
		// a real click in the actual workspace afterward. Since this
		// plugin's own module always executes in the main window's JS
		// realm regardless of which window Obsidian considers "active"
		// at any instant, the bare `document`/`window` globals are
		// always correct here -- only a genuine POPOUT (window-open,
		// below) actually needs its own, dynamically-obtained document.
		this.registerWindowDomListeners(document);
		this.registerEvent(this.app.workspace.on('window-open', (_, win) => {
			this.registerWindowDomListeners(win.document);
		}));

		this.vimSupport.setup();

		// Covers the plugin-reload gap documented on reconcileScopesWithFocus
		// itself: if focus is ALREADY sitting on a Bases/Properties/title
		// element at the moment this plugin loads (e.g. re-enabled via the
		// Community plugins toggle while such an element was focused), no
		// focusin ever fires to push a scope for it, since focus itself
		// never changes. Without this call, every one of this plugin's own
		// commands silently does nothing there until focus happens to move
		// away and back on its own.
		this.reconcileScopesWithFocus();
	}

	// Safety net for propertyRowScope/titleScope: both are pushed/popped
	// purely by focusin/focusout (see registerWindowDomListeners below) —
	// no code anywhere forces a pop independent of that pair actually
	// firing in the expected order. Live testing across several switching
	// scenarios (same-leaf openFile, repeated rapid switches across
	// widget types, a real file-explorer click, switching away from a
	// Bases cell-selection view, switching ACTIVE LEAF to an already-open
	// split) all fired focusout correctly and left no stale scope behind
	// — but none of those tests could fully rule out some other, rarer
	// path where focusout genuinely never fires (e.g. if Obsidian ever
	// tears down a leaf's DOM without that side effect, or a timing edge
	// this session's testing didn't happen to hit). Rather than keep
	// chasing an unconfirmed exact trigger, this reconciles both scopes
	// against whatever document.activeElement actually is, on every
	// 'active-leaf-change' AND 'file-open' (file-open fires even when a
	// new file replaces the CURRENTLY active leaf's own content, which
	// active-leaf-change alone does NOT cover — confirmed live those are
	// genuinely different events). Deferred by two frames (same margin
	// used elsewhere in this file for analogous focus-settling checks)
	// so this doesn't act on a still-mid-transition activeElement.
	//
	// Also handles the OTHER direction (push a missing scope, not just
	// pop a stale one) — see this method's own onload() call site for the
	// concrete gap this closes: disabling and re-enabling this plugin
	// (e.g. via the Community plugins toggle) while focus is ALREADY
	// sitting on a Bases/Properties/title element never fires a NEW
	// focusin at all (focus itself never changes across the reload), so
	// a fresh plugin instance starts with propertyRowScope/titleScope
	// both null and no event left to populate them — Ctrl-PNBF and every
	// other command silently does nothing until focus happens to move
	// away and back. User-reported, not yet reproduced through the
	// Settings UI's own real toggle switch in this plugin's own E2E
	// harness (app.setting.open() never produced a queryable modal
	// there), but the gap itself — onload() never reconciling against
	// whatever's already focused — is real and confirmed by reading the
	// code alone, independent of pinning down that exact repro: same
	// precedent as project_scope_stuck_safety_net's own original safety
	// net, shipped defensively for the identical reason.
	private reconcileScopesWithFocus() {
		requestAnimationFrameOnActiveWindow(() => {
			requestAnimationFrameOnActiveWindow(() => {
				const active = activeDocument.activeElement as HTMLElement | null;
				if (this.propertyRowScope && !active?.matches?.(PROPERTY_PANEL_SCOPE_SELECTOR)) {
					this.app.keymap.popScope(this.propertyRowScope);
					this.propertyRowScope = null;
				} else if (!this.propertyRowScope && active?.matches?.(PROPERTY_PANEL_SCOPE_SELECTOR)) {
					this.propertyRowScope = this.buildPropertyRowScope();
					this.app.keymap.pushScope(this.propertyRowScope);
				}
				if (this.titleScope && !active?.closest?.(TITLE_SELECTOR)) {
					this.app.keymap.popScope(this.titleScope);
					this.titleScope = null;
				} else if (!this.titleScope && active?.closest?.(TITLE_SELECTOR)) {
					this.titleScope = this.buildTitleScope();
					this.app.keymap.pushScope(this.titleScope);
				}
			});
		});
	}

	// See onload's own call site for why this exists per-window rather than
	// being called once for the main window's document alone.
	private registerWindowDomListeners(doc: Document) {
		// Extra, defensive reconcileScopesWithFocus() trigger, alongside
		// active-leaf-change/file-open/onload's own call sites: confirmed
		// live (2026-11-12) that after a disable/re-enable cycle, a real
		// click INTO the title can land real DOM focus there (confirmed
		// via document.activeElement) without this plugin's own focusin
		// listener ever running for that click -- console logging showed
		// the listener fires correctly for the very next unrelated
		// focusin (e.g. clicking some other element), then never again
		// for any further focusin at all, title or body alike, for the
		// rest of that session. The exact mechanism wasn't pinned down
		// (no other plugin was involved, and the two other real
		// 'focusin' listeners on this same document — both genuinely
		// Obsidian's own core, confirmed by reading their source via
		// getEventListeners — looked unrelated), but manually calling
		// reconcileScopesWithFocus() from the console immediately fixed
		// it, confirming the scope-building logic itself was never the
		// problem, only this listener's reliability after a reload.
		// Piggybacking onto this existing mousedown listener (already
		// firing on every real click for unrelated reasons) gives a
		// second, independent path to the same self-healing check,
		// cheap enough to run unconditionally.
		this.registerDomEvent(doc, 'mousedown', () => {
			this.isKillChaining = false;
			this._recenterStep = 0;
			this.reconcileScopesWithFocus();
		}, true);

		// A bare-ESC Key Upgrade (app.hotkeyManager.setHotkeys claiming the
		// key globally) was tried and reverted (2026-10-17): it broke
		// Escape in non-CM6 contexts that rely on it natively (Excalidraw,
		// the note title field's own deselect). This listener is purely
		// passive instead — no preventDefault/stopPropagation, so native
		// Escape handling everywhere (CM6's own simplifySelection included)
		// proceeds completely untouched. It only solves the mark-active
		// desync this was meant to fix: without it, pressing Escape to
		// collapse a Set-mark selection leaves markActive true (this
		// keydown never reaches any of this plugin's own commands), so the
		// very next Ctrl-B/F/N/P/A/E would silently re-arm a new region
		// from wherever the cursor ended up.
		//
		// Backspace/Delete joined the same listener for the identical
		// reason (2026-10-17): consuming a Set-mark selection via a native
		// Backspace/Delete press, instead of this plugin's own Kill
		// region/Delete char commands, never reaches any command callback
		// either. Cleared unconditionally — same precedent as Delete
		// char's own existing unconditional clear — rather than only when
		// a selection was actually present: a Backspace/Delete pressed
		// right after Set-mark but before any extension (empty selection,
		// anchor armed) is already an unrelated edit, and keeping the mark
		// armed for a later extend command to silently re-arm from would
		// be the more surprising behavior. (A selection-only-when
		// condition was considered and found technically possible — the
		// confirming check would need this listener registered on the
		// capture phase, since CM6's own contentDOM-level Backspace/Delete
		// keymap handling runs before any bubble-phase document listener
		// — but it added real complexity for no behavioral upside, so
		// dropped in favor of this simpler unconditional clear.)
		this.registerDomEvent(doc, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete') this.markActive = false;
		});

		// copy/cut/paste: same rationale as Backspace/Delete above — these
		// are native actions, not this plugin's own Copy region/Kill
		// region/Yank commands, so they never reach any command callback
		// to clear markActive themselves. Confirmed live that CM6's own
		// copy/cut/paste handling (on the editor's contentDOM) never calls
		// stopPropagation, so a plain bubble-phase document listener sees
		// every one of these after CM6's own handling completes — unlike
		// Backspace/Delete above, no capture-phase trick is needed here,
		// since this clear is unconditional regardless of ordering.
		this.registerDomEvent(doc, 'copy', () => {
			this.killCache = '';
			this.markActive = false;
		});

		this.registerDomEvent(doc, 'cut', () => {
			this.killCache = '';
			this.markActive = false;
		});

		this.registerDomEvent(doc, 'paste', () => {
			this.markActive = false;
		});

		// 0.13.0 Feature 1, step 1 (title field, Ctrl-A/E only for now).
		// Piggybacks on this same per-window registration for free popout
		// coverage, same as everything else in this method.
		this.registerDomEvent(doc, 'focusin', (e: FocusEvent) => {
			if ((e.target as HTMLElement)?.closest?.(TITLE_SELECTOR)) {
				// Defensive self-heal, same shape and same confirmed-live
				// root cause as propertyRowScope's own fix above (see
				// project memory project_tags_scope_freeze_same_leaf):
				// an internal Escape re-dispatch can synchronously
				// trigger Obsidian's own blur->focus-next chain BEFORE
				// this element's own focusout ever reaches this
				// listener, leaking the previous scope. No confirmed
				// live occurrence for the title specifically yet, but
				// the fix is a no-op unless this exact race happens, so
				// applying it here too costs nothing.
				if (this.titleScope) {
					this.app.keymap.popScope(this.titleScope);
					this.titleScope = null;
				}
				this.titleScope = this.buildTitleScope();
				this.app.keymap.pushScope(this.titleScope);
			}
		}, true);
		this.registerDomEvent(doc, 'focusout', (e: FocusEvent) => {
			if (this.titleScope && (e.target as HTMLElement)?.closest?.(TITLE_SELECTOR)) {
				this.app.keymap.popScope(this.titleScope);
				this.titleScope = null;
				this.titleGoalX = null; // safety net for any exit path titleMoveLineOrEscapeToBody doesn't cover
			}
		}, true);

		// 0.13.0 Feature 1, frontmatter sub-phase: Properties-panel row
		// item-selection mode (see PROPERTY_PANEL_FOCUS_SELECTOR's own
		// comment), now also covering the text value-edit widget (see
		// PROPERTY_VALUE_EDIT_SELECTOR's own comment) via the combined
		// PROPERTY_PANEL_SCOPE_SELECTOR. Deliberately exact-match (not
		// .closest()) on that combined set — the name/key-edit INPUT
		// (ordinary editing of the property's NAME, a separate, later
		// phase) must NOT push this scope, only the row DIV itself
		// (item-selection mode) and the value-edit widget itself count.
		//
		// Confirmed live that pushing this Scope DOES correctly reach a
		// REAL keypress even when its exact combo is an already-registered
		// command hotkey (e.g. Ctrl-F bound to cursor-right) and focus is
		// inside the value-edit widget — pushing a Scope makes it get
		// checked before the root scope's own global command binding
		// does, in Obsidian's own window-level capture listener, so our
		// handler runs and does its work before that original keydown
		// gets stopped. An EARLIER attempt at this same broadening was
		// abandoned after testing with synthetic dispatchEvent() calls
		// suggested it couldn't work — that test methodology turned out
		// to be unreliable for anything touching Obsidian's own Keymap;
		// browser.keys() (real input) gives the true, consistent answer.
		//
		// The value-edit widget specifically needs its push DEFERRED by
		// one frame (confirmed live via the window scope stack's own
		// state): it pushes its OWN Scope on focus too (bare Arrow/
		// PageUp/PageDown/Home, for its own multi-line text navigation),
		// and pushing ours synchronously here loses the race — the
		// widget's own push lands AFTER ours, burying it underneath with
		// no parent-chain fallback, so it's never consulted at all for
		// any key. Pushing one frame later (same 2-RAF defer pattern used
		// elsewhere in this file for analogous focus-settling races, e.g.
		// addCursorOnView's own call site) lets the widget's own push
		// happen first, so ours ends up on top as intended. Item
		// selection mode's own elements (row/heading/Add-button) don't
		// have this race — they push synchronously, unchanged.
		// Real freeze, caught live via [UCH-propscope-debug] (see project
		// memory project_tags_scope_freeze_same_leaf for the full
		// investigation): Ctrl-G's own internal Escape re-dispatch on the
		// multi-select trailing input synchronously triggers Obsidian's
		// OWN 'blur' listener for that element (handlePropertyBlur), which
		// itself synchronously calls focusProperty() to move focus to the
		// NEXT row -- all BEFORE the original element's own 'focusout'
		// event (which must still bubble up to this document-level
		// listener) ever gets a chance to fire. So the new row's focusin
		// here ran first, while propertyRowScope was still set from the
		// input's own still-pending push -- pushing a SECOND scope
		// orphans the first one forever in app.keymap's own internal
		// stack (our own `this.propertyRowScope` reference only ever
		// pointed to ONE of them). When the row's scope eventually pops
		// normally, that orphaned FIRST scope resurfaces as the new top
		// of app.keymap's stack -- with no registration for anything
		// outside the Properties panel, it silently swallows EVERY key,
		// including totally unrelated global commands (confirmed live:
		// Cmd-, stopped working too, exactly the same "ALL hotkeys dead"
		// signature already suspected in project_scope_stuck_safety_net).
		//
		// Fix: pop whatever's already there FIRST, defensively, before
		// ever pushing a new one here -- the same "self-heal instead of
		// force-push a duplicate" shape reclaimPropertyRowScopeAfterMutation
		// already uses. This doesn't need to understand WHY the
		// focusout was skipped; it just guarantees our own bookkeeping
		// can never end up with two scopes pushed under one reference,
		// however that happens.
		const popStaleRowScopeIfAny = () => {
			if (!this.propertyRowScope) return;
			this.app.keymap.popScope(this.propertyRowScope);
			this.propertyRowScope = null;
		};
		this.registerDomEvent(doc, 'focusin', (e: FocusEvent) => {
			const target = e.target as HTMLElement;
			if (!target?.matches?.(PROPERTY_PANEL_SCOPE_SELECTOR)) return;
			// Real gap found live alongside the Bases/item-selection one
			// above (see this.bind()'s own fallback-dispatch comment):
			// moving real DOM focus INTO or OUT OF a value-edit widget
			// (e.g. Ctrl-F entering the text widget, or Escape exiting
			// it) never produces a CM6 transaction on the BODY's own
			// editor (these widgets aren't CM6 at all) or a 'mousedown',
			// so recenterTopBottomPropertyPanel's own cycle never reset
			// on this either. Safe to reset unconditionally here — the
			// recenter commands themselves only ever scroll, they never
			// call .focus() on anything, so pressing Ctrl-L can never
			// trigger this listener and self-reset its own cycle.
			this.isKillChaining = false;
			this._recenterStep = 0;
			if (target.matches(PROPERTY_VALUE_EDIT_SELECTOR)) {
				requestAnimationFrameOnActiveWindow(() => {
					requestAnimationFrameOnActiveWindow(() => {
						if (doc.activeElement !== target) return;
						popStaleRowScopeIfAny();
						this.propertyRowScope = this.buildPropertyRowScope();
						this.app.keymap.pushScope(this.propertyRowScope);
					});
				});
				return;
			}
			popStaleRowScopeIfAny();
			this.propertyRowScope = this.buildPropertyRowScope();
			this.app.keymap.pushScope(this.propertyRowScope);
		}, true);
		this.registerDomEvent(doc, 'focusout', (e: FocusEvent) => {
			const target = e.target as HTMLElement;
			if (this.propertyRowScope && target?.matches?.(PROPERTY_PANEL_SCOPE_SELECTOR)) {
				this.app.keymap.popScope(this.propertyRowScope);
				this.propertyRowScope = null;
			}
		}, true);
		// Real bug found from actual daily usage, broader than the
		// individual-command fix first applied for Kill-line/Kill-region/
		// Yank (see reclaimPropertyRowScopeAfterMutation's own comment for
		// that original investigation): native Undo/Redo (Cmd-Z/Cmd-
		// Shift-Z) also mutates the value-edit widget via the browser's
		// own undo manager — NOT something this plugin ever dispatches
		// itself, so there was no natural call site to chain a reclaim
		// onto. Confirmed live this still fires a real 'input' event (3
		// rapid Cmd-Z presses -> 3 'input' events, same as 3 rapid
		// Ctrl-D presses), which Obsidian's own suggestion dropdown reacts
		// to exactly the same way — pushing its own Scope on top of
		// propertyRowScope, which native Undo/Redo has no corresponding
		// "after this" hook to reclaim from, unlike this plugin's own
		// commands. Repro specifically needed starting from offset 1+
		// (not the value's very first character) — reported by the user,
		// not yet root-caused why offset 0 doesn't trigger it, but
		// irrelevant to the fix: reacting to the real 'input' event
		// itself, regardless of cause, covers every mutation path
		// uniformly (this plugin's own commands, native Undo/Redo, and
		// even plain typing) rather than requiring a reclaim call to be
		// remembered at every individual mutating command's own call
		// site — a single listener here replaces every explicit
		// reclaimPropertyRowScopeAfterMutation() call that used to follow
		// kill-line/kill-region/kill-word-left/kill-word-right/yank/
		// delete-char individually in buildPropertyRowScope.
		//
		// Extended to PROPERTY_KEY_EDIT_SELECTOR (2026-11-07): a real user
		// report ("2文字目でCtrl-D→Cmd-Zで入力が効かなくなる" — Ctrl-D then
		// Cmd-Z at offset 1+ breaks input) confirmed live this exact same
		// shadowing also happens for the name/key-edit input — its own
		// native autocomplete/suggester reacts to the SAME real 'input'
		// event (from execCommand('delete') or the browser's own native
		// Undo) by pushing its OWN Scope on top of propertyRowScope, just
		// like the text value-edit widget's own suggester. Confirmed via
		// a scope-stack dump (`topScopeIsOurs: false` right after Ctrl-D
		// + Cmd-Z) before fixing. This was originally scoped to only
		// PROPERTY_VALUE_EDIT_SELECTOR because that was the only widget
		// with a mutation-reactive suggester known about at the time the
		// text-type phase shipped — the key-edit input didn't exist yet.
		this.registerDomEvent(doc, 'input', (e: Event) => {
			if (!this.propertyRowScope) return;
			if (!(e.target as HTMLElement)?.matches?.(PROPERTY_TEXT_LIKE_EDIT_SELECTOR)) return;
			this.reclaimPropertyRowScopeAfterMutation();
		}, true);
		// Real gap found live: the multi-select (list/tags/aliases) trailing
		// input's own "previously used values" suggester can push its OWN
		// shadowing scope on top of propertyRowScope WITHOUT any 'input'
		// event at all — simply typing a character that matches existing
		// values is enough, and even just focusing the field already
		// shows it for `tags` specifically if the vault has existing
		// tags. Ctrl-N (this plugin's own cursor-down) produces no text
		// mutation either way, so the 'input' listener above never fires
		// for this path regardless. Reacting to 'keydown' instead — a plain DOM event
		// Keymap's own dispatch doesn't suppress, confirmed live it still
		// fires even while a foreign scope is on top — covers this and
		// every other shadowing trigger uniformly, the same way the
		// 'input' listener already covers every MUTATING trigger
		// uniformly. The reclaim itself is still deferred by 2 frames (see
		// reclaimPropertyRowScopeAfterMutation's own comment), so this
		// particular keypress doesn't recover immediately — same
		// characteristic already accepted for the 'input'-triggered case
		// — but the very next keypress onward works correctly again.
		this.registerDomEvent(doc, 'keydown', (e: KeyboardEvent) => {
			if (!this.propertyRowScope) return;
			if (!(e.target as HTMLElement)?.matches?.(PROPERTY_PANEL_SCOPE_SELECTOR)) return;
			this.reclaimPropertyRowScopeAfterMutation();
		}, true);
	}

	// Scans the baked hotkey table (defaults + user overrides already
	// merged) for every hotkey currently effective for one UCH command —
	// same technique settings.ts's own effectiveHotkeys() uses for the
	// Hotkeys-conflict UI, duplicated here in miniature rather than
	// imported, since main.ts doesn't otherwise depend on settings.ts's
	// UI-only internals.
	private getEffectiveHotkeysFor(commandId: string): { modifiers: string[], key: string }[] {
		const hm = (this.app as any).hotkeyManager;
		const result: { modifiers: string[], key: string }[] = [];
		for (let i = 0; i < hm.bakedIds.length; i++) {
			if (hm.bakedIds[i] === `universal-cursor-hotkeys:${commandId}`) {
				const hk = hm.bakedHotkeys[i];
				result.push({ modifiers: hk.modifiers ? hk.modifiers.split(',') : [], key: hk.key });
			}
		}
		return result;
	}

	// Rebuilt from scratch on every focusin (see titleScope's own comment) —
	// cost scales with this short, fixed list of commands, not with
	// Obsidian's or UCH's full hotkey count. Keys NOT registered here fall
	// through to native contenteditable behavior untouched (confirmed live
	// and in E2E for frontmatter's own ArrowDown; same mechanism applies
	// here), so nothing needs to be explicitly excluded.
	private buildTitleScope(): Scope {
		// bakedIds/bakedHotkeys are a lazily-built cache (confirmed live:
		// 0 entries until something forces a rebuild) used for the Hotkeys
		// settings UI, not kept continuously in sync by Obsidian's own
		// runtime key dispatch — bake() must be called before reading it.
		(this.app as any).hotkeyManager.bake();
		// See buildPropertyRowScope's own comment on this same pattern --
		// without a parent, any key not explicitly registered here
		// dead-ends instead of reaching Obsidian's global command hotkeys.
		const scope = new Scope((this.app.keymap as any).getRootScope());
		const bind = (commandId: string, handler: (titleEl: HTMLElement) => void) => {
			for (const hk of this.getEffectiveHotkeysFor(commandId)) {
				scope.register(hk.modifiers as Modifier[], hk.key, (evt) => {
					const title = (evt.target as HTMLElement)?.closest?.(TITLE_SELECTOR) as HTMLElement | null;
					if (title) handler(title);
					return false;
				});
			}
		};
		bind('cursor-home', (el) => this.titleMoveToLineBoundary(el, false));
		bind('cursor-end', (el) => this.titleMoveToLineBoundary(el, true));
		bind('cursor-left', (el) => this.titleMoveChar(el, false));
		bind('cursor-right', (el) => this.titleMoveChar(el, true));
		bind('word-left', (el) => this.titleMoveWord(el, false));
		bind('word-right', (el) => this.titleMoveWord(el, true));
		bind('cursor-up', (el) => this.titleMoveLine(el, false));
		bind('cursor-down', (el) => this.titleMoveLineOrEscapeToBody(el));
		bind('kill-line', (el) => this.titleKillLine(el));
		bind('delete-char', (el) => this.titleDeleteChar(el));
		bind('kill-word-left', (el) => this.titleKillWord(el, false));
		bind('kill-word-right', (el) => this.titleKillWord(el, true));
		bind('set-mark', (el) => this.titleSetMark(el));
		bind('keyboard-quit', (el) => this.titleKeyboardQuit(el));
		bind('kill-region', (el) => this.titleKillRegion(el));
		bind('copy-region', (el) => this.titleCopyRegion(el));
		bind('yank', (el) => { void this.titleYank(el); });
		return scope;
	}

	// 0.13.0 Feature 1, frontmatter sub-phase 1: Ctrl-N/P drive the same
	// row-to-row focus navigation a Properties-panel row's own "item
	// selection mode" already does for physical ArrowUp/ArrowDown — see
	// PROPERTY_PANEL_FOCUS_SELECTOR's own comment. Delegates to a synthetic
	// native key dispatch on the focused row rather than hand-rolling
	// previousElementSibling/nextElementSibling + .focus() — confirmed
	// live that physical ArrowDown already handles every boundary
	// sensibly on its own (row-to-row, heading-into-first-row, and
	// last-row-into-the-"Add property"-button, which itself already
	// falls through correctly into the body below), so no extra
	// boundary-guard code is needed for cursor-down anywhere; the
	// synthetic dispatch just inherits whatever Obsidian's own native
	// handler already does, same "delegate to native key" precedent Key
	// Upgrades elsewhere in this plugin already uses.
	//
	// cursor-up is the one exception: physical ArrowUp from the heading
	// escapes to the title but SELECTS it whole, unlike every other
	// Ctrl-N/P crossing in this plugin (body<->title, table-row
	// crossings), which always lands a collapsed cursor — matching that
	// instead of native's own select-all needs its own handler
	// (propertyHeadingEscapeToTitle) rather than a plain dispatch.
	private buildPropertyRowScope(): Scope {
		(this.app as any).hotkeyManager.bake();
		// Scope.handleKey only climbs to its OWN constructor-provided
		// `parent` on an unmatched key (confirmed by reading Obsidian's
		// own app.js) -- this is a completely separate chain from
		// pushScope/popScope's own prevScopes stack. Without passing
		// getRootScope() here, every key this scope doesn't explicitly
		// register (e.g. a user's own global command hotkey like Cmd-,
		// for Open Settings) dead-ends at `undefined` the moment this
		// scope is the active one, instead of reaching Obsidian's own
		// global command-hotkey resolution at all. getRootScope() isn't
		// in obsidian.d.ts (same undocumented-internals tier as the
		// hotkeyManager access above), but is the real fix, not a
		// workaround -- it's the actual mechanism Scope ships with for
		// exactly this situation.
		const scope = new Scope((this.app.keymap as any).getRootScope());
		// Unconditional bare-Escape pass-through, registered regardless of
		// whether 'keyboard-quit' itself has any configured hotkey —
		// without this, merely having propertyRowScope pushed (for ANY
		// element, not just the key-edit input) was confirmed live to
		// collapse the key-edit input's own native two-stage Escape
		// handling (close its own name-suggester dropdown first, exit to
		// the row second) into one stage — Obsidian's dispatcher only
		// ever consults the TOP scope for a given key, so once propertyRowScope
		// is on top, the key-input's OWN underlying suggester-scope
		// (further down the stack) stops being reachable at all for
		// Escape, with or without a registration of our own; registering
		// one that explicitly defers to native handling is the only way
		// to get that reachability back.
		//
		// Two return values matter here, and conflating them was a real
		// bug caught by two DIFFERENT, otherwise-unrelated regressions:
		// - A genuine external bare Escape (real keypress, or a test's
		//   own simulation of one) while focused on the key-edit input
		//   must return true (pass through) to preserve that native
		//   two-stage behavior — confirmed live (propertyItemSelection.e2e.ts).
		// - keyboard-quit's own bind() handler below ends with a native-
		//   Escape RE-DISPATCH to drive the actual exit for every OTHER
		//   value-widget type (checkbox/date/list/etc.) and for item-
		//   selection mode's own row/heading/Add-button. A Scope handler
		//   can't otherwise distinguish that re-dispatch from a genuine
		//   external Escape (both are equally "synthetic" from the DOM's
		//   own perspective) — returning false unconditionally for
		//   "not the key-edit input" swallowed that re-dispatch for every
		//   one of those other types, a second real regression
		//   (propertyCtrlG.e2e.ts / propertyOtherTypesCtrlGPnbf.e2e.ts)
		//   caught only after fixing the first one. UCH_INTERNAL_ESCAPE_REDISPATCH_FLAG
		//   tags that one specific re-dispatch so it can always pass
		//   through too, regardless of target.
		scope.register([], 'Escape', (evt) => {
			if ((evt as any)[UCH_INTERNAL_ESCAPE_REDISPATCH_FLAG]) return true;
			const target = evt.target as HTMLElement;
			// Pass through (defer to native handling) for ANY value-editing
			// widget, regardless of type -- a real, separate regression
			// (caught the same day, by a direct check rather than a test
			// failure) found that the original isKeyEdit-only condition
			// swallowed a genuine external bare Escape on every OTHER
			// widget type too (text/checkbox/date/list, and Bases' own
			// cells, which share these same classes) whenever
			// 'keyboard-quit' has no hotkey assigned — including the
			// out-of-the-box default, no-hotkey-configured state. Only
			// item-selection mode's own row/heading/Add-button need this
			// swallowed (confirmed still required by
			// propertyItemSelection.e2e.ts's own 2-escape sequence).
			return !target?.matches?.(PROPERTY_PANEL_FOCUS_SELECTOR);
		});
		// Bare Enter, scoped narrowly to ONLY the multi-select trailing
		// input or the name/key-edit input, with its own suggester
		// actually visible AND an item currently highlighted (see
		// PROPERTY_SUGGESTER_SELECTOR's own comment for why this needs a
		// from-scratch commit instead of delegating to any native
		// behavior) — every other context (every other widget type, or
		// either of these two inputs with no suggester open) passes
		// Enter straight through untouched, same as if this plugin
		// didn't register anything here at all. This is NOT wired
		// through the normal hotkey/command system the way every other
		// binding in this scope is — Enter has no modifier to
		// distinguish it by, and this plugin's own "ships with no
		// default hotkeys" convention doesn't really fit a bare,
		// unmodified key a user would almost never rebind on purpose;
		// registering it directly here, exactly like the bare-Escape
		// pass-through just above, keeps it active unconditionally
		// without needing a settings-exposed command for it.
		scope.register([], 'Enter', (evt) => {
			const target = evt.target as HTMLElement;
			if (!target?.matches?.(`${PROPERTY_MULTISELECT_INPUT_SELECTOR}, ${PROPERTY_KEY_EDIT_SELECTOR}`)) return true;
			const items = this.getVisibleSuggesterItems(target);
			const selected = items?.find(item => item.classList.contains(PROPERTY_SUGGESTER_SELECTED_CLASS));
			if (!selected) return true;
			selected.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: target.ownerDocument.defaultView ?? undefined }));
			return false;
		});
		const bind = (
			commandId: string,
			key: string,
			headingHandler?: (heading: HTMLElement) => void,
			addButtonHandler?: (addButton: HTMLElement) => void,
			valueEditHandler?: (valueEl: HTMLElement) => void,
			// Set-mark is the one command with no sensible native-dispatch
			// fallback for a plain row/heading/Add-button target (there's
			// nothing to "mark" there) — confirmed live that dispatching a
			// bare Space on a row isn't actually harmless as originally
			// assumed: Obsidian's own row listener treats it as "start
			// typing," moving focus straight into the value-edit widget and
			// inserting it. Suppressing the fallback entirely for those
			// targets (true no-op) avoids that side effect; every other
			// bind() call keeps relying on the fallback as before.
			suppressFallback?: boolean,
			// Which value-widget selector this specific command's own
			// valueEditHandler applies to — defaults to the original
			// text-only selector (every command before this phase). Ctrl-G
			// and Ctrl-P/N/B/F pass a broader one explicitly (see their own
			// call sites below) since they're the only commands extended
			// to checkbox/date/datetime/multi-select so far.
			valueEditSelector: string = PROPERTY_VALUE_EDIT_SELECTOR,
		) => {
			for (const hk of this.getEffectiveHotkeysFor(commandId)) {
				// Real user-reported bug: a Key Upgrade binding the SAME
				// bare key this handler is about to dispatch (e.g. the
				// "↓↑ column-aware" Key Upgrade adding a bare ArrowDown
				// hotkey to cursor-down, alongside Ctrl-N) makes
				// getEffectiveHotkeysFor return that bare hotkey too —
				// registering a handler for it here means the synthetic
				// dispatch below re-enters THIS SAME scope's own
				// just-registered handler for that exact (no modifiers,
				// key) combo, confirmed live to silently swallow the
				// whole chain (the real native row navigation never
				// actually runs). Skipping only this exact self-colliding
				// combo — not bare hotkeys in general — leaves e.g. a
				// vim-style bare 'j'/'k' binding to the same command
				// completely unaffected, since dispatching 'ArrowDown'
				// from a 'j'-triggered handler doesn't re-enter anything
				// registered under 'j'.
				if (hk.modifiers.length === 0 && hk.key === key) continue;
				scope.register(hk.modifiers as Modifier[], hk.key, (evt) => {
					const target = (evt.target as HTMLElement)?.matches?.(PROPERTY_PANEL_SCOPE_SELECTOR)
						? (evt.target as HTMLElement) : null;
					if (!target) return false;
					if (valueEditHandler && target.matches(valueEditSelector)) {
						// Real gap found live while adding frontmatter
						// recenter support: a value-edit widget can be
						// focused DIRECTLY (e.g. a click landing inside it,
						// not on the row's own item-selection container
						// first), in which case every subsequent command
						// here (Ctrl-B/F, Home/End, Kill/Yank, etc.) moves
						// the caret WITHIN an already-focused widget —
						// no new 'focusin' ever fires, so the focusin-based
						// reset above never sees it either. Resetting here
						// too covers it, EXCLUDING recenter/recenter-top-
						// bottom's own invocation specifically (both also
						// reach this exact branch for a value-edit widget
						// target), since otherwise recenter-top-bottom's
						// own press would immediately undo the very step
						// advance it's about to make.
						if (commandId !== 'recenter' && commandId !== 'recenter-top-bottom') {
							this.isKillChaining = false;
							this._recenterStep = 0;
						}
						valueEditHandler(target);
					} else if (headingHandler && target.matches('.metadata-properties-heading')) {
						headingHandler(target);
					} else if (addButtonHandler && target.matches('.metadata-add-button')) {
						addButtonHandler(target);
					} else if (!suppressFallback) {
						// Tagged for the same reason the keyboard-quit
						// handler's own Escape re-dispatch is (see
						// UCH_INTERNAL_ESCAPE_REDISPATCH_FLAG's own
						// comment) — this fallback IS how keyboard-quit
						// actually reaches item-selection mode's own row/
						// heading/Add-button (no custom valueEditHandler
						// is needed there), so it's this exact dispatch,
						// not the one inside that handler, that needs the
						// tag for THOSE targets. A real regression
						// (propertyCtrlG.e2e.ts) was caused by tagging
						// only the other one.
						//
						// Real gap found live: this fallback is also how
						// Ctrl-P/N/B/F reach a Bases table's own row/cell
						// navigation (no dedicated valueEditHandler exists
						// there either — see BASES_TABLE_CONTAINER_SELECTOR's
						// own comment) and item-selection mode's own row-
						// to-row navigation. Neither produces a CM6
						// transaction or a 'mousedown' (the two existing
						// triggers that reset _recenterStep for the note
						// body), so recenter-top-bottom's own cycle kept
						// advancing from wherever it left off instead of
						// restarting at "center" after moving — confirmed
						// live in Bases specifically, but the mechanism
						// (and the fix) is identical for item-selection
						// mode's own row navigation too, not something
						// narrowly Bases-specific.
						this.isKillChaining = false;
						this._recenterStep = 0;
						const fallbackEvt = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
						(fallbackEvt as any)[UCH_INTERNAL_ESCAPE_REDISPATCH_FLAG] = true;
						target.dispatchEvent(fallbackEvt);
					}
					return false;
				});
			}
		};
		// Ctrl-P/N inside the value-edit widget: a text property's value
		// is a multi-line, word-wrapping contenteditable (confirmed by its
		// own class name, "longtext"), so unlike a single-line field it
		// genuinely has multiple VISUAL lines to move between — reuses
		// titleMoveLine as-is (already generic over any HTMLElement, same
		// precedent as every other value-edit handler above). Matches the
		// minimal, within-widget-only scope every other command here
		// already has (Ctrl-A/E/F/B, Set-mark, Kill/Yank): no-ops at the
		// widget's own first/last visual line rather than escaping
		// anywhere (titleMoveLine's own `false` return — "no line to move
		// to" — is simply discarded here, unlike the title field's own
		// usage, which chains an escape-to-body/heading on that signal).
		//
		// Extended to date/datetime/multi-select via PROPERTY_CURSOR_PNBF_SELECTOR
		// (see propertyMoveLineOrNoop's own comment — date/datetime are a
		// confirmed, true platform wall here, no implementation is
		// possible for them at all).
		bind('cursor-up', 'ArrowUp', (heading) => this.propertyHeadingEscapeToTitle(heading), undefined, (el) => this.propertyMoveLineOrNoop(el, false), undefined, PROPERTY_CURSOR_LR_SELECTOR);
		bind('cursor-down', 'ArrowDown', (heading) => this.propertyHeadingCtrlN(heading), (addButton) => this.propertyAddButtonEscapeToBody(addButton), (el) => this.propertyMoveLineOrNoop(el, true), undefined, PROPERTY_CURSOR_LR_SELECTOR);
		// Ctrl-B/F: in item-selection mode, every element already does the
		// right thing with a plain native dispatch, no handler needed at
		// all — confirmed live: the heading collapses (Left) / expands
		// (Right) the whole Properties block (not a toggle: Right at an
		// already-expanded heading, and Left at an already-collapsed one,
		// are both a no-op), a row enters its own name-edit (Left) /
		// value-edit (Right) mode, and the Add-button does nothing either
		// way. Inside the value-edit widget itself, though, a plain
		// native dispatch does nothing useful — browsers only perform a
		// key's own default action (like moving a text caret) for
		// TRUSTED events, never a JS-constructed synthetic one — so this
		// reuses titleMoveChar/titleMoveToLineBoundary (0.13.0's existing
		// title-field movement implementation) directly, doing the real
		// Selection-API work ourselves instead of hoping a dispatch
		// triggers it. Both already take a generic HTMLElement and
		// operate purely through Selection.modify() on its own
		// ownerDocument, with no title-specific assumption baked in.
		//
		// Extended to date/datetime/multi-select via
		// propertyMoveCharOrNoop (same reasoning as cursor-up/down above).
		// Extended to the name/key-edit input via PROPERTY_CURSOR_LR_SELECTOR
		// (Ctrl-B/F only — Ctrl-P/N above deliberately stays off the name
		// field). propertyKeyMoveChar is a genuinely new implementation
		// (plain <input>'s own selectionStart/End, not document.getSelection()
		// — see PROPERTY_KEY_EDIT_SELECTOR's own comment).
		bind('cursor-left', 'ArrowLeft', undefined, undefined, (el) => el.matches(PROPERTY_KEY_EDIT_SELECTOR) ? this.propertyKeyMoveChar(el as HTMLInputElement, false) : this.propertyMoveCharOrNoop(el, false), undefined, PROPERTY_CURSOR_LR_SELECTOR);
		bind('cursor-right', 'ArrowRight', undefined, undefined, (el) => el.matches(PROPERTY_KEY_EDIT_SELECTOR) ? this.propertyKeyMoveChar(el as HTMLInputElement, true) : this.propertyMoveCharOrNoop(el, true), undefined, PROPERTY_CURSOR_LR_SELECTOR);
		// Extended to the name/key-edit input via PROPERTY_TEXT_LIKE_EDIT_SELECTOR
		// — every remaining command below that's meaningful on both the
		// text value-edit widget and the name/key-edit input follows
		// this same branch-on-PROPERTY_KEY_EDIT_SELECTOR shape.
		bind('cursor-home', 'Home', undefined, undefined, (el) => el.matches(PROPERTY_KEY_EDIT_SELECTOR) ? this.propertyKeyMoveToLineBoundary(el as HTMLInputElement, false) : this.titleMoveToLineBoundary(el, false), undefined, PROPERTY_TEXT_LIKE_EDIT_SELECTOR);
		bind('cursor-end', 'End', undefined, undefined, (el) => el.matches(PROPERTY_KEY_EDIT_SELECTOR) ? this.propertyKeyMoveToLineBoundary(el as HTMLInputElement, true) : this.titleMoveToLineBoundary(el, true), undefined, PROPERTY_TEXT_LIKE_EDIT_SELECTOR);
		// Word left/right (Alt-B/Alt-F): the last remaining title/property
		// command-parity gap, entirely new for both contexts (same as
		// Delete char). suppressFallback is set — unlike Ctrl-B/F above
		// (which fall through to a meaningful native dispatch on the
		// heading/row/Add-button), there's no established native meaning
		// for Alt+letter there, and the fallback dispatch's own
		// dropped-modifier risk (same class as every other suppressed
		// command here) applies equally to a bare 'b'/'f' landing on a row.
		bind('word-left', 'B', undefined, undefined, (el) => el.matches(PROPERTY_KEY_EDIT_SELECTOR) ? this.propertyKeyMoveWord(el as HTMLInputElement, false) : this.titleMoveWord(el, false), true, PROPERTY_TEXT_LIKE_EDIT_SELECTOR);
		bind('word-right', 'F', undefined, undefined, (el) => el.matches(PROPERTY_KEY_EDIT_SELECTOR) ? this.propertyKeyMoveWord(el as HTMLInputElement, true) : this.titleMoveWord(el, true), true, PROPERTY_TEXT_LIKE_EDIT_SELECTOR);
		// Ctrl-Space (set-mark): only meaningful in the value-edit widget —
		// there's nothing to "mark" on a row/heading/Add-button, so
		// suppressFallback is set instead of letting the native-dispatch
		// fallback run there. Confirmed live this fallback is NOT actually
		// harmless (an earlier assumption, now corrected): dispatching a
		// bare Space on a row makes Obsidian's own row listener treat it as
		// "start typing," moving focus straight into the value-edit widget
		// and inserting it — exactly the kind of accidental mode switch
		// this plugin should never cause. Reuses titleSetMark as-is: it
		// arms markActive and collapses the native Selection to its own
		// current focus (the anchor point) — titleMoveChar/
		// titleMoveToLineBoundary above already check markActive via
		// titleSelectionModify's own 'extend' vs 'move' branch, so
		// movement immediately starts extending a real selection once
		// armed, confirmed live. Extended to the name/key-edit input via
		// propertyKeySetMark (same markActive flag, its own anchor
		// tracked through the input's own selectionStart/End/Direction
		// triple instead of a native Selection's anchor/focus).
		bind('set-mark', ' ', undefined, undefined, (el) => el.matches(PROPERTY_KEY_EDIT_SELECTOR) ? this.propertyKeySetMark(el as HTMLInputElement) : this.titleSetMark(el), true, PROPERTY_TEXT_LIKE_EDIT_SELECTOR);
		// Ctrl-G (keyboard-quit): a plain native dispatch for
		// item-selection mode, no handler needed there — confirmed live
		// that native Escape from ANY of those elements (a row, the
		// heading, the Add-button, panel expanded or collapsed) simply
		// returns DOM focus to the body (CM6's own cursor position was
		// never touched while focus was in Properties, so it's restored
		// exactly where it already was — no goal-column logic needed
		// here, unlike cursor-up/down).
		//
		// The value-edit widget needs its own handler, unlike
		// cursor-left/right/home/end above: native Escape alone DOES
		// still exit toward item-selection mode there (JS-handled, not a
		// browser-default action, so a synthetic dispatch reaches it
		// fine) — but real Emacs's C-g is a universal ABORT, which must
		// also clear any armed mark, not just leave it dangling for
		// whatever's focused next. titleKeyboardQuit (reused as-is) does
		// exactly that — arms markActive=false and collapses the
		// Selection to focus — then the native Escape dispatch (the
		// SAME one used everywhere else in this bind) does the actual
		// exit.
		//
		// Extended to ALL other value-widget types via
		// PROPERTY_ANY_VALUE_WIDGET_SELECTOR (the one command that
		// reaches checkbox too, unlike Ctrl-PNBF above) — confirmed live
		// the native-Escape-dispatch exit mechanism itself works
		// identically for checkbox/date/multi-select, same as text.
		// titleKeyboardQuit is skipped for checkbox/date/datetime
		// specifically (PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR): there's no
		// mark/Selection concept to clear there at all, and calling
		// doc.getSelection() while focus is in a plain <input> has
		// nothing meaningful to collapse anyway. The name/key-edit input
		// DOES have a mark concept (propertyKeySetMark above), but it's
		// a DIFFERENT selection model from titleKeyboardQuit's own
		// document.getSelection() — propertyKeyKeyboardQuit is its own
		// parallel implementation, same idea (clear markActive, collapse
		// to the current caret) via the input's own selectionStart/End.
		// The native-Escape re-dispatch below is tagged with
		// UCH_INTERNAL_ESCAPE_REDISPATCH_FLAG — see this scope's own
		// bare-Escape pass-through registration (right after `const scope
		// = new Scope()` above) for why: without the tag, that
		// registration would swallow THIS re-dispatch for every type
		// other than the key-edit input, breaking the actual exit this
		// line exists to perform (a real regression, caught by
		// propertyCtrlG.e2e.ts / propertyOtherTypesCtrlGPnbf.e2e.ts).
		bind('keyboard-quit', 'Escape', undefined, undefined, (el) => {
			if (el.matches(PROPERTY_KEY_EDIT_SELECTOR)) {
				this.propertyKeyKeyboardQuit(el as HTMLInputElement);
			} else if (!el.matches(PROPERTY_SIMPLE_EXIT_ONLY_SELECTOR)) {
				this.titleKeyboardQuit(el);
			}
			const escEvt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
			(escEvt as any)[UCH_INTERNAL_ESCAPE_REDISPATCH_FLAG] = true;
			el.dispatchEvent(escEvt);
		}, undefined, PROPERTY_ANY_VALUE_WIDGET_SELECTOR);
		// Ctrl-K (kill-line) / Ctrl-W (kill-region) / Alt-W (copy-region) /
		// Ctrl-Y (yank): only meaningful in the value-edit widget — there's
		// nothing to kill/copy/yank on a row/heading/Add-button. All four
		// reuse their title-field counterpart as-is (titleKillLine/
		// titleKillRegion/titleCopyRegion/titleYank), already generic over
		// any HTMLElement via its own ownerDocument's Selection API, same
		// precedent as every value-edit handler above. suppressFallback is
		// set for all four, same reasoning as set-mark above: their base
		// keys are plain letters, and the fallback dispatch's own dropped-
		// modifier bug (fixed for set-mark, see its own comment above)
		// would equally make a bare letter keydown on a row look like
		// "start typing" to Obsidian's own row listener.
		//
		// kill-line/kill-region/kill-word/yank/delete-char all mutate the
		// widget's content via execCommand — Obsidian's own property-value
		// suggestion dropdown can react by shadowing propertyRowScope, but
		// this is now handled uniformly by a single document-level 'input'
		// listener (see registerWindowDomListeners's own comment on why a
		// per-command reclaim call isn't used here, after native Undo/Redo
		// turned out to need the exact same fix with no corresponding
		// command-level call site to attach it to). copy-region never
		// mutates the DOM, so it never triggers that listener at all.
		// Extended to the name/key-edit input via PROPERTY_TEXT_LIKE_EDIT_SELECTOR
		// — propertyKeyKillLine/KillRegion/CopyRegion/Yank reuse the exact
		// same execCommand('delete'/'insertText') technique as their title
		// counterparts, confirmed live it respects a plain <input>'s own
		// selectionStart/End exactly like it respects document.getSelection()
		// for a contenteditable (including persistence to frontmatter
		// after blur, no manual 'input'/'change' dispatch needed).
		bind('kill-line', 'K', undefined, undefined, (el) => el.matches(PROPERTY_KEY_EDIT_SELECTOR) ? this.propertyKeyKillLine(el as HTMLInputElement) : this.titleKillLine(el), true, PROPERTY_TEXT_LIKE_EDIT_SELECTOR);
		bind('kill-region', 'W', undefined, undefined, (el) => el.matches(PROPERTY_KEY_EDIT_SELECTOR) ? this.propertyKeyKillRegion(el as HTMLInputElement) : this.titleKillRegion(el), true, PROPERTY_TEXT_LIKE_EDIT_SELECTOR);
		bind('copy-region', 'W', undefined, undefined, (el) => el.matches(PROPERTY_KEY_EDIT_SELECTOR) ? this.propertyKeyCopyRegion(el as HTMLInputElement) : this.titleCopyRegion(el), true, PROPERTY_TEXT_LIKE_EDIT_SELECTOR);
		bind('yank', 'Y', undefined, undefined, (el) => { if (el.matches(PROPERTY_KEY_EDIT_SELECTOR)) { void this.propertyKeyYank(el as HTMLInputElement); } else { void this.titleYank(el); } }, true, PROPERTY_TEXT_LIKE_EDIT_SELECTOR);
		// Kill word left/right (Alt-Backspace/Alt-D): reuses titleKillWord
		// as-is, matching the title field's own command set, which already
		// has this (the earlier "deliberately out of scope" decision for
		// this sub-feature was revisited once the title/property command
		// parity gap was noticed). propertyKeyKillWord reuses
		// findWordSpanOnLine (word-segmentation.ts) directly on the
		// input's own .value string — the body's own word-motion engine,
		// not titleKillWord's native Selection.modify('word'), since that
		// API doesn't apply to a plain <input> at all.
		bind('kill-word-left', 'Backspace', undefined, undefined, (el) => el.matches(PROPERTY_KEY_EDIT_SELECTOR) ? this.propertyKeyKillWord(el as HTMLInputElement, false) : this.titleKillWord(el, false), true, PROPERTY_TEXT_LIKE_EDIT_SELECTOR);
		bind('kill-word-right', 'D', undefined, undefined, (el) => el.matches(PROPERTY_KEY_EDIT_SELECTOR) ? this.propertyKeyKillWord(el as HTMLInputElement, true) : this.titleKillWord(el, true), true, PROPERTY_TEXT_LIKE_EDIT_SELECTOR);
		// Delete char (Ctrl-D): reuses titleDeleteChar as-is, entirely new
		// for both the title field and this widget (unlike every command
		// above, which already existed on at least one side).
		bind('delete-char', 'D', undefined, undefined, (el) => el.matches(PROPERTY_KEY_EDIT_SELECTOR) ? this.propertyKeyDeleteChar(el as HTMLInputElement) : this.titleDeleteChar(el), true, PROPERTY_TEXT_LIKE_EDIT_SELECTOR);
		// Recenter / Recenter top-bottom (Ctrl-L), broadened from Bases-only
		// to the ENTIRE Properties panel (row/heading/Add-button/every
		// value-edit widget/the key-edit input) -- see
		// recenterPropertyPanel/recenterTopBottomPropertyPanel's own
		// comment for why this works at all: `.metadata-container` sits
		// INSIDE the same `.cm-scroller` the note body itself scrolls
		// (confirmed live, not assumed), so the exact same scroll
		// primitive the body's own recenter uses applies here too, just
		// targeting the focused property element's own rect instead of
		// the CM6 cursor's. Internally branches to the existing
		// recenterBases/recenterTopBottomBases for a Bases container
		// specifically (same formula, different scroll ancestor).
		// suppressFallback is set: there's no meaningful native
		// behavior for Ctrl-L to delegate to here (unlike cursor-up/
		// down/left/right above), so a bare native-dispatch fallback
		// would risk triggering something unrelated and unintended.
		bind('recenter', 'L', undefined, undefined, (el) => this.recenterPropertyPanel(el), true, PROPERTY_PANEL_SCOPE_SELECTOR);
		bind('recenter-top-bottom', 'L', undefined, undefined, (el) => this.recenterTopBottomPropertyPanel(el), true, PROPERTY_PANEL_SCOPE_SELECTOR);
		return scope;
	}

	// Real bug found via live diagnostic while investigating a user report
	// ("Ctrl-A→Ctrl-K→Ctrl-Y twice in a row and the cursor stops
	// responding, Ctrl-G doesn't even work, only physical Escape gets me
	// out"): a value-edit command that mutates the widget's content via
	// doc.execCommand fires a real 'input' event, which Obsidian's OWN
	// property-value suggestion dropdown (the "previously used values for
	// this property" autocomplete, already visible the moment the widget
	// gets focus) reacts to by pushing its OWN Scope on top of
	// propertyRowScope — confirmed live via a diagnostic dump of
	// app.keymap's own window-scope stack (getWindowStack(activeWindow).scope)
	// after a repeated Kill-line/Yank cycle: propertyRowScope was still
	// technically pushed (our own focusin/focusout handlers saw nothing,
	// since DOM focus never actually left the value-edit widget) but
	// SHADOWED underneath the suggester's own scope — every command bound
	// here (confirmed with Ctrl-G specifically) silently stopped firing
	// until the user pressed physical Escape, which closes the
	// suggester's own dropdown and pops its scope as a side effect of
	// Obsidian's own code, unrelated to anything this plugin does.
	//
	// Fix: after a 2-frame defer (same margin already used elsewhere in
	// this file for analogous focus/render-settling races — the
	// suggester's own reactive push needs to have already happened by
	// then), check whether the window's current scope is still ours; if
	// something else has taken over, pop THAT scope specifically rather
	// than force-pushing a duplicate of our own on top of it. Confirmed
	// live this is the correct fix shape: force-pushing would leave a
	// stale duplicate of propertyRowScope sitting in prevScopes forever
	// (the suggester's own eventual popScope call for its own scope would
	// then find itself no longer on top and silently no-op, leaking the
	// stack), while popping the foreign scope directly restores
	// propertyRowScope to the top cleanly, with no leftover stack growth.
	//
	// Originally called individually after each mutating command
	// (kill-line/kill-region/kill-word/yank/delete-char). Moved to a
	// single document-level 'input' listener (registerWindowDomListeners)
	// once native Undo/Redo was found to trigger the exact same bug with
	// NO command-level call site to attach a reclaim to (Cmd-Z/Cmd-
	// Shift-Z mutate the widget via the browser's own undo manager, never
	// through anything this plugin dispatches) — reacting to the real
	// 'input' event itself, regardless of cause, covers every mutation
	// path uniformly instead of requiring a reclaim call to be remembered
	// at each new mutating command's own call site.
	private reclaimPropertyRowScopeAfterMutation() {
		requestAnimationFrameOnActiveWindow(() => {
			requestAnimationFrameOnActiveWindow(() => {
				if (!this.propertyRowScope) return;
				const keymap = (this.app as any).keymap;
				const current = keymap.getWindowStack(activeWindow).scope;
				if (current && current !== this.propertyRowScope) {
					keymap.popScope(current);
				}
			});
		});
	}

	// Ctrl-P/N inside the value-edit widget: wraps titleMoveLine with a
	// restore-on-no-op, since titleMoveLine's own `false` return ("no
	// line to move to") does NOT mean "the selection was left untouched"
	// — confirmed live: its internal Selection.modify('move', dir,
	// 'line') call still mutates the real selection (e.g. jumping to the
	// value's own end on a short, single-visual-line value) even when
	// the function decides afterward there was no actual visual-line
	// change to finish landing on. This was never a problem for the
	// title field's own Ctrl-N/P, the only existing caller — a `false`
	// there always leads to escaping to the body/heading, which replaces
	// the selection anyway, so the modify() call's own side effect never
	// mattered. The value-edit widget has nowhere to escape to (every
	// other command here is deliberately within-widget-only, matching
	// Ctrl-A/E/F/B/Set-mark/Kill/Yank's own scope), so a boundary press
	// must be a TRUE no-op — captures the anchor/focus pair beforehand
	// and restores it via setBaseAndExtent whenever titleMoveLine reports
	// no movement.
	private propertyValueEditMoveLine(valueEl: HTMLElement, forward: boolean) {
		const sel = valueEl.ownerDocument.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const anchorNode = sel.anchorNode, anchorOffset = sel.anchorOffset;
		const focusNode = sel.focusNode, focusOffset = sel.focusOffset;
		const moved = this.titleMoveLine(valueEl, forward);
		if (!moved && anchorNode && focusNode) {
			(sel as unknown as { setBaseAndExtent(aNode: Node, aOff: number, fNode: Node, fOff: number): void })
				.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
		}
	}

	// Finds the suggester's own item list, scoped to the SAME document
	// as el (popout-window safety, same convention as every other
	// document-scoped lookup in this file) — returns null if no
	// suggester is currently visible there at all.
	private getVisibleSuggesterItems(el: HTMLElement): HTMLElement[] | null {
		const container = el.ownerDocument.querySelector(PROPERTY_SUGGESTER_SELECTOR);
		if (!container) return null;
		const items = Array.from(container.querySelectorAll(PROPERTY_SUGGESTER_ITEM_SELECTOR)) as HTMLElement[];
		return items.length > 0 ? items : null;
	}

	// Moves PROPERTY_SUGGESTER_SELECTED_CLASS to the next/previous item —
	// this plugin's own from-scratch replacement for the native up/down
	// navigation this suggester doesn't support at all (see
	// PROPERTY_SUGGESTER_SELECTOR's own comment). Clamps at either end
	// (matching every other Ctrl-N/P boundary in this plugin's own
	// convention — a true no-op there, not wrapping) rather than
	// cycling back around. A single-item list never has anything marked
	// `.is-selected` to begin with (confirmed live) — in that case,
	// forward selects item 0 and backward does nothing, simplest sane
	// behavior for a list that was never going to have anywhere else to
	// go either way.
	//
	// scrollIntoView({ block: 'nearest' }) afterward — toggling the
	// class alone doesn't auto-scroll (unlike a real native selection
	// change), so navigating past the suggester's own visible window
	// left the newly-highlighted item clipped out of view entirely
	// without this. 'nearest' (not 'center'/'start') avoids scrolling at
	// all once the item is already fully visible, matching how a real
	// native list's own keyboard navigation behaves.
	private propertyNavigateSuggester(items: HTMLElement[], forward: boolean) {
		const currentIndex = items.findIndex(item => item.classList.contains(PROPERTY_SUGGESTER_SELECTED_CLASS));
		const nextIndex = currentIndex === -1
			? (forward ? 0 : -1)
			: currentIndex + (forward ? 1 : -1);
		if (nextIndex < 0 || nextIndex >= items.length) return;
		if (currentIndex !== -1) items[currentIndex].classList.remove(PROPERTY_SUGGESTER_SELECTED_CLASS);
		items[nextIndex].classList.add(PROPERTY_SUGGESTER_SELECTED_CLASS);
		items[nextIndex].scrollIntoView({ block: 'nearest' });
	}

	// Ctrl-P/N's own entry point for PROPERTY_CURSOR_PNBF_SELECTOR
	// (text/multi-select/date/datetime): date/datetime get a true no-op
	// here — confirmed live (diagnostic probe, not assumed) that these
	// have no Selection API AND that a synthetic Arrow-key dispatch does
	// NOT trigger their native stepping behavior either (that's a
	// trusted-events-only browser default, same category as plain
	// text-caret movement — a real browser.keys() press does step the
	// value, but nothing a plugin's own JS-constructed KeyboardEvent can
	// trigger). Text and multi-select both reuse the existing
	// propertyValueEditMoveLine as-is — multi-select's own trailing chip
	// is a real contenteditable with the same Selection API, confirmed
	// live.
	//
	// Multi-select gets a further, earlier branch: while its own
	// suggester is visible, Ctrl-N/P navigate IT instead of moving the
	// caret — reusing this same command rather than adding a separate
	// one, matching how the suggester visually COVERS the caret's own
	// line-movement concern anyway while it's open (there is no second,
	// independent "move within the input" need at that exact moment).
	//
	// The name/key-edit input gets the SAME suggester-navigation branch,
	// but unconditionally returns either way afterward (never falls
	// through to propertyValueEditMoveLine, which assumes a
	// contenteditable's own Selection API — this input is a plain
	// <input>, with no up/down meaning of its own at all, matching the
	// existing scope decision for this field).
	private propertyMoveLineOrNoop(el: HTMLElement, forward: boolean) {
		if (el.matches(PROPERTY_DATE_TYPE_SELECTOR)) return;
		if (el.matches(PROPERTY_KEY_EDIT_SELECTOR)) {
			const items = this.getVisibleSuggesterItems(el);
			if (items) this.propertyNavigateSuggester(items, forward);
			return;
		}
		if (el.matches(PROPERTY_MULTISELECT_INPUT_SELECTOR)) {
			const items = this.getVisibleSuggesterItems(el);
			if (items) {
				this.propertyNavigateSuggester(items, forward);
				return;
			}
		}
		this.propertyValueEditMoveLine(el, forward);
	}

	// True when the Selection's own focus sits at the very start of el's
	// text content (no characters between el's own start and the focus
	// position) — used to detect the multi-select trailing input's own
	// left boundary below, where native ArrowLeft hands focus off to the
	// preceding pill instead of just staying in place the way
	// Selection.modify does at any other character boundary.
	private isSelectionAtStartOf(el: HTMLElement): boolean {
		const sel = el.ownerDocument.getSelection();
		if (!sel || !sel.focusNode) return false;
		const range = el.ownerDocument.createRange();
		range.selectNodeContents(el);
		try {
			range.setEnd(sel.focusNode, sel.focusOffset);
		} catch {
			return false;
		}
		return range.toString().length === 0;
	}

	// Ctrl-B/F's own entry point for PROPERTY_CURSOR_PNBF_SELECTOR — same
	// reasoning as propertyMoveLineOrNoop above, reusing titleMoveChar
	// as-is for text/multi-select.
	//
	// list/tags/aliases' own trailing input is a special case at its
	// OWN left boundary: confirmed live that a real ArrowLeft there
	// hands focus to the preceding pill (PROPERTY_MULTISELECT_PILL_SELECTOR,
	// the input's own immediately preceding DOM sibling when the pill
	// list is non-empty, not part of this input's own text at all) --
	// titleMoveChar's own Selection.modify('move', 'left', ...) has
	// nothing to move INTO at that same boundary, so it's a true no-op
	// there, unlike every other character position. Focuses the
	// preceding pill DIRECTLY (previousElementSibling, confirmed live
	// to be exactly the pill) rather than delegating to a native-
	// equivalent dispatch the way other cross-element escapes in this
	// plugin do -- confirmed live that a synthetic ArrowLeft dispatch
	// here is UNRELIABLE (worked once in isolated testing, consistently
	// failed once real Ctrl+B keypresses were already flowing through
	// Obsidian's own Keymap dispatch earlier in the same session,
	// matching this project's own established "synthetic dispatchEvent()
	// gives unreliable results for anything touching Keymap" lesson) --
	// so this reimplements the actual target-finding instead of hoping
	// the dispatch reaches the same native handler reliably. Skipped
	// while a mark is active -- extending a marked selection across this
	// boundary has no defined meaning (same "stay in place" convention a
	// marked selection already has at every other cross-widget boundary
	// in this plugin).
	private propertyMoveCharOrNoop(el: HTMLElement, forward: boolean) {
		if (el.matches(PROPERTY_DATE_TYPE_SELECTOR)) return;
		if (!forward && !this.markActive && el.matches(PROPERTY_MULTISELECT_INPUT_SELECTOR) && this.isSelectionAtStartOf(el)) {
			const prevPill = el.previousElementSibling as HTMLElement | null;
			if (prevPill?.matches(PROPERTY_MULTISELECT_PILL_SELECTOR)) prevPill.focus();
			return;
		}
		this.titleMoveChar(el, forward);
	}

	//===========================================================================
	// Property NAME (key) editing — a plain <input type="text">, NOT a
	// contenteditable. document.getSelection() doesn't apply to a form
	// control's own internal text at all; every handler below works
	// through the input's own selectionStart/selectionEnd/
	// selectionDirection triple instead, which plays the exact same
	// anchor/focus role a native Selection's anchor/focus does for the
	// title field. Confirmed live (diagnostic probe) that
	// execCommand('delete'/'insertText') still respects this triple
	// correctly when the input has focus, same mechanism titleKillLine/
	// titleKillWord/titleKillRegion/titleYank already use for the
	// contenteditable case — so Kill/Yank below reuse that exact
	// technique, just reading/writing selectionStart/End instead of a
	// Range.
	//===========================================================================

	// The input's own current caret ("focus" in Selection-API terms): the
	// end of its selectionStart/End pair that selectionDirection says is
	// the ACTIVE one. When collapsed (no mark active), start===end, so
	// either one is correct — 'forward'/'none' naturally reads
	// selectionEnd in that case, which is fine.
	private propertyKeyCaret(el: HTMLInputElement): number {
		return el.selectionDirection === 'backward' ? (el.selectionStart ?? 0) : (el.selectionEnd ?? 0);
	}

	// The mark's anchor (fixed point a Set-mark extension grows from) —
	// only ever meaningful while markActive is true (propertyKeySelect
	// below never calls this otherwise). The OTHER end of the current
	// selectionStart/End pair from whichever one propertyKeyCaret reads,
	// exactly mirroring how a native Selection's own anchor/focus split
	// works once Selection.modify('extend', ...) starts being used.
	private propertyKeyAnchor(el: HTMLInputElement): number {
		return el.selectionDirection === 'backward' ? (el.selectionEnd ?? 0) : (el.selectionStart ?? 0);
	}

	// Applies a new caret target to the input's own selection — the
	// single primitive every movement handler below goes through.
	// Mirrors Selection.modify's own 'move' vs 'extend' branch exactly:
	// mark inactive ('move') fully collapses to target, discarding
	// whatever selection existed before; mark active ('extend') grows
	// from the existing anchor instead. Collapsing unconditionally in
	// the 'move' case (rather than computing anchor=target, which looks
	// equivalent but isn't) matters because the anchor read here is the
	// OLD position — a one-line plain `el.setSelectionRange(anchor,
	// target)` would leave a stray one-character-wide range instead of
	// a true collapsed caret whenever they differ (confirmed live: this
	// was a real bug in an earlier version of this function, caught by
	// a failing Ctrl-F test expecting a fully collapsed caret).
	private propertyKeySelect(el: HTMLInputElement, target: number) {
		if (!this.markActive) {
			el.setSelectionRange(target, target);
			return;
		}
		const anchor = this.propertyKeyAnchor(el);
		const start = Math.min(anchor, target);
		const end = Math.max(anchor, target);
		el.setSelectionRange(start, end, target >= anchor ? 'forward' : 'backward');
	}

	private propertyKeyMoveChar(el: HTMLInputElement, forward: boolean) {
		this.isKillChaining = false; // see titleMoveToLineBoundary's own comment on why every non-kill move resets this
		const caret = this.propertyKeyCaret(el);
		const target = forward ? Math.min(caret + 1, el.value.length) : Math.max(caret - 1, 0);
		this.propertyKeySelect(el, target);
	}

	// Home/End: unlike titleMoveToLineBoundary, there's no visual-line
	// wrapping to worry about at all — a property name is always a
	// single line, so this is just the input's own start/end offset
	// directly, no scanning needed.
	private propertyKeyMoveToLineBoundary(el: HTMLInputElement, forward: boolean) {
		this.isKillChaining = false;
		this.propertyKeySelect(el, forward ? el.value.length : 0);
	}

	// Alt-B/Alt-F: reuses findWordSpanOnLine (word-segmentation.ts) —
	// the body's own Emacs word-motion engine, operating directly on the
	// input's .value string — rather than titleMoveWord's native
	// Selection.modify('word', ...), which has no equivalent for a plain
	// <input>'s internal text. No-ops at the value's own start/end,
	// matching titleMoveWord's own boundary behavior there.
	private propertyKeyMoveWord(el: HTMLInputElement, forward: boolean) {
		this.isKillChaining = false;
		const caret = this.propertyKeyCaret(el);
		const span = findWordSpanOnLine(el.value, caret, forward);
		const target = span ? (forward ? span.to : span.from) : caret;
		this.propertyKeySelect(el, target);
	}

	// Ctrl-Space: arms markActive and collapses to the current caret —
	// the input-selection equivalent of titleSetMark. Reads the caret
	// BEFORE collapsing (propertyKeyAnchor/Caret both still read the
	// pre-arm selection at this point, same ordering as titleSetMark).
	private propertyKeySetMark(el: HTMLInputElement) {
		const caret = this.propertyKeyCaret(el);
		this.markActive = true;
		el.setSelectionRange(caret, caret);
	}

	// Ctrl-G: clears markActive and collapses to the current caret — the
	// input-selection equivalent of titleKeyboardQuit. Does NOT touch
	// focus itself; the native Escape dispatch at this bind's own call
	// site handles the actual exit to item-selection mode.
	private propertyKeyKeyboardQuit(el: HTMLInputElement) {
		const caret = this.propertyKeyCaret(el);
		this.markActive = false;
		el.setSelectionRange(caret, caret);
	}

	// Ctrl-K: kills from caret to the end of the value, ignoring any
	// active region — same "always from point" convention as
	// titleKillLine. Collapses first, so an active mark's own anchor
	// never affects which text gets killed.
	private propertyKeyKillLine(el: HTMLInputElement) {
		this.markActive = false;
		const caret = this.propertyKeyCaret(el);
		const doc = el.ownerDocument;
		if (caret >= el.value.length) { el.setSelectionRange(caret, caret); return; } // already at the end: nothing to kill
		el.setSelectionRange(caret, el.value.length);
		const killedText = el.value.slice(caret, el.value.length);
		doc.execCommand('delete', false);
		this.updateKillCache(killedText);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		this.isKillChaining = true;
	}

	// Alt-Backspace/Alt-D: kills one word left/right from the caret,
	// discarding any active region first (same "from point only"
	// convention as titleKillWord). prepend = !forward on
	// updateKillCache, matching titleKillWord's own buffer-order
	// convention for consecutive kills.
	private propertyKeyKillWord(el: HTMLInputElement, forward: boolean) {
		this.markActive = false;
		const doc = el.ownerDocument;
		const caret = this.propertyKeyCaret(el);
		const span = findWordSpanOnLine(el.value, caret, forward);
		const target = span ? (forward ? span.to : span.from) : caret;
		if (target === caret) return; // already at the value's own start/end: nothing to kill
		el.setSelectionRange(Math.min(caret, target), Math.max(caret, target));
		const killedText = el.value.slice(Math.min(caret, target), Math.max(caret, target));
		doc.execCommand('delete', false);
		this.updateKillCache(killedText, !forward);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		this.isKillChaining = true;
	}

	// Ctrl-D: deletes the character after point, ignoring the mark
	// entirely (matches real Emacs's delete-char, same as
	// titleDeleteChar). If a non-empty selection already exists, deletes
	// exactly that; if collapsed, extends by one character forward
	// first, then deletes — true no-op at the value's own end rather
	// than guessing a direction.
	private propertyKeyDeleteChar(el: HTMLInputElement) {
		this.markActive = false;
		const doc = el.ownerDocument;
		if (el.selectionStart === el.selectionEnd) {
			const caret = el.selectionStart ?? 0;
			if (caret >= el.value.length) return; // already at the value's own end: nothing to delete
			el.setSelectionRange(caret, caret + 1);
		}
		doc.execCommand('delete', false);
	}

	// Alt-W (Copy region): copies the active selection without mutating
	// the value, same as titleCopyRegion.
	private propertyKeyCopyRegion(el: HTMLInputElement) {
		if (el.selectionStart === el.selectionEnd) return; // nothing selected
		const text = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
		this.markActive = false;
		this.isKillChaining = false;
		const caret = this.propertyKeyCaret(el);
		el.setSelectionRange(caret, caret);
		this.updateKillCache(text);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
	}

	// Ctrl-W (Kill region): same as titleKillRegion, operating on the
	// input's own active selectionStart/End rather than a native
	// Selection.
	private propertyKeyKillRegion(el: HTMLInputElement) {
		if (el.selectionStart === el.selectionEnd) return; // nothing selected
		const doc = el.ownerDocument;
		const text = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
		doc.execCommand('delete', false);
		this.markActive = false;
		this.isKillChaining = false;
		this.updateKillCache(text);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
	}

	// Ctrl-Y (Yank): reads the OS clipboard (falling back to the
	// kill-ring if that throws, same as titleYank), replacing any active
	// selection. Strips embedded newlines for the same reason titleYank
	// does — a property name has even less use for one than the title
	// does, and execCommand('insertText', ...) on an input mangles a raw
	// newline rather than silently dropping it the way a contenteditable
	// does.
	private async propertyKeyYank(el: HTMLInputElement) {
		this.markActive = false;
		this.isKillChaining = false;
		let raw: string;
		try {
			raw = await navigator.clipboard.readText();
		} catch {
			raw = this.killCache;
		}
		if (!raw) return;
		const text = raw.replace(/\n/g, '');
		if (!text) return;
		el.ownerDocument.execCommand('insertText', false, text);
	}

	// Properties heading, Ctrl-P: lands a collapsed cursor at the title's
	// own end, rather than native ArrowUp's own select-the-whole-title —
	// matches every other Ctrl-N/P crossing in this plugin (body<->title,
	// table-row crossings), which always lands a collapsed cursor, never
	// a selection. Scoped to the active view's own container (not
	// document-wide), same multi-leaf/popout reasoning as
	// escapeUpToTitle/titleMoveLineOrEscapeToBody.
	private propertyHeadingEscapeToTitle(heading: HTMLElement) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const scopeEl = view?.containerEl ?? heading.ownerDocument;
		const title = scopeEl.querySelector(TITLE_SELECTOR) as HTMLElement | null;
		if (!title) return;
		title.focus();
		const doc = title.ownerDocument;
		const sel = doc.getSelection() as (Selection & {
			modify(alter: string, direction: string, granularity: string): void;
		}) | null;

		// 0.13.0 Feature 1, frontmatter sub-phase: if a goal column
		// survived the Properties detour (set by moveCursorUpImpl or
		// titleMoveLineOrEscapeToBody when first entering Properties),
		// land at its title-space equivalent instead of the title's own
		// end — matches body<->title crossing's own column-preserving
		// behavior for the no-frontmatter case. Mirrors escapeUpToTitle's
		// own landing logic (caretRangeFromPoint + the same ambiguous-VL
		// nudge), just reached from the heading instead of the body.
		if (this.propertyGoalX != null && view) {
			const cm = (view.editor as any).cm as EditorView;
			const bodyLineStartX = cm.coordsAtPos(view.editor.posToOffset({ line: this.getFirstBodyLine(), ch: 0 }))?.left;
			const titleStartX = title.getBoundingClientRect().left;
			const adjustedX = bodyLineStartX != null ? this.propertyGoalX - bodyLineStartX + titleStartX : this.propertyGoalX;
			this.propertyGoalX = null;
			this.titleGoalX = adjustedX;
			const titleRect = title.getBoundingClientRect();
			const targetY = titleRect.bottom - 1;
			const clampedX = Math.min(Math.max(adjustedX, titleRect.left), titleRect.right - 1);
			const range = (doc as unknown as { caretRangeFromPoint(x: number, y: number): Range | null })
				.caretRangeFromPoint(clampedX, targetY);
			if (range && title.contains(range.startContainer)) {
				sel?.removeAllRanges();
				sel?.addRange(range);
				const landedRects = sel ? Array.from(sel.getRangeAt(0).getClientRects()) : [];
				if (landedRects.length > 1) {
					const targetRect = landedRects.reduce((a, b) => (b.top > a.top ? b : a));
					if (Math.abs(landedRects[0].top - targetRect.top) >= 1) {
						sel?.modify('move', 'right', 'character');
					}
				}
				return;
			}
			// Landing failed (e.g. hit-test fell outside the title) — fall
			// through to the default end-of-title landing below.
		}

		// No preserved goal (or landing above failed) — collapse to the
		// title's own end. Deliberately NOT sel.collapse(title,
		// title.childNodes.length) — confirmed live that lands the
		// selection's focus/anchor on the title's own container DIV (an
		// ELEMENT, child-index-based position) rather than its text node,
		// the same bug class already found and fixed for titleYank's own
		// newline handling. A subsequent Ctrl-N from there (titleMoveLine)
		// misjudges that element-anchored position as "there's still room
		// to move," silently eating the first press before a second one
		// finally escapes back out. Selection.modify's own
		// 'documentboundary' granularity always lands on a real text node
		// instead.
		this.propertyGoalX = null;
		sel?.modify('move', 'forward', 'documentboundary');
	}

	// Properties heading, Ctrl-N: when the panel is EXPANDED (and has at
	// least one row), focuses the first row directly rather than
	// dispatching a synthetic native ArrowDown and trusting Obsidian's
	// own handler to move focus there — a real user-reported bug on
	// Windows (confirmed NOT reproducible on macOS, both Obsidian 1.14.5
	// and 1.15.0, with a byte-identical build; same dispatch-and-trust
	// behavior existed unchanged since this plugin's very first
	// heading/Add-button support, so this isn't something this session's
	// own changes introduced). When the panel is COLLAPSED, or expanded
	// but with zero rows, reuses propertyAddButtonEscapeToBody's own
	// goal-column-aware body-landing logic directly — it only ever uses
	// its element argument for the native-dispatch fallback, so the
	// heading works just as well there as the real Add-button.
	private propertyHeadingCtrlN(heading: HTMLElement) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const addButton = view?.containerEl.querySelector('.metadata-add-button') as HTMLElement | null;
		if (addButton && addButton.offsetParent !== null) {
			const firstRow = view?.containerEl.querySelector('.metadata-property') as HTMLElement | null;
			if (firstRow) {
				firstRow.focus();
				return;
			}
		}
		this.propertyAddButtonEscapeToBody(heading);
	}

	// Properties Add-button, Ctrl-N: mirrors propertyHeadingEscapeToTitle
	// for the opposite direction — lands in the body at the preserved
	// goal column (propertyGoalX, already stored in body-space, see its
	// own comment) if one survived the Properties detour, reusing
	// titleMoveLineOrEscapeToBody's own body-landing logic (posAtCoords +
	// seeding CM6's native goalColumn so a Ctrl-P/N chain continuing in
	// the body keeps reaching for this same column). Falls back to plain
	// native ArrowDown delegation (already confirmed live to land at the
	// body's real first line, ch 0) when there's no preserved goal.
	private propertyAddButtonEscapeToBody(addButton: HTMLElement) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (this.propertyGoalX == null || !view) {
			addButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
			return;
		}
		const cm = (view.editor as any).cm as EditorView;
		const firstLineCoords = cm.coordsAtPos(view.editor.posToOffset({ line: this.getFirstBodyLine(), ch: 0 }));
		if (!firstLineCoords) {
			addButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
			return;
		}
		const targetY = (firstLineCoords.top + firstLineCoords.bottom) / 2;
		const targetX = this.propertyGoalX;
		this.propertyGoalX = null;
		const pos = cm.posAtCoords({ x: targetX, y: targetY }, false);
		view.editor.focus();
		if (pos == null) return;
		const rect = cm.contentDOM.getBoundingClientRect();
		const goalColumnToSeed = targetX - rect.left;
		cm.dispatch({
			selection: EditorSelection.create(
				[EditorSelection.cursor(pos, 1, undefined, goalColumnToSeed)],
				0,
			),
			scrollIntoView: true,
			userEvent: 'move',
		});
	}

	// Returns the 0-indexed line where real body content starts,
	// accounting for frontmatter. Needed because frontmatter's own lines
	// get silently clamped past by Live Preview the moment anything tries
	// to place a cursor there (confirmed live: editor.setCursor({line:0,
	// ch:0}) with frontmatter present actually lands on the real first
	// body line instead) — a hardcoded `line === 0` check for "the body's
	// own top" is unreachable whenever frontmatter exists.
	//
	// Source Mode deliberately returns 0 unconditionally, ignoring
	// frontmatter entirely — there's no Properties GUI panel to land on
	// there at all, and frontmatter is just plain text like any other
	// line, so the whole "skip past it" concept this helper exists for
	// doesn't apply. Without this, a note's own absolute line 0 (the
	// opening ---) would never satisfy `cursor.line === firstBodyLine`
	// (since frontmatterPosition still exists even in Source Mode),
	// silently breaking the plain title<->body Ctrl-P/N crossing for
	// every frontmatter-having note in Source Mode specifically.
	private getFirstBodyLine(): number {
		if (!this.isLivePreviewMode()) return 0;
		const file = this.app.workspace.getActiveFile();
		const fmPos = file ? this.app.metadataCache.getFileCache(file)?.frontmatterPosition : undefined;
		return fmPos ? fmPos.end.line + 1 : 0;
	}

	// Selection.modify is a real, long-standing (baseline ~2020) Chromium/
	// WebKit API, just not part of TypeScript's own lib.dom.d.ts — same gap
	// mlwelles/obsidian-emacs-text-editor's own contenteditable-ops.ts
	// works around. Pure cursor movement, no content mutation, so (unlike
	// Kill/Yank later) no synthetic InputEvent is needed here — nothing
	// changed that Obsidian's own title-save logic needs to notice.
	private titleSelectionModify(titleEl: HTMLElement, direction: string, granularity: string) {
		const sel = titleEl.ownerDocument.getSelection() as (Selection & {
			modify(alter: string, direction: string, granularity: string): void;
		}) | null;
		// 'extend' while a mark is active keeps the native Selection's own
		// anchor fixed and only moves focus — the exact same mechanism a
		// real Shift+Arrow keypress uses, so no separate anchor-tracking
		// machinery is needed here the way the body's own CM6-based
		// Set-mark needs (see titleSetMark's own doc comment).
		sel?.modify(this.markActive ? 'extend' : 'move', direction, granularity);
	}

	// Deliberately does NOT use Selection.modify('lineboundary') — confirmed
	// live on a wrapped title that it can resolve the ambiguous wrap-point
	// offset with the WRONG side's affinity (Ctrl-A on VLn landing on
	// VLn-1's own right edge instead of VLn's left edge; CM6's own
	// Smart Home/End avoids the equivalent issue via moveToLineBoundary's
	// explicit assoc return, which Selection.modify has no equivalent
	// control for). A pixel-coordinate hit-test (caretRangeFromPoint) was
	// tried next and ALSO confirmed live to land on the wrong line: every
	// wrapped visual line shares the exact same left/right edge coordinate
	// (the container's own box), and there's a several-px dead zone right
	// at that shared edge where it resolves to the first line regardless
	// of margin size — not a fixed, reliable threshold to guess a margin
	// against.
	//
	// What actually works: step one character at a time using the SAME
	// primitive Ctrl-B/F already use reliably, checking the vertical (Y)
	// position after each step. Stop as soon as a step crosses onto a
	// different visual line, and use the last position that was still on
	// the starting line. No pixel-margin guessing, no reliance on any
	// single API call's own internal boundary resolution.
	//
	// Also honors Visual line movement (settings.visualLineMovement,
	// Home/End-only per its own description — Ctrl-N/P's line movement is
	// unrelated), mirroring the body's own Smart Home/End: ON moves to the
	// visual line edge first, escalating to the title's absolute start/end
	// only once already there; OFF always goes straight to the absolute
	// start/end.
	private titleMoveToLineBoundary(titleEl: HTMLElement, forward: boolean) {
		const sel = titleEl.ownerDocument.getSelection() as (Selection & {
			modify(alter: string, direction: string, granularity: string): void;
		}) | null;
		if (!sel || sel.rangeCount === 0) return;
		this.titleGoalX = null; // horizontal-intent move, not a vertical-goal continuation
		// isKillChaining's own auto-reset (see killLineOuter's own comment)
		// is wired entirely through CM6's updateListener, which never fires
		// for the title at all (plain contenteditable, not CM6) — every
		// non-kill title command has to reset it explicitly here instead,
		// or a kill-line chain in the title would never break on an
		// intervening Home/End/move.
		this.isKillChaining = false;
		// Set-mark: 'extend' keeps the native Selection's own anchor fixed
		// and only moves focus (see titleSelectionModify's own comment) —
		// every modify() call below (including the one-character "undo"
		// mid-scan) uses this same alter consistently, so a marked
		// extension through this whole boundary scan accumulates onto the
		// one fixed anchor rather than collapsing partway through.
		const alter = this.markActive ? 'extend' : 'move';

		if (!this.settings.visualLineMovement) {
			sel.modify(alter, forward ? 'forward' : 'backward', 'documentboundary');
			return;
		}

		// Deliberately never snapshots a position as a Range and reapplies
		// it later (sel.addRange(savedRange)) — confirmed live that a Range
		// object carries no caret-affinity information at all, so
		// reapplying one at this exact ambiguous wrap-point offset lets the
		// browser re-resolve affinity from scratch, and it defaults to the
		// PREVIOUS line's side (the original bug this whole function
		// exists to avoid). Only ever navigates the live Selection via
		// modify() — including the one-character "undo" below — which
		// keeps whatever affinity Chromium's own live-navigation maintains
		// internally, which does render correctly.
		const startNode = sel.focusNode, startOffset = sel.focusOffset;
		const startRect = sel.getRangeAt(0).getClientRects()[0] ?? sel.getRangeAt(0).getBoundingClientRect();
		const stepDir = forward ? 'right' : 'left';
		const backDir = forward ? 'left' : 'right';

		for (let i = 0; i < 2000; i++) {
			const beforeNode = sel.focusNode, beforeOffset = sel.focusOffset;
			sel.modify(alter, stepDir, 'character');
			if (sel.focusNode === beforeNode && sel.focusOffset === beforeOffset) break; // hit the title's absolute start/end
			// The exact wrap-point character (e.g. a collapsed space, or —
			// confirmed live with CJK text that wraps between two ordinary
			// characters with no whitespace at all — the bare boundary
			// offset itself) is genuinely ambiguous: it reports TWO rects,
			// one for each adjacent line, AND — confirmed live, this cost
			// several iterations to find — a collapsed caret there always
			// renders on the PREVIOUS line's side, regardless of which
			// direction it was reached from (ruling out a caret-affinity
			// fix). That default happens to be CORRECT for End (forward):
			// "previous line" relative to the boundary IS the line being
			// moved to its own end, so landing there is fine, same as
			// before. It's WRONG for Home (backward): the boundary's
			// "previous line" rendering is the line being LEFT, not the
			// one Home is trying to reach — so backward specifically must
			// never land on an ambiguous offset, stopping one character
			// short of it instead (the true text-model edge character,
			// but unrenderable there — a real Chromium limitation, not a
			// bug in this scan).
			const rects = sel.getRangeAt(0).getClientRects();
			const sameLine = forward
				? (rects.length > 0
					? Array.from(rects).some(r => Math.abs(r.top - startRect.top) < 1)
					: Math.abs(sel.getRangeAt(0).getBoundingClientRect().top - startRect.top) < 1)
				: (rects.length === 1 && Math.abs(rects[0].top - startRect.top) < 1);
			if (!sameLine) {
				sel.modify(alter, backDir, 'character'); // undo the one step that left the line
				break;
			}
		}

		if (sel.focusNode === startNode && sel.focusOffset === startOffset) {
			// Never actually moved — already at this line's edge.
			sel.modify(alter, forward ? 'forward' : 'backward', 'documentboundary');
		}
	}

	// 'left'/'right' (not 'forward'/'backward') for character granularity —
	// matches mlwelles/obsidian-emacs-text-editor's own contenteditable-ops.ts
	// choice, which mirrors what a real ArrowLeft/ArrowRight keypress does
	// internally for this granularity.
	private titleMoveChar(titleEl: HTMLElement, forward: boolean) {
		this.titleGoalX = null; // horizontal-intent move, not a vertical-goal continuation
		this.isKillChaining = false; // see titleMoveToLineBoundary's own comment
		this.titleSelectionModify(titleEl, forward ? 'right' : 'left', 'character');
	}

	// Alt-F/Alt-B (Word right/left): entirely new for both the title
	// field and property-value-editing (the last remaining title/property
	// command-parity gap). Reuses titleSelectionModify as-is (already
	// handles the markActive 'extend'/'move' branch internally), same
	// 'left'/'right' (not 'forward'/'backward') direction convention as
	// titleMoveChar — confirmed already correct for 'word' granularity by
	// titleKillWord's own existing call (`sel.modify('extend', forward ?
	// 'right' : 'left', 'word')`), so no new direction-mapping question
	// here. Same native word-boundary mechanism already confirmed CJK-safe
	// without a custom segmenter (see
	// project_title_field_native_option_arrow_word_boundary memory and
	// titleKillWord.e2e.ts's own CJK test) — this just moves instead of
	// killing.
	private titleMoveWord(titleEl: HTMLElement, forward: boolean) {
		this.titleGoalX = null; // horizontal-intent move, not a vertical-goal continuation
		this.isKillChaining = false; // see titleMoveToLineBoundary's own comment
		this.titleSelectionModify(titleEl, forward ? 'right' : 'left', 'word');
	}

	// Ctrl-P (up) within the title: no escape case needed going up — the
	// title is always the topmost context (frontmatter is explicitly out
	// of scope for now, see project memory), so "nothing above" should
	// just no-op, which Selection.modify already does natively on its own
	// when there's truly no previous visual line to move to.
	//
	// Goal-column-aware: tries the native move first just to learn WHERE
	// the target visual line is (its Y) and whether one even exists (a
	// genuine no-op here means "nothing above/below", left completely
	// alone — this also doubles as titleMoveLineOrEscapeToBody's own
	// probe for "are we on the title's last visual line"). If a line WAS
	// found, re-lands using titleGoalX (falling back to the pre-move
	// column if no goal is active yet) rather than wherever
	// Selection.modify's own internal column-tracking happened to put it
	// — so a chain of Ctrl-P/N through a short visual line "pops back" to
	// the original wider column once a wide-enough line is reached again,
	// instead of staying clamped to the short line's own width.
	// Returns whether it actually moved to a different visual line — the
	// caller (titleMoveLineOrEscapeToBody) relies on THIS return value
	// rather than re-inspecting the selection's own rects afterward,
	// because the landing position itself can be the same ambiguous
	// VL-boundary offset this whole investigation already found (a
	// collapsed caret there always renders via the PREVIOUS line's rect,
	// regardless of how it was reached) — re-checking post-hoc would just
	// walk back into the exact bug this fix resolves.
	private titleMoveLine(titleEl: HTMLElement, forward: boolean): boolean {
		const doc = titleEl.ownerDocument;
		const sel = doc.getSelection();
		if (!sel || sel.rangeCount === 0) return false;
		this.isKillChaining = false; // see titleMoveToLineBoundary's own comment — also covers titleMoveLineOrEscapeToBody, which always calls this first
		// Set-mark: captured BEFORE any modify() call below, since the
		// pixel-based repositioning further down (caretRangeFromPoint +
		// addRange) doesn't go through modify() at all and would
		// otherwise collapse the selection, discarding the mark's own
		// anchor — reapplied via setBaseAndExtent once the new focus
		// position is known.
		const markAnchorNode = sel.anchorNode, markAnchorOffset = sel.anchorOffset;
		// Every rect check below reads the FOCUS position's own collapsed
		// rects, never sel.getRangeAt(0) directly — confirmed live that
		// while a mark is active, getRangeAt(0) returns the WHOLE anchor-
		// to-focus range, whose getClientRects() reflects the entire
		// highlighted span (often just one big rect covering most of a
		// line) rather than "where does the caret currently render",
		// which is what every check here actually needs. Using
		// getRangeAt(0) directly broke "did we move" detection entirely
		// once marked: the whole-range rect's own top rarely differs from
		// beforeRect's, so every marked Ctrl-P/N silently became a no-op.
		const beforeRect = this.titleFocusRects(doc, sel)[0] ?? sel.getRangeAt(0).getBoundingClientRect();
		const goalX = this.titleGoalX ?? beforeRect.left;

		this.titleSelectionModify(titleEl, forward ? 'forward' : 'backward', 'line');

		// Set-mark: extending in the direction OPPOSITE the selection's
		// current extension (e.g. Ctrl-F then Ctrl-P, or Ctrl-B then
		// Ctrl-N) only retracts focus back to the anchor on THIS modify()
		// call — confirmed live via a direct native-API probe — it does
		// not continue past the anchor into the new direction until a
		// SECOND call, same as pressing the key again would. Detect this
		// exact case (focus landed exactly on the anchor it started this
		// whole function at) and issue one more modify() call to actually
		// complete the line move. Safe even at a genuine boundary (e.g.
		// the anchor already sits at the title's own absolute start): the
		// second call simply can't move any further either, and the
		// movedRect check below still correctly reports "no line to move
		// to" in that case.
		//
		// Crucially, only retry when this FIRST call's own retraction
		// did NOT already cross a visual line boundary — confirmed live
		// (reported after the above fix): once the anchor happens to sit
		// exactly one VL away from where a chain of reversals currently
		// is, retracting to it IS the real, complete one-line move (not a
		// same-line "snap back to anchor" artifact); unconditionally
		// retrying in that case issued a needless second call that
		// continued PAST the anchor into a further line, silently
		// skipping an entire visual line on every second reversal in a
		// row (e.g. Ctrl-F, Ctrl-P, Ctrl-N chained together).
		if (this.markActive && markAnchorNode &&
			sel.focusNode === markAnchorNode && sel.focusOffset === markAnchorOffset &&
			!this.titleFocusRects(doc, sel).some(r => Math.abs(r.top - beforeRect.top) >= 1)) {
			this.titleSelectionModify(titleEl, forward ? 'forward' : 'backward', 'line');
		}

		// Confirmed live: modify('forward','line') can land EXACTLY on the
		// ambiguous VL1/VL2 boundary offset (same offset this whole
		// Home/End investigation already found reports 2+ rects, one per
		// adjacent line) rather than past it into the next line's own
		// interior — rects[0] alone then looks identical to beforeRect
		// (both report the line being LEFT), making a genuine move look
		// like a no-op and wrongly triggering the body-escape one VL too
		// early. Check every rect: if ANY of them differs from the
		// starting line, a line boundary genuinely was reached, and that
		// differing rect's own top is the real target line's Y.
		const afterRects = this.titleFocusRects(doc, sel);
		const movedRect = afterRects.find(r => Math.abs(r.top - beforeRect.top) >= 1) ?? null;
		if (!movedRect) return false; // no line to move to; leave as-is

		this.titleGoalX = goalX;
		const targetY = movedRect.top + movedRect.height / 2;
		const docCRFP = doc as unknown as { caretRangeFromPoint(x: number, y: number): Range | null };
		const range = docCRFP.caretRangeFromPoint(goalX, targetY);
		if (range && titleEl.contains(range.startContainer)) {
			if (this.markActive && markAnchorNode) {
				(sel as unknown as { setBaseAndExtent(aNode: Node, aOff: number, fNode: Node, fOff: number): void })
					.setBaseAndExtent(markAnchorNode, markAnchorOffset, range.startContainer, range.startOffset);
			} else {
				sel.removeAllRanges();
				sel.addRange(range);
			}
		}

		// The position we just landed on (via caretRangeFromPoint, or left
		// over from the native line-move above if that hit-test failed)
		// can itself be the exact ambiguous VL-boundary offset — most
		// likely when goalX sits right at the shared left/right edge all
		// visual lines share (e.g. goalX 0 from the title's very start).
		// Per the established finding, a collapsed caret there ALWAYS
		// renders via the rect of whichever adjacent line comes FIRST in
		// TEXT order, never the second — regardless of how it was
		// reached, and regardless of whether the overall move is Ctrl-N
		// or Ctrl-P. The wrap boundary only ever sits at a line's own
		// LEFT edge (new lines always start at column 0), so when goalX
		// is near that edge the ambiguous pair is always "(line above,
		// target line)" with the target line second — true for Ctrl-P
		// stepping up through intermediate lines just as much as Ctrl-N
		// stepping down. So the fix is always to nudge forward ('right')
		// one character, never 'left' — nudging left for Ctrl-P here
		// doesn't land on the target line at all, it overshoots one
		// character further INTO the line above it (confirmed live: an
		// extra visual line of drift on every Ctrl-P through a title
		// goal-column pinned near column 0). Detect this (2+ rects, and
		// the one actually used for rendering doesn't match the target
		// line we just moved to) and nudge onto a position that's
		// unambiguously inside the target line.
		const landedRects = this.titleFocusRects(doc, sel);
		if (landedRects.length > 1 && Math.abs(landedRects[0].top - movedRect.top) >= 1) {
			// modify() operates on the CURRENT selection's own anchor,
			// already correctly set to markAnchorNode/Offset by the
			// setBaseAndExtent call above when marked — no extra anchor
			// handling needed here, just the same alter as everywhere else.
			(sel as unknown as { modify(alter: string, direction: string, granularity: string): void })
				.modify(this.markActive ? 'extend' : 'move', 'right', 'character');
		}
		return true;
	}

	// Collapsed-at-focus rects — used throughout titleMoveLine instead of
	// reading sel.getRangeAt(0) directly, since that range reflects the
	// WHOLE anchor-to-focus span whenever a mark is active, not "where
	// does the caret/focus currently render" (see titleMoveLine's own
	// comment on why that distinction matters).
	private titleFocusRects(doc: Document, sel: Selection): DOMRect[] {
		if (!sel.focusNode) return [];
		const r = doc.createRange();
		r.setStart(sel.focusNode, sel.focusOffset);
		r.collapse(true);
		return Array.from(r.getClientRects());
	}

	// Ctrl-N (down) within the title: delegates the "move one VL down, or
	// detect there's none" work to titleMoveLine itself (which leaves the
	// selection untouched on a genuine no-op), then just checks whether
	// anything actually moved to decide whether to escape into the body.
	// Deliberately does NOT match native physical-ArrowDown's own
	// behavior (confirmed live: native lands at the body's ch 0, no
	// column preservation at all) — uses titleGoalX (falling back to the
	// pre-move column) so a goal established by an earlier Ctrl-P/N
	// chain, or by crossing in from the body, carries all the way through
	// to the body landing too.
	private titleMoveLineOrEscapeToBody(titleEl: HTMLElement) {
		const sel = titleEl.ownerDocument.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const beforeRect = sel.getRangeAt(0).getClientRects()[0] ?? sel.getRangeAt(0).getBoundingClientRect();
		const goalX = this.titleGoalX ?? beforeRect.left;
		if (this.titleMoveLine(titleEl, true)) return; // moved to a new visual line, done
		// Set-mark: the title<->body boundary is never crossed while
		// extending, same "exit = stay in place" convention
		// extendMarkInCell already uses for a table cell's own boundary —
		// a marked selection can't span two separate DOM editing roots
		// (CM6's own EditorSelection vs the title's native Selection), so
		// this is a hard stop in both directions, not a deferred TODO.
		if (this.markActive) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		// 0.13.0 Feature 1, frontmatter sub-phase: land in the Properties
		// panel's own heading instead of jumping straight to the body,
		// when the note actually HAS frontmatter (getFirstBodyLine() > 0)
		// AND a Properties panel is actually visible right now (Source
		// Mode has no GUI panel). Checking the heading element's own mere
		// DOM PRESENCE is not enough on its own — confirmed live the
		// `.metadata-properties-heading`/`.metadata-add-button` elements
		// exist in the DOM (just hidden, offsetParent === null) even for a
		// note with NO frontmatter at all, so a presence-only check
		// wrongly redirected .focus() to a hidden, unfocusable element,
		// silently breaking the existing title->body escape for every
		// frontmatter-less note.
		const heading = (this.getFirstBodyLine() > 0)
			? view.containerEl.querySelector('.metadata-properties-heading') as HTMLElement | null
			: null;
		if (heading && heading.offsetParent !== null) {
			this.titleGoalX = null; // leaving the title; the title-local goal has no meaning inside Properties
			// 0.13.0 Feature 1, frontmatter sub-phase: preserve the goal
			// column through the Properties detour instead of discarding
			// it — convert title-space goalX to BODY-space before storing
			// (propertyGoalX's own comment explains why body-space is the
			// canonical shape), using the exact same gutter-normalization
			// formula this function's own direct body-landing already
			// uses below. Best-effort: if the body's own first-line
			// coords aren't available for some reason, store nothing
			// rather than a wrong value — propertyHeadingEscapeToTitle
			// already has a sensible fallback for a null propertyGoalX.
			const cmForGoal = (view.editor as any).cm as EditorView;
			const firstLineCoordsForGoal = cmForGoal.coordsAtPos(view.editor.posToOffset({ line: this.getFirstBodyLine(), ch: 0 }));
			if (firstLineCoordsForGoal) {
				const titleStartXForGoal = titleEl.getBoundingClientRect().left;
				this.propertyGoalX = goalX - titleStartXForGoal + firstLineCoordsForGoal.left;
			}
			heading.focus();
			// Confirmed live: focusing a plain (non-text) element like the
			// heading does NOT itself clear window.getSelection() — the
			// native Selection silently keeps pointing at wherever it was
			// in the title's own text. The title's own cursor rendering
			// doesn't care (CM6-independent title, nothing reads this
			// stale state on its own), but a THIRD-PARTY title-caret
			// plugin reading window.getSelection() directly (confirmed
			// live with a real one) kept showing a cursor at the title's
			// old position until the Selection changed again elsewhere.
			titleEl.ownerDocument.getSelection()?.removeAllRanges();
			return;
		}

		const cm = (view.editor as any).cm as EditorView;
		// 0.13.0 Feature 1, frontmatter sub-phase: the real first body
		// line's own start offset, not position 0 — see getFirstBodyLine's
		// own comment for why frontmatter makes that distinction
		// necessary (position 0 would be the frontmatter's own `---`).
		const firstLineCoords = cm.coordsAtPos(view.editor.posToOffset({ line: this.getFirstBodyLine(), ch: 0 }));
		if (!firstLineCoords) return;
		const targetY = (firstLineCoords.top + firstLineCoords.bottom) / 2;

		// Same gutter mismatch as escapeUpToTitle's own fix, mirrored for
		// the opposite crossing: goalX lives in the title's own pixel
		// space (no line-number gutter), but the body's line-start X
		// sits past its gutter — using goalX as a raw body X would
		// undershoot by the gutter's own width. Normalize by each side's
		// own line-start X instead of matching absolute screen pixels.
		const titleStartX = titleEl.getBoundingClientRect().left;
		const bodyLineStartX = firstLineCoords.left;
		const adjustedX = goalX - titleStartX + bodyLineStartX;

		// precise: false — confirmed live that CM6's default (precise)
		// posAtCoords returns null outright when the point lands right at
		// a line's own edge (e.g. an EMPTY line's near-zero-width hit
		// box), same class of exact-edge failure already seen with
		// caretRangeFromPoint on the title side. false clamps to the
		// nearest valid position instead of ever returning null.
		const pos = cm.posAtCoords({ x: adjustedX, y: targetY }, false);
		view.editor.focus();
		this.titleGoalX = null; // leaving the title; the body has its own separate goal-column system
		if (pos != null) {
			// Seed CM6's own native goalColumn (the same field
			// execPreservingGoalColumn preserves for a Ctrl-P/N chain, and
			// computeRowCrossPixelGoal reads for table-row crossings) with
			// this crossing's own adjustedX, instead of a plain
			// editor.setCursor — a fresh selection dispatch carries no
			// goalColumn at all, so a Ctrl-P/N continuing in the body
			// right after this landing would otherwise silently reset to
			// whatever pixel X the landing position itself happens to be
			// at, forgetting the title's own column. Mirrors the
			// symmetric fix already made for the opposite (title-entry)
			// crossing in moveCursorUpImpl. goalColumn is relative to the
			// view's own contentDOM left edge, same convention as
			// computeRowCrossPixelGoal.
			const rect = cm.contentDOM.getBoundingClientRect();
			const goalColumnToSeed = adjustedX - rect.left;
			cm.dispatch({
				selection: EditorSelection.create(
					[EditorSelection.cursor(pos, 1, undefined, goalColumnToSeed)],
					0,
				),
				scrollIntoView: true,
				userEvent: 'move',
			});
		}
	}

	// Ctrl-K in the title: kills from the cursor to the title's own text
	// end. Title is always logically ONE line (unlike killLineOuter's own
	// body-side Smart-join-into-the-next-line case), so there's no "next
	// line" to join with here — already at the end is simply a no-op,
	// matching killLineOuter's own no-op convention of leaving
	// isKillChaining untouched rather than resetting it (titleGoalX is
	// still reset unconditionally, same as every other title command —
	// that's a horizontal-INTENT signal regardless of effect).
	//
	// Shares the exact same kill-ring (killCache/updateKillCache/
	// navigator.clipboard) as the body's own Kill line, so Yank (once
	// implemented in the title) and cross-buffer kill-chaining both just
	// work with no separate title-side kill-ring needed.
	//
	// Uses document.execCommand('delete', false) rather than
	// Range.deleteContents() — confirmed live the former integrates with
	// the title's own native undo stack (Ctrl-Z correctly restores the
	// killed text) while the latter does not. The killed text itself is
	// captured via range.toString() just before the delete call, since
	// execCommand's own return value doesn't carry it.
	private titleKillLine(titleEl: HTMLElement) {
		this.titleGoalX = null; // horizontal-intent action
		this.markActive = false; // kill commands deactivate the mark unconditionally, same as the body's own killLineOuter
		const doc = titleEl.ownerDocument;
		const sel = doc.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.focusNode) return;
		// Collapse to the current focus point first, discarding any active
		// (marked) selection — kill-line never looks at the region, always
		// "from point to end of line", same as the body's own killLineOuter
		// (and the same collapse titleKillWord already does for the
		// identical reason). Without this, reading getRangeAt(0)'s own
		// startOffset directly would kill from the WRONG end of an active
		// selection whenever the mark's anchor sits after its focus.
		sel.collapse(sel.focusNode, sel.focusOffset);
		const cur = sel.getRangeAt(0);
		const container = cur.startContainer;
		if (container.nodeType !== Node.TEXT_NODE) return; // defensive: the title is always flat text
		const textLen = (container as Text).length;
		const cursorOffset = cur.startOffset;
		if (cursorOffset >= textLen) return; // already at the title's own end: nothing to kill

		const range = doc.createRange();
		range.setStart(container, cursorOffset);
		range.setEnd(container, textLen);
		sel.removeAllRanges();
		sel.addRange(range);
		const killedText = range.toString();

		doc.execCommand('delete', false);

		this.updateKillCache(killedText);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		this.isKillChaining = true;
	}

	// Alt-Backspace/Alt-D in the title: kills one word left/right from the
	// cursor. Deliberately does NOT reuse word-segmentation.ts (the
	// Intl.Segmenter-based engine Word left/right and Vim w/b/e need on
	// the body side, since CM6's own native word-class boundary has no
	// CJK awareness at all) — confirmed live the title's own native
	// Selection.modify('extend', ..., 'word') already segments CJK
	// correctly on its own (same as physical Option-←/→ in the title,
	// see project_title_field_native_option_arrow_word_boundary memory),
	// so no custom engine is needed here.
	//
	// Collapses to the current focus point first, discarding any existing
	// (non-collapsed) selection — kill-word operates from point only,
	// ignoring any active region, same as the body's own
	// resolveKillWordRangeOuter (which always reads range.head,
	// regardless of whether that range has a selection). Extending with
	// 'word' granularity and checking range.collapsed afterward tells a
	// genuine no-op (already at the title's own start/end) apart from a
	// real kill, without needing a separate length/offset comparison.
	//
	// prepend = !forward on updateKillCache, matching killWordOuter's own
	// convention: a backward kill (Alt-Backspace) builds the kill-ring in
	// buffer order across consecutive kills, a forward kill (Alt-D)
	// appends.
	private titleKillWord(titleEl: HTMLElement, forward: boolean) {
		this.titleGoalX = null; // horizontal-intent action
		this.markActive = false; // kill commands deactivate the mark unconditionally, same as the body's own killWordOuter
		const doc = titleEl.ownerDocument;
		const sel = doc.getSelection() as (Selection & {
			modify(alter: string, direction: string, granularity: string): void;
		}) | null;
		if (!sel || sel.rangeCount === 0 || !sel.focusNode) return;
		sel.collapse(sel.focusNode, sel.focusOffset);

		sel.modify('extend', forward ? 'right' : 'left', 'word');
		const range = sel.getRangeAt(0);
		if (range.collapsed) return; // already at the title's own start/end: nothing to kill
		const killedText = range.toString();

		doc.execCommand('delete', false);

		this.updateKillCache(killedText, !forward);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		this.isKillChaining = true;
	}

	// Ctrl-Space (set-mark candidate) in the title: arms markActive and
	// collapses any active selection to its own focus point — the exact
	// native-Selection equivalent of the body's own collapseActiveSelectionToHead
	// (which collapses every range to its own head). Unlike the body's
	// CM6-based Set-mark, no separate anchor-tracking is needed at all:
	// the title's native Selection already distinguishes anchor from
	// focus on its own, and titleSelectionModify/titleMoveToLineBoundary/
	// titleMoveLine all already call Selection.modify with 'extend'
	// instead of 'move' whenever markActive is true, which is the native
	// browser's own built-in mechanism for "grow a selection from a fixed
	// anchor" (the same one a real Shift+Arrow keypress uses).
	//
	// The title<->body boundary is never crossed while a mark is active,
	// in either direction — see titleMoveLineOrEscapeToBody's own guard
	// and escapeUpToTitle's call site (moveCursorUp routes to
	// extendMarkVertically instead whenever markActive, which never knows
	// about title-crossing at all and already stays put at the document's
	// own start on its own). Same "exit = stay in place" convention
	// extendMarkInCell already uses at a table cell's own boundary — a
	// marked selection can't span two separate DOM editing roots (CM6's
	// own EditorSelection vs the title's native Selection), so this is a
	// permanent design boundary, not a deferred TODO.
	private titleSetMark(titleEl: HTMLElement) {
		this.markActive = true;
		const sel = titleEl.ownerDocument.getSelection();
		if (!sel || !sel.focusNode) return;
		sel.collapse(sel.focusNode, sel.focusOffset);
	}

	// Ctrl-G (keyboard-quit) in the title: deactivates the mark and
	// collapses any active selection to its own focus — set-mark
	// cancellation ONLY. Deliberately does NOT mirror the body's own
	// keyboardQuit any further than this (no multi-range concept exists
	// in a native Selection to begin with, so there's nothing else to
	// collapse). In particular, this must NOT leave the title the way a
	// bare physical Escape does — confirmed live that native Escape in
	// the title blurs it entirely, jumping back to wherever the cursor
	// was in the body before the title was ever entered (Obsidian's own
	// native behavior, untouched — see the bare-ESC Key Upgrade revert
	// note elsewhere in this file for why). Ctrl-G staying put in the
	// title, with only the mark/selection affected, is what distinguishes
	// it from that native behavior.
	private titleKeyboardQuit(titleEl: HTMLElement) {
		this.markActive = false;
		const sel = titleEl.ownerDocument.getSelection();
		if (!sel || !sel.focusNode) return;
		sel.collapse(sel.focusNode, sel.focusOffset);
	}

	// Ctrl-W (Kill region) / Alt-W (Copy region) in the title: operate on
	// whatever native Selection is currently active, regardless of how it
	// got there (Set-mark extend, a mouse drag, Shift+Arrow) — unlike the
	// body's own killRegion/copyRegion, no multi-cursor handling is
	// needed at all, since a native Selection only ever has one range.
	// Deliberately does NOT collapse to focus first the way
	// titleKillLine/titleKillWord do (those operate from point,
	// discarding any region on purpose) — this command's whole job IS the
	// active region itself.
	// Ctrl-D (Delete char): deletes the character AFTER point, same as the
	// body's own deleteChar — doesn't touch markActive's own extend/move
	// distinction via a collapse-to-point step the way Kill line/word do
	// (those discard an active region on purpose; Delete char doesn't),
	// matching real Emacs's delete-char, which also ignores the mark.
	// If a non-empty selection already exists, deletes exactly that
	// (standard editor convention — same as a physical Delete keypress
	// over a selection anywhere else); if collapsed, extends by one
	// character forward first, then deletes that. Guards against
	// Selection.modify's own collapsed-selection fallback behavior for
	// execCommand('delete') (which defaults to a BACKWARD/backspace-like
	// deletion when the selection is still collapsed) by checking
	// whether the extend attempt actually left collapsed state — true
	// no-op at the title's own end, never a wrong-direction delete.
	private titleDeleteChar(titleEl: HTMLElement) {
		this.markActive = false;
		const doc = titleEl.ownerDocument;
		const sel = doc.getSelection() as (Selection & {
			modify(alter: string, direction: string, granularity: string): void;
		}) | null;
		if (!sel || sel.rangeCount === 0) return;
		if (sel.isCollapsed) {
			sel.modify('extend', 'forward', 'character');
			if (sel.isCollapsed) return; // already at the title's own end: nothing to delete
		}
		doc.execCommand('delete', false);
	}

	private titleCopyRegion(titleEl: HTMLElement) {
		const sel = titleEl.ownerDocument.getSelection();
		if (!sel || sel.isCollapsed) return; // nothing selected
		const text = sel.toString();
		this.markActive = false;
		this.isKillChaining = false;
		if (sel.focusNode) sel.collapse(sel.focusNode, sel.focusOffset);
		this.updateKillCache(text);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
	}

	private titleKillRegion(titleEl: HTMLElement) {
		const doc = titleEl.ownerDocument;
		const sel = doc.getSelection();
		if (!sel || sel.isCollapsed) return; // nothing selected
		const text = sel.toString();
		doc.execCommand('delete', false); // same undo-stack-integrated technique as titleKillLine/titleKillWord
		this.markActive = false;
		this.isKillChaining = false;
		this.updateKillCache(text);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
	}

	// Ctrl-Y (Yank) in the title: reads the OS clipboard (falling back to
	// the kill-ring if that throws, same as the body's own yank), then
	// inserts it via execCommand('insertText', false, raw) — the
	// insertion counterpart to the 'delete' command titleKillLine/
	// titleKillWord/titleKillRegion already use, same undo-stack
	// integration. Replaces an active selection automatically (insertText
	// is specified to do that), matching the body's own yankOuter, which
	// uses range.from/range.to directly rather than range.head.
	//
	// None of the body's own yankOuter machinery applies here at all:
	// multi-cursor distribution (a native Selection only ever has one
	// range), Source Mode table-syntax escaping, and list-marker paste
	// dedup are all body/Markdown-specific concerns the title has none
	// of. Embedded newlines — plausible from a body-side kill spanning
	// multiple lines — DO need manual stripping here, despite
	// execCommand('insertText', ...) normally dropping them on its own
	// (confirmed identical to a real native Cmd-V paste for a newline
	// that isn't trailing). A kill-ring entry ending in a newline (e.g.
	// two Ctrl-Ks in the body: first kills the line's own text, second
	// kills the line break itself) hits a genuine Chromium contenteditable
	// bug on insert — confirmed live, and confirmed to affect a real
	// native Cmd-V paste identically, not just this plugin's own
	// execCommand call: the selection's focus/anchor land on the title's
	// container element instead of its text node afterward, and the
	// title's native undo stack silently stops working for every
	// subsequent edit. Stripping newlines ourselves before inserting
	// avoids ever handing the browser a string it mishandles.
	private async titleYank(titleEl: HTMLElement) {
		this.markActive = false;
		this.isKillChaining = false;
		let raw: string;
		try {
			raw = await navigator.clipboard.readText();
		} catch {
			raw = this.killCache;
		}
		if (!raw) return;
		const text = raw.replace(/\n/g, '');
		if (!text) return;

		this.titleGoalX = null; // horizontal-intent action
		titleEl.ownerDocument.execCommand('insertText', false, text);
	}

	onunload() {
		this.vimSupport.teardown();
		this.cleanupScopesOnUnload();
	}

	// Real gap found live: nothing ever popped propertyRowScope/titleScope
	// if either was currently pushed at the moment this plugin gets
	// disabled (e.g. via the Community plugins toggle). Left unpopped,
	// the Scope object -- with its own handler closures still
	// referencing THIS (about to be discarded) instance -- stays
	// physically on app.keymap's real stack forever; Obsidian's own
	// Keymap has no way to know it should be removed just because the
	// plugin that pushed it unloaded. A freshly re-enabled instance's
	// own onload() (see reconcileScopesWithFocus's own onload call site)
	// pushes a NEW, correctly-wired scope on top, which works fine as
	// long as it STAYS on top -- but the orphaned old one is still
	// buried underneath, and resurfaces the moment anything pops the
	// new one, now dispatching through a dead instance whose own
	// propertyRowScope/titleScope bookkeeping no longer matches reality
	// at all. Matches a real, user-reported symptom: intermittent,
	// inconsistent behavior after a disable/re-enable cycle (Ctrl-P
	// sometimes escaping the whole Bases table instead of moving one
	// row, sometimes doing nothing at all) -- exactly what two scopes
	// silently fighting over the same stack position would look like
	// from the outside.
	//
	// Pulled out of onunload() itself (rather than inlined there) so
	// scopeReconciliation.e2e.ts's own test (5) can exercise this exact
	// real code path directly, without also invoking vimSupport's own
	// teardown() -- confirmed live that calling the real, full
	// onunload() destabilizes this harness's own WebDriver session
	// entirely (unrelated side effects, not safe to exercise this way).
	private cleanupScopesOnUnload() {
		if (this.propertyRowScope) {
			this.app.keymap.popScope(this.propertyRowScope);
			this.propertyRowScope = null;
		}
		if (this.titleScope) {
			this.app.keymap.popScope(this.titleScope);
			this.titleScope = null;
		}
	}


	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as UniversalCursorHotkeysSettings;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}


	//===========================================================================
	// Entry points: Ctrl-A / Ctrl-E / Ctrl-B / Ctrl-F
	//===========================================================================

	private moveCursorHome(editor: Editor) {
		if (this.markActive) {
			this.extendMarkHome(editor);
			return;
		}
		const cursor = editor.getCursor();

		if (editor.inTableCell) {
			this.moveCursorHomeInTable(editor);
			return;
		}

		if (!this.isLivePreviewMode() && this.isTableLineSourceMode(editor.getLine(cursor.line))) {
			this.moveCursorHomeInTableSourceMode(editor);
			return;
		}

		this.moveCursorHomeNonTable(editor);
	}


	private moveCursorEnd(editor: Editor) {
		if (this.markActive) {
			this.extendMarkEnd(editor);
			return;
		}
		if (editor.inTableCell) {
			this.moveCursorEndInTable(editor);
			return;
		}

		if (!this.isLivePreviewMode() && this.isTableLineSourceMode(editor.getLine(editor.getCursor().line))) {
			this.moveCursorEndInTableSourceMode(editor);
			return;
		}

		this.moveCursorEndNonTable(editor);
	}


	// Wrapper: see reconcileSecondaryRangesAfterTableCrossing's own doc
	// comment for why this runs after every LEFT/RIGHT/UP/DOWN whose
	// current position starts outside a table cell (multi-cursor + table
	// boundary policy).
	private moveCursorLeft(editor: Editor) {
		if (this.markActive) {
			this.extendMarkHorizontalChar(editor, false);
			return;
		}
		const startedInTable = editor.inTableCell;
		this.moveCursorLeftImpl(editor);
		if (!startedInTable) this.reconcileSecondaryRangesAfterTableCrossing(editor);
	}

	private moveCursorLeftImpl(editor: Editor) {
		const cursor = editor.getCursor();

		if (editor.inTableCell) {
			const line = editor.getLine(cursor.line);
			const startOfCell = getStartOfCellContent(line, cursor.ch);
			const endOfCell = getEndOfCellContent(line, cursor.ch);
			if (startOfCell === endOfCell || cursor.ch <= startOfCell) {
				this.moveToLeftCellEnd(editor);
			} else {
				editor.exec('goLeft');
			}
			return;
		}

		if (this.isLivePreviewMode() && cursor.ch === 0 && cursor.line > 0
				&& this.isPositionInTable(editor, cursor.line - 1, 1)) {
			const targetLine = cursor.line - 1;
			const lineText   = editor.getLine(targetLine);
			const lastCell   = getRightmostCellIndex(lineText);
			const endCh      = getEndOfCellContentByCellIndex(lineText, lastCell);
			this.setCursorViaCm(editor, targetLine, endCh);
			return;
		}
		editor.exec('goLeft');
	}


	private moveCursorRight(editor: Editor) {
		if (this.markActive) {
			this.extendMarkHorizontalChar(editor, true);
			return;
		}
		const startedInTable = editor.inTableCell;
		this.moveCursorRightImpl(editor);
		if (!startedInTable) this.reconcileSecondaryRangesAfterTableCrossing(editor);
	}

	private moveCursorRightImpl(editor: Editor) {
		const cursor = editor.getCursor();

		if (editor.inTableCell) {
			const line = editor.getLine(cursor.line);
			const endOfCell = getEndOfCellContent(line, cursor.ch);
			if (cursor.ch >= endOfCell) {
				this.moveToRightCellStart(editor);
			} else {
				editor.exec('goRight');
			}
			return;
		}

		if (this.isLivePreviewMode() && cursor.ch >= editor.getLine(cursor.line).length
				&& this.isPositionInTable(editor, cursor.line + 1, 1)) {
			this.moveCursorDownIntoTable(editor);
			return;
		}
		editor.exec('goRight');
	}


	// Alt-F / Alt-B — forward-word/backward-word. forward=true lands the caret
	// right after the found word's last character (mirroring Emacs's own
	// "forward-word always stops at a word end" convention); forward=false
	// lands right before the found word's first character. See
	// moveCursorWordInTable/moveCursorWordPlainText further below for the two
	// underlying search strategies (table cell vs. everything else).
	private moveCursorWord(editor: Editor, forward: boolean) {
		if (this.markActive) {
			this.extendMarkWord(editor, forward);
			return;
		}
		if (editor.inTableCell) {
			this.moveCursorWordInTable(editor, forward);
			return;
		}
		this.moveCursorWordPlainText(editor, forward);
	}


	//===========================================================================
	// Ctrl-A — Home helpers
	//===========================================================================

	// In-cell Home: VL edge (if visualLineMovement) → smart home → sub-line start → left cell.
	// Multi-cursor-safe: computes each existing inner-view range's own
	// target independently (pure, no dispatch) via computeHomeTargetInCell
	// below, same shape as moveCursorWordPlainText's own multi-cursor loop
	// — no native CM6 command involved here either, just coordinate/text
	// math, so every range's target is knowable up front.
	private moveCursorHomeInTable(editor: Editor) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) {
			// Fallback: no-op if inner view is unavailable (cursor not in LP table cell).
			return;
		}
		this.dispatchInCellMotion(
			inner,
			range => this.computeHomeTargetInCell(inner, range),
			() => this.moveToLeftCellEnd(editor),
		);
	}

	// Pure (no dispatch) per-range Home target within the current cell.
	// 'exit' means this range is at the cell's own first sub-line start —
	// pressing Home again means leaving this cell (a different inner view)
	// via moveToLeftCellEnd.
	private computeHomeTargetInCell(inner: EditorView, range: SelectionRange):
			{ kind: 'exit' } | { kind: 'stay'; pos: number; assoc?: -1 | 1 } {
		const head    = range.head;
		const subLine = inner.state.doc.lineAt(head);

		// First sub-line: skip leading whitespace to reach content start.
		// Middle/last sub-lines: content starts right after the \n boundary.
		const isFirstSubLine = subLine.number === 1;
		const startOfSubLine = isFirstSubLine
			? subLine.from + subLine.text.search(/\S|$/)
			: subLine.from;

		if (head <= startOfSubLine) {
			if (isFirstSubLine) return { kind: 'exit' };
			return { kind: 'stay', pos: startOfSubLine };
		}

		// VL step: when on VL2+ within a sub-line, move to the VL left edge first.
		if (this.settings.visualLineMovement) {
			// Use assoc to pick the correct side at wrap points: assoc=-1 means the cursor
			// is visually at the right end of VL_N, so coordsAtPos with side=-1 returns VL_N
			// coords. Without this, default side=1 would return VL_N+1 coords and make the
			// VL step appear to be a no-op (vlStartPos === head).
			const assoc = range.assoc;
			const coords = inner.coordsAtPos(head, assoc < 0 ? -1 : 1);
			if (coords) {
				// x=0 is left of all inner-view content; posAtCoords snaps to the leftmost
				// character on the current visual line. y = midpoint of that line (height ≈ 18 px).
				const vlStartPos = inner.posAtCoords({ x: 0, y: coords.top + 9 }, false);
				if (vlStartPos !== null && vlStartPos > startOfSubLine && head > vlStartPos) {
					return { kind: 'stay', pos: vlStartPos };
				}
			}
		}

		// Smart home: apply prefix detection on content slice (from startOfSubLine).
		const contentText    = subLine.text.slice(startOfSubLine - subLine.from);
		const smartHomeInner = startOfSubLine + this.getBeginningOfLinePosition(contentText, head - startOfSubLine);

		if (head > smartHomeInner) return { kind: 'stay', pos: smartHomeInner };
		return { kind: 'stay', pos: startOfSubLine };
	}


	private moveCursorHomeInTableSourceMode(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const info = getInCellLineInfo(line, cursor.ch);
		if (!info) return;

		if (info.isEmpty || cursor.ch <= info.startOfInCellLine) {
			if (info.lineType === 'single' || info.lineType === 'first') {
				this.moveToLeftCellEndSourceMode(editor);
			}
			return;
		}

		const bounds = getCellBounds(line, cursor.ch);
		if (!bounds) return;
		const cellContent = line.slice(info.startOfInCellLine, bounds.close);
		const smartHomePos = info.startOfInCellLine + this.getBeginningOfLinePosition(cellContent, cursor.ch - info.startOfInCellLine);

		if (cursor.ch > smartHomePos) {
			editor.setCursor({ line: cursor.line, ch: smartHomePos });
			return;
		}
		editor.setCursor({ line: cursor.line, ch: info.startOfInCellLine });
	}


	// Non-table Home: visual-line-aware 2-step home, markdown-aware smart home.
	// Loops over every existing selection range (not just the primary one) so
	// pressing Home with multiple cursors active moves each of them to its
	// own line's Home position instead of collapsing to a single cursor.
	private moveCursorHomeNonTable(editor: Editor) {
		const cm = editor.cm;
		if (!cm) {
			// No cm: smart home only, single cursor (multi-cursor is a CM6-level
			// concept — nothing to loop over without cm.state.selection).
			const cursor = editor.getCursor();
			const line = editor.getLine(cursor.line);
			const position = this.getBeginningOfLinePosition(line, cursor.ch);
			editor.setCursor({ line: cursor.line, ch: position });
			return;
		}
		this.setCursorsViaCm(editor, (range) => this.computeHomeTargetNonTable(editor, cm, range));
	}

	// Pure (no dispatch) per-range Home target outside a table — same VL-step
	// then Smart-Home logic moveCursorHomeNonTable always used inline, pulled
	// out so extendMarkHome (Set-mark) can reuse it unchanged: the target is
	// already a pure function of (line text, current ch), not separate
	// mutable step-counter state, so extending under Set-mark needs no
	// different Smart-Home behavior at all — just a different dispatch shape
	// (range extend instead of cursor collapse) built from the same target.
	private computeHomeTargetNonTable(editor: Editor, cm: EditorView, range: SelectionRange): { pos: number; assoc?: -1 | 1 } {
		const pos = editor.offsetToPos(range.head);
		const lineText = editor.getLine(pos.line);
		if (this.settings.visualLineMovement) {
			const lineFrom = editor.posToOffset({ line: pos.line, ch: 0 });
			const vlStart = cm.moveToLineBoundary(range, false, true);
			const vlCh = vlStart.head - lineFrom;
			// Only treat as VL2+ if vlCh is past the smart home position.
			// Prevents widget decorations (e.g. footnote [^1]: ) from causing a false VL dispatch.
			const lineSmartHomePos = this.getBeginningOfLinePosition(lineText, lineText.length || 1);

			if (vlStart.head !== range.head && vlCh > lineSmartHomePos) {
				// Case (1a): VL2+, not at VL left edge -> move to VL left edge.
				return { pos: vlStart.head, assoc: vlStart.assoc as -1 | 1 };
			}
			// Case (1b): VL2+ at left edge, or Case (2): VL1 -> fall through to smart home.
		}

		// Smart home: content start -> ch=0.
		const position = this.getBeginningOfLinePosition(lineText, pos.ch);
		return { pos: editor.posToOffset({ line: pos.line, ch: position }) };
	}


	//===========================================================================
	// Ctrl-E — End helpers
	//===========================================================================

	// In-cell End: VL edge (if visualLineMovement) → sub-line end → right cell.
	// Multi-cursor-safe — see moveCursorHomeInTable's own identical note.
	private moveCursorEndInTable(editor: Editor) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) {
			// Fallback: no-op if inner view is unavailable (cursor not in LP table cell).
			return;
		}
		this.dispatchInCellMotion(
			inner,
			range => this.computeEndTargetInCell(inner, range),
			() => this.moveToRightCellStart(editor),
		);
	}

	// Pure (no dispatch) per-range End target within the current cell.
	// 'exit' means this range is at the cell's own last sub-line end —
	// pressing End again means leaving this cell via moveToRightCellStart.
	private computeEndTargetInCell(inner: EditorView, range: SelectionRange):
			{ kind: 'exit' } | { kind: 'stay'; pos: number; assoc?: -1 | 1 } {
		const head    = range.head;
		const subLine = inner.state.doc.lineAt(head);

		// Last sub-line: trim trailing whitespace; non-last: end is at \n boundary.
		const isLastSubLine = subLine.number === inner.state.doc.lines;
		const endOfSubLine  = isLastSubLine
			? subLine.from + subLine.text.trimEnd().length
			: subLine.to;

		if (head >= endOfSubLine) {
			if (isLastSubLine) return { kind: 'exit' };
			return { kind: 'stay', pos: head }; // first/middle at end: no-op
		}

		// VL step: when on a non-last VL within the sub-line, move to the VL right edge first.
		if (this.settings.visualLineMovement) {
			const vlEnd = inner.moveToLineBoundary(range, true, true);
			if (vlEnd.head !== head && vlEnd.head < endOfSubLine) {
				return { kind: 'stay', pos: vlEnd.head, assoc: vlEnd.assoc as -1 | 1 };
			}
		}

		return { kind: 'stay', pos: endOfSubLine };
	}


	private moveCursorEndInTableSourceMode(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		// Cursor is before the first pipe (outside any cell): snap to cell 0 content start.
		if (cursor.ch === 0) {
			const targetCh = getChByCellIndex(line, 0);
			if (targetCh !== -1) editor.setCursor({ line: cursor.line, ch: targetCh });
			return;
		}

		const info = getInCellLineInfo(line, cursor.ch);
		if (!info) return;

		if (info.isEmpty || cursor.ch >= info.endOfInCellLine) {
			if (info.lineType === 'single' || info.lineType === 'last') {
				this.moveToRightCellStartSourceMode(editor);
			} else if (cursor.ch > info.endOfInCellLine) {
				// 'first' or 'middle' with cursor strictly inside <br> text: skip to next segment's end.
				const brLen = line.slice(info.endOfInCellLine).match(/^<[bB][rR]>([ \t]*)/)?.[0].length ?? 0;
				if (brLen > 0) {
					const nextInfo = getInCellLineInfo(line, info.endOfInCellLine + brLen);
					if (nextInfo) editor.setCursor({ line: cursor.line, ch: nextInfo.endOfInCellLine });
				}
			}
			// 'first' or 'middle' at exactly endOfInCellLine: do nothing.
			return;
		}
		editor.setCursor({ line: cursor.line, ch: info.endOfInCellLine });
	}


	// Non-table End: visual-line-aware 2-step end.
	// Loops over every existing selection range the same way
	// moveCursorHomeNonTable above does, for the same multi-cursor reason.
	private moveCursorEndNonTable(editor: Editor) {
		const cm = editor.cm;
		if (!cm) {
			// No cm: single cursor (see moveCursorHomeNonTable's identical fallback).
			const cursor = editor.getCursor();
			const line = editor.getLine(cursor.line);
			if (cursor.ch !== line.length) {
				editor.setCursor({ line: cursor.line, ch: line.length });
			}
			return;
		}
		this.setCursorsViaCm(editor, (range) => this.computeEndTargetNonTable(editor, cm, range));
	}

	// Pure (no dispatch) per-range End target outside a table — see
	// computeHomeTargetNonTable's identical note on why this is pulled out
	// (reused unchanged by extendMarkEnd). Returning null means "already at
	// the logical line end, nothing to move" — the collapsing caller
	// (setCursorsViaCm) skips the dispatch for that range; the extending
	// caller leaves that range's head untouched.
	private computeEndTargetNonTable(editor: Editor, cm: EditorView, range: SelectionRange): { pos: number; assoc?: -1 | 1 } | null {
		if (this.settings.visualLineMovement) {
			const vlEnd = cm.moveToLineBoundary(range, true, true);
			if (vlEnd.head !== range.head) {
				// Not yet at VL end: move to VL end.
				return { pos: vlEnd.head, assoc: vlEnd.assoc as -1 | 1 };
			}
			// Fell through: already at VL end.
		}
		// visualLineMovement OFF, or already at VL end -> move to logical line end.
		const pos = editor.offsetToPos(range.head);
		const lineText = editor.getLine(pos.line);
		if (pos.ch === lineText.length) return null;
		return { pos: editor.posToOffset({ line: pos.line, ch: lineText.length }) };
	}


	//===========================================================================
	// Entry points: Ctrl-P / Ctrl-N
	//===========================================================================

	// Bare native goUp/goDown can silently drop the live SelectionRange.goalColumn
	// when clamped at a document boundary (cursor already on the first/last
	// line, so the command can't actually move it) — @codemirror/commands still
	// returns a fresh selection for the identical position, but without the
	// goalColumn field, discarding the column a later table re-entry depends on
	// (computeRowCrossPixelGoal reads it straight off this same field). Confirmed
	// via direct logging: pressing goDown at EOF measured goalColumn going from
	// a real pixel value to undefined despite the cursor not moving at all.
	// Restores the pre-call goalColumn onto the post-call selection whenever the
	// position provably didn't change and the command itself didn't set its own.
	private execPreservingGoalColumn(editor: Editor, command: 'goUp' | 'goDown'): void {
		const cm = editor.cm;
		// This is the generic fast path: reached only when the caller has
		// already confirmed main itself isn't crossing a table boundary this
		// step (moveCursorUpImpl/DownImpl route that case to
		// moveCursorUpIntoTable/DownIntoTable instead, before ever reaching
		// here). editor.exec('goUp'/'goDown') below has no per-row
		// table-entry awareness for any OTHER range in the selection — only
		// those main-only helpers provide that — so a secondary range
		// sitting right at a table's edge would otherwise skip over the
		// entire table in one jump instead of landing in its first/last row.
		// Confirmed live: the skipped range's final position then happens to
		// read as "not in table" again, same as main's, so a later
		// post-motion table-status comparison (reconcileSecondaryRangesAfterTableCrossing)
		// can't catch it — this has to be filtered out beforehand instead.
		this.dropSecondariesAboutToCrossTableBoundary(editor, command === 'goDown' ? 1 : -1);
		const beforeCursor = editor.getCursor();
		const beforeGoal = cm?.state?.selection?.main?.goalColumn;
		editor.exec(command);
		if (beforeGoal === undefined || !cm?.state) return;
		const afterCursor = editor.getCursor();
		if (afterCursor.line !== beforeCursor.line || afterCursor.ch !== beforeCursor.ch) return;
		const main = cm.state.selection.main;
		if (main.goalColumn !== undefined) return;
		// Restore the goalColumn onto main only, keeping every other range
		// (multi-cursor) exactly as exec just left it — this dispatch used
		// to always collapse to a single range regardless of how many were
		// active (same class of bug as everywhere else in this file).
		const ranges = cm.state.selection.ranges.map(range =>
			range === main
				? EditorSelection.cursor(main.head, main.assoc, undefined, beforeGoal)
				: range
		);
		cm.dispatch({ selection: EditorSelection.create(ranges, cm.state.selection.mainIndex) });
	}

	// Multi-cursor + table-boundary policy, called from
	// execPreservingGoalColumn's own generic UP/DOWN fast path right before
	// editor.exec('goUp'/'goDown') — see that function's own doc comment for
	// why this has to run beforehand rather than after, unlike
	// reconcileSecondaryRangesAfterTableCrossing's own after-the-fact check.
	// Uses only the CURRENT (pre-motion) selection, so — unlike a before/after
	// position diff — it needs no range-identity tracking across the
	// dispatch (EditorSelection always keeps its ranges sorted by position,
	// so index-based before/after correspondence isn't reliable once a range
	// jumps far enough to cross another range's position).
	private dropSecondariesAboutToCrossTableBoundary(editor: Editor, verticalDirection: 1 | -1) {
		const cm = editor.cm;
		if (!cm) return;
		const sel = cm.state.selection;
		if (sel.ranges.length <= 1) return;
		const main = sel.main;
		const mainPos = editor.offsetToPos(main.head);
		const mainWillCross = this.isPositionInTable(editor, mainPos.line + verticalDirection, 1);
		const kept = sel.ranges.filter(range => {
			if (range === main) return true;
			const pos = editor.offsetToPos(range.head);
			return this.isPositionInTable(editor, pos.line + verticalDirection, 1) === mainWillCross;
		});
		if (kept.length === sel.ranges.length) return;
		cm.dispatch({
			selection: EditorSelection.create(kept, kept.indexOf(main)),
			userEvent: 'move',
		});
	}

	// Wrapper: see reconcileSecondaryRangesAfterTableCrossing's own doc
	// comment for why this runs after every LEFT/RIGHT/UP/DOWN whose
	// current position starts outside a table cell (multi-cursor + table
	// boundary policy). Set-mark extension bypasses all of this entirely —
	// see extendMarkVertically's own doc comment for why it needs none of
	// the drop/collapse machinery below.
	private moveCursorUp(editor: Editor) {
		if (this.markActive) {
			this.extendMarkVertically(editor, false);
			return;
		}
		const startedInTable = editor.inTableCell;
		this.moveCursorUpImpl(editor);
		if (!startedInTable) this.reconcileSecondaryRangesAfterTableCrossing(editor);
	}

	private moveCursorUpImpl(editor: Editor) {
		const cursor = editor.getCursor();
		// 0.13.0 Feature 1, frontmatter sub-phase: the real first body
		// line, not a hardcoded 0 — see getFirstBodyLine's own comment for
		// why frontmatter makes that distinction necessary.
		const firstBodyLine = this.getFirstBodyLine();

		if (cursor.line === firstBodyLine || !this.isLivePreviewMode()) {
			// 0.13.0 Feature 1: capture the ORIGINAL column's coords before
			// exec — 'goUp' has its own built-in fallback of snapping
			// horizontally to ch 0 when there's nowhere to go vertically
			// (confirmed live), which would otherwise look like "the
			// position changed" on a plain ch comparison, delaying the
			// title-escape by one extra keypress and losing the original
			// column in the process. Comparing VERTICAL (Y) position
			// instead correctly distinguishes "genuinely moved to a
			// different visual row within a wrapped line 0" (don't escape)
			// from "merely snapped horizontally in place" (do escape, using
			// the pre-snap X).
			const cm = editor.cm;
			const beforeCoords = cursor.line === firstBodyLine ? cm?.coordsAtPos(editor.posToOffset(cursor)) : null;
			// Real pre-existing bug, surfaced (not introduced) by this
			// session's frontmatter work: capture goalColumn BEFORE the
			// exec below, not after. Confirmed live that when 'goUp' hits
			// "nowhere further to go" (already at the document's/view's
			// absolute top line), CM6 itself RESETS goalColumn to null as
			// part of its own top-of-document handling — reading it
			// AFTER the exec silently loses whatever wide column a
			// previous multi-press chain had established, exactly when
			// escaping to the title needs it most. This was always
			// theoretically reachable for a frontmatter-less note too
			// (a short line 0 following a wide line 1), just far more
			// likely once frontmatter's own short "---" lines are
			// involved.
			const goalColumnBeforeExec = cm?.state?.selection?.main?.goalColumn;
			this.execPreservingGoalColumn(editor, 'goUp');
			if (cursor.line === firstBodyLine && beforeCoords) {
				const after = editor.getCursor();
				const afterCoords = cm?.coordsAtPos(editor.posToOffset(after));
				if (afterCoords && Math.abs(afterCoords.top - beforeCoords.top) < 1) {
					// Prefer the PRE-exec goal-column (captured above) over
					// the CURRENT cursor's own X — on a short/blank line
					// (e.g. an empty line 1 reached after stepping up from
					// a much longer line 2) the current X has already
					// collapsed to ch 0, silently forgetting a wider
					// column from several Ctrl-P presses back. No separate
					// title-crossing goal-column bookkeeping needed: this
					// is the exact same mechanism the body already
					// maintains for itself — just read at the right time.
					const rect = cm?.contentDOM.getBoundingClientRect();
					const targetX = (goalColumnBeforeExec !== undefined && rect) ? rect.left + goalColumnBeforeExec : beforeCoords.left;
					// 0.13.0 Feature 1, frontmatter sub-phase: land in the
					// Properties panel's own "Add property" button instead
					// of jumping straight to the title, when the note
					// actually HAS frontmatter AND a Properties panel is
					// actually visible right now — see
					// titleMoveLineOrEscapeToBody's own matching comment
					// for why mere DOM presence isn't enough on its own
					// (the Add-button/heading elements exist, just hidden,
					// even for a note with no frontmatter at all).
					//
					// The Add-button specifically also goes hidden when the
					// user has COLLAPSED the Properties panel (confirmed
					// live: the heading itself stays visible, gaining an
					// "is-collapsed" class, but the Add-button and every
					// row go offsetParent === null) — falling all the way
					// through to the title in that case would skip
					// Properties entirely even though it genuinely exists
					// and is visible, just collapsed. Fall back to the
					// heading itself when the Add-button isn't usable but
					// the heading still is, rather than assuming "no
					// visible Add-button" means "no Properties panel."
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					const hasFrontmatter = this.getFirstBodyLine() > 0;
					const addButton = hasFrontmatter
						? view?.containerEl.querySelector('.metadata-add-button') as HTMLElement | null
						: null;
					const heading = hasFrontmatter
						? view?.containerEl.querySelector('.metadata-properties-heading') as HTMLElement | null
						: null;
					if (addButton && addButton.offsetParent !== null) {
						// 0.13.0 Feature 1, frontmatter sub-phase: preserve the
						// goal column through the Properties detour — already
						// in body-space (the exact shape escapeUpToTitle's own
						// targetX expects), so no conversion needed here; see
						// propertyGoalX's own comment.
						this.propertyGoalX = targetX;
						addButton.focus();
					} else if (heading && heading.offsetParent !== null) {
						this.propertyGoalX = targetX;
						heading.focus();
						heading.ownerDocument.getSelection()?.removeAllRanges();
					} else {
						this.escapeUpToTitle(editor, targetX);
					}
				}
			}
			return;
		}

		if (editor.inTableCell) {
			this.moveCursorUpInTable(editor);
			return;
		}
		if (this.isPositionInTable(editor, cursor.line - 1, 1)) {
			this.moveCursorUpIntoTable(editor);
			return;
		}

		// Enter a blockquote/callout from a line directly below it that is no
		// longer part of it — not just a blank line: Markdown doesn't require
		// a blank line to end a blockquote/callout, a block-starting construct
		// (list marker, ordered list, checkbox, heading, fenced code block,
		// etc.) ends it too, per CommonMark's laziness rules, with no blank
		// line needed (live-confirmed: the physical ↑ key enters/expands the
		// callout from any of those, but this plugin's own UP used to pass
		// straight through since it only checked "current line is blank").
		// goUp skips over the collapsed widget; setCursor triggers LP expansion (same mechanism as goLeft).
		// Precondition: current line is NOT itself part of the quote/callout
		// (a blank line never is, so this subsumes the old blank-only check).
		// Detection: syntax tree at end of the line has HyperMD-quote (covers > lines and lazy continuation).
		if (!this.isLineInQuote(editor, cursor.line) &&
			this.isLineInQuote(editor, cursor.line - 1)) {
			const prevLine = cursor.line - 1;
			const prevLen  = editor.getLine(prevLine).length;
			editor.setCursor({ line: prevLine, ch: Math.min(cursor.ch, prevLen) });
			return;
		}

		if (this.isLineSkippableWidget(editor.getLine(cursor.line - 1))) {
			this.setCursorViaCm(editor, cursor.line - 1, 0);
			return;
		}

		this.execPreservingGoalColumn(editor, 'goUp');
	}

	// 0.13.0 Feature 1: reached only when goUp was a true no-op at document
	// start (see moveCursorUpImpl's own call site). Deliberately does NOT
	// match native physical-ArrowUp's own behavior here (confirmed live:
	// native selects the ENTIRE title, with no column preservation at
	// all) — intentionally landing a collapsed caret instead, preserving
	// the horizontal pixel position via coordsAtPos/caretRangeFromPoint
	// (not a character-index "goal column", since the title's own font
	// isn't guaranteed monospace and may wrap across multiple visual
	// lines — pixel-based matching sidesteps needing to count visual
	// lines at all). cm.dom.ownerDocument (not the global `document`)
	// keeps this correct from a popout window.
	private escapeUpToTitle(editor: Editor, targetX: number) {
		const cm = editor.cm;
		const doc = cm.dom.ownerDocument;
		// A window can contain more than one `.inline-title` at once (e.g.
		// another leaf/pane, hover preview, or linked view also open) —
		// confirmed live the plain document-wide querySelector can pick an
		// unrelated, zero-sized one from a DIFFERENT leaf, which makes
		// every downstream rect/hit-test computation degenerate. Scope the
		// lookup to the active view's own container so it always matches
		// the title paired with THIS editor.
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const titleScopeEl = view?.containerEl ?? doc;
		const title = titleScopeEl.querySelector(TITLE_SELECTOR) as HTMLElement | null;
		if (!title) return;

		// The body and the title don't share the same absolute-pixel
		// coordinate space: the body has its own line-number gutter the
		// title doesn't, so matching targetX as a raw screen X would
		// systematically overshoot into the title by roughly the
		// gutter's own width — most visibly wrong right at ch=0, which
		// should land at the title's own true start but would instead
		// land partway in (confirmed live, tentatively "fixed" by
		// special-casing ch=0 alone, but that just traded it for a worse
		// discontinuity at ch=1/ch=2, still raw-matched). Normalize by
		// each side's own line-start X instead: this makes ch=0 land at
		// the title's own ch=0 with no special case needed, and keeps
		// other columns consistently offset from it rather than jumping.
		const bodyLineStartX = cm.coordsAtPos(0)?.left;
		const titleStartX = title.getBoundingClientRect().left;
		const adjustedX = bodyLineStartX != null ? targetX - bodyLineStartX + titleStartX : targetX;

		// Seed the title's own goal-column with the ADJUSTED (title-space)
		// X, so a Ctrl-P/N chain continuing WITHIN the title (see
		// titleMoveLine) keeps reaching for this same column — within the
		// title there's no gutter mismatch to correct for, so this value
		// is used as-is from here on.
		this.titleGoalX = adjustedX;
		title.focus();
		const titleRect = title.getBoundingClientRect();
		const targetY = titleRect.bottom - 1; // aim at the title's last visual line
		// Clamp to the title's own actual box: a short, unwrapped title
		// is often narrower than the body. A hit-test point past the
		// title's own right edge lands outside the title element
		// entirely (e.g. the empty margin next to it), failing the
		// `title.contains(...)` check below and leaving the crossing a
		// no-op instead of clamping to the title's own last character,
		// same as caretRangeFromPoint already does naturally for an
		// in-title overshoot.
		const clampedX = Math.min(Math.max(adjustedX, titleRect.left), titleRect.right - 1);
		const range = (doc as unknown as { caretRangeFromPoint(x: number, y: number): Range | null })
			.caretRangeFromPoint(clampedX, targetY);
		if (range && title.contains(range.startContainer)) {
			const sel = doc.getSelection() as (Selection & {
				modify(alter: string, direction: string, granularity: string): void;
			}) | null;
			sel?.removeAllRanges();
			sel?.addRange(range);

			// Same ambiguous-VL-boundary-offset nudge as titleMoveLine's
			// own fix: caretRangeFromPoint can land EXACTLY on the
			// offset shared between VLn-1 and VLn (most likely when
			// clampedX sits right at the title's own left edge, e.g. a
			// crossing from the body's ch=0) — a collapsed caret there
			// always renders via the PREVIOUS line's rect regardless of
			// how it was reached, which visually looks like landing on
			// VLn-1's right edge instead of VLn's own start. We're
			// always landing on the title's LAST (bottommost) visual
			// line here, so the ambiguous rect with the larger top is
			// the one we actually want; if the default-rendered rect
			// (rects[0]) isn't that one, step one character forward to
			// move off the boundary into VLn's own unambiguous interior.
			const landedRects = sel ? Array.from(sel.getRangeAt(0).getClientRects()) : [];
			if (landedRects.length > 1) {
				const targetRect = landedRects.reduce((a, b) => (b.top > a.top ? b : a));
				if (Math.abs(landedRects[0].top - targetRect.top) >= 1) {
					sel?.modify('move', 'right', 'character');
				}
			}
		}
	}


	private moveCursorDown(editor: Editor) {
		if (this.markActive) {
			this.extendMarkVertically(editor, true);
			return;
		}
		const startedInTable = editor.inTableCell;
		this.moveCursorDownImpl(editor);
		if (!startedInTable) this.reconcileSecondaryRangesAfterTableCrossing(editor);
	}

	//===========================================================================
	// Set-mark (Ctrl-Space / Ctrl-G) — Ctrl-N/P (first increment),
	// Ctrl-B/F/A/E (second increment)
	//===========================================================================

	// Extends every range's own selection one line up/down instead of just
	// moving a collapsed cursor — real Emacs's own Set-mark semantics, via
	// CM6's own anchor/head (no separate mark position is ever stored; see
	// markActive's own doc comment). No primary/secondary distinction is
	// needed anywhere here, unlike plain (non-mark) multi-cursor table
	// crossing: a range extending from inside a cell can only ever be
	// sharing that cell with other ranges also confined to it (the
	// pre-existing "all ranges share one view" invariant), so each range's
	// own crossing is independent of every other range's.
	//
	// No table-aware logic needed at all for the outer-view case, which was
	// NOT expected going in — confirmed live: an un-focused table in Live
	// Preview renders as one collapsed visual block for the outer view's
	// own purposes, so EditorView.moveVertically already treats the whole
	// table as a single visual line and skips straight past it in one
	// call — the table's own rows end up inside the region exactly like a
	// mouse-drag selection already renders it, which native Shift+cursor
	// cannot do. A hand-rolled "scan past the whole table" fallback was
	// built and tested first (an isPositionInTable-driven version mirroring
	// table-navigation.ts's own exitTable scan) but turned out to be
	// entirely redundant once this was discovered, so it was removed
	// rather than kept as unreachable insurance.
	private extendMarkVertically(editor: Editor, forward: boolean) {
		const inner = editor.activeCM;
		const view = (editor.inTableCell && inner && inner !== editor.cm) ? inner : editor.cm;
		const sel = view.state.selection;
		const ranges = sel.ranges.map(range => {
			// A range's own goalColumn is only meaningful as "the column to
			// preserve" when it's the product of a previous vertical move —
			// a genuine pixel offset from the content area's left edge can
			// never be negative. Confirmed live: a real mouse-drag selection's
			// resulting range carries goalColumn = -1 natively (not
			// undefined/no-goal), which moveVertically otherwise trusts
			// as-is, making every first extend after a drag land at column 0
			// regardless of where the drag's own head actually was.
			const startRange = (range.goalColumn ?? 0) < 0
				? EditorSelection.range(range.anchor, range.head)
				: range;
			const head = view.moveVertically(startRange, forward);
			return EditorSelection.range(range.anchor, head.head, head.goalColumn, head.bidiLevel ?? undefined, head.assoc);
		});
		view.dispatch({ selection: EditorSelection.create(ranges, sel.mainIndex), userEvent: 'select.uch', scrollIntoView: true });
	}

	// Generic extend-dispatch helper for HOME/End's *outer* (non-table) case:
	// calls computeTarget once per existing range (computeHomeTargetNonTable/
	// computeEndTargetNonTable — the exact same pure functions the plain,
	// collapsing path already uses, since Smart-Home's target is a pure
	// function of (line text, current ch), not separate step-counter state,
	// so there's nothing different to compute here under Set-mark), and
	// extends range.anchor -> target.pos instead of collapsing to a cursor.
	// A null target leaves that one range untouched ("already there");
	// skips the dispatch entirely if no range changed, mirroring
	// setCursorsViaCm's own no-op guard.
	private extendMarkHorizontalLine(editor: Editor, computeTarget: (range: SelectionRange) => { pos: number; assoc?: -1 | 1 } | null) {
		const cm = editor.cm;
		const sel = cm.state.selection;
		let changed = false;
		const ranges = sel.ranges.map(range => {
			const target = computeTarget(range);
			if (!target) return range;
			changed = true;
			return EditorSelection.range(range.anchor, target.pos, undefined, undefined, target.assoc);
		});
		if (!changed) return;
		cm.dispatch({ selection: EditorSelection.create(ranges, sel.mainIndex), userEvent: 'select.uch', scrollIntoView: true });
	}

	// Generic extend-dispatch helper for HOME/End's *in-cell* case: calls
	// computeResult once per existing inner-view range (computeHomeTargetInCell/
	// computeEndTargetInCell, unmodified) and extends to its 'stay' target.
	// 'exit' (the cell's own first/last sub-line boundary) clamps instead of
	// delegating to the plain path's onPrimaryExit — a single CM6 range
	// can't span this cell's own inner EditorState and the outer one, so
	// extending to an adjacent cell is structurally impossible (same
	// reasoning as extendMarkVertically's own in-cell clamp).
	private extendMarkInCell(inner: EditorView, computeResult: (range: SelectionRange) => { kind: 'exit' } | { kind: 'stay'; pos: number; assoc?: -1 | 1 }) {
		const sel = inner.state.selection;
		let changed = false;
		const ranges = sel.ranges.map(range => {
			const result = computeResult(range);
			if (result.kind === 'exit' || result.pos === range.head) return range;
			changed = true;
			return EditorSelection.range(range.anchor, result.pos, undefined, undefined, result.assoc);
		});
		if (!changed) return;
		inner.dispatch({ selection: EditorSelection.create(ranges, sel.mainIndex), userEvent: 'select.uch', scrollIntoView: true });
	}

	//===========================================================================
	// Add cursor above/below (Option/Alt-↑/↓ candidate)
	//===========================================================================

	// Native Obsidian's own 'editor:add-cursor-below'/'-above' were confirmed
	// (live, via E2E) to mis-step vertically. Two separate findings, not one:
	// (1) native steps by LOGICAL line + character column, not by visual
	// (soft-wrapped) line/pixel goal-column — confirmed by placing the cursor
	// mid-way through a long word-wrapped line and pressing 'below': it jumps
	// straight to the exact same character column on the NEXT LOGICAL line,
	// skipping every remaining visual sub-line of the current one, rather
	// than moving to the next visual line the way a plain arrow-key Down
	// press (and this plugin's own Ctrl-N/P) would. This is a deliberate
	// difference from ordinary vertical motion, not an accident, and matches
	// the real use case for "add a cursor per line to batch-edit several
	// lines" better than visual-line stepping would. (2) despite that
	// correct design, native's own line-index arithmetic has a genuine
	// off-by-one bug — confirmed live across multiple different line
	// lengths — that skips an extra logical line every press (e.g. line 0 ->
	// line 2 -> line 4, never landing on 1 or 3). This plugin re-implements
	// the *intended* behavior directly instead of reusing any native
	// primitive: next/previous logical line (CM6's own Text.lineAt/Text.line,
	// not moveVertically), column clamped by character count against that
	// line's own length (not a pixel goal-column) — no memory of any
	// "original" column is kept across presses, by design (confirmed
	// explicitly acceptable: repeated presses aren't guaranteed to be
	// consecutive, so remembering an original intent across a clamp isn't a
	// coherent idea here the way goalColumn is for real pixel-based vertical
	// motion) — each press just clamps whatever the current primary's own
	// column actually is against the next/previous line's own length. At a
	// document boundary (no further logical line in that direction), clamps
	// within the current line to its own start/end, matching native's own
	// confirmed (non-buggy) behavior there.
	//
	// Only ever adds ONE new cursor relative to the current primary (every
	// other range in the selection is left untouched) and makes the new
	// cursor primary — pressing again stacks one more line further in the
	// same direction. markActive is left exactly as it was: if a mark was
	// already active, the new cursor is added as a fresh, not-yet-extended
	// mark point (anchor === head, ready to grow on the next Ctrl-N/P), since
	// extendMarkVertically already treats every range in the selection
	// uniformly — no special-casing needed here for that to work.
	//
	// userEvent is 'select.uch' (this plugin's own standard tag for a
	// programmatic selection-shape change, same as extendMarkVertically etc.)
	// rather than bare 'select' — confirmed live this isn't just cosmetic:
	// a bare-'select'-tagged dispatch into a table cell's own inner view
	// silently lost the OLDEST range on the second+ add-cursor press inside
	// that cell (e.g. [0,74] -> [0,74,93] regressed to just [74,93]), while
	// a real Option/Alt-click adding a cursor the same way (confirmed via a
	// monkey-patched dispatch to inspect its actual transaction) tags
	// itself 'select.pointer' and never loses a range. Rewriting only the
	// userEvent tag (nothing else) on an otherwise-identical dispatch
	// reproduced the fix, isolating the tag itself as the cause — some
	// Obsidian-internal table-cell-widget resync evidently keys off it.
	// 'select.pointer' itself can't be reused here (main.ts's own
	// updateListener unconditionally forces markActive to the new main
	// range's emptiness for that exact tag), but 'select.uch' fixes the
	// same loss and is already exempted from every markActive side effect
	// this file's updateListener has, by design.
	private addCursorVertically(editor: Editor, forward: boolean) {
		const inner = editor.activeCM;
		if (editor.inTableCell && inner && inner !== editor.cm) {
			// A second, separate race from the tag issue above: any
			// preceding command run against a table cell's own inner view —
			// even a no-op one, confirmed live with add-cursor-above itself
			// right before add-cursor-below — can leave an async
			// Obsidian-internal resync pending. If our own dispatch below
			// lands before that resync fires, it silently clobbers our
			// freshly-added range back down to just the newest one, even
			// though the dispatch we actually sent (confirmed via a
			// monkey-patched dispatch) was already correct. Same race
			// category as exitCellWithSelection's own 2-RAF-frame deferral
			// elsewhere in this file; waiting it out first — then reading,
			// computing and dispatching only once fully settled — confirmed
			// stable (dispatching immediately without this wait reproduced
			// the loss on the very first add-cursor press after ANY
			// preceding in-cell command, not just a prior add-cursor one).
			requestAnimationFrameOnActiveWindow(() => {
				requestAnimationFrameOnActiveWindow(() => {
					this.addCursorOnView(inner, forward);
				});
			});
			return;
		}
		this.addCursorOnView(editor.cm, forward);
	}

	private addCursorOnView(view: EditorView, forward: boolean) {
		const sel = view.state.selection;
		const primary = sel.main;
		const doc = view.state.doc;
		const primaryLine = doc.lineAt(primary.head);
		const col = primary.head - primaryLine.from;

		const targetLineNumber = primaryLine.number + (forward ? 1 : -1);
		let targetPos: number;
		if (targetLineNumber < 1 || targetLineNumber > doc.lines) {
			targetPos = forward ? primaryLine.to : primaryLine.from;
		} else {
			const targetLine = doc.line(targetLineNumber);
			targetPos = targetLine.from + Math.min(col, targetLine.length);
		}
		if (targetPos === primary.head) return; // already at the buffer start/end in that direction

		view.dispatch({
			selection: sel.addRange(EditorSelection.cursor(targetPos), true),
			userEvent: 'select.uch',
			scrollIntoView: true,
		});
	}

	// Ctrl-A (Set-mark candidate): extends every range to its own Home
	// target, same Smart-Home/VL-step behavior as the plain command.
	private extendMarkHome(editor: Editor) {
		if (editor.inTableCell) {
			const inner = editor.activeCM;
			if (!inner || inner === editor.cm) return;
			this.extendMarkInCell(inner, range => this.computeHomeTargetInCell(inner, range));
			return;
		}
		const cm = editor.cm;
		this.extendMarkHorizontalLine(editor, range => this.computeHomeTargetNonTable(editor, cm, range));
	}

	// Ctrl-E (Set-mark candidate): extends every range to its own End
	// target, same VL-step behavior as the plain command.
	private extendMarkEnd(editor: Editor) {
		if (editor.inTableCell) {
			const inner = editor.activeCM;
			if (!inner || inner === editor.cm) return;
			this.extendMarkInCell(inner, range => this.computeEndTargetInCell(inner, range));
			return;
		}
		const cm = editor.cm;
		this.extendMarkHorizontalLine(editor, range => this.computeEndTargetNonTable(editor, cm, range));
	}

	// Pure (no dispatch, no document mutation — Set-mark extension must
	// never mutate the document, unlike exitTable's own forward
	// EOF-blank-line-append case): scans past a whole contiguous table
	// block when extending LEFT/RIGHT crosses into one, mirroring
	// extendMarkVertically's own "treat the whole table as one atomic
	// unit" policy. moveVertically gets this for free via pixel-based
	// visual-line geometry (an unfocused table renders as one visual
	// block); EditorView.moveByChar operates on raw logical lines instead
	// (confirmed by reading @codemirror/view's own source: it steps
	// straight into doc.line(line.number ± 1), no visual-block awareness),
	// so this needs its own scan — same trimStart().startsWith('|')
	// pre-filter + isPositionInTable confirm convention as
	// table-navigation.ts's own exitTable. No Smart-Home landing
	// refinement either, unlike exitTable — matches extendMarkVertically's
	// own plain, un-refined landing precedent (confirmed by
	// setMarkTableSkip.e2e.ts's own assertion landing at raw ch: 0).
	// Returns null if the table runs all the way to that edge of the
	// document — the caller clamps instead of landing anywhere.
	private findOffsetPastWholeTableHorizontal(editor: Editor, fromLine: number, forward: boolean): number | null {
		const lastLine = editor.lastLine();
		let line = fromLine;
		while (forward ? line < lastLine : line > 0) {
			line += forward ? 1 : -1;
			const text = editor.getLine(line);
			if (text.trimStart().startsWith('|')) continue;
			if (this.isPositionInTable(editor, line, 1)) continue;
			return editor.posToOffset({ line, ch: forward ? 0 : text.length });
		}
		return null;
	}

	// Ctrl-B/F (Set-mark candidate): extends every range one character
	// left/right. No goalColumn concept here at all (that's vertical-
	// movement-only) and no primary/secondary distinction needed (same
	// reasoning as extendMarkVertically). In-cell ranges clamp for free —
	// inner.moveByChar can't go past the inner EditorState's own document,
	// which is just this cell's own content.
	private extendMarkHorizontalChar(editor: Editor, forward: boolean) {
		const inner = editor.activeCM;
		const isInCell = !!(editor.inTableCell && inner && inner !== editor.cm);
		const view = isInCell ? inner : editor.cm;
		const sel = view.state.selection;
		const ranges = sel.ranges.map(range => {
			if (!isInCell && this.isLivePreviewMode()) {
				const pos = editor.offsetToPos(range.head);
				const lineLen = editor.getLine(pos.line).length;
				const atLineEdge = forward
					? pos.ch >= lineLen && pos.line < editor.lastLine()
					: pos.ch === 0 && pos.line > 0;
				if (atLineEdge) {
					const adjacentLine = pos.line + (forward ? 1 : -1);
					if (this.isPositionInTable(editor, adjacentLine, 1)) {
						const target = this.findOffsetPastWholeTableHorizontal(editor, pos.line, forward);
						if (target === null) return range; // table runs to the document's edge: clamp
						return EditorSelection.range(range.anchor, target);
					}
				}
			}
			const head = view.moveByChar(range, forward);
			return EditorSelection.range(range.anchor, head.head, undefined, head.bidiLevel ?? undefined, head.assoc);
		});
		view.dispatch({ selection: EditorSelection.create(ranges, sel.mainIndex), userEvent: 'select.uch', scrollIntoView: true });
	}

	// Alt-F/Alt-B (Set-mark candidate): extends every range to its own
	// word-search target. Self-contained like extendMarkHorizontalChar
	// above (not routed through extendMarkHorizontalLine's generic
	// 2-outcome contract, since the outer case here has a third outcome —
	// "search reached a table row" — that needs its own handling), but
	// otherwise reuses the plain (non-mark) implementation's own per-range
	// pure functions unchanged: findWordTargetPlainText (outer) and
	// findWordTargetInCellForRange (in-cell, via the shared extendMarkInCell
	// helper already built for Home/End) were already structured as pure,
	// multi-cursor-safe searches, so no new search logic was needed here at
	// all.
	//
	// Table-crossing policy matches extendMarkHorizontalChar's own: skip
	// the whole table atomically via findOffsetPastWholeTableHorizontal,
	// rather than entering it the way the plain (non-mark) path's own
	// enterTableWithWordFromPlainText does — a selection can't span the
	// outer view and a table cell's own inner view at once. fromLine is
	// the line just *before* the table (tableLine ∓ 1), matching
	// extendMarkHorizontalChar's own calling convention for the same
	// function.
	private extendMarkWord(editor: Editor, forward: boolean) {
		const inner = editor.activeCM;
		if (editor.inTableCell && inner && inner !== editor.cm) {
			const lineText = editor.getLine(editor.getCursor().line);
			const cellIndex = getCellIndex(lineText, editor.getCursor().ch);
			const cellStartCh = getChByCellIndex(lineText, cellIndex);
			const firstSegInfo = getInCellLineInfo(lineText, cellStartCh);
			if (!firstSegInfo) return;
			this.extendMarkInCell(inner, range =>
				this.findWordTargetInCellForRange(inner, range, lineText, firstSegInfo, forward));
			return;
		}

		const cm = editor.cm;
		const sel = cm.state.selection;
		const ranges = sel.ranges.map(range => {
			const result = this.findWordTargetPlainText(editor, editor.offsetToPos(range.head), forward);
			if (result.kind === 'noMove') return range;
			if (result.kind === 'table') {
				const fromLine = forward ? result.tableLine - 1 : result.tableLine + 1;
				const target = this.findOffsetPastWholeTableHorizontal(editor, fromLine, forward);
				if (target === null) return range; // table runs to the document's edge: clamp
				return EditorSelection.range(range.anchor, target);
			}
			return EditorSelection.range(range.anchor, result.pos);
		});
		cm.dispatch({ selection: EditorSelection.create(ranges, sel.mainIndex), userEvent: 'select.uch', scrollIntoView: true });
	}

	// Shared by extendMarkBufferEdge's own in-cell branch below (see its
	// own comment for why): scans from fromLine in scanForward's own
	// direction, as long as the next line is still part of the same
	// table (same trimStart().startsWith('|') + isPositionInTable
	// convention as findOffsetPastWholeTableHorizontal), stopping at the
	// table's own last line still inside it — then returns that line's
	// own far edge (ch 0 scanning backward toward the table's start, ch
	// length scanning forward toward its end). Pure, no dispatch.
	private findTableOwnEdge(editor: Editor, fromLine: number, scanForward: boolean): { line: number; ch: number } {
		const lastLine = editor.lastLine();
		let line = fromLine;
		while (scanForward ? line < lastLine : line > 0) {
			const nextLine = line + (scanForward ? 1 : -1);
			const text = editor.getLine(nextLine);
			if (!text.trimStart().startsWith('|') && !this.isPositionInTable(editor, nextLine, 1)) break;
			line = nextLine;
		}
		return { line, ch: scanForward ? editor.getLine(line).length : 0 };
	}

	// Alt-< / Alt-> (Set-mark candidate, TOP/BOTTOM): extends to the real
	// buffer edge — a common real Emacs idiom (set mark at a note's own
	// start, then jump to its end, selecting the whole note). Previously
	// mark-unaware entirely (jumpToBufferEdge below had no markActive
	// check at all, and its own dispatch is tagged "move", not "select"
	// — invisible to the generic native-collapse-clearing rule too), so
	// pressing this while marked silently left markActive stuck true
	// while the selection jumped to an unrelated position, risking a
	// wildly wrong extend on the next Ctrl-B/F/N/P/A/E.
	//
	// User intent is always the real document edge, even from inside a
	// table cell — unlike HOME/END/Word-left-right's own in-cell clamp,
	// TOP/BOTTOM should reach past the cell, including the whole
	// containing table in the result (same "unfocused table = one
	// atomic block" rendering Ctrl-N/P's own moveVertically-based
	// extend already relies on when crossing INTO a table from
	// outside this is the mirror case, extending back OUT).
	//
	// That "whole table, atomic" policy means the anchor itself can't
	// stay at the exact character position Set-mark was pressed at
	// in-cell — e.g. marking inside a table's own last row, then BOTTOM,
	// must still sweep in the table's earlier rows (header, delimiter,
	// any rows above the one the mark was set in), not just extend
	// forward from that one exact spot and leave them out. Snaps the
	// anchor to the table's own far edge in the direction OPPOSITE the
	// extend instead — BOTTOM (forward) snaps to the table's own first
	// line (its start is "behind" the extend, toward the anchor side);
	// TOP (backward) snaps to the table's own last line — via
	// findTableOwnEdge above.
	//
	// Reaching the real boundary from inside a cell requires actually
	// exiting the cell to the outer view first — a single CM6 range
	// can't span the cell's own inner EditorState and the outer one at
	// once. A direct "dispatch the final anchor/head, then focus the
	// outer view" races against Obsidian's own async cell-exit
	// reconciliation: confirmed live (repeatable both ways depending on
	// exact timing) that actually moving DOM focus off a cell always
	// eventually collapses whatever selection was in place back to a
	// point, regardless of dispatch ordering relative to the focus()
	// call. Letting that collapse happen and settle FIRST, then
	// applying the real anchor/head in a SECOND, later dispatch (two
	// frames of deferral, matching every other "wait for Obsidian's
	// async cell-focus reconciliation to settle" spot in this
	// codebase — see nudgeInnerViewVisible's own identical reasoning)
	// avoids the race entirely, confirmed via 8+ repeated live runs.
	// Exits the current cell to the outer view, ending with {anchor, head}
	// applied as the real final selection two frames later. Shared by
	// extendMarkBufferEdge's own in-cell branch and extendMarkPage's own
	// "landed inside a table" branch — both need to leave a cell while
	// applying a selection that spans past it, not just collapse to a
	// point inside it.
	//
	// A direct dispatch-then-focus races against Obsidian's own async
	// cell-exit reconciliation: confirmed live (repeatable both ways
	// depending on exact timing) that actually moving DOM focus off a
	// cell always eventually collapses whatever selection was in place
	// back to a point, regardless of dispatch ordering relative to the
	// focus() call. Letting that collapse happen and settle FIRST (via a
	// throwaway dispatch to some genuinely safe position), then applying
	// the real anchor/head in a SECOND, later dispatch (two frames of
	// deferral, matching every other "wait for Obsidian's async
	// cell-focus reconciliation to settle" spot in this codebase — see
	// nudgeInnerViewVisible's own identical reasoning) avoids the race
	// entirely.
	//
	// The throwaway target's own value only exists to trigger a clean
	// exit — it's discarded once the real selection is applied. Using
	// `head` directly for it breaks the exit itself when that position
	// is ALSO inside a table (confirmed live: a table sitting at the
	// document's own start/end, with no buffering blank line —
	// editor.inTableCell stays permanently stuck true even though the
	// eventual selection's own anchor/head values end up numerically
	// correct regardless). Landing one step past awayFromLine in
	// awayDirection instead (same scan this plugin's own
	// horizontal-extend table-skip already uses) is guaranteed to be a
	// genuine non-table line; falls back to the opposite direction, and
	// finally to `head` itself, only in the degenerate case where even
	// neither scan can find one (the whole document is one table).
	private exitCellWithSelection(editor: Editor, awayFromLine: number, awayDirection: boolean, anchor: number, head: number) {
		const cm = editor.cm;
		const safeExitPos = this.findOffsetPastWholeTableHorizontal(editor, awayFromLine, awayDirection)
			?? this.findOffsetPastWholeTableHorizontal(editor, awayFromLine, !awayDirection)
			?? head;
		cm.dispatch({ selection: { anchor: safeExitPos, head: safeExitPos }, scrollIntoView: true, userEvent: 'move' });
		this.focusAfterCursorMove(editor, cm, false);
		requestAnimationFrameOnActiveWindow(() => {
			requestAnimationFrameOnActiveWindow(() => {
				cm.dispatch({ selection: { anchor, head }, userEvent: 'select.uch', scrollIntoView: true });
			});
		});
	}

	private extendMarkBufferEdge(editor: Editor, forward: boolean) {
		const cm = editor.cm;
		const inner = editor.activeCM;
		const targetPos = forward ? cm.state.doc.length : 0;

		if (editor.inTableCell && inner && inner !== cm) {
			const edge = this.findTableOwnEdge(editor, editor.getCursor().line, !forward);
			const anchor = editor.posToOffset(edge);
			this.exitCellWithSelection(editor, edge.line, !forward, anchor, targetPos);
			return;
		}

		const sel = cm.state.selection;
		const ranges = sel.ranges.map(range => EditorSelection.range(range.anchor, targetPos));
		cm.dispatch({ selection: EditorSelection.create(ranges, sel.mainIndex), userEvent: 'select.uch', scrollIntoView: true });
	}

	// Shared by Set-mark's own re-set semantics (pressing Ctrl-Space again
	// while already active abandons whatever's currently selected and
	// re-anchors fresh from the current head — explicit, not just "already
	// active, leave it alone") and Ctrl-G's mark-clear: collapses whichever
	// view currently holds the selection (outer or one inner cell) to a
	// plain cursor at each range's own head.
	private collapseActiveSelectionToHead(editor: Editor) {
		const view = editor.activeCM ?? editor.cm;
		const sel = view.state.selection;
		if (sel.ranges.every(r => r.empty)) return;
		const ranges = sel.ranges.map(r => EditorSelection.cursor(r.head));
		view.dispatch({ selection: EditorSelection.create(ranges, sel.mainIndex), userEvent: 'select.uch' });
	}

	// Ctrl-Space (set-mark candidate): re-anchors at the current position —
	// a no-op the first time (nothing selected yet to abandon), but an
	// explicit re-set when pressed again while a region is already active.
	private setMark(editor: Editor) {
		this.markActive = true;
		this.collapseActiveSelectionToHead(editor);
	}

	// Ctrl-G (keyboard-quit candidate): deactivates the mark, then performs
	// one step of CM6's own simplifySelection cascade (bound to bare Escape
	// by default: multiple ranges -> collapse to the main range only;
	// otherwise a non-empty single range -> collapse to a cursor at its
	// head). This command is the planned target of a future bare-ESC Key
	// Upgrade — without mirroring simplifySelection here, remapping ESC to
	// it would quietly take away the "Escape clears multi-cursor" capability
	// users already have today (confirmed live: bare ESC already does this
	// natively), and would also leave Ctrl-G with nothing useful to offer a
	// user who never touches Set-mark at all.
	private keyboardQuit(editor: Editor) {
		this.markActive = false;
		const view = editor.activeCM ?? editor.cm;
		const sel = view.state.selection;
		if (sel.ranges.length > 1) {
			view.dispatch({ selection: EditorSelection.create([sel.main]), userEvent: 'select.uch' });
			return;
		}
		this.collapseActiveSelectionToHead(editor);
	}

	private moveCursorDownImpl(editor: Editor) {
		const cursor = editor.getCursor();

		if (!this.isLivePreviewMode()) {
			this.execPreservingGoalColumn(editor, 'goDown');
			return;
		}

		if (editor.inTableCell) {
			this.moveCursorDownInTable(editor);
			return;
		}
		if (this.isPositionInTable(editor, cursor.line + 1, 1)) {
			this.moveCursorDownIntoTable(editor);
			return;
		}

		// Enter a callout from the line directly above it.
		// goDown skips over the collapsed callout widget; setCursor triggers LP expansion.
		// Plain blockquotes are already handled by goDown; only callout headers need this.
		// Callout header pattern: > [!type], > [!type]+, > [!type]-, > [!type]+ Title, etc.
		const nextIdx = cursor.line + 1;
		if (nextIdx < editor.lineCount() &&
			/^\s*>\s*\[![^\]]+\]([+-]?(\s|$))/.test(editor.getLine(nextIdx))) {
			const nextLen = editor.getLine(nextIdx).length;
			editor.setCursor({ line: nextIdx, ch: Math.min(cursor.ch, nextLen) });
			return;
		}

		if (nextIdx < editor.lineCount() && this.isLineSkippableWidget(editor.getLine(nextIdx))) {
			this.setCursorViaCm(editor, nextIdx, 0);
			return;
		}

		this.execPreservingGoalColumn(editor, 'goDown');
	}


	//===========================================================================
	// Ctrl-P/N table entry helpers
	//===========================================================================

	// Handles goUp when the cursor is inside a table cell in Live Preview mode.
	private moveCursorUpInTable(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const startOfCellContent = getStartOfCellContent(line, cursor.ch);
		const cellIndex = getCellIndex(line, cursor.ch);
		const eoc = getEndOfCellContent(line, cursor.ch);
		// Captured once, before anything below crosses a row — see
		// computeRowCrossPixelGoal's own doc comment.
		const pixelGoal = this.computeRowCrossPixelGoal(editor);

		// Empty cell: no navigable content, so go directly to the previous row.
		if (startOfCellContent === eoc) {
			this.setCursorToPrevRow(editor, cellIndex);
			this.placeAtBottomVL(editor, pixelGoal);
			return;
		}

		const innerBeforeGoUp = editor.activeCM;
		const innerHeadBeforeGoUp = (innerBeforeGoUp && innerBeforeGoUp !== editor.cm)
			? innerBeforeGoUp.state.selection.main.head
			: undefined;

		// At VL wrap-point edges, assoc may misidentify which VL the cursor is on,
		// causing goUp to skip an extra visual line. Fix assoc before goUp:
		//   left edge  → assoc=1  (start of this VL, not end of the line above)
		//   right edge → assoc=-1 (end of this VL, not start of the line below)
		//
		// resolvedAssocForOriginalHead records which of the two interpretations
		// actually won for innerHeadBeforeGoUp, so handleCellStartSnap can reuse
		// it below instead of independently re-guessing (and possibly
		// contradicting) the same ambiguous position — see that function's own
		// doc comment for why a second, disagreeing guess there was itself a bug.
		let resolvedAssocForOriginalHead: number | undefined;
		if (innerBeforeGoUp && innerBeforeGoUp !== editor.cm && innerHeadBeforeGoUp !== undefined) {
			const h = innerHeadBeforeGoUp;
			const currentAssoc = innerBeforeGoUp.state.selection.main.assoc;
			resolvedAssocForOriginalHead = currentAssoc;
			const coords = innerBeforeGoUp.coordsAtPos(h);
			// Fix only when assoc >= 0: assoc=-1 means the cursor is already correctly
			// placed at the right edge of VL_N (end-of-VL), so goUp works as expected.
			// Firing for assoc=-1 would incorrectly flip the cursor to the left edge of
			// VL_N+1 and cause goUp to skip the wrong number of visual lines.
			if (coords && currentAssoc >= 0) {
				const vlStartPos = innerBeforeGoUp.posAtCoords({ x: 0, y: coords.top + 9 }, false);
				if (vlStartPos !== null && vlStartPos === h) {
					// Carry the live goalColumn through — EditorSelection.cursor's
					// own 4th param, dropped if omitted (confirmed via
					// @codemirror/state's own type: cursor(pos, assoc?, bidiLevel?,
					// goalColumn?)). Without this, the very next editor.exec('goUp')
					// below (CM6's native cursorLineUp) sees no goalColumn on this
					// fresh selection and computes a brand-new one from wherever
					// this dispatch's own position happens to be — silently
					// resetting whatever wide goal the up/down chain was carrying.
					// This fix condition (VL wrap-point left edge) is true on
					// essentially every visit to a blank in-cell sub-line (no
					// content to be anywhere but the edge), which is why the loss
					// showed up specifically when crossing blank lines within a
					// cell, not on plain-text blank lines or row crossings (which
					// go through a different goal-tracking path entirely).
					const goalColumn = innerBeforeGoUp.state.selection.main.goalColumn;
					innerBeforeGoUp.dispatch({
						selection: EditorSelection.create([EditorSelection.cursor(h, 1, undefined, goalColumn)]),
					});
					resolvedAssocForOriginalHead = 1;
				}
			}
		}

		editor.exec('goUp');

		const cursorAfter = editor.getCursor();
		if (cursorAfter.line !== cursor.line) {
			// goUp moved to a different logical line (previous table row or outside table).
			if (editor.inTableCell) {
				const targetCh = getChByCellIndex(editor.getLine(cursorAfter.line), cellIndex);
				if (targetCh !== -1) {
					this.setCursorViaCm(editor, cursorAfter.line, targetCh);
				}
			}
			this.placeAtBottomVL(editor, pixelGoal);
			return;
		}

		// goUp stayed on the same logical line.
		if (cursor.ch <= startOfCellContent) {
			// Was at cell start -> go to previous row.
			this.setCursorToPrevRow(editor, cellIndex);
			this.placeAtBottomVL(editor, pixelGoal);
			return;
		}

		if (cursorAfter.ch === startOfCellContent) {
			// goDown from VL1 start in a non-wrapped cell lands at VL1 end (= originalCh),
			// which causes the goDown probe in handleCellStartSnap to give a false case-b.
			// Detect this directly: if cursor was at end of cell content, it's VL1 end
			// of a non-wrapped cell -> go to previous row without probing.
			const endOfCellContent = getEndOfCellContent(line, cursor.ch);
			if (cursor.ch >= endOfCellContent) {
				// VL1 end of non-wrapped cell -> go to previous row.
				this.setCursorToPrevRow(editor, cellIndex);
				this.placeAtBottomVL(editor, pixelGoal);
			} else {
				this.handleCellStartSnap(editor, cursor.line, cursor.ch, cellIndex, pixelGoal, innerHeadBeforeGoUp, resolvedAssocForOriginalHead);
			}
		}
		// else: goUp moved within the cell to the visual line above - done.
	}


	// Handles goUp when the cursor is on the line directly below a table in Live Preview mode.
	//
	// Always lands in the leftmost cell (cellIndex 0) — like Vim's own gj/gk
	// table entry (scheduleDisplayLineEntry), no pixel-to-cell resolution is
	// attempted (Obsidian's Live Preview table widget gives the outer view no
	// per-character position info for an unfocused row, so there's no way to
	// tell which cell a column falls under before landing in one). Once
	// landed, though, the column *within* that cell is preserved — same
	// gj/gk-mirroring shape as the rest of this feature: a rough landing at
	// cellIndex 0 first, then placeAtBottomVL's own pixelGoal threading
	// refines the horizontal position against the now-mounted, now-real
	// inner view (see computeRowCrossPixelGoal's own doc comment).
	private moveCursorUpIntoTable(editor: Editor) {
		const cursor = editor.getCursor();
		// Captured before crossing, while editor.activeCM is still the outer
		// (plain-text) view.
		const pixelGoal = this.computeRowCrossPixelGoal(editor);
		// Only enter the table if on VL1; if on VL2+, a regular goUp suffices.
		editor.exec('goUp');
		if (editor.getCursor().line === cursor.line) {
			// VL2+: goUp moved within visual lines, result already applied.
			return;
		}
		// VL1: goUp moved to the table's last row; reposition to the bottom-left cell.
		const targetLine = cursor.line - 1;
		const targetCh = getChByCellIndex(editor.getLine(targetLine), 0);
		if (targetCh !== -1) {
			editor.setCursor({ line: targetLine, ch: targetCh });
		}
		this.placeAtBottomVL(editor, pixelGoal);
	}


	// Handles goDown when the cursor is inside a table cell in Live Preview mode.
	private moveCursorDownInTable(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = getCellIndex(line, cursor.ch);
		const eoc = getEndOfCellContent(line, cursor.ch);
		// Captured once, before anything below crosses a row — see
		// computeRowCrossPixelGoal's own doc comment.
		const pixelGoal = this.computeRowCrossPixelGoal(editor);

		// Empty cell: no navigable content, so go directly to the next row.
		if (getStartOfCellContent(line, cursor.ch) === eoc) {
			this.setCursorToNextRow(editor, cellIndex);
			this.applyRowCrossGoalColumn(editor, pixelGoal);
			return;
		}

		// Not on the last sub-line (inner doc has more lines below) → goDown navigates
		// within the cell.  No post-check needed — we never exit the row here.
		const inner = editor.activeCM;
		if (inner && inner !== editor.cm) {
			const head = inner.state.selection.main.head;
			const subLine = inner.state.doc.lineAt(head);

			// At VL wrap-point edges, assoc may misidentify which VL the cursor is on,
			// causing goDown to skip an extra visual line. Fix assoc before any goDown:
			//   left edge  → assoc=1  (start of this VL, not end of the line above)
			//   right edge → assoc=-1 (end of this VL, not start of the line below)
			const currentAssoc = inner.state.selection.main.assoc;
			const coords = inner.coordsAtPos(head);
			// Fix only when assoc >= 0 (same rationale as moveCursorUpInTable).
			if (coords && currentAssoc >= 0) {
				const vlStartPos = inner.posAtCoords({ x: 0, y: coords.top + 9 }, false);
				if (vlStartPos !== null && vlStartPos === head) {
					// Carry the live goalColumn through — see moveCursorUpInTable's
					// own identical fix and doc comment for why.
					const goalColumn = inner.state.selection.main.goalColumn;
					inner.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(head, 1, undefined, goalColumn)]) });
				}
			}

			if (subLine.number < inner.state.doc.lines) {
				editor.exec('goDown');
				return;
			}
		}

		// type is 'single' or 'last'.
		// If cursor is already at/past cell content end, we are at VL_N end.
		// goDown from this position is unreliable (no-op in LP even when a row exists
		// below).  Navigate to the next row directly.
		if (cursor.ch >= eoc) {
			this.setCursorToNextRow(editor, cellIndex);
			this.applyRowCrossGoalColumn(editor, pixelGoal);
			return;
		}

		// Determine whether the cursor is already on the last visual line (VL_N).
		// Used below to resolve the VL_N-1 vs VL_N clip ambiguity after goDown:
		//   VL_N-1 clip → goDown moved into VL_N and clipped to eoc → stay in cell.
		//   VL_N   clip → goDown could not move further → exit to next row.
		// Default true: safe fallback to old clip→exit when inner view is unavailable.
		let isOnLastVL = true;
		if (inner && inner !== editor.cm) {
			const head = inner.state.selection.main.head;
			const lastSubLine = inner.state.doc.line(inner.state.doc.lines);
			const contentEnd = lastSubLine.from + lastSubLine.text.trimEnd().length;
			// Use assoc to pick the correct side at wrap points: assoc=-1 means the cursor is
			// visually at the right end of VL_N-1, so coordsAtPos with side=-1 returns VL_N-1
			// coords. Without this, default side=1 returns VL_N coords (= same as contentEnd's
			// VL), causing isOnLastVL to be true even when we are still on VL_N-1.
			const assoc = inner.state.selection.main.assoc;
			const headCoords = inner.coordsAtPos(head, assoc < 0 ? -1 : 1);
			const endCoords  = inner.coordsAtPos(contentEnd);
			if (headCoords && endCoords) {
				// 4 px: same-VL diff is always 0.0; adjacent-VL diff is ≥ line-height (~18 px).
				isOnLastVL = Math.abs(headCoords.top - endCoords.top) < 4;
			}
		}

		// Native goDown's own standard behavior, independent of this plugin
		// entirely, is "an active selection collapses in place on this press
		// without also moving" (confirmed live: identical with this plugin
		// disabled entirely — Cmd-X, Cmd-Z, then a bare physical Down arrow).
		// So a no-op `ch` reading right after goDown below can mean either
		// "genuinely nothing below" or "a selection — e.g. one an Undo just
		// restored — simply collapsed in place," and those must not be
		// treated the same way. Captured as plain from/to, not an inner-view
		// check, matching every other in-cell selection read in this file
		// (e.g. getValidatedRegionText) — editor.getCursor('from'/'to')
		// already proxies to whichever view is active.
		const hadSelectionBeforeGoDown = (() => {
			const from = editor.getCursor('from');
			const to = editor.getCursor('to');
			return from.line !== to.line || from.ch !== to.ch;
		})();

		// Call goDown once and inspect where the cursor lands.
		editor.exec('goDown');
		const after = editor.getCursor();

		if (after.line !== cursor.line) {
			// Exited to a different logical line.
			const afterText = editor.getLine(after.line);
			const isDelim = this.TABLE_DELIMITER_REGEX.test(afterText);
			if (isDelim) {
				this.setCursorToNextRow(editor, cellIndex);
				this.applyRowCrossGoalColumn(editor, pixelGoal);
			}
			return;
		}

		if (after.ch === cursor.ch) {
			if (hadSelectionBeforeGoDown) {
				// Just collapsed the selection in place — stay in the cell,
				// matching native convention (collapse-only, no move, on
				// this press) rather than reading "no visible movement" as
				// "nothing below."
				return;
			}
			// Complete no-op: nothing below (file-end).
			this.setCursorToNextRow(editor, cellIndex);
			this.applyRowCrossGoalColumn(editor, pixelGoal);
			return;
		}

		const eocAfter = getEndOfCellContent(line, after.ch);
		if (after.ch >= eocAfter) {
			if (isOnLastVL) {
				// Was already on VL_N: goDown clipped in place → exit to next row.
				this.setCursorToNextRow(editor, cellIndex);
				this.applyRowCrossGoalColumn(editor, pixelGoal);
			}
			// Was on VL_N-1: goDown moved to VL_N and clipped to eoc → VL advance, stay.
			return;
		}

		// ch moved within cell: soft-wrap VL advance.
	}


	// Handles goDown when the cursor is on the line directly above a table in Live Preview mode.
	//
	// Always lands in the leftmost cell (cellIndex 0) — confirmed live
	// (2026-08-27/28) that the outer CM6 view has no per-character position
	// info for an unfocused table row (fully replaced by the Live Preview
	// table widget: posAtCoords at varying x all resolved to the identical
	// offset), so there's no way to tell which cell a column falls under
	// before landing in one — same as Vim's own gj/gk table entry
	// (scheduleDisplayLineEntry), which has the identical restriction for
	// the identical reason. Once landed, though, the column *within* that
	// cell is preserved via applyRowCrossGoalColumn's own pixelGoal
	// threading, refined against the now-mounted, now-real inner view —
	// mirroring gj/gk's own "rough landing, then refine" two-step shape.
	private moveCursorDownIntoTable(editor: Editor) {
		const cursor = editor.getCursor();
		// Captured before crossing, while editor.activeCM is still the outer
		// (plain-text) view.
		const pixelGoal = this.computeRowCrossPixelGoal(editor);
		const targetCh = getChByCellIndex(editor.getLine(cursor.line + 1), 0);
		editor.setCursor({ line: cursor.line + 1, ch: targetCh });
		this.applyRowCrossGoalColumn(editor, pixelGoal);
	}


	//===========================================================================
	// Shared table actions
	//===========================================================================

	// move to Left cell / Right edge
	//	(a)->(A) : same row
	//	(b)->(B) : if leftmost cell, move to upper row & rightmost cell
	//	(c)->(C) : if left edge of 1st row, leftmost column, exit table above
	// shared by moveCursorHome (Ctrl-A) and moveCursorLeft (Ctrl-B)
	//
	//  cellIndex=0          1           lastCellIndex
	// (C)
	// +--------------+-------------+---+--------------+
	// |(c)Header     | Header      |...|              |
	// +--------------+-------------+---+--------------+
	// | some text in |(a)some text |...| some text in |
	// | the cell(A)  | in the cell |   | the cell(B)  |
	// +--------------+-------------+---+--------------+
	// |(b)some text  |             |...|              |
	// | in the cell  |             |   |              |
	// +--------------+-------------+---+--------------+
	private moveToLeftCellEnd(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = getCellIndex(line, cursor.ch);

		if (cellIndex > 0) {
			// Same row: move to left cell's end
			const targetCh = getEndOfCellContentByCellIndex(line, cellIndex - 1);
			if (targetCh !== -1) {
				this.setCursorViaCm(editor, cursor.line, targetCh);
			}
			return;
		}

		// Leftmost cell: stop here when row wrapping is disabled
		if (!this.settings.crossRowNavigation) return;

		// Leftmost cell: go to previous row
		const targetLine = this.getPrevRowLine(editor);
		if (targetLine === -1) {
			// Header row: go outside table. (c)->(C)
			if (cursor.line > 0) {
				this.setCursorViaCm(editor, cursor.line - 1, 0);
			}
			return;
		}
		// Previous row: rightmost cell end
		const targetLineText = editor.getLine(targetLine);
		const rightmostIndex = getRightmostCellIndex(targetLineText);
		const targetCh = getEndOfCellContentByCellIndex(targetLineText, rightmostIndex);
		if (targetCh !== -1) {
			this.setCursorViaCm(editor, targetLine, targetCh);
		}
	}


	// move to Right cell / Left edge
	//	(a)->(A) : same row
	//	(b)->(B) : if rightmost cell, move to lower row & leftmost cell
	//	(c)->(C) : if right edge of bottom row, rightmost column, exit table below
	// shared by moveCursorEnd (Ctrl-E) and moveCursorRight (Ctrl-F)
	//
	//  cellIndex=0      lastCellIndex-1  lastCellIndex
	// +-------------+---+---------------+---------------+
	// |             |...| some text in |(A)some text in |
	// |             |   | the cell(a)  | the cell(b)    |
	// +-------------+---+--------------+----------------+
	// |(B)some text |...|              | some text in   |
	// | in the cell |   |              | the cell(c)    |
	// +-------------+----+-------------+----------------+
	// (C)
	private moveToRightCellStart(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = getCellIndex(line, cursor.ch);
		const lastCellIndex = getRightmostCellIndex(line);

		if (cellIndex < lastCellIndex) {
			// Same row: move to right cell's start
			const targetCh = getChByCellIndex(line, cellIndex + 1);
			if (targetCh !== -1) {
				this.setCursorViaCm(editor, cursor.line, targetCh);
			}
			return;
		}

		// Rightmost cell: stop here when row wrapping is disabled
		if (!this.settings.crossRowNavigation) return;

		// Rightmost cell: go to next row
		const targetLine = this.getNextRowLine(editor);
		if (targetLine === -1) {
			// Last row: go outside table (c)->(C), skipping any remaining table rows (e.g. delimiter).
			let exitLine = cursor.line + 1;
			while (exitLine < editor.lineCount() && this.isPositionInTable(editor, exitLine, 1, true)) {
				exitLine++;
			}
			if (exitLine >= editor.lineCount()) {
				editor.replaceRange('\n', { line: exitLine - 1, ch: editor.getLine(exitLine - 1).length });
			}
			this.setCursorViaCm(editor, exitLine, 0);
			return;
		}
		// Next row: leftmost cell start
		const targetCh = getChByCellIndex(editor.getLine(targetLine), 0);
		if (targetCh !== -1) {
			this.setCursorViaCm(editor, targetLine, targetCh);
		}
	}


	//===========================================================================
	// Ctrl-B/F — cell boundary helpers — Source Mode
	//===========================================================================

	private moveToLeftCellEndSourceMode(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = getCellIndex(line, cursor.ch);

		if (cellIndex > 0) {
			const targetCh = getEndOfCellContentByCellIndex(line, cellIndex - 1);
			if (targetCh !== -1) {
				editor.setCursor({ line: cursor.line, ch: targetCh });
			}
			return;
		}

		if (!this.settings.crossRowNavigation) return;

		const targetLine = this.getPrevRowLineSourceMode(editor);
		if (targetLine === -1) {
			if (cursor.line > 0) {
				editor.setCursor({ line: cursor.line - 1, ch: 0 });
			}
			return;
		}
		const targetLineText = editor.getLine(targetLine);
		const rightmostIndex = getRightmostCellIndex(targetLineText);
		const targetCh = getEndOfCellContentByCellIndex(targetLineText, rightmostIndex);
		if (targetCh !== -1) {
			editor.setCursor({ line: targetLine, ch: targetCh });
		}
	}


	private moveToRightCellStartSourceMode(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const cellIndex = getCellIndex(line, cursor.ch);
		const lastCellIndex = getRightmostCellIndex(line);

		if (cellIndex < lastCellIndex) {
			const targetCh = getChByCellIndex(line, cellIndex + 1);
			if (targetCh !== -1) {
				editor.setCursor({ line: cursor.line, ch: targetCh });
			}
			return;
		}

		if (!this.settings.crossRowNavigation) return;

		const targetLine = this.getNextRowLineSourceMode(editor);
		if (targetLine === -1) {
			let exitLine = cursor.line + 1;
			while (exitLine < editor.lineCount() && this.isTableLineSourceMode(editor.getLine(exitLine))) {
				exitLine++;
			}
			if (exitLine >= editor.lineCount()) {
				editor.replaceRange('\n', { line: exitLine - 1, ch: editor.getLine(exitLine - 1).length });
			}
			editor.setCursor({ line: exitLine, ch: 0 });
			return;
		}
		const targetCh = getChByCellIndex(editor.getLine(targetLine), 0);
		if (targetCh !== -1) {
			editor.setCursor({ line: targetLine, ch: targetCh });
		}
	}


	//===========================================================================
	// Table row navigation
	//===========================================================================

	// Pure computation: given whether the adjacent line is in the table and its text,
	// returns the target line number for upward navigation.
	// Extracted from getPrevRowLine to allow unit testing of delimiter detection logic.
	private computePrevRowLine(currentLine: number, prevLineInTable: boolean, prevLineText: string): number {
		if (!prevLineInTable) return -1;
		return this.TABLE_DELIMITER_REGEX.test(prevLineText) ? currentLine - 2 : currentLine - 1;
	}


	// Pure computation: given whether adjacent lines are in the table and the next line's text,
	// returns the target line number for downward navigation.
	// Extracted from getNextRowLine to allow unit testing of delimiter detection logic.
	private computeNextRowLine(currentLine: number, nextLineInTable: boolean, nextLineText: string, lineAfterNextInTable: boolean): number {
		if (!nextLineInTable) return -1;
		if (this.TABLE_DELIMITER_REGEX.test(nextLineText)) {
			// Verify cursor.line+2 exists and is actually a data row inside the table.
			// Without this, a header-only table would return a line outside the table.
			if (!lineAfterNextInTable) return -1;
			return currentLine + 2;
		}
		return currentLine + 1;
	}


	// Returns the line number of the previous table data row.
	// Returns -1 when the current row is the header row (caller should go outside the table).
	// fromLine defaults to the live cursor (all existing Ctrl-P callers); Vim's
	// multi-row crossing passes an explicit line to walk multiple rows without
	// moving the real cursor between steps.
	private getPrevRowLine(editor: Editor, fromLine: number = editor.getCursor().line): number {
		// fromLine - 1 doesn't exist when the table's own header row is the
		// document's first line — same bounds guard getPrevRowLineSourceMode
		// already has. Without it, isPositionInTable/getLine(-1) throws
		// ("Invalid line number 0 in N-line document", CM6's own 1-indexed
		// line() call underneath) — a real, reproducible crash pressing k on
		// such a header row.
		if (fromLine <= 0) return -1;
		return this.computePrevRowLine(
			fromLine,
			this.isPositionInTable(editor, fromLine - 1, 1, true),
			editor.getLine(fromLine - 1),
		);
	}


	// Returns the line number of the next table data row.
	// Returns -1 when the current row is the last row (caller should go outside the table).
	// fromLine defaults to the live cursor — see getPrevRowLine's own note.
	private getNextRowLine(editor: Editor, fromLine: number = editor.getCursor().line): number {
		const nextLineExists = fromLine + 1 < editor.lineCount();
		const lineAfterNextInTable = fromLine + 2 < editor.lineCount()
			&& this.isPositionInTable(editor, fromLine + 2, 1, true);
		return this.computeNextRowLine(
			fromLine,
			nextLineExists && this.isPositionInTable(editor, fromLine + 1, 1, true),
			editor.getLine(fromLine + 1),
			lineAfterNextInTable,
		);
	}


	private getPrevRowLineSourceMode(editor: Editor): number {
		const cursor = editor.getCursor();
		if (cursor.line === 0) return -1;
		const prevLineText = editor.getLine(cursor.line - 1);
		return this.computePrevRowLine(
			cursor.line,
			this.isTableLineSourceMode(prevLineText),
			prevLineText,
		);
	}


	private getNextRowLineSourceMode(editor: Editor): number {
		const cursor = editor.getCursor();
		const nextLineExists = cursor.line + 1 < editor.lineCount();
		const nextLineText = nextLineExists ? editor.getLine(cursor.line + 1) : '';
		const lineAfterNextInTable = cursor.line + 2 < editor.lineCount()
			&& this.isTableLineSourceMode(editor.getLine(cursor.line + 2));
		return this.computeNextRowLine(
			cursor.line,
			nextLineExists && this.isTableLineSourceMode(nextLineText),
			nextLineText,
			lineAfterNextInTable,
		);
	}


	// Moves the cursor to the beginning of the specified column in the previous row.
	//
	// (*1)                     <-- BlankLine
	// | header | (*2)header |  <-- HeaderRow
	// | ------ | ---------- |  <-- DelimiterLine
	// | text   | (*3)text   |  <-- FirstDataRow
	// | text   | (*4)text   |
	//
	// (*2)->(*1) if above is outside table (header row), go out.
	// (*3)->(*2) if above is delimiter line, go to cursor.line-2.
	// (*4)->(*3) go to cursor.line-1.
	// fromLine defaults to the live cursor (all existing Ctrl-P callers); Vim's
	// multi-row crossing passes its own walked-to line, since by the time this
	// runs the real cursor hasn't moved yet (see crossTableRowForCell).
	private setCursorToPrevRow(editor: Editor, cellIndex: number, fromLine: number = editor.getCursor().line) {
		const targetLine = this.getPrevRowLine(editor, fromLine);

		if (targetLine === -1) {
			// Header row: go outside table — but only if there's a line above to
			// go to. When the table's own header row is the document's first
			// line, fromLine - 1 doesn't exist; unlike setCursorToNextRow's own
			// "append a blank line at EOF" symmetric fix for the last-row case,
			// there's no equivalent "prepend a line" convention here, so this
			// just stays put (matches real vim: k on the document's first line
			// is a no-op) instead of dispatching to an invalid negative line
			// (previously landed the cursor at an unrelated position).
			if (fromLine > 0) this.setCursorViaCm(editor, fromLine - 1, 0);
			return;
		}
		const targetCh = getChByCellIndex(editor.getLine(targetLine), cellIndex);
		if (targetCh !== -1) {
			this.setCursorViaCm(editor, targetLine, targetCh);
		}
	}


	// Moves the cursor to the beginning of the specified column in the next row.
	//
	// | header | (*1)header |  <-- HeaderRow
	// | ------ | ---------- |  <-- DelimiterLine
	// | text   | (*2)text   |
	// | text   | (*3)text   |
	// (*4)
	//
	// (*1)->(*2) if below is delimiter line, go to cursor.line+2.
	// (*2)->(*3) go to cursor.line+1.
	// (*3)->(*4) go outside table.
	// fromLine defaults to the live cursor — see setCursorToPrevRow's own note.
	private setCursorToNextRow(editor: Editor, cellIndex: number, fromLine: number = editor.getCursor().line) {
		const targetLine = this.getNextRowLine(editor, fromLine);

		if (targetLine === -1) {
			// Last data row: exit below, skipping any remaining table rows (e.g. delimiter).
			let exitLine = fromLine + 1;
			while (exitLine < editor.lineCount() && this.isPositionInTable(editor, exitLine, 1, true)) {
				exitLine++;
			}
			if (exitLine >= editor.lineCount()) {
				editor.replaceRange('\n', { line: exitLine - 1, ch: editor.getLine(exitLine - 1).length });
			}
			this.setCursorViaCm(editor, exitLine, 0);
			return;
		}
		const targetCh = getChByCellIndex(editor.getLine(targetLine), cellIndex);
		if (targetCh !== -1) {
			this.setCursorViaCm(editor, targetLine, targetCh);
		}
	}


	//===========================================================================
	// Ctrl-P/N deeper helpers
	//===========================================================================

	// Called when goUp snapped the cursor to startOfCellContent.
	// Distinguishes VL1-middle (→ go to previous row) from VL2+ left edge (→ stay).
	//
	// Primary: compare y-coordinates via coordsAtPos — no cursor side-effects.
	//   originalHead was on VL2+  →  its y > VL1-start y  →  stay
	//   originalHead was on VL1   →  its y ≈ VL1-start y  →  previous row
	//
	// Fallback: goDown probe using CM6's goal-column memory.
	private handleCellStartSnap(
		editor: Editor,
		originalLine: number,
		originalCh: number,
		cellIndex: number,
		pixelGoal: number | null,
		innerHeadBeforeGoUp?: number,
		resolvedAssocForOriginalHead?: number,
	) {
		const inner = editor.activeCM;
		if (innerHeadBeforeGoUp !== undefined && inner && inner !== editor.cm) {
			const vl1Coords = inner.coordsAtPos(inner.state.selection.main.head);
			// innerHeadBeforeGoUp may sit exactly on a VL wrap boundary (the right
			// edge of VL1 is the same raw offset as the left edge of VL2), so which
			// visual line coordsAtPos reports for it is genuinely ambiguous without
			// a side. This used to hardcode side=-1 ("treat it as VL1's own right
			// edge") to fix a real bug (2026-08-28: an unforced query silently
			// misreported a genuine VL1-right-edge position as VL2, wrongly
			// concluding "already VL2+, stay" for a cursor that should have
			// crossed to the row above). But hardcoding -1 unconditionally
			// re-decides the same ambiguity moveCursorUpInTable's own assoc-fix
			// block already resolved moments earlier for this exact position —
			// and can resolve it the *opposite* way, wrongly concluding "VL1
			// middle, cross rows" for a cursor that was actually a genuine VL2+
			// left edge (confirmed live: a cursor forced to assoc=1/"VL2 start"
			// there, re-queried here with side=-1, read back as VL1's own right
			// edge). Reusing whatever side that block already settled on keeps
			// both cases correct instead of trading one bug for the other.
			const side = resolvedAssocForOriginalHead !== undefined && resolvedAssocForOriginalHead >= 0 ? 1 : -1;
			const originalCoords = inner.coordsAtPos(innerHeadBeforeGoUp, side);
			if (vl1Coords && originalCoords) {
				if (originalCoords.top > vl1Coords.top + 2) {
					// VL2+ left edge: cursor already at VL1 start — nothing to do.
					return;
				}
				// VL1 middle: go to previous row.
				this.setCursorToPrevRow(editor, cellIndex);
				this.placeAtBottomVL(editor, pixelGoal);
				return;
			}
		}

		// Fallback: goDown probe (exploits CM6 goal-column to tell VL1 from VL2+).
		editor.exec('goDown');
		const backTest = editor.getCursor();
		if (backTest.line === originalLine && backTest.ch === originalCh) {
			// VL2+ left edge: undo probe, stay at VL1 start.
			editor.exec('goUp');
		} else {
			// VL1 middle: undo probe, go to previous row.
			editor.exec('goUp');
			this.setCursorToPrevRow(editor, cellIndex);
			this.placeAtBottomVL(editor, pixelGoal);
		}
	}


	// Move to the bottom visual line synchronously if the inner view is already
	// mounted, otherwise defer via scheduleBottomVisualLine. `pixelGoal`
	// (moveCursorUpInTable's row-crossing goal column, or null/omitted for the
	// unrelated moveCursorUpIntoTable caller) is applied right after each of
	// this function's own two completion points, rather than polled
	// independently, so it can't race against them.
	private placeAtBottomVL(editor: Editor, pixelGoal: number | null = null) {
		const inner = editor.activeCM;
		if (inner && inner !== editor.cm) {
			// Check cursor position (not content end) for on-screen detection:
			// when entering a cell from an adjacent row, the cursor start (ch=cellStart)
			// is always on-screen even if the cell content end is off-screen.
			// moveToBottomVisualLineOfCell handles the off-screen content end via goDown fallback.
			if (inner.coordsAtPos(inner.state.selection.main.head)) {
				this.moveToBottomVisualLineOfCell(editor);
				this.applyRowCrossGoalColumnSync(editor, pixelGoal);
				return;
			}
			this.scheduleBottomVisualLine(editor, pixelGoal);
			return;
		}
		// No distinct inner view: the crossing exited the table entirely (not
		// "not yet mounted" — the outer document view is always already
		// mounted). moveToBottomVisualLineOfCell is cell-specific and doesn't
		// apply here; just re-seed the preserved column directly against the
		// now-current outer-view landing (refineDisplayLineColumn's own
		// outer-view branch handles this — see its doc comment).
		this.applyRowCrossGoalColumnSync(editor, pixelGoal);
	}


	// Schedules moveToBottomVisualLineOfCell for the next event loop tick.
	// Used after synchronous cursor placement to let the DOM settle first.
	private scheduleBottomVisualLine(editor: Editor, pixelGoal: number | null = null) {
		if (this._inScrollPage) return;
		setTimeoutOnActiveWindow(() => {
			if (editor.inTableCell) {
				this.moveToBottomVisualLineOfCell(editor);
				this.applyRowCrossGoalColumnSync(editor, pixelGoal);
			}
		}, 0);
	}


	// Move to the bottom visual line of the current table cell.
	// Primary: use coordsAtPos + posAtCoords on the inner EditorView to jump directly.
	// Fallback: goDown loop for cases where the inner view or coordinates are unavailable.
	private moveToBottomVisualLineOfCell(editor: Editor) {
		const cursor = editor.getCursor();
		const startLine = cursor.line;
		const line = editor.getLine(startLine);
		const endOfCellContent = getEndOfCellContent(line, cursor.ch);

		const inner = editor.activeCM;
		if (inner && inner !== editor.cm) {
			const lastSubLine = inner.state.doc.line(inner.state.doc.lines);
			const contentEnd  = lastSubLine.from + lastSubLine.text.trimEnd().length;
			// side=-1: contentEnd may sit exactly on a VL wrap boundary — always
			// resolve it to "the end of the line this position terminates" (the
			// actual bottom visual line), not the line after (which, for the true
			// end of the cell's content, doesn't visually exist).
			const endCoords = inner.coordsAtPos(contentEnd, -1);
			if (endCoords) {
				// x=0 is left of all inner-view content; posAtCoords snaps to the leftmost
				// character on the bottom visual line. y = midpoint of that line (height ≈ 18 px).
				const pos = inner.posAtCoords({ x: 0, y: endCoords.top + 9 }, false);
				if (pos !== null) {
					// assoc=1: pos is a VL-start position by construction (the leftmost
					// character of the bottom visual line) — explicit here defensively,
					// matching the explicit side=-1 above, so this dispatch's own
					// intent doesn't depend on CM6's default resolution at a wrap
					// boundary. Confirmed live (2026-09-19, isolation-tested against
					// this exact line reverted) that this particular dispatch was
					// never actually the cause of any observed bug on its own — the
					// real bug was entirely in applyRowCrossGoalColumnSync, called
					// right after this function returns (from placeAtBottomVL/
					// scheduleBottomVisualLine), which used to unconditionally force
					// assoc=-1 two animation frames later regardless of whether any
					// realignment was actually needed — silently overwriting this
					// dispatch's own assoc, both flickering the caret's first paint
					// and causing a second immediate Cursor UP to overshoot by one
					// extra visual line. Fixed at the source in
					// applyRowCrossGoalColumnSync itself (see its own doc comment).
					inner.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(pos, 1)]) });
					return;
				}
			}
		}

		// Fallback: goDown loop.
		// goRight works around a Live Preview issue where goDown from the leftmost
		// cell position (placed by cm.dispatch) exits the table immediately.
		editor.exec('goRight');
		if (editor.getCursor().line !== startLine) {
			editor.setCursor(cursor);
			return;
		}
		editor.exec('goLeft');

		let lastPos = editor.getCursor();
		let breakReason: 'endOfCell' | 'noMove' | 'exitedLine' = 'noMove';

		while (true) {
			editor.exec('goDown');
			const newPos = editor.getCursor();

			if (newPos.line !== startLine) {
				breakReason = 'exitedLine';
				break;
			}
			if (newPos.ch === lastPos.ch) {
				breakReason = 'noMove';
				break;
			}
			if (newPos.ch >= endOfCellContent) {
				breakReason = 'endOfCell';
				break;
			}

			lastPos = { line: newPos.line, ch: newPos.ch };
		}

		if (breakReason === 'endOfCell') {
			// Move back to lastPos using goLeft while the inner view is still active.
			// Dispatching to the outer CM view (setCursorViaCm) would destroy the inner
			// view, causing native-cursor to lose coordsAtPos and drop the cursor display.
			let pos = editor.getCursor();
			for (let step = 0; step < 64 && pos.ch > lastPos.ch; step++) {
				editor.exec('goLeft');
				const newP = editor.getCursor();
				if (newP.ch >= pos.ch) break;
				pos = newP;
			}
			return;
		}

		if (breakReason === 'exitedLine') {
			editor.exec('goUp');
		}
	}


	// Reads the pixel-x "goal column" to preserve across a table row-crossing
	// (or table entry from plain text), straight off CM6's own native
	// SelectionRange.goalColumn — the same field @codemirror/commands'
	// cursorLineUp/cursorLineDown maintain, which is why intra-cell goUp/
	// goDown already preserve column "for free" (see handleCellStartSnap's
	// own "CM6 goal-column memory" comment). No new plugin-owned tracking:
	// typing/clicking dispatch a fresh selection with no goalColumn set, so a
	// later read here naturally falls back to the live coordsAtPos position —
	// the same reset-for-free behavior real Vim/Emacs curswant semantics
	// need. Must be called BEFORE the crossing happens, while the source view
	// (an inner cell view, or the outer plain-text view when entering a
	// table fresh — see moveCursorUpIntoTable/moveCursorDownIntoTable) is
	// still the active one. editor.activeCM already resolves to whichever of
	// those is current, so no inner-vs-outer branching is needed here.
	private computeRowCrossPixelGoal(editor: Editor): number | null {
		const view = editor.activeCM;
		const goalColumn = view.state.selection.main.goalColumn;
		const rect = view.contentDOM.getBoundingClientRect();
		if (goalColumn !== undefined) return rect.left + goalColumn;
		// side=-1: head may sit exactly on a visual-line wrap boundary (e.g.
		// right after a trailing space that wraps) — without it, CM6 defaults
		// to reporting the *next* visual line's start (x = rect.left) instead
		// of the true end of the line the cursor is visually on.
		const coords = view.coordsAtPos(view.state.selection.main.head, -1);
		return coords ? coords.left : null;
	}

	// Re-seeds the destination cell's own inner view with the preserved goal
	// column, once the row-crossing has already landed. Reuses
	// refineDisplayLineColumn (vim-mode gj/gk's own step-2 primitive)
	// unmodified for the horizontal correction itself, then re-reads
	// editor.activeCM afterward — refineDisplayLineColumn dispatches via
	// setCursorViaCm, which can trigger Obsidian's own inner-view (re)focus —
	// and writes goalColumn onto that settled view's own selection, same
	// same-position-dispatch-for-metadata idiom the assoc-fix blocks in
	// moveCursorUpInTable/moveCursorDownInTable already use. Assumes the
	// destination inner view is already mounted; callers that aren't sure
	// (moveCursorDownInTable has no existing placement step to piggyback on)
	// go through applyRowCrossGoalColumn instead. No-op if there's no goal to
	// preserve. Re-seeds onto editor.activeCM — the inner cell view, or the
	// outer document view if the crossing exited the table entirely — since
	// goalColumn still matters in plain text: without writing it here, a
	// landing on a blank line (content-less, so refineDisplayLineColumn can
	// only place the cursor at ch 0) would otherwise leave nothing for a
	// later native goDown/goUp to inherit, silently forgetting the preserved
	// column the moment the crossing passes through any zero-width line.
	//
	// The actual correction is deferred two animation frames past whatever
	// tick this is called on. Confirmed live (2026-08-28, via a dedicated
	// frame-by-frame diagnostic, not guessed) that entering a table cell from
	// plain text triggers an Obsidian-internal cell-focus reconciliation that
	// silently resets the cursor back to that cell's own line-start,
	// asynchronously, one animation frame after the frame this function's
	// own (otherwise-correct) dispatches land on — i.e. calling this
	// synchronously wins the position for exactly one frame and then loses
	// it to that reset. Landed empirically on two frames of deferral (the
	// reset was fully settled by the second frame in every observed run);
	// there is no public Obsidian API to await that reconciliation directly.
	private applyRowCrossGoalColumnSync(editor: Editor, pixelGoal: number | null) {
		if (pixelGoal === null) return;
		requestAnimationFrameOnActiveWindow(() => {
			requestAnimationFrameOnActiveWindow(() => {
				const viewBeforeRefine = editor.activeCM;
				const headBeforeRefine = viewBeforeRefine.state.selection.main.head;
				const assocBeforeRefine = viewBeforeRefine.state.selection.main.assoc;
				this.refineDisplayLineColumn(editor, pixelGoal, true);
				const view = editor.activeCM;
				const head = view.state.selection.main.head;
				const rect = view.contentDOM.getBoundingClientRect();
				// assoc: head may sit exactly on a visual-line wrap boundary, so
				// whether it should render as "this line's own right edge" or
				// "the next line's own left edge" is genuinely ambiguous without
				// checking. Originally hardcoded to -1 unconditionally (2026-08-28
				// fix: reusing whatever assoc the selection already carried
				// defaulted to rendering a same-cell row-crossing's clamped
				// landing as the destination's *second* visual line's left edge
				// instead of its first (intended) visual line's right edge).
				//
				// But a hardcoded -1 is wrong whenever refineDisplayLineColumn
				// didn't actually need to move/clamp anything — e.g.
				// moveToBottomVisualLineOfCell's own VL_n-start landing, called
				// right before this in placeAtBottomVL/scheduleBottomVisualLine,
				// where pixelGoal already matches (or falls short of) that
				// landing's own position: forcing -1 there relabels a genuine
				// VL_n-start as the line ABOVE's own right edge instead, silently
				// undoing that landing's own assoc=1 two frames later (confirmed
				// live 2026-09-19: caused a second immediate Cursor UP to
				// overshoot by one extra visual line). A pure geometric check
				// ("is head a line-start") can't tell these two cases apart
				// either — at a wrap boundary, "this line's own start" and "the
				// line above's own end" describe the identical offset, so that
				// check is true for both regardless of which one is intended.
				//
				// The signal that actually distinguishes them: did this call's
				// own refinement move the position at all, AND are we still
				// inside a genuine table-cell inner view (moveToBottomVisualLineOfCell
				// never runs against the outer, plain-text view, so an
				// unchanged head there can't be one of its deliberate
				// landings — e.g. a blank/short exit line where there's
				// nothing to clamp to; that case must still force -1, same as
				// before). If head is unchanged from before refineDisplayLineColumn
				// ran AND we're still in a distinct inner view, no clamping
				// happened — whatever assoc was already there (e.g.
				// moveToBottomVisualLineOfCell's own 1) was already correct for
				// it and must be preserved, not re-decided. Otherwise the
				// original -1 rule applies (confirmed live 2026-09-19: still
				// correct for the clamped-to-a-wrap-boundary case).
				const stillInDistinctInnerView = view !== editor.cm;
				const assoc = (stillInDistinctInnerView && head === headBeforeRefine) ? assocBeforeRefine : -1;
				view.dispatch({
					selection: EditorSelection.create([
						EditorSelection.cursor(head, assoc, undefined, pixelGoal - rect.left),
					]),
				});
			});
		});
	}

	// Sync-or-deferred wrapper for moveCursorDownInTable's row-crossings,
	// mirroring scheduleBottomVisualLine's own "mounted? apply now : defer one
	// tick" idiom (moveCursorUpInTable's own crossings instead piggyback on
	// placeAtBottomVL's existing split — see its own call sites below).
	private applyRowCrossGoalColumn(editor: Editor, pixelGoal: number | null) {
		if (pixelGoal === null) return;
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) {
			// Exited the table entirely — the outer document view is always
			// already mounted (no "not yet mounted" concern like a fresh
			// inner cell view), so this applies immediately, no defer needed.
			this.applyRowCrossGoalColumnSync(editor, pixelGoal);
			return;
		}
		if (inner.coordsAtPos(inner.state.selection.main.head)) {
			this.applyRowCrossGoalColumnSync(editor, pixelGoal);
			return;
		}
		if (this._inScrollPage) return;
		setTimeoutOnActiveWindow(() => {
			if (editor.inTableCell) {
				this.applyRowCrossGoalColumnSync(editor, pixelGoal);
			}
		}, 0);
	}


	//===========================================================================
	// Infrastructure
	//===========================================================================

	private isPositionInTable(editor: Editor, line: number, ch: number, alreadyInTable = false): boolean {
		// A leading `|` isn't required — GFM tables may omit both edge pipes
		// (see table-cell-utils.ts's own getCellBoundaries) — so this cheap
		// fast-path (callers already know we're walking line-by-line from a
		// confirmed table context, just need to tell "still in it" from
		// "walked off the end") checks for any real separator pipe instead.
		// A genuinely table-less line never has one (ignoring the degenerate,
		// unparseable 1-cell/both-edges-omitted row, which isn't recognizable
		// as a table at all to begin with).
		if (alreadyInTable) return getPipePositions(editor.getLine(line)).length > 0;
		const cm = editor.cm;
		if (!cm) return false;

		const posObj = (line !== undefined && ch !== undefined)
			? { line, ch }
			: editor.getCursor();
		const pos = editor.posToOffset(posObj);

		const tree = syntaxTree(cm.state);

		let node = tree.resolveInner(pos, -1);
		while (node) {
			if (node.name.includes('Table') || node.name.includes('table')) {
				return true;
			}
			node = node.parent!;
		}

		return false;
	}


	// Returns true if the given line is part of a blockquote or callout block,
	// including lazy continuation lines (HyperMD-quote-lazy).
	private isLineInQuote(editor: Editor, line: number): boolean {
		const cm = editor.cm;
		if (!cm) return false;

		const lineText = editor.getLine(line);
		const pos = editor.posToOffset({ line, ch: lineText.length });

		let node = syntaxTree(cm.state).resolveInner(pos, -1);
		while (node) {
			if (node.name.includes('HyperMD-quote')) return true;
			node = node.parent!;
		}
		return false;
	}


	// Scroll the view so the cursor appears at targetScreenY pixels from the top of the
	// scroll area. Works for both regular text and LP table cells: uses getCursorScreenY()
	// (window.getSelection) rather than cm.state.selection.main.head, so the result is
	// correct even when the outer CM head points to the row start (VL1) instead of the
	// actual inner cursor position in a wrapped cell.
	private scrollToCursorAtY(editor: Editor, targetScreenY: number) {
		const cm = editor.cm;
		if (!cm) return;
		const cursorTop = this.getCursorScreenY(cm);
		if (cursorTop === null) return;
		const scrollRect = cm.scrollDOM.getBoundingClientRect();
		const docY = cursorTop - scrollRect.top + cm.scrollDOM.scrollTop;
		cm.scrollDOM.scrollTop = Math.max(0, docY - targetScreenY);
	}

	// Use cm.dispatch directly to avoid triggering Obsidian's table editor
	// interference that occurs when moving the cursor within a Live Preview table.
	private recenter(editor: Editor) {
		const cm = editor.cm;
		if (!cm) return;
		this.scrollToCursorAtY(editor, cm.scrollDOM.clientHeight / 2);
	}

	// Cycles center → top → bottom on successive presses; resets on any other action.
	private recenterTopBottom(editor: Editor) {
		const cm = editor.cm;
		if (!cm) return;
		const h      = cm.scrollDOM.clientHeight;
		const margin = this.RECENTER_TOP_BOTTOM_MARGIN_LINES * cm.defaultLineHeight;

		const targetY = this._recenterStep === 0 ? h / 2
		              : this._recenterStep === 1 ? margin
		              :                            h - margin - cm.defaultLineHeight;

		this.scrollToCursorAtY(editor, targetY);
		this._recenterStep = (this._recenterStep + 1) % 3;
	}

	// Ctrl-L (recenter/recenter-top-bottom) in a Bases table view's own
	// cell-selection mode, matching the note body's own convention. Not
	// a "delegate to native key" dispatch like cursor-up/down/left/right
	// above — Bases has no native equivalent for Ctrl-L at all, so this
	// is a genuinely new implementation, confirmed live before writing
	// it (same discipline as every other Bases investigation this
	// session): `.bases-table-container` (the element that stays
	// focused throughout cell-selection mode, see
	// BASES_TABLE_CONTAINER_SELECTOR's own comment) is NOT itself the
	// scrollable element — its own scrollHeight/clientHeight are always
	// equal — the real scrollable ancestor is its own parent,
	// `.bases-view` (confirmed via a live ancestor-chain walk: the only
	// element with `overflow: auto` and `scrollHeight > clientHeight`).
	// The currently-selected cell is found via `.bases-table-active-cell`,
	// present directly in the DOM at all times (no need to press Enter
	// to detect it, unlike how this was first investigated).
	//
	// The scroll-to-Y formula is `scrollTop + (rect.top - scrollRect.top) -
	// targetY` — the same shape as this.scrollToCursorAtY's own `docY`-
	// based version above. An earlier draft dropped the `- scrollRect.top`
	// term, reasoning it canceled out algebraically — that only held in
	// the E2E smoke vault, where `.bases-view` happened to sit at page
	// y=0 (a single, unsplit leaf with no tab bar above it), making
	// `scrollRect.top` ~0 there by coincidence. In a real vault with a
	// tab bar/split layout above the table, `scrollRect.top` is nonzero,
	// and dropping the term made every target land `scrollRect.top`
	// pixels too high on screen — "top" went clear behind the sticky
	// header, "bottom" stopped short with visible slack beneath it.
	// Confirmed live via a diagnostic that forced a nonzero
	// `scrollRect.top` (splitting a markdown leaf above the Bases leaf):
	// the drift matched `-scrollRect.top` pixel-for-pixel. `targetY`
	// itself stays in `.bases-view`-local coordinates (0 at its own top
	// edge) — `.bases-thead` is `position: sticky`, permanently
	// occupying the TOP of its viewport regardless of scroll position —
	// confirmed live this needs to be subtracted from the available
	// height for "center" and added as a floor for "top," or the row
	// lands exactly one header's-height too high; "bottom" needs no such
	// adjustment, since the sticky header never affects the viewport's
	// own bottom edge.
	private recenterBasesScrollTo(container: HTMLElement, targetY: number) {
		const scrollEl = container.closest('.bases-view') as HTMLElement | null;
		const cellEl = container.querySelector('.bases-table-active-cell') as HTMLElement | null;
		if (!scrollEl || !cellEl) return;
		const rect = cellEl.getBoundingClientRect();
		const scrollRect = scrollEl.getBoundingClientRect();
		scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + (rect.top - scrollRect.top) - targetY);
	}

	private getBasesHeaderHeight(scrollEl: HTMLElement): number {
		const headerEl = scrollEl.querySelector('.bases-thead') as HTMLElement | null;
		return headerEl?.getBoundingClientRect().height ?? 0;
	}

	private recenterBases(container: HTMLElement) {
		const scrollEl = container.closest('.bases-view') as HTMLElement | null;
		if (!scrollEl) return;
		const headerHeight = this.getBasesHeaderHeight(scrollEl);
		this.recenterBasesScrollTo(container, headerHeight + (scrollEl.clientHeight - headerHeight) / 2);
	}

	// Ctrl-L (recenter/recenter-top-bottom), broadened from Bases-only to
	// the rest of the Properties panel -- confirmed live via a DOM dump
	// (not assumed) that `.metadata-container` sits INSIDE the SAME
	// `.cm-scroller` the note body itself scrolls through (scrolling far
	// down in the body scrolls the Properties panel out of view right
	// along with it), unlike Bases' own separate `.bases-view` scroller.
	// So the exact same scroll primitive this.scrollToCursorAtY uses for
	// the body's own cursor applies here unchanged -- just targeting the
	// currently-focused property element's own `getBoundingClientRect()`
	// instead of the CM6 cursor's screen position. Reuses the active
	// MarkdownView's own `editor.cm` purely as a handle on the shared
	// `scrollDOM`/`defaultLineHeight` -- never touches its own cursor or
	// selection, since nothing here is a CM6-driven position.
	private recenterPropertyPanel(el: HTMLElement) {
		if (el.matches(BASES_TABLE_CONTAINER_SELECTOR)) { this.recenterBases(el); return; }
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = view?.editor.cm;
		if (!cm) return;
		this.scrollElementToY(cm, el, cm.scrollDOM.clientHeight / 2);
	}

	// Cycles center → top → bottom on successive presses, sharing the
	// SAME `_recenterStep` state as the note body's own recenterTopBottom
	// and Bases' own recenterTopBottomBases -- a user is only ever in one
	// context at a time, so one shared counter behaves the same as a
	// separate per-context one would, with less code (same reasoning
	// recenterTopBottomBases's own comment already gives for sharing with
	// the body).
	//
	// Reuses RECENTER_TOP_BOTTOM_MARGIN_LINES directly rather than a
	// third, Bases-style separate margin constant -- confirmed live a
	// property row's own height (29px) is close enough to
	// cm.defaultLineHeight (24px) that a dedicated constant isn't
	// warranted the way Bases' own MUCH taller table rows needed one.
	private recenterTopBottomPropertyPanel(el: HTMLElement) {
		if (el.matches(BASES_TABLE_CONTAINER_SELECTOR)) { this.recenterTopBottomBases(el); return; }
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = view?.editor.cm;
		if (!cm) return;
		const h = cm.scrollDOM.clientHeight;
		const margin = this.RECENTER_TOP_BOTTOM_MARGIN_LINES * cm.defaultLineHeight;
		const targetY = this._recenterStep === 0 ? h / 2
		              : this._recenterStep === 1 ? margin
		              :                            h - margin - cm.defaultLineHeight;
		this.scrollElementToY(cm, el, targetY);
		this._recenterStep = (this._recenterStep + 1) % 3;
	}

	// Shared scroll-to-Y primitive, same formula as this.scrollToCursorAtY
	// (docY = el's own screen top, converted to scrollDOM-local
	// coordinates by adding back the current scrollTop and subtracting
	// the scroller's own page-relative top) but parametrized on an
	// arbitrary element's rect instead of the CM6 cursor's screen
	// position -- the body's own cursor-based version is kept separate
	// rather than unified with this one, since getCursorScreenY's own
	// popout/table-cell fallback logic has nothing in common with a
	// plain element rect lookup.
	private scrollElementToY(cm: EditorView, el: HTMLElement, targetScreenY: number) {
		const rect = el.getBoundingClientRect();
		const scrollRect = cm.scrollDOM.getBoundingClientRect();
		const docY = rect.top - scrollRect.top + cm.scrollDOM.scrollTop;
		cm.scrollDOM.scrollTop = Math.max(0, docY - targetScreenY);
	}

	// Cycles center → top → bottom on successive presses, same
	// `_recenterStep` state the note body's own recenterTopBottom
	// shares — a user is only ever in one context (body or Bases) at a
	// time, so sharing this one counter is simpler than a second,
	// parallel one and behaves the same either way.
	//
	// rowHeight uses the active CELL's own getBoundingClientRect().height
	// directly, not a `.bases-tr` ancestor lookup -- confirmed live that
	// `.bases-table-active-cell` has no `.bases-tr` ancestor at all in
	// this Obsidian version's own Bases DOM (`.bases-tbody` contains
	// `.bases-td` cells directly; `.bases-tr` exists elsewhere in the DOM,
	// used for click-targeting in E2E specs, but isn't a parent of the
	// cells themselves). An earlier draft's `.closest('.bases-tr')` always
	// silently returned null and fell back to a hardcoded 30, which
	// happened to be close enough to the real ~28px row height to look
	// right in casual testing.
	private recenterTopBottomBases(container: HTMLElement) {
		const scrollEl = container.closest('.bases-view') as HTMLElement | null;
		const cellEl = container.querySelector('.bases-table-active-cell') as HTMLElement | null;
		if (!scrollEl || !cellEl) return;
		const h = scrollEl.clientHeight;
		const headerHeight = this.getBasesHeaderHeight(scrollEl);
		const rowHeight = cellEl.getBoundingClientRect().height || 30;
		// A separate, smaller margin than the note body's own
		// RECENTER_TOP_BOTTOM_MARGIN_LINES -- a table row is a much taller
		// unit than a text line, so reusing the same line-count directly
		// against rowHeight (2 full ROWS of margin) read as excessive.
		const margin = this.RECENTER_TOP_BOTTOM_MARGIN_ROWS_BASES * rowHeight;

		const step = this._recenterStep;
		const targetY = step === 0 ? headerHeight + (h - headerHeight) / 2
		              : step === 1 ? headerHeight + margin
		              :              h - margin - rowHeight;

		this.recenterBasesScrollTo(container, targetY);
		this._recenterStep = (step + 1) % 3;
	}


	//===========================================================================
	// Page down / Page up
	//===========================================================================

	private pageDown(editor: Editor) {
		if (this.markActive) { this.extendMarkPage(editor, true); return; }
		this.scrollPage(editor, 1);
	}
	private pageUp(editor: Editor) {
		if (this.markActive) { this.extendMarkPage(editor, false); return; }
		this.scrollPage(editor, -1);
	}

	// Page Up/Down (Set-mark candidate): rather than reimplementing
	// scrollPage's own pixel-measurement/table-callout-embed-aware
	// step logic (real coordinate reads against the actually-rendered
	// page, not something crunchable as a pure function), this computes
	// the real target by temporarily disabling the mark and letting
	// scrollPage run its own already-proven PLAIN-cursor logic
	// unchanged, then reads back wherever the plain cursor actually
	// landed once it's genuinely settled (scrollPage's own onSettled
	// hook — reading any earlier risks Obsidian's own LP normalizer
	// still being mid-correction). The real extend is applied as a
	// separate, final dispatch on top of that reading, matching every
	// other extendMark* command's own "this plugin's own dispatch,
	// never scrollPage's internal ones" convention.
	//
	// Anchor: unchanged if starting outside a table. If starting inside
	// one, snapped to that table's own edge BEHIND the extend direction
	// (findTableOwnEdge, same convention as extendMarkBufferEdge) so the
	// whole table you started in is swept into the selection as one
	// block, not just the exact cell Set-mark happened to be pressed in
	// — confirmed by the user this is required, not optional.
	//
	// Head: if the plain landing settles outside any table, used as-is.
	// If it settles inside one, snapped to that table's own edge AHEAD
	// of the extend direction (the one actually being passed through) —
	// same "whole table, atomic" policy, now applied to the landing
	// side instead of the starting side — which means exiting that cell
	// via exitCellWithSelection rather than ending with DOM focus parked
	// inside it.
	//
	// Multi-cursor is deliberately out of scope here, same simplification
	// extendMarkBufferEdge's own in-cell branch already makes: only
	// cm.state.selection.main is read/written throughout. The user's own
	// ruling (2026-10-17): multi-cursor + Set-mark + table-crossing
	// Page Up/Down is a separate, accepted limitation, not blocking this.
	private extendMarkPage(editor: Editor, forward: boolean) {
		const cm = editor.cm;
		const inner = editor.activeCM;
		const startedInCell = !!(editor.inTableCell && inner && inner !== cm);

		const anchor = startedInCell
			? editor.posToOffset(this.findTableOwnEdge(editor, editor.getCursor().line, !forward))
			: cm.state.selection.main.anchor;

		const wasActive = this.markActive;
		this.markActive = false;
		// scrollPage's plain-cursor commands (CM6's own cursorPageUp/Down in
		// the fast path, this plugin's moveCursorUp/Down -> goUp/goDown in
		// the slow path) all special-case a non-empty range by collapsing
		// to its near edge instead of actually paging — confirmed by
		// reading @codemirror/commands' cursorByPage directly. Toggling
		// markActive alone doesn't touch the real CM6 selection, so without
		// this collapse, scrollPage never sees a plain cursor and the whole
		// page-move silently degenerates into a same-page edge collapse.
		this.collapseActiveSelectionToHead(editor);
		this.scrollPage(editor, forward ? 1 : -1, () => {
			this.markActive = wasActive;

			const landedInner = editor.activeCM;
			const landedInCell = !!(editor.inTableCell && landedInner && landedInner !== editor.cm);
			if (!landedInCell) {
				const head = editor.cm.state.selection.main.head;
				editor.cm.dispatch({ selection: { anchor, head }, userEvent: 'select.uch', scrollIntoView: true });
				return;
			}

			const landedLine = editor.getCursor().line;
			const farEdge = this.findTableOwnEdge(editor, landedLine, forward);
			const head = editor.posToOffset(farEdge);
			this.exitCellWithSelection(editor, farEdge.line, forward, anchor, head);
		});
	}

	// Returns the viewport-relative Y coordinate of the current browser cursor.
	// Works inside LP table cells (unlike cm.coordsAtPos). Returns null when off-screen.
	// view: when provided, used as a precise fallback via coordsAtPos when the selection
	// rect has zero height (e.g. cursor at ch=0 of the first line).
	private getCursorScreenY(view?: EditorView): number | null {
		// In a popout window, the native DOM Selection can lag several
		// frames behind CM6's own state while stepping across a table's
		// inner-view boundaries (Obsidian recreates that DOM async) — its
		// rect stays non-zero-height but frozen at a stale position for many
		// calls in a row, then jumps once it finally catches up. coordsAtPos
		// reads CM6's own layout directly and doesn't have this lag, so
		// prefer it whenever we're actually in a popout (activeWindow !==
		// window); the main window's own existing DOM-Selection-first
		// behavior is left untouched since it isn't affected by this and is
		// already known-working there.
		if (view && activeWindow !== window) {
			const coords = view.coordsAtPos(view.state.selection.main.head);
			if (coords) return coords.top;
		}
		const sel = activeWindow.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.focusNode) return null;
		// Collapse to the focus (head/cursor) end specifically — sel.getRangeAt(0)'s
		// own getBoundingClientRect() returns the UNION box of the whole anchor..head
		// span whenever a real (non-empty) selection is active (e.g. Set-mark), not
		// the caret/head's own position. Confirmed live 2026-10-22: with Set-mark
		// active and the selection extended downward, Recenter centered on the mark
		// (anchor, near the top of the union box) instead of the actual cursor.
		const range = activeDocument.createRange();
		range.setStart(sel.focusNode, sel.focusOffset);
		range.collapse(true);
		const rect = range.getBoundingClientRect();
		if (rect.height > 0) return rect.top;
		// Collapsed range with zero height: try coordsAtPos for accurate line top.
		if (view) {
			const coords = view.coordsAtPos(view.state.selection.main.head);
			if (coords) return coords.top;
		}
		const node = range.startContainer;
		const el   = node.instanceOf(Element) ? node : node.parentElement;
		return el?.getBoundingClientRect().top ?? null;
	}

	// Page down/up: move cursor one screen, then restore cursor screen position.
	// Uses moveCursorDown/Up to traverse tables and callouts correctly.
	private _inScrollPage    = false;
	private _scrollPageGenId = 0;

	// scrollPage operates in four phases:
	//   1. Record prevScreenY — cursor's Y within the scroll area before any movement.
	//   2. Loop — advance cursor one page via moveCursorDown/Up, measuring real pixel progress.
	//   3. Scroll — call scrollToCursorAtY to restore the cursor to prevScreenY on screen.
	//   4. Watch — detect LP cursor normalization and re-run scrollToCursorAtY after it settles.
	// onSettled (optional, default none, no behavior change for every
	// existing caller): fires once Phase 4 below has genuinely finished —
	// either no LP-normalizer correction was needed (5 clean RAF frames),
	// or one was and its own 100ms-later fixup has already run. Added for
	// extendMarkPage, which needs to read the real, final landing position
	// before applying its own extend dispatch — reading it any earlier
	// risks capturing a position LP's normalizer is about to move out
	// from under it.
	private scrollPage(editor: Editor, direction: 1 | -1, onSettled?: () => void) {
		const cm = editor.cm;
		if (!cm) { onSettled?.(); return; }

		const target = cm.scrollDOM.clientHeight;

		// Phase 1: record cursor's scroll-area-relative Y (viewport Y minus scrollRect.top).
		// Used by phase 3 to restore the cursor to the same on-screen position after scrolling.
		const scrollRect  = cm.scrollDOM.getBoundingClientRect();
		const rawY        = this.getCursorScreenY(cm);
		const prevScreenY = rawY !== null ? rawY - scrollRect.top : cm.scrollDOM.clientHeight / 2;

		// Phase 1.5: scan the traversal range for special content that needs the step loop.
		// Tables and callouts require moveCursorDown/Up for correct cell/line navigation.
		// Embeds can have unpredictable heights that confuse delta tracking.
		// Scan from the cursor to ~1 page ahead (not just cm.viewport) so that tables just
		// outside the rendered viewport but within the scroll distance are also detected.
		const estimatedLines = Math.ceil(target / cm.defaultLineHeight) + 5;
		const curLine  = editor.getCursor().line;
		const docLines = cm.state.doc.lines;
		const scanFrom = direction > 0
			? cm.state.selection.main.head
			: cm.state.doc.line(Math.max(1, curLine - estimatedLines)).from;
		const scanTo   = direction > 0
			? cm.state.doc.line(Math.min(docLines, curLine + estimatedLines)).to
			: cm.state.selection.main.head;
		let hasSpecialInView = false;
		syntaxTree(cm.state).iterate({
			from: scanFrom, to: scanTo,
			enter: (node) => {
				if (hasSpecialInView) return false;
				if (node.name.includes('HyperMD-table') || node.name.includes('HyperMD-quote')) {
					hasSpecialInView = true; return false;
				}
			},
		});
		// String-based fallback: syntax tree node names vary by Obsidian version/mode.
		if (!hasSpecialInView) {
			const scanText = cm.state.doc.sliceString(scanFrom, scanTo);
			hasSpecialInView = /^\|/m.test(scanText)           // table rows
				|| /^>/m.test(scanText)                        // blockquotes / callouts
				|| /^!(?:\[\[|\[)/m.test(scanText);            // embeds
		}
		// Phase 2: move cursor one page.
		if (!hasSpecialInView) {
			// Fast path: single CM6 native command (no intermediate scrollIntoView calls).
			if (direction > 0) {
				cursorPageDown(cm);
			} else {
				cursorPageUp(cm);
			}
		} else {
			// Slow path: step loop handles tables, callouts, and variable-height widgets.
			// scrollIntoView each step keeps the cursor on-screen so table navigation
			// functions (which rely on coordsAtPos) work correctly.
			const getDocY = (): number | null => {
				// Re-checked every call, not captured once: the active view can
				// switch between the outer document and a table cell's own
				// inner view as the loop steps across a table's boundary.
				// coordsAtPos on the outer view alone would read a stale outer
				// selection head while the real cursor has already moved into
				// the inner view. The scroll container itself stays the outer
				// document's own scrollDOM regardless.
				const currentView = editor.activeCM ?? cm;
				const y = this.getCursorScreenY(currentView);
				return y !== null ? y + cm.scrollDOM.scrollTop : null;
			};
			const moveCursor = direction > 0
				? (e: Editor) => this.moveCursorDown(e)
				: (e: Editor) => this.moveCursorUp(e);
			let prev     = editor.getCursor();
			let consumed = 0;
			// Confirmed live in a popout window: coordsAtPos/DOM-Selection-based
			// measurement of a table cell's inner view can return a frozen,
			// stale Y for many consecutive steps in a row (each one a real,
			// different logical position — the loop's own no-op check doesn't
			// catch it) before suddenly "catching up" with one big jump —
			// unlike the main window, where every step measures correctly.
			// Cross-window layout reads apparently don't force the same
			// synchronous reflow same-window ones do. A single zero/near-zero
			// delta is still treated as genuine (the horizontal-move-only case
			// this branch was originally written for), but once it repeats,
			// treat it as an unmeasurable stale read and fall back to
			// defaultLineHeight instead of silently accumulating nothing —
			// this bounds both the stall and the eventual overshoot.
			let consecutiveZeroDelta = 0;
			this._inScrollPage = true;
			try {
				while (consumed < target) {
					const prevDocY = getDocY();
					moveCursor(editor);
					const cur = editor.getCursor();
					if (cur.line === prev.line && cur.ch === prev.ch) break;
					prev = cur;
					cm.dispatch({
						effects: EditorView.scrollIntoView(cm.state.selection.main.head, { y: 'nearest' }),
					});
					const curDocY = getDocY();
					const delta   = (prevDocY !== null && curDocY !== null)
					              ? (curDocY - prevDocY) * direction : null;
					let step: number;
					if (delta !== null && delta >= 1) {
						consecutiveZeroDelta = 0;
						step = delta;
					} else if (delta !== null && consecutiveZeroDelta === 0) {
						// |delta| < 1: horizontal movement on the same visual line, no vertical progress.
						consecutiveZeroDelta++;
						step = 0;
					} else {
						step = cm.defaultLineHeight;
					}
					consumed += step;
				}
			} finally {
				this._inScrollPage = false;
			}
		}

		// Phase 3: scrollIntoView only guarantees the cursor is visible, not at prevScreenY.
		// scrollToCursorAtY adjusts scrollTop so the cursor lands at the recorded position.
		this.scrollToCursorAtY(editor, prevScreenY);

		const savedHead = cm.state.selection.main.head;
		const genId     = ++this._scrollPageGenId;

		// Phase 4: Obsidian's LP normalizer fires in the first rAF (~20ms) after the loop's
		// scrollIntoView calls, moving the cursor to an invalid position. LP widget heights
		// also shift during the transition, so savedScrollTop would place the cursor at the
		// wrong Y — re-run scrollToCursorAtY instead once LP has stabilized (~100ms later).
		// genId cancels a stale watcher when a new scrollPage call arrives first.
		let frames = 0;
		const watchNormalization = () => {
			if (this._scrollPageGenId !== genId) return; // superseded by a newer call — no onSettled, that call owns it now
			if (cm.state.selection.main.head !== savedHead) {
				setTimeoutOnActiveWindow(() => {
					if (this._scrollPageGenId !== genId) return;
					cm.dispatch({ selection: { anchor: savedHead, head: savedHead } });
					this.scrollToCursorAtY(editor, prevScreenY);
					onSettled?.();
				}, 100);
				return;
			}
			if (++frames < 5) { requestAnimationFrameOnActiveWindow(watchNormalization); return; }
			onSettled?.();
		};
		requestAnimationFrameOnActiveWindow(watchNormalization);
	}


	// preserveActiveSelection (default false, unchanged behavior for every
	// existing caller): when true and the live selection is currently
	// non-empty (anchor !== head — e.g. Vim's Visual/Visual Line mode),
	// keeps that anchor and only moves head to the new position, instead of
	// collapsing to a bare point. A collapsed-point dispatch reads to Vim as
	// "the user cleared the selection externally", silently dropping back
	// to Normal mode — this is what gg/G's own jumpToDocumentLine opts into
	// (see its own call site) to fix that without changing this method's
	// behavior for its many other callers (Ctrl-N/P, row/cell crossings,
	// etc.), none of which are expected to run mid-selection today.
	private setCursorViaCm(editor: Editor, line: number, ch: number, preserveActiveSelection = false) {
		const targetInTable = this.isPositionInTable(editor, line, ch);
		const cm = editor.cm;
		const pos = editor.posToOffset({ line, ch });
		// Short-circuits before touching cm.state at all when
		// preserveActiveSelection is false (the default) — every other
		// caller's own test mocks only stub what setCursorViaCm actually
		// used to read.
		const current = preserveActiveSelection ? cm.state.selection.main : null;
		const anchor = current && current.anchor !== current.head ? current.anchor : pos;
		cm.dispatch({ selection: { anchor, head: pos }, userEvent: 'move' });
		this.focusAfterCursorMove(editor, cm, targetInTable);
	}

	// Multi-cursor-safe sibling of setCursorViaCm above: computeTarget is
	// called once per EXISTING selection range (not just the primary one),
	// and every range is repositioned in a single dispatch instead of
	// collapsing the selection down to one cursor. Returning null for a
	// given range leaves it exactly where it was (e.g. already at the
	// target, or a no-op for that specific range) — and when every range
	// returns null, skips the dispatch entirely, matching the old
	// single-cursor callers' own "already there, do nothing" guards (no
	// spurious selectionSet transaction, e.g. from pressing End already at
	// a line's end). Targets are raw CM6 offsets (not {line, ch}) so
	// callers that already have an offset (e.g. from moveToLineBoundary)
	// can pass it straight through, along with its assoc — needed at VL
	// wrap points, same as the single-cursor callers below already relied
	// on. Table-entry/exit focus handling only looks at the resulting MAIN
	// range: only one view (outer or one inner table cell) can hold DOM
	// focus at a time, so secondary ranges can't affect this independently.
	private setCursorsViaCm(editor: Editor, computeTarget: (range: SelectionRange) => { pos: number; assoc?: -1 | 1 } | null) {
		const cm = editor.cm;
		let changed = false;
		const ranges = cm.state.selection.ranges.map(range => {
			const target = computeTarget(range);
			if (!target) return range;
			changed = true;
			return EditorSelection.cursor(target.pos, target.assoc);
		});
		if (!changed) return;
		const selection = EditorSelection.create(ranges, cm.state.selection.mainIndex);
		cm.dispatch({ selection, scrollIntoView: true, userEvent: 'move' });
		const mainPos = editor.offsetToPos(selection.main.head);
		// Probes with ch=1, not mainPos.ch — matching every other
		// isPositionInTable call site in this file (see
		// reconcileSecondaryRangesAfterTableCrossing's own identical fix,
		// 2026-10-14). Currently unreachable (Home/End never land on a
		// table's own line), but setCursorsViaCm is a general-purpose
		// multi-cursor helper any future caller could reuse for a motion
		// that does.
		this.focusAfterCursorMove(editor, cm, this.isPositionInTable(editor, mainPos.line, 1));
	}

	// Shared by setCursorViaCm/setCursorsViaCm above.
	private focusAfterCursorMove(editor: Editor, cm: EditorView, targetInTable: boolean) {
		if (!targetInTable) {
			// Exiting the table: outer CM must receive keyboard events.
			cm.focus();
		} else {
			// Navigating to a table cell: do NOT call cm.focus().
			// Normally Obsidian auto-creates and auto-focuses the inner view when
			// cm.dispatch places the cursor in a table cell.  However, if the outer
			// CM already held DOM focus before the dispatch (e.g. after editor.setLine
			// in Kill Line), Obsidian skips auto-focus.  Transfer focus explicitly in
			// the next frame to cover that case without risking destroying the inner view.
			if (!this._inScrollPage) {
				requestAnimationFrameOnActiveWindow(() => {
					const inner = editor.activeCM;
					if (inner && inner !== cm && !inner.hasFocus) {
						inner.focus();
					}
				});
			}
		}
	}

	// Multi-cursor-safe dispatcher for in-cell motion (Home/End-in-table's
	// own shared shape, see their respective compute* functions): computes
	// every existing inner-view range's own result first (pure, no
	// dispatch). A range's own result is either 'exit' (this range needs to
	// leave the current cell — a different inner view) or 'stay' (a target
	// position within the SAME cell, possibly unchanged). Same
	// table-boundary policy as everywhere else in this file, just at CELL
	// granularity instead of table granularity: if the primary's own result
	// is 'exit', hands off entirely to onPrimaryExit, which already
	// collapses the whole selection on its own (tearing down this inner
	// view for a new one via the outer, single-cursor setCursorViaCm) — no
	// extra handling needed for that case. Otherwise batches every 'stay'
	// range into one dispatch and drops any OTHER range whose own result is
	// 'exit' when the primary's isn't (can't coexist with the primary in
	// the same cell's inner view).
	private dispatchInCellMotion(
		inner: EditorView,
		computeResult: (range: SelectionRange) => { kind: 'exit' } | { kind: 'stay'; pos: number; assoc?: -1 | 1 },
		onPrimaryExit: () => void,
	) {
		const sel = inner.state.selection;
		const main = sel.main;
		const mainIndex = sel.ranges.indexOf(main);
		const results = sel.ranges.map(computeResult);

		if (results[mainIndex].kind === 'exit') {
			onPrimaryExit();
			return;
		}

		let changed = false;
		let newMainIndex = -1;
		const kept: SelectionRange[] = [];
		sel.ranges.forEach((range, i) => {
			const result = results[i];
			const isMain = range === main;
			if (!isMain && result.kind === 'exit') {
				// Would leave this cell while the primary isn't — dropped.
				changed = true;
				return;
			}
			let keptRange = range;
			if (result.kind === 'stay' && result.pos !== range.head) {
				changed = true;
				keptRange = EditorSelection.cursor(result.pos, result.assoc);
			}
			if (isMain) newMainIndex = kept.length;
			kept.push(keptRange);
		});
		if (!changed) return;
		inner.dispatch({ selection: EditorSelection.create(kept, newMainIndex), userEvent: 'move' });
	}

	// Multi-cursor + table-boundary policy, shared by LEFT/RIGHT/UP/DOWN's
	// own wrappers above. A table cell is rendered through a separate inner
	// EditorView/EditorState from the outer document, and only one view can
	// hold DOM focus at a time — so once the PRIMARY range's motion settles
	// on one side (in a table cell or not), any OTHER range that ends up on
	// the opposite side cannot coexist with it in the same selection and is
	// dropped. The primary itself is never dropped — it defines which side
	// "wins" — which also makes this a no-op for the common single-cursor
	// case (ranges.length === 1) and for the case where the primary's own
	// move already collapsed the whole selection to one range (the existing
	// single-cursor table-entry/exit helpers already do this on their own,
	// matching this same policy by construction).
	private reconcileSecondaryRangesAfterTableCrossing(editor: Editor) {
		const cm = editor.cm;
		if (!cm) return;
		const sel = cm.state.selection;
		if (sel.ranges.length <= 1) return;
		const main = sel.main;
		const mainPos = editor.offsetToPos(main.head);
		// Probes with ch=1, not the range's own ch, matching every other
		// isPositionInTable call site in this file (e.g. moveCursorLeft's
		// own cursor.line ± 1, 1). Confirmed live: ch=0 exactly at a table's
		// own left/top edge resolves (via the syntax tree's side=-1 lean) as
		// "still outside" — a secondary landing exactly there via a plain
		// goRight reads as not-in-table for one extra step, visibly
		// rendering as stuck astride the table edge until the next motion
		// pushes it one character further in. What's actually being asked
		// here is "is this LINE part of a table", not the exact horizontal
		// position, so ch=1 (same fix as every existing caller already
		// uses) is the right probe regardless of where on the line the
		// range's own head happens to sit.
		const mainInTable = this.isPositionInTable(editor, mainPos.line, 1);
		const kept = sel.ranges.filter(range => {
			if (range === main) return true;
			const pos = editor.offsetToPos(range.head);
			return this.isPositionInTable(editor, pos.line, 1) === mainInTable;
		});
		if (kept.length === sel.ranges.length) return;
		cm.dispatch({
			selection: EditorSelection.create(kept, kept.indexOf(main)),
			userEvent: 'move',
		});
	}

	// Confirmed live in a popout window (see
	// project_popout_window_cursor_investigation memory): the cursor can
	// render invisible after landing in a table cell there, even though the
	// logical position is already correct. A bare second setCursorViaCm call
	// alone doesn't fix it (tried and reverted); what does is a real layout
	// measurement (coordsAtPos/posAtCoords) on the freshly-created inner view
	// immediately before that second call. Two frames of deferral, matching
	// every other "wait for Obsidian's async cell-focus reconciliation to
	// settle" spot in this codebase. No-op outside a table cell.
	private nudgeInnerViewVisible(editor: Editor) {
		requestAnimationFrameOnActiveWindow(() => {
			requestAnimationFrameOnActiveWindow(() => {
				const inner = editor.activeCM;
				if (inner && inner !== editor.cm) {
					const head = inner.state.selection.main.head;
					const coords = inner.coordsAtPos(head);
					if (coords) inner.posAtCoords({ x: coords.left, y: coords.top + 9 }, false);
				}
				const current = editor.getCursor();
				this.setCursorViaCm(editor, current.line, current.ch);
			});
		});
	}

	// Explicit scroll-into-view follow-up, same idiom jumpToDocumentLine/
	// jumpToBufferEdge already use for their own big jumps: setCursorViaCm
	// itself never requests one (left as-is to avoid changing behavior for
	// its many other, already-working callers, which are all short,
	// already-on-screen hops). A cross-line word jump can travel arbitrarily
	// far — skipping many blank lines, or exiting a table into more blank
	// lines beyond it — and can land outside the current viewport, so it
	// needs its own separate follow-up dispatch to the position it already
	// landed on (read back from the live selection rather than recomputed,
	// since setCursorViaCm may have already applied a further correction on
	// top of the original landing).
	// Re-asserts the CURRENT selection as-is (every range, not just main) so
	// the scrollIntoView transaction effect below can run without
	// collapsing a multi-cursor selection down to one range — confirmed
	// live (2026-10-14): moveCursorWordPlainText's own multi-range dispatch
	// was getting silently collapsed by this call immediately afterward,
	// whenever the primary's own word-motion crossed to a different line.
	private scrollCursorIntoView(editor: Editor) {
		const cm = editor.cm;
		cm.dispatch({ selection: cm.state.selection, scrollIntoView: true, userEvent: 'move' });
	}


	// Navigate to (targetLine, targetCh) via editor.exec goLeft/goRight, keeping the
	// inner CM view active. Dispatching to the outer CM view (setCursorViaCm) causes
	// Obsidian to destroy and recreate the inner view, which breaks native-cursor's
	// coordsAtPos. Falls back to setCursorViaCm if the loop cannot reach the target.

	private isLivePreviewMode(): boolean {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return false;

		const mode = view.getMode();
		if (mode !== "source") return false;

		return !view.getState().source;
	}


	// Returns the ch position of the content-start for smart Home in non-table lines.
	// When smartHomeStandard is OFF, always returns 0 (plain logical line start).
	// Public: also used by vim-support.ts's Vim J (joinLines) override, via the
	// VimSupportHost bridge.
	getBeginningOfLinePosition(line: string, ch: number): number {

		if (!this.settings.smartHomeStandard) {
			return 0;
		}

		// Strip blockquote prefix so the downstream pattern checks run on the content.
		// bqEnd is 0 for non-blockquote lines and added back to every return value.
		let bqEnd = 0;
		const bqMatch = line.match(/^(\s*>)+\s*/);
		if (bqMatch) {
			bqEnd = bqMatch[0].length;
			line = line.slice(bqEnd);
			ch -= bqEnd;
		}

		let result: RegExpMatchArray | null = null;
		if (this.settings.smartHomeAdvanced) {
			// Callout type marker: > [!type] Title → stop before Title (blockquote lines only)
			if (bqEnd > 0) {
				result = line.match(/^\[![^\]]+\][+-]?\s*/);
				if (result !== null && result[0].length < ch) return bqEnd + result[0].length;
			}
			// Headings in an unordered list (Adv.)
			// `- # heading-text`, 1st after `# `, 2nd after `- `
			result = line.match(/^(\s*[-+*]\s)?#+\s/);
			if (result !== null && result[0].length < ch) return bqEnd + result[0].length;
			result = line.match(/^#{1,6}\s/); // Headings (Adv.)
			if (result === null) result = line.match(/^\[\^.+?\]:\s*/); // Footnotes (Adv.)
		}
		if (result === null) result = line.match(/^\s*\d+[.)]\s(\[.\]\s)?/); // Ordered lists (+ optional task checkbox)
		if (result === null) result = line.match(/^\s*([-+*]\s(\[.\]\s)?)?/); // Indents, Unordered lists, Task lists

		if (result !== null && result[0].length < ch) return bqEnd + result[0].length;
		return 0;
	}


	private isTableLineSourceMode(line: string): boolean {
		if (!this.settings.tableAwareSourceModeEditing) return false;
		const trimmed = line.trimEnd();
		return trimmed.startsWith('|') && trimmed.endsWith('|');
	}

	// VimSupportHost's own exposed version of the isLivePreviewMode() +
	// isTableLineSourceMode() combo every Source-Mode-aware command in this
	// file already repeats inline — vim-support.ts has no direct access to
	// either private method, and tx/tX (tableExitDown/tableExitUp) are its
	// first callers that need this check.
	isSourceModeTableLine(line: string): boolean {
		return !this.isLivePreviewMode() && this.isTableLineSourceMode(line);
	}


	private isLineSkippableWidget(lineText: string): boolean {
		// Obsidian embed ![[...]] or Markdown image ![...](...) starting at column 0
		if (/^!(\[\[|\[)/.test(lineText)) return true;
		// Thematic break --- / *** / ___ (3+ identical chars, optional trailing spaces)
		return /^[-*_]{3,}\s*$/.test(lineText);
	}


	//===========================================================================
	// Select all
	//===========================================================================

	// Real Emacs's mark-whole-buffer (the "Select all" equivalent, C-x h)
	// doesn't deactivate an existing mark — it pushes a fresh one at the
	// buffer's own start and activates the region spanning the whole
	// buffer. Mirrored here: a genuine (non-no-op) Select all arms
	// markActive on the new selection it just created, the same way a
	// mouse drag or Shift+Arrow does, so the very next Ctrl-B/F/N/P/A/E
	// continues extending from this new region instead of just moving.
	private selectAll(editor: Editor) {
		const cursor   = editor.getCursor();
		const line     = editor.getLine(cursor.line);
		const inTable  = (editor.inTableCell)
		              || (!this.isLivePreviewMode() && this.isTableLineSourceMode(line));

		if (inTable) {
			const start = getStartOfCellContent(line, cursor.ch);
			const end   = getEndOfCellContent(line, cursor.ch);
			if (start === end) return;
			editor.setSelection({ line: cursor.line, ch: start }, { line: cursor.line, ch: end });
			this.markActive = true;
			return;
		}

		editor.setSelection(
			{ line: 0, ch: 0 },
			{ line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length }
		);
		this.markActive = true;
	}


	//===========================================================================
	// Delete char (Ctrl-D)
	//===========================================================================

	private deleteChar(editor: Editor) {
		this.markActive = false;
		if (editor.inTableCell) {
			this.deleteCharInTableLP(editor);
			return;
		}

		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		const inSourceTable = !this.isLivePreviewMode() && this.isTableLineSourceMode(lineText);
		if (inSourceTable) {
			this.deleteCharInTableSource(editor);
			return;
		}

		const cm = editor.cm;
		if (cm) deleteCharForward(cm);
	}


	private deleteCharInTableLP(editor: Editor) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) {
			// Fallback: no-op if inner view is unavailable (cursor not in LP table cell).
			return;
		}

		// Inner view path: use sub-line boundaries directly.
		const head    = inner.state.selection.main.head;
		const subLine = inner.state.doc.lineAt(head);
		const isLastSubLine = subLine.number === inner.state.doc.lines;

		if (isLastSubLine) {
			const endOfSubLine = subLine.from + subLine.text.trimEnd().length;
			if (head >= endOfSubLine) return;  // cell boundary: no-op
		} else if (head >= subLine.to) {
			// At \n boundary: delete the \n to join sub-lines.
			inner.dispatch({ changes: { from: subLine.to, to: subLine.to + 1, insert: '' }, selection: { anchor: subLine.to }, userEvent: 'delete' });
			return;
		}

		const cm = editor.cm;
		if (cm) deleteCharForward(cm);
	}


	private deleteCharInTableSource(editor: Editor) {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		const bounds = getCellBounds(lineText, cursor.ch);

		if (!bounds) {
			const cm = editor.cm;
			if (cm) deleteCharForward(cm);
			return;
		}

		// At or past trailing whitespace before closing pipe: no-op (cell boundary)
		const cellEnd = bounds.open + 1 + lineText.slice(bounds.open + 1, bounds.close).trimEnd().length;
		if (cursor.ch >= cellEnd) return;

		// Within cell: delete one character forward (no HTML-tag awareness in Source Mode)
		const cm = editor.cm;
		if (cm) deleteCharForward(cm);
	}


	//===========================================================================
	// Transpose chars
	//===========================================================================

	// Pure (no dispatch) per-range resolution shared by the plain-text
	// (outer) and Live Preview table-cell (inner) cases — both are a real,
	// complete CM6 EditorView of their own, so the line-boundary math is
	// identical either way (a <br>-separated in-cell line is represented as
	// a real CM6 line inside the inner view, so crossing into it is no
	// different from crossing a real line boundary in plain text).
	//
	// At a line's own end, swaps that line's own last two grapheme clusters
	// (never crossing into the next line) — a deliberate override of CM6's
	// own stock transposeChars, which instead swaps with the next line's
	// own first character there; this plugin matches real Emacs's own
	// end-of-line special case instead. Everywhere else (mid-line, or at a
	// non-first line's own start, which swaps with the previous line's own
	// line-break character) mirrors CM6's own stock transposeChars formula
	// exactly (see @codemirror/commands' own source for the original) —
	// cluster boundaries via findClusterBreak, the same primitive CM6 uses
	// internally, so this stays surrogate-pair/grapheme safe without any
	// custom Unicode logic of its own.
	private resolveTransposeCharsRangeInView(view: EditorView, pos: number):
			{ kind: 'noop' } | { kind: 'found'; from: number; to: number; insert: string; resultPos: number } {
		const line = view.state.doc.lineAt(pos);
		if (pos === line.to) {
			const text = line.text;
			const localMid = findClusterBreak(text, text.length, false);
			const localFrom = findClusterBreak(text, localMid, false);
			if (localFrom === localMid) return { kind: 'noop' }; // fewer than two clusters
			const insert = text.slice(localMid) + text.slice(localFrom, localMid);
			return { kind: 'found', from: line.from + localFrom, to: line.to, insert, resultPos: line.to };
		}
		if (pos === 0) return { kind: 'noop' }; // absolute document/cell start, nothing before
		const from = pos === line.from ? pos - 1 : findClusterBreak(line.text, pos - line.from, false) + line.from;
		const to = findClusterBreak(line.text, pos - line.from, true) + line.from;
		const insert = view.state.sliceDoc(pos, to) + view.state.sliceDoc(from, pos);
		return { kind: 'found', from, to, insert, resultPos: to };
	}

	// Pure (no dispatch) per-range resolution for a Source Mode table row.
	// Only the true cell boundary (`|`) is a hard stop; a `<br>` (in-cell
	// line) boundary is crossable backward, swapped as one atomic
	// 4-character unit (never partially) with the following grapheme
	// cluster — e.g. "A<br>B<br>C" with the cursor at the start of "B"
	// becomes "AB<br><br>C". At the in-cell line's own end, swaps its own
	// last two clusters (same rationale as resolveTransposeCharsRangeInView's
	// own identical case) rather than crossing a following `<br>` forward.
	private resolveTransposeCharsRangeSourceMode(editor: Editor, pos: { line: number; ch: number }, lineText: string, info: InCellLineInfo):
			{ kind: 'noop' } | { kind: 'found'; from: number; to: number; insert: string; resultPos: number } {
		if (info.isEmpty) return { kind: 'noop' }; // matches the plain-text empty-line case

		const lineStart = editor.posToOffset({ line: pos.line, ch: 0 });

		if (pos.ch <= info.startOfInCellLine) {
			// 'single'/'first': nothing precedes this in-cell line but the
			// cell's own opening `|` — a genuine hard wall, matching Kill
			// word's/multi-cell selection's established cell-scoping rule.
			if (info.lineType === 'single' || info.lineType === 'first') return { kind: 'noop' };

			// 'middle'/'last': a <br> tag immediately precedes this in-cell
			// line. Swap the whole 4-character tag with the following
			// grapheme cluster.
			const brStart = info.startOfInCellLine - 4; // '<br>' (any case) is always exactly 4 chars
			const brTag = lineText.slice(brStart, info.startOfInCellLine);
			const after = lineText.slice(info.startOfInCellLine);
			const clusterEnd = findClusterBreak(after, 0);
			const firstCluster = after.slice(0, clusterEnd);
			return {
				kind: 'found',
				from: lineStart + brStart,
				to: lineStart + info.startOfInCellLine + clusterEnd,
				insert: firstCluster + brTag,
				resultPos: lineStart + brStart + firstCluster.length + brTag.length,
			};
		}

		if (pos.ch >= info.endOfInCellLine) {
			const text = lineText.slice(info.startOfInCellLine, info.endOfInCellLine);
			const localMid = findClusterBreak(text, text.length, false);
			const localFrom = findClusterBreak(text, localMid, false);
			if (localFrom === localMid) return { kind: 'noop' }; // fewer than two clusters
			const insert = text.slice(localMid) + text.slice(localFrom, localMid);
			return {
				kind: 'found',
				from: lineStart + info.startOfInCellLine + localFrom,
				to: lineStart + info.endOfInCellLine,
				insert,
				resultPos: lineStart + info.endOfInCellLine,
			};
		}

		// Mid-line: same CM6-stock-mirroring math as
		// resolveTransposeCharsRangeInView's own identical case, scoped to
		// [startOfInCellLine, endOfInCellLine) instead of the whole raw line.
		const chFrom = findClusterBreak(lineText, pos.ch, false);
		const chTo = findClusterBreak(lineText, pos.ch, true);
		const insert = lineText.slice(pos.ch, chTo) + lineText.slice(chFrom, pos.ch);
		return { kind: 'found', from: lineStart + chFrom, to: lineStart + chTo, insert, resultPos: lineStart + chTo };
	}

	// Pure (no dispatch) per-range mode resolution for transposeCharsOuter's
	// own multi-range loop below: a Source Mode table row gets its own
	// <br>-aware handling, decided independently per range — same pattern as
	// resolveKillLineRangeOuter.
	private resolveTransposeCharsRangeOuter(editor: Editor, pos: { line: number; ch: number }):
			{ kind: 'noop' } | { kind: 'found'; from: number; to: number; insert: string; resultPos: number } {
		const lineText = editor.getLine(pos.line);
		const inSourceTable = !this.isLivePreviewMode() && this.isTableLineSourceMode(lineText);
		if (inSourceTable) {
			const info = getInCellLineInfo(lineText, pos.ch);
			if (info) return this.resolveTransposeCharsRangeSourceMode(editor, pos, lineText, info);
		}
		return this.resolveTransposeCharsRangeInView(editor.cm, editor.posToOffset(pos));
	}

	// Table-aware, multi-cursor-safe: each range resolves independently
	// (plain text, or a Source Mode table row) and all changes/selections
	// are dispatched together in one transaction.
	private transposeChars(editor: Editor) {
		this.markActive = false;
		if (editor.inTableCell) {
			this.transposeCharsInTableLP(editor);
			return;
		}
		this.transposeCharsOuter(editor);
	}

	private transposeCharsOuter(editor: Editor) {
		const cm = editor.cm;
		const sel = cm.state.selection;
		const main = sel.main;
		const changes: { from: number; to: number; insert: string }[] = [];
		const entries: ({ kind: 'cursor'; pos: number })[] = [];
		let newMainIndex = -1;

		sel.ranges.forEach(range => {
			const isMain = range === main;
			const result = this.resolveTransposeCharsRangeOuter(editor, editor.offsetToPos(range.head));
			if (result.kind === 'noop') {
				if (isMain) newMainIndex = entries.length;
				entries.push({ kind: 'cursor', pos: range.head });
				return;
			}
			changes.push({ from: result.from, to: result.to, insert: result.insert });
			if (isMain) newMainIndex = entries.length;
			entries.push({ kind: 'cursor', pos: result.resultPos });
		});
		if (changes.length === 0) return;

		const selection = EditorSelection.create(this.mapSelectionAfterChanges(cm, changes, entries), newMainIndex);
		cm.dispatch({ changes, selection, userEvent: 'move.character' });
	}

	// Multi-cursor-safe, operating on the cell's own inner view coordinates
	// directly — same shape as transposeCharsOuter above.
	private transposeCharsInTableLP(editor: Editor) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) return;

		const sel = inner.state.selection;
		const main = sel.main;
		const changes: { from: number; to: number; insert: string }[] = [];
		const entries: ({ kind: 'cursor'; pos: number })[] = [];
		let newMainIndex = -1;

		sel.ranges.forEach(range => {
			const isMain = range === main;
			const result = this.resolveTransposeCharsRangeInView(inner, range.head);
			if (result.kind === 'noop') {
				if (isMain) newMainIndex = entries.length;
				entries.push({ kind: 'cursor', pos: range.head });
				return;
			}
			changes.push({ from: result.from, to: result.to, insert: result.insert });
			if (isMain) newMainIndex = entries.length;
			entries.push({ kind: 'cursor', pos: result.resultPos });
		});
		if (changes.length === 0) return;

		const selection = EditorSelection.create(this.mapSelectionAfterChanges(inner, changes, entries), newMainIndex);
		inner.dispatch({ changes, selection, userEvent: 'move.character' });
	}


	//===========================================================================
	// Kill line (Ctrl-K)
	//===========================================================================

	// The selection-vs-table-row choice is made per range (resolveKillLineRangeOuter
	// below), not once for the whole command based on primary alone — same
	// philosophy as transformWordOrSelectionNonTable's own per-range mode
	// resolution. Only the LP-cell case is still gated at this top level,
	// since a focused cell is a structurally distinct inner EditorView,
	// not something any range can independently "be in."
	private killLine(editor: Editor) {
		// Unconditional, same simplification as Delete char/Transpose
		// chars/Kill word/Kill region/Copy region/Yank (c79622c and
		// fix/set-mark-clearing-gaps): real Emacs's kill-line deactivates
		// the mark like virtually every other editing command does by
		// default (transient-mark-mode's own deactivate-mark convention),
		// regardless of whether it operated on a selection — unlike Kill
		// region/Copy region/Yank, kill-line never even looks at the
		// selection's extent (it always kills from point to end of line),
		// so there's no "did this actually consume a selection" guard to
		// write here at all.
		this.markActive = false;
		if (editor.inTableCell) {
			this.killLineInTableLP(editor);
			return;
		}
		this.killLineOuter(editor);
	}


	// Pure (no dispatch) per-range resolution for killLineInTableLP's own
	// multi-range loop below — mirrors the single-cursor logic exactly:
	// kill to end of the current sub-line, or (already there) join with
	// the next sub-line via Smart join; a no-op only at the cell's own
	// last sub-line's own end.
	private resolveKillLineRangeInCell(inner: EditorView, head: number):
			{ kind: 'noop' } | { kind: 'found'; from: number; to: number; killText: string } {
		const subLine       = inner.state.doc.lineAt(head);
		const isLastSubLine = subLine.number === inner.state.doc.lines;
		const endOfSubLine  = isLastSubLine
			? subLine.from + subLine.text.trimEnd().length
			: subLine.to;

		if (head < endOfSubLine) {
			return { kind: 'found', from: head, to: endOfSubLine, killText: inner.state.doc.sliceString(head, endOfSubLine) };
		}

		if (!isLastSubLine) {
			// Scoped to just the immediately-next sub-line's own content (not
			// sliced to the document end) — getBeginningOfLinePosition's regexes
			// can match across a \n (it's in \s), so an unscoped slice let a
			// blank next sub-line's own separator get treated as skippable
			// leading whitespace, consuming an extra sub-line per kill whenever
			// the sub-line after the one being joined was itself blank.
			const nextSubLine = inner.state.doc.lineAt(subLine.to + 1);
			const afterNl = inner.state.doc.sliceString(subLine.to + 1, nextSubLine.to);
			// Matches killLineNonTable's own "current line must be non-empty"
			// guard — Smart join shouldn't trim the next sub-line's leading
			// Markdown when killing from a genuinely blank in-cell line.
			const trimLen = (this.settings.smartJoin && subLine.text.length > 0)
				? this.getBeginningOfLinePosition(afterNl, afterNl.length || 1)
				: 0;
			// The trimmed leading Markdown (trimLen chars) is deleted from the
			// cell right alongside the newline below — it must go into the
			// kill cache too, or Yank can never restore it.
			return { kind: 'found', from: subLine.to, to: subLine.to + 1 + trimLen, killText: '\n' + afterNl.slice(0, trimLen) };
		}

		return { kind: 'noop' };
	}

	// Multi-cursor-safe — same shape as killLineNonTable above, operating
	// on the cell's own inner view coordinates directly.
	private killLineInTableLP(editor: Editor) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) return;

		const sel = inner.state.selection;
		const main = sel.main;
		const changes: { from: number; to: number; insert: string }[] = [];
		const entries: ({ kind: 'cursor'; pos: number })[] = [];
		let newMainIndex = -1;
		const killedTexts: string[] = [];

		sel.ranges.forEach(range => {
			const isMain = range === main;
			const result = this.resolveKillLineRangeInCell(inner, range.head);
			if (result.kind === 'noop') {
				if (isMain) newMainIndex = entries.length;
				entries.push({ kind: 'cursor', pos: range.head });
				return;
			}
			changes.push({ from: result.from, to: result.to, insert: '' });
			killedTexts.push(result.killText);
			if (isMain) newMainIndex = entries.length;
			entries.push({ kind: 'cursor', pos: result.from });
		});
		if (killedTexts.length === 0) return;

		this.updateKillCache(killedTexts.join('\n'));
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		const selection = EditorSelection.create(this.mapSelectionAfterChanges(inner, changes, entries), newMainIndex);
		this.isDispatchingKill = true;
		inner.dispatch({ changes, selection, userEvent: 'delete' });
		this.isDispatchingKill = false;
		this.isKillChaining = true;
	}


	// Pure (no dispatch) per-range resolution for a Source Mode table row —
	// mirrors the single-cursor logic exactly: kill to the end of the
	// current in-cell line; or (already there) kill a following <br>
	// forward (only possible when lineType is 'first'/'middle'), honoring
	// Smart join the same way killLineNonTable's own "current line must be
	// non-empty" guard does; or (cursor snapped to a <br>'s own end) kill
	// that <br> backward. A no-op (not every one of these three forms
	// applies at every position) falls through to resolveKillLineRangeOuter's
	// own plain-text fallback — matches isValidRegionRangeOuter's own "not
	// actually in a table row" fallback philosophy.
	private resolveKillLineRangeSourceMode(editor: Editor, pos: { line: number; ch: number }, lineText: string, info: InCellLineInfo):
			{ kind: 'noop' } | { kind: 'found'; from: number; to: number; killText: string } {
		if (pos.ch < info.endOfInCellLine) {
			const text = lineText.slice(pos.ch, info.endOfInCellLine);
			return {
				kind: 'found',
				from: editor.posToOffset(pos),
				to: editor.posToOffset({ line: pos.line, ch: info.endOfInCellLine }),
				killText: this.normalizeKillText(text),
			};
		}

		// kill <br> forward from endOfInCellLine (only possible when lineType is 'first'/'middle')
		const brMatch = lineText.slice(info.endOfInCellLine).match(/^<[bB][rR]>([ \t]*)/);
		if (brMatch) {
			const brLen   = '<br>'.length;
			const afterBr = lineText.slice(info.endOfInCellLine + brLen);
			const trimLen = (this.settings.smartJoin && !info.isEmpty)
				? this.getBeginningOfLinePosition(afterBr, afterBr.length || 1)
				: 0;
			const toCh     = info.endOfInCellLine + brLen + trimLen;
			const targetCh = info.endOfInCellLine;
			// The trimmed leading Markdown (trimLen chars) is deleted from the
			// cell right alongside the <br> below — it must go into the kill
			// cache too, or Yank can never restore it.
			return {
				kind: 'found',
				from: editor.posToOffset({ line: pos.line, ch: targetCh }),
				to: editor.posToOffset({ line: pos.line, ch: toCh }),
				killText: '\n' + afterBr.slice(0, trimLen),
			};
		}

		// cursor snap: cursor may land at br.end (= startOfInCellLine of 'middle'/'last')
		// rather than br.start. Kill the <br> that ends at cursor.ch.
		const brSnapMatch = lineText.slice(0, pos.ch).match(/<[bB][rR]>([ \t]*)$/);
		if (brSnapMatch && pos.ch === info.startOfInCellLine) {
			const brStart = pos.ch - brSnapMatch[0].length;
			return {
				kind: 'found',
				from: editor.posToOffset({ line: pos.line, ch: brStart }),
				to: editor.posToOffset(pos),
				killText: '\n',
			};
		}

		return { kind: 'noop' };
	}


	// Pure (no dispatch) per-range mode resolution for killLineOuter's own
	// multi-range loop below: a Source Mode table row gets its own
	// <br>-aware handling (resolveKillLineRangeSourceMode); everything else
	// falls back to plain-text line/Smart-join handling
	// (resolveKillLineRangeNonTable) — decided independently per range,
	// not once for the whole command based on primary alone.
	private resolveKillLineRangeOuter(editor: Editor, pos: { line: number; ch: number }):
			{ kind: 'noop' } | { kind: 'found'; from: number; to: number; killText: string } {
		const lineText = editor.getLine(pos.line);
		const inSourceTable = !this.isLivePreviewMode() && this.isTableLineSourceMode(lineText);
		if (inSourceTable) {
			const info = getInCellLineInfo(lineText, pos.ch);
			if (info) return this.resolveKillLineRangeSourceMode(editor, pos, lineText, info);
		}
		return this.resolveKillLineRangeNonTable(editor, pos);
	}

	// Pure (no dispatch) per-range resolution for the plain-text case —
	// operates from `pos` (a given range's own head, ignoring any
	// selection that range might have, same as the single-cursor version's
	// own `editor.getCursor()` convention), mirrors the single-cursor
	// logic exactly: kill to end of line, or (at the line's own end
	// already) join with the next line via Smart join.
	private resolveKillLineRangeNonTable(editor: Editor, pos: { line: number; ch: number }):
			{ kind: 'noop' } | { kind: 'found'; from: number; to: number; killText: string } {
		const lineText = editor.getLine(pos.line);
		if (pos.ch < lineText.length) {
			return {
				kind: 'found',
				from: editor.posToOffset(pos),
				to: editor.posToOffset({ line: pos.line, ch: lineText.length }),
				killText: lineText.slice(pos.ch),
			};
		}
		if (pos.line >= editor.lineCount() - 1) return { kind: 'noop' };

		const nextLineText = editor.getLine(pos.line + 1);
		const joinTrimLen = (this.settings.smartJoin && lineText.length > 0)
			? this.getBeginningOfLinePosition(nextLineText, nextLineText.length || 1)
			: 0;
		// Smart join's own trimmed leading Markdown (joinTrimLen chars) is
		// deleted from the document right alongside the newline below — it
		// must go into the kill cache too, or Yank can never restore it.
		return {
			kind: 'found',
			from: editor.posToOffset({ line: pos.line, ch: lineText.length }),
			to: editor.posToOffset({ line: pos.line + 1, ch: joinTrimLen }),
			killText: '\n' + nextLineText.slice(0, joinTrimLen),
		};
	}

	// Multi-cursor-safe: each range kills from its own head independently
	// (ignoring any selection that range might have — Kill Line has no
	// selection-DWIM, matching the single-cursor version), joined with
	// '\n' into one kill-cache entry (same convention as Kill Region).
	// isKillChaining is deliberately never reset to false here — chaining
	// across consecutive Kill Line presses is this command's whole point,
	// controlled externally (any other selection-consuming command resets
	// it elsewhere), so a 'noop' range is simply left in place.
	private killLineOuter(editor: Editor) {
		const cm = editor.cm;
		const sel = cm.state.selection;
		const main = sel.main;
		const changes: { from: number; to: number; insert: string }[] = [];
		const entries: ({ kind: 'cursor'; pos: number })[] = [];
		let newMainIndex = -1;
		const killedTexts: string[] = [];

		sel.ranges.forEach(range => {
			const isMain = range === main;
			const result = this.resolveKillLineRangeOuter(editor, editor.offsetToPos(range.head));
			if (result.kind === 'noop') {
				if (isMain) newMainIndex = entries.length;
				entries.push({ kind: 'cursor', pos: range.head });
				return;
			}
			changes.push({ from: result.from, to: result.to, insert: '' });
			killedTexts.push(result.killText);
			if (isMain) newMainIndex = entries.length;
			entries.push({ kind: 'cursor', pos: result.from });
		});
		if (killedTexts.length === 0) return;

		this.updateKillCache(killedTexts.join('\n'));
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		const selection = EditorSelection.create(this.mapSelectionAfterChanges(cm, changes, entries), newMainIndex);
		this.isDispatchingKill = true;
		cm.dispatch({ changes, selection, userEvent: 'delete' });
		this.isDispatchingKill = false;
		this.isKillChaining = true;
	}


	//===========================================================================
	// Kill word left / right (Emacs Alt-Backspace / Alt-D)
	//===========================================================================

	// The boundary that matters is the CELL (a different cell/row is a
	// different document), not the <br>-segment (that's just how one cell's
	// own single continuous piece of text represents a line break — the
	// in-cell equivalent of a plain-text newline). So killWordInTableLP/
	// SourceMode below cross <br>-segments freely within the same cell
	// (mirroring killWordNonTable's own free line-crossing, and mirroring
	// moveCursorWordInTable's own walkSegments-based in-cell walk), and only
	// no-op once genuinely at the cell's own first/last segment edge. Word-
	// boundary lookup reuses the same findWordSpanOnLine primitive Word
	// right/left (moveCursorWord) already use.
	// The selection-vs-table-row choice is made per range (resolveKillWordRangeOuter
	// below), not once for the whole command based on primary alone — same
	// philosophy as Kill Line's own killLineOuter. Only the LP-cell case is
	// still gated here, since a focused cell is a structurally distinct
	// inner EditorView, not something any range can independently "be in."
	private killWord(editor: Editor, forward: boolean) {
		this.markActive = false;
		if (editor.inTableCell) {
			this.killWordInTableLP(editor, forward);
			return;
		}
		this.killWordOuter(editor, forward);
	}

	// Pure (no dispatch) per-range mode resolution for killWordOuter's own
	// multi-range loop below: a Source Mode table row gets its own
	// walkSegments-based handling (resolveKillWordRangeSourceMode);
	// everything else falls back to plain-text line-crossing word search
	// (resolveKillWordRangeNonTable) — decided independently per range.
	private resolveKillWordRangeOuter(editor: Editor, pos: { line: number; ch: number }, forward: boolean):
			{ kind: 'noop' } | { kind: 'found'; from: number; to: number; killText: string } {
		const lineText = editor.getLine(pos.line);
		const inSourceTable = !this.isLivePreviewMode() && this.isTableLineSourceMode(lineText);
		if (inSourceTable) {
			const info = getInCellLineInfo(lineText, pos.ch);
			if (info) return this.resolveKillWordRangeSourceMode(editor, pos, lineText, info, forward);
		}
		return this.resolveKillWordRangeNonTable(editor, pos, forward);
	}

	// Pure (no dispatch) per-range resolution for the plain-text case —
	// free to cross line boundaries (mirroring moveCursorWordPlainText's
	// own plain-text search), since a plain-text document has no
	// structural segment boundary to respect, and real Emacs's own
	// kill-word/backward-kill-word don't stop at line breaks either.
	// Stops at a table boundary instead of searching into it (same
	// "isPositionInTable(..., 1)" check moveCursorRight/Left already use
	// for the identical plain-text-to-table edge) — the search itself
	// doesn't know what a table is, so without this guard it would happily
	// treat an adjacent table row's raw Markdown (e.g. a leading `|`) as
	// ordinary word/punctuation text, corrupting the table by killing into it.
	private resolveKillWordRangeNonTable(editor: Editor, pos: { line: number; ch: number }, forward: boolean):
			{ kind: 'noop' } | { kind: 'found'; from: number; to: number; killText: string } {
		let lineNum = pos.line;
		let ch = pos.ch;
		let target: { line: number; ch: number } | null = null;
		for (;;) {
			const lt = editor.getLine(lineNum);
			const span = findWordSpanOnLine(lt, ch, forward);
			if (span) {
				target = { line: lineNum, ch: forward ? span.to : span.from };
				break;
			}
			const nextLine = forward ? lineNum + 1 : lineNum - 1;
			if (nextLine < 0 || nextLine >= editor.lineCount()) break;
			if (this.isPositionInTable(editor, nextLine, 1)) break;
			lineNum = nextLine;
			ch = forward ? 0 : editor.getLine(lineNum).length;
		}
		if (!target) return { kind: 'noop' };

		const from = forward ? pos : target;
		const to   = forward ? target : pos;
		return {
			kind: 'found',
			from: editor.posToOffset(from),
			to: editor.posToOffset(to),
			killText: editor.getRange(from, to),
		};
	}

	// Multi-cursor-safe: each range kills its own word independently
	// (forward or backward from its own head), joined with '\n' into one
	// kill-cache entry (same convention as Kill Region/Kill Line). The
	// resulting cursor always lands at each range's own `from` (the word's
	// own start either way — forward kill's `from` is the original head
	// unmoved; backward kill's `from` is the found target, behind the
	// original head). `prepend` (backward kill builds the cache in buffer
	// order across consecutive kills) applies to the whole joined text,
	// same as the single-cursor version's own updateKillCache(text, !forward)
	// — range order within one press is always document order regardless.
	private killWordOuter(editor: Editor, forward: boolean) {
		const cm = editor.cm;
		const sel = cm.state.selection;
		const main = sel.main;
		const changes: { from: number; to: number; insert: string }[] = [];
		const entries: ({ kind: 'cursor'; pos: number })[] = [];
		let newMainIndex = -1;
		const killedTexts: string[] = [];

		sel.ranges.forEach(range => {
			const isMain = range === main;
			const result = this.resolveKillWordRangeOuter(editor, editor.offsetToPos(range.head), forward);
			if (result.kind === 'noop') {
				if (isMain) newMainIndex = entries.length;
				entries.push({ kind: 'cursor', pos: range.head });
				return;
			}
			changes.push({ from: result.from, to: result.to, insert: '' });
			killedTexts.push(result.killText);
			if (isMain) newMainIndex = entries.length;
			entries.push({ kind: 'cursor', pos: result.from });
		});
		if (killedTexts.length === 0) return;

		this.updateKillCache(killedTexts.join('\n'), !forward);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		const selection = EditorSelection.create(this.mapSelectionAfterChanges(cm, changes, entries), newMainIndex);
		this.isDispatchingKill = true;
		cm.dispatch({ changes, selection, userEvent: 'delete' });
		this.isDispatchingKill = false;
		this.isKillChaining = true;
	}

	// LP table cell: mirrors killLineInTableLP's own inner-view-coordinate
	// approach (each <br>-segment is its own doc line there). Unlike the old
	// version of this method, walks forward/backward across further
	// in-cell doc lines (via inner.state.doc.line — the inner-view
	// equivalent of killWordNonTable's own editor.getLine walk) whenever the
	// current segment has no word left, only stopping once nextLineNum falls
	// outside [1, inner.state.doc.lines] — i.e. genuinely at the cell's own
	// first/last segment, not just any segment edge. The final deletion
	// range can span the \n between segments (the inner view's own <br>
	// representation — see moveByWords' identical comment elsewhere in this
	// codebase), so no separate <br>-stripping step is needed here the way
	// Kill Line's own <br>-removal branch requires.
	// Pure (no dispatch) per-range resolution for killWordInTableLP's own
	// multi-range loop below — mirrors the single-cursor logic exactly:
	// walks further in-cell doc lines (the inner-view equivalent of
	// resolveKillWordRangeNonTable's own editor.getLine walk) whenever the
	// current segment has no word left, only stopping once nextLineNum
	// falls outside [1, inner.state.doc.lines] — i.e. genuinely at the
	// cell's own first/last segment, not just any segment edge. The final
	// deletion range can span the \n between segments (the inner view's
	// own <br> representation), so no separate <br>-stripping step is
	// needed here the way Kill Line's own <br>-removal branch requires.
	private resolveKillWordRangeInCell(inner: EditorView, head: number, forward: boolean):
			{ kind: 'noop' } | { kind: 'found'; from: number; to: number; killText: string } {
		let subLine = inner.state.doc.lineAt(head);
		let localHead = head - subLine.from;
		let target: number | null = null;

		for (;;) {
			const span = findWordSpanOnLine(subLine.text, localHead, forward);
			if (span) {
				target = subLine.from + (forward ? span.to : span.from);
				break;
			}
			const nextLineNum = forward ? subLine.number + 1 : subLine.number - 1;
			if (nextLineNum < 1 || nextLineNum > inner.state.doc.lines) break;
			subLine = inner.state.doc.line(nextLineNum);
			localHead = forward ? 0 : subLine.text.length;
		}
		if (target === null) return { kind: 'noop' };

		const from = forward ? head : target;
		const to   = forward ? target : head;
		return { kind: 'found', from, to, killText: inner.state.doc.sliceString(from, to) };
	}

	// Multi-cursor-safe — same shape as killWordOuter above, operating on
	// the cell's own inner view coordinates directly.
	private killWordInTableLP(editor: Editor, forward: boolean) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) return;

		const sel = inner.state.selection;
		const main = sel.main;
		const changes: { from: number; to: number; insert: string }[] = [];
		const entries: ({ kind: 'cursor'; pos: number })[] = [];
		let newMainIndex = -1;
		const killedTexts: string[] = [];

		sel.ranges.forEach(range => {
			const isMain = range === main;
			const result = this.resolveKillWordRangeInCell(inner, range.head, forward);
			if (result.kind === 'noop') {
				if (isMain) newMainIndex = entries.length;
				entries.push({ kind: 'cursor', pos: range.head });
				return;
			}
			changes.push({ from: result.from, to: result.to, insert: '' });
			killedTexts.push(result.killText);
			if (isMain) newMainIndex = entries.length;
			entries.push({ kind: 'cursor', pos: result.from });
		});
		if (killedTexts.length === 0) return;

		this.updateKillCache(killedTexts.join('\n'), !forward);
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		const selection = EditorSelection.create(this.mapSelectionAfterChanges(inner, changes, entries), newMainIndex);
		this.isDispatchingKill = true;
		inner.dispatch({ changes, selection, userEvent: 'delete' });
		this.isDispatchingKill = false;
		this.isKillChaining = true;
	}

	// Pure (no dispatch) per-range resolution for a Source Mode table row —
	// mirrors the single-cursor logic exactly: walks further in-cell lines
	// via walkSegments (the same primitive moveCursorWordInTable already
	// uses for its own in-cell walk) whenever the current segment has no
	// word left, stopping only once walkSegments reports steps===0
	// (genuinely the cell's own first/last segment). Reads/writes outer
	// (raw markdown) coordinates, so — unlike the LP branch above —
	// normalizeKillText is needed (escaped \| in the raw source); a
	// crossed <br> tag is included in the raw slice and normalized to \n
	// the same way a crossed-segment kill already handles it elsewhere in
	// this file.
	private resolveKillWordRangeSourceMode(editor: Editor, pos: { line: number; ch: number }, lineText: string, info: InCellLineInfo, forward: boolean):
			{ kind: 'noop' } | { kind: 'found'; from: number; to: number; killText: string } {
		let segInfo = info;
		let localCh = pos.ch - segInfo.startOfInCellLine;
		let target: number | null = null;

		for (;;) {
			const scopedText = lineText.slice(segInfo.startOfInCellLine, segInfo.endOfInCellLine);
			const span = findWordSpanOnLine(scopedText, localCh, forward);
			if (span) {
				target = segInfo.startOfInCellLine + (forward ? span.to : span.from);
				break;
			}
			const { segInfo: nextSeg, steps } = this.walkSegments(lineText, segInfo, forward, 1);
			if (steps === 0) break;
			segInfo = nextSeg;
			localCh = forward ? 0 : segInfo.endOfInCellLine - segInfo.startOfInCellLine;
		}
		if (target === null) return { kind: 'noop' };

		const from = forward ? pos.ch : target;
		const to   = forward ? target : pos.ch;
		return {
			kind: 'found',
			from: editor.posToOffset({ line: pos.line, ch: from }),
			to: editor.posToOffset({ line: pos.line, ch: to }),
			killText: this.normalizeKillText(lineText.slice(from, to)),
		};
	}


	//===========================================================================
	// Uppercase word / Lowercase word / Capitalize word (Emacs Alt-U/L/C)
	//===========================================================================

	// DWIM (do-what-i-mean): a non-empty selection transforms the whole
	// selection (same table-awareness as Copy/Kill Region — Source Mode
	// table rows stay single-cell only, see isValidRegionRangeOuter);
	// otherwise transforms the WHOLE word at the cursor. Deliberately
	// diverges from real Emacs's own upcase-word/downcase-word/
	// capitalize-word, which only transform from point to the word's own end
	// (e.g. "he|llo" -> "heLLO", leaving "he" untouched) — mid-word partial
	// transforms are unintuitive, and the divergence matters most visibly
	// for capitalize-word, where a partially-capitalized word looks broken.
	// Table-aware: unlike Kill word, crosses into an adjacent cell/row when
	// the current one has no further word (matching Word right/left) rather
	// than stopping — case transformation never touches non-letter
	// characters, so there's no `|`/`<br>` corruption risk the way a kill
	// has, and the design principle established for Kill word ("cell is a
	// document boundary") only exists to guard against that risk.
	//
	// The selection-vs-word choice is made per RANGE, not once for the
	// whole command based on primary alone — see
	// transformWordOrSelectionNonTable/InTableLP below, which each decide
	// independently per range. Only two things are still structurally
	// primary-only, both because they collapse the whole selection by
	// their very nature: entering a table row (reaching a hand-off to
	// Word right/left's own crossing logic), and Source Mode table-row
	// word search (transformWordInTableSourceMode, unchanged, out of
	// scope — Source Mode has no inner view to loop ranges over the way
	// Live Preview cells do).
	private transformWord(editor: Editor, transform: (s: string) => string) {
		if (editor.inTableCell) {
			this.transformWordOrSelectionInTableLP(editor, transform);
			return;
		}

		const from = editor.getCursor('from');
		const to = editor.getCursor('to');
		if (from.line === to.line && from.ch === to.ch) {
			const lineText = editor.getLine(from.line);
			const inSourceTable = !this.isLivePreviewMode() && this.isTableLineSourceMode(lineText);
			if (inSourceTable) {
				const info = getInCellLineInfo(lineText, from.ch);
				if (info) {
					this.transformWordInTableSourceMode(editor, transform, info);
					return;
				}
			}
		}

		this.transformWordOrSelectionNonTable(editor, transform);
	}

	// Pure (no dispatch) per-range validity check for a non-empty range:
	// inside a Source Mode table row, the range must stay on one line and
	// within a single cell's own bounds (same constraint
	// getValidatedRegionText used to enforce for Kill Region/Copy Region's
	// own primary-only selection, now shared by all three of those commands
	// plus Uppercase/Lowercase/Capitalize word's own selection-mode, each
	// looping this per range instead of checking primary alone).
	private isValidRegionRangeOuter(editor: Editor, from: { line: number; ch: number }, to: { line: number; ch: number }): boolean {
		const fromLine = editor.getLine(from.line);
		const toLine   = editor.getLine(to.line);
		const inSourceTable = !this.isLivePreviewMode() && (
			this.isTableLineSourceMode(fromLine) ||
			this.isTableLineSourceMode(toLine)
		);
		if (!inSourceTable) return true;

		if (from.line !== to.line) return false;
		const fromBounds = getCellBounds(fromLine, from.ch);
		const toBounds   = getCellBounds(fromLine, to.ch);
		return !!fromBounds && !!toBounds && fromBounds.open === toBounds.open;
	}

	// Pure (no dispatch) per-range mode resolution for
	// transformWordOrSelectionNonTable's own loop: a non-empty range
	// transforms its own selection span (DWIM); an empty range falls back
	// to a forward word search from point, reusing the existing
	// findWordTargetPlainTextForTransform walk unchanged.
	private resolveWordOrSelectionRangeOuter(editor: Editor, range: SelectionRange):
			{ kind: 'selection'; from: number; to: number }
			| { kind: 'invalid' }
			| { kind: 'word-found'; from: number; to: number }
			| { kind: 'word-noMove' }
			| { kind: 'table'; tableLine: number } {
		if (range.from !== range.to) {
			const from = editor.offsetToPos(range.from);
			const to = editor.offsetToPos(range.to);
			if (!this.isValidRegionRangeOuter(editor, from, to)) return { kind: 'invalid' };
			return { kind: 'selection', from: range.from, to: range.to };
		}
		const wordResult = this.findWordTargetPlainTextForTransform(editor, editor.offsetToPos(range.head));
		if (wordResult.kind === 'table') return { kind: 'table', tableLine: wordResult.tableLine };
		if (wordResult.kind === 'noMove') return { kind: 'word-noMove' };
		return { kind: 'word-found', from: wordResult.from, to: wordResult.to };
	}

	// Multi-cursor-safe: each range independently either transforms its own
	// non-empty selection, or searches forward for a word from point —
	// see resolveWordOrSelectionRangeOuter above. Uppercase/Lowercase/
	// Capitalize never change a span's own length (only character case), so
	// each range's resulting cursor is simply its own unchanged `to` offset
	// — no position-remapping through the changeset is needed.
	private transformWordOrSelectionNonTable(editor: Editor, transform: (s: string) => string) {
		// Unconditional, same simplification as Delete char/Transpose
		// chars/Kill word (c79622c): a precise "did a selection actually
		// get consumed" guard would need to be per-range, and markActive
		// is a single global flag — clearing it here is harmless even when
		// every range turns out to be in word-search mode (no selection
		// existed to begin with, so the mark was never active).
		this.markActive = false;
		const cm = editor.cm;
		const sel = cm.state.selection;
		const main = sel.main;
		const mainIndex = sel.ranges.indexOf(main);
		const results = sel.ranges.map(range => this.resolveWordOrSelectionRangeOuter(editor, range));
		const mainResult = results[mainIndex];

		if (mainResult.kind === 'table') {
			// Primary's own search reaches a table row: hand off entirely to
			// the existing single-cursor entry+continuation path, which
			// already collapses the whole selection down to primary on its
			// own (setCursorViaCm inside landInRowEdgeCellForWord) — same as
			// moveCursorWordPlainText's own primary-crosses case. A real
			// selection on primary can never reach this branch (only an
			// empty range's own word search returns 'table').
			this.continueWordTransformAfterLanding(editor, this.landInRowEdgeCellForWord(editor, mainResult.tableLine, true, false, false), transform);
			return;
		}

		let changed = false;
		let newMainIndex = -1;
		const changes: { from: number; to: number; insert: string }[] = [];
		const kept: SelectionRange[] = [];
		sel.ranges.forEach((range, i) => {
			const result = results[i];
			const isMain = range === main;
			if (!isMain && result.kind === 'table') {
				// Would cross into a table the primary isn't — dropped entirely
				// (no sensible position to keep it at once collapsed).
				changed = true;
				return;
			}
			if (result.kind === 'table') return; // unreachable: mainResult.kind !== 'table' was already checked above.
			if (result.kind === 'invalid' || result.kind === 'word-noMove') {
				// Left untouched: an invalid selection (e.g. crosses a Source
				// Mode table-row boundary) or a word search that found nothing
				// further on this range's own line — primary's own
				// invalidity no longer blocks the whole command; other valid
				// ranges still proceed.
				if (isMain) newMainIndex = kept.length;
				kept.push(range);
				return;
			}
			changed = true;
			const original = editor.getRange(editor.offsetToPos(result.from), editor.offsetToPos(result.to));
			changes.push({ from: result.from, to: result.to, insert: transform(original) });
			if (isMain) newMainIndex = kept.length;
			kept.push(EditorSelection.cursor(result.to));
		});
		if (!changed) return;
		cm.dispatch({ changes, selection: EditorSelection.create(kept, newMainIndex), userEvent: 'input' });
	}

	// Pure (no dispatch) per-range word search for
	// transformWordOrSelectionNonTable's own loop above — same walk as
	// findWordTargetPlainText, but forward-only (Uppercase/Lowercase/
	// Capitalize always search forward from point, unlike Word left/right)
	// and returns the found word's own {from, to} span rather than just a
	// landing ch, since the caller needs to read and replace that span's
	// text.
	private findWordTargetPlainTextForTransform(editor: Editor, from: { line: number; ch: number }):
			{ kind: 'noMove' }
			| { kind: 'found'; from: number; to: number }
			| { kind: 'table'; tableLine: number } {
		let lineNum = from.line;
		let ch = from.ch;
		for (;;) {
			const lineText = editor.getLine(lineNum);
			const span = findWordSpanOnLine(lineText, ch, true);
			if (span) {
				return {
					kind: 'found',
					from: editor.posToOffset({ line: lineNum, ch: span.from }),
					to: editor.posToOffset({ line: lineNum, ch: span.to }),
				};
			}
			const nextLine = lineNum + 1;
			if (nextLine >= editor.lineCount()) return { kind: 'noMove' };
			if (this.isPositionInTable(editor, nextLine, 1)) {
				return { kind: 'table', tableLine: nextLine };
			}
			lineNum = nextLine;
			ch = 0;
		}
	}

	// Pure (no dispatch) per-range mode resolution for
	// transformWordOrSelectionInTableLP's own loop: a non-empty range
	// transforms its own selection span (DWIM) — always valid here, since
	// a single cell's own inner view can't span multiple cells/rows to
	// begin with, unlike the outer case above. An empty range falls back
	// to a forward word search within the cell, reusing the existing
	// findWordTargetInCellForTransform walk unchanged.
	private resolveWordOrSelectionRangeInCell(inner: EditorView, range: SelectionRange):
			{ kind: 'selection'; from: number; to: number }
			| { kind: 'word-found'; from: number; to: number }
			| { kind: 'exit' } {
		if (range.from !== range.to) return { kind: 'selection', from: range.from, to: range.to };
		const wordResult = this.findWordTargetInCellForTransform(inner, range);
		if (wordResult.kind === 'exit') return { kind: 'exit' };
		return { kind: 'word-found', from: wordResult.from, to: wordResult.to };
	}

	// Multi-cursor-safe — same shape as transformWordOrSelectionNonTable
	// above, but this cell's own word search is already expressed in the
	// INNER view's own coordinates (unlike moveCursorWordInTable's
	// OUTER-raw-line search), so no inner/outer bridging is needed here at
	// all.
	private transformWordOrSelectionInTableLP(editor: Editor, transform: (s: string) => string) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) return;
		// Unconditional — see transformWordOrSelectionNonTable's identical
		// comment above.
		this.markActive = false;

		const sel = inner.state.selection;
		const main = sel.main;
		const mainIndex = sel.ranges.indexOf(main);
		const results = sel.ranges.map(range => this.resolveWordOrSelectionRangeInCell(inner, range));
		const mainResult = results[mainIndex];

		if (mainResult.kind === 'exit') {
			// Primary's own search exhausted this cell: hand off entirely to
			// the existing single-cursor cross-row/cell continuation path,
			// which already collapses to one range on its own (setCursorViaCm
			// inside crossTableRowForWord) — same policy as everywhere else.
			// A real selection on primary can never reach this branch (only
			// an empty range's own word search returns 'exit').
			const outerCursor = editor.getCursor();
			const outerLineText = editor.getLine(outerCursor.line);
			const cellIndex = getCellIndex(outerLineText, outerCursor.ch);
			this.continueWordTransformAfterLanding(editor, this.crossTableRowForWord(editor, cellIndex, true, false, false, true), transform);
			return;
		}

		let changed = false;
		let newMainIndex = -1;
		const changes: { from: number; to: number; insert: string }[] = [];
		const kept: SelectionRange[] = [];
		sel.ranges.forEach((range, i) => {
			const result = results[i];
			const isMain = range === main;
			if (!isMain && result.kind === 'exit') {
				// Would leave this cell while the primary isn't — dropped
				// entirely (no sensible position to keep it at once collapsed).
				changed = true;
				return;
			}
			if (result.kind === 'exit') return; // unreachable: mainResult.kind !== 'exit' was already checked above.
			changed = true;
			const original = inner.state.doc.sliceString(result.from, result.to);
			changes.push({ from: result.from, to: result.to, insert: transform(original) });
			if (isMain) newMainIndex = kept.length;
			kept.push(EditorSelection.cursor(result.to));
		});
		if (!changed) return;
		inner.dispatch({ changes, selection: EditorSelection.create(kept, newMainIndex), userEvent: 'input' });
	}

	// Pure (no dispatch) per-range word search within the current cell, for
	// transformWordOrSelectionInTableLP's multi-cursor loop above.
	private findWordTargetInCellForTransform(inner: EditorView, range: SelectionRange):
			{ kind: 'exit' } | { kind: 'found'; from: number; to: number } {
		let subLine = inner.state.doc.lineAt(range.head);
		let localHead = range.head - subLine.from;
		for (;;) {
			const span = findWordSpanOnLine(subLine.text, localHead, true);
			if (span) {
				return { kind: 'found', from: subLine.from + span.from, to: subLine.from + span.to };
			}
			const nextLineNum = subLine.number + 1;
			if (nextLineNum > inner.state.doc.lines) return { kind: 'exit' };
			subLine = inner.state.doc.line(nextLineNum);
			localHead = 0;
		}
	}

	// Source Mode table cell: like moveCursorWordInTable/killWordInTableSourceMode
	// (the Source Mode side), walks further in-cell lines via walkSegments,
	// then crosses into the adjacent cell/row once the cell is exhausted.
	private transformWordInTableSourceMode(editor: Editor, transform: (s: string) => string, info: InCellLineInfo) {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);

		let segInfo = info;
		let localCh = cursor.ch - segInfo.startOfInCellLine;

		for (;;) {
			const scopedText = lineText.slice(segInfo.startOfInCellLine, segInfo.endOfInCellLine);
			const span = findWordSpanOnLine(scopedText, localCh, true);
			if (span) {
				const from = { line: cursor.line, ch: segInfo.startOfInCellLine + span.from };
				const to = { line: cursor.line, ch: segInfo.startOfInCellLine + span.to };
				const original = editor.getRange(from, to);
				editor.replaceRange(transform(original), from, to);
				// replaceRange has no cursor-positioning parameter, defaults
				// to the replaced range's own start rather than its end.
				this.setCursorViaCm(editor, cursor.line, to.ch);
				return;
			}
			const { segInfo: nextSeg, steps } = this.walkSegments(lineText, segInfo, true, 1);
			if (steps === 0) break;
			segInfo = nextSeg;
			localCh = 0;
		}

		const cellIndex = getCellIndex(lineText, cursor.ch);
		this.continueWordTransformAfterLanding(editor, this.crossTableRowForWord(editor, cellIndex, true, false, false, true), transform);
	}

	// Shared tail for transformWordOrSelectionNonTable's table-entry case
	// and transformWordOrSelectionInTableLP/SourceMode's own
	// cell-exhausted case: landed is already sitting exactly at the target
	// word's own start (forward=true, wordEnd=false — the crossing
	// functions' own word-START convention, no +1 caret correction needed
	// since there's no word-END involved here the way Word right/left
	// needs). Hands off to whichever branch matches where the crossing
	// actually landed — including handing back to
	// transformWordOrSelectionNonTable if it exited the table entirely, so
	// a wordless exit line doesn't just strand the search the way it used
	// to for Word right/left before that was fixed.
	private continueWordTransformAfterLanding(editor: Editor, landed: { line: number; ch: number } | null, transform: (s: string) => string) {
		if (!landed) return;
		if (editor.inTableCell) {
			this.transformWordOrSelectionInTableLP(editor, transform);
			return;
		}
		const lineText = editor.getLine(landed.line);
		const info = getInCellLineInfo(lineText, landed.ch);
		if (info) {
			this.transformWordInTableSourceMode(editor, transform, info);
		} else {
			this.transformWordOrSelectionNonTable(editor, transform);
		}
	}

	// CJK-aware (via getWordSpans): capitalizes each word independently
	// (first character upper, rest lower), leaving whitespace/punctuation
	// between words untouched — matches real Emacs's own capitalize-region
	// behavior for multi-word text, and naturally handles both the
	// single-word (no-selection) and multi-word (selection) cases with the
	// same function.
	private static capitalizeText(text: string): string {
		const spans = getWordSpans(text);
		let result = '';
		let last = 0;
		for (const span of spans) {
			result += text.slice(last, span.from);
			const word = text.slice(span.from, span.to);
			result += word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
			last = span.to;
		}
		result += text.slice(last);
		return result;
	}


	private normalizeKillText(text: string): string {
		return text.replace(/<[bB][rR]>/g, '\n').replace(/\\\|/g, '|');
	}


	// prepend is for backward kills (Kill word left): consecutive backward
	// kills must build the cache in the same order the text appeared in the
	// buffer, so newly killed text goes in front of what's already cached,
	// not after it — the reverse of every other (forward) kill in this file.
	private updateKillCache(text: string, prepend = false): void {
		if (!this.isKillChaining) { this.killCache = text; return; }
		this.killCache = prepend ? text + this.killCache : this.killCache + text;
	}


	// CM6's own TransactionSpec.selection contract: "offsets in this
	// selection should refer to the document as it is AFTER the
	// transaction" — unlike Uppercase/Lowercase/Capitalize word's own
	// multi-range dispatches (safe to use pre-change offsets directly,
	// since every one of those changes preserves its own span's length
	// exactly, making old and new offsets always identical), a kill's own
	// changes shrink the document, a yank's own changes can grow or shrink
	// it — so every "kept"/"cursor" entry computed from PRE-change offsets
	// must be re-expressed in POST-change coordinates before being handed
	// to dispatch, or every range after an earlier, differently-sized
	// change ends up silently pointing at the wrong place. `entries` is
	// built with pre-change offsets throughout the caller's own loop, then
	// mapped through the real ChangeSet in one pass here, once `changes`
	// is final.
	//
	// `assoc=1` for the 'cursor' case specifically: a zero-width position
	// sitting exactly at a change's own boundary is ambiguous about which
	// side it should stick to, and mapPos's own default resolves to
	// BEFORE the change — confirmed live (a cursor placed via an empty
	// range, e.g. Yank's own common case, mapped back to its pre-insert
	// position instead of landing after the just-inserted text). assoc=1
	// forces "stick to the content after," which is always what every
	// caller here wants (both Yank's own insertion-end placement and Kill
	// Region's own deletion-collapse, confirmed safe for the latter too —
	// a NON-zero-width original span has no such ambiguity to begin with,
	// so assoc is a no-op there regardless of its value).
	private mapSelectionAfterChanges(
		cm: EditorView,
		changes: { from: number; to: number; insert: string }[],
		entries: ({ kind: 'cursor'; pos: number } | { kind: 'range'; from: number; to: number })[],
	): SelectionRange[] {
		const changeSet = cm.state.changes(changes);
		return entries.map(e => e.kind === 'cursor'
			? EditorSelection.cursor(changeSet.mapPos(e.pos, 1))
			: EditorSelection.range(changeSet.mapPos(e.from), changeSet.mapPos(e.to)));
	}

	// Pure (no dispatch) per-range text extractor for Copy/Kill Region's own
	// multi-range loops below — empty or invalid (isValidRegionRangeOuter)
	// ranges return null, same "nothing to do with this one" signal as
	// resolveWordOrSelectionRangeOuter's own 'invalid' kind.
	private extractRegionRangeTextOuter(editor: Editor, range: SelectionRange): string | null {
		if (range.from === range.to) return null;
		const from = editor.offsetToPos(range.from);
		const to = editor.offsetToPos(range.to);
		if (!this.isValidRegionRangeOuter(editor, from, to)) return null;
		const rawText = editor.getRange(from, to);
		const fromLine = editor.getLine(from.line);
		const inSourceTable = !this.isLivePreviewMode() && this.isTableLineSourceMode(fromLine);
		return inSourceTable ? this.normalizeKillText(rawText) : rawText;
	}


	//===========================================================================
	// Copy region (Alt-W)
	//===========================================================================

	// Non-destructive kill-ring-save: same per-range validation/normalization
	// as Kill Region, breaks any in-progress Kill Line chain the same way
	// Kill Region does (a copy is not a "kill", so it shouldn't silently
	// append to a pending kill-line sequence, nor become chainable itself —
	// unlike every kill command below, this never sets isKillChaining back
	// to true), but never mutates the editor — every selection stays exactly
	// as the user left it, matching a plain Copy.
	private copyRegion(editor: Editor) {
		if (editor.inTableCell) {
			this.copyRegionInTableLP(editor);
			return;
		}

		const sel = editor.cm.state.selection;
		const texts: string[] = [];
		sel.ranges.forEach(range => {
			const text = this.extractRegionRangeTextOuter(editor, range);
			if (text !== null) texts.push(text);
		});
		if (texts.length === 0) return;

		this.markActive = false;
		this.isKillChaining = false;
		this.collapseActiveSelectionToHead(editor);
		this.updateKillCache(texts.join('\n'));
		navigator.clipboard.writeText(this.killCache).catch(() => {});
	}

	// Multi-cursor-safe: every non-empty range within the active cell's own
	// inner view is a valid selection (a single cell's own inner view can't
	// span multiple cells/rows to begin with — same reasoning
	// transformWordOrSelectionInTableLP's own selection-mode branch uses).
	private copyRegionInTableLP(editor: Editor) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) return;

		const sel = inner.state.selection;
		const texts: string[] = [];
		sel.ranges.forEach(range => {
			if (range.from === range.to) return;
			texts.push(inner.state.doc.sliceString(range.from, range.to));
		});
		if (texts.length === 0) return;

		this.markActive = false;
		this.isKillChaining = false;
		this.collapseActiveSelectionToHead(editor);
		this.updateKillCache(texts.join('\n'));
		navigator.clipboard.writeText(this.killCache).catch(() => {});
	}


	//===========================================================================
	// Kill region (Ctrl-W)
	//===========================================================================

	// Multi-cursor-safe: every range independently kills its own selection
	// (or is left untouched — not removed, same as Uppercase/Lowercase/
	// Capitalize word's own invalid-selection policy — if it's empty or its
	// own selection is invalid), joining all killed texts with '\n' into one
	// kill-cache entry (matching native Obsidian's own observed multi-cut
	// behavior) rather than tracking a separate entry per cursor — Yank's
	// own multi-cursor distribution reconstructs per-cursor pieces from this
	// single joined string by matching line count to cursor count at paste
	// time, not from any memory of how many cursors produced it.
	private killRegion(editor: Editor) {
		if (editor.inTableCell) {
			this.killRegionInTableLP(editor);
			return;
		}

		const cm = editor.cm;
		const sel = cm.state.selection;
		const main = sel.main;
		const changes: { from: number; to: number; insert: string }[] = [];
		const entries: ({ kind: 'cursor'; pos: number } | { kind: 'range'; from: number; to: number })[] = [];
		let newMainIndex = -1;
		const killedTexts: string[] = [];

		sel.ranges.forEach(range => {
			const isMain = range === main;
			const text = this.extractRegionRangeTextOuter(editor, range);
			if (text === null) {
				if (isMain) newMainIndex = entries.length;
				entries.push({ kind: 'range', from: range.from, to: range.to });
				return;
			}
			killedTexts.push(text);
			changes.push({ from: range.from, to: range.to, insert: '' });
			if (isMain) newMainIndex = entries.length;
			entries.push({ kind: 'cursor', pos: range.from });
		});
		if (killedTexts.length === 0) return;

		this.markActive = false;
		this.isKillChaining = false;
		this.updateKillCache(killedTexts.join('\n'));
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		const selection = EditorSelection.create(this.mapSelectionAfterChanges(cm, changes, entries), newMainIndex);
		this.isDispatchingKill = true;
		cm.dispatch({ changes, selection, userEvent: 'delete' });
		this.isDispatchingKill = false;
		this.isKillChaining = true;
	}

	// Multi-cursor-safe LP-cell counterpart — plain selection delete per
	// range, matching real Emacs's own kill-region (only ever removes
	// exactly what's selected; see project_kill_region_lp_cell_edge_newline_bug
	// for why the single-cursor version of this once auto-consumed the
	// following newline too, and why that was removed). savedScroll
	// preserves the pre-existing single-cursor behavior of not letting the
	// deletion itself cause a visible scroll jump.
	private killRegionInTableLP(editor: Editor) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) return;

		const sel = inner.state.selection;
		const main = sel.main;
		const changes: { from: number; to: number; insert: string }[] = [];
		const entries: ({ kind: 'cursor'; pos: number } | { kind: 'range'; from: number; to: number })[] = [];
		let newMainIndex = -1;
		const killedTexts: string[] = [];

		sel.ranges.forEach(range => {
			const isMain = range === main;
			if (range.from === range.to) {
				if (isMain) newMainIndex = entries.length;
				entries.push({ kind: 'range', from: range.from, to: range.to });
				return;
			}
			killedTexts.push(inner.state.doc.sliceString(range.from, range.to));
			changes.push({ from: range.from, to: range.to, insert: '' });
			if (isMain) newMainIndex = entries.length;
			entries.push({ kind: 'cursor', pos: range.from });
		});
		if (killedTexts.length === 0) return;

		this.markActive = false;
		this.isKillChaining = false;
		this.updateKillCache(killedTexts.join('\n'));
		navigator.clipboard.writeText(this.killCache).catch(() => {});
		const selection = EditorSelection.create(this.mapSelectionAfterChanges(inner, changes, entries), newMainIndex);
		const savedScroll = editor.cm?.scrollDOM?.scrollTop;
		this.isDispatchingKill = true;
		inner.dispatch({ changes, selection });
		this.isDispatchingKill = false;
		this.isKillChaining = true;
		if (savedScroll !== undefined) editor.cm.scrollDOM.scrollTop = savedScroll;
	}


	//===========================================================================
	// Yank (Ctrl-Y)
	//===========================================================================

	// Pure: splits `raw` by '\n' into exactly `cursorCount` pieces if the
	// line count matches: one piece per cursor, in document order — the
	// VS Code/Sublime-style distribution the user asked to add on top of
	// native Obsidian's own observed Cmd-V behavior. Otherwise returns
	// `cursorCount` copies of the whole `raw` string (today's single-
	// cursor-equivalent behavior, replicated at every cursor), matching
	// that native fallback. Per the user's own confirmed spec: which
	// cursor count originally produced a kill is never tracked anywhere —
	// only whether the clipboard's CURRENT line count matches the CURRENT
	// cursor count at paste time ("3-cursor kill -> 3-cursor yank" and
	// "1-cursor 3-line kill -> 3-cursor yank" are indistinguishable, and
	// that's fine).
	private splitYankTextForCursors(raw: string, cursorCount: number): string[] {
		const lines = raw.split('\n');
		if (lines.length === cursorCount) return lines;
		return new Array<string>(cursorCount).fill(raw);
	}

	// Pure: detects whether `text` begins with a list-marker token — bullet
	// (`-`/`*`/`+`) or ordered (`N.`/`N)`), optionally followed by a task
	// checkbox (`[ ]`/`[x]`/etc) — tolerating (and consuming) any leading
	// whitespace before the marker itself. Confirmed live against native
	// Obsidian's own paste dedup (1.14+): a leading space before the pasted
	// marker doesn't block detection, but extra whitespace AFTER the marker
	// beyond the single space this regex consumes is left untouched as
	// ordinary content (see dedupListMarkerOnPaste below). Returns null if
	// `text` has no list marker at all.
	private parseListMarkerToken(text: string): { checkboxState: string | null; afterMarker: number } | null {
		const m = text.match(/^\s*(?:[-*+]|\d+[.)])\s(?:\[(.)\]\s)?/);
		if (!m) return null;
		return { checkboxState: m[1] ?? null, afterMarker: m[0].length };
	}

	// Pure: the single point of control for Yank's own list-marker paste
	// dedup (see the external 0.12.0 planning note's "Yankペースト重複排除"
	// section for the full spec and decision matrix this implements).
	// Deliberately not built on getBeginningOfLinePosition — that function's
	// Smart-Home-advanced prefix stripping covers headings/footnotes/callouts
	// too, which must never be in scope here regardless of that setting:
	// dedup only applies where a construct both (1) auto-continues its own
	// marker on Enter and (2) doubling that marker is meaningless, which
	// lands exactly on list markers (never blockquote `>` — doubling it is a
	// valid nested quote, not noise). `targetLineBeforeCursor` is the target
	// line's own text from its start up to (not including) the insertion
	// point; dedup only triggers when that text is itself nothing but an
	// (optionally blockquote-prefixed) list marker — i.e. the cursor is
	// sitting right where Enter just auto-continued one.
	private dedupListMarkerOnPaste(targetLineBeforeCursor: string, pasteText: string): string {
		if (!/^\s*(?:>\s?)*(?:[-*+]|\d+[.)])\s(?:\[.\]\s)?$/.test(targetLineBeforeCursor)) return pasteText;
		const pasteMarker = this.parseListMarkerToken(pasteText);
		if (!pasteMarker) return pasteText;
		const rest = pasteText.slice(pasteMarker.afterMarker);
		// Target's own list type (and existing checkbox, if any) is already
		// on the line and left untouched here — only a checkbox the PASTE
		// itself specifies gets re-inserted, overriding/adding on top of it.
		return (pasteMarker.checkboxState !== null ? `[${pasteMarker.checkboxState}] ` : '') + rest;
	}

	private async yank(editor: Editor) {
		this.markActive = false;
		this.isKillChaining = false;
		let raw: string;
		try {
			raw = await navigator.clipboard.readText();
		} catch {
			raw = this.killCache;
		}
		if (!raw) return;

		if (editor.inTableCell) {
			this.yankInTableLP(editor, raw);
			return;
		}

		this.yankOuter(editor, raw);
	}

	// Multi-cursor-safe: each range independently receives its own piece
	// (see splitYankTextForCursors), escaped for Source Mode table syntax
	// per that range's own line — a range landing on a table row while
	// another doesn't is handled per-range, same as every other multi-
	// range command in this file. Resulting cursor positions are computed
	// via mapSelectionAfterChanges (see its own doc comment): insertions
	// have no length-preservation guarantee the way Uppercase/Lowercase/
	// Capitalize word's own transforms do, so pre-change offsets can't be
	// reused directly once more than one range is involved.
	private yankOuter(editor: Editor, raw: string) {
		const cm = editor.cm;
		const sel = cm.state.selection;
		const main = sel.main;
		const pieces = this.splitYankTextForCursors(raw, sel.ranges.length);

		const changes: { from: number; to: number; insert: string }[] = [];
		const entries: { kind: 'cursor'; pos: number }[] = [];
		let newMainIndex = -1;

		sel.ranges.forEach((range, i) => {
			const isMain = range === main;
			const from = editor.offsetToPos(range.from);
			const lineText = editor.getLine(from.line);
			const inTable = this.isTableLineSourceMode(lineText);
			const piece = this.dedupListMarkerOnPaste(lineText.slice(0, from.ch), pieces[i]);
			const text = inTable ? piece.replace(/\|/g, '\\|').replace(/\n/g, '<br>') : piece;
			changes.push({ from: range.from, to: range.to, insert: text });
			if (isMain) newMainIndex = entries.length;
			entries.push({ kind: 'cursor', pos: range.to });
		});

		const selection = EditorSelection.create(this.mapSelectionAfterChanges(cm, changes, entries), newMainIndex);
		cm.dispatch({ changes, selection, userEvent: 'input' });
	}

	// Multi-cursor-safe LP-cell counterpart. The inner view uses real '\n'
	// for in-cell line breaks — no <br> conversion needed, matching every
	// other in-cell branch in this file. savedScroll preserves the
	// pre-existing single-cursor behavior of not letting the insertion
	// itself cause a visible scroll jump.
	private yankInTableLP(editor: Editor, raw: string) {
		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) return;

		const sel = inner.state.selection;
		const main = sel.main;
		const pieces = this.splitYankTextForCursors(raw, sel.ranges.length);

		const changes: { from: number; to: number; insert: string }[] = [];
		const entries: { kind: 'cursor'; pos: number }[] = [];
		let newMainIndex = -1;

		sel.ranges.forEach((range, i) => {
			const isMain = range === main;
			const subLine = inner.state.doc.lineAt(range.from);
			const beforeCursor = subLine.text.slice(0, range.from - subLine.from);
			const piece = this.dedupListMarkerOnPaste(beforeCursor, pieces[i]);
			changes.push({ from: range.from, to: range.to, insert: piece });
			if (isMain) newMainIndex = entries.length;
			entries.push({ kind: 'cursor', pos: range.to });
		});

		const selection = EditorSelection.create(this.mapSelectionAfterChanges(inner, changes, entries), newMainIndex);
		const scrollEl    = editor.cm?.scrollDOM;
		const savedScroll = scrollEl?.scrollTop;
		inner.dispatch({ changes, selection, userEvent: 'input' });
		if (scrollEl && savedScroll !== undefined) scrollEl.scrollTop = savedScroll;
	}


	//===========================================================================
	// VimSupportHost bridge implementation
	//
	// Methods vim-support.ts calls through the VimSupportHost duck-typed interface,
	// grouped here (rather than scattered near whichever existing method each one
	// happens to reuse) since more are expected as table-entry/multi-row-crossing
	// support is added. These exist only because vim-support.ts deliberately does
	// not import main.ts (file-split risk-isolation) but still needs to reuse
	// private, stateful methods below (setCursorViaCm depends on this._inScrollPage
	// and dispatches to CM6 directly) that can't be pure-function-extracted the way
	// table-cell-utils.ts's string helpers were.
	//===========================================================================

	// See vim-support.ts's scheduleRowCrossing. Reuses the same row-finding logic
	// Ctrl-N/P rely on (getNextRowLine/getPrevRowLine), but lands on the target
	// cell's first/last <br>-segment at goalCh, rather than always at
	// cell-content-start — Vim's j/k need the column preserved across the row
	// boundary, which Ctrl-N/P's own setCursorToNextRow/PrevRow don't do.
	// Returns the outer {line, ch} landed on (or null if it couldn't compute one),
	// so vim-support.ts can re-sync its own goal-column continuity cache against
	// the actual post-crossing position — see scheduleRowCrossing's own comment
	// for why that resync is necessary.
	// overshoot is how many logical lines (row-crossings and/or <br>-segments
	// combined) still need to be consumed beyond the current cell's own range —
	// see vim-support.ts's moveByLines for how it's computed. Walks row by row
	// (via getNextRowLine/PrevRowLine, so delimiter rows stay invisible exactly
	// as they are for Ctrl-N/P), consuming each row's cellIndex's own <br>-segment
	// count, until the remainder fits within one row — then lands there via
	// landInCellSegment. All reads only; no view is touched until that final landing.
	crossTableRowForCell(editor: unknown, cellIndex: number, forward: boolean, goalCh: number, overshoot: number): { line: number; ch: number } | null {
		const e = editor as Editor;
		const startLine = forward ? this.getNextRowLine(e) : this.getPrevRowLine(e);
		if (startLine === -1) {
			// Exiting the table entirely without crossing any row first (the
			// current cell is already the last/first row). fromLine = the live
			// cursor, since no walk has happened yet.
			return this.exitTableWithColumn(e, cellIndex, forward, goalCh, e.getCursor().line, overshoot);
		}
		return this.walkTableRows(e, cellIndex, forward, startLine, overshoot, goalCh);
	}

	// See vim-support.ts's own VimSupportHost.getAdjacentRowLine doc comment
	// for why this exists as its own read-only check, separate from
	// crossTableRowForCell above.
	getAdjacentRowLine(editor: unknown, forward: boolean): number {
		const e = editor as Editor;
		return forward ? this.getNextRowLine(e) : this.getPrevRowLine(e);
	}

	// See vim-support.ts's own VimSupportHost.setCursorAcrossTableBoundary doc
	// comment for why table-navigation.ts's own exitTable needs this instead
	// of the plain EditorBridge setCursor used elsewhere. exitTable's own
	// jumps can cross arbitrarily many lines (the whole height of a table) —
	// unlike setCursorViaCm's other, already-onscreen-range callers, this
	// needs the same explicit scroll-into-view follow-up
	// exitTableWithColumn/jumpToDocumentLine already use for their own
	// long-distance jumps (confirmed live: without it, the cursor can land
	// off-screen with no visible scroll).
	setCursorAcrossTableBoundary(editor: unknown, line: number, ch: number): void {
		const e = editor as Editor;
		this.setCursorViaCm(e, line, ch);
		const cm = e.cm;
		const pos = e.posToOffset({ line, ch });
		cm.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true, userEvent: 'move' });
	}

	// See vim-support.ts's own VimSupportHost.appendBlankLineAndLand doc
	// comment — mirrors setCursorToNextRow's own identical EOF fix.
	// preserveActiveSelection (default false, unchanged behavior for the
	// no-selection caller): same idiom as setCursorViaCm's own param — when
	// true, keeps the live selection's existing anchor and only extends head
	// through the newly inserted line, instead of collapsing to a point. See
	// jumpToDocumentLine's own call site for why this matters for gg/G.
	appendBlankLineAndLand(editor: unknown, preserveActiveSelection = false): void {
		const e = editor as Editor;
		const cm = e.cm;
		const current = preserveActiveSelection ? cm.state.selection.main : null;
		const hadActiveSelection = current !== null && current.anchor !== current.head;
		const lastLine = e.lastLine();
		e.replaceRange('\n', { line: lastLine, ch: e.getLine(lastLine).length });
		const pos = e.posToOffset({ line: lastLine + 1, ch: 0 });
		if (hadActiveSelection) {
			// Single dispatch, no setCursorViaCm call — its own default
			// collapsed-point dispatch would drop Visual mode here too.
			cm.dispatch({ selection: { anchor: current.anchor, head: pos }, scrollIntoView: true, userEvent: 'move' });
			// This dispatch is external to vim.js's own cm.operation(), so its
			// own cursorActivity handler (handleExternalSelection) reinterprets
			// it as if it came from a mouse drag: it shifts vim's own internal
			// selection model (vim.sel — a *separate* {anchor, head} vim.js
			// keeps for Visual mode, read by every operator: y/d/c/p all derive
			// their range from vim.sel, not this dispatch's own CM6 selection)
			// back by one character. Left alone, that stale vim.sel would still
			// point at the table's own last row, one line short of what's
			// actually highlighted — so a y/d/c run immediately after this
			// landing would silently miss the blank line just inserted (and a
			// delete would leave it behind, unremoved). Same technique
			// vim-support.ts's own resyncAfterDeferredMove already uses for
			// vim.state.lastHPos/lastHSPos after its own deferred moves — vim.js
			// assigns its per-view state directly onto cm.state.vim (not a
			// proper StateField), so it's writable from here too. Silently
			// skipped if vim.state.vim isn't there (defensive only — same
			// optional-chaining posture as that other call site).
			const vimState = (cm.state as unknown as { vim?: { visualMode?: boolean; sel?: { anchor: unknown; head: unknown } } }).vim;
			if (vimState?.visualMode && vimState.sel) {
				vimState.sel.anchor = e.offsetToPos(current.anchor);
				vimState.sel.head = e.offsetToPos(pos);
			}
		} else {
			this.setCursorViaCm(e, lastLine + 1, 0);
			// Same explicit scroll-into-view follow-up as
			// setCursorAcrossTableBoundary — see its own doc comment.
			cm.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true, userEvent: 'move' });
		}
	}

	// See vim-support.ts's own VimSupportHost.enterTableRowSmartHome doc
	// comment — the same enterTableAtLine + refineTableLandingForSmartHome
	// combo jumpToDocumentLine (gg/G) already uses below, including its own
	// explicit scroll-into-view follow-up (see jumpToDocumentLine's own doc
	// comment on why setCursorViaCm's underlying dispatches don't request one
	// on their own).
	enterTableRowSmartHome(editor: unknown, targetLine: number): { line: number; ch: number } | null {
		const e = editor as Editor;
		let result = this.enterTableAtLine(e, targetLine, 0, true, 0, 0);
		if (result) result = this.refineTableLandingForSmartHome(e, result);
		if (result) {
			const cm = e.cm;
			const pos = e.posToOffset(result);
			cm.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true, userEvent: 'move' });
		}
		return result;
	}

	// See vim-support.ts's own VimSupportHost.refineDisplayLineColumn doc
	// comment for the full rationale (step 2 of gj/gk's own row-crossing,
	// always preceded by a crossTableRowForCell(..., 0, 1) rough landing).
	// Re-finds the actual x=pixelGoal position on the cell's own newly-landed
	// visual line via coordsAtPos/posAtCoords (the same idiom
	// moveCursorUpInTable's/moveCursorDownInTable's own assoc-correction
	// already uses — see their own comments for why a small +9 y-offset
	// reliably samples a point within the line's own visual band), and
	// re-dispatches via setCursorViaCm — never a raw EditorView.dispatch — if
	// it differs from the rough landing. Never lets the correction change
	// which (inner) line the cursor is on; its job is purely horizontal.
	// allowLineEnd: Vim's gj/gk (the only other caller) needs Normal-mode-legal
	// clamping — the cursor may never rest past a line's last character. The
	// new Emacs Ctrl-N/P row-crossing (main.ts's own
	// applyRowCrossGoalColumnSync) is not modal and must be able to land one
	// past the last character (e.g. "shortcuts|"), so it passes true here.
	refineDisplayLineColumn(editor: unknown, pixelGoal: number, allowLineEnd = false): { line: number; ch: number } | null {
		const e = editor as Editor;
		const inner = e.activeCM;
		if (inner && inner !== e.cm) {
			const head = inner.state.selection.main.head;
			const resolved = universalCursorHotkeysPlugin.resolveSameLineOffset(inner, head, pixelGoal, allowLineEnd);
			if (resolved === null) return e.getCursor();

			// Convert the (confirmed same-line) refined inner ch back into an
			// outer {line, ch} — setCursorViaCm dispatches via the *outer*
			// document, same as every other table-cell landing in this file.
			const headLine = inner.state.doc.lineAt(head);
			const outerCursor = e.getCursor();
			const outerLineText = e.getLine(outerCursor.line);
			const segInfo = getInCellLineInfo(outerLineText, outerCursor.ch);
			if (!segInfo) return e.getCursor(); // shouldn't happen — we're inside a cell
			const targetOuterCh = segInfo.startOfInCellLine + (resolved - headLine.from);
			this.setCursorViaCm(e, outerCursor.line, targetOuterCh);
			return e.getCursor();
		}

		// No distinct inner view — either an empty cell, or (more commonly
		// here) the rough landing already exited the table entirely into
		// plain text, where there's no cell view left to refine against.
		// Correct directly against the outer view instead — same idiom, no
		// inner-to-outer ch conversion needed since outer ch is already real.
		const outer = e.cm;
		const outerCursor = e.getCursor();
		const head = e.posToOffset(outerCursor);
		const resolved = universalCursorHotkeysPlugin.resolveSameLineOffset(outer, head, pixelGoal, allowLineEnd);
		if (resolved === null) return outerCursor;
		const headLine = outer.state.doc.lineAt(head);
		this.setCursorViaCm(e, outerCursor.line, resolved - headLine.from);
		return e.getCursor();
	}

	// Obsidian internal API (not in obsidian.d.ts) — narrower than
	// settings.ts's own like-named ObsidianInternals, which also needs
	// hotkeyManager/setting/vault; this file only ever touches commands.
	executeObsidianCommand(commandId: string): boolean {
		return (this.app as unknown as { commands?: { executeCommandById?(id: string): boolean } })
			.commands?.executeCommandById?.(commandId) ?? false;
	}

	// Shared by both branches of refineDisplayLineColumn above: finds the
	// pixel-correct, same-line, offset on `view` by sampling within the
	// current line's own visual band (see refineDisplayLineColumn's own
	// comment for the +9 y-offset rationale). Returns null if no correction
	// should be applied (unresolvable, would cross a line, or unchanged).
	private static resolveSameLineOffset(view: EditorView, head: number, pixelGoal: number, allowLineEnd = false): number | null {
		const coords = view.coordsAtPos(head);
		if (!coords) return null;
		const targetPos = view.posAtCoords({ x: pixelGoal, y: coords.top + 9 }, false);
		if (targetPos === null) return null;
		const headLine = view.state.doc.lineAt(head);
		const targetLine = view.state.doc.lineAt(targetPos);
		if (targetLine.number !== headLine.number) return null;
		const maxCh = Math.max(0, headLine.length - (allowLineEnd ? 0 : 1));
		const clamped = Math.min(targetPos, headLine.from + maxCh);
		return clamped === head ? null : clamped;
	}

	// Vim's w/b/e cell-crossing. Unlike Ctrl-N/P and Vim's own j/k (which move
	// between *rows*, same column), w/b/e read a table row the same way vim
	// reads any line — linearly, left to right through the row's raw markdown
	// text. So the adjacent cell in the *same row* comes first; only once
	// that row's own leftmost/rightmost cell is exhausted does this move to
	// the next/prev row at all (landing on that row's opposite edge cell —
	// forward wraps to the next row's leftmost cell, backward to the prev
	// row's rightmost, mirroring how the raw text would read one row into the
	// next). Single cell/row crossing only (no multi-cell count precision),
	// mirroring crossTableRowForCell's own "known gap" scope cut.
	// respectCrossRowNav: true for every Emacs-side caller (Word right/left,
	// Uppercase/Lowercase/Capitalize word) — Cross-row navigation is their
	// own documented setting, and it already gates LEFT/RIGHT/HOME/END the
	// same way. False for Vim's own w/b/e (see scheduleWordCrossing): real
	// Vim's word motions have no concept of stopping at a row/line boundary
	// at all (they run to the buffer's own edge), Cross-row navigation isn't
	// exposed on the Vim tab, and there is no native behavior to preserve by
	// adding one — so Vim's own crossing here stays unconditional.
	crossTableRowForWord(editor: unknown, cellIndex: number, forward: boolean, bigWord: boolean, wordEnd: boolean, respectCrossRowNav: boolean): { line: number; ch: number } | null {
		const e = editor as Editor;
		const currentLine = e.getCursor().line;
		const lineText = e.getLine(currentLine);
		const rightmostCellIndex = getRightmostCellIndex(lineText);

		if (forward && cellIndex < rightmostCellIndex) {
			const landed = this.landInCellSegment(e, currentLine, cellIndex + 1, true, 0, 0);
			if (!landed) return null;
			return this.refineWordLanding(e, landed, forward, bigWord, wordEnd);
		}
		if (!forward && cellIndex > 0) {
			const landed = this.landInCellSegment(e, currentLine, cellIndex - 1, false, 0, Number.MAX_SAFE_INTEGER);
			if (!landed) return null;
			return this.refineWordLanding(e, landed, forward, bigWord, wordEnd);
		}

		// Already at this row's own edge cell — cross to the next/prev row's
		// opposite edge cell (or exit the table if there is no next/prev row).
		// Both sub-paths respect Cross-row navigation the same way LEFT/RIGHT
		// do at their own edge: OFF means staying put, whether the boundary
		// would have crossed to an adjacent row or exited the table entirely.
		// exitTableWithWord's own setCursorToNextRow/PrevRow calls have no
		// such check themselves (they're shared with unrelated callers like
		// Ctrl-N/P's row crossing), so this must gate the call here instead.
		if (respectCrossRowNav && !this.settings.crossRowNavigation) return null;
		const startLine = forward ? this.getNextRowLine(e) : this.getPrevRowLine(e);
		if (startLine === -1) {
			return this.exitTableWithWord(e, cellIndex, forward, bigWord, wordEnd, currentLine);
		}
		return this.landInRowEdgeCellForWord(e, startLine, forward, bigWord, wordEnd);
	}

	// Shared by crossTableRowForWord's own row-to-row crossing (above) and
	// moveCursorWordPlainText's table-entry case (Emacs Word right/left
	// reaching an adjacent table row from plain text) — both need the exact
	// same landing: forward enters the target row's leftmost cell (its first
	// segment), backward enters the rightmost cell (its last segment), then
	// refines to the nearest actual word boundary. targetLine is assumed
	// already known to be a real table row (crossTableRowForWord finds it via
	// getNextRowLine/PrevRowLine; the plain-text case confirms it via
	// isPositionInTable before ever calling this).
	private landInRowEdgeCellForWord(editor: Editor, targetLine: number, forward: boolean, bigWord: boolean, wordEnd: boolean): { line: number; ch: number } | null {
		const rowText = editor.getLine(targetLine);
		const targetCellIndex = forward ? 0 : getRightmostCellIndex(rowText);
		// goalCh: 0 lands at the first segment's own start (forward); a large
		// sentinel clamps to the last segment's own end (backward) — landInCellSegment's
		// own maxOffset clamp handles that, same as exitTableWithColumn's goalCh does.
		const landed = this.landInCellSegment(editor, targetLine, targetCellIndex, forward, 0, forward ? 0 : Number.MAX_SAFE_INTEGER);
		if (!landed) return null;
		return this.refineWordLanding(editor, landed, forward, bigWord, wordEnd);
	}

	// Vim's gg/G (and count-prefixed "5gg"/"5G"). explicitLine is the
	// 0-indexed absolute target line for a count-prefixed jump; null targets
	// the document's own first/last line. Checks whether the target is itself
	// a table row and, if so, reuses enterTableAtLine to land inside that
	// row's leftmost cell rather than on its raw markdown text.
	jumpToDocumentLine(editor: unknown, forward: boolean, explicitLine: number | null): { line: number; ch: number } | null {
		const e = editor as Editor;
		const cm = e.cm;
		const lastLine = e.lineCount() - 1;
		const targetLine = explicitLine !== null
			? Math.max(0, Math.min(explicitLine, lastLine))
			: (forward ? lastLine : 0);

		// Vim's own synchronous motion (moveToLineOrEdgeOfDocument, run inside
		// vim.js's own cm.operation()) already sets the CM6 selection correctly
		// for an active Visual/Visual Line selection, using vim.js's own
		// line/char-mode selection conventions (e.g. Visual Line's head at
		// end-of-line, not column 0). Any *external* dispatch we make below
		// (this method's own raw cm.dispatch calls, running outside that
		// operation) gets reinterpreted by vim.js's handleExternalSelection as
		// if it came from a mouse drag: it shifts the forward-direction
		// endpoint back by one character to match its own mouse-selection
		// convention. Since our own targetCh below targets column ~0 (not
		// Visual Line's end-of-line convention), that shift crosses the line
		// boundary backward — landing one line short of the true target. So
		// once there's an active selection to preserve, we must not
		// re-dispatch a selection at all here; only scroll (see the bottom of
		// this method) — vim.js's own already-correct state is left standing.
		const hadActiveSelection = cm.state.selection.main.anchor !== cm.state.selection.main.head;

		// Bare G (not count-prefixed — see below) landing on a table that runs
		// all the way to the document's own last line: mirror tx's own EOF fix
		// (appendBlankLineAndLand, already used for exiting a table that hits
		// EOF) instead of landing inside the table's own last row — G means
		// "reach the real end", and a table swallowing that end is the same
		// problem tx already solves. Deliberately asymmetric with gg (kept
		// as-is, no "prepend a line" equivalent, matching tx/tX's own
		// precedent) and with count-prefixed jumps ("5G"), which target a
		// specific line the user named explicitly, not "the very end" — those
		// still land inside the table normally, even if that line happens to
		// also be the document's last line.
		//
		// Also runs while a Vim selection is active (hadActiveSelection), by
		// design — confirmed against Obsidian's own native Vim mode (UCH's
		// table handling bypassed): V/v+G onto a table at true EOF selects the
		// table and moves the cursor past it, but there's no
		// real line there to land on, so Live Preview renders a glitchy,
		// full-table-height caret off to the side of the widget instead of a
		// normal one. Actually creating that trailing line (same mutation as
		// the no-selection case) gives the caret a real place to render —
		// appendBlankLineAndLand's own preserveActiveSelection param keeps the
		// selection extended through it instead of collapsing it.
		if (explicitLine === null && forward && this.isPositionInTable(e, targetLine, 1)) {
			this.appendBlankLineAndLand(e, hadActiveSelection);
			return { line: lastLine + 1, ch: 0 };
		}

		let result: { line: number; ch: number } | null;
		if (!hadActiveSelection && this.isPositionInTable(e, targetLine, 1)) {
			// gg/G always land at the *start* of the target line's content
			// (first non-blank), regardless of forward/backward — so an
			// explicit-count jump ("2gg"/"2G") landing on the same target
			// line must land identically either way. enterTableAtLine's own
			// forward param controls its delimiter-row redirect direction
			// (and which <br>-segment to land on) — hardcoding true here
			// (not the keystroke's own forward) keeps that landing consistent
			// regardless of which key was actually pressed. Skipped while a
			// Vim selection is active — see hadActiveSelection's own comment
			// above and the identical reasoning just above this block: cell-
			// precision landing is a Normal-mode-only concern (Visual Line
			// selects whole lines regardless of column; Visual mode is better
			// served by vim.js's own native selection extension across the
			// table's raw text, matching Obsidian's own native Vim mode with no
			// table-precision handling involved at all).
			result = this.enterTableAtLine(e, targetLine, 0, true, 0, 0);
			if (result) result = this.refineTableLandingForSmartHome(e, result);
		} else {
			const lineText = e.getLine(targetLine);
			// Same std/adv-aware position `^` itself uses when Smart home
			// (standard) is on; vim's own native whitespace-only skip otherwise —
			// matches moveToFirstNonWhiteSpaceCharacter's own two-path design
			// (getBeginningOfLinePosition hardcodes 0, not whitespace-skip, when
			// smartHomeStandard is off, so it can't be used unconditionally here).
			const targetCh = this.settings.smartHomeStandard
				? this.getBeginningOfLinePosition(lineText, lineText.length || 1)
				: (lineText.search(/\S/) === -1 ? lineText.length : lineText.search(/\S/));
			// See hadActiveSelection's own comment above: skip this dispatch
			// entirely while Vim's own Visual/Visual Line selection is active,
			// to avoid corrupting the state vim.js already set correctly.
			if (!hadActiveSelection) {
				this.setCursorViaCm(e, targetLine, targetCh, true);
			}
			result = { line: targetLine, ch: targetCh };
		}

		// gg/G can jump across the whole document — unlike the short,
		// already-on-screen hops setCursorViaCm's other callers make (row/
		// cell crossings), this one needs an explicit scroll-into-view.
		// setCursorViaCm itself doesn't request one (left as-is to avoid
		// changing behavior for its other, already-working callers); done as
		// its own follow-up dispatch to the same (already landed-on) position
		// instead. When there's an active selection to preserve, this dispatch
		// carries no `selection` field at all — scrollIntoView is a pure
		// StateEffect, so it can't itself trigger vim.js's
		// handleExternalSelection (which only reacts to an actual selection
		// change) the way re-asserting {anchor, head} would (see
		// hadActiveSelection's own comment above).
		if (result) {
			const pos = e.posToOffset(result);
			if (hadActiveSelection) {
				cm.dispatch({ effects: EditorView.scrollIntoView(pos), userEvent: 'move' });
			} else {
				cm.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true, userEvent: 'move' });
			}
		}
		return result;
	}

	// gg/G's own table-landing refinement: enterTableAtLine's shared landing
	// (via landInCellSegment) only ever skips leading whitespace
	// (getInCellLineInfo's own startOfInCellLine) — never Smart Home, unlike
	// gg/G's plain-text landing just above, which respects it. landInCellSegment
	// is also shared by crossTableRowForCell (Ctrl-N/P and Vim j/k's own
	// goal-column-preserving row crossing), which must NOT gain Smart Home, so
	// this can't be baked into that shared primitive itself — mirrors
	// refineWordLanding's own "land roughly via the shared primitive, then
	// refine for this caller's own needs" shape instead. No-op when Smart Home
	// (standard) is off; when it's on but the segment's own content has
	// nothing for it to skip past (the common case — table cells rarely start
	// with list/checkbox/blockquote/heading syntax), targetCh just comes back
	// equal to landed.ch and no re-dispatch happens.
	private refineTableLandingForSmartHome(editor: Editor, landed: { line: number; ch: number }): { line: number; ch: number } {
		if (!this.settings.smartHomeStandard) return landed;
		const lineText = editor.getLine(landed.line);
		const segInfo = getInCellLineInfo(lineText, landed.ch);
		if (!segInfo) return landed;
		const segmentText = lineText.slice(segInfo.startOfInCellLine, segInfo.endOfInCellLine);
		const targetCh = segInfo.startOfInCellLine + this.getBeginningOfLinePosition(segmentText, segmentText.length || 1);
		if (targetCh !== landed.ch) {
			this.setCursorViaCm(editor, landed.line, targetCh);
		}
		return { line: landed.line, ch: targetCh };
	}

	// Alt-Shift-,/. (Emacs beginning-of-buffer/end-of-buffer). Deliberately
	// separate from jumpToDocumentLine (Vim's gg/G, left untouched) — real
	// vim's gg/G always land at a line's own first non-blank character
	// (optionally Smart-Home-enhanced), but real Emacs has no such concept
	// for buffer edges: it's the true edge of the buffer, full stop. So
	// forward=false (TOP) lands at literal ch=0 of the first line, no skip
	// of any kind; forward=true (BOTTOM) lands at the end of the last line.
	// Table-aware, but asymmetrically so, matching the same "true edge"
	// framing: TOP lands in the leftmost cell's own content start (there's
	// no position "before" that inside a rendered cell — already the true
	// edge there), while BOTTOM lands in the *rightmost* cell's own content
	// *end* (the actual end of that row's raw text) — unlike gg/G, which
	// always targets the leftmost cell regardless of direction.
	jumpToBufferEdge(editor: unknown, forward: boolean): { line: number; ch: number } | null {
		const e = editor as Editor;
		if (this.markActive) {
			this.extendMarkBufferEdge(e, forward);
			return null;
		}
		const targetLine = forward ? e.lineCount() - 1 : 0;

		let result: { line: number; ch: number } | null;
		if (this.isPositionInTable(e, targetLine, 1)) {
			result = forward
				? this.enterTableAtLine(e, targetLine, getRightmostCellIndex(e.getLine(targetLine)), false, Number.MAX_SAFE_INTEGER, 0, true)
				: this.enterTableAtLine(e, targetLine, 0, true, 0, 0);
		} else {
			const lineText = e.getLine(targetLine);
			const targetCh = forward ? lineText.length : 0;
			this.setCursorViaCm(e, targetLine, targetCh);
			result = { line: targetLine, ch: targetCh };
		}

		// Same reasoning as jumpToDocumentLine's own identical follow-up: a
		// buffer-edge jump can land far outside the current viewport.
		if (result) {
			const cm = e.cm;
			const pos = e.posToOffset(result);
			cm.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true, userEvent: 'move' });
		}
		return result;
	}

	// Full (syntax-tree-based) table-membership check, same one Ctrl-N/P's own
	// moveCursorUpIntoTable/DownIntoTable use to detect table *entry* specifically
	// (as opposed to the cheap text-based shortcut used elsewhere for "already
	// confirmed inside a table"). Exposed as-is for vim-support.ts's
	// scheduleTableEntry to confirm its own cheap pre-filter before committing to
	// an entry landing.
	isLinePartOfTable(editor: unknown, line: number, ch: number): boolean {
		return this.isPositionInTable(editor as Editor, line, ch);
	}

	// Lands on cellIndex's <br>-segment at goalCh, remaining logical lines in from
	// targetLine's own first/last segment — used when vim-support.ts's
	// moveByLines' plain-text walk reaches a table row (remaining is however much
	// of the original repeat count is left to consume from there). cellIndex is
	// vim-support.ts's goalCellIndex (falls back to 0, matching Ctrl-N/P's own
	// moveCursorUpIntoTable/DownIntoTable convention, when there's no remembered
	// cell to return to).
	// allowPastLastChar: lets the final landing rest at the segment's true end
	// (past its last character) instead of the Vim-Normal-mode-legal "on the
	// last character" clamp landInCellSegment applies by default — only
	// jumpToBufferEdge's own BOTTOM case wants this (real Emacs has no
	// Normal-mode-style edge restriction); every other caller here is Vim's
	// own gg/G, j/k table entry, or Ctrl-N/P, which do need the clamp since
	// this position is read back as Vim's next head.
	enterTableAtLine(editor: unknown, targetLine: number, cellIndex: number, forward: boolean, goalCh: number, remaining: number, allowPastLastChar = false): { line: number; ch: number } | null {
		const e = editor as Editor;
		let line = targetLine;
		if (this.TABLE_DELIMITER_REGEX.test(e.getLine(line))) {
			// Shouldn't be reachable now that moveByLines' plain-text walk moves
			// one line at a time (it always reaches the header/last-data-row
			// before it could reach a delimiter) — kept as a defensive fallback
			// in case some other path still lands here directly. Without this
			// redirect, landInCellSegment would treat the delimiter's "---" text
			// as if it were real cell content. Redirect to the nearest real row
			// instead: forward → the first data row (line + 1); backward → the
			// header row (line - 1).
			line = forward ? line + 1 : line - 1;
			if (line < 0 || line >= e.lineCount() || !this.isPositionInTable(e, line, 1, true)) return null;
		}
		return this.walkTableRows(e, cellIndex, forward, line, remaining, goalCh, allowPastLastChar);
	}

	// Shared by crossTableRowForCell and enterTableAtLine: starting at startLine
	// (a row already known to be part of the table, whose own cellIndex segments
	// haven't been consumed yet), consumes `remaining` logical lines — first
	// against startLine's own <br>-segment count, then (if that's not enough)
	// walking further rows via getNextRowLine/PrevRowLine — landing via
	// landInCellSegment once remaining fits within one row's segments. All reads
	// only until that final landing; exits the table via exitTableWithColumn if
	// it runs out of rows first, deferring to exitTableWithColumn — which
	// itself falls back to landing on this walk's own last-reached row
	// (fromLine) when even that exit hits a genuine dead end (the table's own
	// edge row is also the document's own edge, e.g. a table starting at the
	// document's very first line).
	private walkTableRows(editor: Editor, cellIndex: number, forward: boolean, startLine: number, remaining: number, goalCh: number, allowPastLastChar = false): { line: number; ch: number } | null {
		let targetLine = startLine;
		let fromLine = startLine;
		for (;;) {
			const segCount = this.countCellSegments(editor.getLine(targetLine), cellIndex);
			if (remaining <= segCount) {
				return this.landInCellSegment(editor, targetLine, cellIndex, forward, remaining - 1, goalCh, allowPastLastChar);
			}
			remaining -= segCount;
			fromLine = targetLine;
			const nextLine = forward ? this.getNextRowLine(editor, fromLine) : this.getPrevRowLine(editor, fromLine);
			if (nextLine === -1) {
				return this.exitTableWithColumn(editor, cellIndex, forward, goalCh, fromLine, remaining);
			}
			targetLine = nextLine;
		}
	}

	// Exits the table entirely (fromLine's next/prev row doesn't exist). Reuses
	// the existing exit logic (line-finding, delimiter-row skipping, EOF newline
	// insertion) as-is via setCursorToNextRow/PrevRow, then separately corrects
	// the column — those hardcode ch=0, which is fine for Ctrl-N/P but loses
	// goalCh for Vim. This follow-up move stays within the (now plain-text) line
	// just landed on, so it doesn't cross any view boundary and carries none of
	// the row-crossing crash risk. fromLine is passed explicitly rather than
	// relying on setCursorToNextRow/PrevRow's own live-cursor default, since the
	// real cursor hasn't moved from its original (pre-walk) position yet.
	//
	// setCursorToPrevRow (backward) can itself be a genuine no-op — when
	// fromLine is the document's own first line, there's no line above the
	// table to exit to at all, so it deliberately stays put (see its own
	// comment) rather than dispatching to an invalid negative line. Comparing
	// against the position from *before* calling setCursorToPrevRow/NextRow
	// detects that case.
	//
	// Bug fixed here: when detected, this used to return null unconditionally
	// — correct for a plain (non-walked) call, since fromLine there already
	// equals the live cursor's own row (before === landed for that reason
	// alone; see the still-passing regression test below). But
	// walkTableRows' own multi-row callers never move the real cursor while
	// walking (fromLine is a purely local variable) — so on that path,
	// fromLine can be several rows away from the real (stale) cursor, which
	// the walk had already legitimately reached before hitting this dead end.
	// Returning null there silently discarded that progress instead of
	// landing where the walk had actually gotten to. Only fall back to
	// landing on fromLine's own edge segment (the same "no further walk"
	// convention landInCellSegment already uses elsewhere) when fromLine
	// differs from where the walk started (`before`) — a genuine multi-row
	// walk that dead-ended, matching real vim's own "count overshoots past
	// the document's edge, land at the edge" behavior. When fromLine equals
	// before.line (no walk happened), preserve the exact old no-op untouched.
	//
	// remaining is the total logical-line count this exit itself must
	// consume, matching landInCellSegment's own "remaining=1 lands on this
	// very edge, no further walk" convention: landing on the immediate exit
	// line consumes 1, and any leftover (remaining > 1) continues as
	// ordinary plain-text lines beyond the table, clamped at the document's
	// own edge if it runs out first. Bug fixed here: a count-prefixed
	// crossing/entry that outlived the table's own rows used to silently
	// drop this leftover the moment exitTableWithColumn took over — walking
	// the *table's* own rows respected the count, but the plain-text
	// continuation beyond the table's own exit line did not.
	private exitTableWithColumn(editor: Editor, cellIndex: number, forward: boolean, goalCh: number, fromLine: number, remaining: number): { line: number; ch: number } | null {
		const before = editor.getCursor();
		if (forward) this.setCursorToNextRow(editor, cellIndex, fromLine);
		else this.setCursorToPrevRow(editor, cellIndex, fromLine);
		const landed = editor.getCursor();
		if (landed.line === before.line && landed.ch === before.ch) {
			if (fromLine !== before.line) {
				return this.landInCellSegment(editor, fromLine, cellIndex, forward, 0, goalCh);
			}
			return null;
		}
		let line = landed.line;
		let stepsLeft = remaining - 1;
		while (stepsLeft > 0) {
			const nextLine = forward ? line + 1 : line - 1;
			if (nextLine < 0 || nextLine >= editor.lineCount()) break;
			line = nextLine;
			stepsLeft -= 1;
		}
		const landedLineText = editor.getLine(line);
		const targetCh = Math.min(goalCh, Math.max(0, landedLineText.length - 1));
		if (line !== landed.line || targetCh !== landed.ch) {
			this.setCursorViaCm(editor, line, targetCh);
		}
		// A table's own last/first row can itself sit right at the screen's
		// edge, with the plain-text line just beyond it entirely off-screen —
		// unlike crossing *between* rows (movement that stays within an
		// already-onscreen table), exiting can land the cursor somewhere the
		// viewport was never scrolled to show. setCursorViaCm (used just above
		// and by setCursorToNextRow/PrevRow themselves) deliberately doesn't
		// request a scroll — see jumpToDocumentLine's own identical comment on
		// why — so this follows the same pattern it uses: an explicit
		// follow-up dispatch to the already-landed (and possibly just-
		// corrected) position, requesting scrollIntoView only here.
		const cm = editor.cm;
		const pos = editor.posToOffset({ line, ch: targetCh });
		cm.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true, userEvent: 'move' });
		return { line, ch: targetCh };
	}

	// Word-motion's own table-exit — same setCursorToNextRow/PrevRow reuse as
	// exitTableWithColumn, but refines to the nearest word afterward instead
	// of clamping to a remembered goal column (Vim's w/b/e have no goal-column
	// concept; landing at the cell's own content-start/end isn't precise
	// enough since real vim always lands exactly on a word).
	private exitTableWithWord(editor: Editor, cellIndex: number, forward: boolean, bigWord: boolean, wordEnd: boolean, fromLine: number): { line: number; ch: number } | null {
		if (forward) this.setCursorToNextRow(editor, cellIndex, fromLine);
		else this.setCursorToPrevRow(editor, cellIndex, fromLine);
		return this.refineWordLanding(editor, editor.getCursor(), forward, bigWord, wordEnd);
	}

	// Narrows a landing at a cell's/line's own content-start/end (from
	// crossTableRowForWord/exitTableWithWord) down to the actual nearest word
	// on that line, re-dispatching only if the refined position differs.
	// Bug fixed here: scanning the *whole* raw row line (rather than just the
	// landed <br>-segment) always found the leftmost cell's first word,
	// regardless of which cell was actually landed on — getInCellLineInfo
	// scopes the scan to the landed cell/segment's own [start, end) range;
	// null (plain text, not a table row at all) falls back to the whole line.
	// wordEnd (Vim's `e`/`ge`) lands on the first/last word's own *end*,
	// matching w/b's own word-*start* convention only when wordEnd is false.
	private refineWordLanding(editor: Editor, landed: { line: number; ch: number }, forward: boolean, bigWord: boolean, wordEnd: boolean): { line: number; ch: number } {
		const lineText = editor.getLine(landed.line);
		const segInfo = getInCellLineInfo(lineText, landed.ch);
		const scopeStart = segInfo ? segInfo.startOfInCellLine : 0;
		const scopeEnd = segInfo ? segInfo.endOfInCellLine : lineText.length;
		const scopedText = lineText.slice(scopeStart, scopeEnd);
		const targetCh = scopeStart + this.findWordBoundaryOnLine(scopedText, forward, bigWord, wordEnd);
		if (targetCh !== landed.ch) {
			this.setCursorViaCm(editor, landed.line, targetCh);
		}
		return { line: landed.line, ch: targetCh };
	}

	// A from-a-clean-edge-only scan (always starts at this scoped segment's
	// own start or end, never mid-word — refineWordLanding always hands it a
	// fresh landing position), so unlike vim-support.ts's own w/b/e port
	// (which must resolve from an arbitrary mid-line position, and needs a
	// char-by-char scan for that), this can just take the first/last span
	// directly from the shared word-segmentation.ts module.
	private findWordBoundaryOnLine(lineText: string, forward: boolean, bigWord: boolean, wordEnd: boolean): number {
		const spans = bigWord ? getBigWordSpans(lineText) : getWordSpans(lineText);
		if (forward) {
			const first = spans[0];
			if (!first) return 0; // entirely whitespace — vim's own "empty line is a word" convention
			return wordEnd ? first.to - 1 : first.from;
		}
		const last = spans[spans.length - 1];
		if (!last) return Math.max(0, lineText.length - 1);
		return wordEnd ? last.to - 1 : last.from;
	}

	// Alt-F/Alt-B in plain text (raw table Markdown text in Source Mode is
	// still deliberately untouched here, same as Ctrl-B/F's own goLeft/
	// goRight, which never special-cases Source Mode tables either — Source
	// Mode table rows read as plain text either way). Walks line by line via
	// getWordSpans until a word is found, a Live Preview table row is
	// reached (see landInRowEdgeCellForWord below), or the document's own
	// start/end is reached (a real Emacs buffer would signal "End/Beginning
	// of buffer" and simply not move further — same here, via the early
	// return once there's no further line to try).
	// Multi-cursor-safe: unlike Ctrl-P/N/B/F, this never calls a native CM6
	// command (findWordSpanOnLine is our own plain text search), so every
	// range's own target can be computed directly up front with no "native
	// exec skips the whole table" risk to guard against beforehand — see
	// findWordTargetPlainText below. Still applies this file's established
	// table-boundary policy: a secondary range whose own search would cross
	// into a table that the primary isn't crossing into this step can't
	// coexist with the primary in the same view, and is dropped outright.
	private moveCursorWordPlainText(editor: Editor, forward: boolean) {
		const cm = editor.cm;
		const sel = cm.state.selection;
		const main = sel.main;
		const mainIndex = sel.ranges.indexOf(main);
		const results = sel.ranges.map(range =>
			this.findWordTargetPlainText(editor, editor.offsetToPos(range.head), forward));
		const mainResult = results[mainIndex];

		if (mainResult.kind === 'table') {
			// Primary's own search reaches a table row: hand off entirely to
			// the existing single-cursor entry path below, which already
			// collapses the whole selection down to primary on its own
			// (setCursorViaCm inside landInRowEdgeCellForWord/
			// landInCellSegment) — same as moveCursorUpIntoTable/
			// DownIntoTable's own primary-crosses case, no change needed here.
			this.enterTableWithWordFromPlainText(editor, mainResult.tableLine, forward);
			return;
		}

		let changed = false;
		let newMainIndex = -1;
		const kept: SelectionRange[] = [];
		sel.ranges.forEach((range, i) => {
			const result = results[i];
			const isMain = range === main;
			if (!isMain && result.kind === 'table') {
				// Would cross into a table the primary isn't — dropped.
				changed = true;
				return;
			}
			let keptRange = range;
			if (result.kind === 'found') {
				changed = true;
				keptRange = EditorSelection.cursor(result.pos);
			}
			if (isMain) newMainIndex = kept.length;
			kept.push(keptRange);
		});
		if (!changed) return;
		cm.dispatch({ selection: EditorSelection.create(kept, newMainIndex), userEvent: 'move' });
		if (mainResult.kind === 'found' && mainResult.crossedLines) this.scrollCursorIntoView(editor);
	}

	// Pure (no dispatch) word search for a single range, starting from
	// `from` — the shared target-computation core moveCursorWordPlainText's
	// multi-cursor loop above runs once per range before dispatching
	// anything. Walks line by line via findWordSpanOnLine until a word is
	// found, a Live Preview table row is reached, or the document's own
	// start/end is reached (a real Emacs buffer would signal "End/Beginning
	// of buffer" and simply not move further — same here, via 'noMove').
	private findWordTargetPlainText(editor: Editor, from: { line: number; ch: number }, forward: boolean):
			{ kind: 'noMove' }
			| { kind: 'found'; pos: number; crossedLines: boolean }
			| { kind: 'table'; tableLine: number } {
		let lineNum = from.line;
		let ch = from.ch;
		for (;;) {
			const lineText = editor.getLine(lineNum);
			const span = findWordSpanOnLine(lineText, ch, forward);
			if (span) {
				const targetCh = forward ? span.to : span.from;
				if (lineNum === from.line && targetCh === from.ch) return { kind: 'noMove' };
				return {
					kind: 'found',
					pos: editor.posToOffset({ line: lineNum, ch: targetCh }),
					crossedLines: lineNum !== from.line,
				};
			}
			const nextLine = forward ? lineNum + 1 : lineNum - 1;
			if (nextLine < 0 || nextLine >= editor.lineCount()) return { kind: 'noMove' }; // document edge — stay put
			if (this.isPositionInTable(editor, nextLine, 1)) {
				return { kind: 'table', tableLine: nextLine };
			}
			lineNum = nextLine;
			ch = forward ? 0 : editor.getLine(lineNum).length;
		}
	}

	// Primary's own word-search reached a table row (moveCursorWordPlainText's
	// 'table' case above) — unchanged from the original single-cursor logic.
	private enterTableWithWordFromPlainText(editor: Editor, tableLine: number, forward: boolean) {
		// Reaching a Live Preview table row: enter it the same way
		// crossTableRowForWord's own row-crossing does (leftmost cell
		// forward, rightmost cell backward), then apply the same +1 caret
		// correction moveCursorWordInTable's own crossing already needs
		// (landInRowEdgeCellForWord/refineWordLanding land using vim's
		// block-cursor word-end convention, one char short of where Emacs's
		// own caret should rest — see moveCursorWordInTable's identical
		// comment).
		const landed = this.landInRowEdgeCellForWord(editor, tableLine, forward, false, forward);
		if (landed && forward) {
			const landedLineText = editor.getLine(landed.line);
			const targetCh = Math.min(landed.ch + 1, landedLineText.length);
			if (targetCh !== landed.ch) this.setCursorViaCm(editor, landed.line, targetCh);
		}
		if (landed) this.scrollCursorIntoView(editor);
	}

	// Alt-F/Alt-B inside a Live Preview table cell. First searches the
	// cursor's own <br>-segment, then walks further segments within the SAME
	// cell (walkSegments — mirrors how vim.js's own inner-view line iteration
	// covers in-cell segments for free, since each <br>-segment is its own
	// doc line there); only once the whole cell is exhausted does it cross
	// into the next/prev cell or row via crossTableRowForWord — single
	// cell/row crossing only, matching that function's own documented "no
	// multi-cell count precision" scope (see its own comment).
	// crossTableRowForWord/refineWordLanding land using vim's block-cursor
	// word-end convention (wordEnd -> last char's own index); this caret
	// cursor needs one further to the right, hence the +1 correction applied
	// only on the forward landing.
	// Multi-cursor-safe: this cell's own word search (walkSegments/
	// getInCellLineInfo etc.) is expressed in OUTER raw-line coordinates
	// (shared with Vim's own w/b/e — deliberately left untouched, see
	// exitCellWithWord's own comment), while the actual selection ranges
	// live in the INNER view's own offsets. <br>-segment number and inner
	// sub-line number are always the same count, so findWordTargetInCellForRange
	// bridges the two by walking from the cell's own first segment the same
	// number of segments as a given range's own inner sub-line is from 1 —
	// uniformly for every range, no primary/secondary distinction needed
	// for this part. Falls back to the original single-range implementation
	// (moveCursorWordInTableSingle) when no inner view is available at all.
	private moveCursorWordInTable(editor: Editor, forward: boolean) {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		const primarySegInfo = getInCellLineInfo(lineText, cursor.ch);
		if (!primarySegInfo) return;

		const inner = editor.activeCM;
		if (!inner || inner === editor.cm) {
			this.moveCursorWordInTableSingle(editor, forward, cursor, lineText, primarySegInfo);
			return;
		}

		const cellIndex = getCellIndex(lineText, cursor.ch);
		const cellStartCh = getChByCellIndex(lineText, cellIndex);
		const firstSegInfo = getInCellLineInfo(lineText, cellStartCh);
		if (!firstSegInfo) return;

		this.dispatchInCellMotion(
			inner,
			range => this.findWordTargetInCellForRange(inner, range, lineText, firstSegInfo, forward),
			() => this.exitCellWithWord(editor, cellIndex, forward),
		);
	}

	// Original single-range implementation, unchanged — used both as the
	// no-inner-view fallback above and, per range, is what
	// findWordTargetInCellForRange below mirrors (returning a result
	// instead of dispatching, and tracking the inner sub-line number in
	// lockstep with each segment walked).
	private moveCursorWordInTableSingle(
		editor: Editor, forward: boolean, cursor: { line: number; ch: number }, lineText: string, segInfo: InCellLineInfo,
	) {
		let localCh = cursor.ch - segInfo.startOfInCellLine;
		for (;;) {
			const scopeStart = segInfo.startOfInCellLine;
			const scopedText = lineText.slice(scopeStart, segInfo.endOfInCellLine);
			const fromCh = Math.max(0, Math.min(localCh, scopedText.length));
			const span = findWordSpanOnLine(scopedText, fromCh, forward);
			if (span) {
				const targetCh = scopeStart + (forward ? span.to : span.from);
				if (targetCh !== cursor.ch) this.setCursorViaCm(editor, cursor.line, targetCh);
				return;
			}
			const { segInfo: nextSeg, steps } = this.walkSegments(lineText, segInfo, forward, 1);
			if (steps === 0) break; // no further segment in this cell
			segInfo = nextSeg;
			localCh = forward ? 0 : segInfo.endOfInCellLine - segInfo.startOfInCellLine;
		}

		const cellIndex = getCellIndex(lineText, cursor.ch);
		this.exitCellWithWord(editor, cellIndex, forward);
	}

	// Pure (no dispatch) per-range word search within the current cell.
	// Seeds this range's own starting segment purely from its inner
	// sub-line number (not from the primary's own position) — walking
	// (subLineNumber - 1) segments from the cell's first segment — so every
	// range is computed the same uniform way. Converts the eventual OUTER
	// landing ch back to an inner offset via inner.state.doc.line(N), where
	// N is tracked in lockstep with each segment walked during the search.
	private findWordTargetInCellForRange(
		inner: EditorView, range: SelectionRange, lineText: string, firstSegInfo: InCellLineInfo, forward: boolean,
	): { kind: 'exit' } | { kind: 'stay'; pos: number } {
		const startSubLine = inner.state.doc.lineAt(range.head);
		let subLineNumber = startSubLine.number;
		let segInfo = subLineNumber > 1
			? this.walkSegments(lineText, firstSegInfo, true, subLineNumber - 1).segInfo
			: firstSegInfo;
		let localCh = range.head - startSubLine.from;

		for (;;) {
			const scopeStart = segInfo.startOfInCellLine;
			const scopedText = lineText.slice(scopeStart, segInfo.endOfInCellLine);
			const fromCh = Math.max(0, Math.min(localCh, scopedText.length));
			const span = findWordSpanOnLine(scopedText, fromCh, forward);
			if (span) {
				const targetCh = scopeStart + (forward ? span.to : span.from);
				const targetSubLine = inner.state.doc.line(subLineNumber);
				return { kind: 'stay', pos: targetSubLine.from + (targetCh - scopeStart) };
			}
			const { segInfo: nextSeg, steps } = this.walkSegments(lineText, segInfo, forward, 1);
			if (steps === 0) return { kind: 'exit' };
			segInfo = nextSeg;
			subLineNumber += forward ? 1 : -1;
			localCh = forward ? 0 : segInfo.endOfInCellLine - segInfo.startOfInCellLine;
		}
	}

	// Primary's own search exhausted this cell: hand off entirely to the
	// existing single-cursor cross-row/cross-cell logic, which already
	// collapses the whole selection down to primary on its own
	// (setCursorViaCm inside crossTableRowForWord) — same table-boundary
	// policy as everywhere else in this file, no change needed here.
	//
	// crossTableRowForWord/exitTableWithWord are shared with Vim's own
	// w/b/e, and real vim's own word motion treats a blank line as a word
	// in its own right — correct for Vim, so that shared code is
	// deliberately left alone. Real Emacs has no such convention: its own
	// word motion skips blank lines entirely (moveCursorWordPlainText
	// already does this for the all-plain-text case). So when exiting the
	// table lands on a genuinely wordless line — the exact situation where
	// the shared code's own "stop here" fallback kicks in — hand off to
	// moveCursorWordPlainText to keep searching from here, purely as a
	// post-processing step on top of the untouched shared landing (the real
	// cursor is already sitting there; crossTableRowForWord's own
	// setCursorToPrevRow/NextRow dispatch already moved it).
	private exitCellWithWord(editor: Editor, cellIndex: number, forward: boolean) {
		const landed = this.crossTableRowForWord(editor, cellIndex, forward, false, forward, true);
		if (landed && forward) {
			const landedLineText = editor.getLine(landed.line);
			const targetCh = Math.min(landed.ch + 1, landedLineText.length);
			if (targetCh !== landed.ch) this.setCursorViaCm(editor, landed.line, targetCh);
		}
		if (landed && !this.isPositionInTable(editor, landed.line, 1)
				&& getWordSpans(editor.getLine(landed.line)).length === 0) {
			this.moveCursorWordPlainText(editor, forward);
		}
	}

	// Shared by crossTableRowForCell and enterTableAtLine: given a target row
	// already known to exist, lands on the specified cell's <br>-segment at
	// segmentOffset steps in from the entry edge (first segment if forward, last
	// segment if backward; segmentOffset=0 is that edge segment itself — the
	// single-row-crossing/entry case). A segmentOffset > 0 is only reached via
	// crossTableRowForCell's multi-row walk, when a single row-boundary jump
	// doesn't consume the whole repeat count. cellIndex is clamped to the row's
	// rightmost cell — the caller may be remembering a wider goal cell index from
	// a table with more columns, which this row doesn't have; clamping only
	// affects this landing, not whatever goal value the caller keeps.
	private landInCellSegment(editor: Editor, targetLine: number, cellIndex: number, forward: boolean, segmentOffset: number, goalCh: number, allowPastLastChar = false): { line: number; ch: number } | null {
		const lineText = editor.getLine(targetLine);
		const clampedCellIndex = Math.min(cellIndex, getRightmostCellIndex(lineText));
		const cellStartCh = getChByCellIndex(lineText, clampedCellIndex);
		if (cellStartCh === -1) return null;

		// cellStartCh already lands in the cell's first <br>-segment.
		let segInfo = getInCellLineInfo(lineText, cellStartCh);
		if (!segInfo) return null;
		// Landing backward (up) starts from the LAST segment instead of the first —
		// reaching it always means walking *toward* increasing segment indices
		// (true), regardless of the outer crossing's own direction. (Bug fixed
		// here: this previously passed `forward` itself, which is false for a
		// backward landing — walking "backward" from the already-first segment
		// is a no-op, so it silently stayed on the first segment instead of the last.)
		if (!forward) {
			segInfo = this.walkSegments(lineText, segInfo, true, Infinity).segInfo;
		}
		// Walk segmentOffset further steps toward the opposite edge.
		segInfo = this.walkSegments(lineText, segInfo, forward, segmentOffset).segInfo;

		// Same normal-mode "can't rest past last char" clamp as vim-support.ts's
		// maxNormalModeCh — this position is read back as vim's next head once
		// focus moves to the new inner view, so it must already be vim-legal.
		// Skipped when allowPastLastChar is set (jumpToBufferEdge's own BOTTOM
		// case): real Emacs has no such restriction, and clamping there landed
		// one character short of the cell's actual content end.
		const segLen = segInfo.endOfInCellLine - segInfo.startOfInCellLine;
		const maxOffset = allowPastLastChar ? segLen : Math.max(0, segLen - 1);
		const targetCh = segInfo.startOfInCellLine + Math.min(goalCh, maxOffset);
		this.setCursorViaCm(editor, targetLine, targetCh);
		// Re-reads the logical cursor rather than closing over targetCh —
		// callers like crossTableRowForWord synchronously refine this rough
		// segment-edge landing to the real word boundary (refineWordLanding)
		// immediately after this function returns, well before nudgeInnerViewVisible's
		// two frames elapse; re-dispatching the stale targetCh here would
		// silently stomp that refinement back to the raw segment edge.
		this.nudgeInnerViewVisible(editor);
		return { line: targetLine, ch: targetCh };
	}

	// Walks from segInfo toward the next segment (forward) or previous segment
	// (backward) up to maxSteps times, stopping early if there's no further
	// segment. Returns the resulting segment and how many steps were actually
	// taken (steps < maxSteps only when it ran out of segments).
	private walkSegments(lineText: string, segInfo: InCellLineInfo, forward: boolean, maxSteps: number): { segInfo: InCellLineInfo; steps: number } {
		let current = segInfo;
		let steps = 0;
		while (steps < maxSteps) {
			if (forward) {
				if (current.lineType === 'last' || current.lineType === 'single') break;
				const brLen = lineText.slice(current.endOfInCellLine).match(/^<[bB][rR]>/)?.[0].length ?? 0;
				if (brLen === 0) break;
				const next = getInCellLineInfo(lineText, current.endOfInCellLine + brLen);
				if (!next) break;
				current = next;
			} else {
				if (current.lineType === 'first' || current.lineType === 'single') break;
				const prev = getInCellLineInfo(lineText, current.startOfInCellLine - 1);
				if (!prev) break;
				current = prev;
			}
			steps++;
		}
		return { segInfo: current, steps };
	}

	// Total <br>-segment count of the given cell (clamped to the row's rightmost
	// cell, matching landInCellSegment's own clamping) — used by
	// crossTableRowForCell's multi-row walk to know how much of the remaining
	// overshoot each row's cell can consume.
	private countCellSegments(lineText: string, cellIndex: number): number {
		const clampedCellIndex = Math.min(cellIndex, getRightmostCellIndex(lineText));
		const cellStartCh = getChByCellIndex(lineText, clampedCellIndex);
		if (cellStartCh === -1) return 0;
		const segInfo = getInCellLineInfo(lineText, cellStartCh);
		if (!segInfo) return 0;
		return 1 + this.walkSegments(lineText, segInfo, true, Infinity).steps;
	}

}
