/**
 * Folder-operation permission policy — pure core logic, no MCP/SDK/obsidian imports.
 *
 * A folder has no permission dimension of its own. Rather than add one (or a new
 * gate), folder-operation authority is expressed by composing the EXISTING gate
 * chain over a synthetic single-path request (the rename-policy / graph-policy
 * pattern), so global-scope, key-scope, path-access, and datatype-permission all
 * enforce with zero new gates and can never drift from the other tools.
 *
 * An empty-folder delete is modeled as `note.delete` at the folder path — notes
 * are the dominant datatype in a PKM vault and the folder exists to hold them,
 * so "may delete notes here" is the natural authority to remove the empty
 * container. This mirrors how 'tags' reads map to note.read in the datatype gate.
 */

import type {ApiKeyConfig, CoreDeleteRequest, CoreRenameRequest, CoreWriteRequest, DataTypePermissions, GateResult, KadoConfig, PermissionGate} from '../types/canonical';
import {evaluatePermissions} from './permission-chain';
import {resolveScope} from './gates/scope-resolver';

/**
 * Evaluates permission for an empty-folder delete by composing the existing gate
 * chain over a synthetic `note` delete at the folder path. Requires the key to
 * hold `note.delete` at that path (intersected global + key scope).
 */
export function evaluateFolderDeletePermissions(
	request: CoreDeleteRequest,
	config: KadoConfig,
	gates: PermissionGate[],
): GateResult {
	const synth: CoreDeleteRequest = {
		kind: 'delete',
		apiKeyId: request.apiKeyId,
		operation: 'note',
		path: request.path,
		expectedModified: 0,
	};
	return evaluatePermissions(synth, config, gates);
}

/**
 * Evaluates permission for an in-place folder rename by composing the existing
 * gate chain over synthetic `note` updates at BOTH the source and target paths
 * (a rename is a form of editing → `update`, checked on both so filename-specific
 * scopes still gate). A folder rename is in-place (same parent, enforced by the
 * adapter), so source and target share a folder; modeled as note.update for the
 * same reason as folder delete → note.delete. Returns the gate result plus a
 * fixed `mode:'rename'` so the caller can destructure it like the file path.
 */
export function evaluateFolderRenamePermissions(
	request: CoreRenameRequest,
	config: KadoConfig,
	gates: PermissionGate[],
): {result: GateResult; mode: 'rename'} {
	for (const path of [request.source, request.target]) {
		// expectedModified set → inferCrudAction = 'update'.
		const synth: CoreWriteRequest = {apiKeyId: request.apiKeyId, operation: 'note', path, content: '', expectedModified: 0};
		const r = evaluatePermissions(synth, config, gates);
		if (!r.allowed) return {result: r, mode: 'rename'};
	}
	return {result: {allowed: true}, mode: 'rename'};
}

/** Compares two resolved scopes (DataTypePermissions or null) for exact CRUD equality. */
function permissionsEqual(a: DataTypePermissions | null, b: DataTypePermissions | null): boolean {
	if (a === null || b === null) return a === b;
	const types: (keyof DataTypePermissions)[] = ['note', 'frontmatter', 'file', 'dataviewInlineField'];
	const actions: (keyof DataTypePermissions['note'])[] = ['create', 'read', 'update', 'delete'];
	for (const t of types) {
		for (const c of actions) {
			if (a[t][c] !== b[t][c]) return false;
		}
	}
	return true;
}

/**
 * RBAC permission-neutral invariant for a folder rename (spec 009, C-4 / ADR-4).
 *
 * An in-place folder rename rewrites every descendant path
 * (`source/rel → target/rel`), which could move content across a permission
 * boundary. This check is **fail-closed**: for the folder and every descendant it
 * compares the effective resolved scope at the source path vs the rewritten
 * target path — for BOTH the global security scope AND the acting key's scope —
 * and returns VALIDATION_ERROR (naming the first offending path) if any differ.
 * Identical scope on both sides → neutral → allowed. Kado never rewrites the
 * permission config to "fix" a mismatch: the declaration is the single source of
 * truth, so a boundary-crossing rename is the user's conscious config change.
 *
 * @param paths absolute vault paths of the folder itself and all descendants
 *   (each MUST start with `source`); typically from `collectFolderTreePaths`.
 */
export function checkFolderRenameScopeNeutral(
	source: string,
	target: string,
	paths: string[],
	config: KadoConfig,
	key: ApiKeyConfig,
): GateResult {
	const keyScope = {listMode: key.listMode, paths: key.paths};
	const security = {listMode: config.security.listMode, paths: config.security.paths};
	for (const p of paths) {
		const pPrime = target + p.slice(source.length);
		if (!permissionsEqual(resolveScope(security, p), resolveScope(security, pPrime))) {
			return neutralityError(p, pPrime, 'global security');
		}
		if (!permissionsEqual(resolveScope(keyScope, p), resolveScope(keyScope, pPrime))) {
			return neutralityError(p, pPrime, "the key's");
		}
	}
	return {allowed: true};
}

function neutralityError(from: string, to: string, which: string): GateResult {
	return {
		allowed: false,
		error: {
			code: 'VALIDATION_ERROR',
			gate: 'folder-scope-neutrality',
			message: `Rename blocked: "${from}" would become "${to}", changing its effective access under the ${which} permission scope. Adjust the permission config to make the rename access-neutral, then retry — Kado does not change permissions automatically.`,
		},
	};
}
