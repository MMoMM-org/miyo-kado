/**
 * Behavioral tests for ensureParentFolder — the shared `mkdir -p` helper that
 * gives kado-write implicit parent-folder creation (spec 009, Phase 1).
 *
 * Obsidian's vault.create/createBinary do NOT create missing parents; this
 * helper closes that gap. Tests exercise: missing parent → createFolder,
 * existing parent → skip, root-level path → no-op, and the concurrent-create
 * race (createFolder rejects "already exists") → swallowed.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {App} from '../__mocks__/obsidian';
import {ensureParentFolder} from '../../src/obsidian/ensure-parent-folder';

describe('ensureParentFolder', () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it('creates the parent folder when it does not exist', async () => {
		vi.mocked(app.vault.adapter.exists).mockResolvedValue(false);

		await ensureParentFolder(app, 'A/B/C/note.md');

		expect(app.vault.adapter.exists).toHaveBeenCalledWith('A/B/C');
		expect(app.vault.createFolder).toHaveBeenCalledWith('A/B/C');
	});

	it('does not create the folder when the parent already exists', async () => {
		vi.mocked(app.vault.adapter.exists).mockResolvedValue(true);

		await ensureParentFolder(app, 'A/B/C/note.md');

		expect(app.vault.adapter.exists).toHaveBeenCalledWith('A/B/C');
		expect(app.vault.createFolder).not.toHaveBeenCalled();
	});

	it('is a no-op for a root-level path (no parent to create)', async () => {
		await ensureParentFolder(app, 'note.md');

		expect(app.vault.adapter.exists).not.toHaveBeenCalled();
		expect(app.vault.createFolder).not.toHaveBeenCalled();
	});

	it('swallows a concurrent-create race (createFolder rejects "already exists")', async () => {
		vi.mocked(app.vault.adapter.exists).mockResolvedValue(false);
		vi.mocked(app.vault.createFolder).mockRejectedValue(new Error('Folder already exists.'));

		// Must resolve, not reject — a racing writer that already made the folder
		// is a success from this caller's point of view.
		await expect(ensureParentFolder(app, 'A/B/note.md')).resolves.toBeUndefined();
	});
});
