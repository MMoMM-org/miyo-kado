/**
 * MCP tool registration — bridges the MCP SDK to the Kado Core pipeline.
 *
 * Registers three tools (kado-read, kado-write, kado-search) on an McpServer
 * instance. Each handler: extracts the keyId from the bearer token, maps args
 * into a canonical CoreRequest, runs the permission chain, runs the concurrency
 * guard for writes, routes to the correct adapter, and maps the result back to
 * a CallToolResult.
 */

import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {RequestHandlerExtra} from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {ServerRequest, ServerNotification, CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {ConfigManager} from '../core/config-manager';
import type {PermissionGate, CoreRequest, CoreError} from '../types/canonical';
import {evaluatePermissions} from '../core/permission-chain';
import {validateConcurrency} from '../core/concurrency-guard';
import {mapFileResult, mapWriteResult, mapSearchResult, mapError} from './response-mapper';
import {mapReadRequest, mapWriteRequest, mapSearchRequest} from './request-mapper';
import type {
	CoreFileResult,
	CoreWriteResult,
	CoreSearchResult,
} from '../types/canonical';
import type {AuditLogger} from '../core/audit-logger';
import {createAuditEntry} from '../core/audit-logger';

// ============================================================
// Public types
// ============================================================

type RouteResult = CoreFileResult | CoreWriteResult | CoreSearchResult | CoreError;

export interface ToolDependencies {
	configManager: ConfigManager;
	gates: PermissionGate[];
	router: (request: CoreRequest) => Promise<RouteResult>;
	getFileMtime: (path: string) => number | undefined;
	auditLogger?: AuditLogger;
}

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// ============================================================
// Zod schemas (spec T4.3)
// ============================================================

const kadoReadShape = {
	operation: z.enum(['note', 'frontmatter', 'file', 'dataview-inline-field']),
	path: z.string(),
};

const kadoWriteShape = {
	operation: z.enum(['note', 'frontmatter', 'file', 'dataview-inline-field']),
	path: z.string(),
	content: z.unknown(),
	expectedModified: z.number().optional(),
};

const kadoSearchShape = {
	operation: z.enum(['byTag', 'byName', 'listDir', 'listTags']),
	query: z.string().optional(),
	path: z.string().optional(),
	cursor: z.string().optional(),
	limit: z.number().optional(),
};

// ============================================================
// Helpers
// ============================================================

function isCoreError(value: RouteResult): value is CoreError {
	return typeof (value as CoreError).code === 'string' && typeof (value as CoreError).message === 'string' && !('content' in value) && !('items' in value);
}

function extractKeyId(extra: Extra): string | undefined {
	return extra.authInfo?.token;
}

function asCallToolResult(result: {content: {type: 'text'; text: string}[]; isError?: boolean}): CallToolResult {
	return result as unknown as CallToolResult;
}

function missingAuthError(): CallToolResult {
	return asCallToolResult(mapError({code: 'UNAUTHORIZED', message: 'Missing authentication token'}));
}

async function logAllowed(
	auditLogger: AuditLogger | undefined,
	keyId: string,
	request: CoreRequest,
	startHrMs: number,
): Promise<void> {
	if (!auditLogger) return;
	const path = 'path' in request ? (request.path as string) : undefined;
	const operation = String(request.operation ?? '');
	const durationMs = Math.max(1, Math.round(performance.now() - startHrMs));
	await auditLogger.log(createAuditEntry({apiKeyId: keyId, operation, path, decision: 'allowed', durationMs}));
}

async function logDenied(
	auditLogger: AuditLogger | undefined,
	keyId: string,
	request: CoreRequest,
	gate: string | undefined,
): Promise<void> {
	if (!auditLogger) return;
	const path = 'path' in request ? (request.path as string) : undefined;
	const operation = String(request.operation ?? '');
	await auditLogger.log(createAuditEntry({apiKeyId: keyId, operation, path, decision: 'denied', gate}));
}

// ============================================================
// Public API
// ============================================================

export function registerTools(server: McpServer, deps: ToolDependencies): void {
	registerReadTool(server, deps);
	registerWriteTool(server, deps);
	registerSearchTool(server, deps);
}

// ============================================================
// Tool handlers (each under 20 lines)
// ============================================================

function registerReadTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-read', {inputSchema: kadoReadShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		const request = mapReadRequest(args as Record<string, unknown>, keyId);
		const perm = evaluatePermissions(request, deps.configManager.getConfig(), deps.gates);
		if (!perm.allowed) {
			await logDenied(deps.auditLogger, keyId, request, perm.error.gate);
			return asCallToolResult(mapError(perm.error));
		}

		const startMs = performance.now();
		const result = await deps.router(request);
		if (isCoreError(result)) return asCallToolResult(mapError(result));
		await logAllowed(deps.auditLogger, keyId, request, startMs);
		return asCallToolResult(mapFileResult(result as CoreFileResult));
	});
}

function registerWriteTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-write', {inputSchema: kadoWriteShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		const request = mapWriteRequest(args as Record<string, unknown>, keyId);
		const perm = evaluatePermissions(request, deps.configManager.getConfig(), deps.gates);
		if (!perm.allowed) {
			await logDenied(deps.auditLogger, keyId, request, perm.error.gate);
			return asCallToolResult(mapError(perm.error));
		}

		const concurrency = validateConcurrency(request, deps.getFileMtime(request.path));
		if (!concurrency.allowed) return asCallToolResult(mapError(concurrency.error));

		const startMs = performance.now();
		const result = await deps.router(request);
		if (isCoreError(result)) return asCallToolResult(mapError(result));
		await logAllowed(deps.auditLogger, keyId, request, startMs);
		return asCallToolResult(mapWriteResult(result as CoreWriteResult));
	});
}

function registerSearchTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-search', {inputSchema: kadoSearchShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		const request = mapSearchRequest(args as Record<string, unknown>, keyId);
		const perm = evaluatePermissions(request, deps.configManager.getConfig(), deps.gates);
		if (!perm.allowed) {
			await logDenied(deps.auditLogger, keyId, request, perm.error.gate);
			return asCallToolResult(mapError(perm.error));
		}

		const startMs = performance.now();
		const result = await deps.router(request);
		if (isCoreError(result)) return asCallToolResult(mapError(result));
		await logAllowed(deps.auditLogger, keyId, request, startMs);
		return asCallToolResult(mapSearchResult(result as CoreSearchResult));
	});
}
