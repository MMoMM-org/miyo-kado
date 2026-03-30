/**
 * Permission chain — evaluates a sequence of PermissionGates in order.
 *
 * The first gate returning `{ allowed: false }` short-circuits the chain;
 * no subsequent gates are called. An empty gate array is treated as allowed.
 *
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {CoreRequest, GateResult, KadoConfig, PermissionGate} from '../types/canonical';
import {authenticateGate} from './gates/authenticate';
import {globalScopeGate} from './gates/global-scope';
import {keyScopeGate} from './gates/key-scope';
import {dataTypePermissionGate} from './gates/datatype-permission';
import {PathAccessGate} from './gates/path-access';

/**
 * Evaluates `gates` in order against `request` and `config`.
 * Returns the first denial encountered, or `{ allowed: true }` if all pass.
 */
export function evaluatePermissions(
	request: CoreRequest,
	config: KadoConfig,
	gates: PermissionGate[],
): GateResult {
	for (const gate of gates) {
		const result = gate.evaluate(request, config);
		if (!result.allowed) {
			return result;
		}
	}
	return {allowed: true};
}

/**
 * Returns the default gate chain in evaluation order:
 *   0. authenticate
 *   1. global-scope
 *   2. key-scope
 *   3. datatype-permission
 *   4. path-access
 */
export function createDefaultGateChain(): PermissionGate[] {
	return [
		authenticateGate,
		globalScopeGate,
		keyScopeGate,
		dataTypePermissionGate,
		new PathAccessGate(),
	];
}
