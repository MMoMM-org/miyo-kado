/**
 * AuditLogger — writes NDJSON audit entries to a file-backed log.
 *
 * The logger is dependency-injected with I/O callbacks so it has zero
 * coupling to `obsidian` or `@modelcontextprotocol/sdk`. Rotation is
 * triggered automatically when the log file exceeds maxSizeBytes.
 *
 * Entries are buffered in-memory and flushed as a batch either on a 500ms
 * timer or via an explicit `flush()` call (H5 hardening). This reduces disk
 * I/O from O(file-size) per entry to a single append per flush window.
 *
 * CRITICAL: No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {AuditConfig} from '../types/canonical';

// ============================================================
// Types
// ============================================================

/** A single NDJSON audit log entry recording an allowed or denied operation. */
export interface AuditEntry {
	/** ISO 8601 timestamp with local timezone offset, e.g. "2026-03-31T14:29:06.365+02:00". */
	timestamp: string;
	apiKeyId: string;
	operation: string;
	dataType?: string;
	path?: string;
	query?: string;
	decision: 'allowed' | 'denied';
	gate?: string;
	durationMs?: number;
	/** Number of permitted items returned (used by open-notes tool). Only set on allowed decisions. */
	permittedCount?: number;
}

/** I/O callbacks injected into AuditLogger for file operations (no Obsidian dependency). */
export interface AuditLoggerDeps {
	write: (line: string) => Promise<void>;
	getSize: () => Promise<number>;
	/** Check if a file exists at the given path. */
	exists: (path: string) => Promise<boolean>;
	/** Rename (move) a file. */
	rename: (from: string, to: string) => Promise<void>;
	/** Remove a file. */
	remove: (path: string) => Promise<void>;
	/** Get the base log file path (logDirectory/logFileName resolved). */
	getLogPath: () => string;
}

// ============================================================
// AuditLogger
// ============================================================

/** Interval after which buffered entries are auto-flushed to disk. */
const FLUSH_INTERVAL_MS = 500;

export class AuditLogger {
	private config: AuditConfig;
	private readonly deps: AuditLoggerDeps;

	/** In-memory line buffer; each element is a JSON line terminated by '\n'. */
	private buffer: string[] = [];

	/** Pending flush timer; null when idle. */
	private flushTimer: ReturnType<typeof setTimeout> | null = null;

	/** In-flight flush promise; ensures flush() is reentrant / idempotent. */
	private flushingPromise: Promise<void> | null = null;

	constructor(config: AuditConfig, deps: AuditLoggerDeps) {
		this.config = config;
		this.deps = deps;
	}

	/**
	 * Queues an entry for the next flush. Returns immediately — actual I/O
	 * happens on the next flush, either via the 500ms timer or an explicit
	 * `flush()` call.
	 *
	 * The return type is `Promise<void>` for back-compat with callers that
	 * `await` this method, but the body is synchronous (no await inside).
	 */
	log(entry: AuditEntry): Promise<void> {
		if (!this.config.enabled) {
			return Promise.resolve();
		}

		const line = JSON.stringify(entry) + '\n';
		this.buffer.push(line);
		this.scheduleFlush();
		return Promise.resolve();
	}

	/**
	 * Drains the buffer to disk. Idempotent: concurrent callers share the
	 * same underlying write. Safe to call on plugin unload to persist any
	 * remaining entries.
	 */
	async flush(): Promise<void> {
		if (this.flushingPromise) {
			return this.flushingPromise;
		}
		if (this.buffer.length === 0) {
			return;
		}

		// Cancel any scheduled auto-flush — we're flushing now.
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		const snapshot = this.buffer;
		this.buffer = [];

		this.flushingPromise = this.doFlush(snapshot).finally(() => {
			this.flushingPromise = null;
		});
		return this.flushingPromise;
	}

	/** Replaces the audit configuration. Flushes any pending entries first. */
	updateConfig(config: AuditConfig): void {
		// Fire-and-forget flush — we can't make updateConfig async without
		// breaking callers, but any pending entries are persisted.
		void this.flush();
		this.config = config;
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	/** Arms the 500ms auto-flush timer if not already armed. */
	private scheduleFlush(): void {
		if (this.flushTimer !== null) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, FLUSH_INTERVAL_MS);
	}

	/**
	 * Actual flush pipeline: rotation check once, then single batched write.
	 * On failure: lines are prepended back to the buffer for the next attempt.
	 * Errors are swallowed — audit failures must never crash callers.
	 */
	private async doFlush(lines: string[]): Promise<void> {
		try {
			// Rotation check runs once per flush, not once per entry
			const size = await this.deps.getSize();
			if (size > this.config.maxSizeBytes) {
				await this.rotate();
			}

			// Lines already carry trailing '\n' — joining is a concat
			const batched = lines.join('');
			await this.deps.write(batched);
		} catch {
			// Retry-prepend: failed entries stay in FIFO order at the head of
			// the buffer for the next flush attempt.
			this.buffer = [...lines, ...this.buffer];
		}
	}

	/**
	 * Multi-file log rotation: shifts .1→.2→...→.N, deletes beyond maxRetainedLogs.
	 * Then moves current log to .1 and creates a fresh empty file.
	 */
	private async rotate(): Promise<void> {
		const basePath = this.deps.getLogPath();
		const maxRetained = this.config.maxRetainedLogs;

		// Delete oldest if at limit
		const oldest = `${basePath}.${maxRetained}`;
		if (await this.deps.exists(oldest)) {
			await this.deps.remove(oldest);
		}

		// Shift: .N-1 → .N, .N-2 → .N-1, ..., .1 → .2
		for (let i = maxRetained - 1; i >= 1; i--) {
			const from = `${basePath}.${i}`;
			const to = `${basePath}.${i + 1}`;
			if (await this.deps.exists(from)) {
				await this.deps.rename(from, to);
			}
		}

		// Current → .1
		if (await this.deps.exists(basePath)) {
			await this.deps.rename(basePath, `${basePath}.1`);
		}

		// Create fresh empty log via write
		await this.deps.write('');
	}
}

// ============================================================
// Factory
// ============================================================

type CreateAuditEntryParams = Omit<AuditEntry, 'timestamp'>;

/** Formats current time as ISO 8601 with local timezone offset. */
function localIsoTimestamp(): string {
	const now = new Date();
	const offset = -now.getTimezoneOffset();
	const sign = offset >= 0 ? '+' : '-';
	const absOffset = Math.abs(offset);
	const hours = String(Math.floor(absOffset / 60)).padStart(2, '0');
	const minutes = String(absOffset % 60).padStart(2, '0');
	// Build ISO string with milliseconds and local offset
	const pad = (n: number, len = 2): string => String(n).padStart(len, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}${sign}${hours}:${minutes}`;
}

/**
 * Creates an AuditEntry with the current local ISO 8601 timestamp.
 * @param params - All entry fields except timestamp.
 */
export function createAuditEntry(params: CreateAuditEntryParams): AuditEntry {
	return {
		timestamp: localIsoTimestamp(),
		...params,
	};
}
