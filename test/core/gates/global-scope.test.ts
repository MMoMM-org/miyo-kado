/**
 * Behavioral tests for GlobalScopeGate.
 *
 * Gate 1 in the permission chain — checks if the request path falls within the
 * global security scope using the single-scope model (listMode + paths). Default-
 * deny for whitelists: if no paths match, the request is denied. Blacklists
 * grant scope access to all paths (including listed ones — the data type gate
 * handles the actual permission inversion).
 *
 * All cases are exercised through the public `evaluate()` method.
 */

import {describe, it, expect} from 'vitest';
import {globalScopeGate} from '../../../src/core/gates/global-scope';
import type {
	CoreReadRequest,
	CoreSearchRequest,
	KadoConfig,
	PathPermission,
	SecurityConfig,
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

function makeSecurityConfig(overrides?: Partial<SecurityConfig>): SecurityConfig {
	return {
		listMode: 'whitelist',
		paths: [],
		tags: [],
		...overrides,
	};
}

function makeConfig(security: SecurityConfig): KadoConfig {
	return {
		server: {enabled: false, host: '127.0.0.1', port: 23026, connectionType: 'local'},
		security,
		apiKeys: [],
		audit: {enabled: true, logDirectory: 'logs', logFileName: 'kado-audit.log', maxSizeBytes: 10485760, maxRetainedLogs: 3},
	};
}

// ---------------------------------------------------------------------------
// Gate name
// ---------------------------------------------------------------------------

describe('globalScopeGate', () => {
	it('has name "global-scope"', () => {
		expect(globalScopeGate.name).toBe('global-scope');
	});
});

// ---------------------------------------------------------------------------
// Whitelist mode — allowed
// ---------------------------------------------------------------------------

describe('globalScopeGate.evaluate() — whitelist allowed', () => {
	it('allows when path matches a listed pattern', () => {
		const security = makeSecurityConfig({paths: [makePathPermission('projects/**')]});
		const result = globalScopeGate.evaluate(makeReadRequest('projects/note.md'), makeConfig(security));
		expect(result.allowed).toBe(true);
	});

	it('allows when path matches nested segments under **', () => {
		const security = makeSecurityConfig({paths: [makePathPermission('projects/**')]});
		const result = globalScopeGate.evaluate(makeReadRequest('projects/sub/deep/note.md'), makeConfig(security));
		expect(result.allowed).toBe(true);
	});

	it('allows when path matches the second listed pattern when the first does not', () => {
		const security = makeSecurityConfig({
			paths: [makePathPermission('archive/**'), makePathPermission('projects/**')],
		});
		const result = globalScopeGate.evaluate(makeReadRequest('projects/note.md'), makeConfig(security));
		expect(result.allowed).toBe(true);
	});

	it('allows an exact path match', () => {
		const security = makeSecurityConfig({paths: [makePathPermission('inbox/todo.md')]});
		const result = globalScopeGate.evaluate(makeReadRequest('inbox/todo.md'), makeConfig(security));
		expect(result.allowed).toBe(true);
	});

	it('allows a root-level file matched by *.md', () => {
		const security = makeSecurityConfig({paths: [makePathPermission('*.md')]});
		const result = globalScopeGate.evaluate(makeReadRequest('note.md'), makeConfig(security));
		expect(result.allowed).toBe(true);
	});

	it('allows a search request without a path field', () => {
		const security = makeSecurityConfig({paths: []});
		const result = globalScopeGate.evaluate(makeSearchRequest(), makeConfig(security));
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Whitelist mode — denied
// ---------------------------------------------------------------------------

describe('globalScopeGate.evaluate() — whitelist denied', () => {
	it('denies when path falls outside all listed patterns', () => {
		const security = makeSecurityConfig({paths: [makePathPermission('projects/**')]});
		const result = globalScopeGate.evaluate(makeReadRequest('personal/diary.md'), makeConfig(security));

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('global-scope');
			expect(result.error.message).toBeTruthy();
		}
	});

	it('denies when paths list is empty', () => {
		const security = makeSecurityConfig({paths: []});
		const result = globalScopeGate.evaluate(makeReadRequest('projects/note.md'), makeConfig(security));

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('global-scope');
		}
	});

	it('denies when * pattern does not match across path separators', () => {
		const security = makeSecurityConfig({paths: [makePathPermission('*.md')]});
		const result = globalScopeGate.evaluate(makeReadRequest('projects/note.md'), makeConfig(security));

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('global-scope');
		}
	});
});

// ---------------------------------------------------------------------------
// Blacklist mode
// ---------------------------------------------------------------------------

describe('globalScopeGate.evaluate() — blacklist', () => {
	it('allows when path does not match any blacklisted pattern', () => {
		const security = makeSecurityConfig({
			listMode: 'blacklist',
			paths: [makePathPermission('private/**')],
		});
		const result = globalScopeGate.evaluate(makeReadRequest('projects/note.md'), makeConfig(security));
		expect(result.allowed).toBe(true);
	});

	it('allows when blacklist paths list is empty (full vault access)', () => {
		const security = makeSecurityConfig({listMode: 'blacklist', paths: []});
		const result = globalScopeGate.evaluate(makeReadRequest('anything/note.md'), makeConfig(security));
		expect(result.allowed).toBe(true);
	});

	it('allows a path matching a blacklist entry (permissions inversion handled by datatype gate)', () => {
		// The global-scope gate grants scope inclusion for blacklisted paths; the
		// DataTypePermissionGate is responsible for inverting and enforcing the permissions.
		const security = makeSecurityConfig({
			listMode: 'blacklist',
			paths: [makePathPermission('private/**')],
		});
		const result = globalScopeGate.evaluate(makeReadRequest('private/note.md'), makeConfig(security));
		expect(result.allowed).toBe(true);
	});

	it('allows a search request without a path in blacklist mode', () => {
		const security = makeSecurityConfig({
			listMode: 'blacklist',
			paths: [makePathPermission('private/**')],
		});
		const result = globalScopeGate.evaluate(makeSearchRequest(), makeConfig(security));
		expect(result.allowed).toBe(true);
	});
});
