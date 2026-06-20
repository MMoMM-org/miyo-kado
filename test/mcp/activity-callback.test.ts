/**
 * Behavioral tests for the onActivity tool-call observer (status-bar feed).
 *
 * Verifies that every allowed/denied tool call emits a ToolActivityEvent with
 * the correct tool name, decision, mutating flag, full keyId, and gate — and
 * that emission is independent of whether audit logging is configured.
 */

import {describe, it, expect, vi} from 'vitest';
import {registerTools} from '../../src/mcp/tools';
import type {ToolDependencies, ToolActivityEvent} from '../../src/mcp/tools';
import type {
	CoreFileResult,
	CoreWriteResult,
	PermissionGate,
	KadoConfig,
	CoreError,
} from '../../src/types/canonical';
import {createDefaultConfig} from '../../src/types/canonical';
import type {ConfigManager} from '../../src/core/config-manager';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

type MockExtra = {
	authInfo?: {token: string; clientId: string; scopes: string[]};
	signal: AbortSignal;
	requestId: string;
	sendNotification: ReturnType<typeof vi.fn>;
	sendRequest: ReturnType<typeof vi.fn>;
};

function makeMockServer() {
	const tools: Array<{name: string; handler: (a: Record<string, unknown>, e: MockExtra) => Promise<CallToolResult>}> = [];
	const registerTool = vi.fn((name: string, _config: unknown, handler: (a: Record<string, unknown>, e: MockExtra) => Promise<CallToolResult>) => {
		tools.push({name, handler});
	});
	return {tools, registerTool};
}

function makeExtra(keyId = 'kado_test-key-1234567890'): MockExtra {
	return {
		authInfo: {token: keyId, clientId: 'client', scopes: []},
		signal: new AbortController().signal,
		requestId: 'req-1',
		sendNotification: vi.fn(),
		sendRequest: vi.fn(),
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

function makeFileResult(): CoreFileResult {
	return {path: 'notes/a.md', content: 'hi', created: 1, modified: 2, size: 2};
}

function makeWriteResult(): CoreWriteResult {
	return {path: 'notes/a.md', created: 1, modified: 2};
}

function makeDeps(overrides?: Partial<ToolDependencies>): ToolDependencies {
	return {
		configManager: makeConfigManager(),
		gates: [makeAllowGate()],
		router: vi.fn(async () => makeFileResult()),
		getFileMtime: vi.fn(() => 2),
		app: {workspace: {activeLeaf: null, getLeavesOfType: () => []}} as unknown as import('obsidian').App,
		...overrides,
	};
}

function getHandler(toolName: string, deps: ToolDependencies) {
	const server = makeMockServer();
	registerTools(server as unknown as Parameters<typeof registerTools>[0], deps);
	return server.tools.find((t) => t.name === toolName)!.handler;
}

describe('onActivity — allowed calls', () => {
	it('emits an allowed read event with mutating=false and the full keyId (no audit logger needed)', async () => {
		const events: ToolActivityEvent[] = [];
		const handler = getHandler('kado-read', makeDeps({onActivity: (e) => events.push(e)}));

		await handler({operation: 'note', path: 'notes/a.md'}, makeExtra('kado_full-key-id-abcdef'));

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({tool: 'kado-read', decision: 'allowed', mutating: false, keyId: 'kado_full-key-id-abcdef'});
	});

	it('flags a write as mutating=true', async () => {
		const events: ToolActivityEvent[] = [];
		const router = vi.fn(async () => makeWriteResult());
		const handler = getHandler('kado-write', makeDeps({router, onActivity: (e) => events.push(e)}));

		await handler({operation: 'note', path: 'notes/a.md', content: 'body', expectedModified: 2}, makeExtra());

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({tool: 'kado-write', decision: 'allowed', mutating: true});
	});
});

describe('onActivity — denied calls', () => {
	it('emits a denied event carrying the gate name', async () => {
		const events: ToolActivityEvent[] = [];
		const gates = [makeDenyGate({code: 'FORBIDDEN', message: 'nope', gate: 'permission'})];
		const handler = getHandler('kado-read', makeDeps({gates, onActivity: (e) => events.push(e)}));

		await handler({operation: 'note', path: 'notes/a.md'}, makeExtra());

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({tool: 'kado-read', decision: 'denied', mutating: false, gate: 'permission'});
	});
});

describe('onActivity — resilience', () => {
	it('a throwing observer never breaks the tool call', async () => {
		const handler = getHandler('kado-read', makeDeps({onActivity: () => { throw new Error('boom'); }}));
		const result = await handler({operation: 'note', path: 'notes/a.md'}, makeExtra());
		expect(result.isError).toBeFalsy();
	});
});
