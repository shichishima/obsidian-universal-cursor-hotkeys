// Manual verification: how does UCH's own Intl.Segmenter-based word-boundary
// engine (word-segmentation.ts) do on well-known, structurally-tricky
// Japanese sentences? Companion to cjk_seg_verify.test.ts (Chinese). Not run
// as part of the regular suite — invoke directly:
//   npx vitest run tests/manual/ja_seg_verify.test.ts
//
// Ground truth: widely-cited example sentences from Japanese NLP
// tutorials/MeCab demos — not a subjective judgment call.

import { describe, it } from 'vitest';

const RealSegmenter = Intl.Segmenter;
// @ts-expect-error — intentional test-only monkey-patch.
Intl.Segmenter = class extends RealSegmenter {
	constructor(_locales?: Intl.LocalesArgument, options?: Intl.SegmenterOptions) {
		super('ja-JP', options);
	}
};

const { getWordSpans } = await import('../../word-segmentation');

function segmentToText(lineText: string): string[] {
	return getWordSpans(lineText).map(s => lineText.slice(s.from, s.to));
}

// [input, a widely-cited/MeCab-standard expected segmentation]
const CASES: Array<[string, string[]]> = [
	// Trivial baseline.
	['私は学生です', ['私', 'は', '学生', 'です']],
	// Classic segmentation-ambiguity benchmark (like 南京市長江大橋 for
	// Chinese): naively could misread as 東京/都庁 vs the correct
	// 東京都/庁 is NOT actually the trap here — the real trap is the
	// reverse: 東京都庁 should stay whole as a proper noun (Tokyo
	// Metropolitan Government Office), not split into 東京/都/庁.
	['東京都庁でランチを食べた', ['東京都庁', 'で', 'ランチ', 'を', '食べ', 'た']],
	// Famous hard case (idiom, same word "もも" repeated with different
	// meanings) often used to stress-test Japanese tokenizers.
	['すもももももももものうち', ['すもも', 'も', 'もも', 'も', 'もも', 'の', 'うち']],
	// A Latin term embedded in Japanese prose — the exact bug class UCH's
	// double-click select fix (cjk-word-select.ts) already targets;
	// checking the plain word-motion engine (not just double-click) too.
	['私はAPIを開発しています', ['私', 'は', 'API', 'を', '開発', 'し', 'て', 'い', 'ます']],
];

describe.skip('Japanese segmentation manual verification (run directly, not part of CI)', () => {
	it('prints actual vs. reference segmentation for each case', () => {
		for (const [input, expected] of CASES) {
			const actual = segmentToText(input);
			const match = JSON.stringify(actual) === JSON.stringify(expected);
			console.log(`${match ? 'MATCH' : 'DIFF '} ${input}`);
			console.log(`  expected: ${expected.join(' | ')}`);
			console.log(`  actual:   ${actual.join(' | ')}`);
		}
	});
});
