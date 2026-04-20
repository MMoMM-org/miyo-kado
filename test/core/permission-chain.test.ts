/**
 * Behavioral tests for evaluatePermissions and createDefaultGateChain.
 *
 * The chain evaluates gates in order. The first denial short-circuits — no
 * further gates run. An empty gate array returns allowed.
 */

import {describe, it, expect} from 'vitest';
import {evaluatePermissions, createDefaultGateChain} from '../../src/core/permission-chain';
import type {CoreRequest, KadoConfig, PermissionGate, GateResult} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeRequest(): CoreRequest {
	return {apiKeyId: 'kado_test-key', operation: 'note', path: 'notes/test.md'};
}

function makeConfig(): KadoConfig {
	return {
		server: {enabled: false, host: '127.0.0.1', port: 23026, connectionType: 'local' as const},
		security: {listMode: 'whitelist', paths: [], tags: [], allowActiveNote: false, allowOtherNotes: false},
		apiKeys: [],
		audit: {enabled: true, logDirectory: 'logs', logFileName: 'kado-audit.log', maxSizeBytes: 10485760, maxRetainedLogs: 3},
		debugLogging: false,
	};
}

function makePassGate(name: string): PermissionGate & {callCount: number} {
	const gate = {
		name,
		callCount: 0,
		evaluate(_req: CoreRequest, _cfg: KadoConfig): GateResult {
			gate.callCount++;
			return {allowed: true};
		},
	};
	return gate;
}

function makeDenyGate(name: string): PermissionGate & {callCount: number} {
	const gate = {
		name,
		callCount: 0,
		evaluate(_req: CoreRequest, _cfg: KadoConfig): GateResult {
			gate.callCount++;
			return {allowed: false, error: {code: 'FORBIDDEN', message: `${name} denied`, gate: name}};
		},
	};
	return gate;
}

// ---------------------------------------------------------------------------
// evaluatePermissions — core behavior
// ---------------------------------------------------------------------------

describe('evaluatePermissions', () => {
	it('returns allowed when all gates pass', () => {
		const gates = [makePassGate('g1'), makePassGate('g2'), makePassGate('g3')];
		const result = evaluatePermissions(makeRequest(), makeConfig(), gates);
		expect(result.allowed).toBe(true);
	});

	it('returns allowed when gates array is empty', () => {
		const result = evaluatePermissions(makeRequest(), makeConfig(), []);
		expect(result.allowed).toBe(true);
	});

	it('short-circuits on the first gate denial and returns that gate error', () => {
		const g1 = makeDenyGate('gate-1');
		const g2 = makePassGate('gate-2');
		const g3 = makePassGate('gate-3');

		const result = evaluatePermissions(makeRequest(), makeConfig(), [g1, g2, g3]);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.gate).toBe('gate-1');
		}
		expect(g1.callCount).toBe(1);
		expect(g2.callCount).toBe(0);
		expect(g3.callCount).toBe(0);
	});

	it('short-circuits on a middle gate denial and skips later gates', () => {
		const g1 = makePassGate('gate-1');
		const g2 = makeDenyGate('gate-2');
		const g3 = makePassGate('gate-3');
		const g4 = makePassGate('gate-4');

		const result = evaluatePermissions(makeRequest(), makeConfig(), [g1, g2, g3, g4]);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.gate).toBe('gate-2');
		}
		expect(g1.callCount).toBe(1);
		expect(g2.callCount).toBe(1);
		expect(g3.callCount).toBe(0);
		expect(g4.callCount).toBe(0);
	});

	it('returns the last gate error when only the last gate fails', () => {
		const g1 = makePassGate('gate-1');
		const g2 = makePassGate('gate-2');
		const g3 = makeDenyGate('gate-3');

		const result = evaluatePermissions(makeRequest(), makeConfig(), [g1, g2, g3]);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.gate).toBe('gate-3');
		}
		expect(g1.callCount).toBe(1);
		expect(g2.callCount).toBe(1);
		expect(g3.callCount).toBe(1);
	});

	it('evaluates gates in the order provided', () => {
		const callOrder: string[] = [];
		const makeOrderedGate = (name: string): PermissionGate => ({
			name,
			evaluate(_req: CoreRequest, _cfg: KadoConfig): GateResult {
				callOrder.push(name);
				return {allowed: true};
			},
		});

		evaluatePermissions(makeRequest(), makeConfig(), [
			makeOrderedGate('first'),
			makeOrderedGate('second'),
			makeOrderedGate('third'),
		]);

		expect(callOrder).toEqual(['first', 'second', 'third']);
	});

	it('returns UNAUTHORIZED error from gate 1 (authenticate position)', () => {
		const unauthorizedGate: PermissionGate = {
			name: 'authenticate',
			evaluate(): GateResult {
				return {allowed: false, error: {code: 'UNAUTHORIZED', message: 'No key', gate: 'authenticate'}};
			},
		};
		const g2 = makePassGate('gate-2');

		const result = evaluatePermissions(makeRequest(), makeConfig(), [unauthorizedGate, g2]);

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('UNAUTHORIZED');
		}
		expect(g2.callCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// createDefaultGateChain — structure
// ---------------------------------------------------------------------------

describe('createDefaultGateChain', () => {
	it('returns exactly 5 gates', () => {
		const chain = createDefaultGateChain();
		expect(chain).toHaveLength(5);
	});

	it('returns gates in the required order: authenticate, global-scope, key-scope, datatype-permission, path-access', () => {
		const chain = createDefaultGateChain();
		expect(chain[0].name).toBe('authenticate');
		expect(chain[1].name).toBe('global-scope');
		expect(chain[2].name).toBe('key-scope');
		expect(chain[3].name).toBe('datatype-permission');
		expect(chain[4].name).toBe('path-access');
	});

	it('returns a new array instance on each call', () => {
		const a = createDefaultGateChain();
		const b = createDefaultGateChain();
		expect(a).not.toBe(b);
	});
});

// ---------------------------------------------------------------------------
// Single key resolution invariant (M6) — resolvedKey is attached once
// ---------------------------------------------------------------------------

describe('evaluatePermissions — single key resolution (M6)', () => {
	function makeConfigWithKey(): KadoConfig {
		const config = makeConfig();
		config.apiKeys = [
			{
				id: 'kado_test-key',
				label: 'test',
				enabled: true,
				createdAt: 1_700_000_000_000,
				listMode: 'blacklist',
				paths: [],
				tags: [],
				allowActiveNote: false,
				allowOtherNotes: false,
			},
		];
		return config;
	}

	it('resolves the API key exactly once across the entire chain', () => {
		const config = makeConfigWithKey();
		const findSpy = {count: 0};
		const originalFind = Array.prototype.find;
		// Wrap apiKeys.find to count calls — precise enough for the invariant
		// without touching global state of other arrays.
		config.apiKeys.find = function (this: unknown[], predicate: (v: unknown, i: number, a: unknown[]) => unknown) {
			findSpy.count++;
			return originalFind.call(this, predicate);
		} as typeof Array.prototype.find;

		const observed: Array<{name: string; hasResolvedKey: boolean}> = [];
		const observingGate = (name: string): PermissionGate => ({
			name,
			evaluate(req: CoreRequest): GateResult {
				observed.push({name, hasResolvedKey: 'resolvedKey' in req && req.resolvedKey !== undefined});
				return {allowed: true};
			},
		});

		const gates = [observingGate('authenticate'), observingGate('key-scope'), observingGate('datatype-permission')];

		const result = evaluatePermissions(makeRequest(), config, gates);

		expect(result.allowed).toBe(true);
		// Exactly one find() on the happy path — the pre-chain resolve
		expect(findSpy.count).toBe(1);
		// Every gate saw an enriched request with resolvedKey set
		expect(observed.every((o) => o.hasResolvedKey)).toBe(true);
	});

	it('still short-circuits on unknown key via the authenticate gate', () => {
		const config = makeConfigWithKey();
		// Override request with an unknown key ID
		const request: CoreRequest = {apiKeyId: 'kado_unknown', operation: 'note', path: 'notes/test.md'};

		const result = evaluatePermissions(request, config, createDefaultGateChain());

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('UNAUTHORIZED');
			expect(result.error.gate).toBe('authenticate');
		}
	});

	it('still short-circuits on disabled key via the authenticate gate', () => {
		const config = makeConfigWithKey();
		config.apiKeys[0]!.enabled = false;

		const result = evaluatePermissions(makeRequest(), config, createDefaultGateChain());

		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('UNAUTHORIZED');
		}
	});
});
