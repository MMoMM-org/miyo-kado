/**
 * ConcurrencyGuard — validates timestamps before write operations.
 *
 * Read and search requests bypass the guard entirely. Write requests with
 * `expectedModified` are checked against the current mtime; a mismatch
 * produces a CONFLICT error. Writes without `expectedModified` are treated
 * as creates and always pass. See SDD ADR-8.
 *
 * CRITICAL: No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import {isCoreWriteRequest, isCoreDeleteRequest} from '../types/canonical';
import type {CoreRequest, GateResult} from '../types/canonical';

/**
 * Validates concurrency for the given request against the current file mtime.
 *
 * @param request - The incoming core request.
 * @param currentMtime - The current modification timestamp of the target file,
 *   or undefined when the file does not yet exist.
 * @returns GateResult — allowed or CONFLICT error.
 */
export function validateConcurrency(request: CoreRequest, currentMtime: number | undefined): GateResult {
	// Delete requests always require expectedModified + file must exist.
	if (isCoreDeleteRequest(request)) {
		if (currentMtime === undefined) {
			// File doesn't exist — the adapter will return NOT_FOUND; the guard stays silent here
			// so the caller's code path produces the canonical NOT_FOUND, not CONFLICT.
			return {allowed: true};
		}
		if (request.expectedModified === currentMtime) {
			return {allowed: true};
		}
		return {
			allowed: false,
			error: {
				code: 'CONFLICT',
				message: 'File was updated in the background. Re-read before deleting.',
			},
		};
	}

	if (!isCoreWriteRequest(request)) {
		return {allowed: true};
	}

	if (request.expectedModified === undefined) {
		// No expectedModified + file exists → update without concurrency check is unsafe
		if (currentMtime !== undefined) {
			return {
				allowed: false,
				error: {
					code: 'CONFLICT',
					message: 'expectedModified is required when updating an existing file. Read the file first to get the current modified timestamp.',
				},
			};
		}
		// No expectedModified + file doesn't exist → create
		return {allowed: true};
	}

	if (request.expectedModified === currentMtime) {
		return {allowed: true};
	}

	return {
		allowed: false,
		error: {
			code: 'CONFLICT',
			message: 'File was updated in the background. Re-read before retrying.',
		},
	};
}
