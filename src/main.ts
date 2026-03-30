/**
 * KadoPlugin — Obsidian MCP Gateway plugin entry point.
 * Wires together ConfigManager, all adapters, OperationRouter, permission
 * chain, and KadoMcpServer.  Manages plugin lifecycle.
 */

import {Plugin} from 'obsidian';
import {KadoSettingTab} from './settings';
import type {KadoConfig} from './types/canonical';
import {ConfigManager} from './core/config-manager';
import {KadoMcpServer} from './mcp/server';
import {registerTools} from './mcp/tools';
import {createDefaultGateChain} from './core/permission-chain';
import {createOperationRouter} from './core/operation-router';
import {createNoteAdapter} from './obsidian/note-adapter';
import {createFrontmatterAdapter} from './obsidian/frontmatter-adapter';
import {createFileAdapter} from './obsidian/file-adapter';
import {createInlineFieldAdapter} from './obsidian/inline-field-adapter';
import {createSearchAdapter} from './obsidian/search-adapter';

export default class KadoPlugin extends Plugin {
	settings: KadoConfig;
	private configManager!: ConfigManager;

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

		const mcpServer = new KadoMcpServer(
			this.configManager,
			(server) => registerTools(server, {configManager: this.configManager, gates, router, getFileMtime}),
		);

		if (this.configManager.getConfig().server.enabled) {
			await mcpServer.start(this.configManager.getConfig().server);
		}

		this.register(() => mcpServer.stop());
		this.addSettingTab(new KadoSettingTab(this.app, this));
	}

	onunload(): void {}

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

	/** Persist current settings via ConfigManager. */
	async saveSettings(): Promise<void> {
		await this.configManager.save();
	}
}
