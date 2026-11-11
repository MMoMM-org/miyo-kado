/**
 * kado-read and kado-write handlers: map args, run the permission chain plus
 * tag rules, the concurrency guard for writes, route to the adapter and map
 * the result. Split out of tools.ts (#135).
 */

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {CoreError, CoreFileResult, CoreWriteResult} from '../types/canonical';
import {evaluatePermissions} from '../core/permission-chain';
import {validateConcurrency} from '../core/concurrency-guard';
import {resolveTagsReturnScope} from '../core/gates/datatype-permission';
import {kadoLog} from '../core/logger';
import {mapFileResult, mapWriteResult, mapError} from './response-mapper';
import {deriveHints} from './hints';
import {mapReadRequest, mapWriteRequest} from './request-mapper';
import {evaluateNoteTagAccess, isNoteCreate} from './tag-policy';
import type {Extra, ToolDependencies} from './tool-deps';
import {kadoReadShape, kadoWriteShape, KADO_READ_TOOL_DESCRIPTION, KADO_WRITE_TOOL_DESCRIPTION} from './tool-shapes';
import {isCoreError, extractKeyId, missingAuthError} from './tool-support';
import {debugFields, logAllowed, logDenied} from './tool-logging';

export function registerReadTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-read', {description: KADO_READ_TOOL_DESCRIPTION, inputSchema: kadoReadShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		let request;
		try {
			request = mapReadRequest(args, keyId);
		} catch (err: unknown) {
			return mapError({code: 'VALIDATION_ERROR', message: String((err as Error).message ?? err)});
		}
		const config = deps.configManager.getConfig();
		const chainPerm = evaluatePermissions(request, config, deps.gates);
		const perm = chainPerm.allowed
			? await evaluateNoteTagAccess(keyId, config, deps.tagSource, request.path, request.operation)
			: chainPerm;
		if (!perm.allowed) {
			await logDenied('kado-read', deps, keyId, request, perm.error.gate);
			return mapError(perm.error, deriveHints({tool: 'kado-read', request, error: perm.error}));
		}
		if (request.operation === 'tags') {
			const key = config.apiKeys.find((k) => k.id === keyId);
			request.tagsReturnScope = (key && resolveTagsReturnScope(request.path, config, key)) || 'frontmatter-only';
		}

		const startMs = performance.now();
		try {
			const result = await deps.router(request);
			if (isCoreError(result)) {
				kadoLog('kado-read error', {...debugFields(keyId, request), code: result.code});
				return mapError(result, deriveHints({tool: 'kado-read', request, error: result}));
			}
			await logAllowed('kado-read', deps, keyId, request, startMs);
			const fileResult = result as CoreFileResult;
			return mapFileResult(fileResult, deriveHints({tool: 'kado-read', request, fileResult}));
		} catch (err: unknown) {
			// Adapters throw *AdapterError with a `code` field (NOT_FOUND,
			// CONFLICT, VALIDATION_ERROR). Surface those codes so MCP clients
			// can distinguish missing files from real internal failures.
			const asError = err as {code?: string; message?: string};
			const code = (asError.code === 'CONFLICT' || asError.code === 'NOT_FOUND' || asError.code === 'VALIDATION_ERROR') ? asError.code : 'INTERNAL_ERROR';
			kadoLog('kado-read error', {...debugFields(keyId, request), code, err: String(err)});
			if (code !== 'INTERNAL_ERROR') {
				const error: CoreError = {code: code, message: asError.message ?? String(err)};
				return mapError(error, deriveHints({tool: 'kado-read', request, error}));
			}
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
		}
	});
}

export function registerWriteTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-write', {description: KADO_WRITE_TOOL_DESCRIPTION, inputSchema: kadoWriteShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		let request;
		try {
			request = mapWriteRequest(args, keyId);
		} catch (err: unknown) {
			return mapError({code: 'VALIDATION_ERROR', message: String((err as Error).message ?? err)});
		}
		const config = deps.configManager.getConfig();
		const chainPerm = evaluatePermissions(request, config, deps.gates);
		const newNoteContent = isNoteCreate(request, deps.getFileMtime)
			? (typeof request.content === 'string' ? request.content : '')
			: undefined;
		const perm = chainPerm.allowed
			? await evaluateNoteTagAccess(keyId, config, deps.tagSource, request.path, request.operation, newNoteContent)
			: chainPerm;
		if (!perm.allowed) {
			await logDenied('kado-write', deps, keyId, request, perm.error.gate);
			return mapError(perm.error, deriveHints({tool: 'kado-write', request, error: perm.error}));
		}

		const concurrency = validateConcurrency(request, deps.getFileMtime(request.path));
		if (!concurrency.allowed) {
			kadoLog('kado-write error', {...debugFields(keyId, request), code: concurrency.error.code});
			return mapError(concurrency.error, deriveHints({tool: 'kado-write', request, error: concurrency.error}));
		}

		const startMs = performance.now();
		try {
			const result = await deps.router(request);
			if (isCoreError(result)) {
				kadoLog('kado-write error', {...debugFields(keyId, request), code: result.code});
				return mapError(result, deriveHints({tool: 'kado-write', request, error: result}));
			}
			await logAllowed('kado-write', deps, keyId, request, startMs);
			return mapWriteResult(result as CoreWriteResult);
		} catch (err: unknown) {
			// Adapters throw NoteAdapterError / FrontmatterAdapterError with a
			// `code` field (CONFLICT for open-dirty-editor collision, NOT_FOUND
			// for missing targets, VALIDATION_ERROR for bad inputs). Surface
			// those codes so MCP clients can retry correctly.
			const asError = err as {code?: string; message?: string};
			const code = (asError.code === 'CONFLICT' || asError.code === 'NOT_FOUND' || asError.code === 'VALIDATION_ERROR') ? asError.code : 'INTERNAL_ERROR';
			kadoLog('kado-write error', {...debugFields(keyId, request), code, err: String(err)});
			if (code !== 'INTERNAL_ERROR') {
				const error: CoreError = {code: code, message: asError.message ?? String(err)};
				return mapError(error, deriveHints({tool: 'kado-write', request, error}));
			}
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
		}
	});
}
