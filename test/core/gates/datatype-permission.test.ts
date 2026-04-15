/**
 * Behavioral tests for DataTypePermissionGate.
 *
 * Gate 3 in the permission chain — checks if the API key has the required
 * CRUD permission for the specific data type by intersecting the global
 * security scope and the key's own scope (both with listMode awareness).
 *
 * All cases are exercised through the public `evaluate()` method.
 */

import {describe, it, expect} from 'vitest';
import {dataTypePermissionGate} from '../../../src/core/gates/datatype-permission';
import type {
	ApiKeyConfig,
	CoreDeleteRequest,
	CoreReadRequest,
	CoreSearchRequest,
	CoreWriteRequest,
	DataTypePermissions,
	DeleteDataType,
	KadoConfig,
	PathPermission,
	SecurityConfig,
} from '../../../src/types/canonical';

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

function makeAllTruePermissions(): DataTypePermissions {
	return {
		note: {create: true, read: true, update: true, delete: true},
		frontmatter: {create: true, read: true, update: true, delete: true},
		file: {create: true, read: true, update: true, delete: true},
		dataviewInlineField: {create: true, read: true, update: true, delete: true},
	};
}

function makePathPermission(path: string, permissions?: DataTypePermissions): PathPermission {
	return {path, permissions: permissions ?? makeAllTruePermissions()};
}

function makeSecurityConfig(overrides?: Partial<SecurityConfig>): SecurityConfig {
	return {
		listMode: 'whitelist',
		paths: [],
		tags: [],
		...overrides,
	};
}

function makeApiKey(id: string, overrides?: Partial<ApiKeyConfig>): ApiKeyConfig {
	return {
		id,
		label: 'Test Key',
		enabled: true,
		createdAt: 1700000000000,
		listMode: 'whitelist',
		paths: [],
		tags: [],
		...overrides,
	};
}

function makeConfig(security: SecurityConfig, apiKeys: ApiKeyConfig[]): KadoConfig {
	return {
		server: {enabled: false, host: '127.0.0.1', port: 23026, connectionType: 'local'},
		security,
		apiKeys,
		audit: {enabled: true, logDirectory: 'logs', logFileName: 'kado-audit.log', maxSizeBytes: 10485760, maxRetainedLogs: 3},
	};
}

function makeReadRequest(path: string, operation: CoreReadRequest['operation'] = 'note'): CoreReadRequest {
	return {apiKeyId: 'kado_test-key', operation, path};
}

function makeWriteRequest(
	path: string,
	operation: CoreWriteRequest['operation'] = 'note',
	expectedModified?: number,
): CoreWriteRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation,
		path,
		content: 'test content',
		...(expectedModified !== undefined ? {expectedModified} : {}),
	};
}

function makeSearchRequest(): CoreSearchRequest {
	return {apiKeyId: 'kado_test-key', operation: 'byTag'};
}

function makeDeleteRequest(
	path: string,
	operation: DeleteDataType = 'note',
	keys?: string[],
): CoreDeleteRequest {
	return {
		kind: 'delete',
		apiKeyId: 'kado_test-key',
		operation,
		path,
		expectedModified: 1700000000000,
		...(keys ? {keys} : {}),
	};
}

/** Returns a config where both global and key scope whitelist 'projects/**' with full permissions. */
function makeStandardWhitelistConfig(keyPermissions?: DataTypePermissions): KadoConfig {
	const security = makeSecurityConfig({
		paths: [makePathPermission('projects/**')],
	});
	const key = makeApiKey('kado_test-key', {
		paths: [makePathPermission('projects/**', keyPermissions)],
	});
	return makeConfig(security, [key]);
}

// ---------------------------------------------------------------------------
// Gate name
// ---------------------------------------------------------------------------

describe('dataTypePermissionGate', () => {
	it('has name "datatype-permission"', () => {
		expect(dataTypePermissionGate.name).toBe('datatype-permission');
	});
});

// ---------------------------------------------------------------------------
// Read requests — whitelist
// ---------------------------------------------------------------------------

describe('dataTypePermissionGate.evaluate() — read requests', () => {
	it('allows a read request for note when both scopes grant note.read', () => {
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/note.md', 'note'),
			makeStandardWhitelistConfig(),
		);
		expect(result.allowed).toBe(true);
	});

	it('denies a read request for note when key scope has note.read=false', () => {
		const keyPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
			note: {create: true, read: false, update: true, delete: false},
		};
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/note.md', 'note'),
			makeStandardWhitelistConfig(keyPerms),
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});

	it('denies when global scope has note.read=false regardless of key permissions', () => {
		const globalPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
			note: {create: true, read: false, update: true, delete: false},
		};
		const security = makeSecurityConfig({
			paths: [makePathPermission('projects/**', globalPerms)],
		});
		const key = makeApiKey('kado_test-key', {
			paths: [makePathPermission('projects/**')], // all true
		});
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/note.md', 'note'),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});

	it('allows a read request for dataview-inline-field when scope grants it', () => {
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/note.md', 'dataview-inline-field'),
			makeStandardWhitelistConfig(),
		);
		expect(result.allowed).toBe(true);
	});

	it('denies a read request for file when key scope has file.read=false', () => {
		const keyPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
			file: {create: true, read: false, update: true, delete: false},
		};
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/image.png', 'file'),
			makeStandardWhitelistConfig(keyPerms),
		);
		expect(result.allowed).toBe(false);
	});

	it('allows a tags read and sets scope="all" when note.read is granted', () => {
		const request = makeReadRequest('projects/note.md', 'tags');
		const result = dataTypePermissionGate.evaluate(request, makeStandardWhitelistConfig());
		expect(result.allowed).toBe(true);
		expect(request.tagsReturnScope).toBe('all');
	});

	it('allows a tags read and sets scope="frontmatter-only" when only frontmatter.read is granted', () => {
		const keyPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
			note: {create: true, read: false, update: true, delete: false},
		};
		const request = makeReadRequest('projects/note.md', 'tags');
		const result = dataTypePermissionGate.evaluate(request, makeStandardWhitelistConfig(keyPerms));
		expect(result.allowed).toBe(true);
		expect(request.tagsReturnScope).toBe('frontmatter-only');
	});

	it('denies a tags read when both note.read and frontmatter.read are false', () => {
		const keyPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
			note: {create: true, read: false, update: true, delete: false},
			frontmatter: {create: true, read: false, update: true, delete: false},
		};
		const request = makeReadRequest('projects/note.md', 'tags');
		const result = dataTypePermissionGate.evaluate(request, makeStandardWhitelistConfig(keyPerms));
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
			expect(result.error.message).toMatch(/note\.read.*frontmatter\.read|frontmatter\.read.*note\.read/);
		}
	});

	it('denies a tags read under blacklist mode when the matched entry blocks all CRUD', () => {
		const blocked = makeAllFalsePermissions();
		const security = makeSecurityConfig({
			listMode: 'blacklist',
			paths: [makePathPermission('secret/**', blocked)],
		});
		const key = makeApiKey('kado_test-key', {
			listMode: 'blacklist',
			paths: [makePathPermission('secret/**', blocked)],
		});
		const request = makeReadRequest('secret/vault.md', 'tags');
		const result = dataTypePermissionGate.evaluate(request, makeConfig(security, [key]));
		expect(result.allowed).toBe(false);
	});

	it('denies a tags read when global scope denies both note.read and frontmatter.read', () => {
		const globalPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
			note: {create: true, read: false, update: true, delete: false},
			frontmatter: {create: true, read: false, update: true, delete: false},
		};
		const security = makeSecurityConfig({
			paths: [makePathPermission('projects/**', globalPerms)],
		});
		const key = makeApiKey('kado_test-key', {
			paths: [makePathPermission('projects/**')],
		});
		const request = makeReadRequest('projects/note.md', 'tags');
		const result = dataTypePermissionGate.evaluate(request, makeConfig(security, [key]));
		expect(result.allowed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Write requests — create vs update
// ---------------------------------------------------------------------------

describe('dataTypePermissionGate.evaluate() — write requests', () => {
	it('allows a create request when both scopes grant frontmatter.create', () => {
		const result = dataTypePermissionGate.evaluate(
			makeWriteRequest('projects/note.md', 'frontmatter'),
			makeStandardWhitelistConfig(),
		);
		expect(result.allowed).toBe(true);
	});

	it('denies an update request when key scope has frontmatter.update=false', () => {
		const keyPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
			frontmatter: {create: true, read: true, update: false, delete: false},
		};
		const result = dataTypePermissionGate.evaluate(
			makeWriteRequest('projects/note.md', 'frontmatter', 1700000000000),
			makeStandardWhitelistConfig(keyPerms),
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});

	it('uses create action when expectedModified is absent', () => {
		const keyPerms: DataTypePermissions = {
			...makeAllFalsePermissions(),
			note: {create: true, read: false, update: false, delete: false},
		};
		const globalPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
		};
		const security = makeSecurityConfig({paths: [makePathPermission('projects/**', globalPerms)]});
		const key = makeApiKey('kado_test-key', {paths: [makePathPermission('projects/**', keyPerms)]});
		const result = dataTypePermissionGate.evaluate(
			makeWriteRequest('projects/note.md', 'note'),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(true);
	});

	it('uses update action when expectedModified is present', () => {
		const keyPerms: DataTypePermissions = {
			...makeAllFalsePermissions(),
			note: {create: true, read: false, update: false, delete: false},
		};
		const security = makeSecurityConfig({paths: [makePathPermission('projects/**')]});
		const key = makeApiKey('kado_test-key', {paths: [makePathPermission('projects/**', keyPerms)]});
		const result = dataTypePermissionGate.evaluate(
			makeWriteRequest('projects/note.md', 'note', 1700000000000),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});
});

// ---------------------------------------------------------------------------
// Search requests
// ---------------------------------------------------------------------------

describe('dataTypePermissionGate.evaluate() — search requests', () => {
	it('allows a search request when both scopes grant note.read (whitelist with paths)', () => {
		const result = dataTypePermissionGate.evaluate(
			makeSearchRequest(),
			makeStandardWhitelistConfig(),
		);
		expect(result.allowed).toBe(true);
	});

	it('denies a search request when key whitelist has no paths granting note.read', () => {
		const keyPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
			note: {create: true, read: false, update: true, delete: false},
		};
		const security = makeSecurityConfig({paths: [makePathPermission('projects/**')]});
		const key = makeApiKey('kado_test-key', {paths: [makePathPermission('projects/**', keyPerms)]});
		const result = dataTypePermissionGate.evaluate(
			makeSearchRequest(),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});

	it('allows a search request when both scopes are blacklists (full access)', () => {
		const security = makeSecurityConfig({listMode: 'blacklist', paths: []});
		const key = makeApiKey('kado_test-key', {listMode: 'blacklist', paths: []});
		const result = dataTypePermissionGate.evaluate(
			makeSearchRequest(),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(true);
	});

	it('denies a search request when global whitelist has no paths (empty whitelist = no access)', () => {
		const security = makeSecurityConfig({listMode: 'whitelist', paths: []});
		const key = makeApiKey('kado_test-key', {paths: [makePathPermission('projects/**')]});
		const result = dataTypePermissionGate.evaluate(
			makeSearchRequest(),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Scope exclusion edge cases
// ---------------------------------------------------------------------------

describe('dataTypePermissionGate.evaluate() — scope exclusion', () => {
	it('denies when whitelist key scope has no paths matching the request path', () => {
		const security = makeSecurityConfig({paths: [makePathPermission('projects/**')]});
		const key = makeApiKey('kado_test-key', {paths: [makePathPermission('archive/**')]});
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/note.md', 'note'),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});

	it('denies when global whitelist scope has no paths matching the request path', () => {
		const security = makeSecurityConfig({paths: [makePathPermission('archive/**')]});
		const key = makeApiKey('kado_test-key', {paths: [makePathPermission('projects/**')]});
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/note.md', 'note'),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});

	it('denies when api key is not found', () => {
		const security = makeSecurityConfig({paths: [makePathPermission('projects/**')]});
		const key = makeApiKey('kado_other-key', {paths: [makePathPermission('projects/**')]});
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/note.md', 'note'),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});
});

// ---------------------------------------------------------------------------
// Blacklist interaction with permissions
// ---------------------------------------------------------------------------

describe('dataTypePermissionGate.evaluate() — blacklist per-entry flags are literal', () => {
	it('blocks read on a matched blacklist entry that explicitly sets note.read=false', () => {
		const entryPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
			note: {create: true, read: false, update: true, delete: true},
		};
		const security = makeSecurityConfig({
			listMode: 'blacklist',
			paths: [makePathPermission('private/**', entryPerms)],
		});
		const key = makeApiKey('kado_test-key', {listMode: 'blacklist', paths: []});
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('private/note.md', 'note'),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(false);
	});

	it('allows read on a matched blacklist entry whose flags keep note.read=true (T9.3 repro)', () => {
		const entryPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
			note: {create: false, read: true, update: true, delete: true},
		};
		const security = makeSecurityConfig({listMode: 'whitelist', paths: [makePathPermission('maybe-allowed/**')]});
		const key = makeApiKey('kado_test-key', {
			listMode: 'blacklist',
			paths: [makePathPermission('maybe-allowed/**', entryPerms)],
		});
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('maybe-allowed/Budget 2026.md', 'note'),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(true);
	});

	it('denies create on the same T9.3 config because note.create=false is honoured literally', () => {
		const entryPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
			note: {create: false, read: true, update: true, delete: true},
		};
		const security = makeSecurityConfig({listMode: 'whitelist', paths: [makePathPermission('maybe-allowed/**')]});
		const key = makeApiKey('kado_test-key', {
			listMode: 'blacklist',
			paths: [makePathPermission('maybe-allowed/**', entryPerms)],
		});
		const result = dataTypePermissionGate.evaluate(
			makeWriteRequest('maybe-allowed/new.md', 'note'),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(false);
	});

	it('allows read on a non-blacklisted path (blacklist default is full access)', () => {
		const security = makeSecurityConfig({
			listMode: 'blacklist',
			paths: [makePathPermission('private/**', makeAllFalsePermissions())],
		});
		const key = makeApiKey('kado_test-key', {listMode: 'blacklist', paths: []});
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/note.md', 'note'),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Delete requests — action inference and permission check
// ---------------------------------------------------------------------------

describe('dataTypePermissionGate.evaluate() — delete requests', () => {
	it('allows delete when both scopes grant note.delete=true', () => {
		const result = dataTypePermissionGate.evaluate(
			makeDeleteRequest('projects/note.md', 'note'),
			makeStandardWhitelistConfig(),
		);
		expect(result.allowed).toBe(true);
	});

	it('denies delete when key scope has note.delete=false', () => {
		const keyPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
			note: {create: true, read: true, update: true, delete: false},
		};
		const result = dataTypePermissionGate.evaluate(
			makeDeleteRequest('projects/note.md', 'note'),
			makeStandardWhitelistConfig(keyPerms),
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
			expect(result.error.message).toContain('delete');
		}
	});

	it('denies delete when global scope has frontmatter.delete=false', () => {
		const globalPerms: DataTypePermissions = {
			...makeAllTruePermissions(),
			frontmatter: {create: true, read: true, update: true, delete: false},
		};
		const security = makeSecurityConfig({
			paths: [makePathPermission('projects/**', globalPerms)],
		});
		const key = makeApiKey('kado_test-key', {
			paths: [makePathPermission('projects/**')],
		});
		const result = dataTypePermissionGate.evaluate(
			makeDeleteRequest('projects/note.md', 'frontmatter', ['k1']),
			makeConfig(security, [key]),
		);
		expect(result.allowed).toBe(false);
	});

	it('allows file delete when both scopes grant file.delete=true', () => {
		const result = dataTypePermissionGate.evaluate(
			makeDeleteRequest('projects/image.png', 'file'),
			makeStandardWhitelistConfig(),
		);
		expect(result.allowed).toBe(true);
	});

	it('denies delete when path is outside all scopes', () => {
		const result = dataTypePermissionGate.evaluate(
			makeDeleteRequest('elsewhere/note.md', 'note'),
			makeStandardWhitelistConfig(),
		);
		expect(result.allowed).toBe(false);
	});
});
