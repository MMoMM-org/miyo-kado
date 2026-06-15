/**
 * VaultFolderModal — directory picker using Obsidian's Modal class.
 *
 * Shows all vault folders in a filterable list. Selecting a folder
 * returns its vault-relative path via the onSelect callback.
 *
 * Optional `restrictToPrefixes` scopes the list to one or more folder subtrees
 * (each base folder and its descendants) and hides the "Full vault" entry — used
 * to confine an API key's path to folders within the global scope. An empty-string
 * prefix (the global path was `**`) matches the whole vault. Passing `undefined`
 * leaves the picker unrestricted (all folders + the "Full vault" entry).
 */

import {App, Modal, TFolder} from 'obsidian';

export class VaultFolderModal extends Modal {
	private readonly onSelect: (path: string) => void;
	private readonly restrictToPrefixes: string[] | undefined;
	private readonly folders: TFolder[];

	constructor(app: App, onSelect: (path: string) => void, restrictToPrefixes?: string[]) {
		super(app);
		this.onSelect = onSelect;
		this.restrictToPrefixes = restrictToPrefixes;
		this.folders = this.getAllFolders();
	}

	/** True when the picker is scoped to a set of folder subtrees. */
	private get restricted(): boolean {
		return this.restrictToPrefixes !== undefined;
	}

	private getAllFolders(): TFolder[] {
		const prefixes = this.restrictToPrefixes;
		return this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && f.path !== '')
			.filter((f) => {
				if (prefixes === undefined) return true;
				// A folder is offered when it sits under (or equals) any allowed
				// prefix. An empty prefix means the whole vault is in scope.
				return prefixes.some((base) =>
					base === '' || f.path === base || f.path.startsWith(base + '/'));
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
