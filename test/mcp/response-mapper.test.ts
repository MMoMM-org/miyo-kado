/**
 * Behavioral tests for ResponseMapper.
 *
 * The mapper is the outbound ACL boundary for the MCP layer — it translates
 * canonical Core result objects into the CallToolResult shape expected by
 * the MCP SDK. All cases are exercised through the public exported functions.
 */

import {describe, it, expect} from 'vitest';
import {
	mapFileResult,
	mapWriteResult,
	mapSearchResult,
	mapDeleteResult,
	mapError,
	mapOpenNotesResult,
} from '../../src/mcp/response-mapper';
import type {
	CoreFileResult,
	CoreWriteResult,
	CoreSearchResult,
	CoreSearchItem,
	CoreDeleteResult,
	CoreError,
	CoreOpenNotesResult,
	OpenNoteDescriptor,
} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeFileResult(overrides?: Partial<CoreFileResult>): CoreFileResult {
	return {
		path: 'notes/a.md',
		content: 'Hello world',
		created: 1000,
		modified: 2000,
		size: 11,
		...overrides,
	};
}

function makeWriteResult(overrides?: Partial<CoreWriteResult>): CoreWriteResult {
	return {
		path: 'notes/a.md',
		created: 1000,
		modified: 2000,
		...overrides,
	};
}

function makeSearchItem(overrides?: Partial<CoreSearchItem>): CoreSearchItem {
	return {
		path: 'notes/a.md',
		name: 'a.md',
		created: 1000,
		modified: 2000,
		size: 11,
		...overrides,
	};
}

function makeSearchResult(overrides?: Partial<CoreSearchResult>): CoreSearchResult {
	return {
		items: [makeSearchItem()],
		...overrides,
	};
}

function makeCoreError(overrides?: Partial<CoreError>): CoreError {
	return {
		code: 'NOT_FOUND',
		message: 'Note not found',
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// mapFileResult
// ---------------------------------------------------------------------------

describe('mapFileResult()', () => {
	it('returns a CallToolResult with a single text content entry', () => {
		const result = mapFileResult(makeFileResult());

		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe('text');
	});

	it('includes path in the text content', () => {
		const result = mapFileResult(makeFileResult({path: 'notes/important.md'}));
		const text = result.content[0].text;

		expect(text).toContain('notes/important.md');
	});

	it('includes file content in the text output', () => {
		const result = mapFileResult(makeFileResult({content: 'Hello world'}));
		const text = result.content[0].text;

		expect(text).toContain('Hello world');
	});

	it('includes created timestamp in the text output', () => {
		const result = mapFileResult(makeFileResult({created: 1000}));
		const text = result.content[0].text;

		expect(text).toContain('1000');
	});

	it('includes modified timestamp in the text output', () => {
		const result = mapFileResult(makeFileResult({modified: 2000}));
		const text = result.content[0].text;

		expect(text).toContain('2000');
	});

	it('does not set isError', () => {
		const result = mapFileResult(makeFileResult());

		expect(result.isError).toBeFalsy();
	});

	it('passes binary (base64 string) content through as-is', () => {
		const base64 = 'SGVsbG8gV29ybGQ=';
		const result = mapFileResult(makeFileResult({content: base64}));
		const text = result.content[0].text;

		expect(text).toContain(base64);
	});
});

// ---------------------------------------------------------------------------
// mapWriteResult
// ---------------------------------------------------------------------------

describe('mapWriteResult()', () => {
	it('returns a CallToolResult with a single text content entry', () => {
		const result = mapWriteResult(makeWriteResult());

		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe('text');
	});

	it('includes path in the text output', () => {
		const result = mapWriteResult(makeWriteResult({path: 'notes/saved.md'}));
		const text = result.content[0].text;

		expect(text).toContain('notes/saved.md');
	});

	it('includes modified timestamp in the text output', () => {
		const result = mapWriteResult(makeWriteResult({modified: 3000}));
		const text = result.content[0].text;

		expect(text).toContain('3000');
	});

	it('does not set isError', () => {
		const result = mapWriteResult(makeWriteResult());

		expect(result.isError).toBeFalsy();
	});
});

// ---------------------------------------------------------------------------
// mapSearchResult
// ---------------------------------------------------------------------------

describe('mapSearchResult()', () => {
	it('returns a CallToolResult with a single text content entry', () => {
		const result = mapSearchResult(makeSearchResult());

		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe('text');
	});

	it('includes JSON-stringified items in the text output', () => {
		const item = makeSearchItem({path: 'notes/b.md', name: 'b.md'});
		const result = mapSearchResult(makeSearchResult({items: [item]}));
		const text = result.content[0].text;

		expect(text).toContain('notes/b.md');
		expect(text).toContain('b.md');
	});

	it('includes cursor when present', () => {
		const result = mapSearchResult(makeSearchResult({cursor: 'tok_next'}));
		const text = result.content[0].text;

		expect(text).toContain('tok_next');
	});

	it('handles empty items array', () => {
		const result = mapSearchResult(makeSearchResult({items: []}));

		expect(result.content[0].text).toBeDefined();
		expect(result.isError).toBeFalsy();
	});

	it('does not set isError', () => {
		const result = mapSearchResult(makeSearchResult());

		expect(result.isError).toBeFalsy();
	});
});

// ---------------------------------------------------------------------------
// mapError
// ---------------------------------------------------------------------------

describe('mapError()', () => {
	it('returns a CallToolResult with isError set to true', () => {
		const result = mapError(makeCoreError());

		expect(result.isError).toBe(true);
	});

	it('returns a single text content entry', () => {
		const result = mapError(makeCoreError());

		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe('text');
	});

	it('includes the error message in the text output', () => {
		const result = mapError(makeCoreError({message: 'Note not found'}));
		const text = result.content[0].text;

		expect(text).toContain('Note not found');
	});

	it('includes the error code in the text output', () => {
		const result = mapError(makeCoreError({code: 'FORBIDDEN'}));
		const text = result.content[0].text;

		expect(text).toContain('FORBIDDEN');
	});

	it('does not leak gate name in error output (SEC-014)', () => {
		const result = mapError(makeCoreError({gate: 'authenticate'}));
		const text = result.content[0].text;

		expect(text).not.toContain('authenticate');
		expect(text).not.toContain('gate');
	});

	it('handles errors without a gate field', () => {
		const result = mapError(makeCoreError({gate: undefined}));

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// mapDeleteResult
// ---------------------------------------------------------------------------

describe('mapDeleteResult()', () => {
	it('returns {path} for note/file delete (no modified timestamp)', () => {
		const result: CoreDeleteResult = {path: 'notes/a.md'};
		const mapped = mapDeleteResult(result);

		expect(mapped.content).toHaveLength(1);
		const body = JSON.parse(mapped.content[0].text as string) as Record<string, unknown>;
		expect(body).toEqual({path: 'notes/a.md'});
		expect('modified' in body).toBe(false);
	});

	it('returns {path, modified} for frontmatter delete (file still exists)', () => {
		const result: CoreDeleteResult = {path: 'notes/a.md', modified: 5000};
		const mapped = mapDeleteResult(result);

		const body = JSON.parse(mapped.content[0].text as string) as Record<string, unknown>;
		expect(body).toEqual({path: 'notes/a.md', modified: 5000});
	});

	it('omits modified when explicitly undefined', () => {
		const result: CoreDeleteResult = {path: 'notes/a.md', modified: undefined};
		const mapped = mapDeleteResult(result);

		const body = JSON.parse(mapped.content[0].text as string) as Record<string, unknown>;
		expect(body).toEqual({path: 'notes/a.md'});
	});

	it('result has content type "text"', () => {
		const mapped = mapDeleteResult({path: 'a.md'});
		expect(mapped.content[0].type).toBe('text');
	});

	it('is not flagged as error', () => {
		const mapped = mapDeleteResult({path: 'a.md'});
		expect(mapped.isError).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// mapOpenNotesResult
// ---------------------------------------------------------------------------

function makeOpenNoteDescriptor(overrides?: Partial<OpenNoteDescriptor>): OpenNoteDescriptor {
	return {
		name: 'a.md',
		path: 'notes/a.md',
		active: false,
		type: 'markdown',
		...overrides,
	};
}

function makeOpenNotesResult(overrides?: Partial<CoreOpenNotesResult>): CoreOpenNotesResult {
	return {
		notes: [makeOpenNoteDescriptor()],
		...overrides,
	};
}

describe('mapOpenNotesResult()', () => {
	it('returns a CallToolResult with a single text content entry', () => {
		const result = mapOpenNotesResult(makeOpenNotesResult());

		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe('text');
	});

	it('does not set isError', () => {
		const result = mapOpenNotesResult(makeOpenNotesResult());

		expect(result.isError).toBeFalsy();
	});

	it('produces valid JSON in content[0].text', () => {
		const result = mapOpenNotesResult(makeOpenNotesResult());

		expect(() => JSON.parse(result.content[0].text as string)).not.toThrow();
	});

	it('JSON shape has top-level "notes" array', () => {
		const result = mapOpenNotesResult(makeOpenNotesResult());
		const body = JSON.parse(result.content[0].text as string) as {notes: unknown};

		expect(Array.isArray(body.notes)).toBe(true);
	});

	it('each note descriptor has exactly name, path, active, type keys', () => {
		const descriptor = makeOpenNoteDescriptor({name: 'b.md', path: 'notes/b.md', active: true, type: 'canvas'});
		const result = mapOpenNotesResult(makeOpenNotesResult({notes: [descriptor]}));
		const body = JSON.parse(result.content[0].text as string) as {notes: Array<Record<string, unknown>>};
		const note = body.notes[0] as Record<string, unknown>;

		expect(Object.keys(note).sort()).toEqual(['active', 'name', 'path', 'type']);
		expect(note['name']).toBe('b.md');
		expect(note['path']).toBe('notes/b.md');
		expect(note['active']).toBe(true);
		expect(note['type']).toBe('canvas');
	});

	it('handles empty notes array', () => {
		const result = mapOpenNotesResult(makeOpenNotesResult({notes: []}));
		const body = JSON.parse(result.content[0].text as string) as {notes: unknown[]};

		expect(body.notes).toEqual([]);
	});

	it('handles multiple notes', () => {
		const notes = [
			makeOpenNoteDescriptor({name: 'a.md', path: 'notes/a.md', active: true, type: 'markdown'}),
			makeOpenNoteDescriptor({name: 'b.md', path: 'notes/b.md', active: false, type: 'canvas'}),
		];
		const result = mapOpenNotesResult(makeOpenNotesResult({notes}));
		const body = JSON.parse(result.content[0].text as string) as {notes: unknown[]};

		expect(body.notes).toHaveLength(2);
	});

	it('active flag is a boolean in the JSON output', () => {
		const descriptor = makeOpenNoteDescriptor({active: true});
		const result = mapOpenNotesResult(makeOpenNotesResult({notes: [descriptor]}));
		const body = JSON.parse(result.content[0].text as string) as {notes: Array<Record<string, unknown>>};
		const note = body.notes[0] as Record<string, unknown>;

		expect(typeof note['active']).toBe('boolean');
	});
});
