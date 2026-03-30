/**
 * Behavioral tests for audit logging integration in tool handlers.
 *
 * Tests cover: allowed tool calls produce audit entries with correct fields,
 * denied tool calls produce denied audit entries with gate name, disabled
 * audit is a no-op, durationMs is recorded, multiple calls produce multiple
 * entries.
 */

import {describe, it, expect, vi} from 'vitest';
import {registerTools} from '../../src/mcp/tools';
import type {ToolDependencies} from '../../src/mcp/tools';
import {AuditLogger} from '../../src/core/audit-logger';
import type {AuditEntry} from '../../src/core/audit-logger';
import type {
	CoreFileResult,
	CoreWriteResult,
	CoreSearchResult,
	CoreError,
	PermissionGate,
	KadoConfig,
} from '../../src/types/canonical';
import {createDefaultConfig} from '../../src/types/canonical';
import type {ConfigManager} from '../../src/core/config-manager';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

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
	return {path: 'notes/a.md', created: 1000, modified: 2000, ...overrides};
}

function makeSearchResult(overrides?: Partial<CoreSearchResult>): CoreSearchResult {
	return {
		items: [{path: 'notes/a.md', name: 'a.md', created: 1000, modified: 2000, size: 11}],
		...overrides,
	};
}

function makeConfigManager(config?: Partial<KadoConfig>): ConfigManager {
	const merged = {...createDefaultConfig(), ...config};
	return {getConfig: () => merged} as unknown as ConfigManager;
}

function makeAllowGate(): PermissionGate {
	return {name: 'allow-all', evaluate: () => ({allowed: true})};
}

function makeDenyGate(error: CoreError): PermissionGate {
	return {name: 'deny-all', evaluate: () => ({allowed: false, error})};
}

function makeAuditLogger(): {logger: AuditLogger; entries: AuditEntry[]} {
	const entries: AuditEntry[] = [];
	const deps = {
		write: vi.fn(async (line: string) => {
			entries.push(JSON.parse(line) as AuditEntry);
		}),
		getSize: vi.fn(async () => 0),
		rotate: vi.fn(async () => undefined),
	};
	const logger = new AuditLogger(
		{enabled: true, logFilePath: 'plugins/kado/audit.log', maxSizeBytes: 10 * 1024 * 1024},
		deps,
	);
	return {logger, entries};
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

function getHandler(toolName: string, deps: ToolDependencies) {
	const server = makeMockServer();
	registerTools(server as unknown as Parameters<typeof registerTools>[0], deps);
	return server.tools.find((t) => t.name === toolName)!.handler;
}

// ---------------------------------------------------------------------------
// Allowed tool call — audit entry logged
// ---------------------------------------------------------------------------

describe('audit integration — allowed kado-read call', () => {
	it('logs an audit entry with decision "allowed", correct apiKeyId, operation, and path', async () => {
		const {logger, entries} = makeAuditLogger();
		const router = vi.fn(async () => makeFileResult({path: 'notes/test.md'}));
		const handler = getHandler('kado-read', makeDeps({router, auditLogger: logger}));

		await handler({operation: 'note', path: 'notes/test.md'}, makeExtra('kado_test-key'));

		expect(entries).toHaveLength(1);
		expect(entries[0].decision).toBe('allowed');
		expect(entries[0].apiKeyId).toBe('kado_test-key');
		expect(entries[0].operation).toBe('note');
		expect(entries[0].path).toBe('notes/test.md');
	});

	it('records durationMs greater than zero on allowed read', async () => {
		const {logger, entries} = makeAuditLogger();
		const handler = getHandler('kado-read', makeDeps({auditLogger: logger}));

		await handler({operation: 'note', path: 'notes/a.md'}, makeExtra());

		expect(entries[0].durationMs).toBeGreaterThan(0);
	});
});

describe('audit integration — allowed kado-write call', () => {
	it('logs an audit entry with decision "allowed" and correct path', async () => {
		const {logger, entries} = makeAuditLogger();
		const router = vi.fn(async () => makeWriteResult({path: 'notes/w.md'}));
		const handler = getHandler('kado-write', makeDeps({router, auditLogger: logger}));

		await handler(
			{operation: 'note', path: 'notes/w.md', content: 'text'},
			makeExtra('kado_writer'),
		);

		expect(entries).toHaveLength(1);
		expect(entries[0].decision).toBe('allowed');
		expect(entries[0].apiKeyId).toBe('kado_writer');
		expect(entries[0].path).toBe('notes/w.md');
	});

	it('records durationMs greater than zero on allowed write', async () => {
		const {logger, entries} = makeAuditLogger();
		const router = vi.fn(async () => makeWriteResult());
		const handler = getHandler('kado-write', makeDeps({router, auditLogger: logger}));

		await handler({operation: 'note', path: 'notes/a.md', content: 'text'}, makeExtra());

		expect(entries[0].durationMs).toBeGreaterThan(0);
	});
});

describe('audit integration — allowed kado-search call', () => {
	it('logs an audit entry with decision "allowed"', async () => {
		const {logger, entries} = makeAuditLogger();
		const router = vi.fn(async () => makeSearchResult());
		const handler = getHandler('kado-search', makeDeps({router, auditLogger: logger}));

		await handler({operation: 'byTag', query: 'project'}, makeExtra('kado_searcher'));

		expect(entries).toHaveLength(1);
		expect(entries[0].decision).toBe('allowed');
		expect(entries[0].apiKeyId).toBe('kado_searcher');
	});
});

// ---------------------------------------------------------------------------
// Denied tool call — audit entry logged with gate
// ---------------------------------------------------------------------------

describe('audit integration — denied kado-read call', () => {
	it('logs an audit entry with decision "denied" and the gate name', async () => {
		const {logger, entries} = makeAuditLogger();
		const denyError: CoreError = {code: 'FORBIDDEN', message: 'No access', gate: 'key-scope'};
		const handler = getHandler(
			'kado-read',
			makeDeps({gates: [makeDenyGate(denyError)], auditLogger: logger}),
		);

		await handler({operation: 'note', path: 'notes/secret.md'}, makeExtra('kado_test-key'));

		expect(entries).toHaveLength(1);
		expect(entries[0].decision).toBe('denied');
		expect(entries[0].gate).toBe('key-scope');
		expect(entries[0].apiKeyId).toBe('kado_test-key');
	});
});

describe('audit integration — denied kado-write call', () => {
	it('logs an audit entry with decision "denied" and the gate name', async () => {
		const {logger, entries} = makeAuditLogger();
		const denyError: CoreError = {code: 'FORBIDDEN', message: 'Denied', gate: 'global-scope'};
		const handler = getHandler(
			'kado-write',
			makeDeps({gates: [makeDenyGate(denyError)], auditLogger: logger}),
		);

		await handler({operation: 'note', path: 'notes/a.md', content: 'x'}, makeExtra());

		expect(entries).toHaveLength(1);
		expect(entries[0].decision).toBe('denied');
		expect(entries[0].gate).toBe('global-scope');
	});
});

describe('audit integration — denied kado-search call', () => {
	it('logs an audit entry with decision "denied" and the gate name', async () => {
		const {logger, entries} = makeAuditLogger();
		const denyError: CoreError = {code: 'UNAUTHORIZED', message: 'Bad key', gate: 'authenticate'};
		const handler = getHandler(
			'kado-search',
			makeDeps({gates: [makeDenyGate(denyError)], auditLogger: logger}),
		);

		await handler({operation: 'byTag', query: 'x'}, makeExtra());

		expect(entries).toHaveLength(1);
		expect(entries[0].decision).toBe('denied');
		expect(entries[0].gate).toBe('authenticate');
	});
});

// ---------------------------------------------------------------------------
// Audit disabled — no entries written
// ---------------------------------------------------------------------------

describe('audit integration — disabled audit logger', () => {
	it('writes no audit entries when audit is disabled', async () => {
		const deps = {
			write: vi.fn(async () => undefined),
			getSize: vi.fn(async () => 0),
			rotate: vi.fn(async () => undefined),
		};
		const logger = new AuditLogger(
			{enabled: false, logFilePath: 'plugins/kado/audit.log', maxSizeBytes: 10 * 1024 * 1024},
			deps,
		);
		const handler = getHandler('kado-read', makeDeps({auditLogger: logger}));

		await handler({operation: 'note', path: 'notes/a.md'}, makeExtra());

		expect(deps.write).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// No auditLogger — existing tests remain unaffected
// ---------------------------------------------------------------------------

describe('audit integration — no auditLogger in deps', () => {
	it('does not throw when auditLogger is absent and call succeeds', async () => {
		const handler = getHandler('kado-read', makeDeps());

		await expect(
			handler({operation: 'note', path: 'notes/a.md'}, makeExtra()),
		).resolves.not.toThrow();
	});

	it('does not throw when auditLogger is absent and call is denied', async () => {
		const denyError: CoreError = {code: 'FORBIDDEN', message: 'Denied'};
		const handler = getHandler(
			'kado-read',
			makeDeps({gates: [makeDenyGate(denyError)]}),
		);

		await expect(
			handler({operation: 'note', path: 'notes/a.md'}, makeExtra()),
		).resolves.not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// Multiple tool calls — multiple audit entries
// ---------------------------------------------------------------------------

describe('audit integration — multiple tool calls produce multiple entries', () => {
	it('produces one entry per successful call', async () => {
		const {logger, entries} = makeAuditLogger();
		const handler = getHandler('kado-read', makeDeps({auditLogger: logger}));
		const extra = makeExtra();

		await handler({operation: 'note', path: 'notes/a.md'}, extra);
		await handler({operation: 'note', path: 'notes/b.md'}, extra);
		await handler({operation: 'note', path: 'notes/c.md'}, extra);

		expect(entries).toHaveLength(3);
	});
});
