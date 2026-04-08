/**
 * Behavioral tests for AuditLogger.
 *
 * Tests cover: log() writes NDJSON line, required fields present, denied entry
 * includes gate, allowed entry has decision 'allowed', disabled config is a
 * no-op, rotation is called when file size exceeds maxSizeBytes, and
 * createAuditEntry() factory produces valid entries.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {AuditLogger, createAuditEntry} from '../../src/core/audit-logger';
import type {AuditEntry} from '../../src/core/audit-logger';
import type {AuditConfig} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<AuditConfig>): AuditConfig {
	return {
		enabled: true,
		logDirectory: 'logs',
		logFileName: 'kado-audit.log',
		maxSizeBytes: 1024,
		maxRetainedLogs: 3,
		...overrides,
	};
}

function makeDeps(overrides?: {size?: number}) {
	return {
		write: vi.fn().mockResolvedValue(undefined),
		getSize: vi.fn().mockResolvedValue(overrides?.size ?? 0),
		exists: vi.fn().mockResolvedValue(false),
		rename: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		getLogPath: vi.fn().mockReturnValue('logs/kado-audit.log'),
	};
}

function makeEntry(overrides?: Partial<AuditEntry>): AuditEntry {
	return {
		timestamp: '2023-11-14T22:13:20.000+00:00',
		apiKeyId: 'kado_test-key',
		operation: 'read',
		dataType: 'note',
		path: 'notes/example.md',
		decision: 'allowed',
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// log() — NDJSON output
// ---------------------------------------------------------------------------

describe('AuditLogger.log() — writes NDJSON line', () => {
	it('calls write callback with JSON-stringified entry followed by newline', async () => {
		const deps = makeDeps();
		const logger = new AuditLogger(makeConfig(), deps);
		const entry = makeEntry();

		await logger.log(entry);
		await logger.flush();

		expect(deps.write).toHaveBeenCalledOnce();
		const [line] = deps.write.mock.calls[0] as [string];
		expect(line).toBe(JSON.stringify(entry) + '\n');
	});
});

// ---------------------------------------------------------------------------
// log() — required fields
// ---------------------------------------------------------------------------

describe('AuditLogger.log() — required fields present', () => {
	it('written line contains all required fields', async () => {
		const deps = makeDeps();
		const logger = new AuditLogger(makeConfig(), deps);
		const entry = makeEntry();

		await logger.log(entry);
		await logger.flush();

		const [line] = deps.write.mock.calls[0] as [string];
		const parsed = JSON.parse(line) as AuditEntry;
		expect(parsed.timestamp).toBe(entry.timestamp);
		expect(parsed.apiKeyId).toBe(entry.apiKeyId);
		expect(parsed.operation).toBe(entry.operation);
		expect(parsed.dataType).toBe(entry.dataType);
		expect(parsed.path).toBe(entry.path);
		expect(parsed.decision).toBe(entry.decision);
	});
});

// ---------------------------------------------------------------------------
// log() — denied entry includes gate
// ---------------------------------------------------------------------------

describe('AuditLogger.log() — denied entry', () => {
	it('includes gate field when decision is denied', async () => {
		const deps = makeDeps();
		const logger = new AuditLogger(makeConfig(), deps);
		const entry = makeEntry({decision: 'denied', gate: 'authenticate'});

		await logger.log(entry);
		await logger.flush();

		const [line] = deps.write.mock.calls[0] as [string];
		const parsed = JSON.parse(line) as AuditEntry;
		expect(parsed.decision).toBe('denied');
		expect(parsed.gate).toBe('authenticate');
	});
});

// ---------------------------------------------------------------------------
// log() — allowed entry
// ---------------------------------------------------------------------------

describe('AuditLogger.log() — allowed entry', () => {
	it('decision is allowed and gate is absent', async () => {
		const deps = makeDeps();
		const logger = new AuditLogger(makeConfig(), deps);
		const entry = makeEntry({decision: 'allowed'});

		await logger.log(entry);
		await logger.flush();

		const [line] = deps.write.mock.calls[0] as [string];
		const parsed = JSON.parse(line) as AuditEntry;
		expect(parsed.decision).toBe('allowed');
		expect(parsed.gate).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// log() — disabled config is a no-op
// ---------------------------------------------------------------------------

describe('AuditLogger.log() — disabled config', () => {
	it('does not call write when enabled is false', async () => {
		const deps = makeDeps();
		const logger = new AuditLogger(makeConfig({enabled: false}), deps);

		await logger.log(makeEntry());
		await logger.flush();

		expect(deps.write).not.toHaveBeenCalled();
	});

	it('does not call getSize when enabled is false', async () => {
		const deps = makeDeps();
		const logger = new AuditLogger(makeConfig({enabled: false}), deps);

		await logger.log(makeEntry());
		await logger.flush();

		expect(deps.getSize).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// log() — rotation
// ---------------------------------------------------------------------------

describe('AuditLogger.log() — rotation when size exceeds maxSizeBytes', () => {
	it('calls rotation deps before write when file size exceeds maxSizeBytes', async () => {
		const deps = makeDeps({size: 2048});
		const logger = new AuditLogger(makeConfig({maxSizeBytes: 1024}), deps);

		await logger.log(makeEntry());
		await logger.flush();

		// Rotation should have been triggered (getLogPath called, exists checked)
		expect(deps.getLogPath).toHaveBeenCalled();
		expect(deps.exists).toHaveBeenCalled();
		// write is called at least once (rotation empty write + entry write)
		expect(deps.write).toHaveBeenCalled();
	});

	it('renames files in the correct shift order for maxRetainedLogs = 3', async () => {
		const base = 'logs/kado-audit.log';
		const deps = {
			write: vi.fn().mockResolvedValue(undefined),
			getSize: vi.fn().mockResolvedValue(2048),
			// All candidate paths exist so every rename branch executes
			exists: vi.fn().mockResolvedValue(true),
			rename: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
			getLogPath: vi.fn().mockReturnValue(base),
		};
		const logger = new AuditLogger(makeConfig({maxSizeBytes: 1024, maxRetainedLogs: 3}), deps);

		await logger.log(makeEntry());
		await logger.flush();

		// Oldest file (base.3) is removed first
		expect(deps.remove).toHaveBeenCalledWith(`${base}.3`);

		// Shift: base.2 → base.3, then base.1 → base.2
		const renameCalls = deps.rename.mock.calls as [string, string][];
		expect(renameCalls[0]).toEqual([`${base}.2`, `${base}.3`]);
		expect(renameCalls[1]).toEqual([`${base}.1`, `${base}.2`]);

		// Current log is archived to base.1
		expect(renameCalls[2]).toEqual([base, `${base}.1`]);

		// Fresh log is created via an empty write before the entry write
		expect(deps.write).toHaveBeenCalledWith('');
	});

	it('does not call rotation deps when file size is within maxSizeBytes', async () => {
		const deps = makeDeps({size: 512});
		const logger = new AuditLogger(makeConfig({maxSizeBytes: 1024}), deps);

		await logger.log(makeEntry());
		await logger.flush();

		expect(deps.rename).not.toHaveBeenCalled();
		expect(deps.remove).not.toHaveBeenCalled();
		expect(deps.write).toHaveBeenCalledOnce();
	});

	it('does not call rotation deps when file size equals maxSizeBytes', async () => {
		const deps = makeDeps({size: 1024});
		const logger = new AuditLogger(makeConfig({maxSizeBytes: 1024}), deps);

		await logger.log(makeEntry());
		await logger.flush();

		expect(deps.rename).not.toHaveBeenCalled();
		expect(deps.remove).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// updateConfig()
// ---------------------------------------------------------------------------

describe('AuditLogger.updateConfig()', () => {
	it('disabling via updateConfig causes subsequent log() to be no-op', async () => {
		const deps = makeDeps();
		const logger = new AuditLogger(makeConfig({enabled: true}), deps);

		logger.updateConfig(makeConfig({enabled: false}));
		await logger.log(makeEntry());
		await logger.flush();

		expect(deps.write).not.toHaveBeenCalled();
	});

	it('re-enabling via updateConfig causes subsequent log() to write', async () => {
		const deps = makeDeps();
		const logger = new AuditLogger(makeConfig({enabled: false}), deps);

		logger.updateConfig(makeConfig({enabled: true}));
		await logger.log(makeEntry());
		await logger.flush();

		expect(deps.write).toHaveBeenCalledOnce();
	});
});

// ---------------------------------------------------------------------------
// Buffered flush (H5) — log() buffers, flush() drains
// ---------------------------------------------------------------------------

describe('AuditLogger — buffered flush (H5)', () => {
	it('batches rapid log() calls into a single write via flush()', async () => {
		const deps = makeDeps();
		const logger = new AuditLogger(makeConfig(), deps);

		for (let i = 0; i < 10; i++) {
			await logger.log(makeEntry({apiKeyId: `kado_${i}`}));
		}

		// Before flush: no writes yet (buffered)
		expect(deps.write).not.toHaveBeenCalled();

		await logger.flush();

		// After flush: exactly one write with all 10 lines joined
		expect(deps.write).toHaveBeenCalledOnce();
		const [batched] = deps.write.mock.calls[0] as [string];
		const lines = batched.split('\n').filter(Boolean);
		expect(lines).toHaveLength(10);
	});

	it('flush() is idempotent when buffer is empty', async () => {
		const deps = makeDeps();
		const logger = new AuditLogger(makeConfig(), deps);

		await logger.flush();
		await logger.flush();

		expect(deps.write).not.toHaveBeenCalled();
	});

	it('flush() on empty buffer does not schedule rotation', async () => {
		const deps = makeDeps({size: 999_999});
		const logger = new AuditLogger(makeConfig({maxSizeBytes: 1024}), deps);

		await logger.flush();

		expect(deps.rename).not.toHaveBeenCalled();
		expect(deps.remove).not.toHaveBeenCalled();
	});

	it('automatically flushes after 500ms timer fires', async () => {
		vi.useFakeTimers();
		try {
			const deps = makeDeps();
			const logger = new AuditLogger(makeConfig(), deps);

			await logger.log(makeEntry());
			expect(deps.write).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(500);

			expect(deps.write).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it('retries failed entries on the next flush', async () => {
		const deps = makeDeps();
		// First write fails, second succeeds
		deps.write
			.mockRejectedValueOnce(new Error('disk full'))
			.mockResolvedValueOnce(undefined);
		const logger = new AuditLogger(makeConfig(), deps);

		await logger.log(makeEntry({apiKeyId: 'kado_first'}));
		await logger.flush(); // fails, entries retained

		await logger.log(makeEntry({apiKeyId: 'kado_second'}));
		await logger.flush(); // retries first + second

		// Second flush call carries both entries (retry-prepended)
		const lastCall = deps.write.mock.calls[1] as [string];
		const lines = (lastCall[0] ?? '').split('\n').filter(Boolean);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain('kado_first');
		expect(lines[1]).toContain('kado_second');
	});

	it('updateConfig({enabled:false}) flushes pending entries before disabling', async () => {
		const deps = makeDeps();
		const logger = new AuditLogger(makeConfig({enabled: true}), deps);

		await logger.log(makeEntry());
		expect(deps.write).not.toHaveBeenCalled();

		logger.updateConfig(makeConfig({enabled: false}));
		// updateConfig must synchronously or immediately flush; support async flush
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(deps.write).toHaveBeenCalledOnce();
	});

	it('rotation runs once per flush, not once per log call', async () => {
		const deps = makeDeps({size: 2048});
		const logger = new AuditLogger(makeConfig({maxSizeBytes: 1024}), deps);

		for (let i = 0; i < 5; i++) {
			await logger.log(makeEntry());
		}
		await logger.flush();

		// getSize should be called once (the flush rotation check), not 5 times
		expect(deps.getSize).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// createAuditEntry() factory
// ---------------------------------------------------------------------------

describe('createAuditEntry() factory', () => {
	it('produces an entry with all required fields', () => {
		const entry = createAuditEntry({
			apiKeyId: 'kado_abc',
			operation: 'write',
			decision: 'allowed',
		});

		expect(typeof entry.timestamp).toBe('string');
		expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
		expect(entry.apiKeyId).toBe('kado_abc');
		expect(entry.operation).toBe('write');
		expect(entry.decision).toBe('allowed');
	});

	it('includes optional fields when provided', () => {
		const entry = createAuditEntry({
			apiKeyId: 'kado_abc',
			operation: 'read',
			decision: 'denied',
			dataType: 'note',
			path: 'notes/test.md',
			gate: 'path-access',
			durationMs: 42,
		});

		expect(entry.dataType).toBe('note');
		expect(entry.path).toBe('notes/test.md');
		expect(entry.gate).toBe('path-access');
		expect(entry.durationMs).toBe(42);
	});

	it('omits optional fields not provided', () => {
		const entry = createAuditEntry({
			apiKeyId: 'kado_abc',
			operation: 'read',
			decision: 'allowed',
		});

		expect(entry.dataType).toBeUndefined();
		expect(entry.path).toBeUndefined();
		expect(entry.gate).toBeUndefined();
		expect(entry.durationMs).toBeUndefined();
	});
});
