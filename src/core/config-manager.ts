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
		this.config = {...defaults, ...(stored as Partial<KadoConfig>)};
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
