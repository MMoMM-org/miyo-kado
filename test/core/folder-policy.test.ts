/**
 * Tests for folder-policy — gates an empty-folder delete by composing the
 * existing permission chain over a synthetic note.delete on the folder path.
 * Pure core (no obsidian/SDK).
 */

import {describe, it, expect, vi} from 'vitest';
import {evaluateFolderDeletePermissions, evaluateFolderRenamePermissions} from '../../src/core/folder-policy';
import type {CoreDeleteRequest, CoreRenameRequest, KadoConfig, PermissionGate, GateResult, CoreRequest} from '../../src/types/canonical';

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

const renameReq: CoreRenameRequest = {
	kind: 'rename', apiKeyId: 'k', operation: 'folder',
	source: 'Projects/alt', target: 'Projects/neu', expectedModified: 0,
};

describe('evaluateFolderRenamePermissions()', () => {
	it('allows when synthetic note updates on both paths pass', () => {
		const result = evaluateFolderRenamePermissions(renameReq, config, [gate({allowed: true})]);
		expect(result.result.allowed).toBe(true);
		expect(result.mode).toBe('rename');
	});

	it('denies when the gate rejects (checked on source first)', () => {
		const denied: GateResult = {allowed: false, error: {code: 'FORBIDDEN', message: 'no', gate: 'key-scope'}};
		const spy = vi.fn();
		const result = evaluateFolderRenamePermissions(renameReq, config, [gate(denied, spy)]);
		expect(result.result.allowed).toBe(false);
		// short-circuits on the source path
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledWith(expect.objectContaining({operation: 'note', path: 'Projects/alt'}));
	});

	it('gates a note UPDATE on BOTH source and target paths', () => {
		const paths: string[] = [];
		evaluateFolderRenamePermissions(renameReq, config, [gate({allowed: true}, (r) => paths.push((r as {path: string}).path))]);
		expect(paths).toEqual(['Projects/alt', 'Projects/neu']);
	});
});
