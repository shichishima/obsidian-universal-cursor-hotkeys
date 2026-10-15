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

	specs: ['./specs/**/*.e2e.ts'],

	maxInstances: Number(env.WDIO_MAX_INSTANCES || 4),

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
