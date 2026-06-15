/**
 * VaultFolderModal — directory picker using Obsidian's Modal class.
 *
 * Shows all vault folders in a filterable list. Selecting a folder
 * returns its vault-relative path via the onSelect callback.
 *
 * Optional `restrictToPrefix` scopes the list to one folder subtree (the base
 * folder and its descendants) and hides the "Full vault" entry — used to narrow
 * an API key's path to a subfolder of a globally-allowed path. An empty prefix
 * (the global path was `**`) restricts nothing but still hides "Full vault".
 */

import {App, Modal, TFolder} from 'obsidian';

export class VaultFolderModal extends Modal {
	private readonly onSelect: (path: string) => void;
	private readonly restrictToPrefix: string | undefined;
	private readonly folders: TFolder[];

	constructor(app: App, onSelect: (path: string) => void, restrictToPrefix?: string) {
		super(app);
		this.onSelect = onSelect;
		this.restrictToPrefix = restrictToPrefix;
		this.folders = this.getAllFolders();
	}

	/** True when the picker is scoped to a single folder subtree. */
	private get restricted(): boolean {
		return this.restrictToPrefix !== undefined;
	}

	private getAllFolders(): TFolder[] {
		const base = this.restrictToPrefix;
		return this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && f.path !== '')
			.filter((f) => {
				if (base === undefined || base === '') return true;
				return f.path === base || f.path.startsWith(base + '/');
			})
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
			// In subtree-restricted mode the key narrows to a folder under a
			// globally-allowed path, so "Full vault" is never an option.
			const showFullVault = !this.restricted
				&& FULL_VAULT_LABEL.toLowerCase().includes(lowerFilter);
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
