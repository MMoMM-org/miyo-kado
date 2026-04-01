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
import {matchGlob} from '../glob-match';

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
 * Resolves effective permissions for a path within a scope.
 *
 * Whitelist: path must match a listed entry — returns that entry's permissions,
 * or null if no entry matches (path not in scope).
 *
 * Blacklist: if no entry matches, full access is granted. If an entry matches,
 * its permissions represent what is BLOCKED, so they are inverted before return.
 */
export function resolveScope(scope: ScopeConfig, requestPath: string): DataTypePermissions | null {
	const match = scope.paths.find((p) => matchGlob(p.path, requestPath));

	if (scope.listMode === 'whitelist') {
		return match ? match.permissions : null;
	}

	if (!match) return createAllPermissions();
	return invertPermissions(match.permissions);
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
