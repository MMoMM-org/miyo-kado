/**
 * Graph navigation permission policy — pure core, no MCP/SDK/obsidian imports.
 *
 * Graph traversal reads the link structure of the source note, so it requires
 * `note.read` on the source path. Rather than teach the gate chain a new request
 * shape, we compose the EXISTING gates over a synthetic note read (same approach
 * as rename-policy), so global-scope, key-scope, path-access, and
 * datatype-permission all enforce with zero new gates.
 *
 * Result-node scope filtering (a resolved neighbour may sit outside the key's
 * scope) is applied separately in the tool layer — this policy only authorizes
 * reading the source.
 */

import type {CoreGraphRequest, CoreReadRequest, GateResult, KadoConfig, PermissionGate} from '../types/canonical';
import {evaluatePermissions} from './permission-chain';

/** Authorizes a graph request by gating a synthetic `note` read on its source path. */
export function evaluateGraphPermissions(
	request: CoreGraphRequest,
	config: KadoConfig,
	gates: PermissionGate[],
): GateResult {
	const synth: CoreReadRequest = {apiKeyId: request.apiKeyId, operation: 'note', path: request.path};
	return evaluatePermissions(synth, config, gates);
}
