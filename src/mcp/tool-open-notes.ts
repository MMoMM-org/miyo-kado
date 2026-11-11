/**
 * kado-open-notes handler: feature-gated enumeration of open workspace notes,
 * silently filtered by the key's path ACL and tag rules. Split out of
 * tools.ts (#135).
 */

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {authenticateGate} from '../core/gates/authenticate';
import {gateOpenNoteScope} from '../core/gates/open-notes-gate';
import {kadoLog, truncateKeyId} from '../core/logger';
import {enumerateOpenNotes} from '../obsidian/open-notes-adapter';
import {mapError, mapOpenNotesResult} from './response-mapper';
import {mapOpenNotesRequest} from './request-mapper';
import type {Extra, ToolDependencies} from './tool-deps';
import {kadoOpenNotesShape, KADO_OPEN_NOTES_TOOL_DESCRIPTION} from './tool-shapes';
import {extractKeyId, missingAuthError} from './tool-support';
import {logAllowed, logDenied} from './tool-logging';
import {pruneToScopeKind, filterDescriptorsByAcl} from './scope-filters';

export function registerOpenNotesTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-open-notes', {
		description: KADO_OPEN_NOTES_TOOL_DESCRIPTION,
		inputSchema: kadoOpenNotesShape,
	}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		const config = deps.configManager.getConfig();

		// M6: run authenticate gate the same way as other tools
		const authResult = authenticateGate.evaluate(
			{apiKeyId: keyId, operation: 'note', path: ''},
			config,
		);
		if (!authResult.allowed) return mapError(authResult.error);

		// key is guaranteed to exist and be enabled after auth gate
		const key = config.apiKeys.find((k) => k.id === keyId)!;

		const req = mapOpenNotesRequest(args, keyId);
		const gate = gateOpenNoteScope(req.scope, config.security, key);
		if (gate.kind === 'deny') {
			await logDenied('kado-open-notes', deps, keyId, req, 'feature-gate');
			return mapError(gate.error);
		}

		const startMs = performance.now();
		try {
			const all = enumerateOpenNotes(deps.app);
			const byScope = pruneToScopeKind(all, gate.kind);
			const permitted = filterDescriptorsByAcl(byScope, key, config, deps.tagSource);
			await logAllowed('kado-open-notes', deps, keyId, req, startMs, {permittedCount: permitted.length});
			return mapOpenNotesResult({notes: permitted});
		} catch (err: unknown) {
			// M7: static message to avoid leaking internal details; raw error logged below
			kadoLog('kado-open-notes error', {key: truncateKeyId(keyId), code: 'INTERNAL_ERROR', err: String(err)});
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
		}
	});
}
