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

		const FULL_VAULT_LABEL = '** (Full vault)';

		const renderList = (filter: string): void => {
			listEl.empty();
			const lowerFilter = filter.toLowerCase();
			const showFullVault = FULL_VAULT_LABEL.toLowerCase().includes(lowerFilter);
			const filtered = this.folders.filter(f =>
				f.path.toLowerCase().includes(lowerFilter),
			);
			if (!showFullVault && filtered.length === 0) {
				listEl.createDiv({cls: 'kado-picker-empty', text: 'No matching folders'});
				return;
			}
			if (showFullVault) {
				const fullVaultItem = listEl.createEl('button', {cls: 'kado-picker-item', text: FULL_VAULT_LABEL});
				fullVaultItem.addEventListener('click', () => {
					this.onSelect('**');
					this.close();
				});
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
