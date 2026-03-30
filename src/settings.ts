/**
 * KadoSettingTab — Obsidian settings UI for the Kado plugin.
 * Renders server, global areas, API keys, per-key config, and audit sections.
 */

import {App, PluginSettingTab, Setting} from 'obsidian';
import type KadoPlugin from './main';
import type {GlobalArea, ApiKeyConfig, DataTypePermissions, CrudFlags} from './types/canonical';
import {createDefaultPermissions} from './types/canonical';

const DATA_TYPE_LABELS: Array<{key: keyof DataTypePermissions; label: string}> = [
	{key: 'note', label: 'Note'},
	{key: 'frontmatter', label: 'Frontmatter'},
	{key: 'file', label: 'File'},
	{key: 'dataviewInlineField', label: 'Dataview'},
];

const CRUD_OPS: Array<{key: keyof CrudFlags; label: string}> = [
	{key: 'create', label: 'C'},
	{key: 'read', label: 'R'},
	{key: 'update', label: 'U'},
	{key: 'delete', label: 'D'},
];

export class KadoSettingTab extends PluginSettingTab {
	plugin: KadoPlugin;
	private expandedKeyId: string | null = null;
	private restarting = false;

	constructor(app: App, plugin: KadoPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		this.renderServerSection(containerEl);
		this.renderGlobalAreasSection(containerEl);
		this.renderApiKeysSection(containerEl);
		this.renderAuditSection(containerEl);
	}

	/** Public action: add a new global area. Called by UI button. */
	addArea(): void {
		const area: GlobalArea = {
			id: crypto.randomUUID(),
			label: '',
			pathPatterns: [],
			permissions: createDefaultPermissions(),
		};
		this.plugin.configManager.addGlobalArea(area);
		void this.plugin.saveSettings();
		this.display();
	}

	/** Public action: generate a new API key. Called by UI button. */
	generateKey(label: string): void {
		this.plugin.configManager.generateApiKey(label);
		void this.plugin.saveSettings();
		this.display();
	}

	/** Public action: revoke an API key. Called by UI button. */
	revokeKey(id: string): void {
		this.plugin.configManager.revokeKey(id);
		void this.plugin.saveSettings();
		this.display();
	}

	// ------------------------------------------------------------------
	// Section renderers
	// ------------------------------------------------------------------

	private renderServerSection(containerEl: HTMLElement): void {
		const config = this.plugin.configManager.getConfig();
		const server = config.server;
		const running = this.plugin.mcpServer?.isRunning() ?? false;

		new Setting(containerEl).setName('Server').setHeading();

		new Setting(containerEl)
			.setName('Status')
			.setDesc(running ? `Running on ${server.host}:${server.port}` : 'Stopped');

		new Setting(containerEl)
			.setName('Enable')
			.addToggle(toggle => toggle
				.setValue(server.enabled)
				.onChange(async (value) => {
					server.enabled = value;
					await this.handleServerToggle(value);
				}));

		new Setting(containerEl)
			.setName('Host')
			.addText(text => text
				.setValue(server.host)
				.onChange(async (value) => {
					server.host = value;
					await this.saveAndRestartIfRunning();
				}));

		new Setting(containerEl)
			.setName('Port')
			.addText(text => text
				.setValue(String(server.port))
				.onChange(async (value) => {
					const port = this.parsePort(value);
					if (port === null) return;
					server.port = port;
					await this.saveAndRestartIfRunning();
				}));
	}

	private renderGlobalAreasSection(containerEl: HTMLElement): void {
		const config = this.plugin.configManager.getConfig();

		new Setting(containerEl).setName('Global areas').setHeading();

		if (config.globalAreas.length === 0) {
			containerEl.createEl('p', {
				text: 'Kado starts in default-deny mode — no vault content is accessible until you create a global area and grant permissions.',
				cls: 'setting-item-description',
			});
		}

		new Setting(containerEl)
			.setName('Add area')
			.addButton(btn => btn
				.setButtonText('Add area')
				.onClick(() => this.addArea()));

		for (const area of config.globalAreas) {
			this.renderAreaCard(containerEl, area);
		}
	}

	private renderAreaCard(containerEl: HTMLElement, area: GlobalArea): void {
		containerEl.createEl('div', {cls: 'kado-area-card'});

		new Setting(containerEl)
			.setName('Label')
			.addText(text => text
				.setValue(area.label)
				.onChange(async (value) => {
					area.label = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Path patterns')
			.setDesc('Comma-separated globs')
			.addText(text => text
				.setValue(area.pathPatterns.join(', '))
				.onChange(async (value) => {
					area.pathPatterns = value.split(',').map(p => p.trim()).filter(Boolean);
					await this.plugin.saveSettings();
				}));

		this.renderCrudGrid(containerEl, area.permissions, async () => {
			await this.plugin.saveSettings();
		});

		new Setting(containerEl)
			.setName('Remove')
			.addButton(btn => btn
				.setButtonText('Remove')
				.setWarning()
				.onClick(() => {
					this.plugin.configManager.removeGlobalArea(area.id);
					void this.plugin.saveSettings();
					this.display();
				}));
	}

	private renderApiKeysSection(containerEl: HTMLElement): void {
		const config = this.plugin.configManager.getConfig();

		new Setting(containerEl).setName('API keys').setHeading();

		new Setting(containerEl)
			.setName('Generate key')
			.addButton(btn => btn
				.setButtonText('Generate key')
				.onClick(() => this.generateKey('New key')));

		for (const key of config.apiKeys) {
			this.renderKeyCard(containerEl, key);
		}
	}

	private renderKeyCard(containerEl: HTMLElement, key: ApiKeyConfig): void {
		const status = key.enabled ? 'Enabled' : 'Revoked';

		containerEl.createEl('div', {
			cls: 'kado-key-card',
			text: `${key.label} — ${key.id} — ${status}`,
		});

		new Setting(containerEl)
			.setName('Copy key ID')
			.setDesc(key.id)
			.addButton(btn => btn
				.setButtonText('Copy')
				.setIcon('copy')
				.onClick(() => navigator.clipboard.writeText(key.id)));

		if (key.enabled) {
			new Setting(containerEl)
				.setName('Revoke')
				.addButton(btn => btn
					.setButtonText('Revoke')
					.setWarning()
					.onClick(() => this.revokeKey(key.id)));
		}

		new Setting(containerEl)
			.setName('Configure')
			.addButton(btn => btn
				.setButtonText('Configure')
				.onClick(() => {
					this.expandedKeyId = this.expandedKeyId === key.id ? null : key.id;
					this.display();
				}));

		if (this.expandedKeyId === key.id) {
			this.renderKeyConfig(containerEl, key);
		}
	}

	private renderKeyConfig(containerEl: HTMLElement, key: ApiKeyConfig): void {
		const config = this.plugin.configManager.getConfig();

		new Setting(containerEl)
			.setName('Key label')
			.addText(text => text
				.setValue(key.label)
				.onChange(async (value) => {
					key.label = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Key enabled')
			.addToggle(toggle => toggle
				.setValue(key.enabled)
				.onChange(async (value) => {
					key.enabled = value;
					await this.plugin.saveSettings();
				}));

		for (const globalArea of config.globalAreas) {
			const keyArea = key.areas.find(a => a.areaId === globalArea.id);
			const assigned = keyArea !== undefined;

			new Setting(containerEl)
				.setName(globalArea.label || globalArea.id)
				.addToggle(toggle => toggle
					.setValue(assigned)
					.onChange(async (value) => {
						this.toggleKeyArea(key, globalArea, value);
						await this.plugin.saveSettings();
						this.display();
					}));

			if (keyArea) {
				this.renderCrudGrid(containerEl, keyArea.permissions, async () => {
					await this.plugin.saveSettings();
				}, globalArea.permissions);

				this.renderEffectivePermissions(containerEl, keyArea.permissions, globalArea);
			}
		}
	}

	private renderCrudGrid(
		containerEl: HTMLElement,
		permissions: DataTypePermissions,
		onSave: () => Promise<void>,
		maxPermissions?: DataTypePermissions,
	): void {
		for (const dt of DATA_TYPE_LABELS) {
			const flags = permissions[dt.key];
			for (const op of CRUD_OPS) {
				const disabled = maxPermissions !== undefined && !maxPermissions[dt.key][op.key];
				new Setting(containerEl)
					.setName(`${dt.label} ${op.label}`)
					.addToggle(toggle => {
						toggle.setValue(flags[op.key]);
						if (!disabled) {
							toggle.onChange(async (value) => {
								flags[op.key] = value;
								await onSave();
							});
						}
					});
			}
		}
	}

	private renderEffectivePermissions(
		containerEl: HTMLElement,
		keyPerms: DataTypePermissions,
		globalArea: GlobalArea,
	): void {
		const wrapper = containerEl.createEl('div', {cls: 'kado-effective-permissions'});

		new Setting(wrapper).setName('Effective permissions').setHeading();

		const patterns = globalArea.pathPatterns.join(', ') || '(no paths)';
		const permParts: string[] = [];
		for (const dt of DATA_TYPE_LABELS) {
			const ops = CRUD_OPS
				.filter(op => keyPerms[dt.key][op.key] && globalArea.permissions[dt.key][op.key])
				.map(op => op.label);
			if (ops.length > 0) {
				permParts.push(`${dt.label}: ${ops.join('')}`);
			}
		}
		const permSummary = permParts.length > 0 ? permParts.join(', ') : 'No permissions';

		new Setting(wrapper)
			.setName(`${globalArea.label || globalArea.id} — ${patterns}`)
			.setDesc(permSummary);
	}

	// ------------------------------------------------------------------
	// Audit section
	// ------------------------------------------------------------------

	private renderAuditSection(containerEl: HTMLElement): void {
		const config = this.plugin.configManager.getConfig();
		const audit = config.audit;

		new Setting(containerEl).setName('Audit').setHeading();

		new Setting(containerEl)
			.setName('Enable audit')
			.addToggle(toggle => toggle
				.setValue(audit.enabled)
				.onChange(async (value) => {
					audit.enabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Log path')
			.addText(text => text
				.setValue(audit.logFilePath)
				.onChange(async (value) => {
					audit.logFilePath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max size (mb)')
			.addText(text => text
				.setValue(String(Math.round(audit.maxSizeBytes / (1024 * 1024))))
				.onChange(async (value) => {
					const mb = Number(value);
					if (!Number.isFinite(mb) || mb <= 0) return;
					audit.maxSizeBytes = mb * 1024 * 1024;
					await this.plugin.saveSettings();
				}));
	}

	// ------------------------------------------------------------------
	// Helpers
	// ------------------------------------------------------------------

	private parsePort(value: string): number | null {
		const port = Number(value);
		if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
		return port;
	}

	private async handleServerToggle(enabled: boolean): Promise<void> {
		await this.plugin.saveSettings();
		if (enabled) {
			const config = this.plugin.configManager.getConfig();
			await this.plugin.mcpServer.start(config.server);
		} else {
			await this.plugin.mcpServer.stop();
		}
		this.display();
	}

	private async saveAndRestartIfRunning(): Promise<void> {
		if (this.restarting) return;
		this.restarting = true;
		try {
			await this.plugin.saveSettings();
			if (this.plugin.mcpServer?.isRunning()) {
				await this.plugin.mcpServer.stop();
				await this.plugin.mcpServer.start(this.plugin.configManager.getConfig().server);
			}
		} finally {
			this.restarting = false;
		}
	}

	private toggleKeyArea(key: ApiKeyConfig, globalArea: GlobalArea, assign: boolean): void {
		if (assign) {
			key.areas.push({
				areaId: globalArea.id,
				permissions: createDefaultPermissions(),
			});
		} else {
			key.areas = key.areas.filter(a => a.areaId !== globalArea.id);
		}
	}
}
