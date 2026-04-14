/**
 * Behavioral tests for DeleteAdapter implementations.
 *
 * Tests note/file/frontmatter delete adapters via their public DeleteAdapter
 * interface. Inline mock helpers avoid modifying the shared obsidian mock.
 */

import {describe, it, expect, vi} from 'vitest';
import {
	createNoteDeleteAdapter,
	createFileDeleteAdapter,
	createFrontmatterDeleteAdapter,
} from '../../src/obsidian/delete-adapter';
import type {CoreDeleteRequest} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Inline mock helpers
// ---------------------------------------------------------------------------

function makeStat(overrides?: Partial<{ctime: number; mtime: number; size: number}>) {
	return {
		ctime: overrides?.ctime ?? 1000,
		mtime: overrides?.mtime ?? 2000,
		size: overrides?.size ?? 512,
	};
}

function makeTFile(path = 'notes/test.md', statOverrides?: Parameters<typeof makeStat>[0]) {
	return {
		path,
		name: path.split('/').pop() ?? path,
		stat: makeStat(statOverrides),
	};
}

interface AppOverrides {
	getFileByPath?: ReturnType<typeof vi.fn>;
	trashFile?: ReturnType<typeof vi.fn>;
	processFrontMatter?: ReturnType<typeof vi.fn>;
}

function makeApp(overrides?: AppOverrides) {
	return {
		vault: {
			getFileByPath: overrides?.getFileByPath ?? vi.fn(),
		},
		fileManager: {
			trashFile: overrides?.trashFile ?? vi.fn().mockResolvedValue(undefined),
			processFrontMatter: overrides?.processFrontMatter ?? vi.fn(),
		},
	};
}

// ---------------------------------------------------------------------------
// Request factories
// ---------------------------------------------------------------------------

function makeDeleteRequest(overrides?: Partial<CoreDeleteRequest>): CoreDeleteRequest {
	return {
		kind: 'delete',
		apiKeyId: 'kado_test-key',
		operation: 'note',
		path: 'notes/test.md',
		expectedModified: 2000,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Note delete adapter
// ---------------------------------------------------------------------------

describe('createNoteDeleteAdapter() — delete()', () => {
	it('calls fileManager.trashFile with resolved file', async () => {
		const file = makeTFile('notes/test.md');
		const getFileByPath = vi.fn().mockReturnValue(file);
		const trashFile = vi.fn().mockResolvedValue(undefined);
		const app = makeApp({getFileByPath, trashFile});
		const adapter = createNoteDeleteAdapter(app as never);

		const result = await adapter.delete(makeDeleteRequest());

		expect(getFileByPath).toHaveBeenCalledWith('notes/test.md');
		expect(trashFile).toHaveBeenCalledWith(file);
		expect(result).toEqual({path: 'notes/test.md'});
	});

	it('throws NOT_FOUND when file does not exist', async () => {
		const getFileByPath = vi.fn().mockReturnValue(null);
		const app = makeApp({getFileByPath});
		const adapter = createNoteDeleteAdapter(app as never);

		await expect(adapter.delete(makeDeleteRequest({path: 'notes/missing.md'})))
			.rejects
			.toMatchObject({code: 'NOT_FOUND'});
	});

	it('does not return modified timestamp (file is gone)', async () => {
		const file = makeTFile('notes/test.md');
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			trashFile: vi.fn().mockResolvedValue(undefined),
		});
		const adapter = createNoteDeleteAdapter(app as never);

		const result = await adapter.delete(makeDeleteRequest());

		expect(result.modified).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// File delete adapter (binary)
// ---------------------------------------------------------------------------

describe('createFileDeleteAdapter() — delete()', () => {
	it('calls fileManager.trashFile with resolved file', async () => {
		const file = makeTFile('allowed/image.png');
		const trashFile = vi.fn().mockResolvedValue(undefined);
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			trashFile,
		});
		const adapter = createFileDeleteAdapter(app as never);

		const result = await adapter.delete(makeDeleteRequest({
			operation: 'file',
			path: 'allowed/image.png',
		}));

		expect(trashFile).toHaveBeenCalledWith(file);
		expect(result).toEqual({path: 'allowed/image.png'});
	});

	it('throws NOT_FOUND when file does not exist', async () => {
		const app = makeApp({getFileByPath: vi.fn().mockReturnValue(null)});
		const adapter = createFileDeleteAdapter(app as never);

		await expect(adapter.delete(makeDeleteRequest({operation: 'file', path: 'missing.png'})))
			.rejects
			.toMatchObject({code: 'NOT_FOUND'});
	});
});

// ---------------------------------------------------------------------------
// Frontmatter delete adapter
// ---------------------------------------------------------------------------

describe('createFrontmatterDeleteAdapter() — delete()', () => {
	it('removes specified keys via processFrontMatter', async () => {
		const file = makeTFile('notes/test.md', {mtime: 5000});
		const fm = {testKey: 'hello', priority: 'high', other: 'stay'};
		const processFrontMatter = vi.fn().mockImplementation(async (_f, cb) => {
			cb(fm);
		});
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			processFrontMatter,
		});
		const adapter = createFrontmatterDeleteAdapter(app as never);

		const result = await adapter.delete(makeDeleteRequest({
			operation: 'frontmatter',
			keys: ['testKey', 'priority'],
		}));

		expect(processFrontMatter).toHaveBeenCalled();
		// After mutation, keys should be gone
		expect(fm).toEqual({other: 'stay'});
		expect(result).toEqual({path: 'notes/test.md', modified: 5000});
	});

	it('throws VALIDATION_ERROR when keys is missing', async () => {
		const file = makeTFile();
		const app = makeApp({getFileByPath: vi.fn().mockReturnValue(file)});
		const adapter = createFrontmatterDeleteAdapter(app as never);

		await expect(adapter.delete(makeDeleteRequest({operation: 'frontmatter'})))
			.rejects
			.toMatchObject({code: 'VALIDATION_ERROR'});
	});

	it('throws VALIDATION_ERROR when keys is empty array', async () => {
		const file = makeTFile();
		const app = makeApp({getFileByPath: vi.fn().mockReturnValue(file)});
		const adapter = createFrontmatterDeleteAdapter(app as never);

		await expect(adapter.delete(makeDeleteRequest({operation: 'frontmatter', keys: []})))
			.rejects
			.toMatchObject({code: 'VALIDATION_ERROR'});
	});

	it('throws NOT_FOUND when file does not exist', async () => {
		const app = makeApp({getFileByPath: vi.fn().mockReturnValue(null)});
		const adapter = createFrontmatterDeleteAdapter(app as never);

		await expect(adapter.delete(makeDeleteRequest({
			operation: 'frontmatter',
			keys: ['testKey'],
		})))
			.rejects
			.toMatchObject({code: 'NOT_FOUND'});
	});

	it('preserves other frontmatter keys when removing specific ones', async () => {
		const file = makeTFile('notes/test.md');
		const fm = {a: 1, b: 2, c: 3, d: 4};
		const processFrontMatter = vi.fn().mockImplementation(async (_f, cb) => {
			cb(fm);
		});
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			processFrontMatter,
		});
		const adapter = createFrontmatterDeleteAdapter(app as never);

		await adapter.delete(makeDeleteRequest({
			operation: 'frontmatter',
			keys: ['b', 'd'],
		}));

		expect(fm).toEqual({a: 1, c: 3});
	});

	it('returns new modified timestamp after delete', async () => {
		const file = makeTFile('notes/test.md', {mtime: 9999});
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			processFrontMatter: vi.fn().mockResolvedValue(undefined),
		});
		const adapter = createFrontmatterDeleteAdapter(app as never);

		const result = await adapter.delete(makeDeleteRequest({
			operation: 'frontmatter',
			keys: ['k'],
		}));

		expect(result.modified).toBe(9999);
	});

	it('does not throw when key does not exist in frontmatter (no-op)', async () => {
		const file = makeTFile();
		const fm = {existing: 'stays'};
		const processFrontMatter = vi.fn().mockImplementation(async (_f, cb) => {
			cb(fm);
		});
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			processFrontMatter,
		});
		const adapter = createFrontmatterDeleteAdapter(app as never);

		await expect(adapter.delete(makeDeleteRequest({
			operation: 'frontmatter',
			keys: ['notExisting'],
		}))).resolves.toBeDefined();

		expect(fm).toEqual({existing: 'stays'});
	});
});
