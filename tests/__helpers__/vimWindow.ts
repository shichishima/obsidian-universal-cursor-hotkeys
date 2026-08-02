// Shared window stub for vim-support.ts tests. vitest's 'node' environment has
// no `window` global, but getActiveEditor()/getVim() and vim-support.ts's own
// window.setTimeout/window.requestAnimationFrame calls all need one.
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
}
