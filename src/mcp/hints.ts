/**
 * Response enrichment — derives optional "_hints" guidance attached to tool
 * responses, telling the calling agent a sensible next step (re-read after a
 * conflict, fetch the next page, read the top hit, continue a truncated read).
 *
 * Design: every hint is a pure function of the CURRENT request + result/error.
 * There is no cross-call state (the server is stateless per request, so a state
 * machine would be dead weight) and no config DSL — hints are plain code, always
 * active, and the `_hints` field is additive and freely ignorable by clients.
 *
 * Pure: no imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {
	CoreRequest,
	CoreError,
	CoreSearchResult,
	CoreFileResult,
	CoreReadRequest,
	NoteReadPartial,
} from '../types/canonical';
import {MAX_PARTIAL_INDEX} from './partial-mapper';

/** Search operations whose top hit is worth a follow-up read suggestion. */
const TOP_HIT_OPERATIONS = new Set(['byContent', 'byName', 'byTag']);

/** A single next-step suggestion. `do` is the tool to call (absent = advisory only). */
export interface Hint {
	do?: string;
	with?: Record<string, unknown>;
	why: string;
}

/** Everything needed to derive hints for one tool response. */
export interface HintContext {
	tool: string;
	request: CoreRequest;
	error?: CoreError;
	searchResult?: CoreSearchResult;
	fileResult?: CoreFileResult;
}

/** Best-effort path of a request: `path` for most ops, `source` for rename. */
function pathOf(request: CoreRequest): string | undefined {
	if ('path' in request && typeof request.path === 'string') return request.path;
	if ('source' in request && typeof request.source === 'string') return request.source;
	return undefined;
}

function operationOf(request: CoreRequest): string | undefined {
	return 'operation' in request && typeof request.operation === 'string' ? request.operation : undefined;
}

/** CONFLICT → re-read for a fresh mtime, then retry. */
function conflictHint(ctx: HintContext): Hint | null {
	if (ctx.error?.code !== 'CONFLICT') return null;
	const path = pathOf(ctx.request);
	if (!path) return null;
	const operation = operationOf(ctx.request) ?? 'note';
	return {
		do: 'kado-read',
		with: {operation, path},
		why: 'The file changed since your last read (optimistic-concurrency conflict). Re-read it, then retry with the new "modified" value as expectedModified.',
	};
}

/** FORBIDDEN → advisory only (no internal gate detail leaked). */
function forbiddenHint(ctx: HintContext): Hint | null {
	if (ctx.error?.code !== 'FORBIDDEN') return null;
	return {
		why: 'Access denied: the requested path or tag is outside this API key\'s permissions. Try a path within your allowed scope.',
	};
}

/** Search cursor present → fetch the next page with the same query. */
function paginationHint(ctx: HintContext): Hint | null {
	const result = ctx.searchResult;
	if (!result?.cursor) return null;
	const req = ctx.request;
	const withArgs: Record<string, unknown> = {cursor: result.cursor};
	const operation = operationOf(req);
	if (operation) withArgs.operation = operation;
	if ('query' in req && req.query !== undefined) withArgs.query = req.query;
	if ('path' in req && req.path !== undefined) withArgs.path = req.path;
	if ('filter' in req && req.filter !== undefined) withArgs.filter = req.filter;
	if ('limit' in req && req.limit !== undefined) withArgs.limit = req.limit;
	return {
		do: 'kado-search',
		with: withArgs,
		why: 'More results are available. Pass this cursor to fetch the next page.',
	};
}

/** Non-empty content search → suggest reading the top hit. */
function topHitHint(ctx: HintContext): Hint | null {
	const result = ctx.searchResult;
	const operation = operationOf(ctx.request);
	if (!result || !operation || !TOP_HIT_OPERATIONS.has(operation)) return null;
	const top = result.items[0];
	if (!top) return null;
	return {
		do: 'kado-read',
		with: {operation: 'note', path: top.path},
		why: 'Top-ranked match. Read it to inspect the full note.',
	};
}

/**
 * Next same-sized window after a truncated read, in valid `mode=range` arguments.
 * Returns null when no window can advance: a section is never cut, and a
 * zero-width range would suggest itself forever.
 */
function nextReadWindow(
	partial: NoteReadPartial,
	content: string,
): {rangeBasis: 'line' | 'char'; start: number; end: number} | null {
	if (partial.mode === 'section') return null;

	let rangeBasis: 'line' | 'char' = 'char';
	let start: number;
	let size: number;
	if (partial.mode !== 'range') {
		// Prefix reads: the continuation is a char range, which the adapter reads
		// as code POINTS — so count code points, not UTF-16 units. They diverge for
		// astral-plane chars (emoji, CJK Ext-B+); using `.length` would overshoot
		// and skip content. `Array.from` iterates by code point.
		start = Array.from(content).length;
		size = start;
	} else if (partial.basis === 'char') {
		start = partial.end;
		size = partial.end - partial.start;
	} else {
		rangeBasis = 'line';
		start = partial.end + 1;
		size = partial.end - partial.start + 1;
	}

	if (size <= 0 || start > MAX_PARTIAL_INDEX) return null;
	// A line `end` is inclusive, a char `end` exclusive.
	const end = rangeBasis === 'line' ? start + size - 1 : start + size;
	return {rangeBasis, start, end: Math.min(end, MAX_PARTIAL_INDEX)};
}

/** Truncated read → continue with a range read of the next window. */
function truncatedHint(ctx: HintContext): Hint | null {
	const result = ctx.fileResult;
	if (!result?.truncated) return null;
	const path = pathOf(ctx.request);
	const operation = operationOf(ctx.request) ?? 'note';
	if (!path) return null;
	if (typeof result.content !== 'string') return null;
	// A file result always answers a read request, so this is the read `partial`.
	const partial = (ctx.request as CoreReadRequest).partial;
	if (!partial) return null;
	const window = nextReadWindow(partial, result.content);
	if (!window) return null;
	return {
		do: 'kado-read',
		with: {operation, path, mode: 'range', ...window},
		why: 'More content follows this slice. Read the next chunk with this range.',
	};
}

/** tags read limited to frontmatter → tell the agent inline tags need note.read. */
function frontmatterOnlyHint(ctx: HintContext): Hint | null {
	const content = ctx.fileResult?.content;
	if (
		content !== null
		&& typeof content === 'object'
		&& !(content instanceof ArrayBuffer)
		&& content.returnedTags === 'FrontmatterOnly'
	) {
		return {
			why: 'Only frontmatter tags were returned. Inline (body) tags may also exist but require note.read permission for this key.',
		};
	}
	return null;
}

/**
 * Derives the ordered list of hints for a tool response. Returns [] when nothing
 * actionable applies — most successful, complete responses carry no hints.
 */
export function deriveHints(ctx: HintContext): Hint[] {
	const candidates = [
		conflictHint(ctx),
		forbiddenHint(ctx),
		paginationHint(ctx),
		topHitHint(ctx),
		truncatedHint(ctx),
		frontmatterOnlyHint(ctx),
	];
	return candidates.filter((h): h is Hint => h !== null);
}
