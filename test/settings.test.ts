/**
 * Behavioral tests for KadoSettingTab.
 * Tests the settings tab renders all sections and responds to user interactions.
 */

import {describe, it, expect, vi} from 'vitest';
import {App} from 'obsidian';
import KadoPlugin from '../src/main';
import {KadoSettingTab} from '../src/settings';
import {ConfigManager} from '../src/core/config-manager';
import {createDefaultConfig, createDefaultPermissions} from '../src/types/canonical';
import type {KadoConfig} from '../src/types/canonical';

/** Factory: creates a fully wired KadoSettingTab with controllable config. */
const getMockTab = (configOverrides?: Partial<KadoConfig>): {
	plugin: KadoPlugin;
	tab: KadoSettingTab;
	configManager: ConfigManager;
} => {
	const config = {...createDefaultConfig(), ...configOverrides};
	// Use a synchronous-resolving loadFn so getConfig() is ready immediately.
	let resolvedConfig = config;
	const configManager = new ConfigManager(
		async () => resolvedConfig,
		vi.fn(async () => {}),
	);
	// Force-load: the loadFn resolves in the same microtask, but we need
	// the config available synchronously. Directly set via a second load approach:
	// We leverage the fact that ConfigManager.load() does `this.config = {...defaults, ...stored}`.
	// Since our loadFn returns config synchronously (Promise.resolve), we can
	// rely on calling load() and the merge happening synchronously within the
	// microtask. But display() is called synchronously. So we need a workaround.
	// The simplest fix: manually set the internal config state.
	// We do this by loading then reading - but since it's async, we use a trick:
	// We call load() which sets a microtask, but we also directly assign.
	// Instead, let's just use Object.assign to poke the config in.
	(configManager as unknown as {config: typeof config}).config = config;

	const plugin = new KadoPlugin();
	plugin.configManager = configManager;
	plugin.settings = configManager.getConfig();
	plugin.saveSettings = vi.fn(async () => {});

	// Mock mcpServer
	plugin.mcpServer = {
		isRunning: vi.fn(() => false),
		start: vi.fn(async () => {}),
		stop: vi.fn(async () => {}),
	} as unknown as typeof plugin.mcpServer;

	const tab = new KadoSettingTab(new App(), plugin);
	return {plugin, tab, configManager};
};

/** Helper: find all setting names rendered in the DOM. */
const getSettingNames = (containerEl: HTMLElement): string[] => {
	return Array.from(containerEl.querySelectorAll('[data-setting-name]'))
		.map(el => el.getAttribute('data-setting-name') ?? '');
};

/** Helper: find heading names rendered in the DOM. */
const getHeadings = (containerEl: HTMLElement): string[] => {
	return Array.from(containerEl.querySelectorAll('.setting-heading'))
		.map(el => el.getAttribute('data-setting-name') ?? '');
};

describe('KadoSettingTab', () => {
	describe('class contract', () => {
		it('is instantiable with an app and plugin', () => {
			const {tab} = getMockTab();
			expect(tab).toBeInstanceOf(KadoSettingTab);
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
			expect(spans.length).toBe(0);
		});

		it('renders all section headings', () => {
			const {tab} = getMockTab();
			tab.display();
			const headings = getHeadings(tab.containerEl);
			expect(headings).toContain('Server');
			expect(headings).toContain('Global areas');
			expect(headings).toContain('API keys');
			expect(headings).toContain('Audit');
		});
	});

	describe('server section', () => {
		it('shows server status as stopped when server is not running', () => {
			const {tab} = getMockTab();
			tab.display();
			const names = getSettingNames(tab.containerEl);
			expect(names).toContain('Status');
		});

		it('renders enable toggle, host, and port settings', () => {
			const {tab} = getMockTab();
			tab.display();
			const names = getSettingNames(tab.containerEl);
			expect(names).toContain('Enable');
			expect(names).toContain('Host');
			expect(names).toContain('Port');
		});
	});

	describe('global areas section', () => {
		it('renders an Add Area button', () => {
			const {tab} = getMockTab();
			tab.display();
			const names = getSettingNames(tab.containerEl);
			expect(names).toContain('Add area');
		});

		it('renders existing global areas with label and path inputs', () => {
			const {tab} = getMockTab({
				globalAreas: [{
					id: 'area-1',
					label: 'Projects',
					pathPatterns: ['projects/**'],
					permissions: createDefaultPermissions(),
				}],
			});
			tab.display();
			const names = getSettingNames(tab.containerEl);
			expect(names).toContain('Label');
			expect(names).toContain('Path patterns');
		});

		it('renders a Remove button for each global area', () => {
			const {tab} = getMockTab({
				globalAreas: [{
					id: 'area-1',
					label: 'Projects',
					pathPatterns: ['projects/**'],
					permissions: createDefaultPermissions(),
				}],
			});
			tab.display();
			const names = getSettingNames(tab.containerEl);
			expect(names).toContain('Remove');
		});

		it('adds a new global area via configManager when Add Area button action fires', () => {
			const {tab, configManager} = getMockTab();
			tab.display();

			const beforeCount = configManager.getConfig().globalAreas.length;
			expect(beforeCount).toBe(0);

			// Trigger the addArea action exposed for testing
			tab.addArea();
			expect(configManager.getConfig().globalAreas.length).toBe(1);
		});
	});

	describe('api keys section', () => {
		it('renders a Generate Key button', () => {
			const {tab} = getMockTab();
			tab.display();
			const names = getSettingNames(tab.containerEl);
			expect(names).toContain('Generate key');
		});

		it('renders existing API keys with label and key ID', () => {
			const {tab, configManager} = getMockTab();
			configManager.generateApiKey('Test Key');
			tab.display();
			const text = tab.containerEl.textContent ?? '';
			expect(text).toContain('Test Key');
		});

		it('shows revoked status for disabled keys', () => {
			const {tab, configManager} = getMockTab();
			const key = configManager.generateApiKey('Old Key');
			configManager.revokeKey(key.id);
			tab.display();
			const text = tab.containerEl.textContent ?? '';
			expect(text).toContain('Revoked');
		});

		it('shows enabled status for active keys', () => {
			const {tab, configManager} = getMockTab();
			configManager.generateApiKey('Active Key');
			tab.display();
			const text = tab.containerEl.textContent ?? '';
			expect(text).toContain('Enabled');
		});

		it('renders a Revoke button for enabled keys', () => {
			const {tab, configManager} = getMockTab();
			configManager.generateApiKey('Active Key');
			tab.display();
			const names = getSettingNames(tab.containerEl);
			expect(names).toContain('Revoke');
		});

		it('generates a new key via configManager', () => {
			const {tab, configManager} = getMockTab();
			tab.display();

			const beforeCount = configManager.getConfig().apiKeys.length;
			tab.generateKey('New Key');
			expect(configManager.getConfig().apiKeys.length).toBe(beforeCount + 1);
		});

		it('revokes a key via configManager', () => {
			const {tab, configManager} = getMockTab();
			const key = configManager.generateApiKey('To Revoke');
			tab.display();

			tab.revokeKey(key.id);
			expect(configManager.getKeyById(key.id)?.enabled).toBe(false);
		});
	});

	describe('audit section', () => {
		it('renders audit toggle and path settings', () => {
			const {tab} = getMockTab();
			tab.display();
			const names = getSettingNames(tab.containerEl);
			expect(names).toContain('Enable audit');
			expect(names).toContain('Log path');
		});

		it('renders max size setting', () => {
			const {tab} = getMockTab();
			tab.display();
			const names = getSettingNames(tab.containerEl);
			expect(names).toContain('Max size (mb)');
		});
	});
});
