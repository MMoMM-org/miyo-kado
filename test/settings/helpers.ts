/**
 * Shared helpers for settings component/tab behavioral tests (M18).
 *
 * - `renderSandbox()` builds an Obsidian-augmented detached HTMLElement
 *   so components can call `createEl`/`createDiv` without a real Obsidian
 *   workspace.
 * - `mockKadoPlugin()` builds a KadoPlugin-shaped object with a mocked
 *   configManager, a spyable `saveSettings`, and default config.
 */

import {vi} from 'vitest';
import {App} from '../__mocks__/obsidian';
import type KadoPlugin from '../../src/main';
import type {KadoConfig, ApiKeyConfig} from '../../src/types/canonical';

// Re-augment a detached element with Obsidian DOM helpers. The mock module
// already exports `PluginSettingTab.containerEl` as augmented, so we produce
// a parallel helper by constructing a settings tab and extracting its root.
import {PluginSettingTab, Plugin} from '../__mocks__/obsidian';

/** Returns a detached HTMLElement with Obsidian createEl/createDiv helpers. */
export function renderSandbox(): HTMLElement {
	const app = new App();
	const plugin = new Plugin(app) as unknown as KadoPlugin;
	const tab = new PluginSettingTab(app, plugin as unknown as Plugin);
	// Clear any initial content and return the augmented containerEl
	(tab.containerEl as unknown as {empty: () => void}).empty();
	return tab.containerEl;
}

/** Default KadoConfig used when a test doesn't override it. */
export function defaultConfig(): KadoConfig {
	return {
		server: {enabled: false, host: '127.0.0.1', port: 23026, connectionType: 'local'},
		security: {listMode: 'whitelist', paths: [], tags: []},
		apiKeys: [],
		audit: {
			enabled: true,
			logDirectory: 'logs',
			logFileName: 'kado-audit.log',
			maxSizeBytes: 10_485_760,
			maxRetainedLogs: 3,
		},
		debugLogging: false,
	};
}

/** Builds a sample ApiKeyConfig with sensible defaults. */
export function makeApiKey(overrides?: Partial<ApiKeyConfig>): ApiKeyConfig {
	return {
		id: 'kado_test-key-id',
		label: 'Test Key',
		enabled: true,
		createdAt: 1_700_000_000_000,
		listMode: 'whitelist',
		paths: [],
		tags: [],
		...overrides,
	};
}

/**
 * Builds a KadoPlugin-shaped mock with:
 * - A spyable `saveSettings` fn
 * - A configManager that returns the provided config
 * - A `settings` field pointing at the same config
 * - An Obsidian App instance from the mock
 */
export function mockKadoPlugin(configOverrides?: Partial<KadoConfig>): {
	plugin: KadoPlugin;
	saveSettings: ReturnType<typeof vi.fn>;
	getConfig: () => KadoConfig;
} {
	const config: KadoConfig = {...defaultConfig(), ...configOverrides};
	const saveSettings = vi.fn(async () => undefined);
	const app = new App();

	const configManager = {
		getConfig: () => config,
		save: vi.fn(async () => undefined),
		load: vi.fn(async () => undefined),
	};

	const plugin = {
		app,
		manifest: {id: 'miyo-kado', name: 'MiYo Kado', version: '0.0.38'},
		settings: config,
		configManager,
		saveSettings,
		resolvedAuditLogPath: 'logs/kado-audit.log',
	} as unknown as KadoPlugin;

	return {plugin, saveSettings, getConfig: () => config};
}

/** Simulates a user typing into an Obsidian mock input and firing change. */
export function typeInto(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event('change', {bubbles: true}));
}

/** Fires a click event on any element (used for dots, buttons, etc.). */
export function click(el: Element): void {
	el.dispatchEvent(new MouseEvent('click', {bubbles: true}));
}
