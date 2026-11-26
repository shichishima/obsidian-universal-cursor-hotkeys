// Thin wrapper around the deprecated `Document.execCommand`/
// `HTMLElement.ownerDocument.execCommand` API, used throughout main.ts to
// mutate/undo the title field, frontmatter Properties widgets, and Bases
// cells — none of them backed by CM6's own Editor, so there's no
// EditorView.dispatch equivalent available for them. execCommand is the
// only API that stays integrated with each widget's own native (browser)
// undo stack while doing this.
//
// `@typescript-eslint/no-deprecated` flags every one of the 12 call sites
// that used to call `.execCommand(...)` directly (confirmed against
// Obsidian's own automated pre-release review, which reports the same
// finding). Routing every call through this one function instead collapses
// the flagged pattern down to the single line below — same technique
// dom-timers.ts already uses for the activeWindow-timer warnings, and for
// the same reason: the underlying API choice is deliberate here, not an
// oversight, so the warning is accepted at one line instead of silenced
// nowhere.
export function execCommandCompat(doc: Document, commandId: string, value?: string): boolean {
	return doc.execCommand(commandId, false, value);
}
