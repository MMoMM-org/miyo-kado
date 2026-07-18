/**
 * Tests for GraphAdapter — maps a CoreGraphRequest to a CoreGraphResult using
 * the LinkGraphIndex + pure traversal. Scope filtering and permissions live in
 * the tool layer, so the adapter returns the raw graph view.
 */

import {describe, it, expect} from 'vitest';
import {createGraphAdapter} from '../../src/obsidian/graph-adapter';
import {LinkGraphIndex} from '../../src/obsidian/link-graph-index';
import type {CoreGraphRequest, CoreGraphResult, CoreGraphAuditRequest, CoreGraphAuditResult} from '../../src/types/canonical';

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
	const result = await createGraphAdapter(idx, () => []).graph(request);
	if ('code' in result) throw new Error(`unexpected error: ${result.code}`);
	return result;
}

async function runAudit(
	idx: LinkGraphIndex,
	notePaths: readonly string[],
	overrides: Partial<CoreGraphAuditRequest> = {},
): Promise<CoreGraphAuditResult> {
	const request: CoreGraphAuditRequest = {kind: 'graph-audit', apiKeyId: 'k', ...overrides};
	const result = await createGraphAdapter(idx, () => notePaths).audit(request);
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

describe('GraphAdapter — audit (vault-wide)', () => {
	it('reports orphans: notes with no resolved links in or out, sorted', async () => {
		// a → b resolves; c and d are disconnected. e only has a dangling link (still orphan).
		const idx = makeIndex({'a.md': {'b.md': 1}}, {'e.md': {'Ghost': 1}});
		const result = await runAudit(idx, ['a.md', 'b.md', 'c.md', 'd.md', 'e.md']);
		expect(result.orphans).toEqual([{path: 'c.md'}, {path: 'd.md'}, {path: 'e.md'}]);
	});

	it('reports every dead wikilink vault-wide with source, target and count, sorted', async () => {
		const idx = makeIndex({}, {'b.md': {'Missing': 2}, 'a.md': {'Ghost': 1, 'Absent': 3}});
		const result = await runAudit(idx, ['a.md', 'b.md']);
		expect(result.deadLinks).toEqual([
			{source: 'a.md', target: 'Absent', count: 3},
			{source: 'a.md', target: 'Ghost', count: 1},
			{source: 'b.md', target: 'Missing', count: 2},
		]);
	});

	it('a note linked only by an incoming resolved link is not an orphan', async () => {
		const idx = makeIndex({'a.md': {'b.md': 1}});
		const result = await runAudit(idx, ['a.md', 'b.md']);
		expect(result.orphans).toEqual([]); // both a (outgoing) and b (incoming) are connected
	});

	it('include=["orphans"] computes only orphans, leaving deadLinks empty', async () => {
		const idx = makeIndex({'a.md': {'b.md': 1}}, {'a.md': {'Missing': 1}});
		const result = await runAudit(idx, ['a.md', 'b.md', 'z.md'], {include: ['orphans']});
		expect(result.orphans).toEqual([{path: 'z.md'}]);
		expect(result.deadLinks).toEqual([]);
	});

	it('include=["deadLinks"] computes only dead links, leaving orphans empty', async () => {
		const idx = makeIndex({}, {'a.md': {'Missing': 1}});
		const result = await runAudit(idx, ['a.md', 'z.md'], {include: ['deadLinks']});
		expect(result.orphans).toEqual([]);
		expect(result.deadLinks).toEqual([{source: 'a.md', target: 'Missing', count: 1}]);
	});

	it('returns empty arrays for an empty vault', async () => {
		const idx = makeIndex({});
		const result = await runAudit(idx, []);
		expect(result).toEqual({orphans: [], deadLinks: []});
	});
});
