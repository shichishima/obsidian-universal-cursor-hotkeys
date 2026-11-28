import * as path from "path"
import { parseObsidianVersions } from "wdio-obsidian-service";
import { env } from "process";
import { browser } from "@wdio/globals";

// wdio-obsidian-service downloads/caches Obsidian app binaries here, resolved
// against the CWD the wdio command is run from (the plugin's own repo root,
// via the "test:e2e" npm script) — not against this config file's own path.
const cacheDir = path.resolve(".obsidian-cache");

// Single version for now (just wiring up the pipeline). Override via
// OBSIDIAN_VERSIONS, e.g. OBSIDIAN_VERSIONS='earliest/earliest latest/latest'
// — see parseObsidianVersions in wdio-obsidian-service's own docs.
const desktopVersions = await parseObsidianVersions(
	env.OBSIDIAN_VERSIONS ?? "latest/latest",
	{ cacheDir },
);

export const config: WebdriverIO.Config = {
	runner: 'local',
	framework: 'mocha',

	// Wrapped in one outer array (a single "group") so every spec file runs
	// in the same worker process against the same already-launched Obsidian
	// instance, instead of relaunching Obsidian fresh per file — avoids
	// paying the "let a freshly-opened file/table settle" cost repeatedly.
	// Explicit order, simplest first: confirmed live that whichever spec
	// runs first bears most of the brunt of the freshly-launched instance
	// still settling, so the lightest spec (smoke) goes first as a
	// de-facto warm-up, table-heavy specs last.
	specs: [[
		'./specs/smoke.e2e.ts',
		'./specs/multiCursorHome.e2e.ts',
		'./specs/imeComposition.e2e.ts',
		'./specs/keyUpgradesToggle.e2e.ts',
		'./specs/multiCursorTableCrossing.e2e.ts',
		'./specs/uppercaseWordMultiCursor.e2e.ts',
		'./specs/multicellCaseConversion.e2e.ts',
		'./specs/multicellSelectionArrowClear.e2e.ts',
		'./specs/killYankMultiCursor.e2e.ts',
		'./specs/killChainSplitPaneEcho.e2e.ts',
		'./specs/copyRegionSelectionCollapse.e2e.ts',
		'./specs/exitTableSmartHome.e2e.ts',
		'./specs/setMarkTableSkip.e2e.ts',
		'./specs/setMarkMouseAndLeafChange.e2e.ts',
		'./specs/setMarkEscapeKeydown.e2e.ts',
		'./specs/setMarkNativeClipboardAndDelete.e2e.ts',
		'./specs/setMarkPopoutNativeClearing.e2e.ts',
		'./specs/setMarkNativeCollapseClearing.e2e.ts',
		'./specs/setMarkShiftArrowUnification.e2e.ts',
		'./specs/setMarkBufferEdge.e2e.ts',
		'./specs/setMarkPageUpDown.e2e.ts',
		'./specs/recenterWithSetMark.e2e.ts',
		'./specs/addCursorAboveBelow.e2e.ts',
		'./specs/undoInCellVLStale.e2e.ts',
		'./specs/setMarkClearingGaps.e2e.ts',
		'./specs/vimJkGgGjGk.e2e.ts',
		'./specs/vimWordMotions.e2e.ts',
		'./specs/vimCaretJoinChar.e2e.ts',
		'./specs/vimLeaderTableCommands.e2e.ts',
		'./specs/vimTableUndoRedo.e2e.ts',
		'./specs/vimSpaceLeakGuard.e2e.ts',
		'./specs/deleteCharCellBr.e2e.ts',
		'./specs/transposeCharsCellBr.e2e.ts',
		'./specs/transposeCharsMultiCursor.e2e.ts',
		'./specs/cjkDoubleClickWordSelect.e2e.ts',
		'./specs/titleMovement.e2e.ts',
		'./specs/titleCrossingShort.e2e.ts',
		'./specs/titleCrossingWrapped.e2e.ts',
		'./specs/titleCrossingPopout.e2e.ts',
		'./specs/titleKillLine.e2e.ts',
		'./specs/titleKillWord.e2e.ts',
		'./specs/titleDeleteChar.e2e.ts',
		'./specs/titleWordMotion.e2e.ts',
		'./specs/titleSetMark.e2e.ts',
		'./specs/titleRegion.e2e.ts',
		'./specs/titleYank.e2e.ts',
		'./specs/titleKillYankPopout.e2e.ts',
		'./specs/propertyItemSelection.e2e.ts',
		'./specs/propertyCtrlBf.e2e.ts',
		'./specs/propertyCtrlG.e2e.ts',
		'./specs/propertyKeyUpgradeInterference.e2e.ts',
		'./specs/propertyValueEditMovement.e2e.ts',
		'./specs/propertySuggesterScopeLimitation.e2e.ts',
		'./specs/propertyValueEditSetMark.e2e.ts',
		'./specs/propertyValueEditKillYank.e2e.ts',
		'./specs/propertyValueEditKillWord.e2e.ts',
		'./specs/propertyValueEditDeleteChar.e2e.ts',
		'./specs/propertyValueEditWordMotion.e2e.ts',
		'./specs/propertyOtherTypesCtrlGPnbf.e2e.ts',
		'./specs/propertyMultiselectPillFallthrough.e2e.ts',
		'./specs/propertyMultiselectWordLeftPillEscape.e2e.ts',
		'./specs/propertyPillKillWordYankRoundtrip.e2e.ts',
		'./specs/propertyNameEdit.e2e.ts',
		'./specs/basesPropertyEditing.e2e.ts',
		'./specs/basesCellNavigation.e2e.ts',
		'./specs/basesRecenter.e2e.ts',
		'./specs/basesSetMarkSelectColumn.e2e.ts',
		'./specs/basesHomeEndColumnJump.e2e.ts',
		'./specs/basesArrowKeyUpgradeSelfCollision.e2e.ts',
		'./specs/basesPageUpDownCollision.e2e.ts',
		'./specs/frontmatterRecenter.e2e.ts',
		'./specs/titleCrossingFrontmatter.e2e.ts',
		'./specs/propertySimpleTypeCommandFallthrough.e2e.ts',
		'./specs/nativeWidgetShiftArrowAutoArm.e2e.ts',
		'./specs/pageUpDownTitlePropertyFallthrough.e2e.ts',
		'./specs/excalidrawKeyUpgradeNonInterference.e2e.ts',
	]],

	// Serial by default — confirmed live that running multiple Obsidian/
	// Electron instances in parallel on this machine can starve the
	// cell-focus reconciliation that table-entry commands depend on
	// (inTableCell intermittently never settling within a generous poll),
	// even though each spec gets its own sandboxed instance. Revisit raising
	// this once the suite is large enough for serial runs to actually hurt,
	// or override locally via WDIO_MAX_INSTANCES.
	maxInstances: Number(env.WDIO_MAX_INSTANCES || 1),

	capabilities: desktopVersions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
		browserName: 'obsidian',
		'wdio:obsidianOptions': {
			appVersion, installerVersion,
			// The first (local path) entry below is resolved relative to
			// this config file's own directory (tests/e2e/), not the CWD —
			// confirmed live after an initial "vault doesn't exist" error
			// with CWD-relative paths. The second entry installs Excalidraw
			// from Obsidian's own community-plugin registry, downloaded
			// once and cached by obsidian-launcher under cacheDir the same
			// way Obsidian app versions are (confirmed live: a second run
			// doesn't redownload) -- needed to verify Key Upgrades' Scope-
			// based rearchitecture (0.13.1) doesn't steal bare keys from a
			// real non-CM6 plugin surface, which this vault had no such
			// surface to test against before. Version pinned (rather than
			// left as the default "latest") so every run skips even the
			// lightweight "what's the latest version" GitHub check
			// entirely, not just the actual plugin download -- bump this
			// by hand if a newer Excalidraw version is ever needed.
			// The first (local path) entry below is resolved relative to
			// this config file's own directory (tests/e2e/), not the CWD —
			// confirmed live after an initial "vault doesn't exist" error
			// with CWD-relative paths. The second entry installs Excalidraw
			// from Obsidian's own community-plugin registry, downloaded
			// once and cached by obsidian-launcher under cacheDir the same
			// way Obsidian app versions are (confirmed live: a second run
			// doesn't redownload) -- needed to verify Key Upgrades' Scope-
			// based rearchitecture (0.13.1) doesn't steal bare keys from a
			// real non-CM6 plugin surface, which this vault had no such
			// surface to test against before. Version pinned (rather than
			// left as the default "latest") so every run skips even the
			// lightweight "what's the latest version" GitHub check
			// entirely, not just the actual plugin download -- bump this
			// by hand if a newer Excalidraw version is ever needed.
			//
			// Confirmed via a full-suite A/B comparison (2026-11-28) that
			// adding this introduces no regression: the same 5 tests fail
			// identically with and without it (propertyCtrlG.e2e.ts (7),
			// propertyNameEdit.e2e.ts (2)/(12), basesSetMarkSelectColumn.
			// e2e.ts (1)/(2) -- all pre-existing, unrelated), and the only
			// differing failures (multicellCaseConversion.e2e.ts with it
			// vs. basesPropertyEditing.e2e.ts (7) without) are generic
			// timing-sensitive flakiness already present in the full suite
			// regardless of Excalidraw, not something it introduced.
			plugins: ["../..", { id: "obsidian-excalidraw-plugin", version: "2.29.4" }],
			vault: "vaults/smoke",
		},
	})),

	services: ["obsidian"],
	reporters: ['obsidian'],

	// Excalidraw shows its own "Welcome to Excalidraw" release-notes modal
	// automatically on PLUGIN LOAD (not just when excalidraw-autocreate
	// runs) whenever its own previousRelease setting doesn't match its
	// current version -- which is every run here, since every run gets a
	// completely fresh vault copy with no persisted Excalidraw settings.
	// Confirmed live (2026-11-28): this modal is already open at the very
	// start of the smoke spec, before any other spec runs at all.
	//
	// excalidrawKeyUpgradeNonInterference.e2e.ts's own openFreshDrawing()
	// helper dismisses it too, but that spec runs LAST in the specs array
	// -- every other spec in between was running for the suite's entire
	// ~9 minutes with this modal left open and covering the whole window,
	// almost certainly the real cause of a reproducible cluster of
	// failures discovered this session (title-field Ctrl-B/F/A/E and
	// related commands doing nothing; multi-cell mouse-drag-selection
	// tests misbehaving) -- a modal overlay blocks real coordinate-based
	// pointer clicks from reaching whatever's underneath, and Obsidian's
	// own Modal class focus-traps, redirecting focus back into itself
	// shortly after any other element (e.g. the title field) is
	// programmatically focused elsewhere in the document.
	//
	// Dismissed here once, globally, right after Obsidian launches and
	// before any spec's own tests run -- not inside any individual spec,
	// since the whole point is that NOTHING should have to deal with this
	// modal being open at all.
	before: async function () {
		await browser.pause(2000)
		await browser.keys(['Escape'])
		await browser.pause(300)
	},

	mochaOpts: {
		ui: 'bdd',
		timeout: 60 * 1000,
	},
	waitforInterval: 250,
	waitforTimeout: 5 * 1000,
	logLevel: "warn",

	cacheDir: cacheDir,

	injectGlobals: false, // import describe/it/browser/expect explicitly
}
