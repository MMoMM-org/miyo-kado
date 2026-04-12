/**
 * Tests for tag normalization and matching utilities.
 */

import {describe, it, expect} from 'vitest';
import {normalizeTag, isWildcardTag, matchTag} from '../../src/core/tag-utils';

describe('normalizeTag', () => {
	it('strips leading # from tag', () => {
		expect(normalizeTag('#project')).toBe('project');
	});

	it('returns tag as-is when no # prefix', () => {
		expect(normalizeTag('project')).toBe('project');
	});

	it('handles nested tags with #', () => {
		expect(normalizeTag('#this/is/a/tag')).toBe('this/is/a/tag');
	});

	it('handles nested tags without #', () => {
		expect(normalizeTag('this/is/a/tag')).toBe('this/is/a/tag');
	});

	it('trims whitespace', () => {
		expect(normalizeTag('  #tag  ')).toBe('tag');
	});

	it('returns null for empty string', () => {
		expect(normalizeTag('')).toBeNull();
	});

	it('returns null for whitespace-only', () => {
		expect(normalizeTag('   ')).toBeNull();
	});

	it('returns null for # alone', () => {
		expect(normalizeTag('#')).toBeNull();
	});

	it('preserves wildcard suffix', () => {
		expect(normalizeTag('#project/*')).toBe('project/*');
	});
});

describe('isWildcardTag', () => {
	it('returns true for wildcard pattern', () => {
		expect(isWildcardTag('project/*')).toBe(true);
	});

	it('returns false for exact tag', () => {
		expect(isWildcardTag('project')).toBe(false);
	});

	it('returns false for tag with / but no *', () => {
		expect(isWildcardTag('project/sub')).toBe(false);
	});

	it('returns false for * in middle', () => {
		expect(isWildcardTag('project/*/sub')).toBe(false);
	});
});

describe('matchTag', () => {
	describe('exact matching', () => {
		it('matches identical tags', () => {
			expect(matchTag('project', 'project')).toBe(true);
		});

		it('does not match different tags', () => {
			expect(matchTag('other', 'project')).toBe(false);
		});

		it('matches nested tags exactly', () => {
			expect(matchTag('project/sub', 'project/sub')).toBe(true);
		});
	});

	describe('global wildcard *', () => {
		it('matches any tag', () => {
			expect(matchTag('anything', '*')).toBe(true);
		});

		it('matches nested tag', () => {
			expect(matchTag('project/sub/deep', '*')).toBe(true);
		});
	});

	describe('bare name expansion', () => {
		it('matches sub-tag', () => {
			expect(matchTag('MiYo-Tomo/proposed', 'MiYo-Tomo')).toBe(true);
		});

		it('matches deeply nested sub-tag', () => {
			expect(matchTag('MiYo-Tomo/proposed/v2', 'MiYo-Tomo')).toBe(true);
		});

		it('still matches exact', () => {
			expect(matchTag('MiYo-Tomo', 'MiYo-Tomo')).toBe(true);
		});

		it('does not match partial prefix', () => {
			expect(matchTag('MiYo-Tomos/x', 'MiYo-Tomo')).toBe(false);
		});
	});

	describe('wildcard matching', () => {
		it('matches direct child', () => {
			expect(matchTag('project/a', 'project/*')).toBe(true);
		});

		it('matches nested descendant', () => {
			expect(matchTag('project/a/b', 'project/*')).toBe(true);
		});

		it('matches deeply nested descendant', () => {
			expect(matchTag('project/a/b/c', 'project/*')).toBe(true);
		});

		it('does not match the parent itself', () => {
			expect(matchTag('project', 'project/*')).toBe(false);
		});

		it('does not match unrelated tag', () => {
			expect(matchTag('other/a', 'project/*')).toBe(false);
		});

		it('does not match partial prefix', () => {
			expect(matchTag('projects/a', 'project/*')).toBe(false);
		});
	});
});
