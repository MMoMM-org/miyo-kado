/**
 * Behavioral tests for KeyScopeGate.
 *
 * Gate 2 in the permission chain — verifies the request path falls within the
 * API key's own security scope using the single-scope model (listMode + paths).
 * Whitelists require a path match; blacklists allow unless the path is listed
 * (with permission inversion handled downstream by the datatype gate).
 *
 * Search requests without a path are passed through (scope filtering for
 * search results is handled elsewhere).
 *
 * All cases are exercised through the public `evaluate()` method.
 */

import {describe, it, expect} from 'vitest';
import {keyScopeGate} from '../../../src/core/gates/key-scope';
import type {
	ApiKeyConfig,
	KadoConfig,
	CoreReadRequest,
	CoreSearchRequest,
	PathPermission,
} from '../../../src/types/canonical';
import {createDefaultSecurityConfig} from '../../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makePathPermission(path: string): PathPermission {
	return {
		path,
		permissions: {
			note: {create: true, read: true, update: true, delete: false},
			frontmatter: {create: true, read: true, update: true, delete: false},
			file: {create: false, read: true, update: false, delete: false},
			dataviewInlineField: {create: false, read: true, update: false, delete: false},
		},
	};
}

function makeApiKey(overrides?: Partial<ApiKeyConfig>): ApiKeyConfig {
	return {
		id: 'kado_test-key',
		label: 'Test Key',
		enabled: true,
		createdAt: 1700000000000,
		listMode: 'whitelist',
		paths: [],
		tags: [],
		allowActiveNote: false,
		allowOtherNotes: false,
		...overrides,
	};
}

function makeConfig(keys: ApiKeyConfig[]): KadoConfig {
	return {
		server: {enabled: false, host: '127.0.0.1', port: 23026, connectionType: 'local'},
		security: createDefaultSecurityConfig(),
		apiKeys: keys,
		audit: {enabled: true, logDirectory: 'logs', logFileName: 'kado-audit.log', maxSizeBytes: 10485760, maxRetainedLogs: 3},
		debugLogging: false,
	};
}

function makeReadRequest(path: string, apiKeyId = 'kado_test-key'): CoreReadRequest {
	return {apiKeyId, operation: 'note', path};
}

function makeSearchRequest(path?: string): CoreSearchRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'byTag',
		...(path !== undefined ? {path} : {}),
	};
}

// ---------------------------------------------------------------------------
// Gate name
// ---------------------------------------------------------------------------

describe('keyScopeGate', () => {
	it('has name "key-scope"', () => {
		expect(keyScopeGate.name).toBe('key-scope');
	});
});

// ---------------------------------------------------------------------------
// Whitelist mode — allowed
// ---------------------------------------------------------------------------

describe('keyScopeGate.evaluate() — whitelist allowed', () => {
	it('allows when path matches a listed pattern on the key', () => {
		const key = makeApiKey({paths: [makePathPermission('work/**')]});
		const result = keyScopeGate.evaluate(makeReadRequest('work/project/note.md'), makeConfig([key]));
		expect(result.allowed).toBe(true);
	});

	it('allows when path matches the second listed pattern when the first does not match', () => {
		const key = makeApiKey({
			paths: [makePathPermission('work/**'), makePathPermission('personal/**')],
		});
		const result = keyScopeGate.evaluate(makeReadRequest('personal/diary.md'), makeConfig([key]));
		expect(result.allowed).toBe(true);
	});

	it('allows a search request without a path', () => {
		const key = makeApiKey({paths: []});
		const result = keyScopeGate.evaluate(makeSearchRequest(), makeConfig([key]));
		expect(result.allowed).toBe(true);
	});

	it('allows nested path matched by ** pattern', () => {
		const key = makeApiKey({paths: [makePathPermission('vault/**')]});
		const result = keyScopeGate.evaluate(makeReadRequest('vault/a/b/c.md'), makeConfig([key]));
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Whitelist mode — denied
// ---------------------------------------------------------------------------

describe('keyScopeGate.evaluate() — whitelist denied', () => {
	it('denies when key has no paths assigned', () => {
		const key = makeApiKey({paths: []});
		const result = keyScopeGate.evaluate(makeReadRequest('work/note.md'), makeConfig([key]));

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('key-scope');
			expect(result.error.message).toBeTruthy();
		}
	});

	it('denies when key has paths but none cover the request path', () => {
		const key = makeApiKey({paths: [makePathPermission('work/**')]});
		const result = keyScopeGate.evaluate(makeReadRequest('personal/diary.md'), makeConfig([key]));

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('key-scope');
		}
	});

	it('denies when the key id is not found in config', () => {
		const key = makeApiKey({id: 'kado_other-key', paths: [makePathPermission('work/**')]});
		const result = keyScopeGate.evaluate(makeReadRequest('work/note.md', 'kado_missing-key'), makeConfig([key]));

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('key-scope');
		}
	});
});

// ---------------------------------------------------------------------------
// Blacklist mode
// ---------------------------------------------------------------------------

describe('keyScopeGate.evaluate() — blacklist', () => {
	it('allows when path does not match any blacklisted pattern', () => {
		const key = makeApiKey({
			listMode: 'blacklist',
			paths: [makePathPermission('private/**')],
		});
		const result = keyScopeGate.evaluate(makeReadRequest('work/note.md'), makeConfig([key]));
		expect(result.allowed).toBe(true);
	});

	it('allows when blacklist paths is empty (full access)', () => {
		const key = makeApiKey({listMode: 'blacklist', paths: []});
		const result = keyScopeGate.evaluate(makeReadRequest('anything/note.md'), makeConfig([key]));
		expect(result.allowed).toBe(true);
	});

	it('allows a path matching a blacklist entry (datatype gate handles permission inversion)', () => {
		const key = makeApiKey({
			listMode: 'blacklist',
			paths: [makePathPermission('private/**')],
		});
		const result = keyScopeGate.evaluate(makeReadRequest('private/note.md'), makeConfig([key]));
		expect(result.allowed).toBe(true);
	});

	it('allows search requests without a path in blacklist mode', () => {
		const key = makeApiKey({
			listMode: 'blacklist',
			paths: [makePathPermission('private/**')],
		});
		const result = keyScopeGate.evaluate(makeSearchRequest(), makeConfig([key]));
		expect(result.allowed).toBe(true);
	});
});
