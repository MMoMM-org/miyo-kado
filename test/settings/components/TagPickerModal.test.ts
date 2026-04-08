/**
 * Behavioral tests for TagPickerModal (M18).
 *
 * Covers: renders a filtered list, Enter confirms manual input, clicking
 * a tag fires onSelect and closes, empty state shows message.
 */

import {describe, it, expect, vi} from 'vitest';
import {TagPickerModal} from '../../../src/settings/components/TagPickerModal';
import {App} from '../../__mocks__/obsidian';

function makeAppWithTags(tags: string[]): App {
	const app = new App();
	(app.metadataCache as unknown as {getTags: () => Record<string, number>}).getTags = vi.fn(() => {
		const out: Record<string, number> = {};
		for (const t of tags) out[`#${t}`] = 1;
		return out;
	});
	return app;
}

describe('TagPickerModal — rendering', () => {
	it('renders a manual input and a list of all available tags', () => {
		const app = makeAppWithTags(['project', 'work/urgent', 'personal']);
		const modal = new TagPickerModal(app as never, vi.fn());

		modal.open();

		const items = modal.contentEl.querySelectorAll('.kado-picker-item');
		expect(items).toHaveLength(3);
		expect(modal.contentEl.querySelector('.kado-picker-search')).not.toBeNull();
	});

	it('shows an empty-state message when no tags exist', () => {
		const app = makeAppWithTags([]);
		const modal = new TagPickerModal(app as never, vi.fn());

		modal.open();

		expect(modal.contentEl.querySelector('.kado-picker-empty')?.textContent).toContain('No matching');
	});
});

describe('TagPickerModal — selection', () => {
	it('clicking a tag fires onSelect with the non-prefixed value', () => {
		const app = makeAppWithTags(['project', 'work']);
		const onSelect = vi.fn();
		const modal = new TagPickerModal(app as never, onSelect);

		modal.open();

		const items = modal.contentEl.querySelectorAll('.kado-picker-item');
		(items[0] as HTMLElement).click();

		expect(onSelect).toHaveBeenCalledWith('project');
	});

	it('pressing Enter in the manual input confirms the typed tag', () => {
		const app = makeAppWithTags(['existing']);
		const onSelect = vi.fn();
		const modal = new TagPickerModal(app as never, onSelect);

		modal.open();

		const input = modal.contentEl.querySelector('.kado-picker-search') as HTMLInputElement;
		input.value = '#custom-tag';
		input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));

		expect(onSelect).toHaveBeenCalledWith('custom-tag');
	});

	it('filters the tag list as the user types', () => {
		const app = makeAppWithTags(['project', 'work/urgent', 'personal']);
		const modal = new TagPickerModal(app as never, vi.fn());

		modal.open();

		const input = modal.contentEl.querySelector('.kado-picker-search') as HTMLInputElement;
		input.value = 'work';
		input.dispatchEvent(new Event('input', {bubbles: true}));

		const items = modal.contentEl.querySelectorAll('.kado-picker-item');
		expect(items).toHaveLength(1);
		expect(items[0].textContent).toContain('work/urgent');
	});

	it('restricts the list to availableTags when provided', () => {
		const app = makeAppWithTags(['a', 'b', 'c']);
		const modal = new TagPickerModal(
			app as never,
			vi.fn(),
			['a', 'c'],
		);

		modal.open();

		const items = modal.contentEl.querySelectorAll('.kado-picker-item');
		expect(items).toHaveLength(2);
	});
});
