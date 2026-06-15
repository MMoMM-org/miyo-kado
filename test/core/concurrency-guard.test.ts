/**
 * Behavioral tests for validateConcurrency.
 *
 * Tests cover: write with matching mtime → allowed, write with mismatched mtime
 * → CONFLICT, write without expectedModified (create) → allowed, read request
 * → allowed (bypass), search request → allowed (bypass), partial writes
 * (ADR-5: additive lock-free, destructive locked).
 */

import {describe, it, expect} from 'vitest';
import {validateConcurrency} from '../../src/core/concurrency-guard';
import type {CoreRequest, NoteWritePartial} from '../../src/types/canonical';

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

function makePartialWriteRequest(notePartial: NoteWritePartial, overrides?: {expectedModified?: number}): CoreRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'note',
		path: 'notes/example.md',
		content: 'appended text',
		notePartial,
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

function makeDeleteRequest(expectedModified: number): CoreRequest {
	return {
		kind: 'delete',
		apiKeyId: 'kado_test-key',
		operation: 'note',
		path: 'notes/example.md',
		expectedModified,
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

// ---------------------------------------------------------------------------
// Delete requests
// ---------------------------------------------------------------------------

describe('validateConcurrency — delete request', () => {
	it('returns allowed when expectedModified matches currentMtime', () => {
		const request = makeDeleteRequest(1700000000000);
		const result = validateConcurrency(request, 1700000000000);
		expect(result).toEqual({allowed: true});
	});

	it('returns CONFLICT when expectedModified does not match', () => {
		const request = makeDeleteRequest(1700000000000);
		const result = validateConcurrency(request, 1800000000000);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('CONFLICT');
			expect(result.error.message).toContain('deleting');
		}
	});

	it('returns allowed when file does not exist (currentMtime undefined) — adapter will emit NOT_FOUND', () => {
		const request = makeDeleteRequest(1700000000000);
		const result = validateConcurrency(request, undefined);
		expect(result).toEqual({allowed: true});
	});
});

// ---------------------------------------------------------------------------
// Rename requests (source-mtime guard, mirrors delete)
// ---------------------------------------------------------------------------

function makeRenameRequest(expectedModified: number): CoreRequest {
	return {
		kind: 'rename',
		apiKeyId: 'kado_test-key',
		operation: 'note',
		source: 'notes/old.md',
		target: 'notes/new.md',
		expectedModified,
	};
}

describe('validateConcurrency — rename request', () => {
	it('returns allowed when expectedModified matches the source mtime', () => {
		const result = validateConcurrency(makeRenameRequest(1700000000000), 1700000000000);
		expect(result).toEqual({allowed: true});
	});

	it('returns CONFLICT when the source changed since the read', () => {
		const result = validateConcurrency(makeRenameRequest(1700000000000), 1800000000000);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('CONFLICT');
			expect(result.error.message).toContain('renaming');
		}
	});

	it('returns allowed when the source is missing — adapter will emit NOT_FOUND', () => {
		const result = validateConcurrency(makeRenameRequest(1700000000000), undefined);
		expect(result).toEqual({allowed: true});
	});

	it('returns CONFLICT when expectedModified is NaN against a real mtime (defense-in-depth)', () => {
		const result = validateConcurrency(makeRenameRequest(NaN), 1700000000000);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('CONFLICT');
		}
	});
});

// ---------------------------------------------------------------------------
// Partial write — additive modes (ADR-5: lock-free)
// ---------------------------------------------------------------------------

describe('validateConcurrency — partial write: append without expectedModified', () => {
	it('returns allowed even when file exists (lock-free additive write)', () => {
		const request = makePartialWriteRequest({mode: 'append'});
		const result = validateConcurrency(request, 1700000000000);
		expect(result).toEqual({allowed: true});
	});

	it('returns allowed when file does not exist (new file, no expectedModified)', () => {
		const request = makePartialWriteRequest({mode: 'append'});
		const result = validateConcurrency(request, undefined);
		expect(result).toEqual({allowed: true});
	});
});

describe('validateConcurrency — partial write: prepend without expectedModified', () => {
	it('returns allowed even when file exists (lock-free additive write)', () => {
		const request = makePartialWriteRequest({mode: 'prepend'});
		const result = validateConcurrency(request, 1700000000000);
		expect(result).toEqual({allowed: true});
	});

	it('returns allowed when file does not exist (new file, no expectedModified)', () => {
		const request = makePartialWriteRequest({mode: 'prepend'});
		const result = validateConcurrency(request, undefined);
		expect(result).toEqual({allowed: true});
	});
});

// ---------------------------------------------------------------------------
// Partial write — destructive modes without expectedModified → VALIDATION_ERROR
// ---------------------------------------------------------------------------

describe('validateConcurrency — partial write: replaceSection without expectedModified', () => {
	it('returns VALIDATION_ERROR when expectedModified is absent', () => {
		const request = makePartialWriteRequest({mode: 'replaceSection', heading: '## Summary'});
		const result = validateConcurrency(request, 1700000000000);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.message).toContain('expectedModified');
		}
	});
});

describe('validateConcurrency — partial write: replaceRange without expectedModified', () => {
	it('returns VALIDATION_ERROR when expectedModified is absent', () => {
		const request = makePartialWriteRequest({mode: 'replaceRange', basis: 'line', start: 1, end: 5});
		const result = validateConcurrency(request, 1700000000000);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.message).toContain('expectedModified');
		}
	});
});

describe('validateConcurrency — partial write: insertUnderHeading without expectedModified', () => {
	it('returns VALIDATION_ERROR when expectedModified is absent', () => {
		const request = makePartialWriteRequest({mode: 'insertUnderHeading', heading: '## Tasks'});
		const result = validateConcurrency(request, 1700000000000);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.message).toContain('expectedModified');
		}
	});
});

// ---------------------------------------------------------------------------
// Partial write — with expectedModified: standard mtime compare
// ---------------------------------------------------------------------------

describe('validateConcurrency — partial write with stale expectedModified', () => {
	it('returns CONFLICT when mtime does not match (additive mode)', () => {
		const request = makePartialWriteRequest({mode: 'append'}, {expectedModified: 1700000000000});
		const result = validateConcurrency(request, 1800000000000);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('CONFLICT');
		}
	});

	it('returns CONFLICT when mtime does not match (destructive mode)', () => {
		const request = makePartialWriteRequest({mode: 'replaceSection', heading: '## Summary'}, {expectedModified: 1700000000000});
		const result = validateConcurrency(request, 1800000000000);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('CONFLICT');
		}
	});
});

describe('validateConcurrency — partial write with fresh expectedModified', () => {
	it('returns allowed when mtime matches (replaceSection)', () => {
		const request = makePartialWriteRequest({mode: 'replaceSection', heading: '## Summary'}, {expectedModified: 1700000000000});
		const result = validateConcurrency(request, 1700000000000);
		expect(result).toEqual({allowed: true});
	});

	it('returns allowed when mtime matches (replaceRange)', () => {
		const request = makePartialWriteRequest({mode: 'replaceRange', basis: 'line', start: 1, end: 5}, {expectedModified: 1700000000000});
		const result = validateConcurrency(request, 1700000000000);
		expect(result).toEqual({allowed: true});
	});

	it('returns allowed when mtime matches (insertUnderHeading)', () => {
		const request = makePartialWriteRequest({mode: 'insertUnderHeading', heading: '## Tasks'}, {expectedModified: 1700000000000});
		const result = validateConcurrency(request, 1700000000000);
		expect(result).toEqual({allowed: true});
	});

	it('returns CONFLICT when mtime mismatches (destructive mode with stale expectedModified)', () => {
		const request = makePartialWriteRequest({mode: 'replaceRange', basis: 'char', start: 0, end: 3}, {expectedModified: 1700000000000});
		const result = validateConcurrency(request, 1700000009999);
		expect(result.allowed).toBe(false);
		if (!result.allowed) expect(result.error.code).toBe('CONFLICT');
	});
});

// ---------------------------------------------------------------------------
// Regression: full-note write rules unchanged
// ---------------------------------------------------------------------------

describe('validateConcurrency — regression: full-note write without expectedModified + file exists', () => {
	it('still returns CONFLICT for full-note writes when no expectedModified provided', () => {
		const request = makeWriteRequest();
		const result = validateConcurrency(request, 1700000000000);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('CONFLICT');
			expect(result.error.message).toContain('expectedModified is required');
		}
	});
});

describe('validateConcurrency — regression: full-note write without expectedModified + file absent', () => {
	it('still returns allowed for creates (no file, no expectedModified)', () => {
		const request = makeWriteRequest();
		const result = validateConcurrency(request, undefined);
		expect(result).toEqual({allowed: true});
	});
});
