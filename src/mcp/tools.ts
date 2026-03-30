/**
 * MCP tool registration — bridges the MCP SDK to the Kado Core pipeline.
 *
 * Registers three tools (kado-read, kado-write, kado-search) on an McpServer
 * instance. Each handler: extracts the keyId from the bearer token, maps args
 * into a canonical CoreRequest, runs the permission chain, runs the concurrency
 * guard for writes, routes to the correct adapter, and maps the result back to
 * a CallToolResult.
 */

// NOTE: Uses Zod v4. The MCP SDK 1.29+ includes zod-compat supporting both v3 and v4.
// If tool schemas don't render correctly in clients, pin zod to "^3.22.0".
import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {RequestHandlerExtra} from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {ServerRequest, ServerNotification, CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {ConfigManager} from '../core/config-manager';
import type {PermissionGate, CoreRequest, CoreError, DataType} from '../types/canonical';
import {isCoreSearchRequest} from '../types/canonical';
import {evaluatePermissions} from '../core/permission-chain';
import {validateConcurrency} from '../core/concurrency-guard';
import {mapFileResult, mapWriteResult, mapSearchResult, mapError} from './response-mapper';
import {mapReadRequest, mapWriteRequest, mapSearchRequest} from './request-mapper';
import type {
	CoreFileResult,
	CoreWriteResult,
	CoreSearchResult,
	CoreSearchItem,
	KadoConfig,
} from '../types/canonical';
import type {AuditLogger} from '../core/audit-logger';
import {createAuditEntry} from '../core/audit-logger';
import {matchGlob} from '../core/glob-match';

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
	operation: z.enum(['byTag', 'byName', 'listDir', 'listTags', 'byContent', 'byFrontmatter']),
	query: z.string().optional(),
	path: z.string().optional(),
	cursor: z.string().optional(),
	limit: z.number().optional(),
};

// ============================================================
// Helpers
// ============================================================

function isCoreError(value: RouteResult): value is CoreError {
	return 'code' in value && 'message' in value && !('content' in value) && !('items' in value);
}

function extractKeyId(extra: Extra): string | undefined {
	return extra.authInfo?.token;
}

function missingAuthError(): CallToolResult {
	return mapError({code: 'UNAUTHORIZED', message: 'Missing authentication token'});
}

/** Filters search result items to only include paths within the key's permitted areas. */
export function filterResultsByScope(items: CoreSearchItem[], keyId: string, config: KadoConfig): CoreSearchItem[] {
	const key = config.apiKeys.find((k) => k.id === keyId);
	if (!key || key.areas.length === 0) return [];

	const patterns = collectKeyPatterns(key.areas, config);
	if (patterns.length === 0) return [];

	return items.filter((item) => patterns.some((p) => matchGlob(p, item.path)));
}

function collectKeyPatterns(areas: {areaId: string}[], config: KadoConfig): string[] {
	const patterns: string[] = [];
	for (const keyArea of areas) {
		const globalArea = config.globalAreas.find((a) => a.id === keyArea.areaId);
		if (globalArea) {
			patterns.push(...globalArea.pathPatterns);
		}
	}
	return patterns;
}

function extractDataType(request: CoreRequest): DataType {
	return isCoreSearchRequest(request) ? 'note' : request.operation;
}

function truncateKeyId(keyId: string): string {
	return keyId.slice(0, 12) + '...';
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
	const dataType = extractDataType(request);
	const durationMs = Math.max(1, Math.round(performance.now() - startHrMs));
	await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation, dataType, path, decision: 'allowed', durationMs}));
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
	const dataType = extractDataType(request);
	await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation, dataType, path, decision: 'denied', gate}));
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
			return mapError(perm.error);
		}

		const startMs = performance.now();
		const result = await deps.router(request);
		if (isCoreError(result)) return mapError(result);
		await logAllowed(deps.auditLogger, keyId, request, startMs);
		return mapFileResult(result as CoreFileResult);
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
			return mapError(perm.error);
		}

		const concurrency = validateConcurrency(request, deps.getFileMtime(request.path));
		if (!concurrency.allowed) return mapError(concurrency.error);

		const startMs = performance.now();
		const result = await deps.router(request);
		if (isCoreError(result)) return mapError(result);
		await logAllowed(deps.auditLogger, keyId, request, startMs);
		return mapWriteResult(result as CoreWriteResult);
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
			return mapError(perm.error);
		}

		const startMs = performance.now();
		const result = await deps.router(request);
		if (isCoreError(result)) return mapError(result);

		const searchResult = result as CoreSearchResult;
		const config = deps.configManager.getConfig();
		searchResult.items = filterResultsByScope(searchResult.items, keyId, config);

		await logAllowed(deps.auditLogger, keyId, request, startMs);
		return mapSearchResult(searchResult);
	});
}
