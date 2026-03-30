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

export function mapReadRequest(args: Args, keyId: string): CoreReadRequest {
	const operation = requireString(args, 'operation', 'mapReadRequest') as CoreReadRequest['operation'];
	const path = requireString(args, 'path', 'mapReadRequest');

	return {apiKeyId: keyId, operation, path};
}

export function mapWriteRequest(args: Args, keyId: string): CoreWriteRequest {
	const operation = requireString(args, 'operation', 'mapWriteRequest') as CoreWriteRequest['operation'];
	const path = requireString(args, 'path', 'mapWriteRequest');
	const content = requirePresent(args, 'content', 'mapWriteRequest') as CoreWriteRequest['content'];

	const result: CoreWriteRequest = {apiKeyId: keyId, operation, path, content};

	if ('expectedModified' in args && args['expectedModified'] !== undefined) {
		result.expectedModified = args['expectedModified'] as number;
	}

	return result;
}

export function mapSearchRequest(args: Args, keyId: string): CoreSearchRequest {
	const operation = requireString(args, 'operation', 'mapSearchRequest') as CoreSearchRequest['operation'];

	const result: CoreSearchRequest = {apiKeyId: keyId, operation};

	if (typeof args['query'] === 'string') result.query = args['query'];
	if (typeof args['path'] === 'string') result.path = args['path'];
	if (typeof args['cursor'] === 'string') result.cursor = args['cursor'];
	if (typeof args['limit'] === 'number') result.limit = args['limit'];

	return result;
}
