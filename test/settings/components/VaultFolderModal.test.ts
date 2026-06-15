/**
 * Behavioral tests for VaultFolderModal (M18).
 *
 * Covers: list renders from mock vault, filter narrows results, selection
 * calls onSelect with the folder path.
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

describe('VaultFolderModal — rendering', () => {
	it('lists ** (Full vault) first, then all folders sorted alphabetically', () => {
		const app = makeAppWithFolders(['zeta', 'alpha', 'mu']);
		const modal = new VaultFolderModal(
			app as never,
			vi.fn(),
		);

		modal.open();

		const items = modal.contentEl.querySelectorAll('.kado-picker-item');
		expect(items).toHaveLength(4);
		expect(items[0].textContent).toBe('** (Full vault)');
		expect(items[1].textContent).toBe('alpha');
		expect(items[2].textContent).toBe('mu');
		expect(items[3].textContent).toBe('zeta');
	});

	it('shows ** (Full vault) even when vault has no folders', () => {
		const app = makeAppWithFolders([]);
		const modal = new VaultFolderModal(
			app as never,
			vi.fn(),
		);

		modal.open();

		const items = modal.contentEl.querySelectorAll('.kado-picker-item');
		expect(items).toHaveLength(1);
		expect(items[0].textContent).toBe('** (Full vault)');
		expect(modal.contentEl.querySelector('.kado-picker-empty')).toBeNull();
	});
});

describe('VaultFolderModal — interactivity', () => {
	it('clicking ** (Full vault) fires onSelect with **', () => {
		const app = makeAppWithFolders(['notes', 'archive']);
		const onSelect = vi.fn();
		const modal = new VaultFolderModal(
			app as never,
			onSelect,
		);

		modal.open();

		const items = modal.contentEl.querySelectorAll('.kado-picker-item');
		(items[0] as HTMLElement).click();

		expect(onSelect).toHaveBeenCalledWith('**');
	});

	it('clicking a folder fires onSelect with its path', () => {
		const app = makeAppWithFolders(['notes', 'archive']);
		const onSelect = vi.fn();
		const modal = new VaultFolderModal(
			app as never,
			onSelect,
		);

		modal.open();

		const items = modal.contentEl.querySelectorAll('.kado-picker-item');
		// items[0] is ** (Full vault), items[1] is archive, items[2] is notes
		(items[1] as HTMLElement).click();

		expect(onSelect).toHaveBeenCalledWith('archive');
	});

	it('filtering narrows the folder list', () => {
		const app = makeAppWithFolders(['notes/daily', 'notes/weekly', 'archive']);
		const modal = new VaultFolderModal(
			app as never,
			vi.fn(),
		);

		modal.open();

		const search = modal.contentEl.querySelector('.kado-picker-search') as HTMLInputElement;
		search.value = 'notes';
		search.dispatchEvent(new Event('input', {bubbles: true}));

		const items = modal.contentEl.querySelectorAll('.kado-picker-item');
		expect(items).toHaveLength(2);
	});
});

describe('VaultFolderModal — subtree restriction', () => {
	it('shows only the base folder and its descendants, hiding Full vault', () => {
		const app = makeAppWithFolders(['Atlas', 'Atlas/202 Notes', 'Atlas/Journal', 'Other', 'Other/x']);
		const modal = new VaultFolderModal(
			app as never,
			vi.fn(),
			['Atlas'],
		);

		modal.open();

		const labels = Array.from(modal.contentEl.querySelectorAll('.kado-picker-item'))
			.map((el) => el.textContent);
		expect(labels).toEqual(['Atlas', 'Atlas/202 Notes', 'Atlas/Journal']);
		expect(labels).not.toContain('** (Full vault)');
	});

	it('does not match sibling folders that share a name prefix', () => {
		const app = makeAppWithFolders(['Atlas', 'AtlasArchive', 'Atlas/202 Notes']);
		const modal = new VaultFolderModal(
			app as never,
			vi.fn(),
			['Atlas'],
		);

		modal.open();

		const labels = Array.from(modal.contentEl.querySelectorAll('.kado-picker-item'))
			.map((el) => el.textContent);
		expect(labels).toEqual(['Atlas', 'Atlas/202 Notes']);
	});

	it('unions multiple prefixes (each global path subtree)', () => {
		const app = makeAppWithFolders(['Atlas', 'Atlas/Sub', 'Projects', 'Projects/A', 'Other']);
		const modal = new VaultFolderModal(
			app as never,
			vi.fn(),
			['Atlas', 'Projects'],
		);

		modal.open();

		const labels = Array.from(modal.contentEl.querySelectorAll('.kado-picker-item'))
			.map((el) => el.textContent);
		expect(labels).toEqual(['Atlas', 'Atlas/Sub', 'Projects', 'Projects/A']);
		expect(labels).not.toContain('Other');
	});

	it('with an empty prefix (full-vault global) shows all folders but no Full vault entry', () => {
		const app = makeAppWithFolders(['notes', 'archive']);
		const modal = new VaultFolderModal(
			app as never,
			vi.fn(),
			[''],
		);

		modal.open();

		const labels = Array.from(modal.contentEl.querySelectorAll('.kado-picker-item'))
			.map((el) => el.textContent);
		expect(labels).toEqual(['archive', 'notes']);
		expect(labels).not.toContain('** (Full vault)');
	});

	it('selecting a restricted subfolder fires onSelect with its path', () => {
		const app = makeAppWithFolders(['Atlas', 'Atlas/202 Notes']);
		const onSelect = vi.fn();
		const modal = new VaultFolderModal(
			app as never,
			onSelect,
			['Atlas'],
		);

		modal.open();

		const items = modal.contentEl.querySelectorAll('.kado-picker-item');
		(items[1] as HTMLElement).click();

		expect(onSelect).toHaveBeenCalledWith('Atlas/202 Notes');
	});
});
