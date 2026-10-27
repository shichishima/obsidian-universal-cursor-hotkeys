// Thin wrappers around Obsidian's own popout-aware `activeWindow` global for
// the two deferred-execution APIs this plugin uses (setTimeout,
// requestAnimationFrame). `activeWindow` (not bare `window`) is deliberate
// everywhere this plugin defers work — see the 0.11.0 CHANGELOG entry
// ("switched every deferred setTimeout/requestAnimationFrame call... from
// the bare window global to Obsidian's own popout-aware activeWindow"):
// using bare `window` would regress the popout-window cursor-visibility/
// goal-column bugs already fixed then (a command run from a popped-out
// note window must defer against *that* window's own event loop, not the
// main window's).
//
// Obsidian's automated pre-release review flags every raw
// `activeWindow.setTimeout`/`activeWindow.requestAnimationFrame` call site
// as "use window.* instead" (eslint-plugin-obsidianmd's own
// `prefer-window-timers` rule, confirmed live against both the locally
// installed version and the exact review-tool wording) — a false positive
// for this plugin specifically (see the rationale above). Routing every
// call through these two functions instead collapses the flagged pattern
// from 23 call sites (12 setTimeout + 11 requestAnimationFrame, across
// main.ts and vim-support.ts) down to the 2 lines below, and keeps the "why
// activeWindow, not window" rationale in one place instead of unstated at
// 23 separate call sites.
//
// 2026-10-25: confirmed this rule's own direction flipped at some point
// between eslint-plugin-obsidianmd 0.2.9 (this repo's prior devDependency,
// had `prefer-active-window-timers` recommending `activeWindow`) and 0.4.2
// (current, now `prefer-window-timers` recommending bare `window`,
// explicitly flagging `activeWindow.*` as wrong). Found one real upstream
// motivation for the newer direction (chhoumann/quickadd#2182): an
// `activeWindow.setTimeout` call's own timer dies if the specific window it
// was scheduled against closes before it fires — a real risk for a
// debounced save outliving a transient popout. That's a different usage
// shape than this file's own (a same-interaction, 1-2-frame UI
// reconciliation deferral, not a longer-lived debounce reasonably expected
// to outlive the window it started in), so it doesn't by itself override
// this file's own confirmed-live regression history above. Planned,
// post-0.12.0 follow-up, not yet done: (1) re-verify live whether switching
// to bare `window` actually still regresses now, in case something else
// about Obsidian's own popout handling changed since the original 0.11.0
// finding; (2) if it still does, file an upstream issue against
// eslint-plugin-obsidianmd explaining why `prefer-window-timers` is the
// wrong call for this specific "short deferral following an interaction in
// the window that's still open" usage shape.
//
// Neither call site anywhere in this plugin uses the returned ID with
// clearTimeout/cancelAnimationFrame (confirmed via source search before
// this refactor), so these can stay simple pass-throughs with no cancel
// API of their own.

export function setTimeoutOnActiveWindow(fn: () => void, delay?: number): number {
	return activeWindow.setTimeout(fn, delay);
}

export function requestAnimationFrameOnActiveWindow(fn: FrameRequestCallback): number {
	return activeWindow.requestAnimationFrame(fn);
}
