/**
 * Behavioral tests for registerTools — the MCP tool registration layer.
 *
 * Tests cover: 3 tools registered, each handler orchestrates the correct
 * pipeline (map request → permission check → concurrency guard for writes
 * → route → map response), and error paths return isError:true results.
 */

import {describe, it, expect, vi} from 'vitest';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {registerTools} from '../../src/mcp/tools';
import type {ToolDependencies} from '../../src/mcp/tools';
import type {
	CoreRequest,
	CoreFileResult,
	CoreWriteResult,
	CoreSearchResult,
	CoreError,
	PermissionGate,
	KadoConfig,
} from '../../src/types/canonical';
import {createDefaultConfig} from '../../src/types/canonical';
import type {ConfigManager} from '../../src/core/config-manager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolRegistration = {
	name: string;
	config: unknown;
	handler: (args: Record<string, unknown>, extra: MockExtra) => Promise<CallToolResult>;
};

type MockExtra = {
	authInfo?: {token: string; clientId: string; scopes: string[]};
	signal: AbortSignal;
	requestId: string;
	sendNotification: ReturnType<typeof vi.fn>;
	sendRequest: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeMockServer(): {
	tools: ToolRegistration[];
	registerTool: ReturnType<typeof vi.fn>;
} {
	const tools: ToolRegistration[] = [];
	const registerTool = vi.fn(
		(name: string, config: unknown, handler: ToolRegistration['handler']) => {
			tools.push({name, config, handler});
		},
	);
	return {tools, registerTool};
}

function makeExtra(keyId = 'kado_test-key'): MockExtra {
	return {
		authInfo: {token: keyId, clientId: 'client', scopes: []},
		signal: new AbortController().signal,
		requestId: 'req-1',
		sendNotification: vi.fn(),
		sendRequest: vi.fn(),
	};
}

function makeFileResult(overrides?: Partial<CoreFileResult>): CoreFileResult {
	return {
		path: 'notes/a.md',
		content: 'Hello world',
		created: 1000,
		modified: 2000,
		size: 11,
		...overrides,
	};
}

function makeWriteResult(overrides?: Partial<CoreWriteResult>): CoreWriteResult {
	return {
		path: 'notes/a.md',
		created: 1000,
		modified: 2000,
		...overrides,
	};
}

function makeSearchResult(overrides?: Partial<CoreSearchResult>): CoreSearchResult {
	return {
		items: [{path: 'notes/a.md', name: 'a.md', created: 1000, modified: 2000, size: 11}],
		...overrides,
	};
}

function makeCoreError(overrides?: Partial<CoreError>): CoreError {
	return {
		code: 'FORBIDDEN',
		message: 'Access denied',
		...overrides,
	};
}

function makeConfigManager(config?: Partial<KadoConfig>): ConfigManager {
	const merged = {...createDefaultConfig(), ...config};
	return {getConfig: () => merged} as unknown as ConfigManager;
}

function makeAllowGate(): PermissionGate {
	return {
		name: 'allow-all',
		evaluate: () => ({allowed: true}),
	};
}

function makeDenyGate(error: CoreError): PermissionGate {
	return {
		name: 'deny-all',
		evaluate: () => ({allowed: false, error}),
	};
}

function makeDeps(overrides?: Partial<ToolDependencies>): ToolDependencies {
	return {
		configManager: makeConfigManager(),
		gates: [makeAllowGate()],
		router: vi.fn(async () => makeFileResult()),
		getFileMtime: vi.fn(() => undefined),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('registerTools()', () => {
	it('registers exactly 3 tools on the server', () => {
		const server = makeMockServer();
		registerTools(server as unknown as Parameters<typeof registerTools>[0], makeDeps());
		expect(server.tools).toHaveLength(3);
	});

	it('registers a tool named kado-read', () => {
		const server = makeMockServer();
		registerTools(server as unknown as Parameters<typeof registerTools>[0], makeDeps());
		expect(server.tools.map((t) => t.name)).toContain('kado-read');
	});

	it('registers a tool named kado-write', () => {
		const server = makeMockServer();
		registerTools(server as unknown as Parameters<typeof registerTools>[0], makeDeps());
		expect(server.tools.map((t) => t.name)).toContain('kado-write');
	});

	it('registers a tool named kado-search', () => {
		const server = makeMockServer();
		registerTools(server as unknown as Parameters<typeof registerTools>[0], makeDeps());
		expect(server.tools.map((t) => t.name)).toContain('kado-search');
	});
});

// ---------------------------------------------------------------------------
// kado-read handler
// ---------------------------------------------------------------------------

describe('kado-read handler', () => {
	function getReadHandler(deps: ToolDependencies) {
		const server = makeMockServer();
		registerTools(server as unknown as Parameters<typeof registerTools>[0], deps);
		const reg = server.tools.find((t) => t.name === 'kado-read')!;
		return reg.handler;
	}

	it('routes the request to the adapter and returns mapped file result', async () => {
		const fileResult = makeFileResult({path: 'notes/test.md', content: 'body'});
		const router = vi.fn(async () => fileResult);
		const handler = getReadHandler(makeDeps({router}));
		const extra = makeExtra();

		const result = await handler(
			{operation: 'note', path: 'notes/test.md'},
			extra,
		);

		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain('notes/test.md');
	});

	it('passes the keyId from extra.authInfo.token to the request mapper', async () => {
		const router = vi.fn(async (req: CoreRequest) => {
			expect(req.apiKeyId).toBe('kado_my-key');
			return makeFileResult();
		});
		const handler = getReadHandler(makeDeps({router}));

		await handler({operation: 'note', path: 'notes/a.md'}, makeExtra('kado_my-key'));
		expect(router).toHaveBeenCalledOnce();
	});

	it('returns isError:true when permission is denied', async () => {
		const denyError = makeCoreError({code: 'FORBIDDEN', gate: 'deny-all'});
		const deps = makeDeps({gates: [makeDenyGate(denyError)]});
		const handler = getReadHandler(deps);

		const result = await handler({operation: 'note', path: 'notes/a.md'}, makeExtra());

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('FORBIDDEN');
	});

	it('returns isError:true when the router returns a CoreError', async () => {
		const coreError: CoreError = {code: 'NOT_FOUND', message: 'File missing'};
		const router = vi.fn(async () => coreError);
		const handler = getReadHandler(makeDeps({router}));

		const result = await handler({operation: 'note', path: 'notes/missing.md'}, makeExtra());

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('NOT_FOUND');
	});

	it('returns isError:true when extra.authInfo is absent', async () => {
		const handler = getReadHandler(makeDeps());
		const extraWithoutAuth = {...makeExtra(), authInfo: undefined};

		const result = await handler(
			{operation: 'note', path: 'notes/a.md'},
			extraWithoutAuth,
		);

		expect(result.isError).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// kado-write handler
// ---------------------------------------------------------------------------

describe('kado-write handler', () => {
	function getWriteHandler(deps: ToolDependencies) {
		const server = makeMockServer();
		registerTools(server as unknown as Parameters<typeof registerTools>[0], deps);
		const reg = server.tools.find((t) => t.name === 'kado-write')!;
		return reg.handler;
	}

	it('routes the write request and returns mapped write result', async () => {
		const writeResult = makeWriteResult({path: 'notes/w.md'});
		const router = vi.fn(async () => writeResult);
		const handler = getWriteHandler(makeDeps({router}));

		const result = await handler(
			{operation: 'note', path: 'notes/w.md', content: 'text'},
			makeExtra(),
		);

		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain('notes/w.md');
	});

	it('passes keyId from extra.authInfo.token to the request mapper', async () => {
		const router = vi.fn(async (req: CoreRequest) => {
			expect(req.apiKeyId).toBe('kado_writer-key');
			return makeWriteResult();
		});
		const handler = getWriteHandler(makeDeps({router}));

		await handler(
			{operation: 'note', path: 'notes/a.md', content: 'text'},
			makeExtra('kado_writer-key'),
		);
		expect(router).toHaveBeenCalledOnce();
	});

	it('returns isError:true when permission is denied', async () => {
		const denyError = makeCoreError({code: 'FORBIDDEN'});
		const deps = makeDeps({gates: [makeDenyGate(denyError)]});
		const handler = getWriteHandler(deps);

		const result = await handler(
			{operation: 'note', path: 'notes/a.md', content: 'text'},
			makeExtra(),
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('FORBIDDEN');
	});

	it('returns isError:true when concurrency guard fires a CONFLICT', async () => {
		const getFileMtime = vi.fn(() => 5000);
		const deps = makeDeps({getFileMtime});
		const handler = getWriteHandler(deps);

		const result = await handler(
			{operation: 'note', path: 'notes/a.md', content: 'text', expectedModified: 9999},
			makeExtra(),
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('CONFLICT');
	});

	it('allows write when expectedModified matches current mtime', async () => {
		const writeResult = makeWriteResult();
		const router = vi.fn(async () => writeResult);
		const getFileMtime = vi.fn(() => 5000);
		const handler = getWriteHandler(makeDeps({router, getFileMtime}));

		const result = await handler(
			{operation: 'note', path: 'notes/a.md', content: 'text', expectedModified: 5000},
			makeExtra(),
		);

		expect(result.isError).toBeFalsy();
	});

	it('allows write when expectedModified is absent (create intent)', async () => {
		const writeResult = makeWriteResult();
		const router = vi.fn(async () => writeResult);
		const getFileMtime = vi.fn(() => undefined);
		const handler = getWriteHandler(makeDeps({router, getFileMtime}));

		const result = await handler(
			{operation: 'note', path: 'notes/new.md', content: 'text'},
			makeExtra(),
		);

		expect(result.isError).toBeFalsy();
	});

	it('returns isError:true when the router returns a CoreError', async () => {
		const coreError: CoreError = {code: 'INTERNAL_ERROR', message: 'Adapter failure'};
		const router = vi.fn(async () => coreError);
		const handler = getWriteHandler(makeDeps({router}));

		const result = await handler(
			{operation: 'note', path: 'notes/a.md', content: 'text'},
			makeExtra(),
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('INTERNAL_ERROR');
	});
});

// ---------------------------------------------------------------------------
// kado-search handler
// ---------------------------------------------------------------------------

describe('kado-search handler', () => {
	function getSearchHandler(deps: ToolDependencies) {
		const server = makeMockServer();
		registerTools(server as unknown as Parameters<typeof registerTools>[0], deps);
		const reg = server.tools.find((t) => t.name === 'kado-search')!;
		return reg.handler;
	}

	it('routes the search request and returns mapped search result', async () => {
		const searchResult = makeSearchResult();
		const router = vi.fn(async () => searchResult);
		const handler = getSearchHandler(makeDeps({router}));

		const result = await handler({operation: 'byTag', query: 'project'}, makeExtra());

		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain('notes/a.md');
	});

	it('passes keyId from extra.authInfo.token to the request mapper', async () => {
		const router = vi.fn(async (req: CoreRequest) => {
			expect(req.apiKeyId).toBe('kado_searcher-key');
			return makeSearchResult();
		});
		const handler = getSearchHandler(makeDeps({router}));

		await handler({operation: 'byTag', query: 'x'}, makeExtra('kado_searcher-key'));
		expect(router).toHaveBeenCalledOnce();
	});

	it('returns isError:true when permission is denied', async () => {
		const denyError = makeCoreError({code: 'UNAUTHORIZED'});
		const deps = makeDeps({gates: [makeDenyGate(denyError)]});
		const handler = getSearchHandler(deps);

		const result = await handler({operation: 'byTag', query: 'x'}, makeExtra());

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('UNAUTHORIZED');
	});

	it('returns isError:true when the router returns a CoreError', async () => {
		const coreError: CoreError = {code: 'VALIDATION_ERROR', message: 'Bad query'};
		const router = vi.fn(async () => coreError);
		const handler = getSearchHandler(makeDeps({router}));

		const result = await handler({operation: 'byTag', query: 'x'}, makeExtra());

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('VALIDATION_ERROR');
	});
});
