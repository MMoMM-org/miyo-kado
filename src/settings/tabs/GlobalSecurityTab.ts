/**
 * GlobalSecurityTab — manage global areas with list mode, paths, tags.
 */

import {Setting} from 'obsidian';
import type KadoPlugin from '../../main';
import type {GlobalArea, ListMode} from '../../types/canonical';
import {createDefaultPermissions} from '../../types/canonical';
import {renderPathEntry, type PathRule} from '../components/PathEntry';
import {renderTagEntry} from '../components/TagEntry';

export function renderGlobalSecurityTab(containerEl: HTMLElement, plugin: KadoPlugin, onRedisplay: () => void): void {
	const config = plugin.configManager.getConfig();

	if (config.globalAreas.length === 0) {
		containerEl.createEl('p', {
			text: 'Kado starts in default-deny mode — no vault content is accessible until you create a global area and grant permissions.',
			cls: 'setting-item-description',
		});
	}

	new Setting(containerEl)
		.addButton(btn => btn
			.setButtonText('+ add area')
			.setCta()
			.onClick(() => {
				const area: GlobalArea = {
					id: crypto.randomUUID(),
					label: '',
					pathPatterns: [],
					permissions: createDefaultPermissions(),
					listMode: 'whitelist',
					tags: [],
				};
				plugin.configManager.addGlobalArea(area);
				void plugin.saveSettings();
				onRedisplay();
			}));

	for (const area of config.globalAreas) {
		renderAreaCard(containerEl, area, plugin, onRedisplay);
	}
}

function renderAreaCard(
	containerEl: HTMLElement,
	area: GlobalArea,
	plugin: KadoPlugin,
	onRedisplay: () => void,
): void {
	const card = containerEl.createDiv({cls: 'kado-area-card'});

	// Header: label + remove
	const header = card.createDiv({cls: 'kado-area-header'});
	const labelInput = header.createEl('input', {
		type: 'text',
		placeholder: 'Area name...',
		value: area.label,
		cls: 'kado-path-input',
	});
	labelInput.addClass('kado-area-label-input');
	labelInput.addEventListener('change', () => {
		area.label = labelInput.value;
		void plugin.saveSettings();
	});

	const removeBtn = header.createEl('button', {text: 'Remove area', cls: 'mod-warning'});
	removeBtn.addEventListener('click', () => {
		plugin.configManager.removeGlobalArea(area.id);
		// Cascade: remove key assignments referencing this area
		for (const key of plugin.configManager.getConfig().apiKeys) {
			key.areas = key.areas.filter(a => a.areaId !== area.id);
		}
		void plugin.saveSettings();
		onRedisplay();
	});

	// List mode toggle
	renderListModeToggle(card, area.listMode, area.pathPatterns.length === 0 && area.tags.length === 0, (mode) => {
		area.listMode = mode;
		void plugin.saveSettings();
		onRedisplay();
	});

	// ── Paths Section ──
	card.createDiv({cls: 'kado-section-label', text: 'Paths'});

	const pathsContainer = card.createDiv();

	// Convert pathPatterns + permissions into PathRule array for rendering
	// Each path gets its own permissions copy from the area's shared permissions
	// Note: In the current model, all paths share area.permissions (the matrix is per-area, not per-path)
	// We render one matrix for the area, and paths are just pattern strings
	for (let i = 0; i < area.pathPatterns.length; i++) {
		const pathRule: PathRule = {
			path: area.pathPatterns[i] ?? '',
			permissions: area.permissions,
		};
		renderPathEntry(pathsContainer, pathRule, {
			app: plugin.app,
			onChange: () => {
				area.pathPatterns[i] = pathRule.path;
				void plugin.saveSettings();
			},
			onRemove: () => {
				area.pathPatterns.splice(i, 1);
				void plugin.saveSettings();
				onRedisplay();
			},
		});
	}

	const addPathBtn = card.createEl('button', {cls: 'kado-add-btn', text: '+ add path'});
	addPathBtn.addEventListener('click', () => {
		area.pathPatterns.push('');
		void plugin.saveSettings();
		onRedisplay();
	});

	// ── Tags Section ──
	card.createDiv({cls: 'kado-section-label', text: 'Tags'});

	const tagsContainer = card.createDiv();

	for (let i = 0; i < area.tags.length; i++) {
		renderTagEntry(tagsContainer, area.tags[i] ?? '', {
			app: plugin.app,
			onChange: (newTag) => {
				area.tags[i] = newTag;
				void plugin.saveSettings();
			},
			onRemove: () => {
				area.tags.splice(i, 1);
				void plugin.saveSettings();
				onRedisplay();
			},
		});
	}

	const addTagBtn = card.createEl('button', {cls: 'kado-add-btn', text: '+ add tag'});
	addTagBtn.addEventListener('click', () => {
		area.tags.push('');
		void plugin.saveSettings();
		onRedisplay();
	});
}

function renderListModeToggle(
	containerEl: HTMLElement,
	currentMode: ListMode,
	hasZeroRules: boolean,
	onChange: (mode: ListMode) => void,
): void {
	const toggle = containerEl.createDiv({cls: 'kado-listmode'});

	const whitelistLabel = toggle.createEl('span', {
		text: 'Whitelist',
		cls: `kado-listmode-label${currentMode === 'whitelist' ? ' is-active' : ''}`,
	});
	const blacklistLabel = toggle.createEl('span', {
		text: 'Blacklist',
		cls: `kado-listmode-label${currentMode === 'blacklist' ? ' is-active' : ''}`,
	});

	whitelistLabel.addEventListener('click', () => { if (currentMode !== 'whitelist') onChange('whitelist'); });
	blacklistLabel.addEventListener('click', () => { if (currentMode !== 'blacklist') onChange('blacklist'); });

	// Description text
	const desc = currentMode === 'whitelist'
		? 'Only listed paths and tags are accessible'
		: 'Everything except listed paths and tags is accessible';
	containerEl.createDiv({cls: 'kado-listmode-desc', text: desc});

	// Warning for blacklist with zero rules
	if (currentMode === 'blacklist' && hasZeroRules) {
		containerEl.createDiv({
			cls: 'kado-listmode-warning',
			text: '\u26a0 Blacklist with no rules grants full access',
		});
	}
}
