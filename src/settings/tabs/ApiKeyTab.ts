/**
 * ApiKeyTab — per-key management: rename, copy, regenerate, area assignments, delete.
 */

import {Modal, Notice, Setting} from 'obsidian';
import type KadoPlugin from '../../main';
import type {ApiKeyConfig, GlobalArea} from '../../types/canonical';
import {createDefaultPermissions} from '../../types/canonical';
import {renderPermissionMatrix} from '../components/PermissionMatrix';
import {renderTagEntry} from '../components/TagEntry';

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

	// ── Key Management ──
	new Setting(containerEl).setName('Key management').setHeading();

	// Rename
	new Setting(containerEl)
		.setName('Key name')
		.addText(text => text
			.setValue(key.label)
			.onChange(() => { /* defer to rename button */ }))
		.addButton(btn => btn
			.setButtonText('Rename')
			.onClick(async () => {
				const input = containerEl.querySelector<HTMLInputElement>('.setting-item:nth-child(2) input');
				if (input) {
					key.label = input.value;
					await plugin.saveSettings();
					onRedisplay();
				}
			}));

	// Key display + copy
	const keyDisplay = new Setting(containerEl).setName('API key');
	keyDisplay.descEl.createSpan({cls: 'kado-key-display', text: key.id});
	keyDisplay.addButton(btn => {
		btn.setButtonText('Copy');
		btn.onClick(() => {
			void navigator.clipboard.writeText(key.id).then(
				() => {
					btn.setButtonText('Copied!');
					setTimeout(() => { btn.setButtonText('Copy'); }, 1500);
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

	// ── Area Assignments ──
	new Setting(containerEl).setName('Area assignments').setHeading();

	if (config.globalAreas.length === 0) {
		containerEl.createEl('p', {
			text: 'No global areas defined. Create areas in the global security tab first.',
			cls: 'setting-item-description',
		});
	}

	for (const area of config.globalAreas) {
		renderAreaAssignment(containerEl, key, area, plugin, onRedisplay);
	}

	// ── Effective Permissions ──
	if (key.areas.length > 0) {
		new Setting(containerEl).setName('Effective permissions').setHeading();

		for (const keyArea of key.areas) {
			const globalArea = config.globalAreas.find(a => a.id === keyArea.areaId);
			if (!globalArea) continue;
			renderEffectivePermissions(containerEl, key, globalArea);
		}
	}

	// ── Danger Zone ──
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

function renderAreaAssignment(
	containerEl: HTMLElement,
	key: ApiKeyConfig,
	area: GlobalArea,
	plugin: KadoPlugin,
	onRedisplay: () => void,
): void {
	const keyArea = key.areas.find(a => a.areaId === area.id);
	const assigned = keyArea !== undefined;

	const setting = new Setting(containerEl)
		.setName(area.label || area.id);

	// Show inherited list mode as label
	setting.descEl.createSpan({
		cls: 'kado-inherited-label',
		text: area.listMode === 'whitelist' ? 'Whitelist' : 'Blacklist',
	});

	setting.addToggle(toggle => toggle
		.setValue(assigned)
		.onChange(async (value) => {
			if (value) {
				key.areas.push({
					areaId: area.id,
					permissions: createDefaultPermissions(),
					tags: [...area.tags],
				});
			} else {
				key.areas = key.areas.filter(a => a.areaId !== area.id);
			}
			await plugin.saveSettings();
			onRedisplay();
		}));

	if (keyArea) {
		// Constrained permission matrix
		const matrixContainer = containerEl.createDiv({cls: 'kado-area-assignment-detail'});
		renderPermissionMatrix(matrixContainer, keyArea.permissions, {
			maxPermissions: area.permissions,
			onChange: () => void plugin.saveSettings(),
		});

		// Tags (filtered to global area's tags)
		if (area.tags.length > 0) {
			matrixContainer.createDiv({cls: 'kado-section-label', text: 'Tags'});

			for (let i = 0; i < keyArea.tags.length; i++) {
				renderTagEntry(matrixContainer, keyArea.tags[i] ?? '', {
					app: plugin.app,
					availableTags: area.tags,
					onChange: (newTag) => {
						keyArea.tags[i] = newTag;
						void plugin.saveSettings();
					},
					onRemove: () => {
						keyArea.tags.splice(i, 1);
						void plugin.saveSettings();
						onRedisplay();
					},
				});
			}

			// Only allow adding tags that exist in the global area
			const addTagBtn = matrixContainer.createEl('button', {cls: 'kado-add-btn', text: '+ add tag'});
			addTagBtn.addEventListener('click', () => {
				keyArea.tags.push('');
				void plugin.saveSettings();
				onRedisplay();
			});
		}

		// Blacklist warning for key when area is blacklist with zero rules
		if (area.listMode === 'blacklist' && area.pathPatterns.length === 0 && area.tags.length === 0) {
			containerEl.createDiv({
				cls: 'kado-listmode-warning',
				text: '\u26a0 This area is in blacklist mode with no rules — grants full access',
			});
		}
	}
}

function renderEffectivePermissions(
	containerEl: HTMLElement,
	key: ApiKeyConfig,
	globalArea: GlobalArea,
): void {
	const keyArea = key.areas.find(a => a.areaId === globalArea.id);
	if (!keyArea) return;

	const wrapper = containerEl.createDiv({cls: 'kado-effective-perms'});
	const label = `${globalArea.label || globalArea.id} (${globalArea.listMode})`;
	const paths = globalArea.pathPatterns.join(', ') || '(no paths)';

	const info = wrapper.createDiv({cls: 'setting-item-description'});
	info.createEl('strong', {text: label});
	info.createEl('br');
	info.createSpan({text: `Paths: ${paths}`});

	// Read-only intersection matrix
	const matrixContainer = wrapper.createDiv({cls: 'kado-effective-matrix'});
	// Compute intersection: only show permissions that both key and area allow
	const intersected = createDefaultPermissions();
	const resources = ['note', 'frontmatter', 'dataviewInlineField', 'file'] as const;
	const ops = ['create', 'read', 'update', 'delete'] as const;
	for (const r of resources) {
		for (const o of ops) {
			intersected[r][o] = keyArea.permissions[r][o] && globalArea.permissions[r][o];
		}
	}
	renderPermissionMatrix(matrixContainer, intersected, {readOnly: true, onChange: () => {}});
}

/** Simple confirmation modal with default = Cancel. */
class ConfirmModal extends Modal {
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
		contentEl.createEl('h3', {text: this.title});
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
