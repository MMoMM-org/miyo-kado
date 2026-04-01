/**
 * Canonical internal type definitions for Kado.
 *
 * This file is the single source of truth for all request, result, error,
 * permission-gate, and configuration types used across the four-layer
 * architecture (ADR-001). It has ZERO imports from `obsidian` or
 * `@modelcontextprotocol/sdk` so that the Kado Core can be tested in
 * isolation without either dependency.
 */

// ============================================================
// Data Types
// ============================================================

export type DataType = 'note' | 'frontmatter' | 'file' | 'dataview-inline-field';

/** 'delete' is reserved for a future kado-delete tool. */
export type CrudOperation = 'create' | 'read' | 'update' | 'delete';

export type SearchOperation = 'byTag' | 'byName' | 'listDir' | 'listTags' | 'byContent' | 'byFrontmatter';

// ============================================================
// Core Requests
// ============================================================

export interface CoreReadRequest {
	apiKeyId: string;
	operation: DataType;
	path: string;
}

export interface CoreWriteRequest {
	apiKeyId: string;
	operation: DataType;
	path: string;
	content: string | ArrayBuffer | Record<string, unknown>;
	expectedModified?: number;
}

export interface CoreSearchRequest {
	apiKeyId: string;
	operation: SearchOperation;
	query?: string;
	path?: string;
	cursor?: string;
	limit?: number;
}

export type CoreRequest = CoreReadRequest | CoreWriteRequest | CoreSearchRequest;

// ============================================================
// Core Results
// ============================================================

export interface CoreFileResult {
	path: string;
	content: string | ArrayBuffer | Record<string, unknown>;
	created: number;
	modified: number;
	size: number;
}

export interface CoreWriteResult {
	path: string;
	created: number;
	modified: number;
}

export interface CoreSearchItem {
	path: string;
	name: string;
	created: number;
	modified: number;
	size: number;
	tags?: string[];
	frontmatter?: Record<string, unknown>;
}

export interface CoreSearchResult {
	items: CoreSearchItem[];
	cursor?: string;
	total?: number;
}

// ============================================================
// Errors
// ============================================================

export type CoreErrorCode =
	| 'UNAUTHORIZED'
	| 'FORBIDDEN'
	| 'NOT_FOUND'
	| 'CONFLICT'
	| 'VALIDATION_ERROR'
	| 'INTERNAL_ERROR';

export interface CoreError {
	code: CoreErrorCode;
	message: string;
	gate?: string;
}

// ============================================================
// Permission Gate
// ============================================================

export type GateResult =
	| { allowed: true }
	| { allowed: false; error: CoreError };

export interface PermissionGate {
	name: string;
	evaluate(request: CoreRequest, config: KadoConfig): GateResult;
}

// ============================================================
// Configuration Types
// ============================================================

export interface CrudFlags {
	create: boolean;
	read: boolean;
	update: boolean;
	/** Reserved for future kado-delete tool. Currently not reachable via any MCP tool. */
	delete: boolean;
}

export interface DataTypePermissions {
	note: CrudFlags;
	frontmatter: CrudFlags;
	file: CrudFlags;
	dataviewInlineField: CrudFlags;
}

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
}

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
}

export type ConnectionType = 'local' | 'public';

export interface ServerConfig {
	enabled: boolean;
	host: string;
	port: number;
	/** Whether server binds locally or to a public interface. Default: 'local'. */
	connectionType: ConnectionType;
}

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

export interface KadoConfig {
	server: ServerConfig;
	security: SecurityConfig;
	apiKeys: ApiKeyConfig[];
	audit: AuditConfig;
}

// ============================================================
// Factory Functions
// ============================================================

export function createDefaultCrudFlags(): CrudFlags {
	return {create: false, read: false, update: false, delete: false};
}

export function createDefaultPermissions(): DataTypePermissions {
	return {
		note: createDefaultCrudFlags(),
		frontmatter: createDefaultCrudFlags(),
		file: createDefaultCrudFlags(),
		dataviewInlineField: createDefaultCrudFlags(),
	};
}

export function createDefaultSecurityConfig(): SecurityConfig {
	return {
		listMode: 'whitelist',
		paths: [],
		tags: [],
	};
}

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
	};
}

// ============================================================
// Type Guards
// ============================================================

/**
 * Returns true when `req` is a CoreReadRequest.
 * Discriminates by the absence of `content` (write marker) and
 * the absence of SearchOperation values on `operation`.
 */
export function isCoreReadRequest(req: CoreRequest): req is CoreReadRequest {
	return !('content' in req) && isDataType((req as CoreReadRequest).operation);
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

// ============================================================
// Internal helpers (not exported)
// ============================================================

const DATA_TYPES = new Set<string>(['note', 'frontmatter', 'file', 'dataview-inline-field']);
const SEARCH_OPS = new Set<string>(['byTag', 'byName', 'listDir', 'listTags', 'byContent', 'byFrontmatter']);

function isDataType(value: string): boolean {
	return DATA_TYPES.has(value);
}

function isSearchOperation(value: string): boolean {
	return SEARCH_OPS.has(value);
}
