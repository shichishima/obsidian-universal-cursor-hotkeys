// Shared window stub for vim-support.ts tests. vitest's 'node' environment has
// no `window`/`activeWindow` global, but getActiveEditor()/getVim() (window.app)
// and vim-support.ts's own activeWindow.setTimeout/activeWindow.requestAnimationFrame
// calls all need one. Both globals point at the same stub object — real Obsidian
// guarantees activeWindow.app === window.app (see main.ts's own popout-window
// fix), so a single shared fake keeps that invariant here too.
//
// setTimeout/requestAnimationFrame here are queued, not run immediately —
// calling them synchronously would let a deferred callback's effects run
// *before* moveByLines' own synchronous tail end (its `this.lastCm = cm`
// etc.), inverting the real ordering and clobbering the resync. In the real
// app a genuine setTimeout(fn, 0) always runs after the current call stack
// (including moveByLines' remaining code) finishes; call win.flush() once
// a test wants those deferred effects applied, mirroring that.

export interface FakeEditor {
	inTableCell: boolean
	getCursor: () => { line: number; ch: number }
	getLine: (n: number) => string
	activeCM?: any
	cm?: any
}

export function installVimWindow(editor?: FakeEditor) {
	const queue: Array<() => void> = []
	const win: any = {
		app: { workspace: { activeEditor: { editor } } },
		setTimeout: (fn: (...args: any[]) => void, ..._rest: any[]) => { queue.push(fn); return 0 },
		requestAnimationFrame: (fn: (...args: any[]) => void) => { queue.push(fn); return 0 },
	}
	;(globalThis as any).window = win
	;(globalThis as any).activeWindow = win
	return {
		setEditor(e: FakeEditor | undefined) {
			win.app.workspace.activeEditor.editor = e
		},
		// Runs all queued callbacks, including further ones they themselves
		// queue (e.g. scheduleRowCrossing's own nested requestAnimationFrame),
		// until none remain.
		flush() {
			while (queue.length > 0) {
				const fn = queue.shift()!
				fn()
			}
		},
	}
}

export function uninstallVimWindow() {
	delete (globalThis as any).window
	delete (globalThis as any).activeWindow
}
