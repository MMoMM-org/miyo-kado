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

/**
 * First N code points (multibyte-safe). Returns the slice and whether content was dropped.
 *
 * `limit === 0` is permitted here (returns an empty slice); the MCP boundary
 * (Zod `.positive()`) rejects 0 before it ever reaches this helper, so the two
 * layers are intentionally asymmetric — this is the lenient core contract.
 *
 * Scans by code point and stops at `limit` rather than materializing the whole
 * file with `Array.from`, so a `firstXChars(hugeFile, 100)` is O(limit), not
 * O(file length).
 */
export function firstXChars(
	body: string,
	limit: number,
): {slice: string; truncated: boolean} {
	if (limit < 0) throw new Error(`VALIDATION_ERROR: limit must be ≥ 0, got ${limit}`);
	// UTF-16 length is always ≥ the code-point count, so length ≤ limit guarantees
	// no truncation — a cheap fast path that skips the scan for short bodies.
	if (body.length <= limit) return {slice: body, truncated: false};
	let i = 0;
	let cp = 0;
	while (i < body.length && cp < limit) {
		const code = body.codePointAt(i)!;
		i += code > 0xffff ? 2 : 1;
		cp++;
	}
	const truncated = i < body.length;
	return {slice: truncated ? body.slice(0, i) : body, truncated};
}

/**
 * Inclusive 1-based line range. Clamps to bounds; reports whether content exists outside.
 * A `start` beyond EOF is clamped to the last line (not an error) — reads are
 * lenient so a stale line number degrades to "last line" rather than failing.
 */
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

/**
 * 0-based start, exclusive end, code-point based. Scans by code point and stops
 * at `end` instead of materializing the whole file with `Array.from`, so the
 * cost is O(end), not O(file length).
 */
export function sliceByCharRange(
	body: string,
	start: number,
	end: number,
): {slice: string; truncated: boolean} {
	if (start > end || start < 0) throw rangeError(start, end);
	let i = 0;
	let cp = 0;
	while (i < body.length && cp < start) {
		const c = body.codePointAt(i)!;
		i += c > 0xffff ? 2 : 1;
		cp++;
	}
	const startByte = i;
	while (i < body.length && cp < end) {
		const c = body.codePointAt(i)!;
		i += c > 0xffff ? 2 : 1;
		cp++;
	}
	const truncated = startByte > 0 || i < body.length;
	return {slice: body.slice(startByte, i), truncated};
}

/** Appends `add` to `body`, inserting a newline separator when needed. */
export const applyAppend = (body: string, add: string): string =>
	body.length === 0 || body.endsWith('\n') ? body + add : body + '\n' + add;

/** Prepends `add` before `bodyAfterFm`, inserting a newline separator when needed. */
export const applyPrepend = (bodyAfterFm: string, add: string): string =>
	add.endsWith('\n') ? add + bodyAfterFm : add + '\n' + bodyAfterFm;
