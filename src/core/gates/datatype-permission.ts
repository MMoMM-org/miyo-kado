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
 * The matching area is resolved by finding the key's KeyAreaConfig whose
 * referenced global area covers the request path via glob patterns.
 *
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import {
	isCoreWriteRequest,
	isCoreSearchRequest,
} from '../../types/canonical';
import type {
	CoreRequest,
	CrudOperation,
	DataType,
	DataTypePermissions,
	GateResult,
	KadoConfig,
	KeyAreaConfig,
	PermissionGate,
} from '../../types/canonical';
import {matchGlob} from '../glob-match';

/** Returns a FORBIDDEN GateResult labelled with this gate. */
function forbidden(message: string): GateResult {
	return {
		allowed: false,
		error: {code: 'FORBIDDEN', message, gate: 'datatype-permission'},
	};
}

/** Infers the CRUD action from the request type. */
function inferCrudAction(request: CoreRequest): CrudOperation {
	if (isCoreWriteRequest(request)) {
		return request.expectedModified !== undefined ? 'update' : 'create';
	}
	return 'read';
}

/**
 * Maps a DataType value to the corresponding key in DataTypePermissions.
 * The only non-trivial mapping is 'dataview-inline-field' → 'dataviewInlineField'.
 */
function dataTypeToPermissionsKey(
	dataType: DataType,
): keyof DataTypePermissions {
	if (dataType === 'dataview-inline-field') {
		return 'dataviewInlineField';
	}
	return dataType;
}

/** Returns true when the request path matches any of the given glob patterns. */
function pathMatchesArea(path: string, patterns: string[]): boolean {
	return patterns.some((pattern) => matchGlob(pattern, path));
}

/**
 * Finds the first KeyAreaConfig whose referenced global area covers the path.
 * Returns undefined if no area matches.
 */
function findMatchingKeyArea(
	path: string,
	keyAreas: KeyAreaConfig[],
	config: KadoConfig,
): KeyAreaConfig | undefined {
	for (const keyArea of keyAreas) {
		const globalArea = config.globalAreas.find((a) => a.id === keyArea.areaId);
		if (globalArea && pathMatchesArea(path, globalArea.pathPatterns)) {
			return keyArea;
		}
	}
	return undefined;
}

export const dataTypePermissionGate: PermissionGate = {
	name: 'datatype-permission',

	evaluate(request: CoreRequest, config: KadoConfig): GateResult {
		const key = config.apiKeys.find((k) => k.id === request.apiKeyId);
		if (!key) {
			return forbidden('API key not found.');
		}

		const action = inferCrudAction(request);

		if (isCoreSearchRequest(request)) {
			return evaluateSearchPermission(key.areas, action, config);
		}

		const path = (request as {path: string}).path;
		const dataType = (request as {operation: DataType}).operation;
		return evaluatePathPermission(path, dataType, action, key.areas, config);
	},
};

/** Evaluates read permission for search requests using note.read from any key area. */
function evaluateSearchPermission(
	keyAreas: KeyAreaConfig[],
	action: CrudOperation,
	_config: KadoConfig,
): GateResult {
	for (const keyArea of keyAreas) {
		if (keyArea.permissions.note[action]) {
			return {allowed: true};
		}
	}
	return forbidden('Search requires read access to notes.');
}

/** Evaluates CRUD permission for path-based read/write requests. */
function evaluatePathPermission(
	path: string,
	dataType: DataType,
	action: CrudOperation,
	keyAreas: KeyAreaConfig[],
	config: KadoConfig,
): GateResult {
	const matchedArea = findMatchingKeyArea(path, keyAreas, config);
	if (!matchedArea) {
		return forbidden(`Request path is not within any permitted area for this key.`);
	}

	const permKey = dataTypeToPermissionsKey(dataType);
	const allowed = matchedArea.permissions[permKey][action];

	if (!allowed) {
		return forbidden(
			`Key does not have '${action}' permission for data type '${dataType}'.`,
		);
	}

	return {allowed: true};
}
