/**
 * OperationRouter — routes authorized CoreRequests to the correct adapter.
 *
 * Uses type guards to discriminate between read, write, and search requests,
 * then dispatches to the registered adapter for the given operation.
 *
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {
	CoreRequest,
	CoreReadRequest,
	CoreWriteRequest,
	CoreSearchRequest,
	CoreFileResult,
	CoreWriteResult,
	CoreSearchResult,
	CoreError,
	DataType,
} from '../types/canonical';
import {isCoreReadRequest, isCoreWriteRequest, isCoreSearchRequest} from '../types/canonical';

// ============================================================
// Adapter interfaces
// ============================================================

/** Adapter that handles read and write operations for a single data type. */
export interface ReadWriteAdapter {
	read(request: CoreReadRequest): Promise<CoreFileResult>;
	write(request: CoreWriteRequest): Promise<CoreWriteResult>;
}

/** Adapter that handles all search operations (byTag, byName, listDir, etc.). */
export interface SearchAdapter {
	search(request: CoreSearchRequest): Promise<CoreSearchResult | CoreError>;
}

/** Registry of all adapters keyed by data type, plus a search adapter. */
export interface AdapterRegistry {
	note: ReadWriteAdapter;
	frontmatter: ReadWriteAdapter;
	file: ReadWriteAdapter;
	'dataview-inline-field': ReadWriteAdapter;
	search: SearchAdapter;
}

// ============================================================
// Router
// ============================================================

type RouteResult = CoreFileResult | CoreWriteResult | CoreSearchResult | CoreError;

function validationError(message: string): CoreError {
	return {code: 'VALIDATION_ERROR', message};
}

function resolveReadWriteAdapter(
	operation: DataType,
	adapters: AdapterRegistry,
): ReadWriteAdapter | null {
	const map: Record<DataType, ReadWriteAdapter> = {
		note: adapters.note,
		frontmatter: adapters.frontmatter,
		file: adapters.file,
		'dataview-inline-field': adapters['dataview-inline-field'],
	};
	return map[operation] ?? null;
}

/**
 * Creates a routing function that dispatches CoreRequests to the correct adapter.
 * @param adapters - Registry of read/write and search adapters.
 * @returns An async function that routes a request and returns the adapter result.
 */
export function createOperationRouter(
	adapters: AdapterRegistry,
): (request: CoreRequest) => Promise<RouteResult> {
	return async function route(request: CoreRequest): Promise<RouteResult> {
		if (isCoreWriteRequest(request)) {
			const adapter = resolveReadWriteAdapter(request.operation, adapters);
			if (!adapter) {
				return validationError(`Unknown write operation: ${request.operation}`);
			}
			return adapter.write(request);
		}

		if (isCoreReadRequest(request)) {
			const adapter = resolveReadWriteAdapter(request.operation, adapters);
			if (!adapter) {
				return validationError(`Unknown read operation: ${request.operation}`);
			}
			return adapter.read(request);
		}

		if (isCoreSearchRequest(request)) {
			return adapters.search.search(request);
		}

		return validationError(`Unknown operation: ${String((request as CoreRequest & {operation: string}).operation)}`);
	};
}
