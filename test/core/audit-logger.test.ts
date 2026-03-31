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
		timestamp: 1700000000000,
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

		expect(deps.write).not.toHaveBeenCalled();
	});

	it('does not call getSize when enabled is false', async () => {
		const deps = makeDeps();
		const logger = new AuditLogger(makeConfig({enabled: false}), deps);

		await logger.log(makeEntry());

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

		// Rotation should have been triggered (getLogPath called, exists checked)
		expect(deps.getLogPath).toHaveBeenCalled();
		expect(deps.exists).toHaveBeenCalled();
		// write is called at least once (rotation empty write + entry write)
		expect(deps.write).toHaveBeenCalled();
	});

	it('does not call rotation deps when file size is within maxSizeBytes', async () => {
		const deps = makeDeps({size: 512});
		const logger = new AuditLogger(makeConfig({maxSizeBytes: 1024}), deps);

		await logger.log(makeEntry());

		expect(deps.rename).not.toHaveBeenCalled();
		expect(deps.remove).not.toHaveBeenCalled();
		expect(deps.write).toHaveBeenCalledOnce();
	});

	it('does not call rotation deps when file size equals maxSizeBytes', async () => {
		const deps = makeDeps({size: 1024});
		const logger = new AuditLogger(makeConfig({maxSizeBytes: 1024}), deps);

		await logger.log(makeEntry());

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

		expect(deps.write).not.toHaveBeenCalled();
	});

	it('re-enabling via updateConfig causes subsequent log() to write', async () => {
		const deps = makeDeps();
		const logger = new AuditLogger(makeConfig({enabled: false}), deps);

		logger.updateConfig(makeConfig({enabled: true}));
		await logger.log(makeEntry());

		expect(deps.write).toHaveBeenCalledOnce();
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

		expect(typeof entry.timestamp).toBe('number');
		expect(entry.timestamp).toBeGreaterThan(0);
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
