/**
 * Behavioral tests for AuthenticateGate.
 *
 * Gate 0 in the permission chain — verifies the apiKeyId in the request maps
 * to a known, enabled API key in the config. All cases are exercised through
 * the public `evaluate()` method.
 */

import {describe, it, expect} from 'vitest';
import {authenticateGate} from '../../../src/core/gates/authenticate';
import type {CoreRequest, KadoConfig, ApiKeyConfig} from '../../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeApiKey(overrides?: Partial<ApiKeyConfig>): ApiKeyConfig {
	return {
		id: 'kado_test-key-id',
		label: 'Test Key',
		enabled: true,
		createdAt: 1700000000000,
		areas: [],
		...overrides,
	};
}

function makeConfig(keys: ApiKeyConfig[] = []): KadoConfig {
	return {
		server: {enabled: false, host: '127.0.0.1', port: 23026, connectionType: 'local' as const},
		globalAreas: [],
		apiKeys: keys,
		audit: {enabled: true, logDirectory: 'logs', logFileName: 'kado-audit.log', maxSizeBytes: 10485760, maxRetainedLogs: 3},
	};
}

function makeRequest(apiKeyId: string): CoreRequest {
	return {apiKeyId, operation: 'note', path: 'notes/test.md'};
}

// ---------------------------------------------------------------------------
// Gate name
// ---------------------------------------------------------------------------

describe('authenticateGate', () => {
	it('has name "authenticate"', () => {
		expect(authenticateGate.name).toBe('authenticate');
	});
});

// ---------------------------------------------------------------------------
// evaluate() — happy path
// ---------------------------------------------------------------------------

describe('authenticateGate.evaluate()', () => {
	it('allows a request with a known, enabled key', () => {
		const key = makeApiKey({id: 'kado_known-enabled'});
		const config = makeConfig([key]);
		const request = makeRequest('kado_known-enabled');

		const result = authenticateGate.evaluate(request, config);

		expect(result.allowed).toBe(true);
	});

	// ---------------------------------------------------------------------------
	// evaluate() — unauthorized cases
	// ---------------------------------------------------------------------------

	it('denies a request with an unknown key ID', () => {
		const config = makeConfig([makeApiKey({id: 'kado_other-key'})]);
		const request = makeRequest('kado_unknown');

		const result = authenticateGate.evaluate(request, config);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('UNAUTHORIZED');
			expect(result.error.gate).toBe('authenticate');
			expect(result.error.message).toBeTruthy();
		}
	});

	it('denies a request with a known but disabled key', () => {
		const key = makeApiKey({id: 'kado_disabled', enabled: false});
		const config = makeConfig([key]);
		const request = makeRequest('kado_disabled');

		const result = authenticateGate.evaluate(request, config);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('UNAUTHORIZED');
			expect(result.error.gate).toBe('authenticate');
			expect(result.error.message).toBeTruthy();
		}
	});

	it('denies a request with an empty apiKeyId', () => {
		const config = makeConfig([makeApiKey()]);
		const request = makeRequest('');

		const result = authenticateGate.evaluate(request, config);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('UNAUTHORIZED');
			expect(result.error.gate).toBe('authenticate');
		}
	});

	it('denies any request when config has no API keys', () => {
		const config = makeConfig([]);
		const request = makeRequest('kado_any-key');

		const result = authenticateGate.evaluate(request, config);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('UNAUTHORIZED');
			expect(result.error.gate).toBe('authenticate');
		}
	});

	it('denies when multiple keys exist but none match the request ID', () => {
		const config = makeConfig([
			makeApiKey({id: 'kado_key-a'}),
			makeApiKey({id: 'kado_key-b'}),
		]);
		const request = makeRequest('kado_key-c');

		const result = authenticateGate.evaluate(request, config);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('UNAUTHORIZED');
		}
	});
});
