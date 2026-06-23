/**
 * Tests for graph-policy — gates a graph navigation by composing the existing
 * permission chain over a synthetic note read on the source path. Pure core.
 */

import {describe, it, expect, vi} from 'vitest';
import {evaluateGraphPermissions} from '../../src/core/graph-policy';
import type {CoreGraphRequest, KadoConfig, PermissionGate, GateResult, CoreRequest} from '../../src/types/canonical';

const config = {apiKeys: []} as unknown as KadoConfig;

function gate(result: GateResult, spy?: (req: CoreRequest) => void): PermissionGate {
	return {
		name: 'stub',
		evaluate: (req: CoreRequest) => {
			spy?.(req);
			return result;
		},
	};
}

const req: CoreGraphRequest = {kind: 'graph', apiKeyId: 'k', operation: 'backlinks', path: 'notes/a.md'};

describe('evaluateGraphPermissions()', () => {
	it('allows when the synthetic note read passes the gates', () => {
		const result = evaluateGraphPermissions(req, config, [gate({allowed: true})]);
		expect(result.allowed).toBe(true);
	});

	it('denies (FORBIDDEN) when the gates reject the source path', () => {
		const denied: GateResult = {allowed: false, error: {code: 'FORBIDDEN', message: 'no', gate: 'key-scope'}};
		const result = evaluateGraphPermissions(req, config, [gate(denied)]);
		expect(result.allowed).toBe(false);
	});

	it('gates a note read on the source path (not the graph operation)', () => {
		const spy = vi.fn();
		evaluateGraphPermissions(req, config, [gate({allowed: true}, spy)]);
		expect(spy).toHaveBeenCalledWith(expect.objectContaining({operation: 'note', path: 'notes/a.md'}));
	});
});
