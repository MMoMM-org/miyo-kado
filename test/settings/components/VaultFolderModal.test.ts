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
