/**
 * PathAccessGate — Gate 4, the final gate in the permission chain.
 *
 * Normalizes the request path and rejects traversal attempts, null bytes,
 * and empty paths. Search requests without a path are allowed because path
 * is optional for search operations.
 *
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`. Path validation
 * is implemented inline — this is a pure core module.
 */

import {isCoreSearchRequest} from '../../types/canonical';
import type {CoreRequest, GateResult, KadoConfig, PermissionGate} from '../../types/canonical';

/** Segments that indicate directory traversal. */
const TRAVERSAL_PATTERN = /(?:^|[/\\])\.\.(?:[/\\]|$)/;

/** Normalizes a path: strips leading slash, collapses consecutive slashes. */
function normalizePath(raw: string): string {
	return raw.replace(/^\/+/, '').replace(/\/\/+/g, '/');
}

/** Returns a VALIDATION_ERROR GateResult with the path-access gate label. */
function blocked(message: string): GateResult {
	return {
		allowed: false,
		error: {code: 'VALIDATION_ERROR', message, gate: 'path-access'},
	};
}

/** URL-decodes a path for traversal analysis. Returns the original on malformed input. */
function decodePath(path: string): string {
	try { return decodeURIComponent(path); } catch { return path; }
}

/** Validates a normalized path, returning an error message or null if valid. */
export function validatePath(normalized: string): string | null {
	if (normalized.length === 0) {
		return 'Path must not be empty';
	}
	if (normalized.includes('\0') || normalized.includes('%00')) {
		return 'Path must not contain null bytes';
	}
	const decoded = decodePath(normalized);
	if (TRAVERSAL_PATTERN.test(normalized) || normalized === '..'
		|| TRAVERSAL_PATTERN.test(decoded) || decoded === '..') {
		return 'Path must not contain traversal segments';
	}
	return null;
}

/** Gate 4: validates and normalizes the request path, rejecting traversal attempts and null bytes. */
export class PathAccessGate implements PermissionGate {
	readonly name = 'path-access';

	evaluate(request: CoreRequest, _config: KadoConfig): GateResult {
		if (isCoreSearchRequest(request) && request.path === undefined) {
			return {allowed: true};
		}

		const raw = (request as {path?: string}).path ?? '';
		const normalized = normalizePath(raw);
		const error = validatePath(normalized);

		if (error !== null) {
			return blocked(error);
		}

		return {allowed: true};
	}
}
