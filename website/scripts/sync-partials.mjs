// Copies partial-page staging drafts (edited as Obsidian notes, outside this
// repo) into the JA i18n tree's own _partials/ as .mdx — the staging vault
// is JA content, so it belongs under i18n/ja/, not the default (EN) docs/
// tree. Every settings.md that imports one of these uses a *relative*
// import path (e.g. "../_partials/_foo.mdx"), never the @site/-rooted
// absolute form: @site/ always resolves to one single physical path
// regardless of which locale is rendering, so an absolute import would
// serve the same (JA) content to every locale. A relative import instead
// resolves against each locale's own doc file location, and since
// docs/_partials/, i18n/ja/.../current/_partials/, and (once they exist)
// i18n/zh/.../current/_partials/ all sit at the same relative position
// inside their own locale tree, the identical "../_partials/_foo.mdx"
// import string picks up the right language's own file in each locale.
// Applies the same MDX-safety fixes .claude/data/sync_i18n_staging.py
// already applies when syncing JA doc pages: a bare <br> must become a
// self-closed <br/>, and a heading's own trailing "{#id}" must be escaped
// to "\{#id}" — a bare "{" opens a JS expression in MDX, crashing the
// build.
//
// Runs automatically via the presync.../prestart/prebuild hooks in
// package.json. On a machine without the staging vault (e.g. CI), each
// entry's source path simply doesn't exist, so this is a no-op: whatever
// i18n/ja/.../_partials/*.mdx file is already committed from the last
// local run is used as-is — this script never fails the build over a
// missing source.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.join(__dirname, '..');

const STAGING_ROOT = '/Users/shichi/Documents/GitHub/obsidian-work/80_private/2026_2Q/UCH-website';

const JA_PARTIALS_DIR = path.join(
	'i18n', 'ja', 'docusaurus-plugin-content-docs', 'current', '_partials',
);

// [staging-relative source, JA _partials-relative dest]
const PARTIALS = [
	['_settings-status.md', '_settings-status.mdx'],
	['_settings-apply-recommended.md', '_settings-apply-recommended.mdx'],
	['_settings-hotkey-settings-table.md', '_settings-hotkey-settings-table.mdx'],
	['_displaced-commands.md', '_displaced-commands.mdx'],
	['_settings-individual.md', '_settings-individual.mdx'],
];

function fixBrSelfClose(text) {
	// Same code/inline-code exclusion as sync_i18n_staging.py's own
	// _replace_br_outside_code — a <br> inside a fenced block or inline
	// code span is prose *talking about* the tag, not a real line break.
	const codeSpanRe = /```[\s\S]*?```|`[^`\n]*`/g;
	let result = '';
	let last = 0;
	for (const m of text.matchAll(codeSpanRe)) {
		result += text.slice(last, m.index).replaceAll('<br>', '<br/>');
		result += m[0];
		last = m.index + m[0].length;
	}
	result += text.slice(last).replaceAll('<br>', '<br/>');
	return result;
}

function escapeHeadingIds(text) {
	return text.replace(/^(#{1,6} .*?)[ \t]*(?<!\\)\{(#[\w-]+)\}[ \t]*$/gm, '$1 \\{$2}');
}

for (const [src, dest] of PARTIALS) {
	const srcPath = path.join(STAGING_ROOT, src);
	const destPath = path.join(websiteRoot, JA_PARTIALS_DIR, dest);
	if (!fs.existsSync(srcPath)) {
		console.log(`sync-partials: skipping ${src} (staging file not found, keeping existing ${path.relative(websiteRoot, destPath)} as-is)`);
		continue;
	}
	let text = fs.readFileSync(srcPath, 'utf-8');
	text = fixBrSelfClose(text);
	text = escapeHeadingIds(text);
	fs.mkdirSync(path.dirname(destPath), {recursive: true});
	fs.writeFileSync(destPath, text);
	console.log(`sync-partials: synced ${path.relative(websiteRoot, destPath)} from ${src}`);
}
