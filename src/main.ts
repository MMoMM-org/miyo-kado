/**
 * KadoPlugin — Obsidian MCP Gateway plugin entry point.
 * Manages plugin lifecycle and configuration persistence.
 */

import {Plugin} from 'obsidian';
import {KadoSettingTab} from './settings';
import {KadoConfig, createDefaultConfig} from './types/canonical';

export default class KadoPlugin extends Plugin {
	settings: KadoConfig;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new KadoSettingTab(this.app, this));
	}

	onunload(): void {}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<KadoConfig> | null;
		const defaults = createDefaultConfig();
		this.settings = Object.assign({}, defaults, stored ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
