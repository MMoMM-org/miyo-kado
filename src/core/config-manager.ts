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
	type GlobalArea,
	type KadoConfig,
	createDefaultConfig,
} from '../types/canonical';
import {kadoLog} from './logger';

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

		// Ensure globalAreas have new fields (listMode, tags)
		const areas = (partial.globalAreas ?? defaults.globalAreas).map(area => ({
			...area,
			listMode: area.listMode ?? 'whitelist' as const,
			tags: area.tags ?? [],
		}));

		// Ensure apiKeys' areas have tags field
		const keys = (partial.apiKeys ?? defaults.apiKeys).map(key => ({
			...key,
			areas: (key.areas ?? []).map(ka => ({
				...ka,
				tags: ka.tags ?? [],
			})),
		}));

		this.config = {
			...defaults,
			...partial,
			server: {...defaults.server, ...(partial.server ?? {})},
			audit: mergedAudit as typeof defaults.audit,
			globalAreas: areas,
			apiKeys: keys,
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
			areas: [],
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

	/** Append a global area to the config. */
	addGlobalArea(area: GlobalArea): void {
		this.config.globalAreas.push(area);
	}

	/** Remove the global area with the given ID. No-op for unknown IDs. */
	removeGlobalArea(id: string): void {
		this.config.globalAreas = this.config.globalAreas.filter(
			(a) => a.id !== id,
		);
	}

	/** Return the key with the given ID, or undefined if not found. */
	getKeyById(id: string): ApiKeyConfig | undefined {
		return this.findKey(id);
	}

	private findKey(id: string): ApiKeyConfig | undefined {
		return this.config.apiKeys.find((k) => k.id === id);
	}
}
