/**
 * Behavioral tests for gateOpenNoteScope.
 *
 * Covers every row of the decision matrix from spec 006-open-notes-tool phase-1
 * T1.3, plus purity, error-code, error-message, and gate-name assertions.
 */

import {describe, it, expect} from 'vitest';
import {gateOpenNoteScope} from '../../../src/core/gates/open-notes-gate';
import type {SecurityConfig, ApiKeyConfig} from '../../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeGlobal(overrides?: Partial<SecurityConfig>): SecurityConfig {
	return {
		listMode: 'whitelist',
		paths: [],
		tags: [],
		allowActiveNote: false,
		allowOtherNotes: false,
		...overrides,
	};
}

function makeKey(overrides?: Partial<ApiKeyConfig>): ApiKeyConfig {
	return {
		id: 'kado_test-key',
		label: 'Test Key',
		enabled: true,
		createdAt: 1700000000000,
		listMode: 'whitelist',
		paths: [],
		tags: [],
		allowActiveNote: false,
		allowOtherNotes: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Decision matrix — all seven rows
// ---------------------------------------------------------------------------

describe('gateOpenNoteScope — decision matrix', () => {
	// Row 1: scope=active, global.active=true, key.active=true → allow-active-only
	it('scope=active, both active flags on → allow-active-only', () => {
		const result = gateOpenNoteScope(
			'active',
			makeGlobal({allowActiveNote: true}),
			makeKey({allowActiveNote: true}),
		);
		expect(result.kind).toBe('allow-active-only');
	});

	// Row 2: scope=active, global.active=false, key.active=true → deny
	it('scope=active, global.active=false, key.active=true → deny', () => {
		const result = gateOpenNoteScope(
			'active',
			makeGlobal({allowActiveNote: false}),
			makeKey({allowActiveNote: true}),
		);
		expect(result.kind).toBe('deny');
		if (result.kind === 'deny') {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('feature-gate');
			expect(result.error.message).toContain('global');
			expect(result.error.message).toContain('allowActiveNote');
		}
	});

	// Row 3: scope=active, global.active=true, key.active=false → deny
	it('scope=active, global.active=true, key.active=false → deny', () => {
		const result = gateOpenNoteScope(
			'active',
			makeGlobal({allowActiveNote: true}),
			makeKey({allowActiveNote: false}),
		);
		expect(result.kind).toBe('deny');
		if (result.kind === 'deny') {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('feature-gate');
			expect(result.error.message).toContain('key');
			expect(result.error.message).toContain('allowActiveNote');
		}
	});

	// Row 4: scope=all, global.active=true, key.active=true, global.other=false, key.other=false
	//        → allow-active-only (silent filter of other)
	it('scope=all, active both on, other both off → allow-active-only', () => {
		const result = gateOpenNoteScope(
			'all',
			makeGlobal({allowActiveNote: true, allowOtherNotes: false}),
			makeKey({allowActiveNote: true, allowOtherNotes: false}),
		);
		expect(result.kind).toBe('allow-active-only');
	});

	// Row 5: scope=all, global.active=false, key.active=false, global.other=true, key.other=true
	//        → allow-other-only (silent filter of active)
	it('scope=all, active both off, other both on → allow-other-only', () => {
		const result = gateOpenNoteScope(
			'all',
			makeGlobal({allowActiveNote: false, allowOtherNotes: true}),
			makeKey({allowActiveNote: false, allowOtherNotes: true}),
		);
		expect(result.kind).toBe('allow-other-only');
	});

	// Row 6: scope=all, all flags false → deny
	it('scope=all, all flags off → deny (FORBIDDEN)', () => {
		const result = gateOpenNoteScope(
			'all',
			makeGlobal({allowActiveNote: false, allowOtherNotes: false}),
			makeKey({allowActiveNote: false, allowOtherNotes: false}),
		);
		expect(result.kind).toBe('deny');
		if (result.kind === 'deny') {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('feature-gate');
		}
	});

	// Row 7: scope=all, both active and other on → allow-both
	it('scope=all, all flags on → allow-both', () => {
		const result = gateOpenNoteScope(
			'all',
			makeGlobal({allowActiveNote: true, allowOtherNotes: true}),
			makeKey({allowActiveNote: true, allowOtherNotes: true}),
		);
		expect(result.kind).toBe('allow-both');
	});
});

// ---------------------------------------------------------------------------
// scope=other cases (analogous to scope=active)
// ---------------------------------------------------------------------------

describe('gateOpenNoteScope — scope=other', () => {
	it('scope=other, both other flags on → allow-other-only', () => {
		const result = gateOpenNoteScope(
			'other',
			makeGlobal({allowOtherNotes: true}),
			makeKey({allowOtherNotes: true}),
		);
		expect(result.kind).toBe('allow-other-only');
	});

	it('scope=other, global.other=false → deny with global in message', () => {
		const result = gateOpenNoteScope(
			'other',
			makeGlobal({allowOtherNotes: false}),
			makeKey({allowOtherNotes: true}),
		);
		expect(result.kind).toBe('deny');
		if (result.kind === 'deny') {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('feature-gate');
			expect(result.error.message).toContain('global');
			expect(result.error.message).toContain('allowOtherNotes');
		}
	});

	it('scope=other, key.other=false → deny with key in message', () => {
		const result = gateOpenNoteScope(
			'other',
			makeGlobal({allowOtherNotes: true}),
			makeKey({allowOtherNotes: false}),
		);
		expect(result.kind).toBe('deny');
		if (result.kind === 'deny') {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('feature-gate');
			expect(result.error.message).toContain('key');
			expect(result.error.message).toContain('allowOtherNotes');
		}
	});
});

// ---------------------------------------------------------------------------
// Error structure assertions
// ---------------------------------------------------------------------------

describe('gateOpenNoteScope — error structure', () => {
	it('denial uses code FORBIDDEN and gate feature-gate', () => {
		const result = gateOpenNoteScope('active', makeGlobal(), makeKey());
		expect(result.kind).toBe('deny');
		if (result.kind === 'deny') {
			expect(result.error.code).toBe('FORBIDDEN');
			expect(result.error.gate).toBe('feature-gate');
			expect(typeof result.error.message).toBe('string');
			expect(result.error.message.length).toBeGreaterThan(0);
		}
	});

	it('error message names the off flag for scope=active with global off', () => {
		const result = gateOpenNoteScope(
			'active',
			makeGlobal({allowActiveNote: false}),
			makeKey({allowActiveNote: true}),
		);
		if (result.kind === 'deny') {
			expect(result.error.message).toMatch(/global.*allowActiveNote|allowActiveNote.*global/i);
		}
	});

	it('error message names the off flag for scope=active with key off', () => {
		const result = gateOpenNoteScope(
			'active',
			makeGlobal({allowActiveNote: true}),
			makeKey({allowActiveNote: false}),
		);
		if (result.kind === 'deny') {
			expect(result.error.message).toMatch(/key.*allowActiveNote|allowActiveNote.*key/i);
		}
	});
});

// ---------------------------------------------------------------------------
// Purity — repeated calls with same input yield identical outputs
// ---------------------------------------------------------------------------

describe('gateOpenNoteScope — purity', () => {
	it('returns identical result for repeated calls with same input', () => {
		const global = makeGlobal({allowActiveNote: true, allowOtherNotes: true});
		const key = makeKey({allowActiveNote: true, allowOtherNotes: true});

		const first = gateOpenNoteScope('all', global, key);
		const second = gateOpenNoteScope('all', global, key);
		const third = gateOpenNoteScope('all', global, key);

		expect(first).toEqual(second);
		expect(second).toEqual(third);
	});

	it('does not mutate the global config input', () => {
		const global = makeGlobal({allowActiveNote: false});
		const key = makeKey({allowActiveNote: false});
		const originalGlobal = {...global};

		gateOpenNoteScope('active', global, key);

		expect(global).toEqual(originalGlobal);
	});

	it('does not mutate the key config input', () => {
		const global = makeGlobal({allowActiveNote: false});
		const key = makeKey({allowActiveNote: false});
		const originalKey = {...key};

		gateOpenNoteScope('active', global, key);

		expect(key).toEqual(originalKey);
	});
});

// ---------------------------------------------------------------------------
// Undefined tolerance — optional fields default to false (AND with undefined = false)
// ---------------------------------------------------------------------------

describe('gateOpenNoteScope — undefined tolerance', () => {
	it('treats undefined allowActiveNote on global as false → deny', () => {
		const global: SecurityConfig = {listMode: 'whitelist', paths: [], tags: []};
		const key = makeKey({allowActiveNote: true});

		const result = gateOpenNoteScope('active', global, key);

		expect(result.kind).toBe('deny');
	});

	it('treats undefined allowActiveNote on key as false → deny', () => {
		const global = makeGlobal({allowActiveNote: true});
		const key: ApiKeyConfig = {
			id: 'kado_test-key',
			label: 'Test Key',
			enabled: true,
			createdAt: 1700000000000,
			listMode: 'whitelist',
			paths: [],
			tags: [],
		};

		const result = gateOpenNoteScope('active', global, key);

		expect(result.kind).toBe('deny');
	});
});
