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
	rotate: () => Promise<void>;
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
			await this.deps.rotate();
		}

		await this.deps.write(JSON.stringify(entry) + '\n');
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
