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

type Transport = StreamableHTTPServerTransport;

export class KadoMcpServer {
	private httpServer: http.Server | null = null;
	private transports: Map<string, Transport> = new Map();
	private running = false;
	private activeRequests = 0;
	constructor(
		private readonly configManager: ConfigManager,
		private readonly registerToolsFn: (server: McpServer) => void,
		private readonly version: string = '0.0.0',
	) {}

	private acquireConcurrencySlot(res: express.Response): boolean {
		if (this.activeRequests >= MAX_CONCURRENT) {
			res.status(503).json({error: 'Server busy'});
			return false;
		}
		this.activeRequests++;
		return true;
	}

	private releaseConcurrencySlot(): void {
		this.activeRequests--;
	}

	/** Exposed for testing — allows resetting concurrency state. */
	resetActiveRequests(): void {
		this.activeRequests = 0;
	}

	/** Exposed for testing — allows setting concurrency state to any value. */
	setActiveRequestsForTesting(n: number): void {
		this.activeRequests = n;
	}

	/** Returns true when the HTTP server is listening. */
	isRunning(): boolean {
		return this.running;
	}

	/**
	 * Creates and starts the Express + MCP HTTP server on the given host:port.
	 * On EADDRINUSE retries once after a short delay (covers hot-reload race).
	 * Other errors are logged and the method resolves (no crash).
	 */
	async start(config: ServerConfig): Promise<void> {
		if (this.running || this.httpServer !== null) return;
		await this.tryListen(config);
	}

	private async tryListen(config: ServerConfig, retried = false): Promise<void> {
		const app = this.buildApp();
		this.httpServer = http.createServer(app);

		return new Promise<void>((resolve) => {
			if (!this.httpServer) {
				resolve();
				return;
			}

			this.httpServer.on('error', (err: Error & {code?: string}) => {
				if (err.code === 'EADDRINUSE' && !retried) {
					kadoLog('Port in use, retrying after delay', {port: config.port});
					this.httpServer = null;
					setTimeout(() => {
						void this.tryListen(config, true).then(resolve);
					}, 500);
					return;
				}
				if (err.code === 'EADDRINUSE') {
					kadoError('Port still in use after retry', {port: config.port});
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
		app.use(express.json({limit: '1mb'}));
		app.use(rateLimitMiddleware);
		app.use(createAuthMiddleware(this.configManager));
		this.mountMcpRoutes(app);
		return app;
	}

	/** Creates a fresh McpServer per request — the SDK forbids reusing a connected instance. */
	private createMcpServer(): McpServer {
		const server = new McpServer({name: 'kado', version: this.version});
		this.registerToolsFn(server);
		return server;
	}

	private async handleMcpRequest(req: express.Request, res: express.Response, body?: unknown): Promise<void> {
		if (!this.acquireConcurrencySlot(res)) return;
		try {
			const mcpServer = this.createMcpServer();
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
			});
			const sessionId = this.nextSessionId();
			this.transports.set(sessionId, transport);

			transport.onclose = () => {
				this.transports.delete(sessionId);
			};
			res.on('close', () => {
				this.transports.delete(sessionId);
				transport.close().catch(() => {});
			});

			await mcpServer.connect(transport);
			await transport.handleRequest(req as unknown as McpRequest, res, body);
		} catch (err: unknown) {
			kadoError('Route error', {error: String(err)});
			if (!res.headersSent) {
				res.status(500).json({error: 'Internal server error'});
			}
		} finally {
			this.releaseConcurrencySlot();
		}
	}

	private mountMcpRoutes(app: express.Express): void {
		app.post('/mcp', (req, res) => void this.handleMcpRequest(req, res, req.body));
		app.get('/mcp', (req, res) => void this.handleMcpRequest(req, res));

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
