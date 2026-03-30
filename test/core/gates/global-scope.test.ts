/**
 * Behavioral tests for GlobalScopeGate.
 *
 * Gate 1 in the permission chain — checks if the request path falls within
 * any globally defined area using glob pattern matching. Default-deny: if no
 * global areas exist or none match, the request is denied.
 *
 * All cases are exercised through the public `evaluate()` method.
 */

import {describe, it, expect} from 'vitest';
import {globalScopeGate} from '../../../src/core/gates/global-scope';
import type {
	CoreReadRequest,
	CoreSearchRequest,
	GlobalArea,
	KadoConfig,
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

function makeGlobalArea(pathPatterns: string[], overrides?: Partial<GlobalArea>): GlobalArea {
	return {
		id: 'area-1',
		label: 'Test Area',
		pathPatterns,
		permissions: {
			note: {create: true, read: true, update: true, delete: false},
			frontmatter: {create: true, read: true, update: true, delete: false},
			file: {create: false, read: true, update: false, delete: false},
			dataviewInlineField: {create: false, read: true, update: false, delete: false},
		},
		...overrides,
	};
}

function makeConfig(globalAreas: GlobalArea[]): KadoConfig {
	return {
		server: {enabled: false, host: '127.0.0.1', port: 23026},
		globalAreas,
		apiKeys: [],
		audit: {enabled: true, logFilePath: 'plugins/kado/audit.log', maxSizeBytes: 10485760},
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
// evaluate() — allowed cases
// ---------------------------------------------------------------------------

describe('globalScopeGate.evaluate() — allowed', () => {
	it('allows when path matches a global area pattern', () => {
		const config = makeConfig([makeGlobalArea(['projects/**'])]);
		const result = globalScopeGate.evaluate(makeReadRequest('projects/note.md'), config);
		expect(result.allowed).toBe(true);
	});

	it('allows when path matches nested segments under **', () => {
		const config = makeConfig([makeGlobalArea(['projects/**'])]);
		const result = globalScopeGate.evaluate(
			makeReadRequest('projects/sub/deep/note.md'),
			config,
		);
		expect(result.allowed).toBe(true);
	});

	it('allows when path matches the second global area when the first does not match', () => {
		const areaA = makeGlobalArea(['archive/**'], {id: 'area-a', label: 'Archive'});
		const areaB = makeGlobalArea(['projects/**'], {id: 'area-b', label: 'Projects'});
		const config = makeConfig([areaA, areaB]);
		const result = globalScopeGate.evaluate(makeReadRequest('projects/note.md'), config);
		expect(result.allowed).toBe(true);
	});

	it('allows an exact path match', () => {
		const config = makeConfig([makeGlobalArea(['inbox/todo.md'])]);
		const result = globalScopeGate.evaluate(makeReadRequest('inbox/todo.md'), config);
		expect(result.allowed).toBe(true);
	});

	it('allows a root-level file matched by *.md', () => {
		const config = makeConfig([makeGlobalArea(['*.md'])]);
		const result = globalScopeGate.evaluate(makeReadRequest('note.md'), config);
		expect(result.allowed).toBe(true);
	});

	it('allows a search request without a path field', () => {
		const config = makeConfig([]);
		const result = globalScopeGate.evaluate(makeSearchRequest(), config);
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// evaluate() — denied cases
// ---------------------------------------------------------------------------

describe('globalScopeGate.evaluate() — denied', () => {
	it('denies when path falls outside all global areas', () => {
		const config = makeConfig([makeGlobalArea(['projects/**'])]);
		const result = globalScopeGate.evaluate(makeReadRequest('personal/diary.md'), config);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('global-scope');
			expect(result.error.message).toBeTruthy();
		}
	});

	it('denies when globalAreas is empty', () => {
		const config = makeConfig([]);
		const result = globalScopeGate.evaluate(makeReadRequest('projects/note.md'), config);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('global-scope');
		}
	});

	it('denies when * pattern does not match across path separators', () => {
		const config = makeConfig([makeGlobalArea(['*.md'])]);
		const result = globalScopeGate.evaluate(makeReadRequest('projects/note.md'), config);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('global-scope');
		}
	});
});
