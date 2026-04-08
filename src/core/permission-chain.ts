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
 *
 * Resolves the API key once at entry and attaches it to the request as
 * `resolvedKey` (M6 hardening). Downstream gates prefer this over their own
 * `config.apiKeys.find` lookup. The authenticate gate still validates the
 * key exists and is enabled — it just reads from the enriched request now.
 */
export function evaluatePermissions(
	request: CoreRequest,
	config: KadoConfig,
	gates: PermissionGate[],
): GateResult {
	const enrichedRequest = enrichWithResolvedKey(request, config);
	for (const gate of gates) {
		const result = gate.evaluate(enrichedRequest, config);
		if (!result.allowed) {
			return result;
		}
	}
	return {allowed: true};
}

/**
 * Returns a new request object with `resolvedKey` set if the apiKeyId matches
 * a key in config. Returns the original request unchanged otherwise — the
 * authenticate gate will surface the "unknown key" error.
 */
function enrichWithResolvedKey(request: CoreRequest, config: KadoConfig): CoreRequest {
	if (!request.apiKeyId) return request;
	const resolvedKey = config.apiKeys.find((k) => k.id === request.apiKeyId);
	if (!resolvedKey) return request;
	return {...request, resolvedKey} as CoreRequest;
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
