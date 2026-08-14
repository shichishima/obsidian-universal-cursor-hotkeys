// Shared word-boundary primitive for the Emacs-style word navigation in
// main.ts and Vim's w/b/e in vim-support.ts. Operates only on raw line text —
// no editor/host coupling, same tier as table-cell-utils.ts.
//
// Word-char runs are segmented via Intl.Segmenter (dictionary-based), so CJK
// text gets real morphological chunking instead of being treated as one long
// run. Intl.Segmenter's own "word" granularity does not merge consecutive
// punctuation into one segment (e.g. "foo...bar" yields three separate "."
// entries) — a merge pass over its non-word-like, non-whitespace output
// restores that convention.
//
// getBigWordSpans (Vim's bigWord/WORD — any non-whitespace run counts as one
// word) is unaffected by any of the above and is just a plain regex split —
// exported here for main.ts's findWordBoundaryOnLine (a from-a-clean-edge
// scanner, well suited to a spans list). vim-support.ts's own w/b/e port
// needs an arbitrary-mid-position char-by-char scan instead (see its own
// isBigWordChar), so it doesn't use this.

export interface WordSpan {
	from: number; // inclusive, line-local offset
	to: number;   // exclusive
}

const WHITESPACE_ONLY_REGEX = /^\s+$/;

let cachedSegmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter {
	if (!cachedSegmenter) cachedSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
	return cachedSegmenter;
}

// Splits one line into ordered, non-overlapping "word" runs — whitespace
// gaps are skipped, not returned.
export function getWordSpans(lineText: string): WordSpan[] {
	if (!lineText) return [];
	const spans: WordSpan[] = [];
	let pendingFrom = -1;
	let pendingTo = -1;
	const flushPending = () => {
		if (pendingFrom !== -1) spans.push({ from: pendingFrom, to: pendingTo });
		pendingFrom = -1;
		pendingTo = -1;
	};
	for (const { segment, index, isWordLike } of getSegmenter().segment(lineText)) {
		const from = index;
		const to = index + segment.length;
		if (isWordLike) {
			flushPending();
			spans.push({ from, to });
			continue;
		}
		if (WHITESPACE_ONLY_REGEX.test(segment)) {
			flushPending();
			continue;
		}
		// Punctuation (or other non-word-like, non-whitespace) run — merge
		// with an immediately-adjacent pending punctuation run, matching
		// vim's own "consecutive punctuation = one word" convention.
		if (pendingFrom !== -1 && pendingTo === from) {
			pendingTo = to;
		} else {
			flushPending();
			pendingFrom = from;
			pendingTo = to;
		}
	}
	flushPending();
	return spans;
}

// Finds the next (forward) or previous (!forward) word span on this line
// relative to fromCh, if one exists on this line. A span containing fromCh
// counts as the match in both directions.
export function findWordSpanOnLine(
	lineText: string, fromCh: number, forward: boolean,
): WordSpan | null {
	const spans = getWordSpans(lineText);
	if (forward) {
		return spans.find(s => s.to > fromCh) ?? null;
	}
	let result: WordSpan | null = null;
	for (const s of spans) {
		if (s.from < fromCh) result = s;
		else break;
	}
	return result;
}

// Vim's bigWord (W/B/E): any non-whitespace run is one word.
export function getBigWordSpans(lineText: string): WordSpan[] {
	const spans: WordSpan[] = [];
	const re = /\S+/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(lineText))) spans.push({ from: m.index, to: m.index + m[0].length });
	return spans;
}
