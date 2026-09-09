// Manual verification: does UCH's own Intl.Segmenter-based word-boundary
// engine (word-segmentation.ts) produce reasonable Simplified Chinese
// segmentation? Not run as part of the regular suite — invoke directly:
//   npx vitest run tests/manual/cjk_seg_verify.test.ts
//
// Context: word-segmentation.ts calls `new Intl.Segmenter(undefined, ...)`
// (runtime-default locale), while the competing plugin cm-chs-patch's own
// "system engine" fallback calls `new Intl.Segmenter("zh-CN", ...)`
// explicitly. For a real Chinese-locale end user, `undefined` resolves to
// something zh-CN-equivalent, so their real experience should match
// cm-chs-patch's — but a non-Chinese-locale *developer* testing this file
// unmodified would silently exercise the wrong dictionary. To test the
// thing that actually matters (segmentation quality a Chinese-locale user
// would see), Intl.Segmenter is monkey-patched below to force "zh-CN"
// before word-segmentation.ts's module-level segmenter is constructed —
// this exercises the real, unmodified getWordSpans() implementation, not a
// reimplementation, just with the locale a real target user would have.
//
// Ground truth: the sentences below are jieba's own canonical README demo
// examples (https://github.com/fxsjy/jieba) — the standard, widely-cited
// reference corpus for Chinese word segmentation, not a subjective judgment
// call. Expected splits are jieba's own published output, so this can be
// checked without native Chinese fluency: just diff actual vs. expected.

import { describe, it } from 'vitest';

const RealSegmenter = Intl.Segmenter;
// @ts-expect-error — intentional test-only monkey-patch, see comment above.
Intl.Segmenter = class extends RealSegmenter {
	constructor(_locales?: Intl.LocalesArgument, options?: Intl.SegmenterOptions) {
		super('zh-CN', options);
	}
};

// Must import after the patch above, so the module's own cached segmenter
// (constructed lazily on first use, but let's not race on caching order)
// picks up the forced locale.
const { getWordSpans } = await import('../../word-segmentation');

function segmentToText(lineText: string): string[] {
	return getWordSpans(lineText).map(s => lineText.slice(s.from, s.to));
}

// [input, jieba's own published expected segmentation]
const CASES: Array<[string, string[]]> = [
	// jieba README's own basic demo.
	['我来到北京清华大学', ['我', '来到', '北京', '清华大学']],
	// jieba README's own "new word discovery" demo (HMM on).
	['他来到了网易杭研大厦', ['他', '来到', '了', '网易', '杭研', '大厦']],
	// Classic segmentation-ambiguity benchmark, widely cited in Chinese NLP
	// tutorials/papers: naive char-pair splitting would wrongly read this as
	// "Nanjing / mayor / Jiang-da bridge" (南京/市长/江大桥) instead of the
	// correct "Nanjing City / Yangtze River Bridge".
	['南京市长江大桥', ['南京市', '长江大桥']],
	// A Latin term embedded in Chinese prose — mirrors the already-fixed
	// Japanese case (e.g. "API" inside a Japanese sentence); checks the same
	// class of bug isn't reintroduced for Chinese.
	['我在使用API进行开发', ['我', '在', '使用', 'API', '进行', '开发']],
];

describe('CJK segmentation manual verification (run directly, not part of CI)', () => {
	it('prints actual vs. jieba-reference segmentation for each case', () => {
		for (const [input, expected] of CASES) {
			const actual = segmentToText(input);
			const match = JSON.stringify(actual) === JSON.stringify(expected);
			console.log(`${match ? 'MATCH' : 'DIFF '} ${input}`);
			console.log(`  expected: ${expected.join(' | ')}`);
			console.log(`  actual:   ${actual.join(' | ')}`);
		}
	});
});
