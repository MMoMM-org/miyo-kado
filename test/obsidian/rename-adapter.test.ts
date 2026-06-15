/**
 * Behavioral tests for the RenameAdapter.
 *
 * Verifies the adapter delegates to fileManager.renameFile (the only API that
 * updates backlinks), refuses to clobber an existing target, and surfaces
 * NOT_FOUND for a missing source. Inline mocks avoid touching the shared
 * obsidian mock.
 */

import {describe, it, expect, vi} from 'vitest';
import {createRenameAdapter} from '../../src/obsidian/rename-adapter';
import type {CoreRenameRequest} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Inline mock helpers
// ---------------------------------------------------------------------------

function makeTFile(path = 'notes/old.md', mtime = 2000) {
	return {path, name: path.split('/').pop() ?? path, stat: {ctime: 1000, mtime, size: 512}};
}

interface AppOverrides {
	getFileByPath?: ReturnType<typeof vi.fn>;
	getAbstractFileByPath?: ReturnType<typeof vi.fn>;
	renameFile?: ReturnType<typeof vi.fn>;
}

/**
 * Default getAbstractFileByPath simulates a vault where parent folders exist and
 * the target file does not: paths with a dot (a file) resolve to null (free),
 * paths without (a folder) resolve to a truthy folder stub. Tests override this
 * to simulate an occupied target or a missing parent folder.
 */
function defaultGetAbstractFileByPath() {
	return vi.fn((p: string) => (p.includes('.') ? null : {path: p}));
}

function makeApp(overrides?: AppOverrides) {
	return {
		vault: {
			getFileByPath: overrides?.getFileByPath ?? vi.fn(),
			getAbstractFileByPath: overrides?.getAbstractFileByPath ?? defaultGetAbstractFileByPath(),
		},
		fileManager: {
			renameFile: overrides?.renameFile ?? vi.fn().mockResolvedValue(undefined),
		},
	};
}

function makeRenameRequest(overrides?: Partial<CoreRenameRequest>): CoreRenameRequest {
	return {
		kind: 'rename',
		apiKeyId: 'kado_test-key',
		operation: 'note',
		source: 'notes/old.md',
		target: 'notes/new.md',
		expectedModified: 2000,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createRenameAdapter() — rename()', () => {
	it('calls fileManager.renameFile with the resolved source file and target path', async () => {
		const file = makeTFile('notes/old.md');
		const renameFile = vi.fn().mockResolvedValue(undefined);
		const app = makeApp({getFileByPath: vi.fn().mockReturnValue(file), renameFile});
		const adapter = createRenameAdapter(app as never);

		const result = await adapter.rename(makeRenameRequest());

		expect(renameFile).toHaveBeenCalledWith(file, 'notes/new.md');
		expect(result).toEqual({source: 'notes/old.md', target: 'notes/new.md', modified: 2000});
	});

	it('moves a file across folders (different parent) via the same API', async () => {
		const file = makeTFile('100 Inbox/draft.md', 3000);
		const renameFile = vi.fn().mockResolvedValue(undefined);
		const app = makeApp({getFileByPath: vi.fn().mockReturnValue(file), renameFile});
		const adapter = createRenameAdapter(app as never);

		const result = await adapter.rename(makeRenameRequest({
			source: '100 Inbox/draft.md',
			target: '200 Notes/draft.md',
		}));

		expect(renameFile).toHaveBeenCalledWith(file, '200 Notes/draft.md');
		expect(result.modified).toBe(3000);
	});

	it('throws NOT_FOUND when the source file does not exist', async () => {
		const app = makeApp({getFileByPath: vi.fn().mockReturnValue(null)});
		const adapter = createRenameAdapter(app as never);

		await expect(adapter.rename(makeRenameRequest({source: 'notes/missing.md'})))
			.rejects
			.toMatchObject({code: 'NOT_FOUND'});
	});

	it('throws CONFLICT when a file or folder already exists at the target', async () => {
		const file = makeTFile('notes/old.md');
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			getAbstractFileByPath: vi.fn().mockReturnValue(makeTFile('notes/new.md')),
		});
		const adapter = createRenameAdapter(app as never);

		await expect(adapter.rename(makeRenameRequest()))
			.rejects
			.toMatchObject({code: 'CONFLICT'});
	});

	it('does not call renameFile when the target is occupied', async () => {
		const renameFile = vi.fn().mockResolvedValue(undefined);
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(makeTFile()),
			getAbstractFileByPath: vi.fn().mockReturnValue(makeTFile('notes/new.md')),
			renameFile,
		});
		const adapter = createRenameAdapter(app as never);

		await expect(adapter.rename(makeRenameRequest())).rejects.toBeDefined();
		expect(renameFile).not.toHaveBeenCalled();
	});

	it('allows a case-only rename (target resolves to the same file)', async () => {
		const file = makeTFile('notes/Old.md');
		const renameFile = vi.fn().mockResolvedValue(undefined);
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			// Case-insensitive FS: the target resolves back to the SAME source file.
			getAbstractFileByPath: vi.fn((p: string) => (p === 'notes/old.md' ? file : {path: p})),
			renameFile,
		});
		const adapter = createRenameAdapter(app as never);

		const result = await adapter.rename(makeRenameRequest({source: 'notes/Old.md', target: 'notes/old.md'}));

		expect(renameFile).toHaveBeenCalledWith(file, 'notes/old.md');
		expect(result.target).toBe('notes/old.md');
	});

	it('throws VALIDATION_ERROR when the target parent folder does not exist', async () => {
		const renameFile = vi.fn().mockResolvedValue(undefined);
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(makeTFile('100 Inbox/a.md')),
			getAbstractFileByPath: vi.fn().mockReturnValue(null), // target free AND parent missing
			renameFile,
		});
		const adapter = createRenameAdapter(app as never);

		await expect(adapter.rename(makeRenameRequest({source: '100 Inbox/a.md', target: '200 Notes/a.md'})))
			.rejects
			.toMatchObject({code: 'VALIDATION_ERROR'});
		expect(renameFile).not.toHaveBeenCalled();
	});

	it('maps a renameFile failure to CONFLICT when the target became occupied (race)', async () => {
		const file = makeTFile('x/old.md');
		const occupant = makeTFile('x/new.md');
		let targetChecks = 0;
		const getAbstractFileByPath = vi.fn((p: string) => {
			if (p === 'x/new.md') { targetChecks += 1; return targetChecks === 1 ? null : occupant; }
			return {path: p}; // parent exists
		});
		const renameFile = vi.fn().mockRejectedValue(new Error('already exists'));
		const app = makeApp({getFileByPath: vi.fn().mockReturnValue(file), getAbstractFileByPath, renameFile});
		const adapter = createRenameAdapter(app as never);

		await expect(adapter.rename(makeRenameRequest({source: 'x/old.md', target: 'x/new.md'})))
			.rejects
			.toMatchObject({code: 'CONFLICT'});
	});
});
