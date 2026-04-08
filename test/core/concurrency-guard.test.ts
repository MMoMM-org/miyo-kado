/**
 * Behavioral tests for validateConcurrency.
 *
 * Tests cover: write with matching mtime → allowed, write with mismatched mtime
 * → CONFLICT, write without expectedModified (create) → allowed, read request
 * → allowed (bypass), search request → allowed (bypass).
 */

import {describe, it, expect} from 'vitest';
import {validateConcurrency} from '../../src/core/concurrency-guard';
import type {CoreRequest} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeWriteRequest(overrides?: {expectedModified?: number}): CoreRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'note',
		path: 'notes/example.md',
		content: 'Hello world',
		...overrides,
	};
}

function makeReadRequest(): CoreRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'note',
		path: 'notes/example.md',
	};
}

function makeSearchRequest(): CoreRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'byTag',
		query: 'project',
	};
}

// ---------------------------------------------------------------------------
// Write requests with expectedModified
// ---------------------------------------------------------------------------

describe('validateConcurrency — write with expectedModified matching currentMtime', () => {
	it('returns allowed when timestamps match', () => {
		const request = makeWriteRequest({expectedModified: 1700000000000});
		const result = validateConcurrency(request, 1700000000000);
		expect(result).toEqual({allowed: true});
	});
});

describe('validateConcurrency — write with expectedModified not matching currentMtime', () => {
	it('returns CONFLICT when timestamps differ', () => {
		const request = makeWriteRequest({expectedModified: 1700000000000});
		const result = validateConcurrency(request, 1700000099999);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('CONFLICT');
			expect(result.error.message).toContain('updated in the background');
		}
	});

	it('returns CONFLICT when currentMtime is undefined and expectedModified is set', () => {
		const request = makeWriteRequest({expectedModified: 1700000000000});
		const result = validateConcurrency(request, undefined);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('CONFLICT');
		}
	});
});

// ---------------------------------------------------------------------------
// Write requests without expectedModified (create path)
// ---------------------------------------------------------------------------

describe('validateConcurrency — write without expectedModified', () => {
	it('returns CONFLICT when file exists but no expectedModified is provided', () => {
		const request = makeWriteRequest();
		const result = validateConcurrency(request, 1700000000000);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('CONFLICT');
			expect(result.error.message).toContain('expectedModified is required');
		}
	});

	it('returns allowed when file does not exist (create)', () => {
		const request = makeWriteRequest();
		const result = validateConcurrency(request, undefined);
		expect(result).toEqual({allowed: true});
	});
});

// ---------------------------------------------------------------------------
// Read and search bypass
// ---------------------------------------------------------------------------

describe('validateConcurrency — read request bypass', () => {
	it('returns allowed for a read request without checking timestamps', () => {
		const request = makeReadRequest();
		const result = validateConcurrency(request, 1700000000000);
		expect(result).toEqual({allowed: true});
	});
});

describe('validateConcurrency — search request bypass', () => {
	it('returns allowed for a search request without checking timestamps', () => {
		const request = makeSearchRequest();
		const result = validateConcurrency(request, 1700000000000);
		expect(result).toEqual({allowed: true});
	});
});
