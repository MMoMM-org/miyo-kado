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

/**
 * Extract inline tags from markdown body in document order, deduplicated.
 *
 * Skips tags inside fenced code blocks, inline code spans, URL fragments
 * (e.g. `http://x#anchor`) and markdown link anchors (e.g. `](path#section)`).
 * A `#` preceded by a word character (e.g. `no#tag`) is not a tag.
 * Returned tags have no leading `#`.
 */
export function extractInlineTags(body: string): string[] {
	if (!body) return [];

	let stripped = body.replace(/```[\s\S]*?```/g, ' ');
	stripped = stripped.replace(/`[^`\n]*`/g, ' ');
	stripped = stripped.replace(/\]\([^)]*\)/g, ' ');
	stripped = stripped.replace(/https?:\/\/\S+/gi, ' ');

	const result: string[] = [];
	const seen = new Set<string>();
	const re = /(?<![\w#])#([A-Za-z0-9_][A-Za-z0-9_\-/]*)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(stripped)) !== null) {
		const tag = match[1];
		if (tag && !seen.has(tag)) {
			seen.add(tag);
			result.push(tag);
		}
	}
	return result;
}

/** Returns true if the tag pattern ends with '/*'. */
export function isWildcardTag(pattern: string): boolean {
	return pattern.endsWith('/*');
}

/**
 * Match a tag against a pattern.
 * - Global wildcard: '*' matches any tag.
 * - Wildcard: 'project/*' matches 'project/a', 'project/b/c' but NOT 'project' itself.
 * - Bare name: 'project' matches 'project' exactly AND sub-tags like 'project/sub'.
 */
export function matchTag(tag: string, pattern: string): boolean {
	if (pattern === '*') return true;
	if (isWildcardTag(pattern)) {
		const prefix = pattern.slice(0, -1); // remove trailing '*', keep '/'
		return tag.startsWith(prefix);
	}
	// Bare name: exact match OR sub-tag match
	return tag === pattern || tag.startsWith(pattern + '/');
}
