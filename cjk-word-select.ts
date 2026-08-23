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
// Deliberately scoped to *only* intervene when CM6's own native run at the
// click position would actually span a CJK character somewhere in it — every
// other case (a plain-Latin word, punctuation, whitespace, single/triple
// click) returns null so CM6's own already-correct default handles it
// untouched. This is a narrower, lower-regression-risk stance than globally
// replacing groupAt's own char-categorizer logic.
//
// Gating on "just the clicked character" (an earlier version of this file)
// under-fires: CM6's default word class is \p{Alphabetic}\p{Number}_ — Latin
// letters and CJK characters both count as "Word" with no boundary between
// them, so an ASCII term embedded in Japanese prose (e.g. 「…扱いがEmacsとは
// 異なる…」) is one giant native run. Double-clicking squarely inside "Emacs"
// itself has no CJK character adjacent to it, so the old adjacency-only
// check declined to intervene there — reproducing the exact bug for that
// sub-word (confirmed live, 2026-08-22). The fix: scan outward to find that
// *native* run first (mirroring groupAt's own word-class boundary), and gate
// on whether the run contains a CJK character *anywhere*, not just at the
// click. The actual selection returned is still the narrower Intl.Segmenter
// span (which already correctly isolates "Emacs" from the surrounding
// Japanese on its own) — only the gating changed.

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

// Mirrors CM6's own default charCategorizer's "Word" class exactly
// (\p{Alphabetic}\p{Number}_, see @codemirror/state's makeCategorizer) — this
// is deliberately broader than isCjkChar, since it needs to match whatever
// native groupAt would treat as one contiguous run.
const NATIVE_WORD_CHAR_REGEX = /[\p{Alphabetic}\p{Number}_]/u;

function isNativeWordChar(ch: string | undefined): boolean {
	return ch !== undefined && NATIVE_WORD_CHAR_REGEX.test(ch);
}

// Finds the same contiguous run CM6's own groupAt would land on from this
// position (scanning outward while isNativeWordChar holds), or null if `ch`
// isn't on/adjacent to a word-class character at all.
function nativeWordRunAt(lineText: string, ch: number): WordSpan | null {
	let probe = ch;
	if (!isNativeWordChar(lineText[ch])) probe = ch - 1;
	if (!isNativeWordChar(lineText[probe])) return null;
	let from = probe, to = probe + 1;
	while (from > 0 && isNativeWordChar(lineText[from - 1])) from--;
	while (to < lineText.length && isNativeWordChar(lineText[to])) to++;
	return { from, to };
}

// Returns the segmenter-computed word span at `ch`, or null if the native
// word-class run at `ch` contains no CJK character at all (the "don't
// intervene, let CM6's own default handle it" case).
export function getCjkWordSpan(lineText: string, ch: number): WordSpan | null {
	const run = nativeWordRunAt(lineText, ch);
	if (!run) return null;
	if (![...lineText.slice(run.from, run.to)].some(isCjkChar)) return null;
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
