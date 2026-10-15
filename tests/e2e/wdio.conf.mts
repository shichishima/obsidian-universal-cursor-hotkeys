import * as path from "path"
import { parseObsidianVersions } from "wdio-obsidian-service";
import { env, platform } from "process";
import { execSync } from "child_process";

// wdio-obsidian-service downloads/caches Obsidian app binaries here, resolved
// against the CWD the wdio command is run from (the plugin's own repo root,
// via the "test:e2e" npm script) — not against this config file's own path.
const cacheDir = path.resolve(".obsidian-cache");

// macOS gives the newly-launched Obsidian window keyboard focus and brings
// it to the front — stealing both from whatever the person is actually
// working in. There's no launch-time flag to suppress this (wdio-obsidian-
// service spawns the Obsidian binary directly, not via `open`, so `open -g`'s
// own "launch without activation" doesn't apply here), so instead: capture
// whichever app was frontmost right before the test run starts, then
// re-activate it right after each Obsidian window appears. Confirmed live
// that osascript reaches the real desktop session (not some sandboxed
// stand-in), via `tell application "System Events" to get name of first
// process whose frontmost is true`. Obsidian's own window is untouched —
// still visible/normal, just no longer holding focus.
const frontmostAppBeforeLaunch = platform === 'darwin'
	? execSync('osascript -e \'tell application "System Events" to get name of first process whose frontmost is true\'').toString().trim()
	: null;

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

	specs: ['./specs/**/*.e2e.ts'],

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

	before: function () {
		if (frontmostAppBeforeLaunch) {
			execSync(`osascript -e 'tell application "${frontmostAppBeforeLaunch}" to activate'`);
		}
	},
}
