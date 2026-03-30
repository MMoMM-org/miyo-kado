/**
 * GlobalScopeGate — Gate 1 in the Kado permission chain.
 *
 * Checks whether the request path falls within any globally defined area by
 * matching against each area's pathPatterns using glob syntax.  Default-deny:
 * if no global areas are configured, or none of their patterns match the
 * request path, the request is denied with FORBIDDEN.
 *
 * Search requests without a path field are allowed — scope filtering for
 * search results happens in a later gate.
 *
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {PermissionGate, CoreRequest, KadoConfig, GateResult} from '../../types/canonical';
import {isCoreSearchRequest} from '../../types/canonical';

/**
 * Converts a glob pattern to a RegExp.
 *
 * Rules:
 *   `**`  → matches any number of path segments (including zero)
 *   `*`   → matches any characters within a single path segment (no `/`)
 *   All other regex-special characters are escaped.
 */
function globToRegex(pattern: string): RegExp {
	let regexStr = '';
	let i = 0;

	while (i < pattern.length) {
		if (pattern[i] === '*' && pattern[i + 1] === '*') {
			// ** — consume optional surrounding slashes so "a/**/b" also covers "a/b"
			const hasPrecedingSlash = regexStr.endsWith('/');
			if (hasPrecedingSlash) {
				regexStr = regexStr.slice(0, -1);
			}
			regexStr += '(?:/.+|/.+/|)';
			i += 2;
			// skip a trailing slash so "**/" doesn't leave a dangling separator
			if (pattern[i] === '/') {
				i++;
			}
		} else if (pattern[i] === '*') {
			// * — any chars except path separator
			regexStr += '[^/]*';
			i++;
		} else {
			// escape regex special characters
			const ch = pattern[i] ?? '';
			regexStr += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
			i++;
		}
	}

	return new RegExp(`^${regexStr}$`);
}

/**
 * Returns true when `path` matches `pattern` using glob semantics.
 */
function matchGlob(pattern: string, path: string): boolean {
	if (pattern === path) {
		return true;
	}
	return globToRegex(pattern).test(path);
}

function forbidden(message: string): GateResult {
	return {
		allowed: false,
		error: {code: 'FORBIDDEN', message, gate: 'global-scope'},
	};
}

export const globalScopeGate: PermissionGate = {
	name: 'global-scope',

	evaluate(request: CoreRequest, config: KadoConfig): GateResult {
		// Search requests without a path bypass this gate
		if (isCoreSearchRequest(request) && request.path === undefined) {
			return {allowed: true};
		}

		const path = (request as {path?: string}).path;

		if (path === undefined) {
			return {allowed: true};
		}

		for (const area of config.globalAreas) {
			for (const pattern of area.pathPatterns) {
				if (matchGlob(pattern, path)) {
					return {allowed: true};
				}
			}
		}

		return forbidden(`Path '${path}' is not within any configured global area.`);
	},
};
