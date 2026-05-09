/**
 * Shared scope resolution logic for Kado permission gates.
 *
 * Provides resolveScope() — used by global-scope, key-scope, and
 * datatype-permission gates — to compute effective DataTypePermissions for a
 * given path within a whitelist or blacklist scope.
 *
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {DataTypePermissions, ListMode, PathPermission} from '../../types/canonical';
import {matchGlob, dirCouldContainMatches} from '../glob-match';

/** Minimal scope definition used by resolveScope (works for both global and key scopes). */
export interface ScopeConfig {
	listMode: ListMode;
	paths: PathPermission[];
}

/** Returns DataTypePermissions with all CRUD flags set to true. */
export function createAllPermissions(): DataTypePermissions {
	return {
		note: {create: true, read: true, update: true, delete: true},
		frontmatter: {create: true, read: true, update: true, delete: true},
		file: {create: true, read: true, update: true, delete: true},
		dataviewInlineField: {create: true, read: true, update: true, delete: true},
	};
}

/** Returns DataTypePermissions with all CRUD flags flipped from the input. */
export function invertPermissions(p: DataTypePermissions): DataTypePermissions {
	return {
		note: {create: !p.note.create, read: !p.note.read, update: !p.note.update, delete: !p.note.delete},
		frontmatter: {create: !p.frontmatter.create, read: !p.frontmatter.read, update: !p.frontmatter.update, delete: !p.frontmatter.delete},
		file: {create: !p.file.create, read: !p.file.read, update: !p.file.update, delete: !p.file.delete},
		dataviewInlineField: {create: !p.dataviewInlineField.create, read: !p.dataviewInlineField.read, update: !p.dataviewInlineField.update, delete: !p.dataviewInlineField.delete},
	};
}

/**
 * Returns a specificity score for a glob pattern: the count of literal
 * (non-wildcard) characters. Higher = more specific.
 *
 * Used to pick the most specific matching entry when several patterns
 * overlap (e.g. `**` and `X/900 Support/**` both match the same path).
 * Stable for ties: callers fall back to declaration order.
 */
function patternSpecificity(pattern: string): number {
	let count = 0;
	for (const c of pattern) {
		if (c !== '*' && c !== '?') count++;
	}
	return count;
}

/**
 * Resolves effective permissions for a path within a scope.
 *
 * Per-entry CRUD flags always have the SAME meaning across modes:
 *   true = action allowed on this path, false = action blocked.
 *
 * The two modes differ only in what happens for paths NOT listed:
 * - Whitelist: unlisted path → null (no access at all).
 * - Blacklist: unlisted path → full access.
 *
 * When several patterns match the same request path, the **most specific**
 * pattern wins (longest run of literal characters). Declaration order is
 * the deterministic tie-breaker — first declared wins on equal specificity.
 * This lets a vault-wide `**` rule coexist with narrower exceptions like
 * `X/900 Support/**` regardless of the order they appear in the config.
 *
 * Directory paths (ending with '/') also match patterns that would contain files
 * under that directory, e.g. 'allowed/' matches 'allowed/**'.
 */
export function resolveScope(scope: ScopeConfig, requestPath: string): DataTypePermissions | null {
	const isDir = requestPath.endsWith('/');
	let best: PathPermission | undefined;
	let bestScore = -1;
	for (const entry of scope.paths) {
		const matches = matchGlob(entry.path, requestPath)
			|| (isDir && dirCouldContainMatches(entry.path, requestPath));
		if (!matches) continue;
		const score = patternSpecificity(entry.path);
		if (score > bestScore) {
			best = entry;
			bestScore = score;
		}
	}

	if (scope.listMode === 'whitelist') {
		return best ? best.permissions : null;
	}

	if (!best) return createAllPermissions();
	return best.permissions;
}

/**
 * Returns the intersection (AND) of two DataTypePermissions.
 * A flag is true only when it is true in both inputs.
 */
export function intersectPermissions(a: DataTypePermissions, b: DataTypePermissions): DataTypePermissions {
	return {
		note: {create: a.note.create && b.note.create, read: a.note.read && b.note.read, update: a.note.update && b.note.update, delete: a.note.delete && b.note.delete},
		frontmatter: {create: a.frontmatter.create && b.frontmatter.create, read: a.frontmatter.read && b.frontmatter.read, update: a.frontmatter.update && b.frontmatter.update, delete: a.frontmatter.delete && b.frontmatter.delete},
		file: {create: a.file.create && b.file.create, read: a.file.read && b.file.read, update: a.file.update && b.file.update, delete: a.file.delete && b.file.delete},
		dataviewInlineField: {create: a.dataviewInlineField.create && b.dataviewInlineField.create, read: a.dataviewInlineField.read && b.dataviewInlineField.read, update: a.dataviewInlineField.update && b.dataviewInlineField.update, delete: a.dataviewInlineField.delete && b.dataviewInlineField.delete},
	};
}
