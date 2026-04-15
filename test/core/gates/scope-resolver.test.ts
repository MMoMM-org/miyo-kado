/**
 * Behavioral tests for scope-resolver utility functions.
 *
 * Covers resolveScope() in whitelist and blacklist modes, intersectPermissions(),
 * invertPermissions(), and createAllPermissions(). Exercised through their public
 * function signatures — no dependency on gate wiring.
 */

import {describe, it, expect} from 'vitest';
import {
	resolveScope,
	intersectPermissions,
	invertPermissions,
	createAllPermissions,
} from '../../../src/core/gates/scope-resolver';
import type {DataTypePermissions, PathPermission} from '../../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeAllFalsePermissions(): DataTypePermissions {
	return {
		note: {create: false, read: false, update: false, delete: false},
		frontmatter: {create: false, read: false, update: false, delete: false},
		file: {create: false, read: false, update: false, delete: false},
		dataviewInlineField: {create: false, read: false, update: false, delete: false},
	};
}

function makeReadOnlyPermissions(): DataTypePermissions {
	return {
		note: {create: false, read: true, update: false, delete: false},
		frontmatter: {create: false, read: true, update: false, delete: false},
		file: {create: false, read: true, update: false, delete: false},
		dataviewInlineField: {create: false, read: true, update: false, delete: false},
	};
}

function makePathPermission(path: string, permissions: DataTypePermissions): PathPermission {
	return {path, permissions};
}

// ---------------------------------------------------------------------------
// createAllPermissions()
// ---------------------------------------------------------------------------

describe('createAllPermissions()', () => {
	it('returns DataTypePermissions with all CRUD flags set to true', () => {
		const p = createAllPermissions();

		expect(p.note).toEqual({create: true, read: true, update: true, delete: true});
		expect(p.frontmatter).toEqual({create: true, read: true, update: true, delete: true});
		expect(p.file).toEqual({create: true, read: true, update: true, delete: true});
		expect(p.dataviewInlineField).toEqual({create: true, read: true, update: true, delete: true});
	});

	it('returns a new object on each call', () => {
		const a = createAllPermissions();
		const b = createAllPermissions();
		expect(a).not.toBe(b);
	});
});

// ---------------------------------------------------------------------------
// invertPermissions()
// ---------------------------------------------------------------------------

describe('invertPermissions()', () => {
	it('flips all flags from true to false', () => {
		const result = invertPermissions(createAllPermissions());

		expect(result.note).toEqual({create: false, read: false, update: false, delete: false});
		expect(result.frontmatter).toEqual({create: false, read: false, update: false, delete: false});
		expect(result.file).toEqual({create: false, read: false, update: false, delete: false});
		expect(result.dataviewInlineField).toEqual({create: false, read: false, update: false, delete: false});
	});

	it('flips all flags from false to true', () => {
		const result = invertPermissions(makeAllFalsePermissions());

		expect(result.note).toEqual({create: true, read: true, update: true, delete: true});
		expect(result.frontmatter).toEqual({create: true, read: true, update: true, delete: true});
		expect(result.file).toEqual({create: true, read: true, update: true, delete: true});
		expect(result.dataviewInlineField).toEqual({create: true, read: true, update: true, delete: true});
	});

	it('flips mixed flags independently per field', () => {
		const result = invertPermissions(makeReadOnlyPermissions());

		expect(result.note).toEqual({create: true, read: false, update: true, delete: true});
		expect(result.frontmatter).toEqual({create: true, read: false, update: true, delete: true});
		expect(result.file).toEqual({create: true, read: false, update: true, delete: true});
		expect(result.dataviewInlineField).toEqual({create: true, read: false, update: true, delete: true});
	});
});

// ---------------------------------------------------------------------------
// intersectPermissions()
// ---------------------------------------------------------------------------

describe('intersectPermissions()', () => {
	it('returns all-true when both inputs are all-true', () => {
		const result = intersectPermissions(createAllPermissions(), createAllPermissions());

		expect(result.note).toEqual({create: true, read: true, update: true, delete: true});
	});

	it('returns all-false when one input is all-false', () => {
		const result = intersectPermissions(createAllPermissions(), makeAllFalsePermissions());

		expect(result.note).toEqual({create: false, read: false, update: false, delete: false});
		expect(result.frontmatter).toEqual({create: false, read: false, update: false, delete: false});
		expect(result.file).toEqual({create: false, read: false, update: false, delete: false});
		expect(result.dataviewInlineField).toEqual({create: false, read: false, update: false, delete: false});
	});

	it('ANDs flags independently — true+false produces false', () => {
		const a: DataTypePermissions = {
			note: {create: true, read: true, update: false, delete: false},
			frontmatter: {create: true, read: true, update: false, delete: false},
			file: {create: true, read: true, update: false, delete: false},
			dataviewInlineField: {create: true, read: true, update: false, delete: false},
		};
		const b: DataTypePermissions = {
			note: {create: false, read: true, update: true, delete: false},
			frontmatter: {create: false, read: true, update: true, delete: false},
			file: {create: false, read: true, update: true, delete: false},
			dataviewInlineField: {create: false, read: true, update: true, delete: false},
		};

		const result = intersectPermissions(a, b);

		expect(result.note).toEqual({create: false, read: true, update: false, delete: false});
	});
});

// ---------------------------------------------------------------------------
// resolveScope() — whitelist mode
// ---------------------------------------------------------------------------

describe('resolveScope() — whitelist mode', () => {
	it('returns the matching path permissions when path is in the whitelist', () => {
		const permissions = makeReadOnlyPermissions();
		const scope = {
			listMode: 'whitelist' as const,
			paths: [makePathPermission('notes/**', permissions)],
		};

		const result = resolveScope(scope, 'notes/journal.md');

		expect(result).toEqual(permissions);
	});

	it('returns null when path does not match any whitelist entry', () => {
		const scope = {
			listMode: 'whitelist' as const,
			paths: [makePathPermission('notes/**', makeReadOnlyPermissions())],
		};

		const result = resolveScope(scope, 'private/secret.md');

		expect(result).toBeNull();
	});

	it('returns null when whitelist paths array is empty', () => {
		const scope = {
			listMode: 'whitelist' as const,
			paths: [],
		};

		const result = resolveScope(scope, 'notes/any.md');

		expect(result).toBeNull();
	});

	it('returns the first matching entry when multiple paths are listed', () => {
		const readPerms = makeReadOnlyPermissions();
		const allPerms = createAllPermissions();
		const scope = {
			listMode: 'whitelist' as const,
			paths: [
				makePathPermission('notes/**', readPerms),
				makePathPermission('notes/special.md', allPerms),
			],
		};

		// First match wins — the glob 'notes/**' matches before 'notes/special.md'
		const result = resolveScope(scope, 'notes/special.md');

		expect(result).toEqual(readPerms);
	});
});

// ---------------------------------------------------------------------------
// resolveScope() — whitelist mode — directory prefix matching
// ---------------------------------------------------------------------------

describe('resolveScope() — whitelist directory prefix matching', () => {
	it('matches directory path "allowed/" against pattern "allowed/**"', () => {
		const permissions = makeReadOnlyPermissions();
		const scope = {
			listMode: 'whitelist' as const,
			paths: [makePathPermission('allowed/**', permissions)],
		};

		const result = resolveScope(scope, 'allowed/');

		expect(result).toEqual(permissions);
	});

	it('does not match directory path without trailing slash against glob pattern', () => {
		const scope = {
			listMode: 'whitelist' as const,
			paths: [makePathPermission('allowed/**', makeReadOnlyPermissions())],
		};

		// "allowed" (no trailing slash) is treated as a file path, not a directory
		const result = resolveScope(scope, 'allowed');

		expect(result).toBeNull();
	});

	it('matches nested directory path against deep glob pattern', () => {
		const permissions = makeReadOnlyPermissions();
		const scope = {
			listMode: 'whitelist' as const,
			paths: [makePathPermission('projects/**/docs/**', permissions)],
		};

		const result = resolveScope(scope, 'projects/alpha/docs/');

		expect(result).toEqual(permissions);
	});

	it('rejects directory path that does not match any pattern', () => {
		const scope = {
			listMode: 'whitelist' as const,
			paths: [makePathPermission('allowed/**', makeReadOnlyPermissions())],
		};

		const result = resolveScope(scope, 'forbidden/');

		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// resolveScope() — blacklist mode
// ---------------------------------------------------------------------------

describe('resolveScope() — blacklist mode', () => {
	it('returns all-true permissions when path does not match any blacklist entry', () => {
		const scope = {
			listMode: 'blacklist' as const,
			paths: [makePathPermission('private/**', makeReadOnlyPermissions())],
		};

		const result = resolveScope(scope, 'notes/journal.md');

		expect(result).toEqual(createAllPermissions());
	});

	it('returns the entry permissions literally when path matches a blacklist entry', () => {
		// In blacklist mode a matched entry represents a narrower rule that
		// applies to this subtree. The per-CRUD flags keep their whitelist
		// meaning: true = allowed, false = blocked. The "blacklist" part is
		// only about the default for unlisted paths (allow everything).
		const perms = makeReadOnlyPermissions();
		const scope = {
			listMode: 'blacklist' as const,
			paths: [makePathPermission('private/**', perms)],
		};

		const result = resolveScope(scope, 'private/secret.md');

		expect(result).toEqual(perms);
	});

	it('mixed CRUD flags on a matched blacklist entry are honoured literally (T9.3 repro)', () => {
		const perms: DataTypePermissions = {
			note: {create: false, read: true, update: true, delete: true},
			frontmatter: {create: true, read: true, update: true, delete: true},
			file: {create: true, read: true, update: true, delete: true},
			dataviewInlineField: {create: true, read: true, update: true, delete: true},
		};
		const scope = {
			listMode: 'blacklist' as const,
			paths: [makePathPermission('maybe-allowed/**', perms)],
		};

		const result = resolveScope(scope, 'maybe-allowed/Budget 2026.md');

		expect(result?.note).toEqual({create: false, read: true, update: true, delete: true});
	});

	it('returns all-true when blacklist paths array is empty', () => {
		const scope = {
			listMode: 'blacklist' as const,
			paths: [],
		};

		const result = resolveScope(scope, 'notes/any.md');

		expect(result).toEqual(createAllPermissions());
	});
});
