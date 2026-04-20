/**
 * ConfigManager — owns the KadoConfig lifecycle.
 *
 * This class exists to decouple all config read/write logic from the Obsidian
 * Plugin API. It receives load/save callbacks so it can be tested in isolation
 * without an Obsidian runtime (ADR-5: single data.json via Obsidian native API).
 *
 * It has ZERO imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import {
	type ApiKeyConfig,
	type KadoConfig,
	createDefaultConfig,
	createDefaultSecurityConfig,
} from '../types/canonical';
import {kadoLog} from './logger';

/** Manages the KadoConfig lifecycle: load from storage, merge defaults, save, and key management. */
export class ConfigManager {
	private config: KadoConfig;

	constructor(
		private readonly loadFn: () => Promise<unknown>,
		private readonly saveFn: (data: KadoConfig) => Promise<void>,
	) {
		this.config = createDefaultConfig();
	}

	/** Load stored data and merge with defaults. Handles null/undefined inputs. */
	async load(): Promise<void> {
		const stored = await this.loadFn();
		if (stored === null || stored === undefined || typeof stored !== 'object') {
			this.config = createDefaultConfig();
			return;
		}
		const defaults = createDefaultConfig();
		const partial = stored as Partial<KadoConfig>;

		// Merge audit — handle migration from old logFilePath to logDirectory/logFileName
		const storedAudit = (partial.audit ?? {}) as Record<string, unknown>;
		const mergedAudit = {...defaults.audit, ...storedAudit};
		// Remove legacy field if present
		if ('logFilePath' in mergedAudit) {
			delete (mergedAudit as Record<string, unknown>)['logFilePath'];
		}

		// Merge security scope — handle migration from old globalAreas to security
		const storedSecurity = (partial as Record<string, unknown>).security as Partial<typeof defaults.security> | undefined;
		const mergedSecurity = {
			...createDefaultSecurityConfig(),
			...(storedSecurity ?? {}),
		};

		// Migrate legacy path "/" → "**" in global security paths
		for (const entry of mergedSecurity.paths) {
			if (entry.path === '/') {
				entry.path = '**';
			}
		}

		// Ensure open-notes flags are boolean (default false) on global security
		mergedSecurity.allowActiveNote = mergedSecurity.allowActiveNote === true;
		mergedSecurity.allowOtherNotes = mergedSecurity.allowOtherNotes === true;

		// Ensure apiKeys have new flat fields (listMode, paths, tags)
		const keys = (partial.apiKeys ?? defaults.apiKeys).map(key => ({
			...key,
			listMode: key.listMode ?? 'whitelist' as const,
			paths: key.paths ?? [],
			tags: key.tags ?? [],
			allowActiveNote: (key as unknown as Record<string, unknown>).allowActiveNote === true,
			allowOtherNotes: (key as unknown as Record<string, unknown>).allowOtherNotes === true,
		}));

		// Migrate legacy path "/" → "**" in each API key's paths
		for (const key of keys) {
			for (const entry of key.paths) {
				if (entry.path === '/') {
					entry.path = '**';
				}
			}
		}

		this.config = {
			...defaults,
			...partial,
			server: {...defaults.server, ...(partial.server ?? {})},
			audit: mergedAudit as typeof defaults.audit,
			security: mergedSecurity,
			apiKeys: keys,
			debugLogging: partial.debugLogging ?? defaults.debugLogging,
		};
	}

	/** Persist the current config via the save callback. */
	async save(): Promise<void> {
		await this.saveFn(this.config);
		kadoLog('Config saved');
	}

	/** Return the current in-memory config (read-only by convention). */
	getConfig(): KadoConfig {
		return this.config;
	}

	/**
	 * Generate a new API key with `kado_` prefix + UUID (ADR-6).
	 * The key is immediately added to the config.
	 */
	generateApiKey(label: string): ApiKeyConfig {
		const key: ApiKeyConfig = {
			id: `kado_${crypto.randomUUID()}`,
			label,
			enabled: true,
			createdAt: Date.now(),
			listMode: 'whitelist',
			paths: [],
			tags: [],
		};
		this.config.apiKeys.push(key);
		return key;
	}

	/** Disable an API key by ID. No-op for unknown IDs. */
	revokeKey(id: string): void {
		const key = this.findKey(id);
		if (key !== undefined) {
			key.enabled = false;
		}
	}

	/** Return the key with the given ID, or undefined if not found. */
	getKeyById(id: string): ApiKeyConfig | undefined {
		return this.findKey(id);
	}

	private findKey(id: string): ApiKeyConfig | undefined {
		return this.config.apiKeys.find((k) => k.id === id);
	}
}
