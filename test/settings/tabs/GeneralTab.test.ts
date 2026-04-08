/**
 * Behavioral tests for GeneralTab (M18).
 *
 * Covers: rendering sections, server enable toggle mutates config and calls
 * saveSettings, port input validation, audit toggle mutates config.
 */

import {describe, it, expect, vi} from 'vitest';
import {renderGeneralTab} from '../../../src/settings/tabs/GeneralTab';
import type KadoPlugin from '../../../src/main';
import {renderSandbox, defaultConfig} from '../helpers';
import {App} from '../../__mocks__/obsidian';

function mockPlugin(overrides?: Partial<ReturnType<typeof defaultConfig>>) {
	const config = {...defaultConfig(), ...overrides};
	const saveSettings = vi.fn(async () => undefined);
	const app = new App();

	const mcpServer = {
		isRunning: vi.fn(() => false),
		start: vi.fn(async () => undefined),
		stop: vi.fn(async () => undefined),
	};

	const plugin = {
		app,
		settings: config,
		configManager: {
			getConfig: () => config,
		},
		saveSettings,
		mcpServer,
		resolvedAuditLogPath: 'logs/kado-audit.log',
	} as unknown as KadoPlugin;

	return {plugin, config, saveSettings, mcpServer};
}

describe('renderGeneralTab — rendering', () => {
	it('renders the Server section heading', () => {
		const container = renderSandbox();
		const {plugin} = mockPlugin();

		renderGeneralTab(container, plugin, vi.fn());

		const headings = Array.from(container.querySelectorAll('[data-setting-name]'))
			.map((el) => el.getAttribute('data-setting-name'));
		expect(headings).toContain('Server');
		expect(headings).toContain('Enable');
		expect(headings).toContain('Port');
	});

	it('renders audit-logging section', () => {
		const container = renderSandbox();
		const {plugin} = mockPlugin();

		renderGeneralTab(container, plugin, vi.fn());

		const names = Array.from(container.querySelectorAll('[data-setting-name]'))
			.map((el) => el.getAttribute('data-setting-name'));
		expect(names).toContain('Enable audit logging');
		expect(names).toContain('Log directory');
	});

	it('shows server status as Stopped when mcpServer.isRunning returns false', () => {
		const container = renderSandbox();
		const {plugin} = mockPlugin();

		renderGeneralTab(container, plugin, vi.fn());

		expect(container.textContent).toContain('Stopped');
	});
});

describe('renderGeneralTab — interactivity', () => {
	it('calls saveSettings when the user enables the server', async () => {
		const container = renderSandbox();
		const {plugin, config, saveSettings, mcpServer} = mockPlugin();

		renderGeneralTab(container, plugin, vi.fn());

		// Server enable is the second toggle (the first is unrelated); find by proximity to name
		const enableSetting = container.querySelector('[data-setting-name="Enable"]') as HTMLElement;
		const toggleEl = enableSetting.querySelector('[role="switch"]') as HTMLElement;
		toggleEl.click();

		// Wait for the async onChange handler chain to resolve
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(config.server.enabled).toBe(true);
		expect(saveSettings).toHaveBeenCalled();
		expect(mcpServer.start).toHaveBeenCalled();
	});

	it('does not mutate config when port input is invalid', async () => {
		const container = renderSandbox();
		const {plugin, config} = mockPlugin();
		const originalPort = config.server.port;

		renderGeneralTab(container, plugin, vi.fn());

		const portSetting = container.querySelector('[data-setting-name="Port"]') as HTMLElement;
		const input = portSetting.querySelector('input[type="text"]') as HTMLInputElement;
		input.value = 'not-a-number';
		input.dispatchEvent(new Event('input', {bubbles: true}));

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(config.server.port).toBe(originalPort);
	});

	it('mutates server.port when a valid port is typed', async () => {
		const container = renderSandbox();
		const {plugin, config, saveSettings} = mockPlugin();

		renderGeneralTab(container, plugin, vi.fn());

		const portSetting = container.querySelector('[data-setting-name="Port"]') as HTMLElement;
		const input = portSetting.querySelector('input[type="text"]') as HTMLInputElement;
		input.value = '12345';
		input.dispatchEvent(new Event('input', {bubbles: true}));

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(config.server.port).toBe(12345);
		expect(saveSettings).toHaveBeenCalled();
	});
});
