/**
 * ResponseMapper — MCP layer outbound ACL boundary.
 *
 * Translates canonical Core result objects into the CallToolResult shape
 * expected by the MCP SDK. All results are serialised to JSON text so the
 * caller receives a consistent, self-describing payload.
 */

import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {
	CoreFileResult,
	CoreWriteResult,
	CoreSearchResult,
	CoreError,
} from '../types/canonical';

function textResult(data: unknown): CallToolResult {
	return {content: [{type: 'text', text: JSON.stringify(data)}]};
}

/** Serializes a CoreFileResult (read response) into a JSON CallToolResult. */
export function mapFileResult(result: CoreFileResult): CallToolResult {
	return textResult({
		path: result.path,
		content: result.content,
		created: result.created,
		modified: result.modified,
		size: result.size,
	});
}

/** Serializes a CoreWriteResult (write response) into a JSON CallToolResult. */
export function mapWriteResult(result: CoreWriteResult): CallToolResult {
	return textResult({
		path: result.path,
		created: result.created,
		modified: result.modified,
	});
}

/** Serializes a CoreSearchResult (paginated search response) into a JSON CallToolResult. */
export function mapSearchResult(result: CoreSearchResult): CallToolResult {
	return textResult({
		items: result.items,
		cursor: result.cursor,
		total: result.total,
	});
}

/** Serializes a CoreError into a JSON CallToolResult with isError set to true. */
export function mapError(error: CoreError): CallToolResult {
	return {
		content: [{type: 'text', text: JSON.stringify({code: error.code, message: error.message})}],
		isError: true,
	};
}
