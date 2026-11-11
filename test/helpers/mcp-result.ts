/**
 * Shared helpers for asserting on MCP tool results in tests (#134).
 *
 * MCP content items are a union (text | image | resource | …) and arrays are
 * indexed under `noUncheckedIndexedAccess`, so `result.content[0].text` does
 * not typecheck. firstText narrows once, in one place, and fails with a
 * readable message instead of a TypeError when the shape is wrong.
 */

/** Minimal structural view of a tool result: anything carrying a content array. */
interface ResultWithContent {
	content: ReadonlyArray<{type: string; text?: unknown}>;
}

/** Returns the text of the first content item; throws if it is missing or not text. */
export function firstText(result: ResultWithContent): string {
	const item = result.content[0];
	if (item === undefined) throw new Error('Tool result has no content items');
	if (item.type !== 'text' || typeof item.text !== 'string') {
		throw new Error(`First content item is not text (type: ${item.type})`);
	}
	return item.text;
}
