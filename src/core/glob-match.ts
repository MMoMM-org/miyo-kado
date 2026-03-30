/**
 * Shared glob matching utility for Kado permission gates.
 *
 * Supports `**` (any path segments), `*` (any single segment characters),
 * and literal path matching. No imports from `obsidian` or
 * `@modelcontextprotocol/sdk`.
 */

const DOUBLE_STAR_PLACEHOLDER = '__KADO_DOUBLE_STAR__';

/**
 * Converts a glob pattern into a RegExp for path matching.
 * Supports `**` (matches zero or more path segments including slashes)
 * and `*` (matches any characters except a slash).
 */
function globToRegExp(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*/g, DOUBLE_STAR_PLACEHOLDER)
		.replace(/\*/g, '[^/]*')
		.replace(new RegExp(DOUBLE_STAR_PLACEHOLDER, 'g'), '.*');
	return new RegExp(`^${escaped}$`);
}

/**
 * Returns true when `path` matches the given glob `pattern`.
 * Matching is case-sensitive and anchored at both ends.
 */
export function matchGlob(pattern: string, path: string): boolean {
	return globToRegExp(pattern).test(path);
}

/**
 * Returns true when `path` matches at least one of the given glob `patterns`.
 */
export function pathMatchesPatterns(path: string, patterns: string[]): boolean {
	return patterns.some((pattern) => matchGlob(pattern, path));
}
