/**
 * AuthenticateGate — Gate 0 in the Kado permission chain.
 *
 * Verifies that the apiKeyId in the request maps to a known, enabled
 * API key in the config. Rejects with UNAUTHORIZED on any mismatch.
 *
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {PermissionGate, CoreRequest, KadoConfig, GateResult} from '../../types/canonical';

function unauthorized(message: string): GateResult {
	return {
		allowed: false,
		error: {code: 'UNAUTHORIZED', message, gate: 'authenticate'},
	};
}

/** Gate 0: verifies the request carries a known, enabled API key. */
export const authenticateGate: PermissionGate = {
	name: 'authenticate',

	evaluate(request: CoreRequest, config: KadoConfig): GateResult {
		if (!request.apiKeyId) {
			return unauthorized('API key ID is required.');
		}

		// Prefer the resolved key attached by permission-chain entry (M6);
		// fall back to direct lookup for tests that call the gate directly.
		const key = request.resolvedKey ?? config.apiKeys.find((k) => k.id === request.apiKeyId);

		if (!key) {
			return unauthorized('Invalid or missing API key');
		}

		if (!key.enabled) {
			return unauthorized('Invalid or missing API key');
		}

		return {allowed: true};
	},
};
