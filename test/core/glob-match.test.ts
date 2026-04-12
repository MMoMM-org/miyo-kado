/**
 * Tests for glob-match utilities.
 *
 * Covers matchGlob and pathMatchesPatterns through their public API.
 */

import {describe, it, expect} from 'vitest';
import {matchGlob, pathMatchesPatterns, dirCouldContainMatches, validateGlobPattern} from '../../src/core/glob-match';

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

	it('bare name matches files inside that directory', () => {
		expect(matchGlob('notes', 'notes/daily.md')).toBe(true);
	});

	it('bare name matches nested files inside that directory', () => {
		expect(matchGlob('notes', 'notes/2026/03/daily.md')).toBe(true);
	});

	it('bare name matches the directory itself', () => {
		expect(matchGlob('notes', 'notes')).toBe(true);
	});

	it('bare name does not match a different directory', () => {
		expect(matchGlob('notes', 'archive/daily.md')).toBe(false);
	});

	it('bare name does not match a similarly-prefixed directory', () => {
		expect(matchGlob('notes', 'notes-old/daily.md')).toBe(false);
	});

	it('bare name with space matches files in that directory', () => {
		expect(matchGlob('100 Inbox', '100 Inbox/new-note.md')).toBe(true);
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

// ============================================================
// dirCouldContainMatches
// ============================================================

describe('dirCouldContainMatches()', () => {
	it('returns true when dir path is the prefix of a ** pattern', () => {
		expect(dirCouldContainMatches('allowed/**', 'allowed/')).toBe(true);
	});

	it('returns true for nested dir under a ** pattern', () => {
		expect(dirCouldContainMatches('allowed/**', 'allowed/sub/')).toBe(true);
	});

	it('returns false when dir path does not match the pattern prefix', () => {
		expect(dirCouldContainMatches('allowed/**', 'forbidden/')).toBe(false);
	});

	it('returns false when dir path partially overlaps but is a different folder', () => {
		expect(dirCouldContainMatches('allow/**', 'allowed/')).toBe(false);
	});

	it('handles mid-path ** patterns', () => {
		expect(dirCouldContainMatches('vault/**/docs/**', 'vault/project/docs/')).toBe(true);
	});

	it('returns true for exact directory pattern match', () => {
		expect(dirCouldContainMatches('notes/*', 'notes/')).toBe(true);
	});

	it('returns false for a parent of the pattern root', () => {
		// "projects/" cannot contain matches for "projects/alpha/**"
		// because "projects/__probe__" does not match "projects/alpha/**"
		expect(dirCouldContainMatches('projects/alpha/**', 'projects/')).toBe(false);
	});

	it('returns false for a sibling directory of the pattern', () => {
		expect(dirCouldContainMatches('notes/**', 'archive/')).toBe(false);
	});
});

// ============================================================
// validateGlobPattern — reject overly complex / unsafe patterns
// ============================================================

describe('validateGlobPattern() — accepts safe patterns', () => {
	it('accepts a literal path', () => {
		const result = validateGlobPattern('notes/daily.md');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.warnings).toEqual([]);
	});

	it('accepts a single-star pattern', () => {
		const result = validateGlobPattern('notes/*.md');
		expect(result.ok).toBe(true);
	});

	it('accepts a single ** segment', () => {
		const result = validateGlobPattern('notes/**/daily.md');
		expect(result.ok).toBe(true);
	});

	it('accepts two consecutive ** segments', () => {
		const result = validateGlobPattern('a/**/**/b');
		expect(result.ok).toBe(true);
	});

	it('accepts three consecutive ** segments (at the boundary)', () => {
		const result = validateGlobPattern('a/**/**/**/b');
		expect(result.ok).toBe(true);
	});

	it('accepts a 256-character pattern exactly at the boundary', () => {
		const pattern = 'a'.repeat(256);
		const result = validateGlobPattern(pattern);
		expect(result.ok).toBe(true);
	});

	it('accepts an empty pattern', () => {
		const result = validateGlobPattern('');
		expect(result.ok).toBe(true);
	});
});

describe('validateGlobPattern() — rejects unsafe patterns', () => {
	it('rejects patterns longer than 256 characters', () => {
		const pattern = 'a'.repeat(257);
		const result = validateGlobPattern(pattern);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/256/);
	});

	it('rejects four consecutive ** segments', () => {
		const result = validateGlobPattern('a/**/**/**/**/b');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/\*\*/);
	});

	it('rejects many consecutive ** segments', () => {
		const result = validateGlobPattern('a/**/**/**/**/**/**/**');
		expect(result.ok).toBe(false);
	});
});

describe('validateGlobPattern() — validates ** pattern', () => {
	it('accepts bare ** (full vault access) with no warnings', () => {
		const result = validateGlobPattern('**');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.warnings).toEqual([]);
		}
	});

	it('does not warn on **/something (scoped)', () => {
		const result = validateGlobPattern('**/daily.md');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.warnings).toEqual([]);
	});
});
