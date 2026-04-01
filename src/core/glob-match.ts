/**
 * Shared glob matching utility for Kado permission gates.
 *
 * Supports `**` (any path segments), `*` (any single segment characters),
 * and literal path matching. No imports from `obsidian` or
 * `@modelcontextprotocol/sdk`.
 */

const DOUBLE_STAR_PLACEHOLDER = '__KADO_DOUBLE_STAR__';

/** Cache compiled RegExp objects keyed by pattern string. */
const regexCache = new Map<string, RegExp>();

const REGEX_CACHE_MAX = 1000;

/**
 * Converts a glob pattern into a RegExp for path matching.
 * Results are memoized — safe because glob patterns are small and finite.
 * Supports `**` (matches zero or more path segments including slashes)
 * and `*` (matches any characters except a slash).
 */
function globToRegExp(pattern: string): RegExp {
	const cached = regexCache.get(pattern);
	if (cached) return cached;
	// Evict entire cache when it grows too large to prevent unbounded memory use
	if (regexCache.size >= REGEX_CACHE_MAX) regexCache.clear();
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*/g, DOUBLE_STAR_PLACEHOLDER)
		.replace(/\*/g, '[^/]*')
		.replace(new RegExp(DOUBLE_STAR_PLACEHOLDER, 'g'), '.*');
	const re = new RegExp(`^${escaped}$`);
	regexCache.set(pattern, re);
	return re;
}

/**
 * Returns true when a pattern has no glob wildcards.
 * Such patterns are treated as directory prefixes (auto-expanded to `pattern/**`).
 */
function isBareName(pattern: string): boolean {
	return !pattern.includes('*') && !pattern.includes('?');
}

/**
 * Returns true when `path` matches the given glob `pattern`.
 * Matching is case-sensitive and anchored at both ends.
 *
 * Bare names without wildcards (e.g. "Calendar") are treated as directory
 * prefixes and also match files under that directory (e.g. "Calendar/note.md").
 */
export function matchGlob(pattern: string, path: string): boolean {
	if (globToRegExp(pattern).test(path)) return true;
	// A bare name like "Calendar" should match "Calendar/note.md"
	if (isBareName(pattern)) {
		return globToRegExp(pattern + '/**').test(path);
	}
	return false;
}

/**
 * Returns true when `path` matches at least one of the given glob `patterns`.
 */
export function pathMatchesPatterns(path: string, patterns: string[]): boolean {
	return patterns.some((pattern) => matchGlob(pattern, path));
}

/**
 * Returns true when `dirPath` (a directory prefix ending with '/') could
 * contain files that match the given glob `pattern`.
 *
 * This handles the case where `allowed/` doesn't directly match `allowed/**`,
 * but files under `allowed/` would. Used by permission gates for listDir.
 */
export function dirCouldContainMatches(pattern: string, dirPath: string): boolean {
	// Direct match covers cases like pattern "allowed/" matching dirPath "allowed/"
	if (matchGlob(pattern, dirPath)) return true;
	// Check if a hypothetical file under dirPath would match the pattern
	return matchGlob(pattern, dirPath + '__probe__');
}
