/**
 * KadoMcpServer — HTTP server lifecycle for the MCP layer.
 *
 * Owns the Express app, applies CORS and auth middleware, wires the
 * StreamableHTTP MCP transport, and manages graceful start/stop.
 *
 * Architecture: this module sits at the MCP adapter boundary (Layer 4).
 * It has NO direct dependency on any Obsidian API.
 */

import * as http from 'node:http';
import express from 'express';
import cors from 'cors';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {AuthInfo} from '@modelcontextprotocol/sdk/server/auth/types.js';
import {createAuthMiddleware} from './auth';
import type {ConfigManager} from '../core/config-manager';
import type {ServerConfig} from '../types/canonical';
import {kadoLog, kadoError} from '../core/logger';

/** Express request augmented with SDK-compatible auth info for MCP transport. */
type McpRequest = express.Request & {auth?: AuthInfo};

// -----------------------------------------------------------------------
// Rate limiting (L5) — in-memory, per-IP, no external dependency
// -----------------------------------------------------------------------

export const RATE_LIMIT = 200; // requests per window
const WINDOW_MS = 60_000; // 1 minute

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

/** Exported for testing — allows tests to pre-fill rate limit state. */
export const requestCounts = new Map<string, RateLimitEntry>();

const MAX_TRACKED_IPS = 10_000;

function evictStaleEntries(now: number): void {
	if (requestCounts.size < MAX_TRACKED_IPS) return;
	for (const [ip, entry] of requestCounts) {
		if (now > entry.resetAt) requestCounts.delete(ip);
	}
}

function rateLimitMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
	const ip = req.ip ?? 'unknown';
	const now = Date.now();
	evictStaleEntries(now);
	const entry = requestCounts.get(ip) ?? {count: 0, resetAt: now + WINDOW_MS};
	if (now > entry.resetAt) {
		entry.count = 0;
		entry.resetAt = now + WINDOW_MS;
	}
	entry.count++;
	requestCounts.set(ip, entry);

	// Always set rate-limit headers so clients can throttle proactively
	const remaining = Math.max(0, RATE_LIMIT - entry.count);
	const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);
	res.setHeader('RateLimit-Limit', RATE_LIMIT);
	res.setHeader('RateLimit-Remaining', remaining);
	res.setHeader('RateLimit-Reset', resetSeconds);

	if (entry.count > RATE_LIMIT) {
		res.setHeader('Retry-After', resetSeconds);
		res.status(429).json({error: 'Too many requests'});
		return;
	}
	next();
}

// -----------------------------------------------------------------------
// Concurrency cap (PERF-L1-2) — in-process semaphore, no external dependency
// -----------------------------------------------------------------------

export const MAX_CONCURRENT = 10;
let activeRequests = 0;

function acquireConcurrencySlot(res: express.Response): boolean {
	if (activeRequests >= MAX_CONCURRENT) {
		res.status(503).json({error: 'Server busy'});
		return false;
	}
	activeRequests++;
	return true;
}

function releaseConcurrencySlot(): void {
	activeRequests--;
}

type Transport = StreamableHTTPServerTransport;

export class KadoMcpServer {
	private httpServer: http.Server | null = null;
	private transports: Map<string, Transport> = new Map();
	private running = false;

	constructor(
		private readonly configManager: ConfigManager,
		private readonly registerToolsFn: (server: McpServer) => void,
	) {}

	/** Returns true when the HTTP server is listening. */
	isRunning(): boolean {
		return this.running;
	}

	/**
	 * Creates and starts the Express + MCP HTTP server on the given host:port.
	 * On EADDRINUSE the error is logged and the method resolves (no crash).
	 */
	async start(config: ServerConfig): Promise<void> {
		if (this.running || this.httpServer !== null) return;
		const app = this.buildApp();
		this.httpServer = http.createServer(app);

		return new Promise<void>((resolve) => {
			if (!this.httpServer) {
				resolve();
				return;
			}

			this.httpServer.on('error', (err: Error & {code?: string}) => {
				if (err.code === 'EADDRINUSE') {
					kadoError('Port in use', {port: config.port});
				} else {
					kadoError('Server error', {message: err.message, code: err.code ?? 'UNKNOWN'});
				}
				resolve();
			});

			this.httpServer.listen(config.port, config.host, () => {
				this.running = true;
				kadoLog('Server started', {host: config.host, port: config.port});
				resolve();
			});
		});
	}

	/** Closes all active transports and the HTTP server. Safe to call multiple times. */
	async stop(): Promise<void> {
		const closePromises = Array.from(this.transports.values()).map((t) =>
			t.close().catch((err: unknown) => {
				kadoError('Transport close error', {error: String(err)});
			}),
		);
		await Promise.all(closePromises);
		this.transports.clear();

		await this.closeHttpServer();
		this.running = false;
		kadoLog('Server stopped');
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	private buildApp(): express.Express {
		const app = express();
		app.use(cors({
			origin: false,
			methods: ['GET', 'POST', 'DELETE'],
		}));
		app.use(express.json());
		app.use(rateLimitMiddleware);
		app.use(createAuthMiddleware(this.configManager));
		this.mountMcpRoutes(app);
		return app;
	}

	/** Creates a fresh McpServer with tools registered for a single request. */
	private createPerRequestServer(): McpServer {
		const server = new McpServer({name: 'kado', version: '1.0.0'});
		this.registerToolsFn(server);
		return server;
	}

	private mountMcpRoutes(app: express.Express): void {
		app.post('/mcp', async (req, res) => {
			if (!acquireConcurrencySlot(res)) return;
			try {
				const mcpServer = this.createPerRequestServer();
				const transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: undefined,
				});
				const sessionId = this.nextSessionId();
				this.transports.set(sessionId, transport);

				transport.onclose = () => {
					this.transports.delete(sessionId);
				};

				await mcpServer.connect(transport);
				await transport.handleRequest(req as unknown as McpRequest, res, req.body);
			} catch (err: unknown) {
				kadoError('Route error', {error: String(err)});
				res.status(500).json({error: 'Internal server error'});
			} finally {
				releaseConcurrencySlot();
			}
		});

		app.get('/mcp', async (req, res) => {
			if (!acquireConcurrencySlot(res)) return;
			try {
				const mcpServer = this.createPerRequestServer();
				const transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: undefined,
				});
				const sessionId = this.nextSessionId();
				this.transports.set(sessionId, transport);

				transport.onclose = () => {
					this.transports.delete(sessionId);
				};

				await mcpServer.connect(transport);
				await transport.handleRequest(req as unknown as McpRequest, res);
			} catch (err: unknown) {
				kadoError('Route error', {error: String(err)});
				res.status(500).json({error: 'Internal server error'});
			} finally {
				releaseConcurrencySlot();
			}
		});

		app.delete('/mcp', (_req, res) => {
			res.status(405).json({error: 'Session termination not supported in stateless mode'});
		});

		app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
			res.status(500).json({error: 'Internal server error'});
		});
	}

	private nextSessionId(): string {
		return crypto.randomUUID();
	}

	private closeHttpServer(): Promise<void> {
		return new Promise<void>((resolve) => {
			if (!this.httpServer) {
				resolve();
				return;
			}
			this.httpServer.close(() => resolve());
			this.httpServer = null;
		});
	}
}
