/**
 * RenameRiskModal — warns that kado-rename is disabled while Obsidian's
 * "Automatically update internal links" setting is off.
 *
 * Shown two ways:
 *  - automatically on plugin load when auto-update-links is off (informational
 *    warning, so the user knows rename won't work until they act), and
 *  - when the user turns on the "Enable rename when auto-update-links is off"
 *    toggle in settings (explicit confirmation).
 *
 * Renaming through the MCP server then risks Obsidian's blocking "update links?"
 * dialog, which an AI caller cannot answer — so the rename will time out. The user
 * must explicitly choose to enable it anyway. Closing the modal without choosing
 * leaves everything unchanged.
 */

import {App, Modal, Setting} from 'obsidian';
import {openFilesAndLinksSettings} from '../../obsidian/vault-config';

const DOCS_URL = 'https://github.com/MMoMM-org/miyo-kado/blob/master/docs/api-reference.md#tool-kado-rename';

export interface RenameRiskOptions {
	/** Called when the user chooses to enable rename despite the risk. */
	onConfirm: () => void;
	/** Called when the user explicitly declines (e.g. "Don't show again"). Optional. */
	onDismiss?: () => void;
	title?: string;
	confirmLabel?: string;
	dismissLabel?: string;
}

export class RenameRiskModal extends Modal {
	private readonly opts: RenameRiskOptions;

	constructor(app: App, opts: RenameRiskOptions) {
		super(app);
		this.opts = opts;
	}

	onOpen(): void {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass('kado-rename-risk');

		this.setTitle(this.opts.title ?? 'Enable rename without auto-update links?');

		contentEl.createEl('p', {text:
			'Obsidian’s "Automatically update internal links" setting is currently off. '
			+ 'While it is off, the kado-rename tool is disabled — renaming or moving a file '
			+ 'pops a confirmation dialog asking whether to update links, and an AI calling '
			+ 'kado-rename cannot answer it, so the rename would block until the timeout and '
			+ 'return a TIMEOUT error.',
		});
		contentEl.createEl('p', {text:
			'Recommended: turn on "Automatically update internal links" in Obsidian '
			+ '(Settings → Files and links). Then renames work reliably and backlinks '
			+ 'are updated automatically — no need to enable anything here.',
		});

		const docsP = contentEl.createEl('p');
		docsP.append('Enable anyway only if you accept occasional TIMEOUT results. ');
		const link = docsP.createEl('a', {text: 'Learn more'});
		link.href = DOCS_URL;
		link.target = '_blank';
		docsP.append('.');

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Open Obsidian settings')
				.setCta()
				.onClick(() => {
					this.close();
					openFilesAndLinksSettings(this.app);
				}))
			.addButton(btn => btn
				.setButtonText(this.opts.dismissLabel ?? 'Cancel')
				.onClick(() => {
					this.opts.onDismiss?.();
					this.close();
				}))
			.addButton(btn => btn
				.setButtonText(this.opts.confirmLabel ?? 'Enable anyway')
				.setWarning()
				.onClick(() => {
					this.opts.onConfirm();
					this.close();
				}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
