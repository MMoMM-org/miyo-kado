/**
 * Behavioral tests for registerTools — the MCP tool registration layer.
 *
 * Tests cover: 3 tools registered, each handler orchestrates the correct
 * pipeline (map request → permission check → concurrency guard for writes
 * → route → map response), and error paths return isError:true results.
 */

import {describe, it, expect, vi} from 'vitest';
import {z} from 'zod';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {registerTools, filterResultsByScope, computeAllowedTags, computeScopePatterns, kadoSearchShape, KADO_SEARCH_TOOL_DESCRIPTION} from '../../src/mcp/tools';
import type {ToolDependencies} from '../../src/mcp/tools';
import type {
	CoreRequest,
	CoreFileResult,
	CoreWriteResult,
	CoreSearchResult,
	CoreSearchItem,
	CoreError,
	PermissionGate,
	KadoConfig,
	ApiKeyConfig,
	SecurityConfig,
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

function makeReadPermissions() {
	return {
		note: {create: false, read: true, update: false, delete: false},
		frontmatter: {create: false, read: true, update: false, delete: false},
		file: {create: false, read: true, update: false, delete: false},
		dataviewInlineField: {create: false, read: true, update: false, delete: false},
	};
}

function makeSecurityConfig(overrides?: Partial<SecurityConfig>): SecurityConfig {
	return {
		listMode: 'whitelist',
		paths: [],
		tags: [],
		...overrides,
	};
}

function makeApiKey(id: string, overrides?: Partial<ApiKeyConfig>): ApiKeyConfig {
	return {
		id,
		label: 'Test Key',
		enabled: true,
		createdAt: 1000,
		listMode: 'whitelist',
		paths: [],
		tags: [],
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
		const security = makeSecurityConfig({paths: [{path: 'notes/**', permissions: makeReadPermissions()}]});
		const config: Partial<KadoConfig> = {
			security,
			apiKeys: [makeApiKey('kado_test-key', {paths: [{path: 'notes/**', permissions: makeReadPermissions()}]})],
		};
		const handler = getSearchHandler(makeDeps({router, configManager: makeConfigManager(config)}));

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

	it('injects scopePatterns from key config into the search request', async () => {
		const security = makeSecurityConfig({
			listMode: 'whitelist',
			paths: [{path: 'projects/**', permissions: makeReadPermissions()}],
		});
		const config: Partial<KadoConfig> = {
			security,
			apiKeys: [
				makeApiKey('kado_test-key', {
					paths: [{path: 'projects/**', permissions: makeReadPermissions()}],
				}),
			],
		};
		const searchResult = makeSearchResult({
			items: [
				{path: 'projects/a.md', name: 'a.md', created: 1000, modified: 2000, size: 10},
			],
		});
		const router = vi.fn(async () => searchResult);
		const deps = makeDeps({router, configManager: makeConfigManager(config)});
		const handler = getSearchHandler(deps);

		await handler({operation: 'byTag', query: 'x'}, makeExtra());

		// The router receives the request with scopePatterns injected
		const routedRequest = router.mock.calls[0][0];
		expect(routedRequest.scopePatterns).toEqual(['projects/**']);
	});

	it('passes through adapter-filtered results without re-filtering', async () => {
		const security = makeSecurityConfig({
			listMode: 'whitelist',
			paths: [{path: 'projects/**', permissions: makeReadPermissions()}],
		});
		const config: Partial<KadoConfig> = {
			security,
			apiKeys: [
				makeApiKey('kado_test-key', {
					paths: [{path: 'projects/**', permissions: makeReadPermissions()}],
				}),
			],
		};
		// Simulate adapter already filtered — only in-scope items returned
		const searchResult = makeSearchResult({
			items: [
				{path: 'projects/a.md', name: 'a.md', created: 1000, modified: 2000, size: 10},
			],
			total: 1,
		});
		const router = vi.fn(async () => searchResult);
		const deps = makeDeps({router, configManager: makeConfigManager(config)});
		const handler = getSearchHandler(deps);

		const result = await handler({operation: 'byName', query: 'a'}, makeExtra());

		expect(result.isError).toBeFalsy();
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.items).toHaveLength(1);
		expect(parsed.total).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// filterResultsByScope — scope filtering
// ---------------------------------------------------------------------------

describe('filterResultsByScope()', () => {
	function makeFullConfig(overrides?: Partial<KadoConfig>): KadoConfig {
		return {...createDefaultConfig(), ...overrides};
	}

	function makeItems(...paths: string[]): CoreSearchItem[] {
		return paths.map((p) => ({path: p, name: p.split('/').pop()!, created: 1000, modified: 2000, size: 10}));
	}

	it('returns only items matching both global and key whitelist patterns', () => {
		const config = makeFullConfig({
			security: makeSecurityConfig({paths: [{path: 'docs/**', permissions: makeReadPermissions()}]}),
			apiKeys: [makeApiKey('key-1', {paths: [{path: 'docs/**', permissions: makeReadPermissions()}]})],
		});

		const items = makeItems('docs/readme.md', 'secret/passwd.md', 'docs/guide.md');
		const filtered = filterResultsByScope(items, 'key-1', config);

		expect(filtered).toHaveLength(2);
		expect(filtered.map((i) => i.path)).toEqual(['docs/readme.md', 'docs/guide.md']);
	});

	it('returns empty array when the key has no whitelist paths (empty whitelist = no access)', () => {
		const config = makeFullConfig({
			security: makeSecurityConfig({paths: [{path: 'docs/**', permissions: makeReadPermissions()}]}),
			apiKeys: [makeApiKey('key-1', {listMode: 'whitelist', paths: []})],
		});
		const items = makeItems('docs/readme.md');
		const filtered = filterResultsByScope(items, 'key-1', config);

		expect(filtered).toHaveLength(0);
	});

	it('returns empty array when the key is unknown', () => {
		const config = makeFullConfig();
		const items = makeItems('docs/readme.md');
		const filtered = filterResultsByScope(items, 'unknown-key', config);

		expect(filtered).toHaveLength(0);
	});

	it('returns items matching either of multiple key whitelist path patterns', () => {
		const config = makeFullConfig({
			security: makeSecurityConfig({listMode: 'blacklist', paths: []}),
			apiKeys: [
				makeApiKey('key-1', {
					listMode: 'whitelist',
					paths: [
						{path: 'docs/**', permissions: makeReadPermissions()},
						{path: 'logs/**', permissions: makeReadPermissions()},
					],
				}),
			],
		});

		const items = makeItems('docs/a.md', 'logs/b.log', 'secret/c.md');
		const filtered = filterResultsByScope(items, 'key-1', config);

		expect(filtered).toHaveLength(2);
		expect(filtered.map((i) => i.path)).toEqual(['docs/a.md', 'logs/b.log']);
	});

	it('excludes items matching a global blacklist pattern', () => {
		const config = makeFullConfig({
			security: makeSecurityConfig({
				listMode: 'blacklist',
				paths: [{path: 'private/**', permissions: makeReadPermissions()}],
			}),
			apiKeys: [makeApiKey('key-1', {listMode: 'blacklist', paths: []})],
		});

		const items = makeItems('projects/a.md', 'private/secret.md', 'projects/b.md');
		const filtered = filterResultsByScope(items, 'key-1', config);

		expect(filtered).toHaveLength(2);
		expect(filtered.map((i) => i.path)).toEqual(['projects/a.md', 'projects/b.md']);
	});

	it('excludes items matching a key blacklist pattern', () => {
		const config = makeFullConfig({
			security: makeSecurityConfig({listMode: 'blacklist', paths: []}),
			apiKeys: [
				makeApiKey('key-1', {
					listMode: 'blacklist',
					paths: [{path: 'restricted/**', permissions: makeReadPermissions()}],
				}),
			],
		});

		const items = makeItems('projects/a.md', 'restricted/secret.md');
		const filtered = filterResultsByScope(items, 'key-1', config);

		expect(filtered).toHaveLength(1);
		expect(filtered[0].path).toBe('projects/a.md');
	});
});

// ---------------------------------------------------------------------------
// filterResultsByScope — folder-aware scope filter (T4.2)
// ---------------------------------------------------------------------------

describe('filterResultsByScope() — folder items', () => {
	function makeConfig(
		globalListMode: 'whitelist' | 'blacklist',
		globalPaths: string[],
		keyListMode: 'whitelist' | 'blacklist',
		keyPaths: string[],
	): KadoConfig {
		return {
			...createDefaultConfig(),
			security: makeSecurityConfig({
				listMode: globalListMode,
				paths: globalPaths.map((p) => ({path: p, permissions: makeReadPermissions()})),
			}),
			apiKeys: [
				makeApiKey('key-1', {
					listMode: keyListMode,
					paths: keyPaths.map((p) => ({path: p, permissions: makeReadPermissions()})),
				}),
			],
		};
	}

	function makeFolderItem(path: string, childCount = 5): CoreSearchItem {
		return {path, name: path.split('/').pop()!, created: 1000, modified: 2000, size: 0, type: 'folder', childCount};
	}

	function makeFileItem(path: string): CoreSearchItem {
		return {path, name: path.split('/').pop()!, created: 1000, modified: 2000, size: 100, type: 'file'};
	}

	// T4.2-case-1: whitelist folder visibility
	it('returns a folder item when a whitelist pattern could match its children', () => {
		const config = makeConfig('whitelist', ['Atlas/**'], 'whitelist', ['Atlas/**']);
		const items: CoreSearchItem[] = [makeFolderItem('Atlas'), makeFolderItem('Notes')];
		const filtered = filterResultsByScope(items, 'key-1', config);

		expect(filtered).toHaveLength(1);
		expect(filtered[0].path).toBe('Atlas');
	});

	// T4.2-case-2: blacklist folder blocking
	it('filters out a folder item when a blacklist pattern covers its children', () => {
		const config = makeConfig('blacklist', ['Private/**'], 'blacklist', ['Private/**']);
		const items: CoreSearchItem[] = [makeFolderItem('Private')];
		const filtered = filterResultsByScope(items, 'key-1', config);

		expect(filtered).toHaveLength(0);
	});

	// T4.2-case-3: blacklist parent-leakage prevention
	it('does NOT block a folder when the blacklist pattern covers only unrelated descendants', () => {
		const config = makeConfig('blacklist', ['Private/**'], 'blacklist', ['Private/**']);
		const items: CoreSearchItem[] = [makeFolderItem('Atlas'), makeFolderItem('Private')];
		const filtered = filterResultsByScope(items, 'key-1', config);

		expect(filtered).toHaveLength(1);
		expect(filtered[0].path).toBe('Atlas');
	});

	// T4.2-case-4: file items unchanged (regression)
	it('keeps file items using existing isPathInScope logic — whitelist allows, blacklist blocks', () => {
		const whitelistConfig = makeConfig('whitelist', ['Atlas/**'], 'whitelist', ['Atlas/**']);
		const fileInScope = makeFileItem('Atlas/note.md');
		const fileOutOfScope = makeFileItem('Other/note.md');

		const wFiltered = filterResultsByScope([fileInScope, fileOutOfScope], 'key-1', whitelistConfig);
		expect(wFiltered).toHaveLength(1);
		expect(wFiltered[0].path).toBe('Atlas/note.md');

		const blacklistConfig = makeConfig('blacklist', ['Atlas/**'], 'blacklist', ['Atlas/**']);
		const bFiltered = filterResultsByScope([fileInScope, fileOutOfScope], 'key-1', blacklistConfig);
		expect(bFiltered).toHaveLength(1);
		expect(bFiltered[0].path).toBe('Other/note.md');
	});

	// T4.2-case-5: defense-in-depth consistency — tools-layer agrees with core helper
	// Both the adapter (T4.1) and this tools-layer filter use dirCouldContainMatches.
	// We verify that for 'Atlas' folder with whitelist ['Atlas/**'], both the tools-layer
	// filterResultsByScope and the underlying dirCouldContainMatches agree it is visible.
	it('agrees with dirCouldContainMatches for Atlas folder with whitelist [Atlas/**]', async () => {
		const {dirCouldContainMatches} = await import('../../src/core/glob-match');

		const config = makeConfig('whitelist', ['Atlas/**'], 'whitelist', ['Atlas/**']);
		const folderItem = makeFolderItem('Atlas');

		// Core helper: dirCouldContainMatches says Atlas/ could contain matches for 'Atlas/**'
		const coreVerdict = dirCouldContainMatches('Atlas/**', 'Atlas/');
		expect(coreVerdict).toBe(true);

		// Tools-layer: filterResultsByScope should agree and include Atlas
		const toolsResult = filterResultsByScope([folderItem], 'key-1', config);
		expect(toolsResult).toHaveLength(1);
		expect(toolsResult[0].path).toBe('Atlas');
	});
});

// ---------------------------------------------------------------------------
// computeAllowedTags
// ---------------------------------------------------------------------------

describe('computeAllowedTags()', () => {
	function makeTagConfig(globalTags: string[], keyTags: string[]): KadoConfig {
		return {
			...createDefaultConfig(),
			security: {
				...createDefaultConfig().security,
				tags: globalTags,
			},
			apiKeys: [{
				id: 'key-1',
				label: 'Test',
				enabled: true,
				createdAt: Date.now(),
				listMode: 'whitelist',
				paths: [],
				tags: keyTags,
			}],
		};
	}

	it('returns undefined when both global and key tags are empty (tags not configured = no restriction)', () => {
		const result = computeAllowedTags('key-1', makeTagConfig([], []));
		expect(result).toBeUndefined();
	});

	it('returns key tags when global tags are empty', () => {
		const result = computeAllowedTags('key-1', makeTagConfig([], ['project', 'active']));
		expect(result).toEqual(['project', 'active']);
	});

	it('returns global tags when key tags are empty', () => {
		const result = computeAllowedTags('key-1', makeTagConfig(['project', 'active'], []));
		expect(result).toEqual(['project', 'active']);
	});

	it('returns intersection when both have tags', () => {
		const result = computeAllowedTags('key-1', makeTagConfig(['project', 'active', 'archive'], ['project', 'archive']));
		expect(result).toEqual(['project', 'archive']);
	});

	it('returns empty when intersection is empty', () => {
		const result = computeAllowedTags('key-1', makeTagConfig(['project'], ['archive']));
		expect(result).toEqual([]);
	});

	it('returns empty for unknown key', () => {
		const result = computeAllowedTags('unknown', makeTagConfig(['project'], ['project']));
		expect(result).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// computeScopePatterns (M7)
// ---------------------------------------------------------------------------

describe('computeScopePatterns()', () => {
	function makeConfig(
		globalListMode: 'whitelist' | 'blacklist',
		globalPaths: string[],
		keyListMode: 'whitelist' | 'blacklist',
		keyPaths: string[],
	): KadoConfig {
		return {
			...createDefaultConfig(),
			security: makeSecurityConfig({
				listMode: globalListMode,
				paths: globalPaths.map((p) => ({path: p, permissions: makeReadPermissions()})),
			}),
			apiKeys: [
				makeApiKey('key-1', {
					listMode: keyListMode,
					paths: keyPaths.map((p) => ({path: p, permissions: makeReadPermissions()})),
				}),
			],
		};
	}

	it('returns key paths when key is whitelist mode', () => {
		const config = makeConfig('whitelist', ['projects/**'], 'whitelist', ['projects/alpha/**']);
		const result = computeScopePatterns('key-1', config);
		expect(result).toEqual(['projects/alpha/**']);
	});

	it('returns global whitelist paths when key is blacklist and global is whitelist', () => {
		const config = makeConfig('whitelist', ['allowed/**', 'shared/**'], 'blacklist', ['allowed/secret/**']);
		const result = computeScopePatterns('key-1', config);
		expect(result).toEqual(['allowed/**', 'shared/**']);
	});

	it('returns undefined when both global and key are blacklist mode', () => {
		const config = makeConfig('blacklist', ['private/**'], 'blacklist', ['restricted/**']);
		const result = computeScopePatterns('key-1', config);
		expect(result).toBeUndefined();
	});

	it('returns empty array for unknown key', () => {
		const config = makeConfig('whitelist', ['docs/**'], 'whitelist', ['docs/**']);
		const result = computeScopePatterns('unknown-key', config);
		expect(result).toEqual([]);
	});

	it('returns empty key paths when key whitelist has no configured paths', () => {
		const config = makeConfig('whitelist', ['docs/**'], 'whitelist', []);
		const result = computeScopePatterns('key-1', config);
		expect(result).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// kadoSearchShape — depth and description
// ---------------------------------------------------------------------------

describe('kadoSearchShape — depth and description', () => {
	const schema = z.object(kadoSearchShape);

	it('schema accepts valid depth', () => {
		const result = schema.safeParse({operation: 'listDir', depth: 5});
		expect(result.success).toBe(true);
	});

	it('schema accepts depth omitted', () => {
		const result = schema.safeParse({operation: 'listDir'});
		expect(result.success).toBe(true);
	});

	it('schema rejects invalid depth — negative', () => {
		const result = schema.safeParse({operation: 'listDir', depth: -1});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBeInstanceOf(z.ZodError);
		}
	});

	it('schema rejects invalid depth — zero', () => {
		const result = schema.safeParse({operation: 'listDir', depth: 0});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBeInstanceOf(z.ZodError);
		}
	});

	it('schema rejects invalid depth — non-integer', () => {
		const result = schema.safeParse({operation: 'listDir', depth: 1.5});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBeInstanceOf(z.ZodError);
		}
	});

	it('schema rejects invalid depth — string', () => {
		const result = schema.safeParse({operation: 'listDir', depth: '5' as unknown as number});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBeInstanceOf(z.ZodError);
		}
	});

	it('tool description and schema contain required documentation substrings', () => {
		const pathDesc = kadoSearchShape.path.description ?? '';
		const depthDesc = kadoSearchShape.depth.description ?? '';
		const combined = KADO_SEARCH_TOOL_DESCRIPTION + pathDesc + depthDesc;

		for (const substring of ['type', 'folder', 'childCount', 'depth', '/', 'VALIDATION_ERROR', 'NOT_FOUND']) {
			expect(combined, `expected combined description to contain "${substring}"`).toContain(substring);
		}
	});
});
