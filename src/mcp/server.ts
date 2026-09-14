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
import {createAuthMiddleware} from './auth';
import type {ConfigManager} from '../core/config-manager';
import type {ServerConfig} from '../types/canonical';
import {kadoLog, kadoError} from '../core/logger';

// -----------------------------------------------------------------------
// Rate limiting (L5) — in-memory, per-IP, no external dependency
// -----------------------------------------------------------------------

/**
 * Per-request rate-limit parameters, read live from config so changes apply
 * without a server restart. `max <= 0` disables throttling entirely.
 */
export interface RateLimitParams {
	/** Max requests per window per IP. `0` (or less) disables throttling. */
	max: number;
	/** Window length in milliseconds. Guarded to ≥ 1000 ms by the middleware. */
	windowMs: number;
}

/** Interval at which the server proactively evicts expired rate-limit entries. */
export const EVICTION_INTERVAL_MS = 60_000;

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

/** In-memory rate-limit state for ordinary requests, keyed by IP. Exported for testing. */
export const requestCounts = new Map<string, RateLimitEntry>();

/**
 * Rate-limit state for MCP handshakes (`initialize`), keyed by IP and counted
 * separately from `requestCounts`. Exported for testing.
 */
export const handshakeCounts = new Map<string, RateLimitEntry>();

/**
 * Per-IP budget for handshakes. A client gets exactly one attempt to connect:
 * the Claude Code runtime opens its MCP connections once at session start and
 * never retries, so a throttled handshake costs that session every Kado tool
 * for its whole lifetime, where a throttled tool call costs it a few seconds.
 * Giving handshakes their own bucket means a burst of tool calls from one
 * session can no longer lock the next session out. Deliberately generous —
 * handshakes are rare — but still bounded, so the pre-auth endpoint is not a
 * free-for-all. Applied as a floor: a higher configured limit wins.
 */
export const HANDSHAKE_MAX_REQUESTS = 30;

const MAX_TRACKED_IPS = 10_000;

/** True when the request is an MCP `initialize` call (the handshake). */
function isHandshakeRequest(req: express.Request): boolean {
	if (req.method !== 'POST') return false;
	const body = req.body as {method?: unknown} | undefined;
	return body?.method === 'initialize';
}

function evictStaleEntries(now: number): void {
	for (const counts of [requestCounts, handshakeCounts]) {
		if (counts.size < MAX_TRACKED_IPS) continue;
		for (const [ip, entry] of counts) {
			if (now > entry.resetAt) counts.delete(ip);
		}
	}
}

/**
 * Removes expired rate-limit entries regardless of map size. Used by the
 * periodic eviction timer (L8 hardening) so long-running servers with
 * sporadic traffic do not accumulate stale state.
 */
function evictExpiredEntries(now: number): void {
	for (const counts of [requestCounts, handshakeCounts]) {
		for (const [ip, entry] of counts) {
			if (now > entry.resetAt) counts.delete(ip);
		}
	}
}

/**
 * Builds the per-IP rate-limit middleware. `getParams` is called on every request
 * so the limit and window track live config changes (no restart). When `max <= 0`
 * the throttle is disabled: no counting and no RateLimit-* headers — the absence
 * of the headers is the conventional "no limit" signal.
 *
 * MCP handshakes are counted in their own bucket against HANDSHAKE_MAX_REQUESTS
 * so tool-call traffic cannot exhaust a client's one chance to connect.
 */
function createRateLimitMiddleware(
	getParams: () => RateLimitParams,
): (req: express.Request, res: express.Response, next: express.NextFunction) => void {
	return function rateLimitMiddleware(req, res, next): void {
		const {max, windowMs: rawWindowMs} = getParams();
		if (max <= 0) {
			next();
			return;
		}
		const windowMs = Math.max(1000, rawWindowMs);

		const handshake = isHandshakeRequest(req);
		const counts = handshake ? handshakeCounts : requestCounts;
		const limit = handshake ? Math.max(max, HANDSHAKE_MAX_REQUESTS) : max;

		const ip = req.ip ?? 'unknown';
		const now = Date.now();
		evictStaleEntries(now);
		const entry = counts.get(ip) ?? {count: 0, resetAt: now + windowMs};
		if (now > entry.resetAt) {
			entry.count = 0;
			entry.resetAt = now + windowMs;
		}
		entry.count++;
		counts.set(ip, entry);

		// Always set rate-limit headers so clients can throttle proactively
		const remaining = Math.max(0, limit - entry.count);
		const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);
		res.setHeader('RateLimit-Limit', limit);
		res.setHeader('RateLimit-Remaining', remaining);
		res.setHeader('RateLimit-Reset', resetSeconds);

		if (entry.count > limit) {
			res.setHeader('Retry-After', resetSeconds);
			// Pushbacks are otherwise invisible: the audit log only records gate
			// decisions, and this middleware short-circuits before the tool layer.
			kadoLog('Rate limit exceeded', {
				ip,
				bucket: handshake ? 'handshake' : 'default',
				method: req.method,
				path: req.path,
				count: entry.count,
				max: limit,
				windowMs,
				retryAfterSeconds: resetSeconds,
			});
			res.status(429).json({error: 'Too many requests'});
			return;
		}
		next();
	};
}

// -----------------------------------------------------------------------
// Concurrency cap (PERF-L1-2) — in-process semaphore, no external dependency
// -----------------------------------------------------------------------

/** Maximum concurrent MCP requests the server will process before returning 503. */
export const MAX_CONCURRENT = 10;

type Transport = StreamableHTTPServerTransport;

/**
 * HTTP server lifecycle for the MCP layer.
 * Owns Express app, CORS, auth, rate limiting, and StreamableHTTP transport.
 */
export class KadoMcpServer {
	private httpServer: http.Server | null = null;
	private transports: Map<string, Transport> = new Map();
	private running = false;
	private activeRequests = 0;
	/** Pending retry timeout handle — cleared by stop() to prevent orphaned retries. */
	private retryTimeout: number | null = null;
	/** Periodic rate-limit eviction handle — started by start(), cleared by stop(). */
	private evictionInterval: number | null = null;
	/** In-flight stop() promise — ensures double-stop is idempotent. */
	private stopping: Promise<void> | null = null;
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

	/**
	 * Exposed for testing — allows resetting concurrency state.
	 * @internal
	 */
	resetActiveRequests(): void {
		this.activeRequests = 0;
	}

	/**
	 * Exposed for testing — allows setting concurrency state to any value.
	 * @internal
	 */
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
		// Start periodic eviction only after the listener is wired up so a
		// failed start (EADDRINUSE) does not leave an orphaned interval.
		if (this.evictionInterval === null) {
			this.evictionInterval = window.setInterval(() => {
				evictExpiredEntries(Date.now());
			}, EVICTION_INTERVAL_MS);
		}
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
					this.httpServer?.close();
					this.httpServer = null;
					this.retryTimeout = window.setTimeout(() => {
						this.retryTimeout = null;
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

	/** Closes all active transports and the HTTP server. Safe to call multiple times (idempotent). */
	stop(): Promise<void> {
		if (this.stopping) return this.stopping;
		this.stopping = this.doStop().finally(() => {
			this.stopping = null;
		});
		return this.stopping;
	}

	private async doStop(): Promise<void> {
		// Cancel any pending EADDRINUSE retry so it doesn't fire after stop
		if (this.retryTimeout !== null) {
			window.clearTimeout(this.retryTimeout);
			this.retryTimeout = null;
		}

		// Cancel periodic rate-limit eviction timer
		if (this.evictionInterval !== null) {
			window.clearInterval(this.evictionInterval);
			this.evictionInterval = null;
		}

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
		app.use(createRateLimitMiddleware(() => {
			const s = this.configManager.getConfig().server;
			return {max: s.rateLimitMaxRequests, windowMs: s.rateLimitWindowSeconds * 1000};
		}));
		app.use(createAuthMiddleware(this.configManager));
		this.mountMcpRoutes(app);
		return app;
	}

	/**
	 * Creates a fresh McpServer per request.
	 *
	 * This is intentional: the MCP SDK throws "Already connected to a transport"
	 * if the same McpServer instance is connected to a second transport. Because
	 * our transport is stateless (sessionIdGenerator: undefined), each HTTP request
	 * gets its own McpServer+Transport pair. The overhead is negligible — McpServer
	 * construction only registers handlers and allocates no I/O resources.
	 */
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
			await transport.handleRequest(req, res, body);
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
