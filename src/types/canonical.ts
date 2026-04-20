/**
 * Canonical internal type definitions for Kado.
 *
 * This file is the single source of truth for all request, result, error,
 * permission-gate, and configuration types used across the four-layer
 * architecture. It has ZERO imports from `obsidian` or
 * `@modelcontextprotocol/sdk` so that the Kado Core can be tested in
 * isolation without either dependency.
 */

// ============================================================
// Data Types
// ============================================================

/** The four data types Kado can read/write through the vault. */
export type DataType = 'note' | 'frontmatter' | 'file' | 'dataview-inline-field';

/**
 * Operations supported by kado-read. Extends DataType with 'tags' — a read-only
 * operation returning the union of frontmatter + inline body tags for a note.
 * Writes and deletes never accept 'tags'.
 */
export type ReadDataType = DataType | 'tags';

/** Data types supported by kado-delete. Inline fields are intentionally excluded. */
export type DeleteDataType = 'note' | 'frontmatter' | 'file';

export type CrudOperation = 'create' | 'read' | 'update' | 'delete';

/** Supported search operation identifiers for CoreSearchRequest. */
export type SearchOperation = 'byTag' | 'byName' | 'listDir' | 'listTags' | 'byContent' | 'byFrontmatter';

// ============================================================
// Core Requests
// ============================================================

/** Request to read a single vault item (note, frontmatter, file, inline field, or tags). */
export interface CoreReadRequest {
	apiKeyId: string;
	operation: ReadDataType;
	path: string;
	/** Populated by permission-chain entry. Gates should prefer this over config lookup (M6). */
	resolvedKey?: ApiKeyConfig;
	/**
	 * Set by DataTypePermissionGate for operation='tags':
	 * - 'all' when note.read is granted (full frontmatter + inline result)
	 * - 'frontmatter-only' when only frontmatter.read is granted (inline omitted)
	 */
	tagsReturnScope?: 'all' | 'frontmatter-only';
}

/** Request to create or update a vault item. Includes optional concurrency guard. */
export interface CoreWriteRequest {
	apiKeyId: string;
	operation: DataType;
	path: string;
	content: string | ArrayBuffer | Record<string, unknown>;
	expectedModified?: number;
	/** Populated by permission-chain entry. Gates should prefer this over config lookup (M6). */
	resolvedKey?: ApiKeyConfig;
}

/** Universal cross-operation filter for search requests. */
export interface SearchFilter {
	/** Folder prefix — only items whose path starts with this value. */
	path?: string;
	/** Tag filter — item must carry at least one matching tag. Glob support (* / ?). */
	tags?: string[];
	/** Frontmatter filter — key=value or key-only, same syntax as byFrontmatter query. */
	frontmatter?: string;
}

/** Request to search the vault by tag, name, content, frontmatter, or directory listing. */
export interface CoreSearchRequest {
	apiKeyId: string;
	operation: SearchOperation;
	query?: string;
	/** Folder path for listDir only. */
	path?: string;
	cursor?: string;
	limit?: number;
	depth?: number;
	filter?: SearchFilter;
	/** Glob patterns for file-level scope filtering (set by tools layer from key config). */
	scopePatterns?: string[];
	/** Permitted tag patterns for tag-based operations (set by tools layer from key config). */
	allowedTags?: string[];
	/** Populated by permission-chain entry. Gates should prefer this over config lookup (M6). */
	resolvedKey?: ApiKeyConfig;
}

/**
 * Request to delete a vault item (trash note/file) or remove frontmatter keys.
 * `expectedModified` is always required for optimistic concurrency.
 * `keys` is required when `operation='frontmatter'`.
 */
export interface CoreDeleteRequest {
	/** Explicit discriminator — CoreDeleteRequest shares DataType with read, so a marker is needed. */
	kind: 'delete';
	apiKeyId: string;
	operation: DeleteDataType;
	path: string;
	expectedModified: number;
	/** Frontmatter keys to remove (via `delete fm[key]`). Required for operation='frontmatter'. */
	keys?: string[];
	/** Populated by permission-chain entry. Gates should prefer this over config lookup (M6). */
	resolvedKey?: ApiKeyConfig;
}

/** Result of a delete operation. `modified` only set for frontmatter (file still exists). */
export interface CoreDeleteResult {
	path: string;
	/** New mtime after frontmatter key removal. Omitted for note/file trash (file gone). */
	modified?: number;
}

/** Union of all core request types flowing through the permission chain. */
export type CoreRequest = CoreReadRequest | CoreWriteRequest | CoreSearchRequest | CoreDeleteRequest;

// ============================================================
// Open Notes Requests and Results
// ============================================================

/** Which category of open notes to enumerate. 'all' means both active and other. */
export type OpenNotesScope = 'active' | 'other' | 'all';

/** Request to enumerate currently open notes in the Obsidian workspace. */
export interface CoreOpenNotesRequest {
	/** Explicit discriminator for the open-notes request type. */
	kind: 'openNotes';
	keyId: string;
	/** 'all' is the default applied by the request-mapper when not specified. */
	scope: OpenNotesScope;
}

/**
 * View type of an open note.
 * Known values: 'markdown', 'canvas', 'pdf', 'image'. Unknown types pass through as-is.
 */
export type OpenNoteType = string;

/** Descriptor for a single open note leaf in the workspace. */
export interface OpenNoteDescriptor {
	/** Obsidian basename (filename without vault path). */
	name: string;
	/** Vault-relative path. */
	path: string;
	/** True when this note is the currently focused leaf. */
	active: boolean;
	type: OpenNoteType;
}

/** Result of an open-notes enumeration. */
export interface CoreOpenNotesResult {
	notes: OpenNoteDescriptor[];
}

// ============================================================
// Core Results
// ============================================================

/** Result of a read operation, containing file content and metadata. */
export interface CoreFileResult {
	path: string;
	content: string | ArrayBuffer | Record<string, unknown>;
	created: number;
	modified: number;
	size: number;
}

/** Result of a write operation, containing path and updated timestamps. */
export interface CoreWriteResult {
	path: string;
	created: number;
	modified: number;
}

/** A single item in a search result set. */
export interface CoreSearchItem {
	path: string;
	name: string;
	created: number;
	modified: number;
	size: number;
	tags?: string[];
	frontmatter?: Record<string, unknown>;
	type?: 'file' | 'folder';
	childCount?: number;
}

/** Paginated search result with optional cursor for the next page. */
export interface CoreSearchResult {
	items: CoreSearchItem[];
	cursor?: string;
	total?: number;
}

// ============================================================
// Errors
// ============================================================

/** Standard error codes returned by the core pipeline. */
export type CoreErrorCode =
	| 'UNAUTHORIZED'
	| 'FORBIDDEN'
	| 'NOT_FOUND'
	| 'CONFLICT'
	| 'VALIDATION_ERROR'
	| 'INTERNAL_ERROR';

/** Structured error returned by core operations and permission gates. */
export interface CoreError {
	code: CoreErrorCode;
	message: string;
	gate?: string;
}

// ============================================================
// Permission Gate
// ============================================================

/** Outcome of a permission gate evaluation: allowed or denied with error details. */
export type GateResult =
	| { allowed: true }
	| { allowed: false; error: CoreError };

/** A single step in the permission chain that can allow or deny a request. */
export interface PermissionGate {
	name: string;
	evaluate(request: CoreRequest, config: KadoConfig): GateResult;
}

// ============================================================
// Configuration Types
// ============================================================

/** Boolean flags for each CRUD operation on a data type. */
export interface CrudFlags {
	create: boolean;
	read: boolean;
	update: boolean;
	/** Reserved for future kado-delete tool. Currently not reachable via any MCP tool. */
	delete: boolean;
}

/** CRUD permission flags for each of the four data types. */
export interface DataTypePermissions {
	note: CrudFlags;
	frontmatter: CrudFlags;
	file: CrudFlags;
	dataviewInlineField: CrudFlags;
}

/** Whether listed paths are explicitly allowed or explicitly blocked. */
export type ListMode = 'whitelist' | 'blacklist';

/** A single path rule with its own permission set. */
export interface PathPermission {
	path: string;
	permissions: DataTypePermissions;
}

/** Global security scope — single flat scope replacing the old multi-area model. */
export interface SecurityConfig {
	/** Whether listed items are allowed (whitelist) or blocked (blacklist). Default: 'whitelist'. */
	listMode: ListMode;
	/** Paths with per-path permissions. */
	paths: PathPermission[];
	/** Tags for read-only filtering, stored without '#'. */
	tags: string[];
	/** Whether the open-notes tool may return the currently active note. Default: false (applied by config-manager on load). */
	allowActiveNote?: boolean;
	/** Whether the open-notes tool may return non-active open notes. Default: false (applied by config-manager on load). */
	allowOtherNotes?: boolean;
}

/** Configuration for a single API key including its independent scope and permissions. */
export interface ApiKeyConfig {
	id: string;
	label: string;
	enabled: boolean;
	createdAt: number;
	/** Independent whitelist/blacklist toggle for this key. */
	listMode: ListMode;
	/** Paths with per-path permissions, constrained by global security. */
	paths: PathPermission[];
	/** Subset of global security tags this key can use. */
	tags: string[];
	/** Whether this key may receive the active note via open-notes. Default: false. Applied as AND with global. */
	allowActiveNote?: boolean;
	/** Whether this key may receive non-active notes via open-notes. Default: false. Applied as AND with global. */
	allowOtherNotes?: boolean;
}

/** Whether the MCP server binds to localhost or a public network interface. */
export type ConnectionType = 'local' | 'public';

/** MCP HTTP server configuration (host, port, connection type). */
export interface ServerConfig {
	enabled: boolean;
	host: string;
	port: number;
	/** Whether server binds locally or to a public interface. Default: 'local'. */
	connectionType: ConnectionType;
}

/** Configuration for the NDJSON audit log (rotation, size limits, file location). */
export interface AuditConfig {
	enabled: boolean;
	/** Vault-relative directory for audit log. Default: 'logs'. */
	logDirectory: string;
	/** Log file name. Default: 'kado-audit.log'. */
	logFileName: string;
	maxSizeBytes: number;
	/** Number of rotated log files to keep. Default: 3. */
	maxRetainedLogs: number;
}

/** Top-level plugin configuration combining server, security, API keys, and audit settings. */
export interface KadoConfig {
	server: ServerConfig;
	security: SecurityConfig;
	apiKeys: ApiKeyConfig[];
	audit: AuditConfig;
	/** Emit kadoLog debug messages to the developer console. Default: false (per Obsidian plugin guidelines). */
	debugLogging: boolean;
}

// ============================================================
// Factory Functions
// ============================================================

/** Returns a CrudFlags object with all operations set to false. */
export function createDefaultCrudFlags(): CrudFlags {
	return {create: false, read: false, update: false, delete: false};
}

/** Returns DataTypePermissions with all CRUD flags set to false for every data type. */
export function createDefaultPermissions(): DataTypePermissions {
	return {
		note: createDefaultCrudFlags(),
		frontmatter: createDefaultCrudFlags(),
		file: createDefaultCrudFlags(),
		dataviewInlineField: createDefaultCrudFlags(),
	};
}

/** Returns a SecurityConfig with whitelist mode, no paths, no tags, and open-notes gating off. */
export function createDefaultSecurityConfig(): SecurityConfig {
	return {
		listMode: 'whitelist',
		paths: [],
		tags: [],
		allowActiveNote: false,
		allowOtherNotes: false,
	};
}

/** Returns a full KadoConfig with safe defaults (server disabled, empty keys, audit on). */
export function createDefaultConfig(): KadoConfig {
	return {
		server: {
			enabled: false,
			host: '127.0.0.1',
			port: 23026,
			connectionType: 'local',
		},
		security: createDefaultSecurityConfig(),
		apiKeys: [],
		audit: {
			enabled: true,
			logDirectory: 'logs',
			logFileName: 'kado-audit.log',
			maxSizeBytes: 10 * 1024 * 1024,
			maxRetainedLogs: 3,
		},
		debugLogging: false,
	};
}

// ============================================================
// Type Guards
// ============================================================

/**
 * Returns true when `req` is a CoreReadRequest.
 * Excludes write (has `content`), delete (has `kind`), and search (SearchOperation).
 */
export function isCoreReadRequest(req: CoreRequest): req is CoreReadRequest {
	return !('content' in req)
		&& !('kind' in req)
		&& isReadDataType((req as CoreReadRequest).operation);
}

/**
 * Returns true when `req` is a CoreWriteRequest.
 * Discriminated by the presence of the `content` field.
 */
export function isCoreWriteRequest(req: CoreRequest): req is CoreWriteRequest {
	return 'content' in req;
}

/**
 * Returns true when `req` is a CoreSearchRequest.
 * Discriminated by the presence of a SearchOperation value on `operation`.
 */
export function isCoreSearchRequest(req: CoreRequest): req is CoreSearchRequest {
	return !('content' in req) && isSearchOperation((req as CoreSearchRequest).operation);
}

/**
 * Returns true when `req` is a CoreDeleteRequest.
 * Discriminated by the explicit `kind: 'delete'` marker.
 */
export function isCoreDeleteRequest(req: CoreRequest): req is CoreDeleteRequest {
	return 'kind' in req && req.kind === 'delete';
}

/**
 * Returns true when `req` is a CoreOpenNotesRequest.
 * Discriminated by the explicit `kind: 'openNotes'` marker.
 */
export function isCoreOpenNotesRequest(req: {kind?: unknown}): req is CoreOpenNotesRequest {
	return 'kind' in req && req.kind === 'openNotes';
}

// ============================================================
// Internal helpers (not exported)
// ============================================================

const READ_DATA_TYPES = new Set<string>(['note', 'frontmatter', 'file', 'dataview-inline-field', 'tags']);
const SEARCH_OPS = new Set<string>(['byTag', 'byName', 'listDir', 'listTags', 'byContent', 'byFrontmatter']);

function isReadDataType(value: string): boolean {
	return READ_DATA_TYPES.has(value);
}

function isSearchOperation(value: string): boolean {
	return SEARCH_OPS.has(value);
}
