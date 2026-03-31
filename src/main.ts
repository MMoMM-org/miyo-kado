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
import {kadoLog} from './core/logger';
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
					const existing = await adapter.read(logPath).catch(() => '');
					await adapter.write(logPath, existing + line);
				});
				return writeChain;
			},
			getSize: () => {
				let size = 0;
				writeChain = writeChain.then(async () => {
					size = (await adapter.stat(this.resolvedAuditLogPath))?.size ?? 0;
				});
				return writeChain.then(() => size);
			},
			exists: (path: string) => {
				return writeChain.then(async () => {
					const stat = await adapter.stat(path);
					return stat !== null;
				});
			},
			rename: (from: string, to: string) => {
				writeChain = writeChain.then(() => adapter.rename(from, to));
				return writeChain;
			},
			remove: (path: string) => {
				writeChain = writeChain.then(() => adapter.remove(path));
				return writeChain;
			},
			getLogPath: () => this.resolvedAuditLogPath,
		});

		this.mcpServer = new KadoMcpServer(
			this.configManager,
			(server) => registerTools(server, {configManager: this.configManager, gates, router, getFileMtime, auditLogger: this.auditLogger}),
		);
		this.register(() => this.mcpServer.stop());

		if (this.configManager.getConfig().server.enabled) {
			await this.mcpServer.start(this.configManager.getConfig().server);
		}
		this.addSettingTab(new KadoSettingsTab(this.app, this));
		kadoLog('Plugin loaded', {version: this.manifest.version});
	}

	onunload(): void {
		kadoLog('Plugin unloaded');
	}

	/** Reload settings from storage and sync to this.settings. */
	async loadSettings(): Promise<void> {
		if (!this.configManager) {
			this.configManager = new ConfigManager(
				this.loadData.bind(this),
				this.saveData.bind(this),
			);
		}
		await this.configManager.load();
		this.settings = this.configManager.getConfig();
	}

	/** Persist current settings via ConfigManager and sync AuditLogger config. */
	async saveSettings(): Promise<void> {
		await this.configManager.save();
		this.auditLogger.updateConfig(this.configManager.getConfig().audit);
	}
}
