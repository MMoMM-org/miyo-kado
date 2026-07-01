/**
 * TagInputSuggest — inline fuzzy tag picker built on Obsidian's
 * AbstractInputSuggest. Attaches type-ahead suggestions over the vault's tags
 * (frontmatter + inline, merged via metadataCache.getTags) to a text input.
 * Returns normalized tags (no leading '#').
 *
 * Used by the Permission Test panel (#83) for the secondary tag-scope readout.
 */

import {AbstractInputSuggest, App} from 'obsidian';

const MAX_SUGGESTIONS = 50;

export class TagInputSuggest extends AbstractInputSuggest<string> {
	private readonly textInput: HTMLInputElement;
	private readonly onPick: (value: string) => void;

	constructor(app: App, textInput: HTMLInputElement, onPick: (value: string) => void) {
		super(app, textInput);
		this.textInput = textInput;
		this.onPick = onPick;
	}

	private allVaultTags(): string[] {
		const cache = this.app.metadataCache as unknown as {getTags?: () => Record<string, number>};
		const counts = cache.getTags?.() ?? {};
		return Object.keys(counts).map((t) => (t.startsWith('#') ? t.slice(1) : t)).sort();
	}

	protected getSuggestions(query: string): string[] {
		const q = query.replace(/^#/, '').toLowerCase();
		return this.allVaultTags()
			.filter((t) => t.toLowerCase().includes(q))
			.slice(0, MAX_SUGGESTIONS);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(`#${value}`);
	}

	selectSuggestion(value: string): void {
		this.textInput.value = value;
		this.onPick(value);
		this.close();
	}
}
