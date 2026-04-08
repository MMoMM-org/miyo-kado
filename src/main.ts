/**
 * KadoPlugin — Obsidian MCP Gateway plugin entry point.
 * Wires together ConfigManager, all adapters, OperationRouter, permission
 * chain, and KadoMcpServer.  Manages plugin lifecycle.
 */

import {Plugin} from 'obsidian';
import {KadoSettingsTab} from './settings/SettingsTab';
import type {KadoConfig} from './types/canonical';
import {ConfigManager} from './core/config-manager';
import {KadoMcpServer} from './mcp/server';
import {kadoLog, kadoError, setDebugLogging} from './core/logger';
import {registerTools} from './mcp/tools';
import {createDefaultGateChain} from './core/permission-chain';
import {createOperationRouter} from './core/operation-router';
import {createNoteAdapter} from './obsidian/note-adapter';
import {createFrontmatterAdapter} from './obsidian/frontmatter-adapter';
import {createFileAdapter} from './obsidian/file-adapter';
import {createInlineFieldAdapter} from './obsidian/inline-field-adapter';
import {createSearchAdapter} from './obsidian/search-adapter';
import {AuditLogger} from './core/audit-logger';

/** Reject paths with traversal or absolute path components to prevent log injection. */
function sanitizePath(raw: string): string {
	if (raw.includes('..') || raw.startsWith('/') || raw.startsWith('\\')) {
		return '';
	}
	return raw;
}

export default class KadoPlugin extends Plugin {
	settings!: KadoConfig;
	configManager!: ConfigManager;
	mcpServer!: KadoMcpServer;
	private auditLogger!: AuditLogger;
	private settingsTab!: KadoSettingsTab;

	/** Resolve the audit log path relative to the vault root. */
	private get resolvedAuditLogPath(): string {
		const audit = this.configManager.getConfig().audit;
		const dir = sanitizePath(audit.logDirectory) || 'logs';
		const file = sanitizePath(audit.logFileName) || 'kado-audit.log';
		return `${dir}/${file}`;
	}

	async onload(): Promise<void> {
		this.configManager = new ConfigManager(
			this.loadData.bind(this),
			this.saveData.bind(this),
		);
		await this.configManager.load();
		this.settings = this.configManager.getConfig();
		setDebugLogging(this.settings.debugLogging);

		const registry = {
			note: createNoteAdapter(this.app),
			frontmatter: createFrontmatterAdapter(this.app),
			file: createFileAdapter(this.app),
			'dataview-inline-field': createInlineFieldAdapter(this.app),
			search: createSearchAdapter(this.app),
		};

		const router = createOperationRouter(registry);
		const gates = createDefaultGateChain();
		const getFileMtime = (path: string): number | undefined =>
			this.app.vault.getFileByPath(path)?.stat.mtime;

		const auditConfig = this.configManager.getConfig().audit;
		let writeChain = Promise.resolve();
		const adapter = this.app.vault.adapter;
		this.auditLogger = new AuditLogger(auditConfig, {
			write: (line: string) => {
				const logPath = this.resolvedAuditLogPath;
				writeChain = writeChain.then(async () => {
					// Ensure the log directory exists before writing
					const dir = logPath.substring(0, logPath.lastIndexOf('/'));
					if (dir) {
						const dirExists = await adapter.exists(dir);
						if (!dirExists) {
							await this.app.vault.createFolder(dir).catch(() => {/* already exists */});
						}
					}
					const existing = await adapter.read(logPath).catch(() => '');
					await adapter.write(logPath, existing + line);
				}).catch(err => kadoError('audit write failed', {error: String(err)}));
				return writeChain;
			},
			getSize: (): Promise<number> => {
				const sizePromise = writeChain.then(async () => {
					return (await adapter.stat(this.resolvedAuditLogPath))?.size ?? 0;
				});
				writeChain = sizePromise.then(() => {}).catch(err => kadoError('audit getSize failed', {error: String(err)}));
				return sizePromise.catch(() => 0);
			},
			exists: (path: string) => {
				const existsPromise = writeChain.then(async () => {
					const stat = await adapter.stat(path);
					return stat !== null;
				});
				writeChain = existsPromise.then(() => {}).catch(err => kadoError('audit exists failed', {error: String(err)}));
				return existsPromise.catch(() => false);
			},
			rename: (from: string, to: string) => {
				writeChain = writeChain.then(() => adapter.rename(from, to))
					.catch(err => kadoError('audit rename failed', {error: String(err)}));
				return writeChain;
			},
			remove: (path: string) => {
				writeChain = writeChain.then(() => adapter.remove(path))
					.catch(err => kadoError('audit remove failed', {error: String(err)}));
				return writeChain;
			},
			getLogPath: () => this.resolvedAuditLogPath,
		});

		this.mcpServer = new KadoMcpServer(
			this.configManager,
			(server) => registerTools(server, {configManager: this.configManager, gates, router, getFileMtime, auditLogger: this.auditLogger}),
			this.manifest.version,
		);
		this.register(() => this.mcpServer.stop());

		if (this.configManager.getConfig().server.enabled) {
			await this.mcpServer.start(this.configManager.getConfig().server);
		}
		this.settingsTab = new KadoSettingsTab(this.app, this);
		this.addSettingTab(this.settingsTab);
		kadoLog('Plugin loaded', {version: this.manifest.version});
	}

	onunload(): void {
		// Explicitly stop the MCP server so a subsequent onload() can rebind the port.
		// The registered cleanup callback also calls stop(), but during a hot-reload
		// the timing may allow the new onload() to race against it.
		void this.mcpServer?.stop();
		kadoLog('Plugin unloaded');
	}

	/**
	 * Called by Obsidian when plugin files change on disk (hot-reload).
	 * Re-reads config and refreshes the settings UI if it's open.
	 */
	async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();
		this.settingsTab?.display();
	}

	/** Reload settings from storage and sync to this.settings. */
	async loadSettings(): Promise<void> {
		await this.configManager.load();
		this.settings = this.configManager.getConfig();
	}

	/** Persist current settings via ConfigManager and sync AuditLogger + logger config. */
	async saveSettings(): Promise<void> {
		await this.configManager.save();
		const cfg = this.configManager.getConfig();
		this.auditLogger?.updateConfig(cfg.audit);
		setDebugLogging(cfg.debugLogging);
	}
}
