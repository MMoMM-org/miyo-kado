/**
 * Tests for glob-match utilities.
 *
 * Covers matchGlob and pathMatchesPatterns through their public API.
 */

import {describe, it, expect} from 'vitest';
import {matchGlob, pathMatchesPatterns} from '../../src/core/glob-match';

// ============================================================
// matchGlob — literal matching
// ============================================================

describe('matchGlob() — literal match', () => {
	it('matches an exact path', () => {
		expect(matchGlob('notes/daily.md', 'notes/daily.md')).toBe(true);
	});

	it('does not match a different path', () => {
		expect(matchGlob('notes/daily.md', 'notes/weekly.md')).toBe(false);
	});

	it('does not match a partial path (no anchoring drift)', () => {
		expect(matchGlob('notes', 'notes/daily.md')).toBe(false);
	});
});

// ============================================================
// matchGlob — * single segment
// ============================================================

describe('matchGlob() — * single segment wildcard', () => {
	it('matches any filename within a directory', () => {
		expect(matchGlob('notes/*.md', 'notes/daily.md')).toBe(true);
	});

	it('does not cross a slash', () => {
		expect(matchGlob('notes/*.md', 'notes/sub/daily.md')).toBe(false);
	});

	it('matches an empty segment', () => {
		expect(matchGlob('notes/*', 'notes/')).toBe(true);
	});
});

// ============================================================
// matchGlob — ** multi-segment
// ============================================================

describe('matchGlob() — ** multi-segment wildcard', () => {
	it('matches zero path segments', () => {
		expect(matchGlob('notes/**', 'notes/')).toBe(true);
	});

	it('matches one segment deep', () => {
		expect(matchGlob('notes/**', 'notes/daily.md')).toBe(true);
	});

	it('matches multiple segments deep', () => {
		expect(matchGlob('notes/**', 'notes/2024/01/daily.md')).toBe(true);
	});

	it('matches nested dirs and files with mid-path **', () => {
		expect(matchGlob('vault/**/index.md', 'vault/projects/alpha/index.md')).toBe(true);
	});

	it('does not match a different root', () => {
		expect(matchGlob('notes/**', 'archive/old.md')).toBe(false);
	});
});

// ============================================================
// matchGlob — special regex characters in pattern
// ============================================================

describe('matchGlob() — special characters are escaped', () => {
	it('treats . as a literal dot, not a wildcard', () => {
		expect(matchGlob('notes/daily.md', 'notes/dailyXmd')).toBe(false);
	});

	it('treats + as a literal plus', () => {
		expect(matchGlob('tags/c++', 'tags/c++')).toBe(true);
		expect(matchGlob('tags/c++', 'tags/c')).toBe(false);
	});
});

// ============================================================
// matchGlob — empty pattern
// ============================================================

describe('matchGlob() — empty pattern', () => {
	it('matches only an empty string', () => {
		expect(matchGlob('', '')).toBe(true);
	});

	it('does not match a non-empty path', () => {
		expect(matchGlob('', 'notes/daily.md')).toBe(false);
	});
});

// ============================================================
// pathMatchesPatterns
// ============================================================

describe('pathMatchesPatterns()', () => {
	it('returns true when path matches at least one pattern', () => {
		expect(pathMatchesPatterns('notes/daily.md', ['archive/**', 'notes/*.md'])).toBe(true);
	});

	it('returns false when path matches no pattern', () => {
		expect(pathMatchesPatterns('drafts/idea.md', ['archive/**', 'notes/*.md'])).toBe(false);
	});

	it('returns false for an empty patterns array', () => {
		expect(pathMatchesPatterns('notes/daily.md', [])).toBe(false);
	});

	it('returns true when the first pattern matches (short-circuits)', () => {
		expect(pathMatchesPatterns('notes/daily.md', ['notes/**', 'notes/*.md'])).toBe(true);
	});
});
