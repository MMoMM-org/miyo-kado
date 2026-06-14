/**
 * Partial-read/write argument parsing for the MCP layer.
 *
 * Splits the flat `mode`/`heading`/`headingPath`/`rangeBasis`/`start`/`end`/`limit`
 * tool args into the normalized NoteReadPartial / NoteWritePartial descriptors the
 * Core consumes. Extracted from request-mapper.ts to keep each file focused and
 * under the project's size guideline.
 *
 * NO imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {
	CoreWriteRequest,
	HeadingTarget,
	RangeTarget,
	NoteReadPartial,
	NoteWritePartial,
} from '../types/canonical';

type Args = Record<string, unknown>;

/** Valid mode values for partial note reads. */
const NOTE_READ_MODES = new Set<string>(['firstXChars', 'section', 'range']);

/** Max heading-path nesting depth accepted at the boundary (well beyond any real outline). */
const MAX_HEADING_DEPTH = 50;

/**
 * Upper bound for `limit`/`start`/`end`. Notes never approach this many code
 * points or lines; bounding the inputs keeps numbers in safe-integer territory
 * and rejects obviously-bogus values at the boundary.
 */
const MAX_PARTIAL_INDEX = 1_000_000_000;

/**
 * Parses heading addressing args (heading or headingPath) into a HeadingTarget.
 * Exactly one of `heading` / `headingPath` must be supplied.
 *
 * @param args - Raw args from the MCP tool call.
 * @param context - Caller prefix for error messages (e.g. 'mapReadRequest').
 */
export function parseHeadingTarget(args: Args, context: string): HeadingTarget {
	const hasHeading = 'heading' in args && args['heading'] !== undefined;
	const hasPath = 'headingPath' in args && args['headingPath'] !== undefined;

	if (hasHeading && hasPath) {
		throw new Error(
			`${context}: heading and headingPath are mutually exclusive — supply exactly one`,
		);
	}

	if (hasHeading) {
		const heading = args['heading'];
		if (typeof heading !== 'string' || heading.length === 0) {
			throw new Error(`${context}: heading must be a non-empty string`);
		}
		return {heading};
	}

	if (hasPath) {
		const headingPath = args['headingPath'];
		if (
			!Array.isArray(headingPath) ||
			headingPath.length === 0 ||
			!headingPath.every((s: unknown) => typeof s === 'string' && s.length > 0)
		) {
			throw new Error(
				`${context}: headingPath must be a non-empty array of non-empty strings`,
			);
		}
		// Cap nesting depth — no real Obsidian outline is this deep, and an unbounded
		// path makes matchHeadingPath O(path.length × headings) on the main thread.
		if (headingPath.length > MAX_HEADING_DEPTH) {
			throw new Error(`${context}: headingPath must not exceed ${MAX_HEADING_DEPTH} levels`);
		}
		return {headingPath: headingPath as string[]};
	}

	throw new Error(
		`${context}: heading or headingPath is required`,
	);
}

/**
 * Parses range addressing args (rangeBasis, start, end) into a RangeTarget.
 * Enforces ADR-4 bounds: line basis → start ≥ 1; char basis → start ≥ 0; start ≤ end.
 *
 * @param args - Raw args from the MCP tool call.
 * @param context - Caller prefix for error messages (e.g. 'mapReadRequest').
 */
function parseRangeTarget(args: Args, context: string): RangeTarget {
	const basis = args['rangeBasis'];
	if (basis !== 'line' && basis !== 'char') {
		const shown = typeof basis === 'string' ? basis : typeof basis;
		throw new Error(
			`${context}: rangeBasis must be "line" or "char" (got '${shown}')`,
		);
	}

	const rawStart = args['start'];
	if (typeof rawStart !== 'number' || !Number.isInteger(rawStart)) {
		throw new Error(`${context}: start must be an integer`);
	}

	const rawEnd = args['end'];
	if (typeof rawEnd !== 'number' || !Number.isInteger(rawEnd)) {
		throw new Error(`${context}: end must be an integer`);
	}

	const minStart = basis === 'line' ? 1 : 0;
	if (rawStart < minStart) {
		throw new Error(
			`${context}: start must be ≥ ${minStart} for rangeBasis="${basis}" (got ${rawStart})`,
		);
	}

	if (rawEnd > MAX_PARTIAL_INDEX) {
		throw new Error(`${context}: end must not exceed ${MAX_PARTIAL_INDEX} (got ${rawEnd})`);
	}

	if (rawStart > rawEnd) {
		throw new Error(
			`${context}: start must be ≤ end (got start=${rawStart}, end=${rawEnd})`,
		);
	}

	return {basis, start: rawStart, end: rawEnd};
}

/**
 * Parses the optional `mode` field from read args and builds a NoteReadPartial descriptor.
 * Returns undefined when `mode` is absent (full read).
 * Throws when `mode` is present but invalid, or when mode-specific args are missing/invalid.
 * Only valid for operation='note'.
 */
export function parseNoteReadPartial(args: Args, operation: string, context: string): NoteReadPartial | undefined {
	if (!('mode' in args) || args['mode'] === undefined) {
		return undefined;
	}

	const mode = args['mode'];

	if (operation !== 'note') {
		throw new Error(
			`${context}: mode is only valid for operation="note" (got operation='${operation}')`,
		);
	}

	if (typeof mode !== 'string' || !NOTE_READ_MODES.has(mode)) {
		const shown = typeof mode === 'string' ? mode : typeof mode;
		throw new Error(
			`${context}: mode must be one of firstXChars|section|range (got '${shown}')`,
		);
	}

	if (mode === 'firstXChars') {
		const limit = args['limit'];
		if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) {
			throw new Error(
				`${context}: limit must be a positive integer for mode="firstXChars"`,
			);
		}
		if (limit > MAX_PARTIAL_INDEX) {
			throw new Error(`${context}: limit must not exceed ${MAX_PARTIAL_INDEX} (got ${limit})`);
		}
		return {mode: 'firstXChars', limit};
	}

	if (mode === 'section') {
		const target = parseHeadingTarget(args, context);
		return {mode: 'section', ...target};
	}

	// mode === 'range'
	const range = parseRangeTarget(args, context);
	return {mode: 'range', ...range};
}

/** Valid mode values for partial note writes. */
const NOTE_WRITE_MODES = new Set<string>([
	'append', 'prepend', 'insertUnderHeading', 'replaceSection', 'replaceRange',
]);

/** Note write modes that require expectedModified (ADR-5: insert/replace are not lock-free). */
const NOTE_WRITE_MODES_REQUIRE_LOCK = new Set<string>([
	'insertUnderHeading', 'replaceSection', 'replaceRange',
]);

/**
 * Parses the `mode` field from write args for operation='note' and builds a NoteWritePartial.
 * Enforces ADR-5: insertUnderHeading/replaceSection/replaceRange require expectedModified.
 * Reuses parseHeadingTarget and parseRangeTarget for sub-arg validation.
 *
 * @param args - Raw args from the MCP tool call.
 * @param result - Partially-built CoreWriteRequest (used to check expectedModified presence).
 * @param context - Caller prefix for error messages (e.g. 'mapWriteRequest').
 */
export function parseNoteWritePartial(args: Args, result: CoreWriteRequest, context: string): NoteWritePartial {
	const mode = args['mode'];
	if (typeof mode !== 'string' || !NOTE_WRITE_MODES.has(mode)) {
		const shown = typeof mode === 'string' ? mode : typeof mode;
		throw new Error(
			`${context}: mode must be one of append|prepend|insertUnderHeading|replaceSection|replaceRange (got '${shown}')`,
		);
	}

	// ADR-5: insert/replace modes require expectedModified for optimistic concurrency
	if (NOTE_WRITE_MODES_REQUIRE_LOCK.has(mode) && result.expectedModified === undefined) {
		throw new Error(
			`${context}: expectedModified is required for mode="${mode}"`,
		);
	}

	if (mode === 'append') return {mode: 'append'};
	if (mode === 'prepend') return {mode: 'prepend'};

	if (mode === 'insertUnderHeading') {
		const target = parseHeadingTarget(args, context);
		return {mode: 'insertUnderHeading', ...target};
	}

	if (mode === 'replaceSection') {
		const target = parseHeadingTarget(args, context);
		return {mode: 'replaceSection', ...target};
	}

	// mode === 'replaceRange'
	const range = parseRangeTarget(args, context);
	return {mode: 'replaceRange', ...range};
}
