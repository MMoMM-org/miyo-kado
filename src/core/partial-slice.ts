/**
 * Pure string helpers for partial note read/write operations.
 *
 * Provides code-point-safe slicing (firstXChars, sliceByLineRange,
 * sliceByCharRange) and body-merge helpers (applyAppend, applyPrepend).
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

// ============================================================
// Internal helpers
// ============================================================

/**
 * Produces a validation Error describing an invalid [start, end] range.
 * Callers map this to VALIDATION_ERROR in the core pipeline.
 */
function rangeError(start: number, end: number): Error {
	return new Error(
		`VALIDATION_ERROR: invalid range [${start}, ${end}] — start must be ≤ end and ≥ its minimum`,
	);
}

// ============================================================
// Exported helpers
// ============================================================

/** First N code points (multibyte-safe). Returns the slice and whether content was dropped. */
export function firstXChars(
	body: string,
	limit: number,
): {slice: string; truncated: boolean} {
	if (limit < 0) throw new Error(`VALIDATION_ERROR: limit must be ≥ 0, got ${limit}`);
	const cps = Array.from(body); // code points, not UTF-16 units → never splits a char
	if (cps.length <= limit) return {slice: body, truncated: false};
	return {slice: cps.slice(0, limit).join(''), truncated: true};
}

/** Inclusive 1-based line range. Clamps to bounds; reports whether content exists outside. */
export function sliceByLineRange(
	body: string,
	start: number,
	end: number,
): {slice: string; truncated: boolean} {
	if (start > end || start < 1) throw rangeError(start, end);
	const lines = body.split('\n');
	const from = Math.min(start, lines.length);
	const to = Math.min(end, lines.length);
	const slice = lines.slice(from - 1, to).join('\n');
	const truncated = from > 1 || to < lines.length;
	return {slice, truncated};
}

/** 0-based start, exclusive end, code-point based. */
export function sliceByCharRange(
	body: string,
	start: number,
	end: number,
): {slice: string; truncated: boolean} {
	if (start > end || start < 0) throw rangeError(start, end);
	const cps = Array.from(body);
	const to = Math.min(end, cps.length);
	const slice = cps.slice(start, to).join('');
	const truncated = start > 0 || to < cps.length;
	return {slice, truncated};
}

/** Appends `add` to `body`, inserting a newline separator when needed. */
export const applyAppend = (body: string, add: string): string =>
	body.length === 0 || body.endsWith('\n') ? body + add : body + '\n' + add;

/** Prepends `add` before `bodyAfterFm`, inserting a newline separator when needed. */
export const applyPrepend = (bodyAfterFm: string, add: string): string =>
	add.endsWith('\n') ? add + bodyAfterFm : add + '\n' + bodyAfterFm;
