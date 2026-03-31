/**
 * AuditLogger — writes NDJSON audit entries to a file-backed log.
 *
 * The logger is dependency-injected with I/O callbacks so it has zero
 * coupling to `obsidian` or `@modelcontextprotocol/sdk`. Rotation is
 * triggered automatically when the log file exceeds maxSizeBytes.
 *
 * CRITICAL: No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {AuditConfig} from '../types/canonical';

// ============================================================
// Types
// ============================================================

export interface AuditEntry {
	timestamp: number;
	apiKeyId: string;
	operation: string;
	dataType?: string;
	path?: string;
	decision: 'allowed' | 'denied';
	gate?: string;
	durationMs?: number;
}

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

export class AuditLogger {
	private config: AuditConfig;
	private readonly deps: AuditLoggerDeps;

	constructor(config: AuditConfig, deps: AuditLoggerDeps) {
		this.config = config;
		this.deps = deps;
	}

	async log(entry: AuditEntry): Promise<void> {
		if (!this.config.enabled) {
			return;
		}

		const size = await this.deps.getSize();
		if (size > this.config.maxSizeBytes) {
			await this.rotate();
		}

		await this.deps.write(JSON.stringify(entry) + '\n');
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

	updateConfig(config: AuditConfig): void {
		this.config = config;
	}
}

// ============================================================
// Factory
// ============================================================

type CreateAuditEntryParams = Omit<AuditEntry, 'timestamp'>;

export function createAuditEntry(params: CreateAuditEntryParams): AuditEntry {
	return {
		timestamp: Date.now(),
		...params,
	};
}
