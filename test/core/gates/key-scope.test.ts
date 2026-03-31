/**
 * Behavioral tests for KeyScopeGate.
 *
 * Gate 2 in the permission chain — verifies the request path falls within at
 * least one area assigned to the API key. The key's areas reference global
 * areas by areaId; a path must match a pathPattern in the resolved global area.
 * Search requests without a path are passed through (scope filtering handled
 * elsewhere).
 */

import {describe, it, expect} from 'vitest';
import {keyScopeGate} from '../../../src/core/gates/key-scope';
import type {
	ApiKeyConfig,
	GlobalArea,
	KadoConfig,
	CoreReadRequest,
	CoreSearchRequest,
	KeyAreaConfig,
} from '../../../src/types/canonical';
import {createDefaultPermissions} from '../../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeGlobalArea(overrides?: Partial<GlobalArea>): GlobalArea {
	return {
		id: 'area-work',
		label: 'Work',
		pathPatterns: ['work/**'],
		permissions: createDefaultPermissions(),
		listMode: 'whitelist',
		tags: [],
		...overrides,
	};
}

function makeKeyArea(areaId: string): KeyAreaConfig {
	return {areaId, permissions: createDefaultPermissions(), tags: []};
}

function makeApiKey(overrides?: Partial<ApiKeyConfig>): ApiKeyConfig {
	return {
		id: 'kado_test-key',
		label: 'Test Key',
		enabled: true,
		createdAt: 1700000000000,
		areas: [],
		...overrides,
	};
}

function makeConfig(
	keys: ApiKeyConfig[],
	globalAreas: GlobalArea[] = [],
): KadoConfig {
	return {
		server: {enabled: false, host: '127.0.0.1', port: 23026, connectionType: 'local' as const},
		globalAreas,
		apiKeys: keys,
		audit: {enabled: true, logDirectory: 'logs', logFileName: 'kado-audit.log', maxSizeBytes: 10485760, maxRetainedLogs: 3},
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
// Allowed cases
// ---------------------------------------------------------------------------

describe('keyScopeGate.evaluate() — allowed', () => {
	it('allows when key has an area assigned whose global area covers the path', () => {
		const globalArea = makeGlobalArea({id: 'area-work', pathPatterns: ['work/**']});
		const key = makeApiKey({areas: [makeKeyArea('area-work')]});
		const config = makeConfig([key], [globalArea]);

		const result = keyScopeGate.evaluate(makeReadRequest('work/project/note.md'), config);

		expect(result.allowed).toBe(true);
	});

	it('allows when key has multiple areas and path matches the second', () => {
		const areaWork = makeGlobalArea({id: 'area-work', pathPatterns: ['work/**']});
		const areaPersonal = makeGlobalArea({id: 'area-personal', pathPatterns: ['personal/**']});
		const key = makeApiKey({
			areas: [makeKeyArea('area-work'), makeKeyArea('area-personal')],
		});
		const config = makeConfig([key], [areaWork, areaPersonal]);

		const result = keyScopeGate.evaluate(makeReadRequest('personal/diary.md'), config);

		expect(result.allowed).toBe(true);
	});

	it('allows a search request without a path', () => {
		const key = makeApiKey({areas: []});
		const config = makeConfig([key], []);

		const result = keyScopeGate.evaluate(makeSearchRequest(), config);

		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Forbidden cases
// ---------------------------------------------------------------------------

describe('keyScopeGate.evaluate() — forbidden', () => {
	it('denies when key has no areas assigned', () => {
		const globalArea = makeGlobalArea({id: 'area-work', pathPatterns: ['work/**']});
		const key = makeApiKey({areas: []});
		const config = makeConfig([key], [globalArea]);

		const result = keyScopeGate.evaluate(makeReadRequest('work/note.md'), config);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('key-scope');
			expect(result.error.message).toBeTruthy();
		}
	});

	it('denies when key has areas but none cover the request path', () => {
		const globalArea = makeGlobalArea({id: 'area-work', pathPatterns: ['work/**']});
		const key = makeApiKey({areas: [makeKeyArea('area-work')]});
		const config = makeConfig([key], [globalArea]);

		const result = keyScopeGate.evaluate(makeReadRequest('personal/diary.md'), config);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('key-scope');
		}
	});

	it("denies when key's areaId references a global area that doesn't exist", () => {
		const key = makeApiKey({areas: [makeKeyArea('area-nonexistent')]});
		const config = makeConfig([key], []);

		const result = keyScopeGate.evaluate(makeReadRequest('work/note.md'), config);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('key-scope');
		}
	});
});
