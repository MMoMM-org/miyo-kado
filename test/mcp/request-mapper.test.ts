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
