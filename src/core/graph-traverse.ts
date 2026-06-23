/**
 * Pure link-graph traversal. Operates over an injected adjacency interface so it
 * is independent of Obsidian's metadataCache (the adapter supplies the edges) and
 * directly unit-testable. Mirrors the relation computation in obsidian-orbital.
 *
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

/** Forward (outgoing) and reverse (backlink) edges of the resolved link graph. */
export interface GraphAdjacency {
	/** Resolved targets that `path` links to. */
	outgoing(path: string): string[];
	/** Notes that link to `path`. */
	backlinks(path: string): string[];
}

/** A 2-hop related node and the 1-hop neighbour(s) it was reached through. */
export interface RelatedNode {
	path: string;
	via: string[];
}

/** Deduplicated union of outgoing + backlinks for `path`, excluding `path` itself. */
export function neighbors(adj: GraphAdjacency, path: string): string[] {
	const set = new Set<string>([...adj.outgoing(path), ...adj.backlinks(path)]);
	set.delete(path);
	return Array.from(set);
}

/**
 * 2-hop related notes: walk each 1-hop neighbour and collect ITS neighbours as
 * candidates, excluding the source and the 1-hop set. Candidates reached through
 * several neighbours record all of them in `via`. `limit` caps the result count.
 */
export function related(adj: GraphAdjacency, path: string, limit?: number): RelatedNode[] {
	const firstHop = neighbors(adj, path);
	const firstHopSet = new Set(firstHop);
	const viaByCandidate = new Map<string, Set<string>>();

	for (const hop of firstHop) {
		for (const candidate of neighbors(adj, hop)) {
			if (candidate === path || firstHopSet.has(candidate)) continue;
			let vias = viaByCandidate.get(candidate);
			if (!vias) {
				vias = new Set<string>();
				viaByCandidate.set(candidate, vias);
			}
			vias.add(hop);
		}
	}

	const result: RelatedNode[] = Array.from(viaByCandidate.entries()).map(([p, vias]) => ({
		path: p,
		via: Array.from(vias),
	}));
	return limit === undefined ? result : result.slice(0, limit);
}
