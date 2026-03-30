/**
 * Behavioral tests for KadoPlugin (plugin entry point).
 * Tests plugin lifecycle and settings persistence through the public API.
 */

import {describe, it, expect, vi} from 'vitest';
import KadoPlugin from '../src/main';
import {createDefaultConfig} from '../src/types/canonical';

describe('KadoPlugin', () => {
	const getMockPlugin = (): KadoPlugin => new KadoPlugin();

	describe('class contract', () => {
		it('is instantiable as a Plugin subclass', () => {
			const plugin = getMockPlugin();
			expect(plugin).toBeInstanceOf(KadoPlugin);
		});
	});

	describe('onload', () => {
		it('registers a settings tab', async () => {
			const plugin = getMockPlugin();
			await plugin.onload();
			expect(plugin.addSettingTab).toHaveBeenCalledTimes(1);
		});

		it('loads settings from storage on startup', async () => {
			const plugin = getMockPlugin();
			plugin.loadData = vi.fn(async () => ({}));
			await plugin.onload();
			expect(plugin.loadData).toHaveBeenCalledTimes(1);
		});

		it('does not register ribbon icons', async () => {
			const plugin = getMockPlugin();
			await plugin.onload();
			expect(plugin.addRibbonIcon).not.toHaveBeenCalled();
		});

		it('does not register status bar items', async () => {
			const plugin = getMockPlugin();
			await plugin.onload();
			expect(plugin.addStatusBarItem).not.toHaveBeenCalled();
		});

		it('does not register commands', async () => {
			const plugin = getMockPlugin();
			await plugin.onload();
			expect(plugin.addCommand).not.toHaveBeenCalled();
		});
	});

	describe('onunload', () => {
		it('exists and is callable without error', () => {
			const plugin = getMockPlugin();
			expect(() => plugin.onunload()).not.toThrow();
		});
	});

	describe('loadSettings', () => {
		it('returns default config when storage is empty', async () => {
			const plugin = getMockPlugin();
			plugin.loadData = vi.fn(async () => null);
			await plugin.loadSettings();
			const defaults = createDefaultConfig();
			expect(plugin.settings).toEqual(defaults);
		});

		it('returns default config when storage returns empty object', async () => {
			const plugin = getMockPlugin();
			plugin.loadData = vi.fn(async () => ({}));
			await plugin.loadSettings();
			const defaults = createDefaultConfig();
			expect(plugin.settings).toEqual(defaults);
		});

		it('merges stored data over defaults', async () => {
			const plugin = getMockPlugin();
			plugin.loadData = vi.fn(async () => ({
				server: {enabled: true, host: '0.0.0.0', port: 9999},
			}));
			await plugin.loadSettings();
			expect(plugin.settings.server.enabled).toBe(true);
			expect(plugin.settings.server.port).toBe(9999);
		});

		it('preserves default values for missing keys', async () => {
			const plugin = getMockPlugin();
			plugin.loadData = vi.fn(async () => ({
				server: {enabled: true, host: '0.0.0.0', port: 9999},
			}));
			await plugin.loadSettings();
			const defaults = createDefaultConfig();
			expect(plugin.settings.apiKeys).toEqual(defaults.apiKeys);
			expect(plugin.settings.audit).toEqual(defaults.audit);
		});
	});

	describe('saveSettings', () => {
		it('persists current config via saveData', async () => {
			const plugin = getMockPlugin();
			await plugin.onload();
			await plugin.saveSettings();
			expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
		});

		it('saves the current config object', async () => {
			const plugin = getMockPlugin();
			await plugin.onload();
			plugin.settings.server.port = 12345;
			await plugin.saveSettings();
			expect(plugin.saveData).toHaveBeenCalledWith(
				expect.objectContaining({
					server: expect.objectContaining({port: 12345}),
				}),
			);
		});
	});
});
