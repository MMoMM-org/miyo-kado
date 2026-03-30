/**
 * Behavioral tests for ConfigManager.
 *
 * Tests cover: default config shape, merging stored data with defaults,
 * null/undefined load inputs, save callback invocation, API key generation
 * (kado_ prefix + UUID format), key revocation, global area add/remove,
 * key lookup by ID, and round-trip save→load fidelity.
 */

import {describe, it, expect, vi} from 'vitest';
import {ConfigManager} from '../../src/core/config-manager';
import type {KadoConfig, GlobalArea, ApiKeyConfig} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeArea(overrides?: Partial<GlobalArea>): GlobalArea {
	return {
		id: 'area-1',
		label: 'Projects',
		pathPatterns: ['projects/**'],
		permissions: {
			note: {create: true, read: true, update: false, delete: false},
			frontmatter: {create: false, read: true, update: false, delete: false},
			file: {create: false, read: false, update: false, delete: false},
			dataviewInlineField: {create: false, read: false, update: false, delete: false},
		},
		...overrides,
	};
}

function makeConfigManager(stored?: unknown): {
	manager: ConfigManager;
	saveSpy: ReturnType<typeof vi.fn>;
} {
	const saveSpy = vi.fn(async (_data: KadoConfig) => {});
	const loadFn = vi.fn(async () => stored ?? null);
	const manager = new ConfigManager(loadFn, saveSpy);
	return {manager, saveSpy};
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

describe('ConfigManager default config', () => {
	it('returns a valid KadoConfig with empty areas and keys before load', () => {
		const {manager} = makeConfigManager();
		const config = manager.getConfig();
		expect(config.globalAreas).toEqual([]);
		expect(config.apiKeys).toEqual([]);
	});

	it('has server disabled by default', () => {
		const {manager} = makeConfigManager();
		expect(manager.getConfig().server.enabled).toBe(false);
	});

	it('has audit enabled by default', () => {
		const {manager} = makeConfigManager();
		expect(manager.getConfig().audit.enabled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// load()
// ---------------------------------------------------------------------------

describe('ConfigManager.load()', () => {
	it('merges stored partial data with defaults (missing fields receive defaults)', async () => {
		const {manager} = makeConfigManager({server: {enabled: true, host: '0.0.0.0', port: 9999}});
		await manager.load();
		const config = manager.getConfig();
		expect(config.server.enabled).toBe(true);
		expect(config.server.host).toBe('0.0.0.0');
		expect(config.server.port).toBe(9999);
		// Fields not in stored data still get defaults
		expect(config.globalAreas).toEqual([]);
		expect(config.audit.enabled).toBe(true);
	});

	it('returns defaults when stored data is null', async () => {
		const {manager} = makeConfigManager(null);
		await manager.load();
		const config = manager.getConfig();
		expect(config.server.enabled).toBe(false);
		expect(config.globalAreas).toEqual([]);
		expect(config.apiKeys).toEqual([]);
	});

	it('returns defaults when stored data is undefined', async () => {
		const saveSpy = vi.fn(async (_data: KadoConfig) => {});
		const loadFn = vi.fn(async () => undefined);
		const manager = new ConfigManager(loadFn, saveSpy);
		await manager.load();
		const config = manager.getConfig();
		expect(config.server.enabled).toBe(false);
		expect(config.globalAreas).toEqual([]);
	});

	it('preserves stored apiKeys array through merge', async () => {
		const storedKey: ApiKeyConfig = {
			id: 'kado_abc-def',
			label: 'Test Key',
			enabled: true,
			createdAt: 1700000000000,
			areas: [],
		};
		const {manager} = makeConfigManager({apiKeys: [storedKey], globalAreas: []});
		await manager.load();
		const config = manager.getConfig();
		expect(config.apiKeys).toHaveLength(1);
		expect(config.apiKeys[0]?.id).toBe('kado_abc-def');
	});
});

// ---------------------------------------------------------------------------
// save()
// ---------------------------------------------------------------------------

describe('ConfigManager.save()', () => {
	it('calls the save callback with the current config', async () => {
		const {manager, saveSpy} = makeConfigManager();
		await manager.save();
		expect(saveSpy).toHaveBeenCalledOnce();
		expect(saveSpy).toHaveBeenCalledWith(manager.getConfig());
	});

	it('passes the updated config after mutation', async () => {
		const {manager, saveSpy} = makeConfigManager();
		manager.addGlobalArea(makeArea());
		await manager.save();
		expect(saveSpy).toHaveBeenCalledWith(
			expect.objectContaining({globalAreas: expect.arrayContaining([expect.objectContaining({id: 'area-1'})])}),
		);
	});
});

// ---------------------------------------------------------------------------
// generateApiKey()
// ---------------------------------------------------------------------------

describe('ConfigManager.generateApiKey()', () => {
	it('produces a key with kado_ prefix', () => {
		const {manager} = makeConfigManager();
		const key = manager.generateApiKey('My Client');
		expect(key.id).toMatch(/^kado_/);
	});

	it('produces a key with UUID format after the prefix', () => {
		const {manager} = makeConfigManager();
		const key = manager.generateApiKey('My Client');
		const uuidPart = key.id.replace(/^kado_/, '');
		expect(uuidPart).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
	});

	it('sets label to the provided string', () => {
		const {manager} = makeConfigManager();
		const key = manager.generateApiKey('Tomo Work');
		expect(key.label).toBe('Tomo Work');
	});

	it('creates the key as enabled by default', () => {
		const {manager} = makeConfigManager();
		const key = manager.generateApiKey('Client');
		expect(key.enabled).toBe(true);
	});

	it('creates the key with empty areas array', () => {
		const {manager} = makeConfigManager();
		const key = manager.generateApiKey('Client');
		expect(key.areas).toEqual([]);
	});

	it('adds the generated key to the config', () => {
		const {manager} = makeConfigManager();
		const key = manager.generateApiKey('Client');
		expect(manager.getConfig().apiKeys).toContainEqual(key);
	});

	it('generates unique IDs for successive calls', () => {
		const {manager} = makeConfigManager();
		const key1 = manager.generateApiKey('A');
		const key2 = manager.generateApiKey('B');
		expect(key1.id).not.toBe(key2.id);
	});
});

// ---------------------------------------------------------------------------
// revokeKey()
// ---------------------------------------------------------------------------

describe('ConfigManager.revokeKey()', () => {
	it('sets key.enabled to false', () => {
		const {manager} = makeConfigManager();
		const key = manager.generateApiKey('Client');
		manager.revokeKey(key.id);
		const found = manager.getKeyById(key.id);
		expect(found?.enabled).toBe(false);
	});

	it('does not throw for an unknown ID', () => {
		const {manager} = makeConfigManager();
		expect(() => manager.revokeKey('kado_nonexistent')).not.toThrow();
	});

	it('leaves other keys unaffected', () => {
		const {manager} = makeConfigManager();
		const key1 = manager.generateApiKey('A');
		const key2 = manager.generateApiKey('B');
		manager.revokeKey(key1.id);
		expect(manager.getKeyById(key2.id)?.enabled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// addGlobalArea() / removeGlobalArea()
// ---------------------------------------------------------------------------

describe('ConfigManager.addGlobalArea()', () => {
	it('appends the area to globalAreas', () => {
		const {manager} = makeConfigManager();
		const area = makeArea();
		manager.addGlobalArea(area);
		expect(manager.getConfig().globalAreas).toContainEqual(area);
	});

	it('allows multiple areas', () => {
		const {manager} = makeConfigManager();
		manager.addGlobalArea(makeArea({id: 'area-1', label: 'Projects'}));
		manager.addGlobalArea(makeArea({id: 'area-2', label: 'Journal'}));
		expect(manager.getConfig().globalAreas).toHaveLength(2);
	});
});

describe('ConfigManager.removeGlobalArea()', () => {
	it('removes the area with the matching ID', () => {
		const {manager} = makeConfigManager();
		const area = makeArea({id: 'area-to-remove'});
		manager.addGlobalArea(area);
		manager.removeGlobalArea('area-to-remove');
		expect(manager.getConfig().globalAreas).not.toContainEqual(area);
	});

	it('leaves other areas intact', () => {
		const {manager} = makeConfigManager();
		manager.addGlobalArea(makeArea({id: 'keep-me'}));
		manager.addGlobalArea(makeArea({id: 'remove-me'}));
		manager.removeGlobalArea('remove-me');
		expect(manager.getConfig().globalAreas).toHaveLength(1);
		expect(manager.getConfig().globalAreas[0]?.id).toBe('keep-me');
	});

	it('does not throw for an unknown ID', () => {
		const {manager} = makeConfigManager();
		expect(() => manager.removeGlobalArea('ghost')).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// getKeyById()
// ---------------------------------------------------------------------------

describe('ConfigManager.getKeyById()', () => {
	it('returns the key when it exists', () => {
		const {manager} = makeConfigManager();
		const key = manager.generateApiKey('Lookup Test');
		const found = manager.getKeyById(key.id);
		expect(found).toBeDefined();
		expect(found?.id).toBe(key.id);
	});

	it('returns undefined for an unknown ID', () => {
		const {manager} = makeConfigManager();
		expect(manager.getKeyById('kado_does-not-exist')).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Round-trip: save → load
// ---------------------------------------------------------------------------

describe('ConfigManager round-trip save → load', () => {
	it('produces identical config after save and reload', async () => {
		let persisted: KadoConfig | null = null;
		const saveFn = vi.fn(async (data: KadoConfig) => {
			persisted = data;
		});

		// First manager: build state and save
		const manager1 = new ConfigManager(async () => null, saveFn);
		manager1.addGlobalArea(makeArea({id: 'rt-area'}));
		manager1.generateApiKey('Round-trip key');
		await manager1.save();

		// Second manager: load what was saved
		const manager2 = new ConfigManager(async () => persisted as unknown, saveFn);
		await manager2.load();
		const config2 = manager2.getConfig();

		expect(config2.globalAreas).toHaveLength(1);
		expect(config2.globalAreas[0]?.id).toBe('rt-area');
		expect(config2.apiKeys).toHaveLength(1);
		expect(config2.apiKeys[0]?.label).toBe('Round-trip key');
	});
});
