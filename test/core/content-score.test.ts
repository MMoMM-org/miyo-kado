/**
 * Tests for content-score — proximity-based scoring and snippet extraction
 * used by kado-search byContent. Pure module, no Obsidian.
 *
 * Covers: term tokenization, match detection, proximity ranking, snippet
 * extraction with line numbers, case-insensitivity, and empty/no-match edges.
 */

import {describe, it, expect} from 'vitest';
import {scoreContent} from '../../src/core/content-score';

describe('scoreContent()', () => {
	it('returns score 0 and no snippets when no query term occurs', () => {
		const {score, snippets} = scoreContent('the quick brown fox', 'elephant');
		expect(score).toBe(0);
		expect(snippets).toEqual([]);
	});

	it('returns score 0 for an empty query', () => {
		const {score, snippets} = scoreContent('any content here', '   ');
		expect(score).toBe(0);
		expect(snippets).toEqual([]);
	});

	it('matches a single term and returns a positive score with one snippet', () => {
		const {score, snippets} = scoreContent('a note about migration strategy', 'migration');
		expect(score).toBeGreaterThan(0);
		expect(snippets).toHaveLength(1);
		expect(snippets[0]!.text).toContain('migration');
	});

	it('matches case-insensitively but preserves original case in the snippet', () => {
		const {score, snippets} = scoreContent('The Migration Plan is ready', 'migration');
		expect(score).toBeGreaterThan(0);
		expect(snippets[0]!.text).toContain('Migration');
	});

	it('ranks terms appearing close together higher than far apart', () => {
		const near = scoreContent('alpha beta are adjacent words', 'alpha beta');
		const farBody = 'alpha ' + 'x '.repeat(200) + 'beta';
		const far = scoreContent(farBody, 'alpha beta');
		expect(near.score).toBeGreaterThan(far.score);
	});

	it('rewards covering more query terms', () => {
		const both = scoreContent('alpha and beta together', 'alpha beta');
		const one = scoreContent('alpha and gamma together', 'alpha beta');
		expect(both.score).toBeGreaterThan(one.score);
	});

	it('reports a 1-based line number for the snippet', () => {
		const body = 'line one\nline two\nthe target word is here\nline four';
		const {snippets} = scoreContent(body, 'target');
		expect(snippets[0]!.line).toBe(3);
	});

	it('caps the number of snippets returned', () => {
		const body = Array.from({length: 20}, (_, i) => `paragraph ${i} mentions target word`).join('\n\n');
		const {snippets} = scoreContent(body, 'target');
		expect(snippets.length).toBeGreaterThan(0);
		expect(snippets.length).toBeLessThanOrEqual(5);
	});

	it('keeps snippet text within a bounded length', () => {
		const body = 'x'.repeat(50) + ' target ' + 'y'.repeat(5000);
		const {snippets} = scoreContent(body, 'target');
		expect(snippets[0]!.text.length).toBeLessThanOrEqual(300);
	});
});
