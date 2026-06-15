/**
 * RenameRiskModal — confirmation shown when the user enables the kado-rename tool
 * while Obsidian's "Automatically update internal links" setting is OFF.
 *
 * Renaming through the MCP server then risks Obsidian's blocking "update links?"
 * dialog, which an AI caller cannot answer — so the rename will time out. The user
 * must explicitly acknowledge this trade-off before the tool is enabled.
 */

import {App, Modal, Setting} from 'obsidian';

const DOCS_URL = 'https://github.com/MMoMM-org/miyo-kado/blob/master/docs/api-reference.md#tool-kado-rename';

export class RenameRiskModal extends Modal {
	private readonly onConfirm: () => void;

	constructor(app: App, onConfirm: () => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass('kado-rename-risk');

		this.setTitle('Enable rename without auto-update links?');

		contentEl.createEl('p', {text:
			'Obsidian’s "Automatically update internal links" setting is currently off. '
			+ 'When it is off, renaming or moving a file pops a confirmation dialog asking whether '
			+ 'to update links. An AI calling kado-rename cannot answer that dialog, so the rename '
			+ 'will block until the timeout and then return a TIMEOUT error.',
		});
		contentEl.createEl('p', {text:
			'Recommended: turn on "Automatically update internal links" in Obsidian '
			+ '(Settings → Files and links) instead — then renames work reliably and backlinks '
			+ 'are updated automatically.',
		});

		const docsP = contentEl.createEl('p');
		docsP.append('Enable anyway only if you accept occasional TIMEOUT results. ');
		const link = docsP.createEl('a', {text: 'Learn more'});
		link.href = DOCS_URL;
		link.target = '_blank';
		docsP.append('.');

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Cancel')
				.onClick(() => this.close()))
			.addButton(btn => btn
				.setButtonText('Enable anyway')
				.setWarning()
				.onClick(() => {
					this.onConfirm();
					this.close();
				}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
