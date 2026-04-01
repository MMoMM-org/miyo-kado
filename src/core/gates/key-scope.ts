/**
 * KeyScopeGate — Gate 2 in the Kado permission chain.
 *
 * Verifies that the request path falls within the API key's own security scope
 * using the single-scope model (listMode + paths). Whitelists require a path
 * match; blacklists deny only listed paths.
 *
 * Search requests without a path are allowed — scope filtering for search is
 * handled elsewhere.
 *
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import {isCoreSearchRequest} from '../../types/canonical';
import type {CoreRequest, GateResult, KadoConfig, PermissionGate} from '../../types/canonical';
import {resolveScope} from './scope-resolver';

function forbidden(message: string): GateResult {
	return {
		allowed: false,
		error: {code: 'FORBIDDEN', message, gate: 'key-scope'},
	};
}

/** Gate 2: checks the request path against the API key's own whitelist/blacklist scope. */
export const keyScopeGate: PermissionGate = {
	name: 'key-scope',

	evaluate(request: CoreRequest, config: KadoConfig): GateResult {
		if (isCoreSearchRequest(request) && request.path === undefined) {
			return {allowed: true};
		}

		const key = config.apiKeys.find((k) => k.id === request.apiKeyId);
		if (!key) {
			return forbidden('API key not found.');
		}

		const path = (request as {path?: string}).path ?? '';

		const effective = resolveScope({listMode: key.listMode, paths: key.paths}, path);
		if (effective === null) {
			return forbidden('Request path is outside the key\'s permitted scope.');
		}

		return {allowed: true};
	},
};
