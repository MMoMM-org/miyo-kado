/**
 * Tag normalization and matching utilities.
 *
 * Tags are stored without '#' prefix. Wildcard '*' is only valid at the
 * end of a tag pattern (e.g. 'project/*' matches 'project/a', 'project/b/c').
 *
 * ZERO imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

/**
 * Normalize a tag input: strip leading '#', trim whitespace.
 * Returns null if the result is empty.
 */
export function normalizeTag(input: string): string | null {
	const trimmed = input.trim();
	const stripped = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
	const result = stripped.trim();
	return result.length > 0 ? result : null;
}

/** Returns true if the tag pattern ends with '/*'. */
export function isWildcardTag(pattern: string): boolean {
	return pattern.endsWith('/*');
}

/**
 * Match a tag against a pattern.
 * - Exact match: 'project' matches 'project'.
 * - Wildcard: 'project/*' matches 'project/a', 'project/b/c' but NOT 'project' itself.
 */
export function matchTag(tag: string, pattern: string): boolean {
	if (!isWildcardTag(pattern)) {
		return tag === pattern;
	}
	// Wildcard: 'project/*' → prefix 'project/'
	const prefix = pattern.slice(0, -1); // remove trailing '*', keep '/'
	return tag.startsWith(prefix);
}
