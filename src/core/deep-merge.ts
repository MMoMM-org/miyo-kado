/**
 * Recursive merge for plain-object frontmatter records.
 *
 * Used by the frontmatter-adapter to implement `kado-write operation=frontmatter`
 * with mode=merge: every key where both existing and supplied values are plain
 * objects recurses; everything else (arrays, scalars, null, type mismatches)
 * replaces. Arrays NEVER merge — tomo's lifecycle and similar replacement-style
 * value semantics are the dominant use case, and concat-merge would be a
 * silently wrong default.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object') return false;
	if (Array.isArray(value)) return false;
	const proto: unknown = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

export function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	for (const key of Object.keys(source)) {
		// Inline pollution-key guard. Equivalent to a Set lookup but matches
		// CodeQL's `js/prototype-polluting-assignment` recognised pattern so
		// the alert is closed at analysis time rather than dismissed.
		if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
		const next = source[key];
		const current = target[key];
		if (isPlainObject(current) && isPlainObject(next)) {
			deepMerge(current, next);
		} else {
			target[key] = next;
		}
	}
	return target;
}
