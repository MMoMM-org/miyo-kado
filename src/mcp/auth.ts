/**
 * MCP auth middleware — validates Bearer tokens against ConfigManager.
 *
 * Tokens must match a known, enabled ApiKeyConfig. Requests that fail
 * validation receive a 401 JSON response and do not reach MCP handlers.
 */

import {timingSafeEqual} from 'node:crypto';
import type {RequestHandler} from 'express';
import type {ConfigManager} from '../core/config-manager';

declare module 'express-serve-static-core' {
	interface Request {
		auth?: {token: string; clientId: string; scopes: string[]};
	}
}

const UNAUTHORIZED = {error: 'Missing or invalid authorization'};

function extractBearer(header: string | undefined): string | undefined {
	if (!header?.startsWith('Bearer ')) return undefined;
	return header.slice('Bearer '.length);
}

function safeEquals(a: string, b: string): boolean {
	const enc = new TextEncoder();
	const bufA = enc.encode(a);
	const bufB = enc.encode(b);
	// Pad both buffers to the same length so timingSafeEqual never throws and
	// comparison time does not leak the length of either string.
	const maxLen = Math.max(bufA.length, bufB.length);
	const padded = (buf: Uint8Array): Uint8Array => {
		if (buf.length === maxLen) return buf;
		const out = new Uint8Array(maxLen);
		out.set(buf);
		return out;
	};
	const equal = timingSafeEqual(padded(bufA), padded(bufB));
	// Length mismatch always means not equal; checked after constant-time comparison
	// so the timing of the length check cannot be observed by attackers.
	return equal && bufA.length === bufB.length;
}

/**
 * Returns an Express RequestHandler that gates requests on a valid,
 * enabled Bearer token. On success sets `(req as any).auth = { keyId }`.
 */
export function createAuthMiddleware(configManager: ConfigManager): RequestHandler {
	return (req, res, next): void => {
		const token = extractBearer(req.get('authorization'));
		if (token === undefined) {
			res.status(401).json(UNAUTHORIZED);
			return;
		}

		const key = configManager.getConfig().apiKeys.find((k) => safeEquals(k.id, token));
		if (key === undefined || !key.enabled) {
			res.status(401).json(UNAUTHORIZED);
			return;
		}

		req.auth = {token, clientId: token, scopes: []};
		next();
	};
}
