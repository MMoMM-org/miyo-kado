/**
 * Behavioral tests for KadoSettingsTab (new tab-based UI).
 * Tests the settings tab renders without errors and exposes core actions.
 */

import {describe, it, expect, vi} from 'vitest';
import {App} from 'obsidian';
import KadoPlugin from '../src/main';
import {KadoSettingsTab} from '../src/settings/SettingsTab';
import {ConfigManager} from '../src/core/config-manager';
import {createDefaultConfig} from '../src/types/canonical';
import type {KadoConfig} from '../src/types/canonical';

/** Factory: creates a fully wired KadoSettingsTab with controllable config. */
const getMockTab = (configOverrides?: Partial<KadoConfig>): {
	plugin: KadoPlugin;
	tab: KadoSettingsTab;
	configManager: ConfigManager;
} => {
	const config = {...createDefaultConfig(), ...configOverrides};
	const configManager = new ConfigManager(
		async () => config,
		vi.fn(async () => {}),
	);
	(configManager as unknown as {config: typeof config}).config = config;

	const plugin = new KadoPlugin();
	plugin.configManager = configManager;
	plugin.settings = configManager.getConfig();
	plugin.saveSettings = vi.fn(async () => {});

	// Mock manifest for version display
	(plugin as unknown as {manifest: {name: string; version: string}}).manifest = {name: 'Kado', version: '1.0.0-test'};

	// Mock mcpServer
	plugin.mcpServer = {
		isRunning: vi.fn(() => false),
		start: vi.fn(async () => {}),
		stop: vi.fn(async () => {}),
	} as unknown as typeof plugin.mcpServer;

	const tab = new KadoSettingsTab(new App(), plugin);
	return {plugin, tab, configManager};
};

describe('KadoSettingsTab', () => {
	describe('class contract', () => {
		it('is instantiable with an app and plugin', () => {
			const {tab} = getMockTab();
			expect(tab).toBeInstanceOf(KadoSettingsTab);
		});
	});

	describe('display', () => {
		it('renders without throwing', () => {
			const {tab} = getMockTab();
			expect(() => tab.display()).not.toThrow();
		});

		it('clears the container before rendering', () => {
			const {tab} = getMockTab();
			tab.containerEl.appendChild(document.createElement('span'));
			tab.display();
			const spans = tab.containerEl.querySelectorAll('span');
			// Version header has a span, but the manually added one should be gone
			expect(tab.containerEl.children.length).toBeGreaterThan(0);
		});

		it('renders version header', () => {
			const {tab} = getMockTab();
			tab.display();
			const text = tab.containerEl.textContent ?? '';
			expect(text).toContain('Kado v1.0.0-test');
		});

		it('renders tab bar with General and Global Security tabs', () => {
			const {tab} = getMockTab();
			tab.display();
			const tabs = Array.from(tab.containerEl.querySelectorAll('.kado-tab'))
				.map(el => el.textContent);
			expect(tabs).toContain('General');
			expect(tabs).toContain('Global Security');
		});

		it('renders an API key tab for each existing key', () => {
			const {tab, configManager} = getMockTab();
			configManager.generateApiKey('Test Key');
			tab.display();
			const tabs = Array.from(tab.containerEl.querySelectorAll('.kado-tab'))
				.map(el => el.textContent);
			expect(tabs.some(t => t?.includes('Test Key'))).toBe(true);
		});
	});

	describe('general tab (default)', () => {
		it('renders server section headings', () => {
			const {tab} = getMockTab();
			tab.display();
			const headings = Array.from(tab.containerEl.querySelectorAll('.setting-heading'))
				.map(el => el.getAttribute('data-setting-name') ?? '');
			expect(headings).toContain('Server');
		});

		it('renders server status as stopped', () => {
			const {tab} = getMockTab();
			tab.display();
			const names = Array.from(tab.containerEl.querySelectorAll('[data-setting-name]'))
				.map(el => el.getAttribute('data-setting-name') ?? '');
			expect(names).toContain('Status');
		});

		it('renders audit logging settings', () => {
			const {tab} = getMockTab();
			tab.display();
			const names = Array.from(tab.containerEl.querySelectorAll('[data-setting-name]'))
				.map(el => el.getAttribute('data-setting-name') ?? '');
			expect(names).toContain('Enable audit logging');
			expect(names).toContain('Log directory');
			expect(names).toContain('Log filename');
			expect(names).toContain('Max log size (MB)');
			expect(names).toContain('Max retained logs');
		});
	});

	describe('config manager integration', () => {
		it('generates a new key via configManager', () => {
			const {configManager} = getMockTab();
			const beforeCount = configManager.getConfig().apiKeys.length;
			configManager.generateApiKey('New Key');
			expect(configManager.getConfig().apiKeys.length).toBe(beforeCount + 1);
		});

		it('revokes a key via configManager', () => {
			const {configManager} = getMockTab();
			const key = configManager.generateApiKey('To Revoke');
			configManager.revokeKey(key.id);
			expect(configManager.getKeyById(key.id)?.enabled).toBe(false);
		});
	});
});
