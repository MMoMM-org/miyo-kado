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
	it('lists all folders from the vault sorted alphabetically', () => {
		const app = makeAppWithFolders(['zeta', 'alpha', 'mu']);
		const modal = new VaultFolderModal(
			app as never,
			vi.fn(),
		);

		modal.open();

		const items = modal.contentEl.querySelectorAll('.kado-picker-item');
		expect(items).toHaveLength(3);
		expect(items[0].textContent).toBe('alpha');
		expect(items[1].textContent).toBe('mu');
		expect(items[2].textContent).toBe('zeta');
	});

	it('shows empty state when vault has no folders', () => {
		const app = makeAppWithFolders([]);
		const modal = new VaultFolderModal(
			app as never,
			vi.fn(),
		);

		modal.open();

		expect(modal.contentEl.querySelector('.kado-picker-empty')).not.toBeNull();
	});
});

describe('VaultFolderModal — interactivity', () => {
	it('clicking a folder fires onSelect with its path', () => {
		const app = makeAppWithFolders(['notes', 'archive']);
		const onSelect = vi.fn();
		const modal = new VaultFolderModal(
			app as never,
			onSelect,
		);

		modal.open();

		const items = modal.contentEl.querySelectorAll('.kado-picker-item');
		(items[0] as HTMLElement).click();

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
