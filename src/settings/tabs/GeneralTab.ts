/**
 * GeneralTab — server config, API key creation, and audit logging.
 */

import {Notice, Setting} from 'obsidian';
import type KadoPlugin from '../../main';
import {VaultFolderModal} from '../components/VaultFolderModal';
import {RenameRiskModal} from '../components/RenameRiskModal';
import {getAlwaysUpdateLinks} from '../../obsidian/vault-config';

export function renderGeneralTab(containerEl: HTMLElement, plugin: KadoPlugin, onRedisplay: () => void): void {
	const config = plugin.configManager.getConfig();
	const server = config.server;
	const running = plugin.mcpServer?.isRunning() ?? false;

	// ── Server Section ──
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
				await plugin.saveSettings();
				if (value) {
					await plugin.mcpServer.start(config.server);
				} else {
					await plugin.mcpServer.stop();
				}
				plugin.syncServerStatusBar();
				onRedisplay();
			}));

	// Connection type
	const connSetting = new Setting(containerEl).setName('Connection type');
	if (running) {
		connSetting.setDesc(`Locked while server is running (${server.connectionType})`);
	} else {
		connSetting.addDropdown(drop => drop
			.addOption('local', 'Local (127.0.0.1)')
			.addOption('public', 'Public')
			.setValue(server.connectionType)
			.onChange(async (value) => {
				server.connectionType = value as 'local' | 'public';
				if (value === 'local') {
					server.host = '127.0.0.1';
				}
				await plugin.saveSettings();
				onRedisplay();
			}));
	}

	// IP address (only for public mode, disabled when running)
	if (server.connectionType === 'public' && !running) {
		new Setting(containerEl)
			.setName('Bind address')
			.addDropdown(drop => {
				drop.addOption('0.0.0.0', '0.0.0.0 (all interfaces)');
				drop.addOption('127.0.0.1', '127.0.0.1 (localhost)');
				drop.setValue(server.host);
				drop.onChange(async (value) => {
					server.host = value;
					await plugin.saveSettings();
				});
			});
	}

	// Port
	const portSetting = new Setting(containerEl).setName('Port');
	if (running) {
		portSetting.setDesc(`${server.port} (locked while running)`);
	} else {
		portSetting.addText(text => text
			.setValue(String(server.port))
			.onChange(async (value) => {
				const port = Number(value);
				if (!Number.isInteger(port) || port < 1 || port > 65535) return;
				server.port = port;
				await plugin.saveSettings();
			}));
	}

	// Rate limit — applied live (no restart needed); editable while running.
	// NOTE: no onRedisplay() here — re-rendering the tab on each keystroke would
	// recreate the input and steal focus mid-typing (can't type a second digit).
	new Setting(containerEl)
		.setName('Rate limit (requests per window)')
		.setDesc('Max requests per IP within each window. 0 = disabled.')
		.addText(text => text
			.setValue(String(server.rateLimitMaxRequests))
			.onChange(async (value) => {
				const max = Number(value);
				if (!Number.isInteger(max) || max < 0) return;
				server.rateLimitMaxRequests = max;
				await plugin.saveSettings();
			}));

	new Setting(containerEl)
		.setName('Rate limit window (seconds)')
		.setDesc('Length of each rate-limit window before the counter resets')
		.addText(text => text
			.setValue(String(server.rateLimitWindowSeconds))
			.onChange(async (value) => {
				const secs = Number(value);
				if (!Number.isInteger(secs) || secs < 1) return;
				server.rateLimitWindowSeconds = secs;
				await plugin.saveSettings();
			}));

	// ── API Keys Section ──
	new Setting(containerEl).setName('API keys').setHeading();

	new Setting(containerEl)
		.setName('Create API key')
		.addButton(btn => btn
			.setButtonText('Create API key')
			.setCta()
			.onClick(() => {
				plugin.configManager.generateApiKey('New key');
				void plugin.saveSettings();
				onRedisplay();
			}));

	// ── Rename Tool Section ──
	new Setting(containerEl).setName('Rename').setHeading();

	const autoUpdateLinks = getAlwaysUpdateLinks(plugin.app);
	if (autoUpdateLinks) {
		// Safe case: Obsidian updates links silently, so kado-rename is registered and reliable.
		new Setting(containerEl)
			.setName('Rename tool')
			.setDesc('Obsidian updates internal links automatically. Renaming is enabled.');
	} else {
		// Auto-update-links is OFF: rename would hit Obsidian's blocking confirmation dialog.
		const riskDesc = containerEl.ownerDocument.createDocumentFragment();
		riskDesc.append('While auto-update-links is off, kado-rename is not exposed. Turn on to expose it anyway — renaming works, but each rename prompts a link-update dialog and inbound links update only when you answer it. ');
		const riskLink = containerEl.ownerDocument.createElement('a');
		riskLink.textContent = 'Details';
		riskLink.href = 'https://github.com/MMoMM-org/miyo-kado/blob/master/docs/api-reference.md#tool-kado-rename';
		riskLink.target = '_blank';
		riskDesc.appendChild(riskLink);
		riskDesc.append('.');

		new Setting(containerEl)
			.setName('Enable rename when auto-update-links is off')
			.setDesc(riskDesc)
			.addToggle(toggle => toggle
				.setValue(config.renameWhenLinkUpdateOff)
				.onChange((value) => {
					if (value) {
						// Require explicit acknowledgement before enabling.
						new RenameRiskModal(plugin.app, {
							onConfirm: () => {
								config.renameWhenLinkUpdateOff = true;
								config.renameWarningAcknowledged = true;
								void plugin.saveSettings().then(() => onRedisplay());
							},
						}).open();
						// Revert the visual toggle until the modal confirms (redisplay reflects truth).
						toggle.setValue(false);
					} else {
						config.renameWhenLinkUpdateOff = false;
						void plugin.saveSettings().then(() => onRedisplay());
					}
				}));

		if (config.renameWhenLinkUpdateOff) {
			new Setting(containerEl)
				.setName('Rename timeout')
				.setDesc('Seconds to wait for the link-update dialog before the call returns (the file is already renamed by then; default 60).')
				.addText(text => text
					.setValue(String(Math.round(config.renameTimeoutMs / 1000)))
					.onChange(async (value) => {
						const secs = Number(value);
						if (!Number.isFinite(secs) || secs <= 0) return;
						config.renameTimeoutMs = Math.round(secs * 1000);
						await plugin.saveSettings();
					}));
		}
	}

	// ── Audit Logging Section ──
	const audit = config.audit;

	new Setting(containerEl).setName('Audit logging').setHeading();

	new Setting(containerEl)
		.setName('Enable audit logging')
		.addToggle(toggle => toggle
			.setValue(audit.enabled)
			.onChange(async (value) => {
				audit.enabled = value;
				await plugin.saveSettings();
			}));

	// Log directory with browse
	const dirSetting = new Setting(containerEl).setName('Log directory');
	dirSetting.addText(text => text
		.setValue(audit.logDirectory)
		.setPlaceholder('Logs')
		.onChange(async (value) => {
			if (value.includes('..') || value.startsWith('/')) {
				new Notice('Invalid path: must be vault-relative, no ".." allowed');
				return;
			}
			audit.logDirectory = value;
			await plugin.saveSettings();
		}));
	dirSetting.addButton(btn => btn
		.setButtonText('Browse')
		.onClick(() => {
			new VaultFolderModal(plugin.app, (path) => {
				audit.logDirectory = path;
				void plugin.saveSettings().then(() => onRedisplay());
			}).open();
		}));

	// Log filename
	new Setting(containerEl)
		.setName('Log filename')
		.addText(text => text
			.setValue(audit.logFileName)
			.setPlaceholder('Kado-audit.log')
			.onChange(async (value) => {
				audit.logFileName = value;
				await plugin.saveSettings();
			}));

	// Max size
	new Setting(containerEl)
		.setName('Max log size')
		.setDesc('Size in megabytes at which the log rotates.')
		.addText(text => text
			.setValue(String(Math.round(audit.maxSizeBytes / (1024 * 1024))))
			.onChange(async (value) => {
				const mb = Number(value);
				if (!Number.isFinite(mb) || mb <= 0) return;
				audit.maxSizeBytes = mb * 1024 * 1024;
				await plugin.saveSettings();
			}));

	// Max retained logs
	new Setting(containerEl)
		.setName('Max retained logs')
		.setDesc('Number of rotated log files to keep')
		.addText(text => text
			.setValue(String(audit.maxRetainedLogs))
			.onChange(async (value) => {
				const n = Number(value);
				if (!Number.isInteger(n) || n < 1) return;
				audit.maxRetainedLogs = n;
				await plugin.saveSettings();
			}));

	// View log button
	if (audit.enabled) {
		new Setting(containerEl)
			.setName('View audit log')
			.addButton(btn => btn
				.setButtonText('View log')
				.onClick(async () => {
					const logPath = `${audit.logDirectory}/${audit.logFileName}`;
					const file = plugin.app.vault.getFileByPath(logPath);
					if (file) {
						await plugin.app.workspace.openLinkText(logPath, '');
					} else {
						new Notice('Audit log file not found');
					}
				}));
	}

	// ── Developer Section ──
	new Setting(containerEl).setName('Developer').setHeading();

	const debugDesc = containerEl.ownerDocument.createDocumentFragment();
	debugDesc.append('Emit debug messages to the developer console (off by default). Requires the developer tools "Verbose" log level — see ');
	const debugDocLink = containerEl.ownerDocument.createElement('a');
	debugDocLink.textContent = 'Setup guide';
	debugDocLink.href = 'https://github.com/MMoMM-org/miyo-kado/blob/master/docs/debug-logging.md';
	debugDocLink.target = '_blank';
	debugDesc.appendChild(debugDocLink);
	debugDesc.append('.');

	new Setting(containerEl)
		.setName('Debug logging')
		.setDesc(debugDesc)
		.addToggle(toggle => toggle
			.setValue(config.debugLogging)
			.onChange(async (value) => {
				config.debugLogging = value;
				await plugin.saveSettings();
			}));
}
