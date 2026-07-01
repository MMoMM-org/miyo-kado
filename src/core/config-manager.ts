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
	createDefaultApiKeyConfig,
} from '../types/canonical';
import {normalizeConfig} from './config-normalize';
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
		this.config = normalizeConfig(await this.loadFn());
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
	 * Replace the entire in-memory config (used by config import, #84). The
	 * caller is responsible for building a complete, normalized config (e.g. via
	 * applyImport) and for persisting afterwards via save().
	 */
	replaceConfig(config: KadoConfig): void {
		this.config = config;
	}

	/**
	 * Generate a new API key with `kado_` prefix + UUID (ADR-6).
	 * The key is immediately added to the config.
	 */
	generateApiKey(label: string): ApiKeyConfig {
		const key = createDefaultApiKeyConfig({
			id: `kado_${crypto.randomUUID()}`,
			label,
			createdAt: Date.now(),
		});
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
