/**
 * Behavioral tests for the MCP auth middleware.
 *
 * Tests cover: valid Bearer token calls next() and sets req.auth,
 * missing Authorization header → 401, wrong scheme → 401,
 * unknown token → 401, disabled key → 401.
 */

import {describe, it, expect, vi} from 'vitest';
import type {Request, Response, NextFunction} from 'express';
import {createAuthMiddleware} from '../../src/mcp/auth';
import {ConfigManager} from '../../src/core/config-manager';
import type {KadoConfig} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeConfigManager(apiKeys: KadoConfig['apiKeys'] = []): ConfigManager {
	const manager = new ConfigManager(async () => null, async () => {});
	for (const key of apiKeys) {
		manager.getConfig().apiKeys.push(key);
	}
	return manager;
}

function makeReq(authHeader?: string): Partial<Request> {
	return {
		headers: authHeader ? {authorization: authHeader} : {},
		get(name: string) {
			return this.headers?.[name.toLowerCase()] as string | undefined;
		},
	} as Partial<Request>;
}

function makeRes(): {
	res: Partial<Response>;
	statusSpy: ReturnType<typeof vi.fn>;
	jsonSpy: ReturnType<typeof vi.fn>;
} {
	const jsonSpy = vi.fn();
	const statusSpy = vi.fn().mockReturnValue({json: jsonSpy});
	return {
		res: {status: statusSpy} as unknown as Partial<Response>,
		statusSpy,
		jsonSpy,
	};
}

function makeNext(): NextFunction {
	return vi.fn() as unknown as NextFunction;
}

const ENABLED_KEY = {
	id: 'kado_valid-key-123',
	label: 'Test Key',
	enabled: true,
	createdAt: 1700000000000,
	listMode: 'whitelist' as const,
	paths: [],
	tags: [],
	allowActiveNote: false,
	allowOtherNotes: false,
};

const DISABLED_KEY = {
	id: 'kado_disabled-key-456',
	label: 'Disabled Key',
	enabled: false,
	createdAt: 1700000000000,
	listMode: 'whitelist' as const,
	paths: [],
	tags: [],
	allowActiveNote: false,
	allowOtherNotes: false,
};

// ---------------------------------------------------------------------------
// Valid token
// ---------------------------------------------------------------------------

describe('createAuthMiddleware — valid Bearer token', () => {
	it('calls next() when the key exists and is enabled', () => {
		const manager = makeConfigManager([ENABLED_KEY]);
		const middleware = createAuthMiddleware(manager);
		const req = makeReq(`Bearer ${ENABLED_KEY.id}`);
		const {res} = makeRes();
		const next = makeNext();

		middleware(req as Request, res as Response, next);

		expect(next).toHaveBeenCalledOnce();
	});

	it('sets req.auth with the keyId when the key is valid', () => {
		const manager = makeConfigManager([ENABLED_KEY]);
		const middleware = createAuthMiddleware(manager);
		const req = makeReq(`Bearer ${ENABLED_KEY.id}`);
		const {res} = makeRes();
		const next = makeNext();

		middleware(req as Request, res as Response, next);

		expect((req as Request & {auth?: unknown}).auth).toEqual({token: ENABLED_KEY.id, clientId: ENABLED_KEY.id, scopes: []});
	});

	it('does not respond with 401 when the key is valid', () => {
		const manager = makeConfigManager([ENABLED_KEY]);
		const middleware = createAuthMiddleware(manager);
		const req = makeReq(`Bearer ${ENABLED_KEY.id}`);
		const {res, statusSpy} = makeRes();
		const next = makeNext();

		middleware(req as Request, res as Response, next);

		expect(statusSpy).not.toHaveBeenCalled();
	});


	it('sets req.auth.token so MCP transport can forward it as authInfo.token', () => {
		const manager = makeConfigManager([ENABLED_KEY]);
		const middleware = createAuthMiddleware(manager);
		const req = makeReq(`Bearer ${ENABLED_KEY.id}`);
		const {res} = makeRes();
		const next = makeNext();

		middleware(req as Request, res as Response, next);

		const auth = (req as Request & {auth?: {token: string; clientId: string}}).auth;
		expect(auth?.token).toBe(ENABLED_KEY.id);
		expect(auth?.clientId).toBe(ENABLED_KEY.id);
	});
});

// ---------------------------------------------------------------------------
// Missing Authorization header
// ---------------------------------------------------------------------------

describe('createAuthMiddleware — missing Authorization header', () => {
	it('responds 401 when no Authorization header is present', () => {
		const manager = makeConfigManager([ENABLED_KEY]);
		const middleware = createAuthMiddleware(manager);
		const req = makeReq();
		const {res, statusSpy, jsonSpy} = makeRes();
		const next = makeNext();

		middleware(req as Request, res as Response, next);

		expect(statusSpy).toHaveBeenCalledWith(401);
		expect(jsonSpy).toHaveBeenCalledWith({error: 'Missing or invalid authorization'});
	});

	it('does not call next() when Authorization header is missing', () => {
		const manager = makeConfigManager([ENABLED_KEY]);
		const middleware = createAuthMiddleware(manager);
		const req = makeReq();
		const {res} = makeRes();
		const next = makeNext();

		middleware(req as Request, res as Response, next);

		expect(next).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Wrong scheme
// ---------------------------------------------------------------------------

describe('createAuthMiddleware — wrong Authorization scheme', () => {
	it('responds 401 for Basic scheme', () => {
		const manager = makeConfigManager([ENABLED_KEY]);
		const middleware = createAuthMiddleware(manager);
		const req = makeReq('Basic dXNlcjpwYXNz');
		const {res, statusSpy, jsonSpy} = makeRes();
		const next = makeNext();

		middleware(req as Request, res as Response, next);

		expect(statusSpy).toHaveBeenCalledWith(401);
		expect(jsonSpy).toHaveBeenCalledWith({error: 'Missing or invalid authorization'});
	});

	it('does not call next() for wrong scheme', () => {
		const manager = makeConfigManager([ENABLED_KEY]);
		const middleware = createAuthMiddleware(manager);
		const req = makeReq('Basic dXNlcjpwYXNz');
		const {res} = makeRes();
		const next = makeNext();

		middleware(req as Request, res as Response, next);

		expect(next).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Unknown token
// ---------------------------------------------------------------------------

describe('createAuthMiddleware — unknown token', () => {
	it('responds 401 when the Bearer token is not found in config', () => {
		const manager = makeConfigManager([ENABLED_KEY]);
		const middleware = createAuthMiddleware(manager);
		const req = makeReq('Bearer kado_unknown-key-xyz');
		const {res, statusSpy, jsonSpy} = makeRes();
		const next = makeNext();

		middleware(req as Request, res as Response, next);

		expect(statusSpy).toHaveBeenCalledWith(401);
		expect(jsonSpy).toHaveBeenCalledWith({error: 'Missing or invalid authorization'});
	});

	it('does not call next() for an unknown token', () => {
		const manager = makeConfigManager([ENABLED_KEY]);
		const middleware = createAuthMiddleware(manager);
		const req = makeReq('Bearer kado_unknown-key-xyz');
		const {res} = makeRes();
		const next = makeNext();

		middleware(req as Request, res as Response, next);

		expect(next).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Disabled key
// ---------------------------------------------------------------------------

describe('createAuthMiddleware — disabled key', () => {
	it('responds 401 when the key exists but is disabled', () => {
		const manager = makeConfigManager([DISABLED_KEY]);
		const middleware = createAuthMiddleware(manager);
		const req = makeReq(`Bearer ${DISABLED_KEY.id}`);
		const {res, statusSpy, jsonSpy} = makeRes();
		const next = makeNext();

		middleware(req as Request, res as Response, next);

		expect(statusSpy).toHaveBeenCalledWith(401);
		expect(jsonSpy).toHaveBeenCalledWith({error: 'Missing or invalid authorization'});
	});

	it('does not call next() when the key is disabled', () => {
		const manager = makeConfigManager([DISABLED_KEY]);
		const middleware = createAuthMiddleware(manager);
		const req = makeReq(`Bearer ${DISABLED_KEY.id}`);
		const {res} = makeRes();
		const next = makeNext();

		middleware(req as Request, res as Response, next);

		expect(next).not.toHaveBeenCalled();
	});
});
