/**
 * Tests for graph-traverse — pure link-graph traversal over an injected
 * adjacency interface. No Obsidian.
 *
 * Covers: 1-hop neighbour union (dedupe + self-exclusion) and 2-hop related
 * discovery (exclude source and 1-hop nodes, track "via", respect limit).
 */

import {describe, it, expect} from 'vitest';
import {neighbors, related} from '../../src/core/graph-traverse';
import type {GraphAdjacency} from '../../src/core/graph-traverse';

/** Builds an adjacency from explicit forward edges; backlinks are the inverse. */
function makeAdjacency(forward: Record<string, string[]>): GraphAdjacency {
	return {
		outgoing: (p) => forward[p] ?? [],
		backlinks: (p) => Object.keys(forward).filter((src) => (forward[src] ?? []).includes(p)),
	};
}

describe('neighbors()', () => {
	it('returns the deduplicated union of outgoing and backlinks, excluding self', () => {
		// a → b, a → c, d → a   ⇒ neighbours(a) = {b, c, d}
		const adj = makeAdjacency({a: ['b', 'c'], d: ['a']});
		expect(neighbors(adj, 'a').sort()).toEqual(['b', 'c', 'd']);
	});

	it('excludes a self-link', () => {
		const adj = makeAdjacency({a: ['a', 'b']});
		expect(neighbors(adj, 'a')).toEqual(['b']);
	});

	it('returns empty for an isolated node', () => {
		const adj = makeAdjacency({});
		expect(neighbors(adj, 'lonely')).toEqual([]);
	});
});

describe('related()', () => {
	it('finds 2-hop nodes and records the via neighbour', () => {
		// a → b → c   ⇒ related(a) includes c via b
		const adj = makeAdjacency({a: ['b'], b: ['c']});
		const result = related(adj, 'a');
		const c = result.find((r) => r.path === 'c');
		expect(c).toBeDefined();
		expect(c!.via).toEqual(['b']);
	});

	it('excludes the source and its direct 1-hop neighbours', () => {
		const adj = makeAdjacency({a: ['b'], b: ['a', 'c']});
		const paths = related(adj, 'a').map((r) => r.path);
		expect(paths).not.toContain('a'); // source
		expect(paths).not.toContain('b'); // 1-hop
		expect(paths).toContain('c'); // 2-hop
	});

	it('merges multiple via paths to the same node', () => {
		// a → b, a → c, b → d, c → d  ⇒ d reachable via b and c
		const adj = makeAdjacency({a: ['b', 'c'], b: ['d'], c: ['d']});
		const d = related(adj, 'a').find((r) => r.path === 'd');
		expect(d!.via.sort()).toEqual(['b', 'c']);
	});

	it('respects the limit', () => {
		const adj = makeAdjacency({a: ['b'], b: ['c', 'd', 'e', 'f']});
		expect(related(adj, 'a', 2)).toHaveLength(2);
	});
});
