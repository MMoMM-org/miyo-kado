/**
 * Tests for folder-policy — gates an empty-folder delete by composing the
 * existing permission chain over a synthetic note.delete on the folder path.
 * Pure core (no obsidian/SDK).
 */

import {describe, it, expect, vi} from 'vitest';
import {evaluateFolderDeletePermissions} from '../../src/core/folder-policy';
import type {CoreDeleteRequest, KadoConfig, PermissionGate, GateResult, CoreRequest} from '../../src/types/canonical';

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

const req: CoreDeleteRequest = {kind: 'delete', apiKeyId: 'k', operation: 'folder', path: 'Projects/Empty', expectedModified: 0};

describe('evaluateFolderDeletePermissions()', () => {
	it('allows when the synthetic note delete passes the gates', () => {
		const result = evaluateFolderDeletePermissions(req, config, [gate({allowed: true})]);
		expect(result.allowed).toBe(true);
	});

	it('denies (FORBIDDEN) when the gates reject the folder path', () => {
		const denied: GateResult = {allowed: false, error: {code: 'FORBIDDEN', message: 'no', gate: 'key-scope'}};
		const result = evaluateFolderDeletePermissions(req, config, [gate(denied)]);
		expect(result.allowed).toBe(false);
	});

	it('gates a note DELETE on the folder path (not a folder operation)', () => {
		const spy = vi.fn();
		evaluateFolderDeletePermissions(req, config, [gate({allowed: true}, spy)]);
		expect(spy).toHaveBeenCalledWith(expect.objectContaining({
			kind: 'delete',
			operation: 'note',
			path: 'Projects/Empty',
		}));
	});
});
