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
	CoreDeleteResult,
	CoreRenameResult,
	CoreGraphResult,
	CoreError,
	CoreOpenNotesResult,
} from '../types/canonical';
import type {Hint} from './hints';

function textResult(data: unknown): CallToolResult {
	return {content: [{type: 'text', text: JSON.stringify(data)}]};
}

/**
 * Attaches optional next-step hints to a payload under the additive `_hints`
 * key. No-op when there are no hints, so existing response shapes are unchanged
 * and clients may ignore the field entirely.
 */
function withHints(payload: Record<string, unknown>, hints?: Hint[]): Record<string, unknown> {
	if (hints && hints.length > 0) payload['_hints'] = hints;
	return payload;
}

/** Serializes a CoreFileResult (read response) into a JSON CallToolResult. */
export function mapFileResult(result: CoreFileResult, hints?: Hint[]): CallToolResult {
	const payload: Record<string, unknown> = {
		path: result.path,
		content: result.content,
		created: result.created,
		modified: result.modified,
		size: result.size,
	};
	// ADR-6: partial reads must never appear complete when content was cut off.
	// Include the flag only when the adapter explicitly set it to true.
	if (result.truncated !== undefined) payload['truncated'] = result.truncated;
	return textResult(withHints(payload, hints));
}

/** Serializes a CoreWriteResult (write response) into a JSON CallToolResult. */
export function mapWriteResult(result: CoreWriteResult): CallToolResult {
	return textResult({
		path: result.path,
		created: result.created,
		modified: result.modified,
	});
}

/** Serializes a CoreDeleteResult (delete response) into a JSON CallToolResult. */
export function mapDeleteResult(result: CoreDeleteResult): CallToolResult {
	const payload: Record<string, unknown> = {path: result.path};
	if (result.modified !== undefined) payload['modified'] = result.modified;
	return textResult(payload);
}

/** Serializes a CoreRenameResult (rename/move response) into a JSON CallToolResult. */
export function mapRenameResult(result: CoreRenameResult): CallToolResult {
	const payload: Record<string, unknown> = {
		source: result.source,
		target: result.target,
		modified: result.modified,
	};
	if (result.linkUpdatePending) {
		payload['linkUpdatePending'] = true;
		// Self-describing note so the caller (often an LLM) interprets the state correctly
		// without needing the tool schema at hand.
		payload['note'] = 'The file WAS renamed/moved, but Obsidian is waiting for the user to confirm '
			+ 'updating its inbound links (a dialog is open in Obsidian). Inbound links stay unchanged until '
			+ 'the user answers it. Do NOT retry this rename — it already happened. For multiple renames, ask '
			+ 'the user to enable "Automatically update internal links" (Obsidian → Files and links) so renames '
			+ 'are silent and do not queue a dialog each.';
	}
	return textResult(payload);
}

/** Serializes a CoreSearchResult (paginated search response) into a JSON CallToolResult. */
export function mapSearchResult(result: CoreSearchResult, hints?: Hint[]): CallToolResult {
	return textResult(withHints({
		items: result.items,
		cursor: result.cursor,
		total: result.total,
	}, hints));
}

/** Serializes a CoreGraphResult (graph navigation response) into a JSON CallToolResult. */
export function mapGraphResult(result: CoreGraphResult, hints?: Hint[]): CallToolResult {
	return textResult(withHints({
		source: result.source,
		operation: result.operation,
		nodes: result.nodes,
	}, hints));
}

/** Serializes a CoreError into a JSON CallToolResult with isError set to true. */
export function mapError(error: CoreError, hints?: Hint[]): CallToolResult {
	return {
		content: [{type: 'text', text: JSON.stringify(withHints({code: error.code, message: error.message}, hints))}],
		isError: true,
	};
}

/** Serializes a CoreOpenNotesResult into a JSON CallToolResult with the contract shape { notes: OpenNoteDescriptor[] }. */
export function mapOpenNotesResult(result: CoreOpenNotesResult): CallToolResult {
	return textResult({
		notes: result.notes.map((n) => ({name: n.name, path: n.path, active: n.active, type: n.type})),
	});
}
