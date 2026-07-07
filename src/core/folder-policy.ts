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

import type {CoreDeleteRequest, GateResult, KadoConfig, PermissionGate} from '../types/canonical';
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
