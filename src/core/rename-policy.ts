/**
 * Rename/move permission policy — pure core logic, no MCP/SDK/obsidian imports.
 *
 * The rename→update / move→delete+create decision lives here (extracted from the
 * MCP tool layer so it is unit-testable without the SDK and keeps tools.ts under
 * the file-size budget). It is expressed by composing the EXISTING permission
 * gate chain over synthetic single-path requests, so global-scope, key-scope,
 * path-access, and datatype-permission all enforce on every path with zero new
 * gates — the two-layer access model can never drift out of sync with the other
 * tools.
 */

import type {
	CoreRenameRequest,
	CoreWriteRequest,
	CoreDeleteRequest,
	GateResult,
	KadoConfig,
	PermissionGate,
} from '../types/canonical';
import {evaluatePermissions} from './permission-chain';

/** Returns the parent folder of a vault path ('' for a root-level file). */
export function parentDir(path: string): string {
	const i = path.lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i);
}

/** Classifies a rename request as an in-folder rename or a cross-folder move. */
export function renameMode(request: CoreRenameRequest): 'rename' | 'move' {
	return parentDir(request.source) === parentDir(request.target) ? 'rename' : 'move';
}

/**
 * Evaluates permission for a rename/move by composing the existing gate chain
 * over synthetic single-path requests. Policy:
 *
 *   - Rename (same parent folder): require `update` on BOTH source and target.
 *     Same folder normally means identical permissions, but checking both still
 *     gates correctly when a key's scope is filename-specific.
 *   - Move (different parent folder): require `delete` on source AND `create` on
 *     target — the file leaves one scope and enters another.
 *
 * Returns the gate result plus the resolved mode (for audit/labelling).
 */
export function evaluateRenamePermissions(
	request: CoreRenameRequest,
	config: KadoConfig,
	gates: PermissionGate[],
): {result: GateResult; mode: 'rename' | 'move'} {
	const {apiKeyId, operation, source, target} = request;
	const mode = renameMode(request);

	if (mode === 'rename') {
		// Synthetic write with expectedModified set → inferCrudAction = 'update'.
		for (const path of [source, target]) {
			const synth: CoreWriteRequest = {apiKeyId, operation, path, content: '', expectedModified: 0};
			const r = evaluatePermissions(synth, config, gates);
			if (!r.allowed) return {result: r, mode};
		}
		return {result: {allowed: true}, mode};
	}

	// Move: delete on source.
	const delSynth: CoreDeleteRequest = {kind: 'delete', apiKeyId, operation, path: source, expectedModified: 0};
	const delRes = evaluatePermissions(delSynth, config, gates);
	if (!delRes.allowed) return {result: delRes, mode};

	// Move: create on target (synthetic write WITHOUT expectedModified → 'create').
	const createSynth: CoreWriteRequest = {apiKeyId, operation, path: target, content: ''};
	const createRes = evaluatePermissions(createSynth, config, gates);
	if (!createRes.allowed) return {result: createRes, mode};

	return {result: {allowed: true}, mode};
}
