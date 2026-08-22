// Double-click word selection for CJK (Japanese/Chinese) text — reuses the
// same Intl.Segmenter-based word-boundary engine as the Emacs word-right/left
// and Vim w/b/e commands (word-segmentation.ts), but wired into CM6's mouse
// gesture facet instead of a keyboard command.
//
// CM6's own built-in double-click selection (basicMouseSelection -> groupAt,
// see @codemirror/view's own source) expands from the click position while
// state.charCategorizer keeps classifying characters as "Word" — for CJK
// scripts, which have no whitespace between words, this treats an entire run
// of kanji/hiragana/katakana as a single "word", making double-click useless
// for word-level selection. Confirmed via a real Obsidian app.js read
// (2026-08-21/22) that Obsidian itself does not override this path for
// double-click (it only customizes triple-click) — the CM6 default really is
// what fires, so intercepting EditorView.mouseSelectionStyle is the right
// extension point.
//
// Deliberately scoped to *only* intervene when the click actually lands on a
// CJK character — every other case (Latin text, punctuation, whitespace,
// single/triple click) returns null so CM6's own already-correct default
// handles it untouched. This is a narrower, lower-regression-risk stance
// than globally replacing groupAt's own char-categorizer logic.

import type { EditorView, MouseSelectionStyle } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { findWordSpanOnLine, type WordSpan } from './word-segmentation';

// Hiragana, Katakana, and CJK Unified Ideographs (+ Extension A) — the
// no-space-between-words scripts this feature targets. Deliberately excludes
// Hangul: Korean text is normally space-delimited already, so CM6's own
// default double-click already produces a sensible result for it.
const CJK_CHAR_REGEX = /[぀-ゟ゠-ヿ㐀-䶿一-鿿]/;

export function isCjkChar(ch: string): boolean {
	return CJK_CHAR_REGEX.test(ch);
}

// Returns the segmenter-computed word span at `ch`, or null if `ch` isn't
// adjacent to a CJK character at all (the "don't intervene" case). Checks
// both sides of `ch` the same way CM6's own groupAt considers bias at a
// segment boundary — a double-click can land exactly between two runs.
export function getCjkWordSpan(lineText: string, ch: number): WordSpan | null {
	const after = ch < lineText.length ? lineText[ch] : undefined;
	const before = ch > 0 ? lineText[ch - 1] : undefined;
	if (!(after !== undefined && isCjkChar(after)) && !(before !== undefined && isCjkChar(before))) return null;
	return findWordSpanOnLine(lineText, ch, true);
}

interface DocLike {
	lineAt(pos: number): { from: number; to: number; text: string };
}

function absoluteSpanAt(doc: DocLike, pos: number): { from: number; to: number } | null {
	const line = doc.lineAt(pos);
	const span = getCjkWordSpan(line.text, pos - line.from);
	if (!span) return null;
	return { from: line.from + span.from, to: line.from + span.to };
}

// The actual EditorView.mouseSelectionStyle provider. Registered once,
// unconditionally, via main.ts's registerEditorExtension — gated on the
// live settings toggle inside the callback itself (checked fresh on every
// mousedown) rather than by conditionally registering/unregistering the
// facet, since there's no native binding to unmap here (unlike the Vim
// leader-key toggles).
export function cjkWordSelectionStyle(isEnabled: () => boolean) {
	return (view: EditorView, event: MouseEvent): MouseSelectionStyle | null => {
		if (!isEnabled()) return null;
		if (event.button !== 0 || event.detail !== 2) return null;

		let startPos = view.posAtCoords({ x: event.clientX, y: event.clientY });
		if (startPos == null) return null;
		let startSpan = absoluteSpanAt(view.state.doc, startPos);
		if (!startSpan) return null;

		const startSel = view.state.selection;

		return {
			update(update) {
				if (update.docChanged) {
					startPos = update.changes.mapPos(startPos!);
					startSpan = {
						from: update.changes.mapPos(startSpan!.from),
						to: update.changes.mapPos(startSpan!.to),
					};
				}
			},
			get(curEvent, extend, multiple) {
				const anchorPos = startPos!;
				const anchorSpan = startSpan!;
				const curPos = view.posAtCoords({ x: curEvent.clientX, y: curEvent.clientY }) ?? anchorPos;
				const curSpan = absoluteSpanAt(view.state.doc, curPos) ?? { from: curPos, to: curPos };

				let range = EditorSelection.range(curSpan.from, curSpan.to);
				if (curPos !== anchorPos && !extend) {
					const from = Math.min(anchorSpan.from, curSpan.from);
					const to = Math.max(anchorSpan.to, curSpan.to);
					range = curSpan.from < anchorSpan.from ? EditorSelection.range(to, from) : EditorSelection.range(from, to);
				}

				if (extend) return startSel.replaceRange(startSel.main.extend(range.from, range.to));
				if (multiple) return startSel.addRange(range);
				return EditorSelection.create([range]);
			},
		};
	};
}
