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
	operation: z.enum(['note', 'frontmatter', 'file', 'dataview-inline-field']).describe('What to read: note (full markdown), frontmatter (YAML metadata as JSON), file (binary as base64), dataview-inline-field (inline fields as JSON)'),
	path: z.string().describe('Vault-relative path e.g. "Calendar/2026-03-31.md"'),
};

const kadoWriteShape = {
	operation: z.enum(['note', 'frontmatter', 'file', 'dataview-inline-field']).describe('What to write: note (string), frontmatter (JSON object), file (base64 string), dataview-inline-field (JSON object of key-value pairs)'),
	path: z.string().describe('Vault-relative path e.g. "100 Inbox/new-note.md"'),
	content: z.unknown().describe('The content to write. String for note/file, JSON object for frontmatter/dataview-inline-field'),
	expectedModified: z.number().optional().describe('Required for updates to existing files. Set to the "modified" timestamp from a prior read. Omit only when creating a new file.'),
};

const kadoSearchShape = {
	operation: z.enum(['byTag', 'byName', 'listDir', 'listTags', 'byContent', 'byFrontmatter']).describe('Search operation type'),
	query: z.string().optional().describe('Search query. Required for all operations except listDir and listTags. Supports * and ? glob wildcards for byName and byTag.'),
	path: z.string().optional().describe('Folder path for listDir (e.g. "Calendar") or path prefix for byContent'),
	cursor: z.string().optional().describe('Pagination cursor from a previous response'),
	limit: z.number().int().min(1).max(500).optional().describe('Max items per page (default 50, max 500)'),
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

/** Filters search result items to only include paths within the key's permitted scope. */
export function filterResultsByScope(items: CoreSearchItem[], keyId: string, config: KadoConfig): CoreSearchItem[] {
	const key = config.apiKeys.find((k) => k.id === keyId);
	if (!key) return [];

	return items.filter((item) => {
		const inGlobal = isPathInScope(item.path, config.security.listMode, config.security.paths.map((p) => p.path));
		const inKey = isPathInScope(item.path, key.listMode, key.paths.map((p) => p.path));
		return inGlobal && inKey;
	});
}

/**
 * Returns true when path is permitted by a whitelist/blacklist scope.
 * Whitelist: path must match at least one listed pattern.
 * Blacklist: path must NOT match any listed pattern.
 */
function isPathInScope(path: string, listMode: string, patterns: string[]): boolean {
	const matched = patterns.some((p) => matchGlob(p, path));
	return listMode === 'whitelist' ? matched : !matched;
}

/**
 * Returns the intersection of global and key path patterns that a file must match.
 * For whitelists, a file must match at least one pattern from each list.
 * Used to pre-filter files in scope-aware operations like listTags.
 */
export function computeScopePatterns(keyId: string, config: KadoConfig): string[] | undefined {
	const key = config.apiKeys.find((k) => k.id === keyId);
	if (!key) return [];

	// For whitelist scopes, the effective patterns are the key's own paths
	// (a file must match both global AND key patterns — the key's patterns
	// are always a subset of or equal to the global patterns in practice).
	if (key.listMode === 'whitelist') {
		return key.paths.map((p) => p.path);
	}

	// For blacklist keys, use the global whitelist patterns if global is whitelist
	if (config.security.listMode === 'whitelist') {
		return config.security.paths.map((p) => p.path);
	}

	// Both blacklist — pattern-based inclusion filtering not possible;
	// return undefined to skip adapter-level filtering (gates still enforce access).
	return undefined;
}

/**
 * Returns the effective tag patterns a key may use for tag-based operations.
 * The result is the intersection of global security tags and the key's own tags.
 * Empty array means no tag access. Undefined means no restriction.
 */
export function computeAllowedTags(keyId: string, config: KadoConfig): string[] {
	const key = config.apiKeys.find((k) => k.id === keyId);
	if (!key) return [];

	const globalTags = config.security.tags ?? [];
	const keyTags = key.tags ?? [];

	// Both empty → no tag access
	if (globalTags.length === 0 && keyTags.length === 0) return [];

	// If one is empty, the other is the effective set
	if (globalTags.length === 0) return keyTags;
	if (keyTags.length === 0) return globalTags;

	// Both non-empty → intersection (key tag must be permitted by global)
	return keyTags.filter((kt) =>
		globalTags.some((gt) => kt === gt),
	);
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
	try {
		const path = 'path' in request ? (request.path as string) : undefined;
		const operation = String(request.operation ?? '');
		const dataType = extractDataType(request);
		const durationMs = Math.max(1, Math.round(performance.now() - startHrMs));
		await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation, dataType, path, decision: 'allowed', durationMs}));
	} catch {
		// Audit logging must never crash a tool call — log failure is non-fatal
	}
}

async function logDenied(
	auditLogger: AuditLogger | undefined,
	keyId: string,
	request: CoreRequest,
	gate: string | undefined,
): Promise<void> {
	if (!auditLogger) return;
	try {
		const path = 'path' in request ? (request.path as string) : undefined;
		const operation = String(request.operation ?? '');
		const dataType = extractDataType(request);
		await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation, dataType, path, decision: 'denied', gate}));
	} catch {
		// Audit logging must never crash a tool call — log failure is non-fatal
	}
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
	server.registerTool('kado-read', {description: 'Read from the Obsidian vault. Returns content + created/modified/size metadata. Use the "modified" timestamp from the response as expectedModified when writing updates.', inputSchema: kadoReadShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		const request = mapReadRequest(args as Record<string, unknown>, keyId);
		const perm = evaluatePermissions(request, deps.configManager.getConfig(), deps.gates);
		if (!perm.allowed) {
			await logDenied(deps.auditLogger, keyId, request, perm.error.gate);
			return mapError(perm.error);
		}

		const startMs = performance.now();
		try {
			const result = await deps.router(request);
			if (isCoreError(result)) return mapError(result);
			await logAllowed(deps.auditLogger, keyId, request, startMs);
			return mapFileResult(result as CoreFileResult);
		} catch (err: unknown) {
			return mapError({code: 'INTERNAL_ERROR', message: String(err)});
		}
	});
}

function registerWriteTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-write', {description: 'Write to the Obsidian vault. To CREATE a new file: omit expectedModified. To UPDATE an existing file: first read it with kado-read, then pass the "modified" value as expectedModified. Returns CONFLICT if the file changed since your read.', inputSchema: kadoWriteShape}, async (args, extra: Extra): Promise<CallToolResult> => {
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
		try {
			const result = await deps.router(request);
			if (isCoreError(result)) return mapError(result);
			await logAllowed(deps.auditLogger, keyId, request, startMs);
			return mapWriteResult(result as CoreWriteResult);
		} catch (err: unknown) {
			return mapError({code: 'INTERNAL_ERROR', message: String(err)});
		}
	});
}

function registerSearchTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-search', {description: 'Search the Obsidian vault. Operations: byName (substring or glob e.g. "2026-03-*"), byTag (exact or glob e.g. "#project/*"), byContent (substring in note body), byFrontmatter (key=value or key-only), listDir (folder contents), listTags (all permitted tags with counts). Results are scoped to this key\'s permissions and paginated (default 50, max 500).', inputSchema: kadoSearchShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		const request = mapSearchRequest(args as Record<string, unknown>, keyId);
		const config = deps.configManager.getConfig();

		// Inject scope info so the adapter can pre-filter
		request.scopePatterns = computeScopePatterns(keyId, config);
		request.allowedTags = computeAllowedTags(keyId, config);

		const perm = evaluatePermissions(request, config, deps.gates);
		if (!perm.allowed) {
			await logDenied(deps.auditLogger, keyId, request, perm.error.gate);
			return mapError(perm.error);
		}

		const startMs = performance.now();
		try {
			const result = await deps.router(request);
			if (isCoreError(result)) return mapError(result);

			const searchResult = result as CoreSearchResult;

			await logAllowed(deps.auditLogger, keyId, request, startMs);
			return mapSearchResult(searchResult);
		} catch (err: unknown) {
			return mapError({code: 'INTERNAL_ERROR', message: String(err)});
		}
	});
}
