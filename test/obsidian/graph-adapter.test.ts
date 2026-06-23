/**
 * Tests for GraphAdapter — maps a CoreGraphRequest to a CoreGraphResult using
 * the LinkGraphIndex + pure traversal. Scope filtering and permissions live in
 * the tool layer, so the adapter returns the raw graph view.
 */

import {describe, it, expect} from 'vitest';
import {createGraphAdapter} from '../../src/obsidian/graph-adapter';
import {LinkGraphIndex} from '../../src/obsidian/link-graph-index';
import type {CoreGraphRequest, CoreGraphResult} from '../../src/types/canonical';

function makeIndex(
	resolvedLinks: Record<string, Record<string, number>>,
	unresolvedLinks: Record<string, Record<string, number>> = {},
): LinkGraphIndex {
	const idx = new LinkGraphIndex({resolvedLinks, unresolvedLinks});
	idx.buildFull();
	return idx;
}

function req(overrides: Partial<CoreGraphRequest>): CoreGraphRequest {
	return {kind: 'graph', apiKeyId: 'k', operation: 'backlinks', path: 'a.md', ...overrides};
}

async function run(idx: LinkGraphIndex, request: CoreGraphRequest): Promise<CoreGraphResult> {
	const result = await createGraphAdapter(idx).graph(request);
	if ('code' in result) throw new Error(`unexpected error: ${result.code}`);
	return result;
}

describe('GraphAdapter', () => {
	it('returns backlinks as nodes with relation=backlink', async () => {
		const idx = makeIndex({'b.md': {'a.md': 1}, 'c.md': {'a.md': 1}});
		const result = await run(idx, req({operation: 'backlinks', path: 'a.md'}));
		expect(result.nodes.map((n) => n.path).sort()).toEqual(['b.md', 'c.md']);
		expect(result.nodes.every((n) => n.relation === 'backlink')).toBe(true);
	});

	it('returns outgoing links with relation=outgoing', async () => {
		const idx = makeIndex({'a.md': {'b.md': 1}});
		const result = await run(idx, req({operation: 'outgoing', path: 'a.md'}));
		expect(result.nodes).toEqual([{path: 'b.md', relation: 'outgoing'}]);
	});

	it('returns the 1-hop neighbour union for neighbors', async () => {
		const idx = makeIndex({'a.md': {'b.md': 1}, 'c.md': {'a.md': 1}});
		const result = await run(idx, req({operation: 'neighbors', path: 'a.md'}));
		expect(result.nodes.map((n) => n.path).sort()).toEqual(['b.md', 'c.md']);
	});

	it('returns 2-hop related nodes with via', async () => {
		const idx = makeIndex({'a.md': {'b.md': 1}, 'b.md': {'c.md': 1}});
		const result = await run(idx, req({operation: 'related', path: 'a.md'}));
		const c = result.nodes.find((n) => n.path === 'c.md');
		expect(c).toMatchObject({relation: 'related', via: ['b.md']});
	});

	it('returns dangling targets with counts', async () => {
		const idx = makeIndex({}, {'a.md': {'Missing': 3}});
		const result = await run(idx, req({operation: 'dangling', path: 'a.md'}));
		expect(result.nodes).toContainEqual({path: 'Missing', relation: 'dangling', count: 3});
	});

	it('applies the limit', async () => {
		const idx = makeIndex({'b.md': {'a.md': 1}, 'c.md': {'a.md': 1}, 'd.md': {'a.md': 1}});
		const result = await run(idx, req({operation: 'backlinks', path: 'a.md', limit: 2}));
		expect(result.nodes).toHaveLength(2);
	});
});
