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
	// Length check first — integer comparison with no timing significance
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
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
