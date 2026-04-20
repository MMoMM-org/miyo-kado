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
import type {App} from 'obsidian';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {RequestHandlerExtra} from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {ServerRequest, ServerNotification, CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {ConfigManager} from '../core/config-manager';
import type {PermissionGate, CoreRequest, CoreError, DataType, CoreOpenNotesRequest} from '../types/canonical';
import {isCoreSearchRequest, isCoreOpenNotesRequest} from '../types/canonical';
import {evaluatePermissions} from '../core/permission-chain';
import {validateConcurrency} from '../core/concurrency-guard';
import {mapFileResult, mapWriteResult, mapSearchResult, mapDeleteResult, mapError, mapOpenNotesResult} from './response-mapper';
import {mapReadRequest, mapWriteRequest, mapSearchRequest, mapDeleteRequest, mapOpenNotesRequest} from './request-mapper';
import type {
	CoreFileResult,
	CoreWriteResult,
	CoreSearchResult,
	CoreDeleteResult,
	CoreSearchItem,
	KadoConfig,
	ApiKeyConfig,
	OpenNoteDescriptor,
} from '../types/canonical';
import type {AuditLogger} from '../core/audit-logger';
import {createAuditEntry} from '../core/audit-logger';
import {matchGlob, dirCouldContainMatches} from '../core/glob-match';
import {matchTag} from '../core/tag-utils';
import {kadoLog} from '../core/logger';
import {enumerateOpenNotes} from '../obsidian/open-notes-adapter';
import {gateOpenNoteScope} from '../core/gates/open-notes-gate';
import {authenticateGate} from '../core/gates/authenticate';

// ============================================================
// Public types
// ============================================================

type RouteResult = CoreFileResult | CoreWriteResult | CoreSearchResult | CoreDeleteResult | CoreError;

/** Dependencies injected into the MCP tool handlers. */
export interface ToolDependencies {
	configManager: ConfigManager;
	gates: PermissionGate[];
	router: (request: CoreRequest) => Promise<RouteResult>;
	getFileMtime: (path: string) => number | undefined;
	auditLogger?: AuditLogger;
	/** Obsidian App instance — required by the kado-open-notes tool handler. */
	app: App;
}

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// ============================================================
// Zod schemas (spec T4.3)
// ============================================================

const kadoReadShape = {
	operation: z.enum(['note', 'frontmatter', 'file', 'dataview-inline-field', 'tags']).describe('What to read: note (full markdown), frontmatter (YAML metadata as JSON), file (binary as base64), dataview-inline-field (inline fields as JSON), tags (frontmatter + inline tags as JSON — requires note.read OR frontmatter.read; with only frontmatter.read, inline tags are omitted and returnedTags="FrontmatterOnly")'),
	path: z.string().describe('Vault-relative path e.g. "Calendar/2026-03-31.md"'),
};

const kadoWriteShape = {
	operation: z.enum(['note', 'frontmatter', 'file', 'dataview-inline-field']).describe('What to write: note (string), frontmatter (JSON object), file (base64 string), dataview-inline-field (JSON object of key-value pairs)'),
	path: z.string().describe('Vault-relative path e.g. "100 Inbox/new-note.md"'),
	content: z.unknown().describe('The content to write. String for note/file, JSON object for frontmatter/dataview-inline-field'),
	expectedModified: z.number().optional().describe('Required for updates to existing files. Set to the "modified" timestamp from a prior read. Omit only when creating a new file.'),
};

const kadoDeleteShape = {
	// Accept all 4 DataType values at the SDK boundary; mapDeleteRequest rejects
	// 'dataview-inline-field' with a canonical VALIDATION_ERROR the client can parse.
	operation: z.enum(['note', 'frontmatter', 'file', 'dataview-inline-field']).describe('What to delete: note (trash markdown file), file (trash binary file), frontmatter (remove specific keys from YAML). dataview-inline-field is NOT supported and returns VALIDATION_ERROR.'),
	path: z.string().describe('Vault-relative path.'),
	expectedModified: z.number().describe('Required. The "modified" timestamp from a prior read. CONFLICT if the file changed since.'),
	keys: z.array(z.string()).optional().describe('Required for operation="frontmatter": non-empty array of frontmatter keys to remove. Ignored for note/file.'),
};

export const kadoOpenNotesShape = {
	scope: z.enum(['active', 'other', 'all']).optional().describe(
		'Which open notes to enumerate: "active" (focused leaf only), "other" (non-active open notes), "all" (default, both active and other)',
	),
};

export const kadoSearchShape = {
	operation: z.enum(['byTag', 'byName', 'listDir', 'listTags', 'byContent', 'byFrontmatter']).describe('Search operation type'),
	query: z.string().optional().describe('Search query. Required for all operations except listDir and listTags. Supports * and ? glob wildcards for byName and byTag.'),
	path: z.string().optional().describe('Folder path for listDir only. "/" is the canonical vault-root marker; trailing slashes are accepted; non-existent paths return NOT_FOUND; paths pointing to a file return VALIDATION_ERROR; empty string is rejected.'),
	cursor: z.string().optional().describe('Pagination cursor from a previous response'),
	limit: z.number().int().min(1).max(500).optional().describe('Max items per page (default 50, max 500)'),
	depth: z.number().int().positive().optional().describe('Walk depth for listDir. Omit for unlimited recursion. depth=1 returns only direct children. Invalid values (0, negative, non-integer) return VALIDATION_ERROR.'),
	filter: z.object({
		path: z.string().optional().describe('Folder prefix filter — only items whose path starts with this value. Works with all operations.'),
		tags: z.array(z.string()).optional().describe('Tag filter — item must carry at least one matching tag. Supports * and ? glob wildcards. Ignored by listDir.'),
		frontmatter: z.string().optional().describe('Frontmatter filter — key=value (match value) or key-only (key exists). Same syntax as byFrontmatter query. Ignored by listDir.'),
	}).optional().describe('Universal cross-operation filters to narrow results. All filters are AND-combined.'),
};

export const KADO_SEARCH_TOOL_DESCRIPTION =
	'Search the Obsidian vault. Operations: ' +
	'byName (substring or glob e.g. "2026-03-*"), ' +
	'byTag (exact or glob e.g. "#project/*"), ' +
	'byContent (substring in note body), ' +
	'byFrontmatter (key=value or key-only), ' +
	'listDir (folder contents with type: "file" | "folder" discriminator; folder items carry childCount; results sort folders-first then alphabetically; use depth=1 for a shallow scan of direct children only, omit depth for unlimited recursion; "/" is the canonical vault-root marker; missing paths return NOT_FOUND, file targets return VALIDATION_ERROR), ' +
	'listTags (all permitted tags with counts). ' +
	'Optional "filter" narrows any operation: filter.path (folder prefix), filter.tags (note must have at least one matching tag, glob-capable), filter.frontmatter (key=value or key-only). Filters are AND-combined. filter.tags and filter.frontmatter are ignored by listDir. ' +
	'Results are scoped to this key\'s permissions and paginated (default 50, max 500). ' +
	'Hidden entries (names starting with ".") are never returned.';

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

/**
 * Returns true when a file path is permitted by both the global scope and the key scope.
 * Shared predicate used by filterResultsByScope and filterDescriptorsByAcl to avoid
 * duplicating glob-matching logic — any future change to whitelist/blacklist semantics
 * applies to both.
 */
function isPathPermittedForKey(path: string, key: ApiKeyConfig, config: KadoConfig): boolean {
	const inGlobal = isPathInScope(path, config.security.listMode, config.security.paths.map((p) => p.path));
	const inKey = isPathInScope(path, key.listMode, key.paths.map((p) => p.path));
	return inGlobal && inKey;
}

/** Filters search result items to only include paths within the key's permitted scope. */
export function filterResultsByScope(items: CoreSearchItem[], keyId: string, config: KadoConfig): CoreSearchItem[] {
	const key = config.apiKeys.find((k) => k.id === keyId);
	if (!key) return [];

	return items.filter((item) => {
		if (item.type === 'folder') {
			const inGlobal = isFolderInScope(item.path, config.security.listMode, config.security.paths.map((p) => p.path));
			const inKey = isFolderInScope(item.path, key.listMode, key.paths.map((p) => p.path));
			return inGlobal && inKey;
		}
		return isPathPermittedForKey(item.path, key, config);
	});
}

/**
 * Returns true when a folder path is permitted by a whitelist/blacklist scope.
 * Whitelist: at least one pattern could match a child of this folder.
 * Blacklist: NO pattern could match a child of this folder (otherwise the folder
 *   would leak the existence of blacklisted descendants).
 */
function isFolderInScope(folderPath: string, listMode: string, patterns: string[]): boolean {
	const prefix = folderPath.endsWith('/') ? folderPath : folderPath + '/';
	const couldMatchChild = patterns.some((p) => dirCouldContainMatches(p, prefix));
	return listMode === 'whitelist' ? couldMatchChild : !couldMatchChild;
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
 * Returns undefined when neither global nor key have tags configured (unrestricted).
 * Returns [] when there is an explicit empty intersection (no access).
 */
export function computeAllowedTags(keyId: string, config: KadoConfig): string[] | undefined {
	const key = config.apiKeys.find((k) => k.id === keyId);
	if (!key) return [];

	const globalTags = config.security.tags ?? [];
	const keyTags = key.tags ?? [];

	// Whitelist semantics: empty list = no access (not unrestricted)
	if (globalTags.length === 0 && keyTags.length === 0) return [];
	if (globalTags.length === 0) return [];
	if (keyTags.length === 0) return [];

	// Both non-empty → intersection (key tag must be permitted by at least one global pattern)
	return keyTags.filter((kt) =>
		globalTags.some((gt) => matchTag(kt, gt)),
	);
}

/**
 * Prunes open-note descriptors to only those matching the scope kind from the feature gate.
 * 'allow-active-only' keeps only active notes; 'allow-other-only' keeps only non-active;
 * 'allow-both' keeps all.
 */
function pruneToScopeKind(
	notes: OpenNoteDescriptor[],
	kind: 'allow-active-only' | 'allow-other-only' | 'allow-both',
): OpenNoteDescriptor[] {
	if (kind === 'allow-active-only') return notes.filter((n) => n.active);
	if (kind === 'allow-other-only') return notes.filter((n) => !n.active);
	return notes;
}

/**
 * Filters open-note descriptors by path ACL (global AND key whitelist/blacklist).
 * Silently drops any descriptor whose path is not permitted — ADR-4 privacy invariant.
 * Delegates to isPathPermittedForKey to share glob-matching logic with filterResultsByScope.
 */
function filterDescriptorsByAcl(notes: OpenNoteDescriptor[], key: ApiKeyConfig, config: KadoConfig): OpenNoteDescriptor[] {
	return notes.filter((note) => isPathPermittedForKey(note.path, key, config));
}

function extractDataType(request: CoreRequest): DataType {
	if (isCoreSearchRequest(request)) return 'note';
	// 'tags' read operation is audited as a note read (it reads the note body).
	if (request.operation === 'tags') return 'note';
	return request.operation;
}

function truncateKeyId(keyId: string): string {
	return keyId.slice(0, 12) + '...';
}

function debugFields(keyId: string, request: CoreRequest): Record<string, unknown> {
	const fields: Record<string, unknown> = {
		key: truncateKeyId(keyId),
		operation: String(request.operation ?? ''),
	};
	if ('path' in request && request.path !== undefined) fields.path = request.path;
	if ('query' in request && request.query !== undefined) fields.query = request.query;
	return fields;
}

async function logAllowed(
	tool: string,
	auditLogger: AuditLogger | undefined,
	keyId: string,
	request: CoreRequest | CoreOpenNotesRequest,
	startHrMs: number,
	extra?: {permittedCount?: number},
): Promise<void> {
	const durationMs = Math.max(1, Math.round(performance.now() - startHrMs));
	if (isCoreOpenNotesRequest(request as {kind?: unknown})) {
		kadoLog(`${tool} allowed`, {key: truncateKeyId(keyId), scope: (request as CoreOpenNotesRequest).scope, durationMs});
		if (!auditLogger) return;
		try {
			await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation: 'openNotes', query: (request as CoreOpenNotesRequest).scope, decision: 'allowed', durationMs, permittedCount: extra?.permittedCount}));
		} catch { /* audit logging must never crash a tool call */ }
		return;
	}
	const coreReq = request as CoreRequest;
	kadoLog(`${tool} allowed`, {...debugFields(keyId, coreReq), durationMs});
	if (!auditLogger) return;
	try {
		const path = 'path' in coreReq ? (coreReq.path as string) : undefined;
		const query = 'query' in coreReq ? (coreReq.query as string) : undefined;
		const operation = String(coreReq.operation ?? '');
		const dataType = extractDataType(coreReq);
		await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation, dataType, path, query, decision: 'allowed', durationMs}));
	} catch {
		// Audit logging must never crash a tool call — log failure is non-fatal
	}
}

async function logDenied(
	tool: string,
	auditLogger: AuditLogger | undefined,
	keyId: string,
	request: CoreRequest | CoreOpenNotesRequest,
	gate: string | undefined,
): Promise<void> {
	if (isCoreOpenNotesRequest(request as {kind?: unknown})) {
		kadoLog(`${tool} denied`, {key: truncateKeyId(keyId), scope: (request as CoreOpenNotesRequest).scope, gate});
		if (!auditLogger) return;
		try {
			await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation: 'openNotes', query: (request as CoreOpenNotesRequest).scope, decision: 'denied', gate}));
		} catch { /* audit logging must never crash a tool call */ }
		return;
	}
	const coreReq = request as CoreRequest;
	kadoLog(`${tool} denied`, {...debugFields(keyId, coreReq), gate});
	if (!auditLogger) return;
	try {
		const path = 'path' in coreReq ? (coreReq.path as string) : undefined;
		const query = 'query' in coreReq ? (coreReq.query as string) : undefined;
		const operation = String(coreReq.operation ?? '');
		const dataType = extractDataType(coreReq);
		await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation, dataType, path, query, decision: 'denied', gate}));
	} catch {
		// Audit logging must never crash a tool call — log failure is non-fatal
	}
}

// ============================================================
// Public API
// ============================================================

/**
 * Registers the kado-read, kado-write, and kado-search tools on the MCP server.
 * @param server - The MCP server instance to register tools on.
 * @param deps - Shared dependencies (config, gates, router, audit logger).
 */
export function registerTools(server: McpServer, deps: ToolDependencies): void {
	registerReadTool(server, deps);
	registerWriteTool(server, deps);
	registerSearchTool(server, deps);
	registerDeleteTool(server, deps);
	registerOpenNotesTool(server, deps);
}

// ============================================================
// Tool handlers (each under 20 lines)
// ============================================================

function registerReadTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-read', {description: 'Read from the Obsidian vault. Returns content + created/modified/size metadata. Use the "modified" timestamp from the response as expectedModified when writing updates. operation="tags" returns {frontmatter: string[], inline: string[], all: string[], returnedTags: "All" | "FrontmatterOnly"} — tags deduplicated, no leading "#". When the key has only frontmatter.read (no note.read), inline tags are omitted and returnedTags="FrontmatterOnly" signals that additional inline tags may exist but require note.read.', inputSchema: kadoReadShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		const request = mapReadRequest(args as Record<string, unknown>, keyId);
		const perm = evaluatePermissions(request, deps.configManager.getConfig(), deps.gates);
		if (!perm.allowed) {
			await logDenied('kado-read', deps.auditLogger, keyId, request, perm.error.gate);
			return mapError(perm.error);
		}

		const startMs = performance.now();
		try {
			const result = await deps.router(request);
			if (isCoreError(result)) {
				kadoLog('kado-read error', {...debugFields(keyId, request), code: result.code});
				return mapError(result);
			}
			await logAllowed('kado-read', deps.auditLogger, keyId, request, startMs);
			return mapFileResult(result as CoreFileResult);
		} catch (err: unknown) {
			// Adapters throw *AdapterError with a `code` field (NOT_FOUND,
			// CONFLICT, VALIDATION_ERROR). Surface those codes so MCP clients
			// can distinguish missing files from real internal failures.
			const asError = err as {code?: string; message?: string};
			const code = (asError.code === 'CONFLICT' || asError.code === 'NOT_FOUND' || asError.code === 'VALIDATION_ERROR') ? asError.code : 'INTERNAL_ERROR';
			kadoLog('kado-read error', {...debugFields(keyId, request), code});
			if (code !== 'INTERNAL_ERROR') {
				return mapError({code, message: asError.message ?? String(err)});
			}
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
			await logDenied('kado-write', deps.auditLogger, keyId, request, perm.error.gate);
			return mapError(perm.error);
		}

		const concurrency = validateConcurrency(request, deps.getFileMtime(request.path));
		if (!concurrency.allowed) {
			kadoLog('kado-write error', {...debugFields(keyId, request), code: concurrency.error.code});
			return mapError(concurrency.error);
		}

		const startMs = performance.now();
		try {
			const result = await deps.router(request);
			if (isCoreError(result)) {
				kadoLog('kado-write error', {...debugFields(keyId, request), code: result.code});
				return mapError(result);
			}
			await logAllowed('kado-write', deps.auditLogger, keyId, request, startMs);
			return mapWriteResult(result as CoreWriteResult);
		} catch (err: unknown) {
			// Adapters throw NoteAdapterError / FrontmatterAdapterError with a
			// `code` field (CONFLICT for open-dirty-editor collision, NOT_FOUND
			// for missing targets, VALIDATION_ERROR for bad inputs). Surface
			// those codes so MCP clients can retry correctly.
			const asError = err as {code?: string; message?: string};
			const code = (asError.code === 'CONFLICT' || asError.code === 'NOT_FOUND' || asError.code === 'VALIDATION_ERROR') ? asError.code : 'INTERNAL_ERROR';
			kadoLog('kado-write error', {...debugFields(keyId, request), code});
			if (code !== 'INTERNAL_ERROR') {
				return mapError({code, message: asError.message ?? String(err)});
			}
			return mapError({code: 'INTERNAL_ERROR', message: String(err)});
		}
	});
}

function registerDeleteTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-delete', {description: 'Delete from the Obsidian vault. operation=note|file moves the file to the user\'s configured trash (respects Obsidian settings). operation=frontmatter removes specific keys via the "keys" array. Always requires expectedModified — read the file first and pass the "modified" timestamp. Returns CONFLICT if the file changed since your read, NOT_FOUND if missing.', inputSchema: kadoDeleteShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		let request;
		try {
			request = mapDeleteRequest(args as Record<string, unknown>, keyId);
		} catch (err: unknown) {
			return mapError({code: 'VALIDATION_ERROR', message: String((err as Error).message ?? err)});
		}

		const perm = evaluatePermissions(request, deps.configManager.getConfig(), deps.gates);
		if (!perm.allowed) {
			await logDenied('kado-delete', deps.auditLogger, keyId, request, perm.error.gate);
			return mapError(perm.error);
		}

		const concurrency = validateConcurrency(request, deps.getFileMtime(request.path));
		if (!concurrency.allowed) {
			kadoLog('kado-delete error', {...debugFields(keyId, request), code: concurrency.error.code});
			return mapError(concurrency.error);
		}

		const startMs = performance.now();
		try {
			const result = await deps.router(request);
			if (isCoreError(result)) {
				kadoLog('kado-delete error', {...debugFields(keyId, request), code: result.code});
				return mapError(result);
			}
			await logAllowed('kado-delete', deps.auditLogger, keyId, request, startMs);
			return mapDeleteResult(result as CoreDeleteResult);
		} catch (err: unknown) {
			// Adapters throw DeleteAdapterError with a `code` field — propagate it as the canonical error
			const asError = err as {code?: string; message?: string};
			const code = (asError.code === 'NOT_FOUND' || asError.code === 'VALIDATION_ERROR') ? asError.code : 'INTERNAL_ERROR';
			kadoLog('kado-delete error', {...debugFields(keyId, request), code});
			if (code !== 'INTERNAL_ERROR') {
				return mapError({code, message: asError.message ?? String(err)});
			}
			return mapError({code: 'INTERNAL_ERROR', message: String(err)});
		}
	});
}

function registerSearchTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-search', {description: KADO_SEARCH_TOOL_DESCRIPTION, inputSchema: kadoSearchShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		const request = mapSearchRequest(args as Record<string, unknown>, keyId);
		const config = deps.configManager.getConfig();

		// Inject scope info so the adapter can pre-filter
		request.scopePatterns = computeScopePatterns(keyId, config);
		request.allowedTags = computeAllowedTags(keyId, config);

		const perm = evaluatePermissions(request, config, deps.gates);
		if (!perm.allowed) {
			await logDenied('kado-search', deps.auditLogger, keyId, request, perm.error.gate);
			return mapError(perm.error);
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
				const filtered = filterResultsByScope(searchResult.items, keyId, config);
				searchResult = {...searchResult, items: filtered, total: filtered.length};
			}

			await logAllowed('kado-search', deps.auditLogger, keyId, request, startMs);
			return mapSearchResult(searchResult);
		} catch (err: unknown) {
			kadoLog('kado-search error', {...debugFields(keyId, request), code: 'INTERNAL_ERROR'});
			return mapError({code: 'INTERNAL_ERROR', message: String(err)});
		}
	});
}

function registerOpenNotesTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-open-notes', {
		description: 'List currently open Obsidian notes. Gated by per-key feature flags (allowActiveNote, allowOtherNotes) and path ACL. Read-only — does not modify workspace state. Returns { notes: [{ name, path, active, type }] }. Returns FORBIDDEN with gate="feature-gate" when the requested scope is disabled by either the global or key flag; returns an empty list when no permitted files are open or all are silently filtered by the path ACL.',
		inputSchema: kadoOpenNotesShape,
	}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		const config = deps.configManager.getConfig();

		// M6: run authenticate gate the same way as other tools
		const authResult = authenticateGate.evaluate(
			{apiKeyId: keyId, operation: 'note', path: ''} as CoreRequest,
			config,
		);
		if (!authResult.allowed) return mapError(authResult.error);

		// key is guaranteed to exist and be enabled after auth gate
		const key = config.apiKeys.find((k) => k.id === keyId)!;

		const req = mapOpenNotesRequest(args as Record<string, unknown>, keyId);
		const gate = gateOpenNoteScope(req.scope, config.security, key);
		if (gate.kind === 'deny') {
			await logDenied('kado-open-notes', deps.auditLogger, keyId, req, 'feature-gate');
			return mapError(gate.error);
		}

		const startMs = performance.now();
		try {
			const all = enumerateOpenNotes(deps.app);
			const byScope = pruneToScopeKind(all, gate.kind);
			const permitted = filterDescriptorsByAcl(byScope, key, config);
			await logAllowed('kado-open-notes', deps.auditLogger, keyId, req, startMs, {permittedCount: permitted.length});
			return mapOpenNotesResult({notes: permitted});
		} catch (err: unknown) {
			// M7: static message to avoid leaking internal details; raw error logged below
			kadoLog('kado-open-notes error', {key: truncateKeyId(keyId), code: 'INTERNAL_ERROR', err: String(err)});
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
		}
	});
}
