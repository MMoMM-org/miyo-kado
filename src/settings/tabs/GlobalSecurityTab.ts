/**
 * GlobalSecurityTab — manage the single global security scope (listMode, paths, tags).
 *
 * Replaces the old multi-area model with a flat scope: one listMode toggle,
 * a list of paths with per-path permissions, and a list of tags.
 */

import {Setting} from 'obsidian';
import type KadoPlugin from '../../main';
import type {ListMode} from '../../types/canonical';
import {createDefaultPermissions} from '../../types/canonical';
import {renderPathEntry, type PathRule} from '../components/PathEntry';
import {renderTagEntry} from '../components/TagEntry';
import {renderOpenNotesSection} from '../components/OpenNotesSection';

export function renderGlobalSecurityTab(containerEl: HTMLElement, plugin: KadoPlugin, onRedisplay: () => void): void {
	const config = plugin.configManager.getConfig();
	const security = config.security;

	// ── Access Mode ──
	renderAccessModeToggle(containerEl, security.listMode, security.paths.length === 0 && security.tags.length === 0, (mode) => {
		security.listMode = mode;
		void plugin.saveSettings();
		onRedisplay();
	});

	// ── Open Notes Section ──
	renderOpenNotesSection(
		containerEl,
		{
			allowActiveNote: security.allowActiveNote,
			allowOtherNotes: security.allowOtherNotes,
		},
		security.listMode,
		'global',
		{
			onToggleActive: (value) => {
				security.allowActiveNote = value;
				void plugin.saveSettings();
				onRedisplay();
			},
			onToggleOther: (value) => {
				security.allowOtherNotes = value;
				void plugin.saveSettings();
				onRedisplay();
			},
		},
	);

	// ── Paths Section ──
	containerEl.createDiv({cls: 'kado-section-label', text: 'Paths'});

	const pathsContainer = containerEl.createDiv();

	for (let i = 0; i < security.paths.length; i++) {
		const pathRule: PathRule = {
			path: security.paths[i]?.path ?? '',
			permissions: security.paths[i]?.permissions ?? createDefaultPermissions(),
		};
		renderPathEntry(pathsContainer, pathRule, {
			app: plugin.app,
			onChange: () => {
				security.paths[i] = {path: pathRule.path, permissions: pathRule.permissions};
				void plugin.saveSettings();
			},
			onRemove: () => {
				security.paths.splice(i, 1);
				void plugin.saveSettings();
				onRedisplay();
			},
		});
	}

	const addPathBtn = containerEl.createEl('button', {cls: 'kado-add-btn', text: '+ add path'});
	addPathBtn.addEventListener('click', () => {
		security.paths.push({path: '', permissions: createDefaultPermissions()});
		void plugin.saveSettings();
		onRedisplay();
	});

	// ── Tags Section ──
	containerEl.createDiv({cls: 'kado-section-label', text: 'Tags'});

	const tagsContainer = containerEl.createDiv();

	for (let i = 0; i < security.tags.length; i++) {
		renderTagEntry(tagsContainer, security.tags[i] ?? '', {
			app: plugin.app,
			onChange: (newTag) => {
				security.tags[i] = newTag;
				void plugin.saveSettings();
			},
			onRemove: () => {
				security.tags.splice(i, 1);
				void plugin.saveSettings();
				onRedisplay();
			},
		});
	}

	const addTagBtn = containerEl.createEl('button', {cls: 'kado-add-btn', text: '+ add tag'});
	addTagBtn.addEventListener('click', () => {
		security.tags.push('');
		void plugin.saveSettings();
		onRedisplay();
	});
}

function renderAccessModeToggle(
	containerEl: HTMLElement,
	currentMode: ListMode,
	hasZeroRules: boolean,
	onChange: (mode: ListMode) => void,
): void {
	const isWhitelist = currentMode === 'whitelist';
	const desc = isWhitelist
		? 'Only listed paths and tags are accessible'
		: 'Everything except listed paths and tags is accessible';

	new Setting(containerEl)
		.setName('Access mode')
		.setDesc(desc)
		.addToggle(toggle => toggle
			.setValue(isWhitelist)
			.onChange((value) => {
				onChange(value ? 'whitelist' : 'blacklist');
			}));

	if (currentMode === 'blacklist' && hasZeroRules) {
		const warning = containerEl.createDiv({cls: 'kado-listmode-warning'});
		warning.setAttribute('role', 'alert');
		warning.createSpan({attr: {'aria-hidden': 'true'}, text: '\u26a0 '});
		warning.createSpan({text: 'Blacklist with no rules grants full access'});
	}
}
