/**
 * VaultFolderModal — directory picker using Obsidian's Modal class.
 *
 * Shows all vault folders in a filterable list. Selecting a folder
 * returns its vault-relative path via the onSelect callback.
 */

import {App, Modal, TFolder} from 'obsidian';

export class VaultFolderModal extends Modal {
	private readonly onSelect: (path: string) => void;
	private readonly folders: TFolder[];

	constructor(app: App, onSelect: (path: string) => void) {
		super(app);
		this.onSelect = onSelect;
		this.folders = this.getAllFolders();
	}

	private getAllFolders(): TFolder[] {
		return this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && f.path !== '')
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	onOpen(): void {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass('kado-folder-picker');

		const searchInput = contentEl.createEl('input', {
			type: 'text',
			placeholder: 'Search folders...',
			cls: 'kado-picker-search',
			attr: {'aria-label': 'Search folders'},
		});

		const listEl = contentEl.createDiv({cls: 'kado-picker-list'});

		const renderList = (filter: string): void => {
			listEl.empty();
			const filtered = this.folders.filter(f =>
				f.path.toLowerCase().includes(filter.toLowerCase()),
			);
			if (filtered.length === 0) {
				listEl.createDiv({cls: 'kado-picker-empty', text: 'No matching folders'});
				return;
			}
			for (const folder of filtered) {
				const item = listEl.createEl('button', {cls: 'kado-picker-item', text: folder.path});
				item.addEventListener('click', () => {
					this.onSelect(folder.path);
					this.close();
				});
			}
		};

		searchInput.addEventListener('input', () => renderList(searchInput.value));
		renderList('');
		searchInput.focus();
	}
}
