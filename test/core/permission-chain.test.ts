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
		server: {enabled: false, host: '127.0.0.1', port: 23026},
		globalAreas: [],
		apiKeys: [],
		audit: {enabled: true, logFilePath: 'plugins/kado/audit.log', maxSizeBytes: 10485760},
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
