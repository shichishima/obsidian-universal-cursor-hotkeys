// Pure string-based table-cell parsing helpers, shared between the Emacs-style
// navigation in main.ts and the Vim motion overrides in vim-support.ts. These
// operate only on raw line text + a ch offset (outer document coordinates) —
// no CM6/EditorView/VL awareness at all — which is exactly why both call sites
// can share them safely: neither side's view-layer logic leaks into the other.

const CELL_SEPARATOR_REGEX = /(?<!\\)\|/g;

export interface InCellLineInfo {
	lineType: 'single' | 'first' | 'middle' | 'last';
	startOfInCellLine: number;   // left edge (ch position)
	endOfInCellLine: number;     // right edge (ch position)
	isEmpty: boolean;            // startOfInCellLine === endOfInCellLine
}

export function getPipePositions(line: string): number[] {
	return [...line.matchAll(CELL_SEPARATOR_REGEX)].map(m => m.index);
}

// Returns the cell-boundary positions for a table row, length = cellCount + 1.
// boundaries[0]      = the leading `|` position, or -1 if the row omits it —
//                      a virtual left edge, mirroring how boundaries[last]
//                      already falls back to line.length when the trailing
//                      `|` is omitted. GFM tables require both edge pipes to
//                      be omitted together (a row with only one omitted
//                      isn't recognized as a table row at all — confirmed
//                      live), but every function below stays correct
//                      regardless, since it never assumes which combination
//                      it was given.
// boundaries[i]      = the i-th inner separator `|` (1 <= i <= cellCount - 1)
// boundaries[last]   = the trailing `|` position, or line.length if omitted.
function getCellBoundaries(line: string): number[] {
	const pipes = getPipePositions(line);
	// A line with zero pipes isn't recognizable as a table row at all (even a
	// multi-cell row with both edges omitted still has its inner separator
	// pipes) — return no boundaries rather than synthesizing a virtual
	// single-cell row, so callers keep treating plain text as "not a cell."
	if (pipes.length === 0) return [];
	const hasLeadingPipe  = line.slice(0, pipes[0]).trim() === '';
	const hasTrailingPipe = line.slice(pipes[pipes.length - 1] + 1).trim() === '';
	const boundaries = [...pipes];
	if (!hasLeadingPipe) boundaries.unshift(-1);
	if (!hasTrailingPipe) boundaries.push(line.length);
	return boundaries;
}

// Index of the rightmost boundary strictly before ch (i.e., ch's cell spans
// boundaries[idx]..boundaries[idx + 1]), or -1 if ch is at/before the very
// first boundary. Shared scan logic for getCellBounds/getCellIndex, so the
// edge-pipe-omission handling (via getCellBoundaries) lives in one place.
function findBoundaryIndex(boundaries: number[], ch: number): number {
	let idx = -1;
	for (let i = 0; i < boundaries.length; i++) {
		if (boundaries[i] < ch) idx = i;
		else break;
	}
	return idx;
}

// Returns the open/close boundary positions bounding the cell that contains ch.
// open  = the boundary immediately to the left of ch (-1 if the row omits its leading `|`)
// close = the boundary immediately to the right of ch (line.length if the row omits its trailing `|`)
// Returns null if ch is not inside any cell (at/before the first boundary, or
// at/after the last).
export function getCellBounds(line: string, ch: number): { open: number; close: number } | null {
	const boundaries = getCellBoundaries(line);
	const idx = findBoundaryIndex(boundaries, ch);
	if (idx === -1 || idx >= boundaries.length - 1) return null;
	return { open: boundaries[idx], close: boundaries[idx + 1] };
}

// +----------------------+
// |(a)some text in the   |	(a) startOfCellContent
// | cell.<br>            |
// | 2nd in-cell line<br> |	(*) cursor potition
// | cursor is(*)here<br> |
// | last in-cell line(b) |	(b) endOfCellContent
// +----------------------+
// Indicates cell start/end, regardless of line wrapping or in-cell lines.

// Returns target cursor position when moving to the left cell with Ctrl-E or Ctrl-F.
export function getStartOfCellContent(line: string, ch: number): number {
	const bounds = getCellBounds(line, ch);
	if (!bounds) return 0;
	const { open, close } = bounds;
	const firstNonSpace = line.slice(open + 1, close).search(/\S/);
	return firstNonSpace === -1 ? open + 1 : open + 1 + firstNonSpace;
}

// Returns target cursor position when moving to the right cell with Ctrl-A or Ctrl-B.
export function getEndOfCellContent(line: string, ch: number): number {
	const bounds = getCellBounds(line, ch);
	if (!bounds) return 0;
	const { open, close } = bounds;
	return open + 1 + line.slice(open + 1, close).trimEnd().length;
}

// Returns endOfCellContent for the cell at the given 0-based cellIndex.
// Returns -1 if cellIndex is out of range.
export function getEndOfCellContentByCellIndex(line: string, cellIndex: number): number {
	const boundaries = getCellBoundaries(line);
	if (cellIndex < 0 || cellIndex >= boundaries.length - 1) return -1;
	const openPipe  = boundaries[cellIndex];
	const closePipe = boundaries[cellIndex + 1];
	return openPipe + 1 + line.slice(openPipe + 1, closePipe).trimEnd().length;
}

// Returns the 0-based index of the rightmost cell in a table row.
export function getRightmostCellIndex(line: string): number {
	return Math.max(0, getCellBoundaries(line).length - 2);
}

export function getCellIndex(line: string, ch: number): number {
	return Math.max(0, findBoundaryIndex(getCellBoundaries(line), ch));
}

export function getChByCellIndex(lineText: string, cellIndex: number): number {
	const boundaries = getCellBoundaries(lineText);

	if (cellIndex >= 0 && cellIndex < boundaries.length - 1) {
		const openPipe  = boundaries[cellIndex];
		const closePipe = boundaries[cellIndex + 1];
		const cellContent = lineText.substring(openPipe + 1, closePipe);
		const firstNonSpaceMatch = cellContent.search(/\S/);

		return firstNonSpaceMatch !== -1
			? openPipe + 1 + firstNonSpaceMatch
			: openPipe + 1;
	}

	return -1;
}

// Parses the cell at position ch and returns info about the in-cell line
// (the <br>-delimited sub-line) that the cursor is currently on.
export function getInCellLineInfo(line: string, ch: number): InCellLineInfo | null {
	// 1. Find bounding pipes for the cell containing ch
	const bounds = getCellBounds(line, ch);
	if (!bounds) return null;
	const cellStart = bounds.open + 1;
	const cellEnd   = bounds.close;

	// 2. Find <br> tags within the cell (case-insensitive, no spaces or slash inside)
	const cellContent = line.slice(cellStart, cellEnd);
	const brMatches   = [...cellContent.matchAll(/<[bB][rR]>/g)];
	const brPositions = brMatches.map(m => ({
		start: cellStart + m.index,
		end:   cellStart + m.index + m[0].length,
	}));

	// 3. Build in-cell line segments separated by <br> tags
	//    Segment k: [ prevEnd, brPositions[k].start )
	//    Last segment: [ brPositions[n-1].end, cellEnd )
	const segments: Array<{ start: number; end: number }> = [];
	let prevEnd = cellStart;
	for (const br of brPositions) {
		segments.push({ start: prevEnd, end: br.start });
		prevEnd = br.end;
	}
	segments.push({ start: prevEnd, end: cellEnd });

	// 4. Find which segment contains ch
	//    Boundary: ch at seg.end (= br.start) belongs to the current segment (right edge of it)
	let segIndex = segments.findIndex(seg => ch >= seg.start && ch <= seg.end);
	if (segIndex === -1) {
		// ch is inside a <br> tag: assign to the preceding segment
		for (let i = 0; i < brPositions.length; i++) {
			if (ch > brPositions[i].start && ch < brPositions[i].end) {
				segIndex = i;
				break;
			}
		}
	}
	if (segIndex === -1) segIndex = segments.length - 1; // final fallback

	const seg = segments[segIndex];
	const n   = segments.length;

	// 5. Determine line type
	const lineType: InCellLineInfo['lineType'] =
		n === 1         ? 'single' :
		segIndex === 0  ? 'first'  :
		segIndex < n -1 ? 'middle' : 'last';

	// 6. Compute startOfInCellLine and endOfInCellLine
	//
	//  single / first : startOfInCellLine = first non-whitespace character position
	//                   (leading spaces after pipe or <br> are the separator, not content)
	//  middle / last  : startOfInCellLine = position right after <br>  (= seg.start)
	//
	//  single / last  : endOfInCellLine = position after last non-whitespace  (trimEnd)
	//  first  / middle: endOfInCellLine = position of <br>  (= seg.end)
	//
	//  isEmpty fallback when no non-whitespace is found:
	//    single -> seg.start  (endOfInCellLine = seg.start + 0 = seg.start -> isEmpty)
	//    first  -> seg.end    (= br.start -> startOfInCellLine = endOfInCellLine -> isEmpty)
	const segContent = line.slice(seg.start, seg.end);
	let startOfInCellLine: number;
	let endOfInCellLine: number;

	if (lineType === 'single' || lineType === 'first') {
		const firstNonSpace = segContent.search(/\S/);
		if (firstNonSpace === -1) {
			startOfInCellLine = lineType === 'single' ? seg.start : seg.end;
		} else {
			startOfInCellLine = seg.start + firstNonSpace;
		}
	} else {
		startOfInCellLine = seg.start; // right after <br>
	}

	if (lineType === 'single' || lineType === 'last') {
		endOfInCellLine = seg.start + segContent.trimEnd().length;
	} else {
		endOfInCellLine = seg.end; // position of <br>
	}

	return {
		lineType,
		startOfInCellLine,
		endOfInCellLine,
		isEmpty: startOfInCellLine === endOfInCellLine,
	};
}
