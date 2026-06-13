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
	mapOpenNotesRequest,
	parseHeadingTarget,
} from '../../src/mcp/request-mapper';
import {kadoOpenNotesShape} from '../../src/mcp/tools';
import type {
	CoreReadRequest,
	CoreWriteRequest,
	CoreSearchRequest,
	CoreDeleteRequest,
	CoreOpenNotesRequest,
	NoteWritePartial,
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
// mapWriteRequest — extension/operation strict separation
// ---------------------------------------------------------------------------

describe('mapWriteRequest — extension/operation strict separation', () => {
	it('operation="note" + .json path → throws with "use operation=file"', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: '100 Inbox/data.json', content: '{}'},
			KEY_ID,
		)).toThrow(/operation="note" requires a \.md path.*use operation="file"/i);
	});

	it('operation="frontmatter" + .json path → throws', () => {
		expect(() => mapWriteRequest(
			{operation: 'frontmatter', path: 'a.json', content: {x: 1}, expectedModified: 1},
			KEY_ID,
		)).toThrow(/operation="frontmatter" requires a \.md path/i);
	});

	it('operation="dataview-inline-field" + .json path → throws', () => {
		expect(() => mapWriteRequest(
			{operation: 'dataview-inline-field', path: 'a.json', content: {x: 1}, expectedModified: 1},
			KEY_ID,
		)).toThrow(/operation="dataview-inline-field" requires a \.md path/i);
	});

	it('operation="file" + .md path → throws with "use operation=note"', () => {
		expect(() => mapWriteRequest(
			{operation: 'file', path: 'a.md', content: 'base64=='},
			KEY_ID,
		)).toThrow(/operation="file" must not target a \.md path.*use operation="note"/i);
	});

	it('operation="note" + .md path → accepts', () => {
		const result = mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body'},
			KEY_ID,
		) as CoreWriteRequest;
		expect(result.operation).toBe('note');
	});

	it('operation="file" + .png path → accepts', () => {
		const result = mapWriteRequest(
			{operation: 'file', path: 'img.png', content: 'base64=='},
			KEY_ID,
		) as CoreWriteRequest;
		expect(result.operation).toBe('file');
	});

	it('extension check is case-insensitive (.MD → treated as markdown)', () => {
		expect(() => mapWriteRequest(
			{operation: 'file', path: 'A.MD', content: 'base64=='},
			KEY_ID,
		)).toThrow(/must not target a \.md path/i);
	});

	it('operation="note" + path without extension → throws', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'noext', content: 'body'},
			KEY_ID,
		)).toThrow(/operation="note" requires a \.md path/i);
	});
});

// ---------------------------------------------------------------------------
// mapWriteRequest — frontmatter mode field
// ---------------------------------------------------------------------------

describe('mapWriteRequest — frontmatter mode field', () => {
	it('passes through mode="merge"', () => {
		const result = mapWriteRequest(makeWriteArgs({mode: 'merge'}), KEY_ID) as CoreWriteRequest;
		expect(result.mode).toBe('merge');
	});

	it('passes through mode="replace"', () => {
		const result = mapWriteRequest(makeWriteArgs({mode: 'replace'}), KEY_ID) as CoreWriteRequest;
		expect(result.mode).toBe('replace');
	});

	it('omits mode when not supplied (adapter default applies)', () => {
		const result = mapWriteRequest(makeWriteArgs(), KEY_ID) as CoreWriteRequest;
		expect(result.mode).toBeUndefined();
	});

	it('rejects an unknown mode value', () => {
		expect(() => mapWriteRequest(
			makeWriteArgs({mode: 'overwrite'}),
			KEY_ID,
		)).toThrow(/mode must be "merge" or "replace"/i);
	});

	it('rejects a frontmatter mode on operation="note"', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'merge'},
			KEY_ID,
		)).toThrow(/mapWriteRequest:.*mode.*append|prepend|insertUnderHeading|replaceSection|replaceRange/i);
	});
});

// ---------------------------------------------------------------------------
// mapReadRequest — extension/operation strict separation
// ---------------------------------------------------------------------------

describe('mapReadRequest — extension/operation strict separation', () => {
	it('operation="note" + .json path → throws', () => {
		expect(() => mapReadRequest(
			{operation: 'note', path: 'a.json'},
			KEY_ID,
		)).toThrow(/operation="note" requires a \.md path/i);
	});

	it('operation="frontmatter" + .json path → throws', () => {
		expect(() => mapReadRequest(
			{operation: 'frontmatter', path: 'a.json'},
			KEY_ID,
		)).toThrow(/operation="frontmatter" requires a \.md path/i);
	});

	it('operation="tags" + .json path → throws', () => {
		expect(() => mapReadRequest(
			{operation: 'tags', path: 'a.json'},
			KEY_ID,
		)).toThrow(/operation="tags" requires a \.md path/i);
	});

	it('operation="file" + .md path → throws', () => {
		expect(() => mapReadRequest(
			{operation: 'file', path: 'a.md'},
			KEY_ID,
		)).toThrow(/operation="file" must not target a \.md path/i);
	});

	it('operation="note" + .md path → accepts', () => {
		const result = mapReadRequest({operation: 'note', path: 'a.md'}, KEY_ID);
		expect(result.operation).toBe('note');
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

	it('listNotes path: "Atlas" → result.path === "Atlas/" (same normalization as listDir)', () => {
		const result = mapSearchRequest({operation: 'listNotes', path: 'Atlas'}, KEY_ID) as CoreSearchRequest;

		expect(result.path).toBe('Atlas/');
	});

	it('listNotes path: "" → throws with /path must not be empty/', () => {
		expect(() => mapSearchRequest({operation: 'listNotes', path: ''}, KEY_ID)).toThrow(/path must not be empty/);
	});
});

// ---------------------------------------------------------------------------
// mapSearchRequest — listNotes fields projection
// ---------------------------------------------------------------------------

describe('mapSearchRequest — fields projection', () => {
	it('maps a fields array onto the request', () => {
		const result = mapSearchRequest({operation: 'listNotes', fields: ['links', 'headings', 'tags']}, KEY_ID) as CoreSearchRequest;

		expect(result.fields).toEqual(['links', 'headings', 'tags']);
	});

	it('drops non-string and empty entries, omitting the key when nothing remains', () => {
		const result = mapSearchRequest({operation: 'listNotes', fields: [1, '', null]}, KEY_ID) as CoreSearchRequest;

		expect(result.fields).toBeUndefined();
	});

	it('omits fields when not supplied', () => {
		const result = mapSearchRequest({operation: 'listNotes'}, KEY_ID) as CoreSearchRequest;

		expect(result.fields).toBeUndefined();
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

	it('filter.path with traversal segment → throws', () => {
		expect(() => mapSearchRequest(makeSearchArgs({filter: {path: '../secret'}}), KEY_ID)).toThrow(/filter\.path.*traversal/);
	});

	it('filter.path with null byte → throws', () => {
		expect(() => mapSearchRequest(makeSearchArgs({filter: {path: 'notes/\0hidden'}}), KEY_ID)).toThrow(/filter\.path.*null/);
	});

	it('filter.path with encoded traversal → throws', () => {
		expect(() => mapSearchRequest(makeSearchArgs({filter: {path: '%2e%2e/secret'}}), KEY_ID)).toThrow(/filter\.path.*traversal/);
	});

	it('filter.path exceeding 512 chars → throws', () => {
		const longPath = 'a'.repeat(513);
		expect(() => mapSearchRequest(makeSearchArgs({filter: {path: longPath}}), KEY_ID)).toThrow(/512 characters/);
	});

	it('filter.tags entries exceeding 128 chars → silently dropped', () => {
		const longTag = '#' + 'a'.repeat(128);
		const result = mapSearchRequest(makeSearchArgs({filter: {tags: [longTag, '#valid']}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter?.tags).toEqual(['#valid']);
	});

	it('filter.tags all entries exceeding 128 chars → no filter.tags', () => {
		const longTag = '#' + 'a'.repeat(128);
		const result = mapSearchRequest(makeSearchArgs({filter: {tags: [longTag]}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter).toBeUndefined();
	});

	it('filter.modifiedAfter accepts a non-negative integer (Unix ms)', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {modifiedAfter: 1747000000000}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter?.modifiedAfter).toBe(1747000000000);
	});

	it('filter.modifiedAfter accepts zero (epoch)', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {modifiedAfter: 0}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter?.modifiedAfter).toBe(0);
	});

	it('filter with all four time bounds passes through', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {
			modifiedAfter: 1000,
			modifiedBefore: 2000,
			createdAfter: 500,
			createdBefore: 3000,
		}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter).toMatchObject({
			modifiedAfter: 1000,
			modifiedBefore: 2000,
			createdAfter: 500,
			createdBefore: 3000,
		});
	});

	it('filter.modifiedAfter as non-number → throws', () => {
		expect(() => mapSearchRequest(makeSearchArgs({filter: {modifiedAfter: '1747000000000'}}), KEY_ID))
			.toThrow(/filter\.modifiedAfter.*non-negative finite/);
	});

	it('filter.modifiedAfter negative → throws', () => {
		expect(() => mapSearchRequest(makeSearchArgs({filter: {modifiedAfter: -1}}), KEY_ID))
			.toThrow(/filter\.modifiedAfter.*non-negative finite/);
	});

	it('filter.createdBefore not finite → throws', () => {
		expect(() => mapSearchRequest(makeSearchArgs({filter: {createdBefore: Infinity}}), KEY_ID))
			.toThrow(/filter\.createdBefore.*non-negative finite/);
	});

	it('filter.modifiedAfter > modifiedBefore → throws', () => {
		expect(() => mapSearchRequest(makeSearchArgs({filter: {modifiedAfter: 2000, modifiedBefore: 1000}}), KEY_ID))
			.toThrow(/modifiedAfter must be <= filter\.modifiedBefore/);
	});

	it('filter.createdAfter > createdBefore → throws', () => {
		expect(() => mapSearchRequest(makeSearchArgs({filter: {createdAfter: 2000, createdBefore: 1000}}), KEY_ID))
			.toThrow(/createdAfter must be <= filter\.createdBefore/);
	});

	it('filter.modifiedAfter combines with existing path filter', () => {
		const result = mapSearchRequest(makeSearchArgs({filter: {path: 'inbox', modifiedAfter: 1000}}), KEY_ID) as CoreSearchRequest;

		expect(result.filter?.path).toBe('inbox/');
		expect(result.filter?.modifiedAfter).toBe(1000);
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

	it('operation="note" + .json path → throws', () => {
		expect(() => mapDeleteRequest(
			makeDeleteArgs({operation: 'note', path: 'a.json'}),
			KEY_ID,
		)).toThrow(/operation="note" requires a \.md path/i);
	});

	it('operation="frontmatter" + .json path → throws', () => {
		expect(() => mapDeleteRequest(
			makeDeleteArgs({operation: 'frontmatter', path: 'a.json', keys: ['k']}),
			KEY_ID,
		)).toThrow(/operation="frontmatter" requires a \.md path/i);
	});

	it('operation="file" + .md path → throws', () => {
		expect(() => mapDeleteRequest(
			makeDeleteArgs({operation: 'file', path: 'a.md'}),
			KEY_ID,
		)).toThrow(/operation="file" must not target a \.md path/i);
	});

	it('operation="file" + .png path → accepts', () => {
		const result = mapDeleteRequest(
			makeDeleteArgs({operation: 'file', path: 'img.png'}),
			KEY_ID,
		) as CoreDeleteRequest;
		expect(result.operation).toBe('file');
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

// ---------------------------------------------------------------------------
// mapOpenNotesRequest
// ---------------------------------------------------------------------------

describe('mapOpenNotesRequest()', () => {
	it('defaults scope to "all" when not supplied', () => {
		const result = mapOpenNotesRequest({}, KEY_ID) as CoreOpenNotesRequest;

		expect(result.kind).toBe('openNotes');
		expect(result.keyId).toBe(KEY_ID);
		expect(result.scope).toBe('all');
	});

	it('passes through scope "active"', () => {
		const result = mapOpenNotesRequest({scope: 'active'}, KEY_ID) as CoreOpenNotesRequest;

		expect(result.scope).toBe('active');
	});

	it('passes through scope "other"', () => {
		const result = mapOpenNotesRequest({scope: 'other'}, KEY_ID) as CoreOpenNotesRequest;

		expect(result.scope).toBe('other');
	});

	it('passes through scope "all" explicitly', () => {
		const result = mapOpenNotesRequest({scope: 'all'}, KEY_ID) as CoreOpenNotesRequest;

		expect(result.scope).toBe('all');
	});

	it('sets kind to "openNotes"', () => {
		const result = mapOpenNotesRequest({}, KEY_ID) as CoreOpenNotesRequest;

		expect(result.kind).toBe('openNotes');
	});

	it('includes the keyId in the result', () => {
		const result = mapOpenNotesRequest({}, 'kado_key_xyz') as CoreOpenNotesRequest;

		expect(result.keyId).toBe('kado_key_xyz');
	});
});

// ---------------------------------------------------------------------------
// kadoOpenNotesShape (Zod schema boundary)
// ---------------------------------------------------------------------------

describe('kadoOpenNotesShape — Zod schema boundary', () => {
	it('accepts an empty object (scope optional)', () => {
		const schema = kadoOpenNotesShape;

		expect(() => schema.scope?.parse(undefined)).not.toThrow();
	});

	it('accepts scope "active"', () => {
		const result = kadoOpenNotesShape.scope?.parse('active');

		expect(result).toBe('active');
	});

	it('accepts scope "other"', () => {
		const result = kadoOpenNotesShape.scope?.parse('other');

		expect(result).toBe('other');
	});

	it('accepts scope "all"', () => {
		const result = kadoOpenNotesShape.scope?.parse('all');

		expect(result).toBe('all');
	});

	it('rejects an invalid scope value', () => {
		expect(() => kadoOpenNotesShape.scope?.parse('invalid')).toThrow();
	});

	it('rejects scope "ACTIVE" (case-sensitive)', () => {
		expect(() => kadoOpenNotesShape.scope?.parse('ACTIVE')).toThrow();
	});
});

// ---------------------------------------------------------------------------
// mapReadRequest — partial read mode (T3.1)
// ---------------------------------------------------------------------------

describe('mapReadRequest — partial read: omitted mode', () => {
	it('no mode → no partial field on result', () => {
		const result = mapReadRequest(makeReadArgs(), KEY_ID);

		expect(result.partial).toBeUndefined();
	});

	it('operation="frontmatter" without mode → no partial field', () => {
		const result = mapReadRequest(makeReadArgs({operation: 'frontmatter'}), KEY_ID);

		expect(result.partial).toBeUndefined();
	});
});

describe('mapReadRequest — partial read: unknown mode', () => {
	it('mode="bogus" → throws', () => {
		expect(() => mapReadRequest(makeReadArgs({mode: 'bogus'}), KEY_ID))
			.toThrow(/mapReadRequest:.*mode/i);
	});
});

describe('mapReadRequest — partial read: mode only valid for operation="note"', () => {
	it('mode="firstXChars" with operation="frontmatter" → throws', () => {
		expect(() => mapReadRequest(
			makeReadArgs({operation: 'frontmatter', mode: 'firstXChars', limit: 100}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*mode.*note/i);
	});

	it('mode="firstXChars" with operation="file" → throws', () => {
		expect(() => mapReadRequest(
			{operation: 'file', path: 'img.png', mode: 'firstXChars', limit: 100},
			KEY_ID,
		)).toThrow(/mapReadRequest:.*mode.*note/i);
	});

	it('mode="firstXChars" with operation="tags" → throws', () => {
		expect(() => mapReadRequest(
			makeReadArgs({operation: 'tags', mode: 'firstXChars', limit: 100}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*mode.*note/i);
	});
});

describe('mapReadRequest — partial read: mode=firstXChars', () => {
	it('valid limit → partial {mode:"firstXChars", limit}', () => {
		const result = mapReadRequest(makeReadArgs({mode: 'firstXChars', limit: 500}), KEY_ID);

		expect(result.partial).toEqual({mode: 'firstXChars', limit: 500});
	});

	it('limit missing → throws', () => {
		expect(() => mapReadRequest(makeReadArgs({mode: 'firstXChars'}), KEY_ID))
			.toThrow(/mapReadRequest:.*limit/i);
	});

	it('limit=0 → throws (must be positive)', () => {
		expect(() => mapReadRequest(makeReadArgs({mode: 'firstXChars', limit: 0}), KEY_ID))
			.toThrow(/mapReadRequest:.*limit/i);
	});

	it('limit negative → throws', () => {
		expect(() => mapReadRequest(makeReadArgs({mode: 'firstXChars', limit: -1}), KEY_ID))
			.toThrow(/mapReadRequest:.*limit/i);
	});

	it('limit non-integer (1.5) → throws', () => {
		expect(() => mapReadRequest(makeReadArgs({mode: 'firstXChars', limit: 1.5}), KEY_ID))
			.toThrow(/mapReadRequest:.*limit/i);
	});

	it('limit as string → throws', () => {
		expect(() => mapReadRequest(makeReadArgs({mode: 'firstXChars', limit: '500'}), KEY_ID))
			.toThrow(/mapReadRequest:.*limit/i);
	});
});

describe('mapReadRequest — partial read: mode=section', () => {
	it('valid heading → partial {mode:"section", heading}', () => {
		const result = mapReadRequest(makeReadArgs({mode: 'section', heading: 'Introduction'}), KEY_ID);

		expect(result.partial).toEqual({mode: 'section', heading: 'Introduction'});
	});

	it('valid headingPath → partial {mode:"section", headingPath}', () => {
		const result = mapReadRequest(makeReadArgs({mode: 'section', headingPath: ['Chapter 1', 'Overview']}), KEY_ID);

		expect(result.partial).toEqual({mode: 'section', headingPath: ['Chapter 1', 'Overview']});
	});

	it('both heading and headingPath → throws', () => {
		expect(() => mapReadRequest(
			makeReadArgs({mode: 'section', heading: 'Intro', headingPath: ['Intro']}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*heading/i);
	});

	it('neither heading nor headingPath → throws', () => {
		expect(() => mapReadRequest(makeReadArgs({mode: 'section'}), KEY_ID))
			.toThrow(/mapReadRequest:.*heading/i);
	});

	it('heading empty string → throws', () => {
		expect(() => mapReadRequest(makeReadArgs({mode: 'section', heading: ''}), KEY_ID))
			.toThrow(/mapReadRequest:.*heading/i);
	});

	it('headingPath empty array → throws', () => {
		expect(() => mapReadRequest(makeReadArgs({mode: 'section', headingPath: []}), KEY_ID))
			.toThrow(/mapReadRequest:.*heading/i);
	});

	it('headingPath with empty-string element → throws', () => {
		expect(() => mapReadRequest(
			makeReadArgs({mode: 'section', headingPath: ['Chapter 1', '']}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*heading/i);
	});

	it('headingPath with non-string element → throws', () => {
		expect(() => mapReadRequest(
			makeReadArgs({mode: 'section', headingPath: ['Chapter 1', 42]}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*heading/i);
	});
});

describe('mapReadRequest — partial read: mode=range', () => {
	it('valid line range → partial {mode:"range", basis:"line", start, end}', () => {
		const result = mapReadRequest(
			makeReadArgs({mode: 'range', rangeBasis: 'line', start: 1, end: 10}),
			KEY_ID,
		);

		expect(result.partial).toEqual({mode: 'range', basis: 'line', start: 1, end: 10});
	});

	it('valid char range → partial {mode:"range", basis:"char", start, end}', () => {
		const result = mapReadRequest(
			makeReadArgs({mode: 'range', rangeBasis: 'char', start: 0, end: 100}),
			KEY_ID,
		);

		expect(result.partial).toEqual({mode: 'range', basis: 'char', start: 0, end: 100});
	});

	it('rangeBasis missing → throws', () => {
		expect(() => mapReadRequest(
			makeReadArgs({mode: 'range', start: 1, end: 10}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*rangeBasis/i);
	});

	it('rangeBasis invalid value → throws', () => {
		expect(() => mapReadRequest(
			makeReadArgs({mode: 'range', rangeBasis: 'word', start: 1, end: 10}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*rangeBasis/i);
	});

	it('start missing → throws', () => {
		expect(() => mapReadRequest(
			makeReadArgs({mode: 'range', rangeBasis: 'line', end: 10}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*start/i);
	});

	it('end missing → throws', () => {
		expect(() => mapReadRequest(
			makeReadArgs({mode: 'range', rangeBasis: 'line', start: 1}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*end/i);
	});

	it('start non-integer → throws', () => {
		expect(() => mapReadRequest(
			makeReadArgs({mode: 'range', rangeBasis: 'line', start: 1.5, end: 10}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*start/i);
	});

	it('end non-integer → throws', () => {
		expect(() => mapReadRequest(
			makeReadArgs({mode: 'range', rangeBasis: 'line', start: 1, end: 10.5}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*end/i);
	});

	it('line basis: start=0 → throws (must be ≥ 1)', () => {
		expect(() => mapReadRequest(
			makeReadArgs({mode: 'range', rangeBasis: 'line', start: 0, end: 5}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*start/i);
	});

	it('line basis: start negative → throws', () => {
		expect(() => mapReadRequest(
			makeReadArgs({mode: 'range', rangeBasis: 'line', start: -1, end: 5}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*start/i);
	});

	it('char basis: start=-1 → throws (must be ≥ 0)', () => {
		expect(() => mapReadRequest(
			makeReadArgs({mode: 'range', rangeBasis: 'char', start: -1, end: 100}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*start/i);
	});

	it('char basis: start=0 → valid (0-based)', () => {
		const result = mapReadRequest(
			makeReadArgs({mode: 'range', rangeBasis: 'char', start: 0, end: 50}),
			KEY_ID,
		);

		expect(result.partial).toEqual({mode: 'range', basis: 'char', start: 0, end: 50});
	});

	it('inverted range: start > end → throws', () => {
		expect(() => mapReadRequest(
			makeReadArgs({mode: 'range', rangeBasis: 'line', start: 10, end: 5}),
			KEY_ID,
		)).toThrow(/mapReadRequest:.*start.*end|end.*start/i);
	});

	it('start === end → valid (single line)', () => {
		const result = mapReadRequest(
			makeReadArgs({mode: 'range', rangeBasis: 'line', start: 5, end: 5}),
			KEY_ID,
		);

		expect(result.partial).toEqual({mode: 'range', basis: 'line', start: 5, end: 5});
	});
});

// ---------------------------------------------------------------------------
// parseHeadingTarget — mode-agnostic error message (T3.2 fix)
// ---------------------------------------------------------------------------

describe('parseHeadingTarget — neither heading nor headingPath', () => {
	it('throws a mode-agnostic error (no "section" wording)', () => {
		expect(() => parseHeadingTarget({}, 'testCtx'))
			.toThrow(/testCtx: heading or headingPath is required/i);
	});

	it('error does NOT contain the word "section"', () => {
		try {
			parseHeadingTarget({}, 'testCtx');
		} catch (e) {
			expect((e as Error).message).not.toMatch(/mode="section"/);
		}
	});
});

// ---------------------------------------------------------------------------
// mapWriteRequest — note mode: omitted mode (no change in behaviour)
// ---------------------------------------------------------------------------

describe('mapWriteRequest — note mode: omitted mode', () => {
	it('no mode on operation="note" → no notePartial on result', () => {
		const result = mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body'},
			KEY_ID,
		) as CoreWriteRequest;

		expect(result.notePartial).toBeUndefined();
		expect(result.mode).toBeUndefined();
	});

	it('no mode on operation="frontmatter" → no mode or notePartial on result', () => {
		const result = mapWriteRequest(makeWriteArgs(), KEY_ID) as CoreWriteRequest;

		expect(result.mode).toBeUndefined();
		expect(result.notePartial).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// mapWriteRequest — note mode: unknown mode value
// ---------------------------------------------------------------------------

describe('mapWriteRequest — note mode: unknown mode value', () => {
	it('unknown mode on operation="note" → throws', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'bogus'},
			KEY_ID,
		)).toThrow(/mapWriteRequest:.*mode/i);
	});

	it('unknown mode on operation="note" error lists valid modes', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'bogus'},
			KEY_ID,
		)).toThrow(/append|prepend|insertUnderHeading|replaceSection|replaceRange/i);
	});
});

// ---------------------------------------------------------------------------
// mapWriteRequest — note mode: frontmatter / note mode collision
// ---------------------------------------------------------------------------

describe('mapWriteRequest — note mode: cross-operation mode collision', () => {
	it('frontmatter mode "merge" on operation="note" → error (wrong mode for note)', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'merge'},
			KEY_ID,
		)).toThrow(/mapWriteRequest:.*mode/i);
	});

	it('note mode "append" on operation="frontmatter" → error (wrong mode for frontmatter)', () => {
		expect(() => mapWriteRequest(
			makeWriteArgs({mode: 'append'}),
			KEY_ID,
		)).toThrow(/mapWriteRequest:.*mode must be "merge" or "replace"/i);
	});

	it('note mode "replaceSection" on operation="frontmatter" → error', () => {
		expect(() => mapWriteRequest(
			makeWriteArgs({mode: 'replaceSection'}),
			KEY_ID,
		)).toThrow(/mapWriteRequest:.*mode must be "merge" or "replace"/i);
	});

	it('mode on operation="file" → error', () => {
		expect(() => mapWriteRequest(
			{operation: 'file', path: 'img.png', content: 'base64==', mode: 'append'},
			KEY_ID,
		)).toThrow(/mapWriteRequest:.*mode/i);
	});
});

// ---------------------------------------------------------------------------
// mapWriteRequest — note mode: append / prepend (lock-free)
// ---------------------------------------------------------------------------

describe('mapWriteRequest — note mode: append', () => {
	it('mode="append" with content → notePartial {mode:"append"}', () => {
		const result = mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'new text', mode: 'append'},
			KEY_ID,
		) as CoreWriteRequest;

		expect(result.notePartial).toEqual({mode: 'append'} satisfies NoteWritePartial);
		expect(result.mode).toBeUndefined();
	});

	it('mode="append" without expectedModified → valid (lock-free)', () => {
		const result = mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'new text', mode: 'append'},
			KEY_ID,
		) as CoreWriteRequest;

		expect(result.notePartial).toEqual({mode: 'append'});
		expect(result.expectedModified).toBeUndefined();
	});

	it('mode="append" with expectedModified → valid (optional, passed through)', () => {
		const result = mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'new text', mode: 'append', expectedModified: 99},
			KEY_ID,
		) as CoreWriteRequest;

		expect(result.notePartial).toEqual({mode: 'append'});
		expect(result.expectedModified).toBe(99);
	});
});

describe('mapWriteRequest — note mode: prepend', () => {
	it('mode="prepend" with content → notePartial {mode:"prepend"}', () => {
		const result = mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'header', mode: 'prepend'},
			KEY_ID,
		) as CoreWriteRequest;

		expect(result.notePartial).toEqual({mode: 'prepend'} satisfies NoteWritePartial);
		expect(result.mode).toBeUndefined();
	});

	it('mode="prepend" without expectedModified → valid (lock-free)', () => {
		const result = mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'header', mode: 'prepend'},
			KEY_ID,
		) as CoreWriteRequest;

		expect(result.expectedModified).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// mapWriteRequest — note mode: insertUnderHeading
// ---------------------------------------------------------------------------

describe('mapWriteRequest — note mode: insertUnderHeading', () => {
	it('valid heading → notePartial {mode:"insertUnderHeading", heading}', () => {
		const result = mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'insertUnderHeading', heading: 'Tasks', expectedModified: 1},
			KEY_ID,
		) as CoreWriteRequest;

		expect(result.notePartial).toEqual({mode: 'insertUnderHeading', heading: 'Tasks'} satisfies NoteWritePartial);
	});

	it('valid headingPath → notePartial {mode:"insertUnderHeading", headingPath}', () => {
		const result = mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'insertUnderHeading', headingPath: ['Ch1', 'Sec2'], expectedModified: 1},
			KEY_ID,
		) as CoreWriteRequest;

		expect(result.notePartial).toEqual({mode: 'insertUnderHeading', headingPath: ['Ch1', 'Sec2']} satisfies NoteWritePartial);
	});

	it('both heading and headingPath → error (mutually exclusive)', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'insertUnderHeading', heading: 'Foo', headingPath: ['Foo'], expectedModified: 1},
			KEY_ID,
		)).toThrow(/heading.*headingPath.*mutually exclusive|mutually exclusive/i);
	});

	it('neither heading nor headingPath → error', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'insertUnderHeading', expectedModified: 1},
			KEY_ID,
		)).toThrow(/heading or headingPath is required/i);
	});

	it('missing expectedModified → error (ADR-5)', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'insertUnderHeading', heading: 'Tasks'},
			KEY_ID,
		)).toThrow(/mapWriteRequest:.*expectedModified/i);
	});
});

// ---------------------------------------------------------------------------
// mapWriteRequest — note mode: replaceSection
// ---------------------------------------------------------------------------

describe('mapWriteRequest — note mode: replaceSection', () => {
	it('valid heading → notePartial {mode:"replaceSection", heading}', () => {
		const result = mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'replaceSection', heading: 'Intro', expectedModified: 5},
			KEY_ID,
		) as CoreWriteRequest;

		expect(result.notePartial).toEqual({mode: 'replaceSection', heading: 'Intro'} satisfies NoteWritePartial);
	});

	it('valid headingPath → notePartial {mode:"replaceSection", headingPath}', () => {
		const result = mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'replaceSection', headingPath: ['Ch1'], expectedModified: 5},
			KEY_ID,
		) as CoreWriteRequest;

		expect(result.notePartial).toEqual({mode: 'replaceSection', headingPath: ['Ch1']} satisfies NoteWritePartial);
	});

	it('neither heading nor headingPath → error', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'replaceSection', expectedModified: 5},
			KEY_ID,
		)).toThrow(/heading or headingPath is required/i);
	});

	it('missing expectedModified → error (ADR-5)', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'replaceSection', heading: 'Intro'},
			KEY_ID,
		)).toThrow(/mapWriteRequest:.*expectedModified/i);
	});
});

// ---------------------------------------------------------------------------
// mapWriteRequest — note mode: replaceRange
// ---------------------------------------------------------------------------

describe('mapWriteRequest — note mode: replaceRange', () => {
	it('valid line range → notePartial {mode:"replaceRange", basis:"line", start, end}', () => {
		const result = mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'replaceRange', rangeBasis: 'line', start: 1, end: 10, expectedModified: 3},
			KEY_ID,
		) as CoreWriteRequest;

		expect(result.notePartial).toEqual({mode: 'replaceRange', basis: 'line', start: 1, end: 10} satisfies NoteWritePartial);
	});

	it('valid char range → notePartial {mode:"replaceRange", basis:"char", start, end}', () => {
		const result = mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'replaceRange', rangeBasis: 'char', start: 0, end: 50, expectedModified: 3},
			KEY_ID,
		) as CoreWriteRequest;

		expect(result.notePartial).toEqual({mode: 'replaceRange', basis: 'char', start: 0, end: 50} satisfies NoteWritePartial);
	});

	it('missing rangeBasis → error', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'replaceRange', start: 1, end: 10, expectedModified: 3},
			KEY_ID,
		)).toThrow(/mapWriteRequest:.*rangeBasis/i);
	});

	it('invalid rangeBasis → error', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'replaceRange', rangeBasis: 'word', start: 1, end: 10, expectedModified: 3},
			KEY_ID,
		)).toThrow(/mapWriteRequest:.*rangeBasis/i);
	});

	it('start > end → error', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'replaceRange', rangeBasis: 'line', start: 10, end: 5, expectedModified: 3},
			KEY_ID,
		)).toThrow(/mapWriteRequest:.*start.*end|end.*start/i);
	});

	it('missing expectedModified → error (ADR-5)', () => {
		expect(() => mapWriteRequest(
			{operation: 'note', path: 'a.md', content: 'body', mode: 'replaceRange', rangeBasis: 'line', start: 1, end: 10},
			KEY_ID,
		)).toThrow(/mapWriteRequest:.*expectedModified/i);
	});
});
