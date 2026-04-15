/**
 * Behavioral tests for OperationRouter.
 *
 * Routes authorized CoreRequests to the correct adapter based on request type
 * and operation field. All routing behaviors are exercised through the public
 * `route()` function returned by `createOperationRouter()`.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {createOperationRouter} from '../../src/core/operation-router';
import type {
	CoreReadRequest,
	CoreWriteRequest,
	CoreSearchRequest,
	CoreDeleteRequest,
	CoreFileResult,
	CoreWriteResult,
	CoreSearchResult,
	CoreDeleteResult,
	DeleteDataType,
} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeReadRequest(operation: CoreReadRequest['operation']): CoreReadRequest {
	return {apiKeyId: 'kado_test-key', operation, path: 'notes/test.md'};
}

function makeWriteRequest(operation: CoreWriteRequest['operation']): CoreWriteRequest {
	return {apiKeyId: 'kado_test-key', operation, path: 'notes/test.md', content: 'hello'};
}

function makeSearchRequest(operation: CoreSearchRequest['operation']): CoreSearchRequest {
	return {apiKeyId: 'kado_test-key', operation, query: 'test'};
}

function makeDeleteRequest(
	operation: DeleteDataType,
	overrides?: Partial<CoreDeleteRequest>,
): CoreDeleteRequest {
	return {
		kind: 'delete',
		apiKeyId: 'kado_test-key',
		operation,
		path: 'notes/test.md',
		expectedModified: 2000,
		...overrides,
	};
}

function makeFileResult(path = 'notes/test.md'): CoreFileResult {
	return {path, content: 'body', created: 1000, modified: 2000, size: 4};
}

function makeWriteResult(path = 'notes/test.md'): CoreWriteResult {
	return {path, created: 1000, modified: 2000};
}

function makeSearchResult(): CoreSearchResult {
	return {items: [], total: 0};
}

// ---------------------------------------------------------------------------
// Mock adapter factory
// ---------------------------------------------------------------------------

function makeReadWriteAdapter() {
	return {
		read: vi.fn(),
		write: vi.fn(),
	};
}

function makeSearchAdapter() {
	return {
		search: vi.fn(),
	};
}

function makeDeleteAdapter() {
	return {
		delete: vi.fn(),
	};
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let noteAdapter: ReturnType<typeof makeReadWriteAdapter>;
let frontmatterAdapter: ReturnType<typeof makeReadWriteAdapter>;
let fileAdapter: ReturnType<typeof makeReadWriteAdapter>;
let inlineFieldAdapter: ReturnType<typeof makeReadWriteAdapter>;
let searchAdapter: ReturnType<typeof makeSearchAdapter>;
let noteDeleteAdapter: ReturnType<typeof makeDeleteAdapter>;
let fileDeleteAdapter: ReturnType<typeof makeDeleteAdapter>;
let frontmatterDeleteAdapter: ReturnType<typeof makeDeleteAdapter>;

beforeEach(() => {
	noteAdapter = makeReadWriteAdapter();
	frontmatterAdapter = makeReadWriteAdapter();
	fileAdapter = makeReadWriteAdapter();
	inlineFieldAdapter = makeReadWriteAdapter();
	searchAdapter = makeSearchAdapter();
	noteDeleteAdapter = makeDeleteAdapter();
	fileDeleteAdapter = makeDeleteAdapter();
	frontmatterDeleteAdapter = makeDeleteAdapter();
});

function makeRouter() {
	return createOperationRouter({
		note: noteAdapter,
		frontmatter: frontmatterAdapter,
		file: fileAdapter,
		'dataview-inline-field': inlineFieldAdapter,
		search: searchAdapter,
		deleteAdapters: {
			note: noteDeleteAdapter,
			file: fileDeleteAdapter,
			frontmatter: frontmatterDeleteAdapter,
		},
	});
}

// ---------------------------------------------------------------------------
// Read routing
// ---------------------------------------------------------------------------

describe('createOperationRouter() — read routing', () => {
	it('routes read "note" to noteAdapter.read and returns its result', async () => {
		const expected = makeFileResult();
		noteAdapter.read.mockResolvedValue(expected);

		const route = makeRouter();
		const result = await route(makeReadRequest('note'));

		expect(noteAdapter.read).toHaveBeenCalledOnce();
		expect(result).toBe(expected);
	});

	it('routes read "frontmatter" to frontmatterAdapter.read and returns its result', async () => {
		const expected = makeFileResult();
		frontmatterAdapter.read.mockResolvedValue(expected);

		const route = makeRouter();
		const result = await route(makeReadRequest('frontmatter'));

		expect(frontmatterAdapter.read).toHaveBeenCalledOnce();
		expect(result).toBe(expected);
	});

	it('routes read "file" to fileAdapter.read and returns its result', async () => {
		const expected = makeFileResult();
		fileAdapter.read.mockResolvedValue(expected);

		const route = makeRouter();
		const result = await route(makeReadRequest('file'));

		expect(fileAdapter.read).toHaveBeenCalledOnce();
		expect(result).toBe(expected);
	});

	it('routes read "dataview-inline-field" to inlineFieldAdapter.read and returns its result', async () => {
		const expected = makeFileResult();
		inlineFieldAdapter.read.mockResolvedValue(expected);

		const route = makeRouter();
		const result = await route(makeReadRequest('dataview-inline-field'));

		expect(inlineFieldAdapter.read).toHaveBeenCalledOnce();
		expect(result).toBe(expected);
	});

	it('routes read "tags" to noteAdapter.read (tags is a note-derived read)', async () => {
		const expected = makeFileResult();
		noteAdapter.read.mockResolvedValue(expected);

		const route = makeRouter();
		const result = await route(makeReadRequest('tags'));

		expect(noteAdapter.read).toHaveBeenCalledOnce();
		expect(frontmatterAdapter.read).not.toHaveBeenCalled();
		expect(result).toBe(expected);
	});

	it('passes the request object to the adapter unchanged', async () => {
		const req = makeReadRequest('note');
		noteAdapter.read.mockResolvedValue(makeFileResult());

		const route = makeRouter();
		await route(req);

		expect(noteAdapter.read).toHaveBeenCalledWith(req);
	});
});

// ---------------------------------------------------------------------------
// Write routing
// ---------------------------------------------------------------------------

describe('createOperationRouter() — write routing', () => {
	it('routes write "note" to noteAdapter.write and returns its result', async () => {
		const expected = makeWriteResult();
		noteAdapter.write.mockResolvedValue(expected);

		const route = makeRouter();
		const result = await route(makeWriteRequest('note'));

		expect(noteAdapter.write).toHaveBeenCalledOnce();
		expect(result).toBe(expected);
	});

	it('routes write "frontmatter" to frontmatterAdapter.write and returns its result', async () => {
		const expected = makeWriteResult();
		frontmatterAdapter.write.mockResolvedValue(expected);

		const route = makeRouter();
		const result = await route(makeWriteRequest('frontmatter'));

		expect(frontmatterAdapter.write).toHaveBeenCalledOnce();
		expect(result).toBe(expected);
	});

	it('passes the request object to the adapter unchanged', async () => {
		const req = makeWriteRequest('note');
		noteAdapter.write.mockResolvedValue(makeWriteResult());

		const route = makeRouter();
		await route(req);

		expect(noteAdapter.write).toHaveBeenCalledWith(req);
	});
});

// ---------------------------------------------------------------------------
// Search routing
// ---------------------------------------------------------------------------

describe('createOperationRouter() — search routing', () => {
	it('routes search "byTag" to searchAdapter.search and returns its result', async () => {
		const expected = makeSearchResult();
		searchAdapter.search.mockResolvedValue(expected);

		const route = makeRouter();
		const result = await route(makeSearchRequest('byTag'));

		expect(searchAdapter.search).toHaveBeenCalledOnce();
		expect(result).toBe(expected);
	});

	it('routes search "byName" to searchAdapter.search', async () => {
		searchAdapter.search.mockResolvedValue(makeSearchResult());

		const route = makeRouter();
		await route(makeSearchRequest('byName'));

		expect(searchAdapter.search).toHaveBeenCalledOnce();
	});

	it('routes search "listDir" to searchAdapter.search', async () => {
		searchAdapter.search.mockResolvedValue(makeSearchResult());

		const route = makeRouter();
		await route(makeSearchRequest('listDir'));

		expect(searchAdapter.search).toHaveBeenCalledOnce();
	});

	it('routes search "listTags" to searchAdapter.search', async () => {
		searchAdapter.search.mockResolvedValue(makeSearchResult());

		const route = makeRouter();
		await route(makeSearchRequest('listTags'));

		expect(searchAdapter.search).toHaveBeenCalledOnce();
	});

	it('passes the request object to the search adapter unchanged', async () => {
		const req = makeSearchRequest('byTag');
		searchAdapter.search.mockResolvedValue(makeSearchResult());

		const route = makeRouter();
		await route(req);

		expect(searchAdapter.search).toHaveBeenCalledWith(req);
	});
});

// ---------------------------------------------------------------------------
// Isolation — no cross-adapter calls
// ---------------------------------------------------------------------------

describe('createOperationRouter() — adapter isolation', () => {
	it('does not call any other adapter when routing a note read', async () => {
		noteAdapter.read.mockResolvedValue(makeFileResult());

		const route = makeRouter();
		await route(makeReadRequest('note'));

		expect(frontmatterAdapter.read).not.toHaveBeenCalled();
		expect(fileAdapter.read).not.toHaveBeenCalled();
		expect(inlineFieldAdapter.read).not.toHaveBeenCalled();
		expect(searchAdapter.search).not.toHaveBeenCalled();
	});

	it('does not call read adapters when routing a search', async () => {
		searchAdapter.search.mockResolvedValue(makeSearchResult());

		const route = makeRouter();
		await route(makeSearchRequest('byTag'));

		expect(noteAdapter.read).not.toHaveBeenCalled();
		expect(frontmatterAdapter.read).not.toHaveBeenCalled();
		expect(fileAdapter.read).not.toHaveBeenCalled();
		expect(inlineFieldAdapter.read).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Error — unknown/invalid operation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Delete routing
// ---------------------------------------------------------------------------

function makeDeleteResult(path = 'notes/test.md'): CoreDeleteResult {
	return {path};
}

describe('createOperationRouter() — delete routing', () => {
	it('routes delete "note" to note delete adapter and returns its result', async () => {
		const expected = makeDeleteResult();
		noteDeleteAdapter.delete.mockResolvedValue(expected);

		const route = makeRouter();
		const result = await route(makeDeleteRequest('note'));

		expect(noteDeleteAdapter.delete).toHaveBeenCalledOnce();
		expect(result).toBe(expected);
	});

	it('routes delete "file" to file delete adapter', async () => {
		const expected = makeDeleteResult('image.png');
		fileDeleteAdapter.delete.mockResolvedValue(expected);

		const route = makeRouter();
		const result = await route(makeDeleteRequest('file', {path: 'image.png'}));

		expect(fileDeleteAdapter.delete).toHaveBeenCalledOnce();
		expect(result).toBe(expected);
	});

	it('routes delete "frontmatter" to frontmatter delete adapter', async () => {
		const expected = {path: 'notes/test.md', modified: 3000};
		frontmatterDeleteAdapter.delete.mockResolvedValue(expected);

		const route = makeRouter();
		const result = await route(makeDeleteRequest('frontmatter', {keys: ['k1']}));

		expect(frontmatterDeleteAdapter.delete).toHaveBeenCalledOnce();
		expect(result).toBe(expected);
	});

	it('does not call read/write/search adapters when routing a delete', async () => {
		noteDeleteAdapter.delete.mockResolvedValue(makeDeleteResult());

		const route = makeRouter();
		await route(makeDeleteRequest('note'));

		expect(noteAdapter.read).not.toHaveBeenCalled();
		expect(noteAdapter.write).not.toHaveBeenCalled();
		expect(searchAdapter.search).not.toHaveBeenCalled();
	});
});

describe('createOperationRouter() — invalid operation', () => {
	it('returns a CoreError with VALIDATION_ERROR for an unrecognised operation', async () => {
		const route = makeRouter();
		// Cast to bypass TypeScript — simulate a runtime bad value
		const badRequest = {apiKeyId: 'kado_test-key', operation: 'unknown-op' as never, path: 'x'};

		const result = await route(badRequest);

		expect(result).toMatchObject({
			code: 'VALIDATION_ERROR',
			message: expect.any(String),
		});
	});
});
