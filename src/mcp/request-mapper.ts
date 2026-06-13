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
	CoreDeleteRequest,
	CoreOpenNotesRequest,
	OpenNotesScope,
	DeleteDataType,
	FrontmatterWriteMode,
	SearchFilter,
	HeadingTarget,
	RangeTarget,
	NoteReadPartial,
	NoteWritePartial,
} from '../types/canonical';
import {validatePath} from '../core/gates/path-access';

type Args = Record<string, unknown>;

/**
 * Parses a single time-bound field (`modifiedAfter`, `modifiedBefore`,
 * `createdAfter`, `createdBefore`) from raw filter args. Mutates `filter` in
 * place when the field is a finite, non-negative number. Throws on the
 * "supplied but invalid" path (non-number, non-finite, negative) so clients
 * get a clear VALIDATION_ERROR instead of silent drop.
 */
function assignTimeBound(
	raw: Record<string, unknown>,
	key: 'modifiedAfter' | 'modifiedBefore' | 'createdAfter' | 'createdBefore',
	filter: SearchFilter,
): void {
	const value = raw[key];
	if (value === undefined) return;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error(`mapSearchRequest: filter.${key} must be a non-negative finite Unix-ms number`);
	}
	filter[key] = value;
}

/** Operations that require a markdown (.md) target — they parse YAML frontmatter or note body. */
const MARKDOWN_ONLY_OPS = new Set(['note', 'frontmatter', 'dataview-inline-field', 'tags']);

/** Returns true when the path ends with `.md` (case-insensitive). */
function isMarkdownPath(path: string): boolean {
	return path.toLowerCase().endsWith('.md');
}

/**
 * Enforces strict separation between markdown-targeting operations and the raw
 * binary `file` operation. Markdown operations (note/frontmatter/inline-field/tags)
 * only make sense on `.md` files; `file` is for everything else (images, PDFs,
 * JSON, etc.). Catching this at the boundary gives the client an actionable
 * VALIDATION_ERROR instead of a downstream INTERNAL_ERROR when Obsidian rejects
 * the combination.
 */
function validateOperationExtension(operation: string, path: string, context: string): void {
	if (MARKDOWN_ONLY_OPS.has(operation)) {
		if (!isMarkdownPath(path)) {
			throw new Error(
				`${context}: operation="${operation}" requires a .md path (got "${path}"). ` +
				'Use operation="file" with base64 content for non-markdown files.',
			);
		}
		return;
	}
	if (operation === 'file' && isMarkdownPath(path)) {
		throw new Error(
			`${context}: operation="file" must not target a .md path (got "${path}"). ` +
			'Use operation="note" for markdown files.',
		);
	}
}

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

/** Valid mode values for partial note reads. */
const NOTE_READ_MODES = new Set<string>(['firstXChars', 'section', 'range']);

/**
 * Parses heading addressing args (heading or headingPath) into a HeadingTarget.
 * Exactly one of `heading` / `headingPath` must be supplied.
 * Reused by the write-mapper in a follow-up task.
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
		return {headingPath: headingPath as string[]};
	}

	throw new Error(
		`${context}: heading or headingPath is required`,
	);
}

/**
 * Parses range addressing args (rangeBasis, start, end) into a RangeTarget.
 * Enforces ADR-4 bounds: line basis → start ≥ 1; char basis → start ≥ 0; start ≤ end.
 * Reused by the write-mapper in a follow-up task.
 *
 * @param args - Raw args from the MCP tool call.
 * @param context - Caller prefix for error messages (e.g. 'mapReadRequest').
 */
export function parseRangeTarget(args: Args, context: string): RangeTarget {
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
function parseNoteReadPartial(args: Args, operation: string, context: string): NoteReadPartial | undefined {
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

/**
 * Maps raw MCP tool arguments into a CoreReadRequest.
 * @param args - Raw key-value arguments from the MCP tool call.
 * @param keyId - The authenticated API key ID.
 * @throws Error if required fields (operation, path) are missing.
 */
export function mapReadRequest(args: Args, keyId: string): CoreReadRequest {
	const operation = requireString(args, 'operation', 'mapReadRequest') as CoreReadRequest['operation'];
	const path = requireString(args, 'path', 'mapReadRequest');
	validateOperationExtension(operation, path, 'mapReadRequest');

	const result: CoreReadRequest = {apiKeyId: keyId, operation, path};

	const partial = parseNoteReadPartial(args, operation, 'mapReadRequest');
	if (partial !== undefined) {
		result.partial = partial;
	}

	return result;
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
function parseNoteWritePartial(args: Args, result: CoreWriteRequest, context: string): NoteWritePartial {
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

/** Operations where content should be a Record, not a string. */
const OBJECT_CONTENT_OPS = new Set(['frontmatter', 'dataview-inline-field']);

/** If content is a JSON string for an operation that expects an object, parse it. */
function coerceContent(content: unknown, operation: string): CoreWriteRequest['content'] {
	if (typeof content === 'string' && OBJECT_CONTENT_OPS.has(operation)) {
		try {
			const parsed: unknown = JSON.parse(content);
			if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
				const safe = parsed as Record<string, unknown>;
				// Strip prototype-pollution keys before the object enters the core pipeline
				delete safe['__proto__'];
				delete safe['constructor'];
				return safe;
			}
		} catch { /* not JSON — pass through as string */ }
	}
	return content as CoreWriteRequest['content'];
}

/**
 * Maps raw MCP tool arguments into a CoreWriteRequest. Coerces JSON strings to objects for frontmatter/inline-field operations.
 * @param args - Raw key-value arguments from the MCP tool call.
 * @param keyId - The authenticated API key ID.
 * @throws Error if required fields (operation, path, content) are missing.
 */
export function mapWriteRequest(args: Args, keyId: string): CoreWriteRequest {
	const operation = requireString(args, 'operation', 'mapWriteRequest') as CoreWriteRequest['operation'];
	const path = requireString(args, 'path', 'mapWriteRequest');
	validateOperationExtension(operation, path, 'mapWriteRequest');
	const rawContent = requirePresent(args, 'content', 'mapWriteRequest');
	const content = coerceContent(rawContent, operation);

	const result: CoreWriteRequest = {apiKeyId: keyId, operation, path, content};

	if ('expectedModified' in args && args['expectedModified'] !== undefined) {
		result.expectedModified = args['expectedModified'] as number;
	}

	if ('mode' in args && args['mode'] !== undefined) {
		const mode = args['mode'];
		if (operation === 'frontmatter') {
			if (mode !== 'merge' && mode !== 'replace') {
				const shown = typeof mode === 'string' ? mode : typeof mode;
				throw new Error(`mapWriteRequest: mode must be "merge" or "replace" (got '${shown}')`);
			}
			result.mode = mode as FrontmatterWriteMode;
		} else if (operation === 'note') {
			result.notePartial = parseNoteWritePartial(args, result, 'mapWriteRequest');
		} else {
			const shown = typeof mode === 'string' ? mode : typeof mode;
			throw new Error(
				`mapWriteRequest: mode is not valid for operation="${operation}" (got '${shown}')`,
			);
		}
	}

	return result;
}

/** Ensures directory paths end with '/' for consistent prefix matching. */
function normalizeDirPath(path: string, operation: string): string {
	if (operation !== 'listDir' && operation !== 'listNotes') return path;
	return path.endsWith('/') ? path : path + '/';
}

/** Allowed operation values for kado-delete (inline fields excluded). */
const DELETE_DATA_TYPES = new Set<string>(['note', 'frontmatter', 'file']);

/**
 * Maps raw MCP tool arguments into a CoreDeleteRequest.
 * @param args - Raw key-value arguments from the MCP tool call.
 * @param keyId - The authenticated API key ID.
 * @throws Error if required fields (operation, path, expectedModified) are missing
 *   or invalid (e.g. operation='dataview-inline-field', missing keys for frontmatter).
 */
export function mapDeleteRequest(args: Args, keyId: string): CoreDeleteRequest {
	const operation = requireString(args, 'operation', 'mapDeleteRequest');
	if (!DELETE_DATA_TYPES.has(operation)) {
		throw new Error(`mapDeleteRequest: operation must be one of note|frontmatter|file (got '${operation}')`);
	}
	const path = requireString(args, 'path', 'mapDeleteRequest');
	validateOperationExtension(operation, path, 'mapDeleteRequest');

	const rawExpected = requirePresent(args, 'expectedModified', 'mapDeleteRequest');
	if (typeof rawExpected !== 'number' || !Number.isFinite(rawExpected)) {
		throw new Error('mapDeleteRequest: expectedModified must be a number');
	}

	const result: CoreDeleteRequest = {
		kind: 'delete',
		apiKeyId: keyId,
		operation: operation as DeleteDataType,
		path,
		expectedModified: rawExpected,
	};

	if (operation === 'frontmatter') {
		const keys = args['keys'];
		if (!Array.isArray(keys) || keys.length === 0) {
			throw new Error('mapDeleteRequest: frontmatter delete requires a non-empty "keys" array');
		}
		if (!keys.every((k) => typeof k === 'string' && k.length > 0)) {
			throw new Error('mapDeleteRequest: all items in "keys" must be non-empty strings');
		}
		result.keys = keys as string[];
	}

	return result;
}

/**
 * Maps raw MCP tool arguments into a CoreSearchRequest. Normalizes listDir paths to end with '/'.
 * @param args - Raw key-value arguments from the MCP tool call.
 * @param keyId - The authenticated API key ID.
 * @throws Error if the required operation field is missing.
 */
export function mapSearchRequest(args: Args, keyId: string): CoreSearchRequest {
	const operation = requireString(args, 'operation', 'mapSearchRequest') as CoreSearchRequest['operation'];

	const result: CoreSearchRequest = {apiKeyId: keyId, operation};

	if (typeof args['query'] === 'string') result.query = args['query'];
	if (typeof args['cursor'] === 'string') result.cursor = args['cursor'];
	if (typeof args['limit'] === 'number') result.limit = args['limit'];

	if ('depth' in args && args['depth'] !== undefined) {
		const d = args['depth'];
		if (typeof d !== 'number' || !Number.isInteger(d) || d < 1) {
			throw new Error('mapSearchRequest: depth must be a positive integer');
		}
		result.depth = d;
	}

	if (typeof args['path'] === 'string' && (operation === 'listDir' || operation === 'listNotes')) {
		if (args['path'] === '') {
			throw new Error("mapSearchRequest: path must not be empty. Use '/' to list the vault root.");
		}
		if (args['path'] !== '/') {
			result.path = normalizeDirPath(args['path'], operation);
		}
	}

	// listNotes projection: which body-derived enrichments to include per item.
	if (Array.isArray(args['fields']) && args['fields'].length > 0) {
		const fields = args['fields'].filter((v): v is string => typeof v === 'string' && v.length > 0);
		if (fields.length > 0) result.fields = fields;
	}

	const rawFilter = args['filter'];
	if (rawFilter !== undefined && typeof rawFilter === 'object' && rawFilter !== null) {
		const f = rawFilter as Record<string, unknown>;
		const filter: SearchFilter = {};
		if (typeof f['path'] === 'string' && f['path'].length > 0) {
			if (f['path'].length > 512) throw new Error('mapSearchRequest: filter.path must not exceed 512 characters');
			const pathError = validatePath(f['path']);
			if (pathError) throw new Error(`mapSearchRequest: filter.path — ${pathError}`);
			filter.path = f['path'].endsWith('/') ? f['path'] : f['path'] + '/';
		}
		if (Array.isArray(f['tags']) && f['tags'].length > 0) {
			filter.tags = f['tags'].filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= 128);
			if (filter.tags.length === 0) delete filter.tags;
		}
		if (typeof f['frontmatter'] === 'string' && f['frontmatter'].length > 0) {
			filter.frontmatter = f['frontmatter'];
		}
		assignTimeBound(f, 'modifiedAfter', filter);
		assignTimeBound(f, 'modifiedBefore', filter);
		assignTimeBound(f, 'createdAfter', filter);
		assignTimeBound(f, 'createdBefore', filter);
		if (filter.modifiedAfter !== undefined && filter.modifiedBefore !== undefined && filter.modifiedAfter > filter.modifiedBefore) {
			throw new Error('mapSearchRequest: filter.modifiedAfter must be <= filter.modifiedBefore');
		}
		if (filter.createdAfter !== undefined && filter.createdBefore !== undefined && filter.createdAfter > filter.createdBefore) {
			throw new Error('mapSearchRequest: filter.createdAfter must be <= filter.createdBefore');
		}
		if (Object.keys(filter).length > 0) result.filter = filter;
	}

	return result;
}

/**
 * Maps raw MCP tool arguments into a CoreOpenNotesRequest.
 * Defaults scope to 'all' when not supplied.
 * @param args - Raw key-value arguments from the MCP tool call.
 * @param keyId - The authenticated API key ID.
 */
export function mapOpenNotesRequest(args: Args, keyId: string): CoreOpenNotesRequest {
	const scope: OpenNotesScope =
		typeof args['scope'] === 'string' && ['active', 'other', 'all'].includes(args['scope'])
			? (args['scope'] as OpenNotesScope)
			: 'all';

	return {kind: 'openNotes', keyId, scope};
}
