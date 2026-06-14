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

function makeApp(overrides?: AppOverrides) {
	return {
		vault: {
			getFileByPath: overrides?.getFileByPath ?? vi.fn(),
			getAbstractFileByPath: overrides?.getAbstractFileByPath ?? vi.fn().mockReturnValue(null),
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
});
