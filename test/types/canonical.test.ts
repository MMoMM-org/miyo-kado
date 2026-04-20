/**
 * Tests for canonical type definitions.
 * Verifies that factory functions produce valid instances and type guards
 * correctly discriminate between request variants.
 */

import {describe, it, expect} from 'vitest';
import {
	createDefaultConfig,
	createDefaultCrudFlags,
	createDefaultPermissions,
	createDefaultSecurityConfig,
	isCoreReadRequest,
	isCoreWriteRequest,
	isCoreSearchRequest,
	isCoreOpenNotesRequest,
	type CoreReadRequest,
	type CoreWriteRequest,
	type CoreSearchRequest,
	type CoreOpenNotesRequest,
	type CoreFileResult,
	type CoreWriteResult,
	type CoreSearchResult,
	type CoreSearchItem,
	type CoreError,
	type GateResult,
	type KadoConfig,
	type CrudFlags,
	type DataTypePermissions,
	type OpenNotesScope,
	type OpenNoteType,
	type OpenNoteDescriptor,
	type CoreOpenNotesResult,
} from '../../src/types/canonical';

// --- Factory helpers ---

const makeReadRequest = (overrides?: Partial<CoreReadRequest>): CoreReadRequest => ({
	apiKeyId: 'kado_abc123',
	operation: 'note',
	path: 'notes/test.md',
	...overrides,
});

const makeWriteRequest = (overrides?: Partial<CoreWriteRequest>): CoreWriteRequest => ({
	apiKeyId: 'kado_abc123',
	operation: 'note',
	path: 'notes/test.md',
	content: '# Hello',
	...overrides,
});

const makeSearchRequest = (overrides?: Partial<CoreSearchRequest>): CoreSearchRequest => ({
	apiKeyId: 'kado_abc123',
	operation: 'byTag',
	...overrides,
});

// --- CrudFlags ---

describe('createDefaultCrudFlags', () => {
	it('returns all flags as false', () => {
		const flags: CrudFlags = createDefaultCrudFlags();
		expect(flags.create).toBe(false);
		expect(flags.read).toBe(false);
		expect(flags.update).toBe(false);
		expect(flags.delete).toBe(false);
	});

	it('produces an independent object on each call', () => {
		const a = createDefaultCrudFlags();
		const b = createDefaultCrudFlags();
		a.create = true;
		expect(b.create).toBe(false);
	});
});

// --- DataTypePermissions ---

describe('createDefaultPermissions', () => {
	it('returns permissions for all four data types', () => {
		const perms: DataTypePermissions = createDefaultPermissions();
		expect(perms).toHaveProperty('note');
		expect(perms).toHaveProperty('frontmatter');
		expect(perms).toHaveProperty('file');
		expect(perms).toHaveProperty('dataviewInlineField');
	});

	it('sets all CRUD flags to false for every data type', () => {
		const perms = createDefaultPermissions();
		const dataTypes: Array<keyof DataTypePermissions> = ['note', 'frontmatter', 'file', 'dataviewInlineField'];
		for (const dt of dataTypes) {
			expect(perms[dt].create).toBe(false);
			expect(perms[dt].read).toBe(false);
			expect(perms[dt].update).toBe(false);
			expect(perms[dt].delete).toBe(false);
		}
	});
});

// --- KadoConfig ---

describe('createDefaultConfig', () => {
	it('returns a KadoConfig with correct server defaults', () => {
		const config: KadoConfig = createDefaultConfig();
		expect(config.server.enabled).toBe(false);
		expect(config.server.host).toBe('127.0.0.1');
		expect(config.server.port).toBe(23026);
	});

	it('returns a security config with empty paths and tags, and empty apiKeys array', () => {
		const config = createDefaultConfig();
		expect(config.security.listMode).toBe('whitelist');
		expect(config.security.paths).toEqual([]);
		expect(config.security.tags).toEqual([]);
		expect(config.apiKeys).toEqual([]);
	});

	it('returns audit config with enabled true and correct defaults', () => {
		const config = createDefaultConfig();
		expect(config.audit.enabled).toBe(true);
		expect(config.audit.logDirectory).toBe('logs');
		expect(config.audit.logFileName).toBe('kado-audit.log');
		expect(config.audit.maxSizeBytes).toBe(10 * 1024 * 1024);
		expect(config.audit.maxRetainedLogs).toBe(3);
	});

	it('returns debugLogging disabled by default (Obsidian guideline)', () => {
		const config = createDefaultConfig();
		expect(config.debugLogging).toBe(false);
	});

	it('produces independent objects on each call', () => {
		const a = createDefaultConfig();
		const b = createDefaultConfig();
		a.apiKeys.push({id: 'x', label: 'x', enabled: true, createdAt: 0, listMode: 'whitelist', paths: [], tags: []});
		expect(b.apiKeys).toHaveLength(0);
	});
});

// --- Type guards ---

describe('isCoreReadRequest', () => {
	it('returns true for a CoreReadRequest', () => {
		expect(isCoreReadRequest(makeReadRequest())).toBe(true);
	});

	it('returns false for a CoreWriteRequest', () => {
		expect(isCoreReadRequest(makeWriteRequest())).toBe(false);
	});

	it('returns false for a CoreSearchRequest', () => {
		expect(isCoreReadRequest(makeSearchRequest())).toBe(false);
	});
});

describe('isCoreWriteRequest', () => {
	it('returns true for a CoreWriteRequest', () => {
		expect(isCoreWriteRequest(makeWriteRequest())).toBe(true);
	});

	it('returns false for a CoreReadRequest', () => {
		expect(isCoreWriteRequest(makeReadRequest())).toBe(false);
	});

	it('returns false for a CoreSearchRequest', () => {
		expect(isCoreWriteRequest(makeSearchRequest())).toBe(false);
	});
});

describe('isCoreSearchRequest', () => {
	it('returns true for a CoreSearchRequest', () => {
		expect(isCoreSearchRequest(makeSearchRequest())).toBe(true);
	});

	it('returns false for a CoreReadRequest', () => {
		expect(isCoreSearchRequest(makeReadRequest())).toBe(false);
	});

	it('returns false for a CoreWriteRequest', () => {
		expect(isCoreSearchRequest(makeWriteRequest())).toBe(false);
	});
});

// --- Structural shape tests (compile-time behavior at runtime) ---

describe('CoreReadRequest shape', () => {
	it('accepts all valid DataType values for operation', () => {
		const dataTypes: CoreReadRequest['operation'][] = [
			'note', 'frontmatter', 'file', 'dataview-inline-field',
		];
		for (const op of dataTypes) {
			const req = makeReadRequest({operation: op});
			expect(req.operation).toBe(op);
		}
	});
});

describe('CoreWriteRequest shape', () => {
	it('accepts string content', () => {
		const req = makeWriteRequest({content: '# Note'});
		expect(req.content).toBe('# Note');
	});

	it('accepts object content for frontmatter', () => {
		const req = makeWriteRequest({content: {title: 'Test'}});
		expect(req.content).toEqual({title: 'Test'});
	});

	it('accepts expectedModified for optimistic concurrency', () => {
		const req = makeWriteRequest({expectedModified: 1700000000000});
		expect(req.expectedModified).toBe(1700000000000);
	});

	it('allows omitting expectedModified for creates', () => {
		const req = makeWriteRequest();
		expect(req.expectedModified).toBeUndefined();
	});
});

describe('CoreSearchRequest shape', () => {
	it('accepts all valid SearchOperation values', () => {
		const ops: CoreSearchRequest['operation'][] = ['byTag', 'byName', 'listDir', 'listTags', 'byContent', 'byFrontmatter'];
		for (const op of ops) {
			const req = makeSearchRequest({operation: op});
			expect(req.operation).toBe(op);
		}
	});

	it('allows optional fields to be absent', () => {
		const req = makeSearchRequest();
		expect(req.query).toBeUndefined();
		expect(req.path).toBeUndefined();
		expect(req.cursor).toBeUndefined();
		expect(req.limit).toBeUndefined();
	});
});

describe('CoreFileResult shape', () => {
	it('has required fields', () => {
		const result: CoreFileResult = {
			path: 'notes/test.md',
			content: '# Hello',
			created: 1700000000000,
			modified: 1700000001000,
			size: 100,
		};
		expect(result.path).toBe('notes/test.md');
		expect(result.size).toBe(100);
	});
});

describe('CoreWriteResult shape', () => {
	it('has required fields', () => {
		const result: CoreWriteResult = {
			path: 'notes/test.md',
			created: 1700000000000,
			modified: 1700000001000,
		};
		expect(result.path).toBe('notes/test.md');
	});
});

describe('CoreSearchResult shape', () => {
	it('can have items without cursor or total', () => {
		const item: CoreSearchItem = {
			path: 'notes/test.md',
			name: 'test.md',
			created: 1700000000000,
			modified: 1700000001000,
			size: 100,
		};
		const result: CoreSearchResult = {items: [item]};
		expect(result.items).toHaveLength(1);
		expect(result.cursor).toBeUndefined();
		expect(result.total).toBeUndefined();
	});
});

describe('CoreError shape', () => {
	it('supports all error codes', () => {
		const codes: CoreError['code'][] = [
			'UNAUTHORIZED',
			'FORBIDDEN',
			'NOT_FOUND',
			'CONFLICT',
			'VALIDATION_ERROR',
			'INTERNAL_ERROR',
		];
		for (const code of codes) {
			const err: CoreError = {code, message: 'test error'};
			expect(err.code).toBe(code);
		}
	});

	it('allows optional gate field for FORBIDDEN errors', () => {
		const err: CoreError = {code: 'FORBIDDEN', message: 'denied', gate: 'GlobalScopeGate'};
		expect(err.gate).toBe('GlobalScopeGate');
	});
});

describe('GateResult shape', () => {
	it('represents an allowed result', () => {
		const result: GateResult = {allowed: true};
		expect(result.allowed).toBe(true);
	});

	it('represents a denied result with error', () => {
		const result: GateResult = {
			allowed: false,
			error: {code: 'FORBIDDEN', message: 'Access denied', gate: 'KeyScopeGate'},
		};
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.code).toBe('FORBIDDEN');
		}
	});
});

// ============================================================
// Open Notes — T1.1
// ============================================================

describe('createDefaultSecurityConfig — open notes flags', () => {
	it('defaults allowActiveNote to false', () => {
		const config = createDefaultSecurityConfig();
		expect(config.allowActiveNote).toBe(false);
	});

	it('defaults allowOtherNotes to false', () => {
		const config = createDefaultSecurityConfig();
		expect(config.allowOtherNotes).toBe(false);
	});

	it('produces independent objects on each call', () => {
		const a = createDefaultSecurityConfig();
		const b = createDefaultSecurityConfig();
		a.allowActiveNote = true;
		expect(b.allowActiveNote).toBe(false);
	});
});

describe('createDefaultConfig — open notes flags on security', () => {
	it('security.allowActiveNote defaults to false', () => {
		const config = createDefaultConfig();
		expect(config.security.allowActiveNote).toBe(false);
	});

	it('security.allowOtherNotes defaults to false', () => {
		const config = createDefaultConfig();
		expect(config.security.allowOtherNotes).toBe(false);
	});
});

describe('OpenNotesScope type', () => {
	it('accepts all valid scope values', () => {
		const scopes: OpenNotesScope[] = ['active', 'other', 'all'];
		expect(scopes).toHaveLength(3);
	});
});

describe('CoreOpenNotesRequest shape', () => {
	it('has kind discriminator set to openNotes', () => {
		const req: CoreOpenNotesRequest = {
			kind: 'openNotes',
			keyId: 'kado_abc123',
			scope: 'all',
		};
		expect(req.kind).toBe('openNotes');
	});

	it('accepts all valid scope values', () => {
		const scopes: OpenNotesScope[] = ['active', 'other', 'all'];
		for (const scope of scopes) {
			const req: CoreOpenNotesRequest = {kind: 'openNotes', keyId: 'k', scope};
			expect(req.scope).toBe(scope);
		}
	});
});

describe('OpenNoteDescriptor shape', () => {
	it('has all required fields', () => {
		const descriptor: OpenNoteDescriptor = {
			name: 'test.md',
			path: 'notes/test.md',
			active: true,
			type: 'markdown',
		};
		expect(descriptor.name).toBe('test.md');
		expect(descriptor.path).toBe('notes/test.md');
		expect(descriptor.active).toBe(true);
		expect(descriptor.type).toBe('markdown');
	});

	it('accepts all known OpenNoteType values', () => {
		const types: OpenNoteType[] = ['markdown', 'canvas', 'pdf', 'image', 'unknown-type'];
		for (const type of types) {
			const descriptor: OpenNoteDescriptor = {name: 'f', path: 'f', active: false, type};
			expect(descriptor.type).toBe(type);
		}
	});
});

describe('CoreOpenNotesResult shape', () => {
	it('has a notes array', () => {
		const result: CoreOpenNotesResult = {notes: []};
		expect(result.notes).toHaveLength(0);
	});

	it('holds OpenNoteDescriptor entries', () => {
		const note: OpenNoteDescriptor = {name: 'a.md', path: 'a.md', active: false, type: 'markdown'};
		const result: CoreOpenNotesResult = {notes: [note]};
		expect(result.notes[0]?.name).toBe('a.md');
	});
});

describe('isCoreOpenNotesRequest', () => {
	it('returns true for a CoreOpenNotesRequest', () => {
		const req: CoreOpenNotesRequest = {kind: 'openNotes', keyId: 'k', scope: 'all'};
		expect(isCoreOpenNotesRequest(req)).toBe(true);
	});

	it('returns false for a CoreDeleteRequest (kind: delete)', () => {
		const req = {kind: 'delete', apiKeyId: 'k', operation: 'note' as const, path: 'p', expectedModified: 0};
		expect(isCoreOpenNotesRequest(req)).toBe(false);
	});

	it('returns false for a CoreReadRequest (no kind)', () => {
		const req: CoreReadRequest = {apiKeyId: 'k', operation: 'note', path: 'p'};
		expect(isCoreOpenNotesRequest(req as unknown as CoreOpenNotesRequest)).toBe(false);
	});
});
