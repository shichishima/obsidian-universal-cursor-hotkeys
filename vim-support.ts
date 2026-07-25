import { Setting, sanitizeHTMLToDom } from 'obsidian';
import { findClusterBreak } from '@codemirror/state';

// Obsidian's built-in Vim mode (codemirror-vim) — not exposed in obsidian.d.ts.
interface VimPos { line: number; ch: number }
interface VimMotionArgs { forward: boolean; repeat: number }
type VimMotionFn = (cm: unknown, head: VimPos, motionArgs: VimMotionArgs) => VimPos;
interface VimApi {
	defineMotion(name: string, fn: VimMotionFn): void;
}
interface VimCm {
	getLine(line: number): string;
}

const getVim = (): VimApi | undefined =>
	(window as unknown as { CodeMirrorAdapter?: { Vim?: VimApi } }).CodeMirrorAdapter?.Vim;

// Minimal shape VimSupport needs from the host plugin — kept structural (duck-typed)
// rather than importing the concrete plugin class, so this module has no dependency
// on main.ts and can be lifted out (e.g. into a separate plugin) without untangling.
export interface VimSupportHost {
	settings: { vimHlSupport: boolean };
	saveSettings(): Promise<void>;
}

export class VimSupport {
	private readonly host: VimSupportHost;

	// Not persisted — whether the Vim h/l override is actually active in the
	// current running session. Re-enabling always works live; disabling does not
	// (see restoreHlOverride), so this only ever flips true → it goes back to
	// false only via a fresh app start where settings.vimHlSupport is already off.
	liveApplied = false;

	constructor(host: VimSupportHost) {
		this.host = host;
	}

	get wantsOn(): boolean {
		return this.host.settings.vimHlSupport;
	}

	// Call from the plugin's onload().
	setup(): void {
		if (this.host.settings.vimHlSupport) {
			this.applyHlOverride();
			this.liveApplied = true;
		}
	}

	// Call from the plugin's onunload(). Best-effort only — see restoreHlOverride's own caveat.
	teardown(): void {
		this.restoreHlOverride();
	}

	// State A -> B. Applies immediately; reliable.
	enableHlSupport(): void {
		this.host.settings.vimHlSupport = true;
		this.applyHlOverride();
		this.liveApplied = true;
		void this.host.saveSettings();
	}

	// State B -> C. Does not touch the live override (disabling isn't reliable
	// mid-session) — only schedules it to stay off from the next app start.
	scheduleDisableHlSupport(): void {
		this.host.settings.vimHlSupport = false;
		void this.host.saveSettings();
	}

	// State C -> B. The override was never actually removed, so this is just
	// cancelling the pending disable — reliable, no re-apply needed.
	cancelDisableHlSupport(): void {
		this.host.settings.vimHlSupport = true;
		void this.host.saveSettings();
	}

	// Vim's own moveByCharacters, hardcoded (codemirror-vim's `motions` table is
	// write-only via defineMotion — there is no public API to read the previous
	// value before overriding it, so this is our restore target on toggle-off /
	// unload). If another plugin's vimrc customized 'moveByCharacters' before ours
	// loaded, restoring goes to this vim.js default rather than that customization.
	private static readonly VIM_DEFAULT_MOVE_BY_CHARACTERS: VimMotionFn = (_cm, head, motionArgs) => ({
		line: head.line,
		ch: motionArgs.forward ? head.ch + motionArgs.repeat : head.ch - motionArgs.repeat,
	});

	// Grapheme-cluster-aware replacement for h/l (moveByCharacters). Fixes two
	// native bugs observed in Obsidian's Vim mode inside Live Preview table cells:
	// (1) naive ch±repeat arithmetic miscounts multi-UTF-16-unit characters
	//     (e.g. surrogate-pair emoji), landing mid-character.
	// (2) h/l cross into the adjacent table cell even from a non-boundary
	//     position (e.g. the end of a non-last wrapped sub-line). By always
	//     computing and returning a position clamped within the current line
	//     ourselves, we never hand vim.js an out-of-range Pos for it to "fix" —
	//     which is where the cell-crossing appears to happen.
	private readonly moveByCharacters: VimMotionFn = (cm, head, motionArgs) => {
		const lineText = (cm as VimCm).getLine(head.line);
		let ch = head.ch;
		for (let i = 0; i < motionArgs.repeat; i++) {
			const next = findClusterBreak(lineText, ch, motionArgs.forward);
			if (next === ch) break; // already at the line boundary; vim's h/l don't wrap
			ch = next;
		}
		return { line: head.line, ch };
	};

	private applyHlOverride(): void {
		getVim()?.defineMotion('moveByCharacters', this.moveByCharacters);
	}

	// Best-effort restore — see the liveApplied field's own note: this does not
	// reliably take effect within a running session (cause unconfirmed), so it
	// is only ever called from teardown(), never exposed as a live "disable" action.
	private restoreHlOverride(): void {
		getVim()?.defineMotion('moveByCharacters', VimSupport.VIM_DEFAULT_MOVE_BY_CHARACTERS);
	}
}

export function renderVimSupportSetting(containerEl: HTMLElement, vim: VimSupport, rerender: () => void): void {
	// State A: never enabled this session. B: enabled and live. C: disable scheduled for next restart.
	const state: 'A' | 'B' | 'C' = !vim.liveApplied ? 'A' : (vim.wantsOn ? 'B' : 'C');

	const baseDesc = 'Fixes two native bugs in Obsidian\'s Vim mode inside Live Preview table cells — ' +
		'h/l miscounting multi-byte characters (e.g. emoji), and h/l incorrectly jumping to the adjacent ' +
		'cell instead of stopping at the line boundary.<br>' +
		'Off by default: if you already customize h/l via your own vimrc or another Vim plugin, enabling this will override that.';

	const setting = new Setting(containerEl).setName('Vim h/l support (experimental)');
	const setDesc = (html: string) => setting.setDesc(sanitizeHTMLToDom(html));

	if (state === 'A') {
		setDesc(baseDesc);
		setting.addButton(btn => btn
			.setButtonText('Enable')
			.setCta()
			.onClick(() => {
				vim.enableHlSupport();
				rerender();
			}));
	} else if (state === 'B') {
		setDesc('✅ <b>Enabled</b> — takes effect immediately.<br>' + baseDesc);
		setting.addButton(btn => btn
			.setButtonText('Disable (after restart)')
			.setCta()
			.onClick(() => {
				vim.scheduleDisableHlSupport();
				rerender();
			}));
	} else {
		setDesc('⏳ <b>Will disable after you restart Obsidian.</b> Still active for the rest of this session.<br>' + baseDesc);
		setting.addButton(btn => btn
			.setButtonText('Keep enabled')
			.setCta()
			.onClick(() => {
				vim.cancelDisableHlSupport();
				rerender();
			}));
	}
}
