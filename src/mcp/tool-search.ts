/**
 * kado-search handler: injects the key's scope into the request so the
 * adapter can pre-filter, and post-filters results when it cannot. Split out
 * of tools.ts (#135).
 */

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {CoreSearchResult} from '../types/canonical';
import {evaluatePermissions} from '../core/permission-chain';
import {kadoLog} from '../core/logger';
import {mapSearchResult, mapError} from './response-mapper';
import {deriveHints} from './hints';
import {mapSearchRequest} from './request-mapper';
import {createReadablePredicate} from './tag-policy';
import type {Extra, ToolDependencies} from './tool-deps';
import {kadoSearchShape, KADO_SEARCH_TOOL_DESCRIPTION} from './tool-shapes';
import {isCoreError, extractKeyId, missingAuthError} from './tool-support';
import {debugFields, logAllowed, logDenied} from './tool-logging';
import {computeScopePatterns, computeAllowedTags, filterResultsByScope} from './scope-filters';

export function registerSearchTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-search', {description: KADO_SEARCH_TOOL_DESCRIPTION, inputSchema: kadoSearchShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		const request = mapSearchRequest(args, keyId);
		const config = deps.configManager.getConfig();

		// Inject scope info so the adapter can pre-filter
		request.scopePatterns = computeScopePatterns(keyId, config);
		request.allowedTags = computeAllowedTags(keyId, config);
		const searchKey = config.apiKeys.find((k) => k.id === keyId);
		request.readablePath = searchKey ? createReadablePredicate(searchKey, config, deps.tagSource) : () => false;

		const perm = evaluatePermissions(request, config, deps.gates);
		if (!perm.allowed) {
			await logDenied('kado-search', deps, keyId, request, perm.error.gate);
			return mapError(perm.error, deriveHints({tool: 'kado-search', request, error: perm.error}));
		}

		const startMs = performance.now();
		try {
			const result = await deps.router(request);
			if (isCoreError(result)) {
				kadoLog('kado-search error', {...debugFields(keyId, request), code: result.code});
				return mapError(result);
			}

			let searchResult = result as CoreSearchResult;

			// When both global and key are in blacklist mode, computeScopePatterns returns
			// undefined and the adapter cannot pre-filter by scope. Apply post-hoc filtering
			// here so blacklisted paths are never returned to the caller.
			if (request.scopePatterns === undefined && request.operation !== 'listTags') {
				const filtered = filterResultsByScope(searchResult.items, keyId, config, deps.tagSource);
				searchResult = {...searchResult, items: filtered, total: filtered.length};
			}

			await logAllowed('kado-search', deps, keyId, request, startMs);
			return mapSearchResult(searchResult, deriveHints({tool: 'kado-search', request, searchResult}));
		} catch (err: unknown) {
			kadoLog('kado-search error', {...debugFields(keyId, request), code: 'INTERNAL_ERROR', err: String(err)});
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
		}
	});
}
