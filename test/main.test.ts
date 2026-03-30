/**
 * Behavioral tests for KadoPlugin (plugin entry point).
 * Tests plugin lifecycle and settings persistence through the public API.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import KadoPlugin from '../src/main';
import {createDefaultConfig} from '../src/types/canonical';

// ---------------------------------------------------------------------------
// Mock MCP server — prevents real HTTP binding in unit tests.
// We test wiring (was it created, was start called) not actual networking.
// ---------------------------------------------------------------------------

const mockMcpStart = vi.fn(async () => {});
const mockMcpStop = vi.fn(async () => {});
const mockIsRunning = vi.fn(() => false);

vi.mock('../src/mcp/server', () => ({
	KadoMcpServer: vi.fn().mockImplementation(() => ({
		start: mockMcpStart,
		stop: mockMcpStop,
		isRunning: mockIsRunning,
	})),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getMockPlugin = (): KadoPlugin => new KadoPlugin();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KadoPlugin', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

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

		it('creates KadoMcpServer', async () => {
			const {KadoMcpServer} = await import('../src/mcp/server');
			const plugin = getMockPlugin();
			await plugin.onload();
			expect(KadoMcpServer).toHaveBeenCalledTimes(1);
		});

		it('starts MCP server when config.server.enabled is true', async () => {
			const plugin = getMockPlugin();
			plugin.loadData = vi.fn(async () => ({server: {enabled: true, host: '127.0.0.1', port: 3001}}));
			await plugin.onload();
			expect(mockMcpStart).toHaveBeenCalledTimes(1);
		});

		it('does NOT start MCP server when config.server.enabled is false', async () => {
			const plugin = getMockPlugin();
			plugin.loadData = vi.fn(async () => ({server: {enabled: false, host: '127.0.0.1', port: 3001}}));
			await plugin.onload();
			expect(mockMcpStart).not.toHaveBeenCalled();
		});

		it('registers cleanup handler for MCP server stop', async () => {
			const plugin = getMockPlugin();
			await plugin.onload();
			expect(plugin.register).toHaveBeenCalledTimes(1);
		});
	});

	describe('onunload', () => {
		it('exists and is callable without error', () => {
			const plugin = getMockPlugin();
			expect(() => plugin.onunload()).not.toThrow();
		});

		it('stops MCP server when cleanup runs', async () => {
			const plugin = getMockPlugin();
			await plugin.onload();
			// Simulate Obsidian calling registered cleanup callbacks
			plugin._runCleanup();
			expect(mockMcpStop).toHaveBeenCalledTimes(1);
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
