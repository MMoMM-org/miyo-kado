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
import type {CoreGraphRequest, CoreGraphResult, CoreGraphNode} from '../types/canonical';
import {neighbors, related} from '../core/graph-traverse';
import type {LinkGraphIndex} from './link-graph-index';

function applyLimit<T>(nodes: T[], limit: number | undefined): T[] {
	return limit === undefined ? nodes : nodes.slice(0, limit);
}

/**
 * Creates a GraphAdapter backed by a LinkGraphIndex. The index is maintained by
 * the plugin lifecycle (rebuilt on the metadataCache 'resolved' event); the
 * adapter only reads its current state.
 */
export function createGraphAdapter(index: LinkGraphIndex): GraphAdapter {
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
	};
}
