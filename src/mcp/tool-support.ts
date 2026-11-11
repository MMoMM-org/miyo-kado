/**
 * Small helpers shared by the MCP tool handlers: key extraction, the auth
 * error, router-result narrowing and the rename timeout race. Split out of
 * tools.ts (#135).
 */

import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {CoreError} from '../types/canonical';
import type {RouteResult} from '../core/operation-router';
import {mapError} from './response-mapper';
import type {Extra} from './tool-deps';

export function isCoreError(value: RouteResult): value is CoreError {
	return 'code' in value && 'message' in value && !('content' in value) && !('items' in value);
}

/** Sentinel returned by raceWithTimeout when the work did not settle in time. */
export const TIMED_OUT = Symbol('timed-out');

/**
 * Races `work` against a timer. Resolves to the work's value, or `TIMED_OUT` if the
 * timer wins. A rejection from `work` propagates (so adapter errors still surface).
 * On timeout the caller must attach a no-op catch to `work` to avoid an unhandled
 * rejection if it settles later (e.g. after the user dismisses a blocking modal).
 */
export async function raceWithTimeout(work: Promise<RouteResult>, timeoutMs: number): Promise<RouteResult | typeof TIMED_OUT> {
	let timer: number | undefined;
	const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
		timer = window.setTimeout(() => resolve(TIMED_OUT), timeoutMs);
	});
	try {
		return await Promise.race([work, timeout]);
	} finally {
		if (timer !== undefined) window.clearTimeout(timer);
	}
}

export function extractKeyId(extra: Extra): string | undefined {
	return extra.authInfo?.token;
}

export function missingAuthError(): CallToolResult {
	return mapError({code: 'UNAUTHORIZED', message: 'Missing authentication token'});
}
