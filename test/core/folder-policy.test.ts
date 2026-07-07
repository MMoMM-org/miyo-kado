/**
 * Tests for folder-policy — gates an empty-folder delete by composing the
 * existing permission chain over a synthetic note.delete on the folder path.
 * Pure core (no obsidian/SDK).
 */

import {describe, it, expect, vi} from 'vitest';
import {evaluateFolderDeletePermissions, evaluateFolderRenamePermissions, checkFolderRenameScopeNeutral} from '../../src/core/folder-policy';
import type {ApiKeyConfig, CoreDeleteRequest, CoreRenameRequest, DataTypePermissions, KadoConfig, PathPermission, PermissionGate, GateResult, CoreRequest} from '../../src/types/canonical';

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

// ---------------------------------------------------------------------------
// RBAC permission-neutral invariant (Phase 4)
// ---------------------------------------------------------------------------

function allPerms(): DataTypePermissions {
	return {
		note: {create: true, read: true, update: true, delete: true},
		frontmatter: {create: true, read: true, update: true, delete: true},
		file: {create: true, read: true, update: true, delete: true},
		dataviewInlineField: {create: true, read: true, update: true, delete: true},
	};
}

function cfg(securityPaths: PathPermission[], listMode: 'whitelist' | 'blacklist' = 'whitelist'): KadoConfig {
	return {security: {listMode, paths: securityPaths}, apiKeys: []} as unknown as KadoConfig;
}

// A key with blacklist + no paths → full access everywhere → never the offender.
const openKey = {listMode: 'blacklist', paths: []} as unknown as ApiKeyConfig;

describe('checkFolderRenameScopeNeutral()', () => {
	it('allows when the whole subtree stays under one governing rule', () => {
		// Broad whitelist 'A/**' covers both source and target subtrees identically.
		const config = cfg([{path: 'A/**', permissions: allPerms()}]);
		const paths = ['A/alt', 'A/alt/note.md', 'A/alt/sub/deep.md'];

		const r = checkFolderRenameScopeNeutral('A/alt', 'A/neu', paths, config, openKey);
		expect(r.allowed).toBe(true);
	});

	it('blocks (VALIDATION_ERROR) when a descendant would leave a whitelisted global rule', () => {
		// Only 'A/alt/**' is whitelisted; after rename to 'A/neu' the descendants
		// match nothing → resolveScope flips from allPerms to null → not neutral.
		const config = cfg([{path: 'A/alt/**', permissions: allPerms()}]);
		const paths = ['A/alt', 'A/alt/note.md'];

		const r = checkFolderRenameScopeNeutral('A/alt', 'A/neu', paths, config, openKey);
		expect(r.allowed).toBe(false);
		if (!r.allowed) {
			expect(r.error.code).toBe('VALIDATION_ERROR');
			expect(r.error.gate).toBe('folder-scope-neutrality');
			expect(r.error.message).toContain('global security');
			expect(r.error.message).toContain('A/neu/note.md');
		}
	});

	it('blocks when the acting KEY scope differs at the target (global neutral)', () => {
		// Global is blacklist-all (neutral everywhere); the KEY whitelists only the
		// source subtree, so the target would fall outside the key's scope.
		const config = cfg([], 'blacklist');
		const key = {listMode: 'whitelist', paths: [{path: 'A/alt/**', permissions: allPerms()}]} as unknown as ApiKeyConfig;
		const paths = ['A/alt', 'A/alt/note.md'];

		const r = checkFolderRenameScopeNeutral('A/alt', 'A/neu', paths, config, key);
		expect(r.allowed).toBe(false);
		if (!r.allowed) expect(r.error.message).toContain("the key's");
	});

	it('allows a rename entirely within a broad blacklist (no rules distinguish the segment)', () => {
		const config = cfg([], 'blacklist');
		const paths = ['Projects/alt', 'Projects/alt/a.md', 'Projects/alt/b.md'];

		const r = checkFolderRenameScopeNeutral('Projects/alt', 'Projects/neu', paths, config, openKey);
		expect(r.allowed).toBe(true);
	});

	it('does not mutate the config (block-not-migrate)', () => {
		const config = cfg([{path: 'A/alt/**', permissions: allPerms()}]);
		const before = JSON.stringify(config);

		checkFolderRenameScopeNeutral('A/alt', 'A/neu', ['A/alt', 'A/alt/x.md'], config, openKey);

		expect(JSON.stringify(config)).toBe(before);
	});
});
