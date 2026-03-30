/**
 * Behavioral tests for PathAccessGate.
 *
 * Gate 4 — the last gate in the permission chain. Validates and normalizes the
 * request path, rejecting traversal attempts and malformed inputs. Search
 * requests without a path field are allowed (path is optional for search).
 */

import {describe, it, expect} from 'vitest';
import {PathAccessGate} from '../../../src/core/gates/path-access';
import {
	createDefaultConfig,
	type CoreReadRequest,
	type CoreSearchRequest,
	type KadoConfig,
} from '../../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeReadRequest(path: string): CoreReadRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'note',
		path,
	};
}

function makeSearchRequest(path?: string): CoreSearchRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'byTag',
		...(path !== undefined ? {path} : {}),
	};
}

function makeConfig(): KadoConfig {
	return createDefaultConfig();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const gate = new PathAccessGate();
const config = makeConfig();

// ---------------------------------------------------------------------------
// Allowed paths
// ---------------------------------------------------------------------------

describe('PathAccessGate — allowed paths', () => {
	it('allows a normal path', () => {
		const result = gate.evaluate(makeReadRequest('projects/note.md'), config);
		expect(result.allowed).toBe(true);
	});

	it('allows a path starting with leading slash (strips and normalizes)', () => {
		const result = gate.evaluate(makeReadRequest('/projects/note.md'), config);
		expect(result.allowed).toBe(true);
	});

	it('allows a path with double slashes (normalized)', () => {
		const result = gate.evaluate(makeReadRequest('projects//note.md'), config);
		expect(result.allowed).toBe(true);
	});

	it('allows a search request without a path field', () => {
		const result = gate.evaluate(makeSearchRequest(), config);
		expect(result.allowed).toBe(true);
	});

	it('allows a search request with a valid path', () => {
		const result = gate.evaluate(makeSearchRequest('projects/'), config);
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Blocked paths — traversal and injection
// ---------------------------------------------------------------------------

describe('PathAccessGate — traversal attempts', () => {
	it('rejects a path with ../ segment', () => {
		const result = gate.evaluate(makeReadRequest('projects/../secret.md'), config);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.gate).toBe('path-access');
		}
	});

	it('rejects a path with ..\\ segment', () => {
		const result = gate.evaluate(makeReadRequest('projects\\..\\secret.md'), config);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.gate).toBe('path-access');
		}
	});

	it('rejects a path that is just ..', () => {
		const result = gate.evaluate(makeReadRequest('..'), config);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.gate).toBe('path-access');
		}
	});

	it('rejects a path containing a null byte', () => {
		const result = gate.evaluate(makeReadRequest('projects/\0note.md'), config);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.gate).toBe('path-access');
		}
	});

	it('rejects a percent-encoded traversal segment (%2e%2e/)', () => {
		const result = gate.evaluate(makeReadRequest('%2e%2e/etc/passwd'), config);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.gate).toBe('path-access');
		}
	});

	it('rejects a mixed percent-encoded traversal segment (..%2f)', () => {
		const result = gate.evaluate(makeReadRequest('..%2fsecret'), config);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.gate).toBe('path-access');
		}
	});

	it('rejects a partial percent-encoded traversal segment (.%2e/)', () => {
		const result = gate.evaluate(makeReadRequest('.%2e/secret'), config);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.gate).toBe('path-access');
		}
	});

	it('rejects a percent-encoded null byte (%00)', () => {
		const result = gate.evaluate(makeReadRequest('projects/%00note.md'), config);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.gate).toBe('path-access');
		}
	});
});

// ---------------------------------------------------------------------------
// Blocked paths — empty and blank
// ---------------------------------------------------------------------------

describe('PathAccessGate — empty paths', () => {
	it('rejects an empty path string', () => {
		const result = gate.evaluate(makeReadRequest(''), config);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.gate).toBe('path-access');
		}
	});
});
