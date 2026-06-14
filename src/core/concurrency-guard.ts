/**
 * ConcurrencyGuard — validates timestamps before write operations.
 *
 * Read and search requests bypass the guard entirely. Write requests with
 * `expectedModified` are checked against the current mtime; a mismatch
 * produces a CONFLICT error. Writes without `expectedModified` are treated
 * as creates and always pass — except for partial writes: additive modes
 * (append/prepend) are lock-free and skip the optimistic check when
 * `expectedModified` is absent; destructive modes (replaceSection,
 * replaceRange, insertUnderHeading) require `expectedModified` and return
 * VALIDATION_ERROR when it is missing. See SDD ADR-5, ADR-8.
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
 * @returns GateResult — allowed, CONFLICT error, or VALIDATION_ERROR (partial destructive write missing expectedModified).
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

	// Partial-write branch (ADR-5). Must sit before the generic write logic so
	// additive modes never reach the "no expectedModified + file exists → CONFLICT"
	// path. When expectedModified IS present, execution falls through to the
	// standard mtime compare below.
	//
	// The request-mapper is the PRIMARY enforcer of "destructive modes require
	// expectedModified" (it fails fast at the MCP boundary with a clear message).
	// This branch is the defense-in-depth backstop for any non-MCP caller that
	// builds a CoreWriteRequest directly, bypassing the mapper.
	if (request.notePartial !== undefined) {
		const additive = request.notePartial.mode === 'append' || request.notePartial.mode === 'prepend';
		if (request.expectedModified === undefined) {
			if (additive) {
				return {allowed: true};
			}
			return {
				allowed: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: 'replace/insert modes require expectedModified. Read the file first to get the current modified timestamp.',
				},
			};
		}
		// expectedModified present → fall through to standard mtime compare
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
