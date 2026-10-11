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
// as "use window.* instead" — a false positive for this plugin specifically
// (see the rationale above). Routing every call through these two
// functions instead collapses the flagged pattern from 23 call sites
// (12 setTimeout + 11 requestAnimationFrame, across main.ts and
// vim-support.ts) down to the 2 lines below, and keeps the "why
// activeWindow, not window" rationale in one place instead of unstated at
// 23 separate call sites.
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
