/**
 * KadoSettingsTab — tab-based settings UI shell.
 *
 * Renders a version header, horizontal tab bar with scroll overflow,
 * and routes to GeneralTab, GlobalSecurityTab, or ApiKeyTab.
 */

import {App, PluginSettingTab} from 'obsidian';
import type KadoPlugin from '../main';
import {renderGeneralTab} from './tabs/GeneralTab';
import {renderGlobalSecurityTab} from './tabs/GlobalSecurityTab';
import {renderApiKeyTab} from './tabs/ApiKeyTab';

export class KadoSettingsTab extends PluginSettingTab {
	plugin: KadoPlugin;
	private activeTab = 'general';

	constructor(app: App, plugin: KadoPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.addClass('kado-settings');

		// Version header
		const header = containerEl.createDiv({cls: 'kado-version-header'});
		header.createSpan({text: `Kado v${this.plugin.manifest.version} — `});
		header.createEl('a', {
			text: 'Documentation',
			href: 'https://github.com/MiYo-org/kado',
		});

		// Tab bar
		const config = this.plugin.configManager.getConfig();
		const tabBar = containerEl.createDiv({cls: 'kado-tab-bar'});

		const scrollLeft = tabBar.createEl('button', {cls: 'kado-tab-scroll kado-tab-scroll-left', text: '\u2039'});
		const tabStrip = tabBar.createDiv({cls: 'kado-tab-strip'});
		const scrollRight = tabBar.createEl('button', {cls: 'kado-tab-scroll kado-tab-scroll-right', text: '\u203a'});

		const updateScrollButtons = (): void => {
			scrollLeft.toggleClass('kado-hidden', tabStrip.scrollLeft <= 0);
			scrollRight.toggleClass('kado-hidden',
				tabStrip.scrollLeft >= tabStrip.scrollWidth - tabStrip.clientWidth - 1);
		};
		scrollLeft.addEventListener('click', () => {
			tabStrip.scrollLeft -= 120;
			setTimeout(updateScrollButtons, 150);
		});
		scrollRight.addEventListener('click', () => {
			tabStrip.scrollLeft += 120;
			setTimeout(updateScrollButtons, 150);
		});
		tabStrip.addEventListener('scroll', updateScrollButtons);

		// Add tabs
		this.addTab(tabStrip, 'general', 'General');
		this.addTab(tabStrip, 'security', 'Global Security');
		for (const key of config.apiKeys) {
			this.addTab(tabStrip, `key-${key.id}`, `API Key \u00b7 ${key.label}`);
		}

		// Content area
		const contentEl = containerEl.createDiv({cls: 'kado-tab-content'});
		this.renderActiveTab(contentEl);

		// Defer scroll button check to after render
		setTimeout(updateScrollButtons, 50);
	}

	private addTab(tabStrip: HTMLElement, id: string, label: string): void {
		const tab = tabStrip.createDiv({
			cls: `kado-tab${id === this.activeTab ? ' is-active' : ''}`,
			text: label,
		});
		tab.addEventListener('click', () => {
			this.activeTab = id;
			this.display();
		});
	}

	private renderActiveTab(contentEl: HTMLElement): void {
		const onRedisplay = (): void => this.display();
		const onSwitchTab = (tab: string): void => {
			this.activeTab = tab;
			this.display();
		};

		if (this.activeTab === 'general') {
			renderGeneralTab(contentEl, this.plugin, onRedisplay);
		} else if (this.activeTab === 'security') {
			renderGlobalSecurityTab(contentEl, this.plugin, onRedisplay);
		} else if (this.activeTab.startsWith('key-')) {
			const keyId = this.activeTab.slice(4);
			renderApiKeyTab(contentEl, this.plugin, keyId, onRedisplay, onSwitchTab);
		}
	}
}
