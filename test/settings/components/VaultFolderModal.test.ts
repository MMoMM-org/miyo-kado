/**
 * Behavioral tests for VaultFolderModal.
 *
 * VaultFolderModal is built on Obsidian's FuzzySuggestModal — the native
 * fuzzy-search rendering is internal to Obsidian, so these tests exercise the
 * subclass contract: getItems() (scoped folder list), getItemText() (labels),
 * and onChooseItem() (selection callback).
 */

import {describe, it, expect, vi} from 'vitest';
import {VaultFolderModal} from '../../../src/settings/components/VaultFolderModal';
import {App, TFolder} from '../../__mocks__/obsidian';

function makeAppWithFolders(paths: string[]): App {
	const app = new App();
	const folders = paths.map((p) => {
		const f = new TFolder();
		f.path = p;
		return f;
	});
	app.vault.getAllLoadedFiles = vi.fn(() => folders);
	return app;
}

describe('VaultFolderModal — unrestricted', () => {
	it('offers ** (Full vault) first, then all folders sorted alphabetically', () => {
		const app = makeAppWithFolders(['zeta', 'alpha', 'mu']);
		const modal = new VaultFolderModal(app as never, vi.fn());

		expect(modal.getItems()).toEqual(['**', 'alpha', 'mu', 'zeta']);
	});

	it('labels the full-vault sentinel but leaves folder paths as-is', () => {
		const app = makeAppWithFolders(['notes']);
		const modal = new VaultFolderModal(app as never, vi.fn());

		expect(modal.getItemText('**')).toBe('** (Full vault)');
		expect(modal.getItemText('notes')).toBe('notes');
	});

	it('offers ** even when the vault has no folders', () => {
		const app = makeAppWithFolders([]);
		const modal = new VaultFolderModal(app as never, vi.fn());

		expect(modal.getItems()).toEqual(['**']);
	});

	it('choosing ** fires onSelect with **', () => {
		const app = makeAppWithFolders(['notes']);
		const onSelect = vi.fn();
		const modal = new VaultFolderModal(app as never, onSelect);

		modal.onChooseItem('**');

		expect(onSelect).toHaveBeenCalledWith('**');
	});

	it('choosing a folder fires onSelect with its path', () => {
		const app = makeAppWithFolders(['notes', 'archive']);
		const onSelect = vi.fn();
		const modal = new VaultFolderModal(app as never, onSelect);

		modal.onChooseItem('archive');

		expect(onSelect).toHaveBeenCalledWith('archive');
	});
});

describe('VaultFolderModal — subtree restriction', () => {
	it('lists only the base folder and its descendants, hiding the full-vault entry', () => {
		const app = makeAppWithFolders(['Atlas', 'Atlas/202 Notes', 'Atlas/Journal', 'Other', 'Other/x']);
		const modal = new VaultFolderModal(app as never, vi.fn(), ['Atlas']);

		const items = modal.getItems();
		expect(items).toEqual(['Atlas', 'Atlas/202 Notes', 'Atlas/Journal']);
		expect(items).not.toContain('**');
	});

	it('does not match sibling folders that share a name prefix', () => {
		const app = makeAppWithFolders(['Atlas', 'AtlasArchive', 'Atlas/202 Notes']);
		const modal = new VaultFolderModal(app as never, vi.fn(), ['Atlas']);

		expect(modal.getItems()).toEqual(['Atlas', 'Atlas/202 Notes']);
	});

	it('unions multiple prefixes (each global path subtree)', () => {
		const app = makeAppWithFolders(['Atlas', 'Atlas/Sub', 'Projects', 'Projects/A', 'Other']);
		const modal = new VaultFolderModal(app as never, vi.fn(), ['Atlas', 'Projects']);

		const items = modal.getItems();
		expect(items).toEqual(['Atlas', 'Atlas/Sub', 'Projects', 'Projects/A']);
		expect(items).not.toContain('Other');
	});

	it('with an empty prefix (full-vault global) lists all folders but no ** entry', () => {
		const app = makeAppWithFolders(['notes', 'archive']);
		const modal = new VaultFolderModal(app as never, vi.fn(), ['']);

		const items = modal.getItems();
		expect(items).toEqual(['archive', 'notes']);
		expect(items).not.toContain('**');
	});

	it('choosing a restricted subfolder fires onSelect with its path', () => {
		const app = makeAppWithFolders(['Atlas', 'Atlas/202 Notes']);
		const onSelect = vi.fn();
		const modal = new VaultFolderModal(app as never, onSelect, ['Atlas']);

		modal.onChooseItem('Atlas/202 Notes');

		expect(onSelect).toHaveBeenCalledWith('Atlas/202 Notes');
	});
});
