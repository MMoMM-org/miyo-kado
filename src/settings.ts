/**
 * KadoSettingTab — Obsidian settings UI for the Kado plugin.
 * Full configuration UI is deferred to Phase 5.
 */

import {App, PluginSettingTab} from 'obsidian';
import type KadoPlugin from './main';

export class KadoSettingTab extends PluginSettingTab {
	plugin: KadoPlugin;

	constructor(app: App, plugin: KadoPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('p', {
			text: 'Configuration coming in phase 5.',
		});
	}
}
