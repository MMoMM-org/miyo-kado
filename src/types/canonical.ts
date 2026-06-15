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
// Partial Note Read/Write Types (spec 007)
// ============================================================

/** Addressing mode for a partial note read. */
export type NoteReadMode = 'firstXChars' | 'section' | 'range';

/** Addressing mode for a partial note write. */
export type NoteWriteMode =
	| 'append' | 'prepend'
	| 'insertUnderHeading' | 'replaceSection' | 'replaceRange';

/**
 * Heading addressing — text (first match) OR path (H1 > H2 > …).
 * ADR-3: two exclusive discriminated arms, no merging.
 */
export type HeadingTarget =
	| { heading: string }
	| { headingPath: string[] };

/**
 * Range addressing with explicit basis. ADR-4.
 * line: start 1-based, end inclusive.
 * char: start 0-based, end exclusive (code points).
 */
export interface RangeTarget {
	basis: 'line' | 'char';
	start: number;
	end: number;
}

/** Normalized partial-READ descriptor (built by request-mapper from flat args). */
export type NoteReadPartial =
	| { mode: 'firstXChars'; limit: number }
	| ({ mode: 'section' } & HeadingTarget)
	| ({ mode: 'range' } & RangeTarget);

/** Normalized partial-WRITE descriptor. */
export type NoteWritePartial =
	| { mode: 'append' }
	| { mode: 'prepend' }
	| ({ mode: 'insertUnderHeading' } & HeadingTarget)
	| ({ mode: 'replaceSection' } & HeadingTarget)
	| ({ mode: 'replaceRange' } & RangeTarget);

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

/**
 * Data types supported by kado-rename. Rename is a file-level move, so only the
 * two file-backed data types apply — frontmatter and inline fields are intra-file
 * constructs with no path of their own.
 */
export type RenameDataType = 'note' | 'file';

export type CrudOperation = 'create' | 'read' | 'update' | 'delete';

/** Supported search operation identifiers for CoreSearchRequest. */
export type SearchOperation = 'byTag' | 'byName' | 'listDir' | 'listTags' | 'byContent' | 'byFrontmatter' | 'listNotes';

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
	/** Partial-read descriptor. Only honoured for operation='note'. */
	partial?: NoteReadPartial;
}

/** Merge strategy for frontmatter writes. Ignored for other operations. */
export type FrontmatterWriteMode = 'merge' | 'replace';

/** Request to create or update a vault item. Includes optional concurrency guard. */
export interface CoreWriteRequest {
	apiKeyId: string;
	operation: DataType;
	path: string;
	content: string | ArrayBuffer | Record<string, unknown>;
	expectedModified?: number;
	/**
	 * Frontmatter write strategy. Only honoured for operation='frontmatter'.
	 * 'merge' (default): deep-merge supplied keys with existing frontmatter
	 *   (objects recurse, arrays replace, scalars replace). Untouched keys
	 *   are preserved.
	 * 'replace': clear the existing frontmatter block, then write the supplied
	 *   object as-is.
	 */
	mode?: FrontmatterWriteMode;
	/**
	 * Partial-write descriptor for note operations. Only honoured for operation='note'.
	 * Kept separate from `mode` (which remains FrontmatterWriteMode) to avoid field overloading.
	 */
	notePartial?: NoteWritePartial;
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
	/** Inclusive lower bound on file mtime (Unix ms). Excludes folder items (no meaningful mtime). */
	modifiedAfter?: number;
	/** Inclusive upper bound on file mtime (Unix ms). Excludes folder items (no meaningful mtime). */
	modifiedBefore?: number;
	/** Inclusive lower bound on file ctime (Unix ms). Excludes folder items (no meaningful ctime). */
	createdAfter?: number;
	/** Inclusive upper bound on file ctime (Unix ms). Excludes folder items (no meaningful ctime). */
	createdBefore?: number;
}

/** Request to search the vault by tag, name, content, frontmatter, or directory listing. */
export interface CoreSearchRequest {
	apiKeyId: string;
	operation: SearchOperation;
	query?: string;
	/** Folder path — walk root for listDir and listNotes. */
	path?: string;
	cursor?: string;
	limit?: number;
	depth?: number;
	filter?: SearchFilter;
	/**
	 * listNotes projection: which body-derived enrichments to include per item.
	 * Any of 'links', 'headings', 'tags'. Omitted ⇒ none (base stat item only).
	 * Ignored by other operations.
	 */
	fields?: string[];
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

/**
 * Request to rename or move a vault file (note or binary file).
 *
 * Rename vs move is inferred from the paths, not carried as a flag: when source
 * and target share a parent folder it is a rename, otherwise a move. The
 * distinction drives permission gating (rename → note/file update; move →
 * delete on source + create on target) handled by the kado-rename tool, so the
 * request itself stays mode-agnostic.
 *
 * `expectedModified` provides optimistic concurrency on the source file
 * (same semantics as delete). Link updates in other notes are performed by
 * Obsidian's fileManager.renameFile and are intentionally not gated — they
 * rewrite references, never content.
 */
export interface CoreRenameRequest {
	/** Explicit discriminator — CoreRenameRequest carries no `content` so a marker is needed. */
	kind: 'rename';
	apiKeyId: string;
	operation: RenameDataType;
	/** Current vault-relative path of the file to move. */
	source: string;
	/** Desired vault-relative path. Must not already exist. */
	target: string;
	/** Optimistic-concurrency guard against the source file's mtime. */
	expectedModified: number;
	/** Populated by permission-chain entry. Gates should prefer this over config lookup (M6). */
	resolvedKey?: ApiKeyConfig;
}

/** Result of a rename/move operation. `modified` is the source file's mtime (unchanged by a move). */
export interface CoreRenameResult {
	source: string;
	target: string;
	modified: number;
	/**
	 * Set true when the file was renamed on disk but Obsidian is still awaiting the user's
	 * "update links?" confirmation dialog (auto-update-links off): the move is done, inbound
	 * links may not be updated yet. Surfaced so the caller does NOT retry the rename.
	 */
	linkUpdatePending?: boolean;
}

/** Union of all core request types flowing through the permission chain. */
export type CoreRequest = CoreReadRequest | CoreWriteRequest | CoreSearchRequest | CoreDeleteRequest | CoreRenameRequest;

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
	/** Set to true when a partial-read limit was reached and content was cut off. */
	truncated?: boolean;
}

/** Result of a write operation, containing path and updated timestamps. */
export interface CoreWriteResult {
	path: string;
	created: number;
	modified: number;
}

/** A single outlink target as written in a note body. `kind` distinguishes `[[x]]` from `![[x]]`. */
export interface CoreLinkRef {
	/** Raw link target as written (e.g. `Folder/Note`, `Note#heading`). Never resolved to a path. */
	target: string;
	kind: 'link' | 'embed';
}

/** A single heading from a note's outline. */
export interface CoreHeadingRef {
	heading: string;
	level: number;
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
	/**
	 * Outlinks (`cache.links` + `cache.embeds`), raw targets only. Populated by
	 * listNotes when 'links' is in `fields`. Targets are echoed verbatim and may
	 * point outside the key's scope — they are source-note content, never resolved.
	 */
	links?: CoreLinkRef[];
	/** Heading outline. Populated by listNotes when 'headings' is in `fields`. */
	headings?: CoreHeadingRef[];
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
	| 'TIMEOUT'
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
	/**
	 * Reachable via the kado-delete tool for note, file, and frontmatter (key removal).
	 * dataview-inline-field delete is intentionally unsupported — see delete-adapter.ts.
	 */
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
	allowActiveNote: boolean;
	/** Whether the open-notes tool may return non-active open notes. Default: false (applied by config-manager on load). */
	allowOtherNotes: boolean;
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
	allowActiveNote: boolean;
	/** Whether this key may receive non-active notes via open-notes. Default: false. Applied as AND with global. */
	allowOtherNotes: boolean;
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
	/**
	 * Opt-in: register and run kado-rename even when Obsidian's "Automatically update
	 * internal links" setting is OFF. Default false. When OFF, kado-rename is only
	 * registered if Obsidian's setting is ON (otherwise renameFile pops a blocking
	 * confirmation dialog and the call would hang). When the user enables this, the
	 * tool runs under `renameTimeoutMs` and reports TIMEOUT instead of hanging.
	 * Only surfaced in settings when Obsidian's auto-update-links is OFF.
	 */
	renameWhenLinkUpdateOff: boolean;
	/** Timeout (ms) for a single kado-rename call before it returns TIMEOUT. Default 60000. */
	renameTimeoutMs: number;
	/**
	 * Set once the user has seen and dismissed the "rename is disabled" warning shown on
	 * load when Obsidian's auto-update-links is off. Prevents nagging on every startup.
	 * Default false. Reset is implicit: closing the modal without choosing leaves it false.
	 */
	renameWarningAcknowledged: boolean;
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

/**
 * Returns a new ApiKeyConfig with safe defaults: disabled open-notes flags,
 * whitelist mode, empty paths/tags. Pass overrides to customise individual fields.
 */
export function createDefaultApiKeyConfig(overrides?: Partial<ApiKeyConfig>): ApiKeyConfig {
	return {
		id: '',
		label: '',
		enabled: true,
		createdAt: 0,
		listMode: 'whitelist',
		paths: [],
		tags: [],
		allowActiveNote: false,
		allowOtherNotes: false,
		...overrides,
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
		renameWhenLinkUpdateOff: false,
		renameTimeoutMs: 60_000,
		renameWarningAcknowledged: false,
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
 * Returns true when `req` is a CoreRenameRequest.
 * Discriminated by the explicit `kind: 'rename'` marker.
 */
export function isCoreRenameRequest(req: CoreRequest): req is CoreRenameRequest {
	return 'kind' in req && req.kind === 'rename';
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
const SEARCH_OPS = new Set<string>(['byTag', 'byName', 'listDir', 'listTags', 'byContent', 'byFrontmatter', 'listNotes']);

function isReadDataType(value: string): boolean {
	return READ_DATA_TYPES.has(value);
}

function isSearchOperation(value: string): boolean {
	return SEARCH_OPS.has(value);
}
