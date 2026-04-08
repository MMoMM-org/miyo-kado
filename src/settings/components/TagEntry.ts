/**
 * TagEntry — renders a tag row with picker and fixed Read badge.
 *
 * Layout: [-remove] [#tag input] [browse tags] [R badge]
 */

import type {App} from 'obsidian';
import {normalizeTag} from '../../core/tag-utils';
import {TagPickerModal} from './TagPickerModal';

export interface TagEntryOptions {
	/** Obsidian App instance for tag picker. */
	app: App;
	/** If provided, picker only shows these tags (for key-level filtering). */
	availableTags?: string[];
	/** Called with the updated tag value when it changes. */
	onChange: (newTag: string) => void;
	/** Called when remove button is clicked. */
	onRemove: () => void;
}

export function renderTagEntry(
	containerEl: HTMLElement,
	tag: string,
	options: TagEntryOptions,
): void {
	const row = containerEl.createDiv({cls: 'kado-tag-entry'});

	// Remove button
	const removeBtn = row.createEl('button', {cls: 'kado-remove-btn', text: '\u2212', attr: {'aria-label': 'Remove tag'}});
	removeBtn.addEventListener('click', options.onRemove);

	// Tag input (displays with # prefix, stores without)
	const tagInput = row.createEl('input', {
		type: 'text',
		cls: 'kado-tag-input',
		placeholder: '#tag, #nested/tag, tag/*',
		value: tag ? `#${tag}` : '',
		attr: {'aria-label': 'Tag pattern'},
	});
	tagInput.addEventListener('blur', () => {
		const normalized = normalizeTag(tagInput.value);
		if (normalized !== null) {
			tagInput.value = `#${normalized}`;
			options.onChange(normalized);
		}
	});

	// Browse tags button
	const browseBtn = row.createEl('button', {cls: 'kado-browse-btn', text: '\ud83c\udff7\ufe0f', title: 'Browse tags'});
	browseBtn.addEventListener('click', () => {
		new TagPickerModal(options.app, (selected) => {
			tagInput.value = `#${selected}`;
			options.onChange(selected);
		}, options.availableTags).open();
	});

	// Fixed Read badge
	row.createDiv({cls: 'kado-tag-read-badge', text: 'R', title: 'Read-only — tags are read filters'});
}
