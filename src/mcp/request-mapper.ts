/**
 * RequestMapper — MCP layer inbound ACL boundary.
 *
 * Translates raw MCP tool-call argument objects into typed canonical request
 * objects. Validates that all required fields are present and throws a
 * descriptive error at the boundary rather than letting invalid data
 * propagate to the Core.
 *
 * NO imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {
	CoreReadRequest,
	CoreWriteRequest,
	CoreSearchRequest,
	CoreDeleteRequest,
	CoreOpenNotesRequest,
	OpenNotesScope,
	DeleteDataType,
	SearchFilter,
} from '../types/canonical';
import {validatePath} from '../core/gates/path-access';

type Args = Record<string, unknown>;

function requireString(args: Args, field: string, context: string): string {
	const value = args[field];
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`${context}: missing required field "${field}"`);
	}
	return value;
}

function requirePresent(args: Args, field: string, context: string): unknown {
	if (!(field in args) || args[field] === undefined || args[field] === null) {
		throw new Error(`${context}: missing required field "${field}"`);
	}
	return args[field];
}

/**
 * Maps raw MCP tool arguments into a CoreReadRequest.
 * @param args - Raw key-value arguments from the MCP tool call.
 * @param keyId - The authenticated API key ID.
 * @throws Error if required fields (operation, path) are missing.
 */
export function mapReadRequest(args: Args, keyId: string): CoreReadRequest {
	const operation = requireString(args, 'operation', 'mapReadRequest') as CoreReadRequest['operation'];
	const path = requireString(args, 'path', 'mapReadRequest');

	return {apiKeyId: keyId, operation, path};
}

/** Operations where content should be a Record, not a string. */
const OBJECT_CONTENT_OPS = new Set(['frontmatter', 'dataview-inline-field']);

/** If content is a JSON string for an operation that expects an object, parse it. */
function coerceContent(content: unknown, operation: string): CoreWriteRequest['content'] {
	if (typeof content === 'string' && OBJECT_CONTENT_OPS.has(operation)) {
		try {
			const parsed: unknown = JSON.parse(content);
			if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
				const safe = parsed as Record<string, unknown>;
				// Strip prototype-pollution keys before the object enters the core pipeline
				delete safe['__proto__'];
				delete safe['constructor'];
				return safe;
			}
		} catch { /* not JSON — pass through as string */ }
	}
	return content as CoreWriteRequest['content'];
}

/**
 * Maps raw MCP tool arguments into a CoreWriteRequest. Coerces JSON strings to objects for frontmatter/inline-field operations.
 * @param args - Raw key-value arguments from the MCP tool call.
 * @param keyId - The authenticated API key ID.
 * @throws Error if required fields (operation, path, content) are missing.
 */
export function mapWriteRequest(args: Args, keyId: string): CoreWriteRequest {
	const operation = requireString(args, 'operation', 'mapWriteRequest') as CoreWriteRequest['operation'];
	const path = requireString(args, 'path', 'mapWriteRequest');
	const rawContent = requirePresent(args, 'content', 'mapWriteRequest');
	const content = coerceContent(rawContent, operation);

	const result: CoreWriteRequest = {apiKeyId: keyId, operation, path, content};

	if ('expectedModified' in args && args['expectedModified'] !== undefined) {
		result.expectedModified = args['expectedModified'] as number;
	}

	return result;
}

/** Ensures directory paths end with '/' for consistent prefix matching. */
function normalizeDirPath(path: string, operation: string): string {
	if (operation !== 'listDir') return path;
	return path.endsWith('/') ? path : path + '/';
}

/** Allowed operation values for kado-delete (inline fields excluded). */
const DELETE_DATA_TYPES = new Set<string>(['note', 'frontmatter', 'file']);

/**
 * Maps raw MCP tool arguments into a CoreDeleteRequest.
 * @param args - Raw key-value arguments from the MCP tool call.
 * @param keyId - The authenticated API key ID.
 * @throws Error if required fields (operation, path, expectedModified) are missing
 *   or invalid (e.g. operation='dataview-inline-field', missing keys for frontmatter).
 */
export function mapDeleteRequest(args: Args, keyId: string): CoreDeleteRequest {
	const operation = requireString(args, 'operation', 'mapDeleteRequest');
	if (!DELETE_DATA_TYPES.has(operation)) {
		throw new Error(`mapDeleteRequest: operation must be one of note|frontmatter|file (got '${operation}')`);
	}
	const path = requireString(args, 'path', 'mapDeleteRequest');

	const rawExpected = requirePresent(args, 'expectedModified', 'mapDeleteRequest');
	if (typeof rawExpected !== 'number' || !Number.isFinite(rawExpected)) {
		throw new Error('mapDeleteRequest: expectedModified must be a number');
	}

	const result: CoreDeleteRequest = {
		kind: 'delete',
		apiKeyId: keyId,
		operation: operation as DeleteDataType,
		path,
		expectedModified: rawExpected,
	};

	if (operation === 'frontmatter') {
		const keys = args['keys'];
		if (!Array.isArray(keys) || keys.length === 0) {
			throw new Error('mapDeleteRequest: frontmatter delete requires a non-empty "keys" array');
		}
		if (!keys.every((k) => typeof k === 'string' && k.length > 0)) {
			throw new Error('mapDeleteRequest: all items in "keys" must be non-empty strings');
		}
		result.keys = keys as string[];
	}

	return result;
}

/**
 * Maps raw MCP tool arguments into a CoreSearchRequest. Normalizes listDir paths to end with '/'.
 * @param args - Raw key-value arguments from the MCP tool call.
 * @param keyId - The authenticated API key ID.
 * @throws Error if the required operation field is missing.
 */
export function mapSearchRequest(args: Args, keyId: string): CoreSearchRequest {
	const operation = requireString(args, 'operation', 'mapSearchRequest') as CoreSearchRequest['operation'];

	const result: CoreSearchRequest = {apiKeyId: keyId, operation};

	if (typeof args['query'] === 'string') result.query = args['query'];
	if (typeof args['cursor'] === 'string') result.cursor = args['cursor'];
	if (typeof args['limit'] === 'number') result.limit = args['limit'];

	if ('depth' in args && args['depth'] !== undefined) {
		const d = args['depth'];
		if (typeof d !== 'number' || !Number.isInteger(d) || d < 1) {
			throw new Error('mapSearchRequest: depth must be a positive integer');
		}
		result.depth = d;
	}

	if (typeof args['path'] === 'string' && operation === 'listDir') {
		if (args['path'] === '') {
			throw new Error("mapSearchRequest: path must not be empty. Use '/' to list the vault root.");
		}
		if (args['path'] !== '/') {
			result.path = normalizeDirPath(args['path'], operation);
		}
	}

	const rawFilter = args['filter'];
	if (rawFilter !== undefined && typeof rawFilter === 'object' && rawFilter !== null) {
		const f = rawFilter as Record<string, unknown>;
		const filter: SearchFilter = {};
		if (typeof f['path'] === 'string' && f['path'].length > 0) {
			if (f['path'].length > 512) throw new Error('mapSearchRequest: filter.path must not exceed 512 characters');
			const pathError = validatePath(f['path']);
			if (pathError) throw new Error(`mapSearchRequest: filter.path — ${pathError}`);
			filter.path = f['path'].endsWith('/') ? f['path'] : f['path'] + '/';
		}
		if (Array.isArray(f['tags']) && f['tags'].length > 0) {
			filter.tags = f['tags'].filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= 128);
			if (filter.tags.length === 0) delete filter.tags;
		}
		if (typeof f['frontmatter'] === 'string' && f['frontmatter'].length > 0) {
			filter.frontmatter = f['frontmatter'];
		}
		if (Object.keys(filter).length > 0) result.filter = filter;
	}

	return result;
}

/**
 * Maps raw MCP tool arguments into a CoreOpenNotesRequest.
 * Defaults scope to 'all' when not supplied.
 * @param args - Raw key-value arguments from the MCP tool call.
 * @param keyId - The authenticated API key ID.
 */
export function mapOpenNotesRequest(args: Args, keyId: string): CoreOpenNotesRequest {
	const scope: OpenNotesScope =
		typeof args['scope'] === 'string' && ['active', 'other', 'all'].includes(args['scope'])
			? (args['scope'] as OpenNotesScope)
			: 'all';

	return {kind: 'openNotes', keyId, scope};
}
