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

// Returns the open/close pipe positions bounding the cell that contains ch.
// open  = index of the pipe immediately to the left of ch
// close = index of the pipe immediately to the right of ch (or line.length if absent)
// Returns null if ch is not inside any cell (no pipe to the left).
export function getCellBounds(line: string, ch: number): { open: number; close: number } | null {
	const pipes = getPipePositions(line);
	let open = -1;
	for (const p of pipes) {
		if (p < ch) open = p;
		else break;
	}
	if (open === -1) return null;
	const close = pipes.find(p => p >= ch) ?? line.length;
	return { open, close };
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
	const pipes = getPipePositions(line);
	if (cellIndex < 0 || cellIndex + 1 >= pipes.length) return -1;
	const openPipe  = pipes[cellIndex];
	const closePipe = pipes[cellIndex + 1];
	return openPipe + 1 + line.slice(openPipe + 1, closePipe).trimEnd().length;
}

// Returns the 0-based index of the rightmost cell in a table row.
export function getRightmostCellIndex(line: string): number {
	return Math.max(0, getPipePositions(line).length - 2);
}

export function getCellIndex(line: string, ch: number): number {
	return Math.max(0, getPipePositions(line.substring(0, ch)).length - 1);
}

export function getChByCellIndex(lineText: string, cellIndex: number): number {
	const pipes = getPipePositions(lineText);

	if (cellIndex >= 0 && cellIndex < pipes.length) {
		const pipeIndex = pipes[cellIndex];
		const searchEnd = pipes[cellIndex + 1] ?? lineText.length;
		const cellContent = lineText.substring(pipeIndex + 1, searchEnd);
		const firstNonSpaceMatch = cellContent.search(/\S/);

		return firstNonSpaceMatch !== -1
			? pipeIndex + 1 + firstNonSpaceMatch
			: pipeIndex + 1;
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
