/**
 * Behavioral tests for DataTypePermissionGate.
 *
 * Gate 3 in the permission chain — checks if the API key has the required
 * CRUD permission for the specific data type, inferred from the request type.
 * Area matching uses glob patterns from the key's area config.
 *
 * All cases are exercised through the public `evaluate()` method.
 */

import {describe, it, expect} from 'vitest';
import {dataTypePermissionGate} from '../../../src/core/gates/datatype-permission';
import type {
	ApiKeyConfig,
	CoreReadRequest,
	CoreSearchRequest,
	CoreWriteRequest,
	DataTypePermissions,
	GlobalArea,
	KadoConfig,
	KeyAreaConfig,
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

function makeGlobalArea(
	id: string,
	pathPatterns: string[],
	permissions?: DataTypePermissions,
): GlobalArea {
	return {
		id,
		label: `Area ${id}`,
		pathPatterns,
		permissions: permissions ?? makeAllTruePermissions(),
	};
}

function makeKeyAreaConfig(areaId: string, permissions?: DataTypePermissions): KeyAreaConfig {
	return {
		areaId,
		permissions: permissions ?? makeAllTruePermissions(),
	};
}

function makeApiKey(
	id: string,
	areas: KeyAreaConfig[],
	overrides?: Partial<ApiKeyConfig>,
): ApiKeyConfig {
	return {
		id,
		label: 'Test Key',
		enabled: true,
		createdAt: 1700000000000,
		areas,
		...overrides,
	};
}

function makeConfig(globalAreas: GlobalArea[], apiKeys: ApiKeyConfig[]): KadoConfig {
	return {
		server: {enabled: false, host: '127.0.0.1', port: 23026},
		globalAreas,
		apiKeys,
		audit: {enabled: true, logFilePath: 'plugins/kado/audit.log', maxSizeBytes: 10485760},
	};
}

function makeReadRequest(path: string, operation: CoreReadRequest['operation']): CoreReadRequest {
	return {apiKeyId: 'kado_test-key', operation, path};
}

function makeWriteRequest(
	path: string,
	operation: CoreWriteRequest['operation'],
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

function makeSearchRequest(path?: string): CoreSearchRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'byTag',
		...(path !== undefined ? {path} : {}),
	};
}

// ---------------------------------------------------------------------------
// Shared test config helpers
// ---------------------------------------------------------------------------

/** Returns a config with one area covering 'projects/**', key has full permissions. */
function makeStandardConfig(keyPermissions?: DataTypePermissions): KadoConfig {
	const globalArea = makeGlobalArea('area-1', ['projects/**']);
	const keyArea = makeKeyAreaConfig('area-1', keyPermissions);
	const apiKey = makeApiKey('kado_test-key', [keyArea]);
	return makeConfig([globalArea], [apiKey]);
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
// Read requests
// ---------------------------------------------------------------------------

describe('dataTypePermissionGate.evaluate() — read requests', () => {
	it('allows a read request for note when key has note.read=true', () => {
		const config = makeStandardConfig();
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/note.md', 'note'),
			config,
		);
		expect(result.allowed).toBe(true);
	});

	it('denies a read request for note when key has note.read=false', () => {
		const permissions: DataTypePermissions = {
			...makeAllTruePermissions(),
			note: {create: true, read: false, update: true, delete: false},
		};
		const config = makeStandardConfig(permissions);
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/note.md', 'note'),
			config,
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});

	it('denies a read request for file when key has file.read=false', () => {
		const permissions: DataTypePermissions = {
			...makeAllTruePermissions(),
			file: {create: true, read: false, update: true, delete: false},
		};
		const config = makeStandardConfig(permissions);
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/image.png', 'file'),
			config,
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});

	it('allows a read request for dataview-inline-field when key has dataviewInlineField.read=true', () => {
		const config = makeStandardConfig();
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/note.md', 'dataview-inline-field'),
			config,
		);
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Write requests (create vs update)
// ---------------------------------------------------------------------------

describe('dataTypePermissionGate.evaluate() — write requests', () => {
	it('allows a create request for frontmatter when key has frontmatter.create=true', () => {
		const config = makeStandardConfig();
		const result = dataTypePermissionGate.evaluate(
			makeWriteRequest('projects/note.md', 'frontmatter'),
			config,
		);
		expect(result.allowed).toBe(true);
	});

	it('denies an update request for frontmatter when key has frontmatter.update=false', () => {
		const permissions: DataTypePermissions = {
			...makeAllTruePermissions(),
			frontmatter: {create: true, read: true, update: false, delete: false},
		};
		const config = makeStandardConfig(permissions);
		const result = dataTypePermissionGate.evaluate(
			makeWriteRequest('projects/note.md', 'frontmatter', 1700000000000),
			config,
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});

	it('uses create action when expectedModified is absent', () => {
		const permissions: DataTypePermissions = {
			...makeAllFalsePermissions(),
			note: {create: true, read: false, update: false, delete: false},
		};
		const config = makeStandardConfig(permissions);
		const result = dataTypePermissionGate.evaluate(
			makeWriteRequest('projects/note.md', 'note'),
			config,
		);
		expect(result.allowed).toBe(true);
	});

	it('uses update action when expectedModified is present', () => {
		const permissions: DataTypePermissions = {
			...makeAllFalsePermissions(),
			note: {create: true, read: false, update: false, delete: false},
		};
		const config = makeStandardConfig(permissions);
		const result = dataTypePermissionGate.evaluate(
			makeWriteRequest('projects/note.md', 'note', 1700000000000),
			config,
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
	it('allows a search request when key has note.read=true', () => {
		const config = makeStandardConfig();
		const result = dataTypePermissionGate.evaluate(makeSearchRequest(), config);
		expect(result.allowed).toBe(true);
	});

	it('denies a search request when key has note.read=false', () => {
		const permissions: DataTypePermissions = {
			...makeAllTruePermissions(),
			note: {create: true, read: false, update: true, delete: false},
		};
		// Search uses first matching key area; use a config with all areas matching
		const globalArea = makeGlobalArea('area-1', ['projects/**']);
		const keyArea = makeKeyAreaConfig('area-1', permissions);
		const apiKey = makeApiKey('kado_test-key', [keyArea]);
		const config = makeConfig([globalArea], [apiKey]);

		const result = dataTypePermissionGate.evaluate(makeSearchRequest(), config);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});
});

// ---------------------------------------------------------------------------
// Area permission edge cases
// ---------------------------------------------------------------------------

describe('dataTypePermissionGate.evaluate() — area permission edge cases', () => {
	it('denies when key has area but all permissions are false', () => {
		const config = makeStandardConfig(makeAllFalsePermissions());
		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/note.md', 'note'),
			config,
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});

	it('denies when no global area matches the request path', () => {
		const globalArea = makeGlobalArea('area-1', ['archive/**']);
		const keyArea = makeKeyAreaConfig('area-1');
		const apiKey = makeApiKey('kado_test-key', [keyArea]);
		const config = makeConfig([globalArea], [apiKey]);

		const result = dataTypePermissionGate.evaluate(
			makeReadRequest('projects/note.md', 'note'),
			config,
		);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('datatype-permission');
		}
	});
});
