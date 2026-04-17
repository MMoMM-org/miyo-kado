/**
 * Behavioral tests for RequestMapper.
 *
 * The mapper is the outer ACL boundary for the MCP layer — it translates raw
 * MCP tool-call arguments into typed canonical request objects and enforces
 * that all required fields are present before anything reaches the Core.
 *
 * All cases are exercised through the public exported functions.
 */

import {describe, it, expect} from 'vitest';
import {
	mapReadRequest,
	mapWriteRequest,
	mapSearchRequest,
	mapDeleteRequest,
} from '../../src/mcp/request-mapper';
import type {
	CoreReadRequest,
	CoreWriteRequest,
	CoreSearchRequest,
	CoreDeleteRequest,
} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const KEY_ID = 'kado_key1';

function makeReadArgs(overrides?: Record<string, unknown>): Record<string, unknown> {
	return {operation: 'note', path: 'a.md', ...overrides};
}

function makeWriteArgs(overrides?: Record<string, unknown>): Record<string, unknown> {
	return {
		operation: 'frontmatter',
		path: 'a.md',
		content: {status: 'done'},
		expectedModified: 12345,
		...overrides,
	};
}

function makeSearchArgs(overrides?: Record<string, unknown>): Record<string, unknown> {
	return {operation: 'byTag', query: '#project', limit: 10, ...overrides};
}

// ---------------------------------------------------------------------------
// mapReadRequest
// ---------------------------------------------------------------------------

describe('mapReadRequest()', () => {
	it('maps valid args to a CoreReadRequest with the given keyId', () => {
		const result = mapReadRequest(makeReadArgs(), KEY_ID) as CoreReadRequest;

		expect(result.apiKeyId).toBe(KEY_ID);
		expect(result.operation).toBe('note');
		expect(result.path).toBe('a.md');
	});

	it('preserves the operation field as-is', () => {
		const result = mapReadRequest(
			makeReadArgs({operation: 'frontmatter'}),
			KEY_ID,
		) as CoreReadRequest;

		expect(result.operation).toBe('frontmatter');
	});

	it('throws or returns a CoreError when operation is missing', () => {
		const args = {path: 'a.md'};

		expect(() => mapReadRequest(args, KEY_ID)).toThrow();
	});

	it('throws or returns a CoreError when path is missing', () => {
		const args = {operation: 'note'};

		expect(() => mapReadRequest(args, KEY_ID)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// mapWriteRequest
// ---------------------------------------------------------------------------

describe('mapWriteRequest()', () => {
	it('maps valid args to a CoreWriteRequest with all fields', () => {
		const result = mapWriteRequest(makeWriteArgs(), KEY_ID) as CoreWriteRequest;

		expect(result.apiKeyId).toBe(KEY_ID);
		expect(result.operation).toBe('frontmatter');
		expect(result.path).toBe('a.md');
		expect(result.content).toEqual({status: 'done'});
		expect(result.expectedModified).toBe(12345);
	});

	it('maps without expectedModified when omitted', () => {
		const args = makeWriteArgs();
		delete args['expectedModified'];

		const result = mapWriteRequest(args, KEY_ID) as CoreWriteRequest;

		expect(result.expectedModified).toBeUndefined();
	});

	it('throws or returns a CoreError when operation is missing', () => {
		const args = {path: 'a.md', content: 'body'};

		expect(() => mapWriteRequest(args, KEY_ID)).toThrow();
	});

	it('throws or returns a CoreError when path is missing', () => {
		const args = {operation: 'note', content: 'body'};

		expect(() => mapWriteRequest(args, KEY_ID)).toThrow();
	});

	it('throws or returns a CoreError when content is missing', () => {
		const args = {operation: 'note', path: 'a.md'};

		expect(() => mapWriteRequest(args, KEY_ID)).toThrow();
	});

	it('coerces JSON string content to object for frontmatter operation', () => {
		const args = {operation: 'frontmatter', path: 'a.md', content: '{"status":"done"}'};

		const result = mapWriteRequest(args, KEY_ID) as CoreWriteRequest;

		expect(result.content).toEqual({status: 'done'});
	});

	it('coerces JSON string content to object for dataview-inline-field operation', () => {
		const args = {operation: 'dataview-inline-field', path: 'a.md', content: '{"priority":"high"}'};

		const result = mapWriteRequest(args, KEY_ID) as CoreWriteRequest;

		expect(result.content).toEqual({priority: 'high'});
	});

	it('keeps string content as-is for note operation', () => {
		const args = {operation: 'note', path: 'a.md', content: '{"not":"parsed"}'};

		const result = mapWriteRequest(args, KEY_ID) as CoreWriteRequest;

		expect(result.content).toBe('{"not":"parsed"}');
	});

	it('keeps non-JSON string as-is for frontmatter operation', () => {
		const args = {operation: 'frontmatter', path: 'a.md', content: 'not json'};

		const result = mapWriteRequest(args, KEY_ID) as CoreWriteRequest;

		expect(result.content).toBe('not json');
	});
});

// ---------------------------------------------------------------------------
// mapSearchRequest
// ---------------------------------------------------------------------------

describe('mapSearchRequest()', () => {
	it('maps valid args to a CoreSearchRequest with all fields', () => {
		const result = mapSearchRequest(makeSearchArgs(), KEY_ID) as CoreSearchRequest;

		expect(result.apiKeyId).toBe(KEY_ID);
		expect(result.operation).toBe('byTag');
		expect(result.query).toBe('#project');
		expect(result.limit).toBe(10);
	});

	it('maps without optional fields when omitted', () => {
		const result = mapSearchRequest({operation: 'listTags'}, KEY_ID) as CoreSearchRequest;

		expect(result.operation).toBe('listTags');
		expect(result.query).toBeUndefined();
		expect(result.path).toBeUndefined();
		expect(result.cursor).toBeUndefined();
		expect(result.limit).toBeUndefined();
	});

	it('maps path and cursor when provided', () => {
		const result = mapSearchRequest(
			{operation: 'listDir', path: 'notes/', cursor: 'tok_abc'},
			KEY_ID,
		) as CoreSearchRequest;

		expect(result.path).toBe('notes/');
		expect(result.cursor).toBe('tok_abc');
	});

	it('throws or returns a CoreError when operation is missing', () => {
		const args = {query: '#project'};

		expect(() => mapSearchRequest(args, KEY_ID)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// mapSearchRequest — depth validation
// ---------------------------------------------------------------------------

describe('mapSearchRequest — depth validation', () => {
	it('depth: 1 → result.depth === 1', () => {
		const result = mapSearchRequest(makeSearchArgs({depth: 1}), KEY_ID) as CoreSearchRequest;

		expect(result.depth).toBe(1);
	});

	it('depth: 3 → result.depth === 3', () => {
		const result = mapSearchRequest(makeSearchArgs({depth: 3}), KEY_ID) as CoreSearchRequest;

		expect(result.depth).toBe(3);
	});

	it('depth: 0 → throws with message matching /depth must be a positive integer/', () => {
		expect(() => mapSearchRequest(makeSearchArgs({depth: 0}), KEY_ID)).toThrow(/depth must be a positive integer/);
	});

	it('depth: -1 → throws', () => {
		expect(() => mapSearchRequest(makeSearchArgs({depth: -1}), KEY_ID)).toThrow(/depth must be a positive integer/);
	});

	it('depth: 1.5 → throws', () => {
		expect(() => mapSearchRequest(makeSearchArgs({depth: 1.5}), KEY_ID)).toThrow(/depth must be a positive integer/);
	});

	it('depth: "1" (string) → throws', () => {
		expect(() => mapSearchRequest(makeSearchArgs({depth: '1'}), KEY_ID)).toThrow(/depth must be a positive integer/);
	});

	it('depth omitted → result.depth === undefined', () => {
		const result = mapSearchRequest(makeSearchArgs(), KEY_ID) as CoreSearchRequest;

		expect(result.depth).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// mapSearchRequest — path handling (/ and empty)
// ---------------------------------------------------------------------------

describe('mapSearchRequest — path handling (/ and empty)', () => {
	it('path: "/" → result.path === undefined (canonical root)', () => {
		const result = mapSearchRequest(makeSearchArgs({path: '/'}), KEY_ID) as CoreSearchRequest;

		expect(result.path).toBeUndefined();
	});

	it('path: "" with listDir → throws with message matching /path must not be empty/', () => {
		expect(() => mapSearchRequest({operation: 'listDir', path: ''}, KEY_ID)).toThrow(/path must not be empty/);
	});

	it('path with non-listDir operation → ignored', () => {
		const result = mapSearchRequest(makeSearchArgs({path: 'notes/'}), KEY_ID) as CoreSearchRequest;

		expect(result.path).toBeUndefined();
	});

	it('path omitted → result.path === undefined', () => {
		const result = mapSearchRequest({operation: 'listDir'}, KEY_ID) as CoreSearchRequest;

		expect(result.path).toBeUndefined();
	});

	it('path: "Atlas" → result.path === "Atlas/" (existing normalization preserved)', () => {
		const result = mapSearchRequest({operation: 'listDir', path: 'Atlas'}, KEY_ID) as CoreSearchRequest;

		expect(result.path).toBe('Atlas/');
	});

	it('path: "Atlas/" → result.path === "Atlas/" (existing, unchanged)', () => {
		const result = mapSearchRequest({operation: 'listDir', path: 'Atlas/'}, KEY_ID) as CoreSearchRequest;

		expect(result.path).toBe('Atlas/');
	});

	it('byContent with path: "/" → result.path === undefined (global fix, covers all search ops)', () => {
		const result = mapSearchRequest({operation: 'byContent', path: '/'}, KEY_ID) as CoreSearchRequest;

		expect(result.path).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// mapSearchRequest — filter parsing
// ---------------------------------------------------------------------------

describe('mapSearchRequest — filter parsing', () => {
	it('filter with path normalizes trailing slash', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {path: 'notes'}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter?.path).toBe('notes/');
	});

	it('filter with path preserves existing trailing slash', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {path: 'notes/'}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter?.path).toBe('notes/');
	});

	it('filter with tags array', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {tags: ['#project', '#status/active']}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter?.tags).toEqual(['#project', '#status/active']);
	});

	it('filter with frontmatter key=value', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {frontmatter: 'status=active'}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter?.frontmatter).toBe('status=active');
	});

	it('filter with frontmatter key-only', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {frontmatter: 'status'}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter?.frontmatter).toBe('status');
	});

	it('filter with all three fields', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {path: 'notes', tags: ['#project'], frontmatter: 'status=done'}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter).toEqual({path: 'notes/', tags: ['#project'], frontmatter: 'status=done'});
	});

	it('empty filter object → no filter on result', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter).toBeUndefined();
	});

	it('filter with empty path → no filter.path', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {path: ''}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter).toBeUndefined();
	});

	it('filter with empty tags array → no filter.tags', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {tags: []}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter).toBeUndefined();
	});

	it('filter with non-string tags entries → filtered out', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {tags: ['#valid', '', 123]}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter?.tags).toEqual(['#valid']);
	});

	it('filter undefined → no filter on result', () => {
		const result = mapSearchRequest(makeSearchArgs(), KEY_ID) as CoreSearchRequest;

		expect(result.filter).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// mapDeleteRequest
// ---------------------------------------------------------------------------

function makeDeleteArgs(overrides?: Record<string, unknown>): Record<string, unknown> {
	return {operation: 'note', path: 'a.md', expectedModified: 12345, ...overrides};
}

describe('mapDeleteRequest()', () => {
	it('maps a valid note delete request', () => {
		const result = mapDeleteRequest(makeDeleteArgs(), KEY_ID) as CoreDeleteRequest;

		expect(result).toMatchObject({
			kind: 'delete',
			apiKeyId: KEY_ID,
			operation: 'note',
			path: 'a.md',
			expectedModified: 12345,
		});
		expect(result.keys).toBeUndefined();
	});

	it('maps a valid file delete request', () => {
		const result = mapDeleteRequest(
			makeDeleteArgs({operation: 'file', path: 'img.png'}),
			KEY_ID,
		) as CoreDeleteRequest;

		expect(result.operation).toBe('file');
		expect(result.path).toBe('img.png');
	});

	it('maps a valid frontmatter delete request with keys array', () => {
		const result = mapDeleteRequest(
			makeDeleteArgs({operation: 'frontmatter', keys: ['tag1', 'status']}),
			KEY_ID,
		) as CoreDeleteRequest;

		expect(result.operation).toBe('frontmatter');
		expect(result.keys).toEqual(['tag1', 'status']);
	});

	it('rejects operation="dataview-inline-field" with VALIDATION_ERROR', () => {
		expect(() => mapDeleteRequest(
			makeDeleteArgs({operation: 'dataview-inline-field'}),
			KEY_ID,
		)).toThrow(/operation must be one of/);
	});

	it('rejects operation="unknown" with VALIDATION_ERROR', () => {
		expect(() => mapDeleteRequest(
			makeDeleteArgs({operation: 'unknown'}),
			KEY_ID,
		)).toThrow(/operation must be one of/);
	});

	it('rejects missing operation', () => {
		expect(() => mapDeleteRequest({path: 'a.md', expectedModified: 1}, KEY_ID))
			.toThrow(/missing required field "operation"/);
	});

	it('rejects missing path', () => {
		expect(() => mapDeleteRequest({operation: 'note', expectedModified: 1}, KEY_ID))
			.toThrow(/missing required field "path"/);
	});

	it('rejects missing expectedModified', () => {
		expect(() => mapDeleteRequest({operation: 'note', path: 'a.md'}, KEY_ID))
			.toThrow(/missing required field "expectedModified"/);
	});

	it('rejects non-numeric expectedModified', () => {
		expect(() => mapDeleteRequest(
			makeDeleteArgs({expectedModified: 'not-a-number'}),
			KEY_ID,
		)).toThrow(/expectedModified must be a number/);
	});

	it('rejects frontmatter delete without keys', () => {
		expect(() => mapDeleteRequest(
			makeDeleteArgs({operation: 'frontmatter'}),
			KEY_ID,
		)).toThrow(/non-empty "keys" array/);
	});

	it('rejects frontmatter delete with empty keys array', () => {
		expect(() => mapDeleteRequest(
			makeDeleteArgs({operation: 'frontmatter', keys: []}),
			KEY_ID,
		)).toThrow(/non-empty "keys" array/);
	});

	it('rejects frontmatter delete with non-string keys', () => {
		expect(() => mapDeleteRequest(
			makeDeleteArgs({operation: 'frontmatter', keys: [123, 'valid']}),
			KEY_ID,
		)).toThrow(/all items in "keys"/);
	});

	it('rejects frontmatter delete with empty-string key', () => {
		expect(() => mapDeleteRequest(
			makeDeleteArgs({operation: 'frontmatter', keys: ['', 'valid']}),
			KEY_ID,
		)).toThrow(/all items in "keys"/);
	});

	it('ignores keys field when operation is note', () => {
		const result = mapDeleteRequest(
			makeDeleteArgs({keys: ['ignored']}),
			KEY_ID,
		) as CoreDeleteRequest;

		expect(result.operation).toBe('note');
		// keys field is only validated/attached for frontmatter; for note it's not required
		// (implementation may pass through or omit — test just ensures no error)
	});
});
