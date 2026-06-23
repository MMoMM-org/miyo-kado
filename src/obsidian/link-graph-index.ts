/**
 * LinkGraphIndex — bidirectional link index over Obsidian's resolved/unresolved
 * link maps, providing the GraphAdjacency the pure traversal needs plus dangling
 * (broken) link lookup. Ported from obsidian-orbital's LinkGraphIndex.
 *
 * It holds a reference to the metadataCache-shaped source and (re)derives its
 * indexes on buildFull(). The plugin rebuilds on the metadataCache 'resolved'
 * event, which fires after link resolution settles — correct without per-file
 * incremental bookkeeping. Reads Obsidian's in-memory link maps, so it shares
 * the same index-lag characteristic as kado-search (see search index-lag note).
 */

import type {GraphAdjacency} from '../core/graph-traverse';

/** The slice of Obsidian's metadataCache this index consumes. */
export interface LinkCacheSource {
	/** source path → { resolved target path → occurrence count }. */
	resolvedLinks: Record<string, Record<string, number>>;
	/** source path → { unresolved target text → occurrence count }. */
	unresolvedLinks: Record<string, Record<string, number>>;
}

/** A single unresolved (broken) link target and how often the source references it. */
export interface DanglingTarget {
	target: string;
	count: number;
}

export class LinkGraphIndex implements GraphAdjacency {
	private readonly forward = new Map<string, Set<string>>();
	private readonly reverse = new Map<string, Set<string>>();
	private readonly unresolved = new Map<string, Map<string, number>>();

	constructor(private readonly cache: LinkCacheSource) {}

	/** (Re)builds all indexes from the current cache, discarding any prior state. */
	buildFull(): void {
		this.forward.clear();
		this.reverse.clear();
		this.unresolved.clear();

		for (const [source, dests] of Object.entries(this.cache.resolvedLinks)) {
			const targets = Object.keys(dests);
			if (targets.length === 0) continue;
			this.forward.set(source, new Set(targets));
			for (const target of targets) {
				let incoming = this.reverse.get(target);
				if (!incoming) {
					incoming = new Set<string>();
					this.reverse.set(target, incoming);
				}
				incoming.add(source);
			}
		}

		for (const [source, targets] of Object.entries(this.cache.unresolvedLinks)) {
			const counts = new Map<string, number>();
			for (const [target, count] of Object.entries(targets)) counts.set(target, count);
			if (counts.size > 0) this.unresolved.set(source, counts);
		}
	}

	/** Resolved targets `path` links to. */
	outgoing(path: string): string[] {
		const set = this.forward.get(path);
		return set ? Array.from(set) : [];
	}

	/** Notes that link to `path`. */
	backlinks(path: string): string[] {
		const set = this.reverse.get(path);
		return set ? Array.from(set) : [];
	}

	/** Unresolved (broken) link targets of `path`, with reference counts. */
	danglingFor(path: string): DanglingTarget[] {
		const counts = this.unresolved.get(path);
		if (!counts) return [];
		return Array.from(counts.entries()).map(([target, count]) => ({target, count}));
	}
}
