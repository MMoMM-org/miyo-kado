/**
 * DataTypePermissionGate — Gate 3 in the Kado permission chain.
 *
 * Checks whether the API key has the required CRUD permission for the specific
 * data type. The CRUD action is inferred from the request type:
 *   - CoreReadRequest   → read
 *   - CoreWriteRequest (no expectedModified) → create
 *   - CoreWriteRequest (with expectedModified) → update
 *   - CoreSearchRequest → read (search requires note read access)
 *
 * Effective permissions are the intersection (AND) of the global security scope
 * and the key's own scope, each resolved with their respective listMode.
 *
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import {
	isCoreWriteRequest,
	isCoreSearchRequest,
	isCoreDeleteRequest,
} from '../../types/canonical';
import type {
	CoreRequest,
	CrudOperation,
	DataTypePermissions,
	GateResult,
	KadoConfig,
	PermissionGate,
	ReadDataType,
} from '../../types/canonical';
import {resolveScope, createAllPermissions, intersectPermissions} from './scope-resolver';

/** Returns a FORBIDDEN GateResult labelled with this gate. */
function forbidden(message: string): GateResult {
	return {
		allowed: false,
		error: {code: 'FORBIDDEN', message, gate: 'datatype-permission'},
	};
}

/** Infers the CRUD action from the request type. */
function inferCrudAction(request: CoreRequest): CrudOperation {
	if (isCoreDeleteRequest(request)) return 'delete';
	if (isCoreWriteRequest(request)) {
		return request.expectedModified !== undefined ? 'update' : 'create';
	}
	return 'read';
}

/**
 * Maps a DataType value to the corresponding key in DataTypePermissions.
 * The only non-trivial mapping is 'dataview-inline-field' → 'dataviewInlineField'.
 */
function dataTypeToPermissionsKey(dataType: ReadDataType): keyof DataTypePermissions {
	if (dataType === 'dataview-inline-field') {
		return 'dataviewInlineField';
	}
	// 'tags' is a read-only derivative of note body + frontmatter → gated by note permission.
	if (dataType === 'tags') {
		return 'note';
	}
	return dataType;
}

/**
 * Resolves the effective permissions for a path by intersecting the global
 * security scope and the key's own scope. Returns null if either scope
 * excludes the path entirely.
 */
function resolveEffectivePermissions(
	path: string,
	config: KadoConfig,
	keyId: string,
	resolvedKey?: KadoConfig['apiKeys'][number],
): DataTypePermissions | null {
	const key = resolvedKey ?? config.apiKeys.find((k) => k.id === keyId);
	if (!key) return null;

	const globalPerms = resolveScope(config.security, path);
	if (globalPerms === null) return null;

	const keyPerms = resolveScope({listMode: key.listMode, paths: key.paths}, path);
	if (keyPerms === null) return null;

	return intersectPermissions(globalPerms, keyPerms);
}

/** Gate 3: verifies the key has the required CRUD permission for the request's data type. */
export const dataTypePermissionGate: PermissionGate = {
	name: 'datatype-permission',

	evaluate(request: CoreRequest, config: KadoConfig): GateResult {
		// Prefer the resolved key attached by permission-chain entry (M6);
		// fall back to direct lookup for tests that call the gate directly.
		const key = request.resolvedKey ?? config.apiKeys.find((k) => k.id === request.apiKeyId);
		if (!key) {
			return forbidden('API key not found.');
		}

		const action = inferCrudAction(request);

		if (isCoreSearchRequest(request)) {
			return evaluateSearchPermission(request.apiKeyId, action, config, key);
		}

		const path = (request as {path: string}).path;
		const dataType = (request as {operation: ReadDataType}).operation;
		return evaluatePathPermission(path, dataType, action, request.apiKeyId, config, key);
	},
};

/** Evaluates read permission for search requests using note.read from the effective scope. */
function evaluateSearchPermission(
	keyId: string,
	action: CrudOperation,
	config: KadoConfig,
	resolvedKey?: KadoConfig['apiKeys'][number],
): GateResult {
	const key = resolvedKey ?? config.apiKeys.find((k) => k.id === keyId);
	if (!key) return forbidden('API key not found.');

	// For search (no specific path), check against any whitelisted path or
	// use full permissions for blacklist scopes with no paths listed.
	// Derive search-level note read permission by checking all path combinations.
	// A key with whitelist scope needs at least one path granting note.read.
	// A key with blacklist scope has note.read unless all paths block it.
	const globalPerms = resolveSearchNotePermissions(config.security);
	const keyPerms = resolveSearchNotePermissions({listMode: key.listMode, paths: key.paths});
	const effective = intersectPermissions(globalPerms, keyPerms);
	if (effective.note[action]) {
		return {allowed: true};
	}
	return forbidden('Search requires read access to notes.');
}

/**
 * Resolves effective permissions for search (no specific path).
 * Whitelist with paths: union of all path permissions (any path granting access is enough).
 * Whitelist with no paths: no access.
 * Blacklist: full access unless all paths block it (conservatively grants full access).
 */
/** Resolves note-level permissions for pathless search operations (union of all path entries). */
function resolveSearchNotePermissions(scope: {listMode: string; paths: {path: string; permissions: DataTypePermissions}[]}): DataTypePermissions {
	if (scope.listMode === 'blacklist') {
		return createAllPermissions();
	}
	// Whitelist: union across all path permissions
	const base: DataTypePermissions = {
		note: {create: false, read: false, update: false, delete: false},
		frontmatter: {create: false, read: false, update: false, delete: false},
		file: {create: false, read: false, update: false, delete: false},
		dataviewInlineField: {create: false, read: false, update: false, delete: false},
	};
	for (const entry of scope.paths) {
		const p = entry.permissions;
		base.note.read = base.note.read || p.note.read;
		base.note.create = base.note.create || p.note.create;
		base.note.update = base.note.update || p.note.update;
		base.note.delete = base.note.delete || p.note.delete;
	}
	return base;
}

/** Evaluates CRUD permission for path-based read/write requests. */
function evaluatePathPermission(
	path: string,
	dataType: ReadDataType,
	action: CrudOperation,
	keyId: string,
	config: KadoConfig,
	resolvedKey?: KadoConfig['apiKeys'][number],
): GateResult {
	const effective = resolveEffectivePermissions(path, config, keyId, resolvedKey);
	if (effective === null) {
		return forbidden('Request path is not within any permitted scope.');
	}

	const permKey = dataTypeToPermissionsKey(dataType);
	if (!effective[permKey][action]) {
		return forbidden(`Key does not have '${action}' permission for data type '${dataType}'.`);
	}

	return {allowed: true};
}
