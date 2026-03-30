/**
 * ResponseMapper — MCP layer outbound ACL boundary.
 *
 * Translates canonical Core result objects into the CallToolResult shape
 * expected by the MCP SDK. All results are serialised to JSON text so the
 * caller receives a consistent, self-describing payload.
 *
 * NO imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {
	CoreFileResult,
	CoreWriteResult,
	CoreSearchResult,
	CoreError,
} from '../types/canonical';

interface TextContent {
	type: 'text';
	text: string;
}

interface CallToolResult {
	content: TextContent[];
	isError?: boolean;
}

function textResult(data: unknown): CallToolResult {
	return {content: [{type: 'text', text: JSON.stringify(data)}]};
}

export function mapFileResult(result: CoreFileResult): CallToolResult {
	return textResult({
		path: result.path,
		content: result.content,
		created: result.created,
		modified: result.modified,
		size: result.size,
	});
}

export function mapWriteResult(result: CoreWriteResult): CallToolResult {
	return textResult({
		path: result.path,
		created: result.created,
		modified: result.modified,
	});
}

export function mapSearchResult(result: CoreSearchResult): CallToolResult {
	return textResult({
		items: result.items,
		cursor: result.cursor,
		total: result.total,
	});
}

export function mapError(error: CoreError): CallToolResult {
	return {
		content: [{type: 'text', text: JSON.stringify({code: error.code, message: error.message, gate: error.gate})}],
		isError: true,
	};
}
