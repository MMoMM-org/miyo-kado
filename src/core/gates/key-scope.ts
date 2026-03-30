/**
 * KeyScopeGate — Gate 2 in the Kado permission chain.
 *
 * Verifies that the request path falls within at least one area assigned to
 * the API key. The key's areas reference global areas by areaId; the path must
 * match a pathPattern in the resolved global area.
 *
 * Search requests without a path are allowed — scope filtering for search is
 * handled elsewhere.
 *
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import {isCoreSearchRequest} from '../../types/canonical';
import type {CoreRequest, GateResult, KadoConfig, PermissionGate} from '../../types/canonical';
import {pathMatchesPatterns} from '../glob-match';

function forbidden(message: string): GateResult {
	return {
		allowed: false,
		error: {code: 'FORBIDDEN', message, gate: 'key-scope'},
	};
}

export const keyScopeGate: PermissionGate = {
	name: 'key-scope',

	evaluate(request: CoreRequest, config: KadoConfig): GateResult {
		if (isCoreSearchRequest(request) && request.path === undefined) {
			return {allowed: true};
		}

		const key = config.apiKeys.find((k) => k.id === request.apiKeyId);
		if (!key || key.areas.length === 0) {
			return forbidden('API key has no areas assigned.');
		}

		const path = (request as {path?: string}).path ?? '';

		for (const keyArea of key.areas) {
			const globalArea = config.globalAreas.find((a) => a.id === keyArea.areaId);
			if (globalArea && pathMatchesPatterns(path, globalArea.pathPatterns)) {
				return {allowed: true};
			}
		}

		return forbidden('Request path is outside the key\'s permitted areas.');
	},
};
