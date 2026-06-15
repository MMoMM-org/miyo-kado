/**
 * VaultFolderModal — native folder picker built on Obsidian's FuzzySuggestModal
 * (the same component behind "Move file to folder"). The user fuzzy-searches a
 * folder and its vault-relative path is returned via the onSelect callback.
 *
 * Optional `restrictToPrefixes` scopes the list to one or more folder subtrees
 * (each base folder and its descendants) and hides the "Full vault" entry — used
 * to confine an API key's path to folders within the global scope. An empty-string
 * prefix (the global path was `**`) matches the whole vault. Passing `undefined`
 * leaves the picker unrestricted (all folders plus a "Full vault" entry).
 */

import {App, FuzzySuggestModal, TFolder} from 'obsidian';

/** Sentinel item representing full-vault access (`**`). */
const FULL_VAULT = '**';
const FULL_VAULT_LABEL = '** (Full vault)';

export class VaultFolderModal extends FuzzySuggestModal<string> {
	private readonly onSelect: (path: string) => void;
	private readonly restrictToPrefixes: string[] | undefined;

	constructor(app: App, onSelect: (path: string) => void, restrictToPrefixes?: string[]) {
		super(app);
		this.onSelect = onSelect;
		this.restrictToPrefixes = restrictToPrefixes;
		this.setPlaceholder('Search folders…');
	}

	getItems(): string[] {
		const prefixes = this.restrictToPrefixes;
		const folders = this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && f.path !== '')
			.map((f) => f.path)
			.filter((path) => {
				if (prefixes === undefined) return true;
				// A folder is offered when it sits under (or equals) any allowed
				// prefix. An empty prefix means the whole vault is in scope.
				return prefixes.some((base) =>
					base === '' || path === base || path.startsWith(base + '/'));
			})
			.sort((a, b) => a.localeCompare(b));
		// Unrestricted pickers also offer full-vault access; subtree-restricted
		// pickers (a key narrowing within the global scope) do not.
		return prefixes === undefined ? [FULL_VAULT, ...folders] : folders;
	}

	getItemText(item: string): string {
		return item === FULL_VAULT ? FULL_VAULT_LABEL : item;
	}

	onChooseItem(item: string): void {
		this.onSelect(item);
	}
}
