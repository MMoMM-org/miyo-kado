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
} from '../types/canonical';

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
	if (path === '' || path === '/') return '';
	return path.endsWith('/') ? path : path + '/';
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

	if (typeof args['path'] === 'string') {
		if (args['path'] === '') {
			throw new Error("mapSearchRequest: path must not be empty. Use '/' to list the vault root.");
		}
		if (args['path'] !== '/') {
			result.path = normalizeDirPath(args['path'], operation);
		}
	}

	return result;
}
