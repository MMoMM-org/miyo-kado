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
} from '../../src/mcp/request-mapper';
import type {
	CoreReadRequest,
	CoreWriteRequest,
	CoreSearchRequest,
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

	it('path: "" → throws with message matching /path must not be empty.*Use \'\\/\' to list the vault root\\./', () => {
		expect(() => mapSearchRequest(makeSearchArgs({path: ''}), KEY_ID)).toThrow(/path must not be empty/);
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
