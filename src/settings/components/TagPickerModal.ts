/**
 * TagPickerModal — tag picker with manual entry using Obsidian's Modal class.
 *
 * Shows existing vault tags from metadata cache (both frontmatter and inline,
 * merged). User can pick from the list or type a tag manually.
 * Tags are returned normalized (without '#' prefix).
 */

import {App, Modal} from 'obsidian';
import {normalizeTag} from '../../core/tag-utils';

export class TagPickerModal extends Modal {
	private readonly onSelect: (tag: string) => void;
	private readonly availableTags: string[];

	/**
	 * @param onSelect Called with normalized tag (no '#')
	 * @param availableTags If provided, only these tags are shown (for key-level filtering)
	 */
	constructor(app: App, onSelect: (tag: string) => void, availableTags?: string[]) {
		super(app);
		this.onSelect = onSelect;
		this.availableTags = availableTags ?? [];
	}

	private getAllVaultTags(): string[] {
		// getTags() returns Record<string, number> with '#'-prefixed keys
		// It merges both frontmatter and inline tags
		const cache = this.app.metadataCache as unknown as {getTags?: () => Record<string, number>};
		const tagCounts = cache.getTags?.() ?? {};
		const allTags = Object.keys(tagCounts)
			.map(t => t.startsWith('#') ? t.slice(1) : t)
			.sort();

		if (this.availableTags.length > 0) {
			return allTags.filter(t => this.availableTags.includes(t));
		}
		return allTags;
	}

	onOpen(): void {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass('kado-tag-picker');

		// Manual text entry
		const inputRow = contentEl.createDiv({cls: 'kado-picker-input-row'});
		const manualInput = inputRow.createEl('input', {
			type: 'text',
			placeholder: '#tag, #nested/tag, tag/*',
			cls: 'kado-picker-search',
		});
		const confirmBtn = inputRow.createEl('button', {text: 'Add', cls: 'mod-cta'});
		confirmBtn.addEventListener('click', () => {
			const normalized = normalizeTag(manualInput.value);
			if (normalized) {
				this.onSelect(normalized);
				this.close();
			}
		});
		manualInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				confirmBtn.click();
			}
		});

		contentEl.createEl('hr');

		// Picker list
		const listEl = contentEl.createDiv({cls: 'kado-picker-list'});
		const tags = this.getAllVaultTags();

		const renderList = (filter: string): void => {
			listEl.empty();
			const cleanFilter = filter.replace(/^#/, '').toLowerCase();
			const filtered = tags.filter(t => t.toLowerCase().includes(cleanFilter));
			if (filtered.length === 0) {
				listEl.createDiv({cls: 'kado-picker-empty', text: 'No matching tags'});
				return;
			}
			for (const tag of filtered) {
				const item = listEl.createDiv({cls: 'kado-picker-item', text: `#${tag}`});
				item.addEventListener('click', () => {
					this.onSelect(tag);
					this.close();
				});
			}
		};

		manualInput.addEventListener('input', () => renderList(manualInput.value));
		renderList('');
		manualInput.focus();
	}
}
