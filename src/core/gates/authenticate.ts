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

export const authenticateGate: PermissionGate = {
	name: 'authenticate',

	evaluate(request: CoreRequest, config: KadoConfig): GateResult {
		if (!request.apiKeyId) {
			return unauthorized('API key ID is required.');
		}

		const key = config.apiKeys.find((k) => k.id === request.apiKeyId);

		if (!key) {
			return unauthorized(`API key not found: ${request.apiKeyId}`);
		}

		if (!key.enabled) {
			return unauthorized(`API key is disabled: ${request.apiKeyId}`);
		}

		return {allowed: true};
	},
};
