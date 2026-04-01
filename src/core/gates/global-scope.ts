/**
 * GlobalScopeGate — Gate 1 in the Kado permission chain.
 *
 * Checks whether the request path falls within the global security scope using
 * the single-scope model (listMode + paths). Default-deny for whitelists: if
 * no paths are configured, or none match, the request is denied with FORBIDDEN.
 * Blacklists grant full access when the path is not listed.
 *
 * Search requests without a path field are allowed — scope filtering for
 * search results happens in a later gate.
 *
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {PermissionGate, CoreRequest, KadoConfig, GateResult} from '../../types/canonical';
import {isCoreSearchRequest} from '../../types/canonical';
import {resolveScope} from './scope-resolver';

function forbidden(message: string): GateResult {
	return {
		allowed: false,
		error: {code: 'FORBIDDEN', message, gate: 'global-scope'},
	};
}

/** Gate 1: checks the request path against the global whitelist/blacklist scope. */
export const globalScopeGate: PermissionGate = {
	name: 'global-scope',

	evaluate(request: CoreRequest, config: KadoConfig): GateResult {
		if (isCoreSearchRequest(request) && request.path === undefined) {
			return {allowed: true};
		}

		const path = (request as {path?: string}).path;

		if (path === undefined) {
			return {allowed: true};
		}

		const effective = resolveScope(config.security, path);
		if (effective === null) {
			return forbidden('Path is not within the configured global security scope');
		}

		return {allowed: true};
	},
};
