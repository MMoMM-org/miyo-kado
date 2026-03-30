/**
 * Behavioral tests for KadoMcpServer lifecycle.
 *
 * Tests cover: start binds to configured host:port, stop shuts down cleanly,
 * isRunning reports correct state, EADDRINUSE is caught without crash,
 * double-stop is safe, and CORS + auth middleware are wired before MCP routes.
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {KadoMcpServer} from '../../src/mcp/server';
import {ConfigManager} from '../../src/core/config-manager';
import type {ServerConfig} from '../../src/types/canonical';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import * as http from 'node:http';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfigManager(): ConfigManager {
	return new ConfigManager(async () => null, async () => {});
}

function makeServerConfig(port: number): ServerConfig {
	return {enabled: true, host: '127.0.0.1', port};
}

function noopRegisterTools(_server: McpServer): void {
	// No tools registered in lifecycle tests
}

/**
 * Finds a free ephemeral port by briefly binding to port 0.
 */
function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = http.createServer();
		srv.listen(0, '127.0.0.1', () => {
			const addr = srv.address();
			if (!addr || typeof addr === 'string') {
				srv.close(() => reject(new Error('Unexpected address format')));
				return;
			}
			const {port} = addr;
			srv.close(() => resolve(port));
		});
	});
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeKadoMcpServer(
	configManager = makeConfigManager(),
	registerToolsFn: (server: McpServer) => void = noopRegisterTools,
): KadoMcpServer {
	return new KadoMcpServer(configManager, registerToolsFn);
}

// ---------------------------------------------------------------------------
// Lifecycle — isRunning
// ---------------------------------------------------------------------------

describe('KadoMcpServer — isRunning', () => {
	let server: KadoMcpServer;

	beforeEach(() => {
		server = makeKadoMcpServer();
	});

	afterEach(async () => {
		await server.stop();
	});

	it('returns false before start() is called', () => {
		expect(server.isRunning()).toBe(false);
	});

	it('returns true after start() resolves', async () => {
		const port = await getFreePort();
		await server.start(makeServerConfig(port));
		expect(server.isRunning()).toBe(true);
	});

	it('returns false after stop() resolves', async () => {
		const port = await getFreePort();
		await server.start(makeServerConfig(port));
		await server.stop();
		expect(server.isRunning()).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Lifecycle — start / stop
// ---------------------------------------------------------------------------

describe('KadoMcpServer — start', () => {
	let server: KadoMcpServer;

	beforeEach(() => {
		server = makeKadoMcpServer();
	});

	afterEach(async () => {
		await server.stop();
	});

	it('starts without throwing on a free port', async () => {
		const port = await getFreePort();
		await expect(server.start(makeServerConfig(port))).resolves.toBeUndefined();
	});

	it('calls the registerToolsFn with an McpServer instance', async () => {
		const port = await getFreePort();
		const spy = vi.fn();
		const srv = makeKadoMcpServer(makeConfigManager(), spy);
		await srv.start(makeServerConfig(port));
		await srv.stop();
		expect(spy).toHaveBeenCalledOnce();
		expect(spy.mock.calls[0]?.[0]).toBeDefined();
	});

	it('accepts requests on the configured port once started', async () => {
		const port = await getFreePort();
		await server.start(makeServerConfig(port));

		const body = await new Promise<string>((resolve, reject) => {
			const req = http.request(
				{host: '127.0.0.1', port, method: 'GET', path: '/health'},
				(res) => {
					let data = '';
					res.on('data', (chunk: Buffer) => {
						data += chunk.toString();
					});
					res.on('end', () => resolve(data));
				},
			);
			req.on('error', reject);
			req.end();
		});

		// The server is up — we receive a response (may be 404 or 200, not a connection error)
		expect(body).toBeDefined();
	});
});

describe('KadoMcpServer — stop', () => {
	it('resolves cleanly when server was started', async () => {
		const port = await getFreePort();
		const server = makeKadoMcpServer();
		await server.start(makeServerConfig(port));
		await expect(server.stop()).resolves.toBeUndefined();
	});

	it('double-stop does not throw or reject', async () => {
		const port = await getFreePort();
		const server = makeKadoMcpServer();
		await server.start(makeServerConfig(port));
		await server.stop();
		await expect(server.stop()).resolves.toBeUndefined();
	});

	it('stop without start does not throw', async () => {
		const server = makeKadoMcpServer();
		await expect(server.stop()).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Error handling — EADDRINUSE
// ---------------------------------------------------------------------------

describe('KadoMcpServer — EADDRINUSE handling', () => {
	it('reports error via console.error and does not reject on port-in-use', async () => {
		const port = await getFreePort();

		// Occupy the port with a plain HTTP server
		const blocker = http.createServer();
		await new Promise<void>((resolve) => blocker.listen(port, '127.0.0.1', resolve));

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		try {
			const server = makeKadoMcpServer();
			await expect(server.start(makeServerConfig(port))).resolves.toBeUndefined();
			expect(errorSpy).toHaveBeenCalled();
			await server.stop();
		} finally {
			errorSpy.mockRestore();
			await new Promise<void>((resolve) => blocker.close(() => resolve()));
		}
	});
});

// ---------------------------------------------------------------------------
// Middleware ordering — auth applied before MCP routes
// ---------------------------------------------------------------------------

describe('KadoMcpServer — auth middleware applied', () => {
	it('returns 401 on MCP endpoint without Authorization header', async () => {
		const port = await getFreePort();
		const server = makeKadoMcpServer();
		await server.start(makeServerConfig(port));

		try {
			const statusCode = await new Promise<number>((resolve, reject) => {
				const req = http.request(
					{
						host: '127.0.0.1',
						port,
						method: 'POST',
						path: '/mcp',
						headers: {'Content-Type': 'application/json'},
					},
					(res) => {
						res.resume(); // drain
						resolve(res.statusCode ?? 0);
					},
				);
				req.on('error', reject);
				req.write(JSON.stringify({jsonrpc: '2.0', method: 'initialize', id: 1}));
				req.end();
			});

			expect(statusCode).toBe(401);
		} finally {
			await server.stop();
		}
	});
});
