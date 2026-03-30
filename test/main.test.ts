import {describe, it, expect, beforeEach, vi} from 'vitest';
import {App, Notice} from 'obsidian';
import MyPlugin from '../src/main';

describe('MyPlugin', () => {
	let plugin: MyPlugin;

	beforeEach(() => {
		plugin = new MyPlugin();
	});

	describe('onload', () => {
		it('should register a ribbon icon', async () => {
			await plugin.onload();
			expect(plugin.addRibbonIcon).toHaveBeenCalledWith(
				'dice',
				'Sample',
				expect.any(Function),
			);
		});

		it('should add a status bar item', async () => {
			await plugin.onload();
			expect(plugin.addStatusBarItem).toHaveBeenCalled();
		});

		it('should register three commands', async () => {
			await plugin.onload();
			expect(plugin.addCommand).toHaveBeenCalledTimes(3);
		});

		it('should register a settings tab', async () => {
			await plugin.onload();
			expect(plugin.addSettingTab).toHaveBeenCalled();
		});
	});

	describe('settings', () => {
		it('should load default settings when no data stored', async () => {
			plugin.loadData = vi.fn(async () => null);
			await plugin.onload();
			expect(plugin.settings.mySetting).toBe('default');
		});

		it('should merge stored settings with defaults', async () => {
			plugin.loadData = vi.fn(async () => ({mySetting: 'custom'}));
			await plugin.onload();
			expect(plugin.settings.mySetting).toBe('custom');
		});

		it('should persist settings via saveData', async () => {
			await plugin.onload();
			plugin.settings.mySetting = 'updated';
			await plugin.saveSettings();
			expect(plugin.saveData).toHaveBeenCalledWith(
				expect.objectContaining({mySetting: 'updated'}),
			);
		});
	});
});
