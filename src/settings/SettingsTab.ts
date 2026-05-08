/**
 * KadoSettingsTab — tab-based settings UI shell.
 *
 * Renders a manifest-driven header (HeaderSection), a horizontal tab bar with
 * scroll overflow, and routes to GeneralTab, GlobalSecurityTab, or ApiKeyTab.
 */

import {App, PluginSettingTab} from 'obsidian';
import type KadoPlugin from '../main';
import {renderGeneralTab} from './tabs/GeneralTab';
import {renderGlobalSecurityTab} from './tabs/GlobalSecurityTab';
import {renderApiKeyTab} from './tabs/ApiKeyTab';
import {HeaderSection} from './HeaderSection';

export class KadoSettingsTab extends PluginSettingTab {
	plugin: KadoPlugin;
	private activeTab = 'general';
	private readonly headerSection: HeaderSection;

	constructor(app: App, plugin: KadoPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.headerSection = new HeaderSection({plugin});
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.classList.add('kado-settings');

		// Manifest-driven header (name, version, author, documentation, tagline,
		// hanko image). Rendered once per display() call.
		const headerContainer = containerEl.createDiv({cls: 'kado-settings-header'});
		this.headerSection.render(headerContainer);

		// Tab bar
		const config = this.plugin.configManager.getConfig();
		const tabBar = containerEl.createDiv({cls: 'kado-tab-bar'});

		const scrollLeft = tabBar.createEl('button', {cls: 'kado-tab-scroll kado-tab-scroll-left', attr: {'aria-label': 'Scroll tabs left'}});
		scrollLeft.createEl('span', {text: '\u2039', attr: {'aria-hidden': 'true'}});
		const tabStrip = tabBar.createDiv({cls: 'kado-tab-strip', attr: {role: 'tablist'}});
		const scrollRight = tabBar.createEl('button', {cls: 'kado-tab-scroll kado-tab-scroll-right', attr: {'aria-label': 'Scroll tabs right'}});
		scrollRight.createEl('span', {text: '\u203a', attr: {'aria-hidden': 'true'}});

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
		const contentEl = containerEl.createDiv({cls: 'kado-tab-content', attr: {role: 'tabpanel', id: 'kado-tab-content'}});
		this.renderActiveTab(contentEl);

		// Defer scroll button check to after render
		setTimeout(updateScrollButtons, 50);
	}

	private addTab(tabStrip: HTMLElement, id: string, label: string): void {
		const isActive = id === this.activeTab;
		const tab = tabStrip.createEl('button', {
			cls: `kado-tab${isActive ? ' is-active' : ''}`,
			text: label,
			attr: {
				role: 'tab',
				'aria-selected': String(isActive),
				'aria-controls': 'kado-tab-content',
			},
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
