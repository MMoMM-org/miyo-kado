/**
 * ApiKeyTab — per-key management: rename, copy, regenerate, permissions, delete.
 *
 * Each key has an independent listMode and direct paths/tags constrained by the
 * global security scope. Replaces the old area-assignment model.
 */

import {Modal, Notice, Setting} from 'obsidian';
import type KadoPlugin from '../../main';
import type {ApiKeyConfig, DataTypePermissions, KadoConfig, ListMode, PathPermission} from '../../types/canonical';
import {createDefaultPermissions} from '../../types/canonical';
import {folderPrefixOf} from '../../core/glob-match';
import {findMostSpecificEntry} from '../../core/gates/scope-resolver';
import {renderPermissionMatrix} from '../components/PermissionMatrix';
import {renderTagEntry} from '../components/TagEntry';
import {renderOpenNotesSection} from '../components/OpenNotesSection';
import {VaultFolderModal} from '../components/VaultFolderModal';

export function renderApiKeyTab(
	containerEl: HTMLElement,
	plugin: KadoPlugin,
	keyId: string,
	onRedisplay: () => void,
	onSwitchTab: (tab: string) => void,
): void {
	const config = plugin.configManager.getConfig();
	const key = config.apiKeys.find(k => k.id === keyId);
	if (!key) {
		containerEl.createEl('p', {text: 'Key not found.'});
		return;
	}

	renderKeyManagement(containerEl, key, plugin, onRedisplay);
	// containerEl is the tab content root (created fresh on each display() and
	// emptied on tab switch). Threading it down so the picker can scope its
	// outside-click listener to this DOM instead of the global document.
	renderKeyPermissions(containerEl, containerEl, key, plugin, onRedisplay);
	renderDangerZone(containerEl, key, config, plugin, onSwitchTab);
}

function renderKeyManagement(
	containerEl: HTMLElement,
	key: ApiKeyConfig,
	plugin: KadoPlugin,
	onRedisplay: () => void,
): void {
	new Setting(containerEl).setName('Key management').setHeading();

	// Rename
	let renameInput: HTMLInputElement | null = null;
	new Setting(containerEl)
		.setName('Key name')
		.addText(text => {
			renameInput = text.inputEl;
			text.setValue(key.label).onChange(() => { /* defer to rename button */ });
		})
		.addButton(btn => btn
			.setButtonText('Rename')
			.onClick(async () => {
				if (renameInput) {
					key.label = renameInput.value;
					await plugin.saveSettings();
					onRedisplay();
				}
			}));

	// Key display + copy
	const keyDisplay = new Setting(containerEl).setName('API key');
	keyDisplay.descEl.createSpan({cls: 'kado-key-display', text: key.id});
	keyDisplay.addButton(btn => {
		btn.setButtonText('Copy');
		btn.buttonEl.setAttribute('aria-live', 'polite');
		btn.onClick(() => {
			void navigator.clipboard.writeText(key.id).then(
				() => {
					btn.setButtonText('Copied!');
					window.setTimeout(() => { btn.setButtonText('Copy'); }, 1500);
				},
				() => {
					new Notice('Failed to copy to clipboard');
				},
			);
		});
	});

	// Regenerate
	new Setting(containerEl)
		.setName('Regenerate key')
		.setDesc('Replaces the secret. Old key is immediately invalidated.')
		.addButton(btn => btn
			.setButtonText('Regenerate')
			.setWarning()
			.onClick(() => {
				new ConfirmModal(plugin.app, 'Regenerate API key?', 'The old key will be invalidated immediately. Connected clients will need the new key.', async () => {
					key.id = `kado_${crypto.randomUUID()}`;
					await plugin.saveSettings();
					onRedisplay();
					new Notice('Key regenerated — copy the new value');
				}).open();
			}));
}

function renderKeyPermissions(
	containerEl: HTMLElement,
	tabRoot: HTMLElement,
	key: ApiKeyConfig,
	plugin: KadoPlugin,
	onRedisplay: () => void,
): void {
	const config = plugin.configManager.getConfig();
	const globalSecurity = config.security;

	new Setting(containerEl).setName('Permissions').setHeading();

	// Access Mode toggle (independent per key)
	const isWhitelist = key.listMode === 'whitelist';
	const modeDesc = isWhitelist
		? 'Only listed paths and tags are accessible for this key'
		: 'Everything except listed paths and tags is accessible for this key';

	new Setting(containerEl)
		.setName('Access mode')
		.setDesc(modeDesc)
		.addToggle(toggle => toggle
			.setValue(isWhitelist)
			.onChange((value: boolean) => {
				key.listMode = value ? 'whitelist' : 'blacklist';
				void plugin.saveSettings();
				onRedisplay();
			}));

	renderOpenNotesSection(
		containerEl,
		{allowActiveNote: key.allowActiveNote, allowOtherNotes: key.allowOtherNotes},
		key.listMode,
		'key',
		{
			onToggleActive: (value: boolean) => {
				key.allowActiveNote = value;
				void plugin.saveSettings();
				onRedisplay();
			},
			onToggleOther: (value: boolean) => {
				key.allowOtherNotes = value;
				void plugin.saveSettings();
				onRedisplay();
			},
		},
	);

	// ── Paths Section ──
	containerEl.createDiv({cls: 'kado-section-label', text: 'Paths'});

	const pathsContainer = containerEl.createDiv();

	for (let i = 0; i < key.paths.length; i++) {
		const keyPath = key.paths[i];
		if (!keyPath) continue;
		// Ceiling = the most specific GLOBAL path that contains this key path.
		// A narrowed key path (e.g. 'Atlas/202 Notes' under global 'Atlas') has
		// no exact global match, so resolve by ancestor instead of equality.
		const globalPath = findMostSpecificEntry(globalSecurity.paths, keyPath.path);
		renderKeyPathEntry(pathsContainer, keyPath, globalPath?.permissions, key.listMode, plugin, () => {
			key.paths.splice(i, 1);
			void plugin.saveSettings();
			onRedisplay();
		});
	}

	// Add path — only from global paths not yet assigned to this key
	const addPathContainer = containerEl.createDiv();
	const addPathBtn = addPathContainer.createEl('button', {cls: 'kado-add-btn', text: '+ add path'});
	addPathBtn.addEventListener('click', () => {
		renderGlobalPathPicker(addPathContainer, tabRoot, globalSecurity.paths, key, plugin, onRedisplay);
	});

	// ── Tags Section ──
	containerEl.createDiv({cls: 'kado-section-label', text: 'Tags'});

	const tagsContainer = containerEl.createDiv();

	for (let i = 0; i < key.tags.length; i++) {
		renderTagEntry(tagsContainer, key.tags[i] ?? '', {
			app: plugin.app,
			availableTags: globalSecurity.tags,
			onChange: (newTag) => {
				key.tags[i] = newTag;
				void plugin.saveSettings();
			},
			onRemove: () => {
				key.tags.splice(i, 1);
				void plugin.saveSettings();
				onRedisplay();
			},
		});
	}

	const addTagBtn = containerEl.createEl('button', {cls: 'kado-add-btn', text: '+ add tag'});
	addTagBtn.addEventListener('click', () => {
		if (globalSecurity.tags.length === 0) {
			new Notice('No tags defined in global security. Add tags there first.');
			return;
		}
		key.tags.push('');
		void plugin.saveSettings();
		onRedisplay();
	});
}

function renderKeyPathEntry(
	containerEl: HTMLElement,
	keyPath: PathPermission,
	maxPermissions: DataTypePermissions | undefined,
	listMode: ListMode,
	plugin: KadoPlugin,
	onRemove: () => void,
): void {
	const row = containerEl.createDiv({cls: 'kado-path-entry'});

	const removeBtn = row.createEl('button', {cls: 'kado-remove-btn', text: '\u2212', attr: {'aria-label': 'Remove path'}});
	removeBtn.addEventListener('click', onRemove);

	// Read-only path label (user picks from global, doesn't type)
	row.createEl('span', {
		cls: 'kado-path-input',
		text: keyPath.path || '(empty path)',
	});

	// Constrained permission matrix
	const matrixContainer = row.createDiv({cls: 'kado-path-matrix'});
	renderPermissionMatrix(matrixContainer, keyPath.permissions, {
		maxPermissions,
		listMode,
		onChange: () => void plugin.saveSettings(),
	});
}

function renderGlobalPathPicker(
	containerEl: HTMLElement,
	tabRoot: HTMLElement,
	globalPaths: PathPermission[],
	key: ApiKeyConfig,
	plugin: KadoPlugin,
	onRedisplay: () => void,
): void {
	if (globalPaths.length === 0) {
		new Notice('No global paths defined in global security. Add paths there first.');
		return;
	}

	// Inline picker rendered below the button
	const picker = containerEl.createDiv({cls: 'kado-picker-list'});
	const closeAbort = new AbortController();

	const closePicker = (): void => {
		closeAbort.abort();
		picker.remove();
	};

	// Adds a path to the key, guarding exact duplicates. Used both for whole
	// global paths and for narrowed subfolders.
	const addPath = (path: string): void => {
		if (key.paths.some(p => p.path === path)) {
			new Notice(`Path '${path}' is already assigned to this key.`);
			return;
		}
		key.paths.push({path, permissions: createDefaultPermissions()});
		void plugin.saveSettings();
		onRedisplay();
	};

	const assignedPaths = new Set(key.paths.map(p => p.path));

	for (const globalPath of globalPaths) {
		const row = picker.createDiv({cls: 'kado-picker-row'});

		// Add the whole global path (disabled once it's already assigned).
		const item = row.createEl('button', {cls: 'kado-picker-item', text: globalPath.path || '(empty)'});
		if (assignedPaths.has(globalPath.path)) {
			item.disabled = true;
			item.addClass('is-assigned');
		} else {
			item.addEventListener('click', () => addPath(globalPath.path));
		}

		// Narrow to a subfolder under this global path.
		const narrowBtn = row.createEl('button', {
			cls: 'kado-narrow-btn',
			text: '⊂ narrow',
			attr: {'aria-label': `Narrow ${globalPath.path || 'path'} to a subfolder`},
		});
		narrowBtn.addEventListener('click', () => {
			closePicker();
			new VaultFolderModal(plugin.app, (sub) => addPath(sub), folderPrefixOf(globalPath.path)).open();
		});
	}

	// Focus first item for keyboard accessibility
	const firstItem = picker.querySelector<HTMLElement>('.kado-picker-item');
	firstItem?.focus();

	// Close picker on outside click or Escape.
	// Listener is scoped to tabRoot (the API key tab content) instead of
	// the global document so it dies with the DOM when the tab is rebuilt
	// or the settings panel closes — no manual unregister required.
	// The setTimeout(0) defers registration to the next tick so the click
	// that opened the picker doesn't immediately close it.
	window.setTimeout(() => {
		tabRoot.addEventListener('click', (e: MouseEvent) => {
			if (!picker.contains(e.target as Node)) closePicker();
		}, {signal: closeAbort.signal});
	}, 0);
	picker.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Escape') closePicker();
	});
}

function renderDangerZone(
	containerEl: HTMLElement,
	key: ApiKeyConfig,
	config: KadoConfig,
	plugin: KadoPlugin,
	onSwitchTab: (tab: string) => void,
): void {
	const dangerZone = containerEl.createDiv({cls: 'kado-danger-zone'});
	new Setting(dangerZone)
		.setName('Delete API key')
		.setDesc('This cannot be undone.')
		.addButton(btn => btn
			.setButtonText('Delete key')
			.setWarning()
			.onClick(() => {
				new ConfirmModal(
					plugin.app,
					`Delete API key '${key.label}'?`,
					'This cannot be undone. All permissions for this key will be lost.',
					async () => {
						config.apiKeys = config.apiKeys.filter(k => k.id !== key.id);
						await plugin.saveSettings();
						onSwitchTab('general');
					},
				).open();
			}));
}

/** Simple confirmation modal with default = Cancel. */
export class ConfirmModal extends Modal {
	private readonly title: string;
	private readonly message: string;
	private readonly onConfirm: () => Promise<void>;

	constructor(app: InstanceType<typeof Modal>['app'], title: string, message: string, onConfirm: () => Promise<void>) {
		super(app);
		this.title = title;
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl('h3', {text: this.title, attr: {id: 'kado-confirm-title'}});
		contentEl.closest('[role="dialog"]')?.setAttribute('aria-labelledby', 'kado-confirm-title');
		contentEl.createEl('p', {text: this.message});

		const btnRow = contentEl.createDiv({cls: 'kado-confirm-buttons'});

		// Cancel is first (default focus)
		const cancelBtn = btnRow.createEl('button', {text: 'Cancel'});
		cancelBtn.addEventListener('click', () => this.close());

		const confirmBtn = btnRow.createEl('button', {text: 'Confirm', cls: 'mod-warning'});
		confirmBtn.addEventListener('click', () => {
			this.close();
			void this.onConfirm();
		});

		// Focus cancel button (default = No)
		cancelBtn.focus();
	}
}
