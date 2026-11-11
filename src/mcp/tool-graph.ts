/**
 * kado-graph and kado-graph-audit handlers: link-graph navigation from a
 * source note and the vault-wide orphan/dead-link audit, both with per-node
 * disclosure filtering. Split out of tools.ts (#135).
 */

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {CoreGraphResult, CoreGraphAuditResult} from '../types/canonical';
import {evaluateGraphPermissions} from '../core/graph-policy';
import {authenticateGate} from '../core/gates/authenticate';
import {kadoLog} from '../core/logger';
import {mapGraphResult, mapGraphAuditResult, mapError} from './response-mapper';
import type {GraphAuditPage} from './response-mapper';
import {deriveHints} from './hints';
import {mapGraphRequest, mapGraphAuditRequest} from './request-mapper';
import {createReadablePredicate, evaluateNoteTagAccess} from './tag-policy';
import type {Extra, ToolDependencies} from './tool-deps';
import {kadoGraphShape, kadoGraphAuditShape, KADO_GRAPH_TOOL_DESCRIPTION, KADO_GRAPH_AUDIT_TOOL_DESCRIPTION} from './tool-shapes';
import {isCoreError, extractKeyId, missingAuthError} from './tool-support';
import {debugFields, logAllowed, logDenied} from './tool-logging';

/** Base64-encodes a combined-stream offset for the audit pagination cursor. */
function encodeAuditOffset(offset: number): string {
	return btoa(String(offset));
}

/** Decodes an audit cursor to a combined-stream offset; malformed cursors read as 0. */
function decodeAuditOffset(cursor: string): number {
	const parsed = parseInt(atob(cursor), 10);
	return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

/**
 * Paginates the post-ACL audit result over a single deterministic stream — all
 * orphans first, then all dead links. `limit` caps combined items per page;
 * omit for everything in one page. Returns the page plus full (pre-pagination)
 * totals and the next cursor.
 */
function paginateAudit(
	orphans: CoreGraphAuditResult['orphans'],
	deadLinks: CoreGraphAuditResult['deadLinks'],
	cursor: string | undefined,
	limit: number | undefined,
): GraphAuditPage {
	const total = {orphans: orphans.length, deadLinks: deadLinks.length};
	const combined = orphans.length + deadLinks.length;
	const offset = cursor ? Math.min(decodeAuditOffset(cursor), combined) : 0;
	const end = limit === undefined ? combined : Math.min(offset + limit, combined);

	// Map the [offset, end) window in the concatenated [orphans..., deadLinks...]
	// stream back onto each array.
	const pageOrphans = orphans.slice(Math.min(offset, orphans.length), Math.min(end, orphans.length));
	const pageDead = deadLinks.slice(Math.max(0, offset - orphans.length), Math.max(0, end - orphans.length));

	const nextCursor = end < combined ? encodeAuditOffset(end) : null;
	return {orphans: pageOrphans, deadLinks: pageDead, total, cursor: nextCursor, truncated: nextCursor !== null};
}

export function registerGraphAuditTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-graph-audit', {description: KADO_GRAPH_AUDIT_TOOL_DESCRIPTION, inputSchema: kadoGraphAuditShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		let request;
		try {
			request = mapGraphAuditRequest(args, keyId);
		} catch (err: unknown) {
			return mapError({code: 'VALIDATION_ERROR', message: String((err as Error).message ?? err)});
		}

		const config = deps.configManager.getConfig();

		// Pathless tool: no single source note to gate on. Require a valid, enabled
		// key (authenticate gate, like kado-open-notes); per-node ACL filtering below
		// enforces disclosure. An authenticated key only ever sees paths within its scope.
		const authResult = authenticateGate.evaluate(request, config);
		if (!authResult.allowed) {
			await logDenied('kado-graph-audit', deps, keyId, request, authResult.error.gate);
			return mapError(authResult.error);
		}
		const key = config.apiKeys.find((k) => k.id === keyId)!;

		const startMs = performance.now();
		try {
			const result = await deps.router(request);
			if (isCoreError(result)) {
				kadoLog('kado-graph-audit error', {...debugFields(keyId, request), code: result.code});
				return mapError(result);
			}
			const audit = result as CoreGraphAuditResult;

			// Disclosure guard: an orphan is a real note path — filter by its own path.
			// A dead link rides on its SOURCE note's visibility (the target is unresolved
			// text, not a path); include it only if the source is permitted.
			const readable = createReadablePredicate(key, config, deps.tagSource);
			const orphans = audit.orphans.filter((o) => readable(o.path));
			const deadLinks = audit.deadLinks.filter((d) => readable(d.source));

			const page = paginateAudit(orphans, deadLinks, request.cursor, request.limit);
			await logAllowed('kado-graph-audit', deps, keyId, request, startMs);
			return mapGraphAuditResult(page);
		} catch (err: unknown) {
			kadoLog('kado-graph-audit error', {...debugFields(keyId, request), code: 'INTERNAL_ERROR', err: String(err)});
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
		}
	});
}

export function registerGraphTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-graph', {description: KADO_GRAPH_TOOL_DESCRIPTION, inputSchema: kadoGraphShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		let request;
		try {
			request = mapGraphRequest(args, keyId);
		} catch (err: unknown) {
			return mapError({code: 'VALIDATION_ERROR', message: String((err as Error).message ?? err)});
		}

		const config = deps.configManager.getConfig();
		// Authorize a note read on the source; resolved nodes are scope-filtered below.
		const chainPerm = evaluateGraphPermissions(request, config, deps.gates);
		const perm = chainPerm.allowed
			? await evaluateNoteTagAccess(keyId, config, deps.tagSource, request.path, 'note')
			: chainPerm;
		if (!perm.allowed) {
			await logDenied('kado-graph', deps, keyId, request, perm.error.gate);
			return mapError(perm.error, deriveHints({tool: 'kado-graph', request, error: perm.error}));
		}

		const startMs = performance.now();
		try {
			const result = await deps.router(request);
			if (isCoreError(result)) {
				kadoLog('kado-graph error', {...debugFields(keyId, request), code: result.code});
				return mapError(result, deriveHints({tool: 'kado-graph', request, error: result}));
			}
			// Disclosure guard: graph resolves links to vault paths, so a resolved
			// neighbour may sit outside this key's scope. Drop out-of-scope resolved
			// nodes. Dangling targets are the source note's own (readable) content —
			// raw unresolved strings, not paths — so they are not path-filtered.
			const graphResult = result as CoreGraphResult;
			const key = config.apiKeys.find((k) => k.id === keyId);
			// A related node's `via` names the 1-hop notes it was reached through —
			// filter those too, and drop the node when no readable hop remains
			// (otherwise it reveals a link path through a hidden note).
			const readable = key ? createReadablePredicate(key, config, deps.tagSource) : (): boolean => false;
			const nodes = graphResult.nodes.flatMap((n) => {
				if (n.relation === 'dangling') return key ? [n] : [];
				if (!readable(n.path)) return [];
				if (n.via === undefined) return [n];
				const via = n.via.filter(readable);
				return via.length > 0 ? [{...n, via}] : [];
			});
			await logAllowed('kado-graph', deps, keyId, request, startMs);
			return mapGraphResult({...graphResult, nodes});
		} catch (err: unknown) {
			kadoLog('kado-graph error', {...debugFields(keyId, request), code: 'INTERNAL_ERROR', err: String(err)});
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
		}
	});
}
