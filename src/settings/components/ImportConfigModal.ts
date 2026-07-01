/**
 * ImportConfigModal — confirmation + selective apply for a config import (#84).
 *
 * Shows what the import file contains and lets the user choose which sections to
 * restore: General settings, Global security, and individual API keys. Nothing
 * is applied until the user confirms; closing without confirming is a no-op.
 */

import {App, Modal, Setting} from 'obsidian';
import type {ImportSelection, ImportSummary} from '../../core/config-portability';

export interface ImportConfigOptions {
	summary: ImportSummary;
	/** Called with the chosen sections when the user confirms. */
	onConfirm: (selection: ImportSelection) => void;
}

export class ImportConfigModal extends Modal {
	private readonly opts: ImportConfigOptions;
	private general = true;
	private security = true;
	private readonly keySelected = new Map<string, boolean>();

	constructor(app: App, opts: ImportConfigOptions) {
		super(app);
		this.opts = opts;
		for (const k of opts.summary.keys) this.keySelected.set(k.id, true);
	}

	onOpen(): void {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass('kado-import-modal');
		this.setTitle('Import configuration');

		const {summary} = this.opts;
		if (summary.exportedAt) {
			contentEl.createEl('p', {
				cls: 'setting-item-description',
				text: `Exported ${new Date(summary.exportedAt).toLocaleString()}.`,
			});
		}
		contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'Choose what to restore. Selected sections replace the matching parts of your current configuration; keys are matched by their ID (same ID is overwritten, a new one is added).',
		});

		new Setting(contentEl)
			.setName('General settings')
			.setDesc('Server, rate limits, audit logging, rename, and debug options.')
			.addToggle((t) => t.setValue(this.general).onChange((v) => {
				this.general = v;
			}));

		new Setting(contentEl)
			.setName('Global security')
			.setDesc(`${summary.security.listMode} · ${summary.security.paths} path(s) · ${summary.security.tags} tag(s)`)
			.addToggle((t) => t.setValue(this.security).onChange((v) => {
				this.security = v;
			}));

		if (summary.keys.length > 0) {
			new Setting(contentEl).setName('API keys').setHeading();
			for (const key of summary.keys) {
				new Setting(contentEl)
					.setName(key.label || '(unnamed key)')
					.setDesc(`${key.id}${key.enabled ? '' : ' · disabled'}`)
					.addToggle((t) => t.setValue(true).onChange((v) => {
						this.keySelected.set(key.id, v);
					}));
			}
		}

		new Setting(contentEl)
			.addButton((btn) => btn
				.setButtonText('Cancel')
				.onClick(() => this.close()))
			.addButton((btn) => btn
				.setButtonText('Import selected')
				.setCta()
				.onClick(() => {
					const keyIds = [...this.keySelected.entries()].filter(([, on]) => on).map(([id]) => id);
					this.opts.onConfirm({general: this.general, security: this.security, keyIds});
					this.close();
				}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
