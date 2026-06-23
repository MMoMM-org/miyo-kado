/**
 * Tests for LinkGraphIndex — a bidirectional link index built from Obsidian's
 * metadataCache.resolvedLinks / unresolvedLinks. Fed a plain cache-shaped object
 * (no full Obsidian needed); exercises forward/reverse adjacency and dangling.
 */

import {describe, it, expect} from 'vitest';
import {LinkGraphIndex} from '../../src/obsidian/link-graph-index';

function makeCache(
	resolvedLinks: Record<string, Record<string, number>>,
	unresolvedLinks: Record<string, Record<string, number>> = {},
) {
	return {resolvedLinks, unresolvedLinks};
}

describe('LinkGraphIndex', () => {
	it('exposes outgoing links of a source', () => {
		const idx = new LinkGraphIndex(makeCache({'a.md': {'b.md': 1, 'c.md': 2}}));
		idx.buildFull();
		expect(idx.outgoing('a.md').sort()).toEqual(['b.md', 'c.md']);
	});

	it('exposes backlinks (inverse edges)', () => {
		const idx = new LinkGraphIndex(makeCache({'a.md': {'c.md': 1}, 'b.md': {'c.md': 1}}));
		idx.buildFull();
		expect(idx.backlinks('c.md').sort()).toEqual(['a.md', 'b.md']);
	});

	it('returns empty arrays for an unknown node', () => {
		const idx = new LinkGraphIndex(makeCache({}));
		idx.buildFull();
		expect(idx.outgoing('x.md')).toEqual([]);
		expect(idx.backlinks('x.md')).toEqual([]);
	});

	it('lists unresolved (dangling) targets of a source with counts', () => {
		const idx = new LinkGraphIndex(makeCache({}, {'a.md': {'Missing Note': 2, 'Other': 1}}));
		idx.buildFull();
		const dangling = idx.danglingFor('a.md');
		expect(dangling).toContainEqual({target: 'Missing Note', count: 2});
		expect(dangling).toContainEqual({target: 'Other', count: 1});
	});

	it('rebuilds from the current cache on buildFull', () => {
		const cache = makeCache({'a.md': {'b.md': 1}});
		const idx = new LinkGraphIndex(cache);
		idx.buildFull();
		expect(idx.outgoing('a.md')).toEqual(['b.md']);

		// Mutate the underlying cache and rebuild — stale edges must be dropped.
		cache.resolvedLinks = {'a.md': {'c.md': 1}};
		idx.buildFull();
		expect(idx.outgoing('a.md')).toEqual(['c.md']);
		expect(idx.backlinks('b.md')).toEqual([]);
	});
});
