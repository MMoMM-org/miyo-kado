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
import {isCoreSearchRequest, isCoreOpenNotesRequest, isCoreWriteRequest, isCoreRenameRequest} from '../types/canonical';
import {evaluatePermissions} from '../core/permission-chain';
import {evaluateRenamePermissions} from '../core/rename-policy';
import {validateConcurrency} from '../core/concurrency-guard';
import {mapFileResult, mapWriteResult, mapSearchResult, mapDeleteResult, mapRenameResult, mapError, mapOpenNotesResult} from './response-mapper';
import {deriveHints} from './hints';
import {mapReadRequest, mapWriteRequest, mapSearchRequest, mapDeleteRequest, mapRenameRequest, mapOpenNotesRequest} from './request-mapper';
import type {
	CoreFileResult,
	CoreWriteResult,
	CoreSearchResult,
	CoreDeleteResult,
	CoreRenameResult,
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
import type {RouteResult} from '../core/operation-router';

// ============================================================
// Public types
// ============================================================

/**
 * A single tool-call activity signal, emitted for every allowed or denied call.
 * Consumed by the status-bar indicator (Layer 5). Carries the full `keyId` so
 * the consumer can resolve it to a human label; deliberately omits the path —
 * that detail belongs in the audit log, not an at-a-glance indicator.
 */
export interface ToolActivityEvent {
	/** The tool that ran, e.g. 'kado-write'. */
	tool: string;
	/** Full API key id (the consumer resolves it to a human label). */
	keyId: string;
	/** Whether the call was allowed or denied. */
	decision: 'allowed' | 'denied';
	/** True for mutating tools (write/delete/rename). */
	mutating: boolean;
	/** Denial gate name, when decision is 'denied'. */
	gate?: string;
}

/** Observer for tool-call activity. Must never throw into the call path. */
export type ToolActivityCallback = (event: ToolActivityEvent) => void;

/** Tools that mutate the vault — drive the more salient write indicator. */
const MUTATING_TOOLS = new Set(['kado-write', 'kado-delete', 'kado-rename']);

/** Dependencies injected into the MCP tool handlers. */
export interface ToolDependencies {
	configManager: ConfigManager;
	gates: PermissionGate[];
	router: (request: CoreRequest) => Promise<RouteResult>;
	getFileMtime: (path: string) => number | undefined;
	auditLogger?: AuditLogger;
	/**
	 * Optional observer notified on every allowed/denied tool call, independent
	 * of whether audit logging is enabled. Drives the status-bar indicator.
	 */
	onActivity?: ToolActivityCallback;
	/** Obsidian App instance — required by the kado-open-notes tool handler. */
	app: App;
	/**
	 * Whether to register the kado-rename tool. Computed at server-build time as
	 * (Obsidian alwaysUpdateLinks) OR (config.renameWhenLinkUpdateOff). When false,
	 * kado-rename is not registered at all — renaming with auto-update-links off would
	 * block on Obsidian's confirmation modal. Defaults to true when omitted (tests).
	 */
	renameToolEnabled?: boolean;
}

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// ============================================================
// Zod schemas (spec T4.3)
// ============================================================

export const kadoReadShape = {
	operation: z.enum(['note', 'frontmatter', 'file', 'dataview-inline-field', 'tags']).describe('What to read. Extension-strict: note/frontmatter/dataview-inline-field/tags require a .md path; file requires a non-.md path. note = full markdown body. frontmatter = YAML metadata as JSON object. dataview-inline-field = inline "key:: value" fields as JSON. tags = frontmatter + inline tags as JSON (requires note.read OR frontmatter.read; with only frontmatter.read, inline tags are omitted and returnedTags="FrontmatterOnly"). file = raw bytes returned as base64 (use for .json/.pdf/.png/…).'),
	path: z.string().describe('Vault-relative path, e.g. "Calendar/2026-03-31.md" for markdown operations or "Attachments/diagram.png" for file.'),
	mode: z.enum(['firstXChars', 'section', 'range']).optional().describe('Partial-read mode for operation="note". Absent ⇒ full read. firstXChars: return the first `limit` Unicode code points of the body. section: return the content under a specific heading (use `heading` for first-match text, or `headingPath` for H1>H2 path). range: return a slice defined by `rangeBasis`, `start`, and `end` (line: 1-based start, inclusive end; char: 0-based start, exclusive end — ADR-4).'),
	limit: z.number().int().positive().max(1_000_000_000).optional().describe('Number of Unicode code points to return. Required for mode=firstXChars. Ignored for other modes.'),
	heading: z.string().optional().describe('Heading text to target (first match in the note). Used with mode=section. Mutually exclusive with headingPath — supply one or the other.'),
	headingPath: z.array(z.string()).max(50).optional().describe('Hierarchical heading path, e.g. ["Chapter 1", "Section A"], for precise disambiguation. Used with mode=section. Mutually exclusive with heading.'),
	rangeBasis: z.enum(['line', 'char']).optional().describe('Unit for `start` and `end`. Required for mode=range. line: start is 1-based, end is inclusive. char: start is 0-based (Unicode code points), end is exclusive. See ADR-4.'),
	start: z.number().int().nonnegative().max(1_000_000_000).optional().describe('Start of the range. For rangeBasis=line: 1-based line number (inclusive). For rangeBasis=char: 0-based code-point offset (inclusive). Required for mode=range.'),
	end: z.number().int().nonnegative().max(1_000_000_000).optional().describe('End of the range. For rangeBasis=line: line number (inclusive). For rangeBasis=char: code-point offset (exclusive). Required for mode=range.'),
};

export const kadoWriteShape = {
	operation: z.enum(['note', 'frontmatter', 'file', 'dataview-inline-field']).describe('What to write. Extension-strict: note/frontmatter/dataview-inline-field require a .md path; file requires a non-.md path (mismatches return VALIDATION_ERROR). note = full markdown body (string). frontmatter = YAML metadata (JSON object). dataview-inline-field = inline "key:: value" fields (JSON object). file = raw bytes as a base64 string, for any non-markdown file (.json/.pdf/.png/…).'),
	path: z.string().describe('Vault-relative path. Must end in ".md" for note/frontmatter/dataview-inline-field (e.g. "100 Inbox/new-note.md"); must NOT end in ".md" for file (e.g. "100 Inbox/data.json").'),
	content: z.unknown().describe('The content to write. String (markdown body) for note; JSON object for frontmatter and dataview-inline-field; base64-encoded string for file. For partial note writes (append/prepend/insertUnderHeading/replaceSection/replaceRange), this is the text to add or use as replacement.'),
	expectedModified: z.number().optional().describe('Required for updates to existing files. Set to the "modified" timestamp from a prior read. Omit only when creating a new file. Required for insertUnderHeading/replaceSection/replaceRange (ADR-5). Optional for append/prepend (lock-free operations).'),
	mode: z.enum(['merge', 'replace', 'append', 'prepend', 'insertUnderHeading', 'replaceSection', 'replaceRange']).optional().describe('Write mode. For operation="frontmatter": "merge" (default) deep-merges supplied keys with existing frontmatter (objects recurse, arrays REPLACE, scalars replace; untouched keys preserved); "replace" clears the existing block and writes the supplied object as-is; body is byte-identical in both modes. For operation="note": "append" adds content after the last line (lock-free, expectedModified optional); "prepend" inserts content before the first line (lock-free, expectedModified optional); "insertUnderHeading" appends content under the matched heading (requires expectedModified, use `heading` or `headingPath` — ADR-5); "replaceSection" replaces all content under the matched heading (requires expectedModified); "replaceRange" replaces a line or character range (requires expectedModified, `rangeBasis`, `start`, `end` — ADR-4).'),
	heading: z.string().optional().describe('Heading text to target (first match in the note). Used with mode=insertUnderHeading or mode=replaceSection. Mutually exclusive with headingPath — supply one or the other.'),
	headingPath: z.array(z.string()).max(50).optional().describe('Hierarchical heading path, e.g. ["Chapter 1", "Section A"], for precise disambiguation. Used with mode=insertUnderHeading or mode=replaceSection. Mutually exclusive with heading.'),
	rangeBasis: z.enum(['line', 'char']).optional().describe('Unit for `start` and `end`. Required for mode=replaceRange. line: start is 1-based, end is inclusive. char: start is 0-based (Unicode code points), end is exclusive. See ADR-4.'),
	start: z.number().int().nonnegative().max(1_000_000_000).optional().describe('Start of the range to replace. For rangeBasis=line: 1-based line number (inclusive). For rangeBasis=char: 0-based code-point offset (inclusive). Required for mode=replaceRange.'),
	end: z.number().int().nonnegative().max(1_000_000_000).optional().describe('End of the range to replace. For rangeBasis=line: line number (inclusive). For rangeBasis=char: code-point offset (exclusive). Required for mode=replaceRange.'),
};

const kadoDeleteShape = {
	// Accept all 4 DataType values at the SDK boundary; mapDeleteRequest rejects
	// 'dataview-inline-field' with a canonical VALIDATION_ERROR the client can parse.
	operation: z.enum(['note', 'frontmatter', 'file', 'dataview-inline-field']).describe('What to delete. Extension-strict: note/frontmatter require a .md path; file requires a non-.md path (mismatches return VALIDATION_ERROR). note = trash the markdown file. file = trash a non-markdown file. frontmatter = remove specific keys from a markdown file\'s YAML. dataview-inline-field is NOT supported and returns VALIDATION_ERROR.'),
	path: z.string().describe('Vault-relative path. .md for note/frontmatter, non-.md for file.'),
	expectedModified: z.number().describe('Required. The "modified" timestamp from a prior read. CONFLICT if the file changed since.'),
	keys: z.array(z.string()).optional().describe('Required for operation="frontmatter": non-empty array of frontmatter keys to remove. Ignored for note/file.'),
};

const kadoRenameShape = {
	operation: z.enum(['note', 'file']).describe('What to move. Extension-strict: note requires .md paths; file requires non-.md paths. Both source and target must share the same extension class — a rename can never change a file\'s type (mismatches return VALIDATION_ERROR).'),
	source: z.string().describe('Current vault-relative path of the file to move, e.g. "100 Inbox/draft.md".'),
	target: z.string().describe('Desired vault-relative path, e.g. "100 Inbox/final.md" (rename) or "200 Notes/final.md" (move). Must not already exist — returns CONFLICT otherwise.'),
	expectedModified: z.number().describe('Required. The "modified" timestamp from a prior read of the SOURCE file. Returns CONFLICT if the source changed since.'),
};

export const kadoOpenNotesShape = {
	scope: z.enum(['active', 'other', 'all']).optional().describe(
		'Which open notes to enumerate: "active" (focused leaf only), "other" (non-active open notes), "all" (default, both active and other)',
	),
};

export const kadoSearchShape = {
	operation: z.enum(['byTag', 'byName', 'listDir', 'listTags', 'byContent', 'byFrontmatter', 'listNotes']).describe('Search operation type'),
	query: z.string().optional().describe('Search query. Required for all operations except listDir, listTags, and listNotes. Supports * and ? glob wildcards for byName and byTag.'),
	path: z.string().optional().describe('Folder walk root for listDir and listNotes. "/" is the canonical vault-root marker; trailing slashes are accepted; non-existent paths return NOT_FOUND; paths pointing to a file return VALIDATION_ERROR; empty string is rejected.'),
	cursor: z.string().optional().describe('Pagination cursor from a previous response'),
	limit: z.number().int().min(1).max(500).optional().describe('Max items per page (default 50, max 500)'),
	depth: z.number().int().positive().optional().describe('Walk depth for listDir and listNotes. Omit for unlimited recursion. depth=1 returns only direct children. Invalid values (0, negative, non-integer) return VALIDATION_ERROR.'),
	fields: z.array(z.enum(['links', 'headings', 'tags'])).optional().describe('listNotes projection — body-derived metadata to include per note, sourced from the metadata cache (no body read): links (outlinks, raw [[target]] and ![[embed]] strings as written — may point outside this key\'s scope, they are source-note content and are never resolved), headings ({heading, level} outline), tags (inline + frontmatter, deduped). Omit for none (path + timestamps only). Ignored by other operations.'),
	filter: z.object({
		path: z.string().optional().describe('Folder prefix filter — only items whose path starts with this value. Works with all operations.'),
		tags: z.array(z.string()).optional().describe('Tag filter — item must carry at least one matching tag. Supports * and ? glob wildcards. Ignored by listDir.'),
		frontmatter: z.string().optional().describe('Frontmatter filter — key=value (match value) or key-only (key exists). Dot-notation traverses nested keys (e.g. "tomo.state=pending-approval"). Same syntax as byFrontmatter query. Ignored by listDir.'),
		modifiedAfter: z.number().int().nonnegative().optional().describe('Inclusive lower bound on file mtime (Unix milliseconds). Drops folder items. Combine with modifiedBefore for a range; use Date.now() - 7*86400000 for "last 7 days".'),
		modifiedBefore: z.number().int().nonnegative().optional().describe('Inclusive upper bound on file mtime (Unix milliseconds). Drops folder items.'),
		createdAfter: z.number().int().nonnegative().optional().describe('Inclusive lower bound on file ctime (Unix milliseconds). Drops folder items.'),
		createdBefore: z.number().int().nonnegative().optional().describe('Inclusive upper bound on file ctime (Unix milliseconds). Drops folder items.'),
	}).optional().describe('Universal cross-operation filters to narrow results. All filters are AND-combined.'),
};

export const KADO_SEARCH_TOOL_DESCRIPTION =
	'Search the Obsidian vault. Operations: ' +
	'byName (substring or glob e.g. "2026-03-*"), ' +
	'byTag (exact or glob e.g. "#project/*"), ' +
	'byContent (full-text body search — matches notes containing any query term, ranked by relevance; each result carries a "score" and "snippets" {text, line} of the matching passages, sorted best-first), ' +
	'byFrontmatter (key=value or key-only; dot-notation traverses nested keys e.g. "tomo.state=pending-approval"), ' +
	'listDir (folder contents with type: "file" | "folder" discriminator; folder items carry childCount; results sort folders-first then alphabetically; use depth=1 for a shallow scan of direct children only, omit depth for unlimited recursion; "/" is the canonical vault-root marker; missing paths return NOT_FOUND, file targets return VALIDATION_ERROR), ' +
	'listTags (all permitted tags with counts), ' +
	'listNotes (notes-only metadata index — like listDir but markdown notes only, no folders; path + depth select the subtree, filter narrows within it; optional "fields" projection adds outlinks, headings, and tags from the metadata cache without reading note bodies). ' +
	'Optional "filter" narrows any operation: filter.path (folder prefix), filter.tags (note must have at least one matching tag, glob-capable), filter.frontmatter (key=value or key-only; dot-notation traverses nested keys), filter.modifiedAfter / filter.modifiedBefore / filter.createdAfter / filter.createdBefore (Unix-ms time bounds, inclusive; folder items are dropped when any time bound is set). Filters are AND-combined. filter.tags and filter.frontmatter are ignored by listDir; time filters apply to listDir file items. ' +
	'Results are scoped to this key\'s permissions and paginated (default 50, max 500). ' +
	'Hidden entries (names starting with ".") are never returned.';

// ============================================================
// Helpers
// ============================================================

function isCoreError(value: RouteResult): value is CoreError {
	return 'code' in value && 'message' in value && !('content' in value) && !('items' in value);
}

/** Sentinel returned by raceWithTimeout when the work did not settle in time. */
const TIMED_OUT = Symbol('timed-out');

/**
 * Races `work` against a timer. Resolves to the work's value, or `TIMED_OUT` if the
 * timer wins. A rejection from `work` propagates (so adapter errors still surface).
 * On timeout the caller must attach a no-op catch to `work` to avoid an unhandled
 * rejection if it settles later (e.g. after the user dismisses a blocking modal).
 */
async function raceWithTimeout(work: Promise<RouteResult>, timeoutMs: number): Promise<RouteResult | typeof TIMED_OUT> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
		timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
	});
	try {
		return await Promise.race([work, timeout]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
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

/** Notifies the activity observer, swallowing any error so UI never breaks a tool call. */
function emitActivity(deps: ToolDependencies, tool: string, keyId: string, decision: 'allowed' | 'denied', gate?: string): void {
	if (!deps.onActivity) return;
	try {
		deps.onActivity({tool, keyId, decision, mutating: MUTATING_TOOLS.has(tool), gate});
	} catch {
		// Activity observer must never crash a tool call.
	}
}

async function logAllowed(
	tool: string,
	deps: ToolDependencies,
	keyId: string,
	request: CoreRequest | CoreOpenNotesRequest,
	startHrMs: number,
	extra?: {permittedCount?: number},
): Promise<void> {
	emitActivity(deps, tool, keyId, 'allowed');
	const auditLogger = deps.auditLogger;
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
	if (isCoreRenameRequest(coreReq)) {
		// Rename has no single `path`/`dataType`, so it bypasses debugFields/extractDataType:
		// path=source, query=target (auditors derive rename-vs-move from the two folders),
		// dataType=operation ('note'|'file').
		kadoLog(`${tool} allowed`, {key: truncateKeyId(keyId), operation: coreReq.operation, source: coreReq.source, target: coreReq.target, durationMs});
		if (!auditLogger) return;
		try {
			await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation: coreReq.operation, dataType: coreReq.operation, path: coreReq.source, query: coreReq.target, decision: 'allowed', durationMs}));
		} catch { /* audit logging must never crash a tool call */ }
		return;
	}
	kadoLog(`${tool} allowed`, {...debugFields(keyId, coreReq), durationMs});
	if (!auditLogger) return;
	try {
		const path = 'path' in coreReq ? (coreReq.path as string) : undefined;
		const query = 'query' in coreReq ? (coreReq.query as string) : undefined;
		const operation = String(coreReq.operation ?? '');
		const dataType = extractDataType(coreReq);
		// Partial note write: body is touched, record the mode for auditors.
		// Frontmatter write: body is preserved byte-identical, so bodyTouched=false.
		// All other ops (full note write, reads): leave both fields absent.
		const isWrite = isCoreWriteRequest(coreReq);
		const bodyTouched = isWrite && coreReq.operation === 'frontmatter' ? false
			: isWrite && coreReq.operation === 'note' && coreReq.notePartial !== undefined ? true
			: undefined;
		const mode = isWrite && coreReq.operation === 'note' && coreReq.notePartial !== undefined
			? coreReq.notePartial.mode
			: undefined;
		await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation, dataType, path, query, decision: 'allowed', durationMs, bodyTouched, mode}));
	} catch {
		// Audit logging must never crash a tool call — log failure is non-fatal
	}
}

async function logDenied(
	tool: string,
	deps: ToolDependencies,
	keyId: string,
	request: CoreRequest | CoreOpenNotesRequest,
	gate: string | undefined,
): Promise<void> {
	emitActivity(deps, tool, keyId, 'denied', gate);
	const auditLogger = deps.auditLogger;
	if (isCoreOpenNotesRequest(request as {kind?: unknown})) {
		kadoLog(`${tool} denied`, {key: truncateKeyId(keyId), scope: (request as CoreOpenNotesRequest).scope, gate});
		if (!auditLogger) return;
		try {
			await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation: 'openNotes', query: (request as CoreOpenNotesRequest).scope, decision: 'denied', gate}));
		} catch { /* audit logging must never crash a tool call */ }
		return;
	}
	const coreReq = request as CoreRequest;
	if (isCoreRenameRequest(coreReq)) {
		kadoLog(`${tool} denied`, {key: truncateKeyId(keyId), operation: coreReq.operation, source: coreReq.source, target: coreReq.target, gate});
		if (!auditLogger) return;
		try {
			await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation: coreReq.operation, dataType: coreReq.operation, path: coreReq.source, query: coreReq.target, decision: 'denied', gate}));
		} catch { /* audit logging must never crash a tool call */ }
		return;
	}
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
	// Only register rename when it is safe: Obsidian's auto-update-links is on, or the
	// user explicitly opted in. Otherwise renameFile would block on a confirmation modal.
	if (deps.renameToolEnabled !== false) {
		registerRenameTool(server, deps);
	}
	registerOpenNotesTool(server, deps);
}

// ============================================================
// Tool handlers (each under 20 lines)
// ============================================================

function registerReadTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-read', {description: 'Read from the Obsidian vault. Strict extension separation: operation "note" / "frontmatter" / "dataview-inline-field" / "tags" only accept .md paths; operation "file" is for any non-markdown file (.json, .pdf, .png, …) and returns base64. Returns content + created/modified/size metadata. Use the "modified" timestamp from the response as expectedModified when writing updates. Op-symmetry rule: pair the read op with the matching write op to minimise payload — read=frontmatter before write=frontmatter (body-free both directions), read=note only when you actually need the body. For listing/filtering by mtime or frontmatter without loading content at all, use kado-search instead (results carry path/created/modified/size/tags/frontmatter without reading files). operation="tags" returns {frontmatter: string[], inline: string[], all: string[], returnedTags: "All" | "FrontmatterOnly"} — tags deduplicated, no leading "#". When the key has only frontmatter.read (no note.read), inline tags are omitted and returnedTags="FrontmatterOnly" signals that additional inline tags may exist but require note.read.', inputSchema: kadoReadShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		let request;
		try {
			request = mapReadRequest(args as Record<string, unknown>, keyId);
		} catch (err: unknown) {
			return mapError({code: 'VALIDATION_ERROR', message: String((err as Error).message ?? err)});
		}
		const perm = evaluatePermissions(request, deps.configManager.getConfig(), deps.gates);
		if (!perm.allowed) {
			await logDenied('kado-read', deps, keyId, request, perm.error.gate);
			return mapError(perm.error, deriveHints({tool: 'kado-read', request, error: perm.error}));
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
				const error: CoreError = {code: code as CoreError['code'], message: asError.message ?? String(err)};
				return mapError(error, deriveHints({tool: 'kado-read', request, error}));
			}
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
		}
	});
}

function registerWriteTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-write', {description: 'Write to the Obsidian vault. Strict extension separation — pick the operation that matches the target path: operation="note" writes a full markdown body (path MUST end in .md); operation="frontmatter" writes a YAML frontmatter object onto a markdown file (.md only); operation="dataview-inline-field" writes Dataview inline "key:: value" fields onto a markdown file (.md only); operation="file" writes raw bytes via base64 for any NON-markdown file (.json, .pdf, .png, …) and REJECTS .md paths. Mismatched combinations (e.g. operation="note" with a .json path, or operation="file" with a .md path) return VALIDATION_ERROR — switch to the correct operation rather than renaming the file. To CREATE a new file: omit expectedModified. To UPDATE an existing file: first read it with kado-read and pass the "modified" value as expectedModified. Op-symmetry rule: use the matching read op for the body-cheapest path — kado-read operation=frontmatter before write operation=frontmatter (metadata-only both directions, no body transfer), kado-read operation=note only when the write needs the full body. Returns CONFLICT if the file changed since your read. For operation="frontmatter" the body is never touched — only the YAML block changes; use mode="merge" (default) to deep-merge supplied keys with existing frontmatter (objects recurse, arrays REPLACE, scalars replace, untouched keys preserved) or mode="replace" to clear the existing block and write the supplied object as-is.', inputSchema: kadoWriteShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		let request;
		try {
			request = mapWriteRequest(args as Record<string, unknown>, keyId);
		} catch (err: unknown) {
			return mapError({code: 'VALIDATION_ERROR', message: String((err as Error).message ?? err)});
		}
		const perm = evaluatePermissions(request, deps.configManager.getConfig(), deps.gates);
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
				const error: CoreError = {code: code as CoreError['code'], message: asError.message ?? String(err)};
				return mapError(error, deriveHints({tool: 'kado-write', request, error}));
			}
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
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
			await logDenied('kado-delete', deps, keyId, request, perm.error.gate);
			return mapError(perm.error, deriveHints({tool: 'kado-delete', request, error: perm.error}));
		}

		const concurrency = validateConcurrency(request, deps.getFileMtime(request.path));
		if (!concurrency.allowed) {
			kadoLog('kado-delete error', {...debugFields(keyId, request), code: concurrency.error.code});
			return mapError(concurrency.error, deriveHints({tool: 'kado-delete', request, error: concurrency.error}));
		}

		const startMs = performance.now();
		try {
			const result = await deps.router(request);
			if (isCoreError(result)) {
				kadoLog('kado-delete error', {...debugFields(keyId, request), code: result.code});
				return mapError(result, deriveHints({tool: 'kado-delete', request, error: result}));
			}
			await logAllowed('kado-delete', deps, keyId, request, startMs);
			return mapDeleteResult(result as CoreDeleteResult);
		} catch (err: unknown) {
			// Adapters throw DeleteAdapterError with a `code` field — propagate it as the canonical error
			const asError = err as {code?: string; message?: string};
			const code = (asError.code === 'NOT_FOUND' || asError.code === 'VALIDATION_ERROR') ? asError.code : 'INTERNAL_ERROR';
			kadoLog('kado-delete error', {...debugFields(keyId, request), code, err: String(err)});
			if (code !== 'INTERNAL_ERROR') {
				const error: CoreError = {code: code as CoreError['code'], message: asError.message ?? String(err)};
				return mapError(error, deriveHints({tool: 'kado-delete', request, error}));
			}
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
		}
	});
}

function registerRenameTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-rename', {description: 'Rename or move a file in the Obsidian vault (operation=note for .md, operation=file for non-.md). Inbound links (`[[wikilinks]]` and markdown links) are updated automatically when Obsidian\'s "Automatically update internal links" is on. Rename = same folder, different name; move = different folder. Permissions: a rename needs note/file UPDATE on the path; a move needs DELETE on the source folder AND CREATE on the target folder. Always requires expectedModified — read the source first and pass its "modified" timestamp. Returns CONFLICT if the source changed or the target already exists, NOT_FOUND if the source is missing, VALIDATION_ERROR on bad/mismatched paths. If "Automatically update internal links" is OFF, Obsidian shows a per-rename confirmation dialog: the file is still moved immediately, but the response may include "linkUpdatePending": true meaning inbound links await the user\'s answer — do NOT retry in that case (the rename already happened). A bare TIMEOUT (no move) is only returned if the file did not move at all.', inputSchema: kadoRenameShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		let request;
		try {
			request = mapRenameRequest(args as Record<string, unknown>, keyId);
		} catch (err: unknown) {
			return mapError({code: 'VALIDATION_ERROR', message: String((err as Error).message ?? err)});
		}

		const {result: perm} = evaluateRenamePermissions(request, deps.configManager.getConfig(), deps.gates);
		if (!perm.allowed) {
			await logDenied('kado-rename', deps, keyId, request, perm.error.gate);
			return mapError(perm.error, deriveHints({tool: 'kado-rename', request, error: perm.error}));
		}

		const concurrency = validateConcurrency(request, deps.getFileMtime(request.source));
		if (!concurrency.allowed) {
			kadoLog('kado-rename error', {key: truncateKeyId(keyId), code: concurrency.error.code});
			return mapError(concurrency.error, deriveHints({tool: 'kado-rename', request, error: concurrency.error}));
		}

		const startMs = performance.now();
		try {
			// Guard against a hang: when Obsidian's auto-update-links is off, renameFile
			// blocks on a confirmation modal that an MCP caller cannot answer. Bound the
			// wait and report TIMEOUT instead of leaving the client hanging forever.
			const timeoutMs = deps.configManager.getConfig().renameTimeoutMs;
			const work = deps.router(request);
			const raced = await raceWithTimeout(work, timeoutMs);
			if (raced === TIMED_OUT) {
				work.catch(() => { /* late settle after timeout must not become an unhandled rejection */ });
				// Obsidian moves the file IMMEDIATELY; the "update links?" dialog only gates the
				// inbound-link rewrite (and the promise we were awaiting). So on timeout the rename
				// has almost always already happened — check the vault and report success with
				// linkUpdatePending instead of a misleading failure. Only a genuinely un-moved file
				// (source still present / target absent) is a real TIMEOUT.
				const targetMtime = deps.getFileMtime(request.target);
				const sourceGone = deps.getFileMtime(request.source) === undefined;
				if (targetMtime !== undefined && sourceGone) {
					kadoLog('kado-rename allowed', {key: truncateKeyId(keyId), linkUpdatePending: true});
					await logAllowed('kado-rename', deps, keyId, request, startMs);
					return mapRenameResult({source: request.source, target: request.target, modified: targetMtime, linkUpdatePending: true});
				}
				kadoLog('kado-rename error', {key: truncateKeyId(keyId), code: 'TIMEOUT'});
				await logDenied('kado-rename', deps, keyId, request, 'timeout');
				return mapError({
					code: 'TIMEOUT',
					message: `Rename did not complete within ${timeoutMs} ms and the file was not moved. Obsidian's "Automatically update internal links" setting is likely off, leaving a confirmation dialog blocking the rename. Enable it in Obsidian (Settings → Files and links) for reliable renames.`,
				});
			}
			const result = raced;
			if (isCoreError(result)) {
				kadoLog('kado-rename error', {key: truncateKeyId(keyId), code: result.code});
				return mapError(result, deriveHints({tool: 'kado-rename', request, error: result}));
			}
			await logAllowed('kado-rename', deps, keyId, request, startMs);
			return mapRenameResult(result as CoreRenameResult);
		} catch (err: unknown) {
			// RenameAdapterError carries NOT_FOUND (missing source), CONFLICT (target exists) — surface those.
			const asError = err as {code?: string; message?: string};
			const code = (asError.code === 'CONFLICT' || asError.code === 'NOT_FOUND' || asError.code === 'VALIDATION_ERROR') ? asError.code : 'INTERNAL_ERROR';
			kadoLog('kado-rename error', {key: truncateKeyId(keyId), code, err: String(err)});
			if (code !== 'INTERNAL_ERROR') {
				const error: CoreError = {code: code as CoreError['code'], message: asError.message ?? String(err)};
				return mapError(error, deriveHints({tool: 'kado-rename', request, error}));
			}
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
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
				const filtered = filterResultsByScope(searchResult.items, keyId, config);
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
			await logDenied('kado-open-notes', deps, keyId, req, 'feature-gate');
			return mapError(gate.error);
		}

		const startMs = performance.now();
		try {
			const all = enumerateOpenNotes(deps.app);
			const byScope = pruneToScopeKind(all, gate.kind);
			const permitted = filterDescriptorsByAcl(byScope, key, config);
			await logAllowed('kado-open-notes', deps, keyId, req, startMs, {permittedCount: permitted.length});
			return mapOpenNotesResult({notes: permitted});
		} catch (err: unknown) {
			// M7: static message to avoid leaking internal details; raw error logged below
			kadoLog('kado-open-notes error', {key: truncateKeyId(keyId), code: 'INTERNAL_ERROR', err: String(err)});
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
		}
	});
}
