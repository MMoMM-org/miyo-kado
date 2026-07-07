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

import type {CoreDeleteRequest, CoreRenameRequest, CoreWriteRequest, GateResult, KadoConfig, PermissionGate} from '../types/canonical';
import {evaluatePermissions} from './permission-chain';

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
