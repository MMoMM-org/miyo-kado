/**
 * GraphAdapter — turns a CoreGraphRequest into a CoreGraphResult using the
 * LinkGraphIndex (adjacency + dangling) and the pure traversal helpers.
 *
 * Deliberately permission-agnostic: the kado-graph tool layer enforces note.read
 * on the source and scope-filters resolved result nodes (graph resolves links to
 * paths, so without that filter it could disclose paths outside the key's scope).
 * The adapter just produces the raw graph view.
 */

import type {GraphAdapter} from '../core/operation-router';
import type {
	CoreGraphRequest,
	CoreGraphResult,
	CoreGraphNode,
	CoreGraphAuditRequest,
	CoreGraphAuditResult,
	CoreGraphAuditDeadLink,
	CoreGraphAuditOrphan,
} from '../types/canonical';
import {neighbors, related} from '../core/graph-traverse';
import type {LinkGraphIndex} from './link-graph-index';

function applyLimit<T>(nodes: T[], limit: number | undefined): T[] {
	return limit === undefined ? nodes : nodes.slice(0, limit);
}

/** Stable ordering for dead links: by source path, then by target text. */
function compareDeadLinks(a: CoreGraphAuditDeadLink, b: CoreGraphAuditDeadLink): number {
	if (a.source !== b.source) return a.source < b.source ? -1 : 1;
	if (a.target !== b.target) return a.target < b.target ? -1 : 1;
	return 0;
}

/**
 * Creates a GraphAdapter backed by a LinkGraphIndex. The index is maintained by
 * the plugin lifecycle (rebuilt on the metadataCache 'resolved' event); the
 * adapter only reads its current state.
 *
 * `listNotePaths` returns every markdown note path in the vault — needed for the
 * vault-wide audit, since an orphan (no resolved links in or out) appears in
 * neither the forward nor reverse index and can only be found by subtraction.
 */
export function createGraphAdapter(index: LinkGraphIndex, listNotePaths: () => readonly string[]): GraphAdapter {
	return {
		async graph(request: CoreGraphRequest): Promise<CoreGraphResult> {
			const {operation, path, limit} = request;
			let nodes: CoreGraphNode[];

			switch (operation) {
				case 'backlinks':
					nodes = index.backlinks(path).map((p) => ({path: p, relation: 'backlink'}));
					break;
				case 'outgoing':
					nodes = index.outgoing(path).map((p) => ({path: p, relation: 'outgoing'}));
					break;
				case 'neighbors':
					nodes = neighbors(index, path).map((p) => ({path: p, relation: 'neighbor'}));
					break;
				case 'related':
					nodes = related(index, path, limit).map((r) => ({path: r.path, relation: 'related', via: r.via}));
					break;
				case 'dangling':
					nodes = index.danglingFor(path).map((d) => ({path: d.target, relation: 'dangling', count: d.count}));
					break;
			}

			return {source: path, operation, nodes: applyLimit(nodes, limit)};
		},

		async audit(request: CoreGraphAuditRequest): Promise<CoreGraphAuditResult> {
			const include = request.include ?? ['orphans', 'deadLinks'];
			const wantOrphans = include.includes('orphans');
			const wantDead = include.includes('deadLinks');

			let orphans: CoreGraphAuditOrphan[] = [];
			if (wantOrphans) {
				const linked = index.linkedPaths();
				orphans = listNotePaths()
					.filter((p) => !linked.has(p))
					.sort()
					.map((path) => ({path}));
			}

			let deadLinks: CoreGraphAuditDeadLink[] = [];
			if (wantDead) {
				deadLinks = index.allDangling().sort(compareDeadLinks);
			}

			return {orphans, deadLinks};
		},
	};
}
