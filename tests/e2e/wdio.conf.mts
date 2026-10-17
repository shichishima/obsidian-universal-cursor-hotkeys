import * as path from "path"
import { parseObsidianVersions } from "wdio-obsidian-service";
import { env } from "process";

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
		'./specs/exitTableSmartHome.e2e.ts',
		'./specs/setMarkTableSkip.e2e.ts',
		'./specs/setMarkMouseAndLeafChange.e2e.ts',
		'./specs/setMarkEscapeKeydown.e2e.ts',
		'./specs/setMarkNativeClipboardAndDelete.e2e.ts',
		'./specs/setMarkNativeCollapseClearing.e2e.ts',
		'./specs/undoInCellVLStale.e2e.ts',
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
			// Both paths below are resolved relative to this config file's
			// own directory (tests/e2e/), not the CWD — confirmed live after
			// an initial "vault doesn't exist" error with CWD-relative paths.
			plugins: ["../.."],
			vault: "vaults/smoke",
		},
	})),

	services: ["obsidian"],
	reporters: ['obsidian'],

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
