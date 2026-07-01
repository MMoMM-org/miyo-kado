/**
 * PathInputSuggest — inline fuzzy path picker built on Obsidian's
 * AbstractInputSuggest. Attaches type-ahead suggestions (files AND folders) to a
 * plain text input, unlike the modal-based VaultFolderModal (folders only).
 *
 * Used by the Permission Test panel (#83) where a dry-run may target either a
 * file or a folder path.
 */

import {AbstractInputSuggest, App, TFile, TFolder} from 'obsidian';

const MAX_SUGGESTIONS = 50;

export class PathInputSuggest extends AbstractInputSuggest<string> {
	private readonly textInput: HTMLInputElement;
	private readonly onPick: (value: string) => void;

	constructor(app: App, textInput: HTMLInputElement, onPick: (value: string) => void) {
		super(app, textInput);
		this.textInput = textInput;
		this.onPick = onPick;
	}

	protected getSuggestions(query: string): string[] {
		const q = query.toLowerCase();
		return this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFile | TFolder =>
				f instanceof TFile || (f instanceof TFolder && f.path !== ''))
			.map((f) => f.path)
			.filter((path) => path.toLowerCase().includes(q))
			.sort((a, b) => a.localeCompare(b))
			.slice(0, MAX_SUGGESTIONS);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		this.textInput.value = value;
		this.onPick(value);
		this.close();
	}
}
