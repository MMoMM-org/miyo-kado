/**
 * Tests for partial-slice helpers.
 *
 * Covers firstXChars, sliceByLineRange, sliceByCharRange,
 * applyAppend, and applyPrepend through their public API.
 */

import {describe, it, expect} from 'vitest';
import {
	firstXChars,
	sliceByLineRange,
	sliceByCharRange,
	applyAppend,
	applyPrepend,
} from '../../src/core/partial-slice';

// ============================================================
// firstXChars
// ============================================================

describe('firstXChars()', () => {
	it('returns truncated slice when limit is less than body length', () => {
		const {slice, truncated} = firstXChars('hello world', 5);
		expect(slice).toBe('hello');
		expect(truncated).toBe(true);
	});

	it('returns full body when limit equals body length', () => {
		const {slice, truncated} = firstXChars('hello', 5);
		expect(slice).toBe('hello');
		expect(truncated).toBe(false);
	});

	it('returns full body when limit exceeds body length', () => {
		const {slice, truncated} = firstXChars('hello', 100);
		expect(slice).toBe('hello');
		expect(truncated).toBe(false);
	});

	it('returns empty string for empty body with limit 0', () => {
		const {slice, truncated} = firstXChars('', 0);
		expect(slice).toBe('');
		expect(truncated).toBe(false);
	});

	it('does not split multibyte emoji code points', () => {
		// '👍' is 2 UTF-16 units but 1 code point
		const body = '👍👍👍';
		const {slice, truncated} = firstXChars(body, 2);
		// Should be exactly 2 code points, not 4 UTF-16 units
		expect(Array.from(slice).length).toBe(2);
		expect(slice).toBe('👍👍');
		expect(truncated).toBe(true);
	});

	it('handles multibyte emoji at limit boundary correctly', () => {
		const body = '👍👍👍';
		const {slice, truncated} = firstXChars(body, 3);
		expect(Array.from(slice).length).toBe(3);
		expect(truncated).toBe(false);
	});

	it('does not split combining characters mid-sequence', () => {
		// 'é' as base char (e) + combining acute accent (U+0301) — two code points
		const body = 'ééé';
		const {slice, truncated} = firstXChars(body, 2);
		// 2 code points = base 'e' + combining accent
		expect(Array.from(slice).length).toBe(2);
		expect(truncated).toBe(true);
	});

	it('sliced result has exactly limit code points when truncated', () => {
		const body = 'abcde';
		const {slice, truncated} = firstXChars(body, 3);
		expect(Array.from(slice).length).toBe(3);
		expect(truncated).toBe(true);
	});

	it('throws when limit is negative', () => {
		expect(() => firstXChars('hello', -1)).toThrow();
	});
});

// ============================================================
// sliceByLineRange
// ============================================================

describe('sliceByLineRange()', () => {
	const body = 'line1\nline2\nline3\nline4\nline5';

	it('returns the full body when range covers all lines', () => {
		const {slice, truncated} = sliceByLineRange(body, 1, 5);
		expect(slice).toBe(body);
		expect(truncated).toBe(false);
	});

	it('slices a middle range (inclusive 1-based)', () => {
		const {slice, truncated} = sliceByLineRange(body, 2, 4);
		expect(slice).toBe('line2\nline3\nline4');
		expect(truncated).toBe(true);
	});

	it('slices a single line', () => {
		const {slice, truncated} = sliceByLineRange(body, 3, 3);
		expect(slice).toBe('line3');
		expect(truncated).toBe(true);
	});

	it('slices from line 1 (truncated due to lines after end)', () => {
		const {slice, truncated} = sliceByLineRange(body, 1, 2);
		expect(slice).toBe('line1\nline2');
		expect(truncated).toBe(true);
	});

	it('clamps end past EOF to last line', () => {
		const {slice, truncated} = sliceByLineRange(body, 3, 999);
		expect(slice).toBe('line3\nline4\nline5');
		expect(truncated).toBe(true);
	});

	it('clamps start past EOF and returns last line', () => {
		const {slice, truncated} = sliceByLineRange(body, 999, 9999);
		expect(slice).toBe('line5');
		expect(truncated).toBe(true);
	});

	it('truncated is false only when slice equals entire body', () => {
		const {truncated} = sliceByLineRange(body, 1, 5);
		expect(truncated).toBe(false);
	});

	it('truncated is true when first line is excluded', () => {
		const {truncated} = sliceByLineRange(body, 2, 5);
		expect(truncated).toBe(true);
	});

	it('truncated is true when last line is excluded', () => {
		const {truncated} = sliceByLineRange(body, 1, 4);
		expect(truncated).toBe(true);
	});

	it('throws when start < 1', () => {
		expect(() => sliceByLineRange(body, 0, 3)).toThrow();
	});

	it('throws when start is negative', () => {
		expect(() => sliceByLineRange(body, -1, 3)).toThrow();
	});

	it('throws when start > end', () => {
		expect(() => sliceByLineRange(body, 4, 2)).toThrow();
	});

	it('throws error mentioning the invalid bounds on start<1', () => {
		expect(() => sliceByLineRange(body, 0, 5)).toThrow(/0/);
	});

	it('throws error mentioning bounds on start>end', () => {
		expect(() => sliceByLineRange(body, 5, 2)).toThrow(/5.*2|2.*5/);
	});

	it('works on a single-line body', () => {
		const {slice, truncated} = sliceByLineRange('only line', 1, 1);
		expect(slice).toBe('only line');
		expect(truncated).toBe(false);
	});
});

// ============================================================
// sliceByCharRange
// ============================================================

describe('sliceByCharRange()', () => {
	const body = 'hello world';

	it('returns the full body when range covers all code points', () => {
		const {slice, truncated} = sliceByCharRange(body, 0, body.length);
		expect(slice).toBe(body);
		expect(truncated).toBe(false);
	});

	it('slices a middle range (0-based, exclusive end)', () => {
		const {slice, truncated} = sliceByCharRange(body, 6, 11);
		expect(slice).toBe('world');
		expect(truncated).toBe(true);
	});

	it('slices from start (truncated when end < length)', () => {
		const {slice, truncated} = sliceByCharRange(body, 0, 5);
		expect(slice).toBe('hello');
		expect(truncated).toBe(true);
	});

	it('clamps end past code-point length', () => {
		const {slice, truncated} = sliceByCharRange(body, 6, 999);
		expect(slice).toBe('world');
		expect(truncated).toBe(true);
	});

	it('truncated is false when slice equals entire body', () => {
		const cps = Array.from(body).length;
		const {truncated} = sliceByCharRange(body, 0, cps);
		expect(truncated).toBe(false);
	});

	it('truncated is true when start > 0', () => {
		const {truncated} = sliceByCharRange(body, 1, body.length);
		expect(truncated).toBe(true);
	});

	it('throws when start < 0', () => {
		expect(() => sliceByCharRange(body, -1, 5)).toThrow();
	});

	it('throws when start > end', () => {
		expect(() => sliceByCharRange(body, 5, 2)).toThrow();
	});

	it('throws error mentioning bounds on start>end', () => {
		expect(() => sliceByCharRange(body, 7, 3)).toThrow(/7.*3|3.*7/);
	});

	it('throws error mentioning negative start', () => {
		expect(() => sliceByCharRange(body, -2, 5)).toThrow(/-2/);
	});

	it('is multibyte safe — counts code points not UTF-16 units', () => {
		const emoji = '👍👍👍';
		// 3 code points, 6 UTF-16 units
		const {slice, truncated} = sliceByCharRange(emoji, 1, 2);
		expect(slice).toBe('👍');
		expect(Array.from(slice).length).toBe(1);
		expect(truncated).toBe(true);
	});

	it('returns empty string for zero-length range at start', () => {
		const {slice, truncated} = sliceByCharRange(body, 0, 0);
		expect(slice).toBe('');
		expect(truncated).toBe(true);
	});
});

// ============================================================
// applyAppend
// ============================================================

describe('applyAppend()', () => {
	it('appends to a non-empty body that does not end with newline', () => {
		expect(applyAppend('existing', 'added')).toBe('existing\nadded');
	});

	it('appends to a body that already ends with newline — no extra newline', () => {
		expect(applyAppend('existing\n', 'added')).toBe('existing\nadded');
	});

	it('appends to an empty body — just returns the addition', () => {
		expect(applyAppend('', 'added')).toBe('added');
	});

	it('appends multi-line addition correctly', () => {
		expect(applyAppend('line1', 'line2\nline3')).toBe('line1\nline2\nline3');
	});

	it('appends empty string addition to non-empty body', () => {
		expect(applyAppend('body', '')).toBe('body\n');
	});
});

// ============================================================
// applyPrepend
// ============================================================

describe('applyPrepend()', () => {
	it('prepends when add does not end with newline — adds newline separator', () => {
		expect(applyPrepend('body', 'prefix')).toBe('prefix\nbody');
	});

	it('prepends when add already ends with newline — no extra newline', () => {
		expect(applyPrepend('body', 'prefix\n')).toBe('prefix\nbody');
	});

	it('prepends to empty body', () => {
		expect(applyPrepend('', 'prefix')).toBe('prefix\n');
	});

	it('prepends multi-line prefix correctly', () => {
		expect(applyPrepend('body', 'line1\nline2')).toBe('line1\nline2\nbody');
	});
});
