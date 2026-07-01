/**
 * Behavioral tests for config import/export (#84).
 *
 * exportConfig builds a versioned envelope (full backup, INCLUDING key secrets).
 * parseImport validates the envelope and normalizes the payload, returning a
 * summary. applyImport selectively overlays chosen sections (general / security /
 * specific keys) onto the current config — pure, returning a new config.
 */

import {describe, it, expect} from 'vitest';
import {
	exportConfig,
	parseImport,
	applyImport,
	EXPORT_FORMAT,
	EXPORT_VERSION,
} from '../../src/core/config-portability';
import {createDefaultConfig, createDefaultApiKeyConfig} from '../../src/types/canonical';
import {createAllPermissions} from '../../src/core/gates/scope-resolver';
import type {KadoConfig} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function sampleConfig(): KadoConfig {
	const c = createDefaultConfig();
	c.server.port = 12345;
	c.security.listMode = 'whitelist';
	c.security.paths = [{path: 'Atlas', permissions: createAllPermissions()}];
	c.security.tags = ['project'];
	c.apiKeys = [
		createDefaultApiKeyConfig({id: 'kado_aaa', label: 'Assistant A', enabled: true}),
		createDefaultApiKeyConfig({id: 'kado_bbb', label: 'Assistant B', enabled: false}),
	];
	return c;
}

// ---------------------------------------------------------------------------
// exportConfig
// ---------------------------------------------------------------------------

describe('exportConfig', () => {
	it('wraps the config in a versioned envelope', () => {
		const env = exportConfig(sampleConfig(), 1_700_000_000_000);
		expect(env.format).toBe(EXPORT_FORMAT);
		expect(env.version).toBe(EXPORT_VERSION);
		expect(env.exportedAt).toBe(1_700_000_000_000);
	});

	it('includes API key secrets (full backup)', () => {
		const env = exportConfig(sampleConfig(), 0);
		expect(env.config.apiKeys.map((k) => k.id)).toEqual(['kado_aaa', 'kado_bbb']);
	});

	it('deep-clones so later mutation of the source does not affect the export', () => {
		const cfg = sampleConfig();
		const env = exportConfig(cfg, 0);
		cfg.server.port = 99999;
		cfg.apiKeys[0]!.label = 'mutated';
		expect(env.config.server.port).toBe(12345);
		expect(env.config.apiKeys[0]!.label).toBe('Assistant A');
	});

	it('round-trips through JSON', () => {
		const env = exportConfig(sampleConfig(), 0);
		const raw = JSON.parse(JSON.stringify(env));
		const parsed = parseImport(raw);
		expect(parsed.ok).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// parseImport — validation
// ---------------------------------------------------------------------------

describe('parseImport — validation', () => {
	it('rejects a non-object', () => {
		expect(parseImport('nope').ok).toBe(false);
		expect(parseImport(null).ok).toBe(false);
	});

	it('rejects a payload without the kado-config format marker', () => {
		const res = parseImport({version: 1, config: {}});
		expect(res.ok).toBe(false);
	});

	it('rejects a payload with no config object', () => {
		const res = parseImport({format: EXPORT_FORMAT, version: 1});
		expect(res.ok).toBe(false);
	});

	it('rejects a version newer than supported', () => {
		const res = parseImport({format: EXPORT_FORMAT, version: EXPORT_VERSION + 1, config: {}});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toMatch(/newer/i);
	});

	it('accepts a valid export and normalizes the config (fills defaults)', () => {
		const res = parseImport({format: EXPORT_FORMAT, version: 1, config: {server: {port: 5000}}});
		expect(res.ok).toBe(true);
		if (res.ok) {
			// missing fields filled by normalizeConfig
			expect(res.config.security.listMode).toBe('whitelist');
			expect(res.config.audit.enabled).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// parseImport — summary
// ---------------------------------------------------------------------------

describe('parseImport — summary', () => {
	it('summarizes security and keys for the confirmation UI', () => {
		const env = exportConfig(sampleConfig(), 42);
		const res = parseImport(JSON.parse(JSON.stringify(env)));
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.summary.exportedAt).toBe(42);
			expect(res.summary.security).toEqual({listMode: 'whitelist', paths: 1, tags: 1});
			expect(res.summary.keys).toEqual([
				{id: 'kado_aaa', label: 'Assistant A', enabled: true},
				{id: 'kado_bbb', label: 'Assistant B', enabled: false},
			]);
		}
	});
});

// ---------------------------------------------------------------------------
// applyImport — selective overlay
// ---------------------------------------------------------------------------

describe('applyImport', () => {
	function incoming(): KadoConfig {
		const c = sampleConfig();
		c.server.port = 55555;
		c.audit.enabled = false;
		return c;
	}

	it('applies only general settings when only general is selected', () => {
		const current = createDefaultConfig();
		const {config, changes} = applyImport(current, incoming(), {general: true, security: false, keyIds: []});
		expect(config.server.port).toBe(55555);
		expect(config.audit.enabled).toBe(false);
		// security + keys untouched
		expect(config.security.paths).toHaveLength(0);
		expect(config.apiKeys).toHaveLength(0);
		expect(changes.general).toBe(true);
		expect(changes.security).toBe(false);
	});

	it('applies only global security when only security is selected', () => {
		const current = createDefaultConfig();
		const {config, changes} = applyImport(current, incoming(), {general: false, security: true, keyIds: []});
		expect(config.security.paths).toHaveLength(1);
		expect(config.security.tags).toEqual(['project']);
		// general untouched (default port)
		expect(config.server.port).toBe(createDefaultConfig().server.port);
		expect(changes.security).toBe(true);
	});

	it('adds a selected key that does not exist yet', () => {
		const current = createDefaultConfig();
		const {config, changes} = applyImport(current, incoming(), {general: false, security: false, keyIds: ['kado_aaa']});
		expect(config.apiKeys.map((k) => k.id)).toEqual(['kado_aaa']);
		expect(changes.keysAdded).toBe(1);
		expect(changes.keysReplaced).toBe(0);
	});

	it('replaces an existing key with the same id', () => {
		const current = createDefaultConfig();
		current.apiKeys = [createDefaultApiKeyConfig({id: 'kado_aaa', label: 'OLD'})];
		const {config, changes} = applyImport(current, incoming(), {general: false, security: false, keyIds: ['kado_aaa']});
		expect(config.apiKeys).toHaveLength(1);
		expect(config.apiKeys[0]!.label).toBe('Assistant A');
		expect(changes.keysReplaced).toBe(1);
		expect(changes.keysAdded).toBe(0);
	});

	it('ignores selected key ids not present in the import', () => {
		const current = createDefaultConfig();
		const {config, changes} = applyImport(current, incoming(), {general: false, security: false, keyIds: ['kado_zzz']});
		expect(config.apiKeys).toHaveLength(0);
		expect(changes.keysAdded).toBe(0);
	});

	it('does not mutate the current config (returns a new object)', () => {
		const current = createDefaultConfig();
		const before = JSON.stringify(current);
		applyImport(current, incoming(), {general: true, security: true, keyIds: ['kado_aaa']});
		expect(JSON.stringify(current)).toBe(before);
	});

	it('applies everything when all sections are selected', () => {
		const current = createDefaultConfig();
		const {config} = applyImport(current, incoming(), {general: true, security: true, keyIds: ['kado_aaa', 'kado_bbb']});
		expect(config.server.port).toBe(55555);
		expect(config.security.paths).toHaveLength(1);
		expect(config.apiKeys).toHaveLength(2);
	});
});
