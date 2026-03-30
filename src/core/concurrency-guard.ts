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

import {isCoreWriteRequest} from '../types/canonical';
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
	if (!isCoreWriteRequest(request)) {
		return {allowed: true};
	}

	if (request.expectedModified === undefined) {
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
