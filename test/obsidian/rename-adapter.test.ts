/**
 * Behavioral tests for the RenameAdapter.
 *
 * Verifies the adapter delegates to fileManager.renameFile (the only API that
 * updates backlinks), refuses to clobber an existing target, and surfaces
 * NOT_FOUND for a missing source. Inline mocks avoid touching the shared
 * obsidian mock.
 */

import {describe, it, expect, vi} from 'vitest';
import {TFile, TFolder} from '../__mocks__/obsidian';
import {createRenameAdapter} from '../../src/obsidian/rename-adapter';
import type {CoreRenameRequest} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Inline mock helpers
// ---------------------------------------------------------------------------

// A real mock TFile instance so the adapter's `instanceof TFile` narrowing holds.
function makeTFile(path = 'notes/old.md', mtime = 2000): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split('/').pop() ?? path;
	file.stat = {ctime: 1000, mtime, size: 512};
	return file;
}

interface AppOverrides {
	getFileByPath?: ReturnType<typeof vi.fn>;
	getAbstractFileByPath?: ReturnType<typeof vi.fn>;
	renameFile?: ReturnType<typeof vi.fn>;
	/** When set, the default getAbstractFileByPath resolves this file at its own path (the source). */
	sourceFile?: {path: string};
}

/**
 * Default getAbstractFileByPath simulates a vault where parent folders exist and
 * the target file does not: the `sourceFile` (if given) resolves at its own path;
 * other paths with a dot (a file) resolve to null (free); paths without (a
 * folder) resolve to a truthy folder stub. The adapter resolves the SOURCE via
 * getAbstractFileByPath (file-or-folder), so tests provide the source through it.
 */
function defaultGetAbstractFileByPath(sourceFile?: {path: string}) {
	return vi.fn((p: string) => {
		if (sourceFile && p === sourceFile.path) return sourceFile;
		return p.includes('.') ? null : {path: p};
	});
}

function makeApp(overrides?: AppOverrides) {
	return {
		vault: {
			getFileByPath: overrides?.getFileByPath ?? vi.fn(),
			getAbstractFileByPath: overrides?.getAbstractFileByPath ?? defaultGetAbstractFileByPath(overrides?.sourceFile),
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
		const app = makeApp({sourceFile: file, renameFile});
		const adapter = createRenameAdapter(app as never);

		const result = await adapter.rename(makeRenameRequest());

		expect(renameFile).toHaveBeenCalledWith(file, 'notes/new.md');
		expect(result).toEqual({source: 'notes/old.md', target: 'notes/new.md', modified: 2000});
	});

	it('moves a file across folders (different parent) via the same API', async () => {
		const file = makeTFile('100 Inbox/draft.md', 3000);
		const renameFile = vi.fn().mockResolvedValue(undefined);
		const app = makeApp({sourceFile: file, renameFile});
		const adapter = createRenameAdapter(app as never);

		const result = await adapter.rename(makeRenameRequest({
			source: '100 Inbox/draft.md',
			target: '200 Notes/draft.md',
		}));

		expect(renameFile).toHaveBeenCalledWith(file, '200 Notes/draft.md');
		expect(result.modified).toBe(3000);
	});

	it('throws NOT_FOUND when the source file does not exist', async () => {
		const app = makeApp(); // no sourceFile → the dotted source path resolves to null
		const adapter = createRenameAdapter(app as never);

		await expect(adapter.rename(makeRenameRequest({source: 'notes/missing.md'})))
			.rejects
			.toMatchObject({code: 'NOT_FOUND'});
	});

	it('throws CONFLICT when a file or folder already exists at the target', async () => {
		const file = makeTFile('notes/old.md');
		const occupant = makeTFile('notes/new.md');
		const app = makeApp({
			getAbstractFileByPath: vi.fn((p: string) => (p === 'notes/old.md' ? file : p === 'notes/new.md' ? occupant : {path: p})),
		});
		const adapter = createRenameAdapter(app as never);

		await expect(adapter.rename(makeRenameRequest()))
			.rejects
			.toMatchObject({code: 'CONFLICT'});
	});

	it('does not call renameFile when the target is occupied', async () => {
		const renameFile = vi.fn().mockResolvedValue(undefined);
		const app = makeApp({
			getAbstractFileByPath: vi.fn((p: string) => (p === 'notes/old.md' ? makeTFile('notes/old.md') : p === 'notes/new.md' ? makeTFile('notes/new.md') : {path: p})),
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
			// Case-insensitive FS: the source and the target resolve to the SAME file.
			getAbstractFileByPath: vi.fn((p: string) => (p === 'notes/old.md' || p === 'notes/Old.md' ? file : {path: p})),
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
			// source resolves to a file; target AND its parent folder resolve to null (missing)
			getAbstractFileByPath: vi.fn((p: string) => (p === '100 Inbox/a.md' ? makeTFile('100 Inbox/a.md') : null)),
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
			if (p === 'x/old.md') return file; // source resolves to the file
			if (p === 'x/new.md') { targetChecks += 1; return targetChecks === 1 ? null : occupant; }
			return {path: p}; // parent exists
		});
		const renameFile = vi.fn().mockRejectedValue(new Error('already exists'));
		const app = makeApp({getAbstractFileByPath, renameFile});
		const adapter = createRenameAdapter(app as never);

		await expect(adapter.rename(makeRenameRequest({source: 'x/old.md', target: 'x/new.md'})))
			.rejects
			.toMatchObject({code: 'CONFLICT'});
	});
});

// ---------------------------------------------------------------------------
// Folder rename — in-place only (spec 009, Phase 3)
// ---------------------------------------------------------------------------

describe('createRenameAdapter() — folder rename (in-place)', () => {
	function makeTFolder(path: string): TFolder {
		const folder = new TFolder();
		folder.path = path;
		folder.name = path.split('/').pop() ?? path;
		return folder;
	}

	function folderRequest(source: string, target: string): CoreRenameRequest {
		return {kind: 'rename', apiKeyId: 'kado_test-key', operation: 'folder', source, target, expectedModified: 0};
	}

	it('renames a folder in place via fileManager.renameFile (same parent)', async () => {
		const folder = makeTFolder('Projects/alt');
		const renameFile = vi.fn().mockResolvedValue(undefined);
		const app = makeApp({
			getAbstractFileByPath: vi.fn((p: string) => (p === 'Projects/alt' ? folder : null)),
			renameFile,
		});
		const adapter = createRenameAdapter(app as never);

		const result = await adapter.rename(folderRequest('Projects/alt', 'Projects/neu'));

		expect(renameFile).toHaveBeenCalledWith(folder, 'Projects/neu');
		expect(result).toEqual({source: 'Projects/alt', target: 'Projects/neu', modified: 0});
	});

	it('refuses a cross-parent move with VALIDATION_ERROR and does not rename', async () => {
		const folder = makeTFolder('Projects/alt');
		const renameFile = vi.fn().mockResolvedValue(undefined);
		const app = makeApp({
			getAbstractFileByPath: vi.fn((p: string) => (p === 'Projects/alt' ? folder : null)),
			renameFile,
		});
		const adapter = createRenameAdapter(app as never);

		await expect(adapter.rename(folderRequest('Projects/alt', 'Archive/alt')))
			.rejects
			.toMatchObject({code: 'VALIDATION_ERROR', message: expect.stringContaining('in place')});
		expect(renameFile).not.toHaveBeenCalled();
	});

	it('throws CONFLICT when the target folder path is already occupied', async () => {
		const folder = makeTFolder('Projects/alt');
		const occupant = makeTFolder('Projects/neu');
		const renameFile = vi.fn().mockResolvedValue(undefined);
		const app = makeApp({
			getAbstractFileByPath: vi.fn((p: string) => (p === 'Projects/alt' ? folder : p === 'Projects/neu' ? occupant : null)),
			renameFile,
		});
		const adapter = createRenameAdapter(app as never);

		await expect(adapter.rename(folderRequest('Projects/alt', 'Projects/neu')))
			.rejects
			.toMatchObject({code: 'CONFLICT'});
		expect(renameFile).not.toHaveBeenCalled();
	});

	it('throws NOT_FOUND when the source folder does not resolve', async () => {
		const app = makeApp({getAbstractFileByPath: vi.fn().mockReturnValue(null)});
		const adapter = createRenameAdapter(app as never);

		await expect(adapter.rename(folderRequest('Projects/ghost', 'Projects/neu')))
			.rejects
			.toMatchObject({code: 'NOT_FOUND'});
	});
});
