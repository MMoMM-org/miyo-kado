/**
 * Behavioral tests for FrontmatterAdapter.
 *
 * Tests the read/write behavior of the frontmatter adapter through its public
 * ReadWriteAdapter interface. Inline mock helpers avoid modifying the shared
 * obsidian mock, as required by the T3.2 parallel-agent contract.
 */

import {describe, it, expect, vi} from 'vitest';
import {createFrontmatterAdapter} from '../../src/obsidian/frontmatter-adapter';
import type {CoreReadRequest, CoreWriteRequest} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Inline mock helpers — do NOT import from test/__mocks__/obsidian.ts
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

function makeApp(overrides?: {
	getFileByPath?: ReturnType<typeof vi.fn>;
	getFileCache?: ReturnType<typeof vi.fn>;
	processFrontMatter?: ReturnType<typeof vi.fn>;
}) {
	return {
		vault: {
			getFileByPath: overrides?.getFileByPath ?? vi.fn(),
		},
		metadataCache: {
			getFileCache: overrides?.getFileCache ?? vi.fn(),
		},
		fileManager: {
			processFrontMatter: overrides?.processFrontMatter ?? vi.fn(),
		},
	};
}

// ---------------------------------------------------------------------------
// Request factories
// ---------------------------------------------------------------------------

function makeReadRequest(path = 'notes/test.md'): CoreReadRequest {
	return {apiKeyId: 'kado_test-key', operation: 'frontmatter', path};
}

function makeWriteRequest(
	content: Record<string, unknown>,
	overrides?: Partial<CoreWriteRequest>,
): CoreWriteRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'frontmatter',
		path: 'notes/test.md',
		content,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// read() — happy path with frontmatter
// ---------------------------------------------------------------------------

describe('createFrontmatterAdapter() — read()', () => {
	it('returns frontmatter object as content with file timestamps', async () => {
		const file = makeTFile('notes/test.md', {ctime: 1000, mtime: 2000, size: 256});
		const frontmatter = {title: 'Hello', tags: ['a', 'b']};

		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			getFileCache: vi.fn().mockReturnValue({frontmatter}),
		});

		const adapter = createFrontmatterAdapter(app as never);
		const result = await adapter.read(makeReadRequest('notes/test.md'));

		expect(result.path).toBe('notes/test.md');
		expect(result.content).toEqual({title: 'Hello', tags: ['a', 'b']});
		expect(result.created).toBe(1000);
		expect(result.modified).toBe(2000);
		expect(result.size).toBe(256);
	});

	it('returns empty object as content when note has no frontmatter', async () => {
		const file = makeTFile();
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			getFileCache: vi.fn().mockReturnValue({frontmatter: undefined}),
		});

		const adapter = createFrontmatterAdapter(app as never);
		const result = await adapter.read(makeReadRequest());

		expect(result.content).toEqual({});
	});

	it('returns empty object when getFileCache returns null', async () => {
		const file = makeTFile();
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			getFileCache: vi.fn().mockReturnValue(null),
		});

		const adapter = createFrontmatterAdapter(app as never);
		const result = await adapter.read(makeReadRequest());

		expect(result.content).toEqual({});
	});

	it('throws NOT_FOUND error when file does not exist', async () => {
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(null),
		});

		const adapter = createFrontmatterAdapter(app as never);
		await expect(adapter.read(makeReadRequest('notes/missing.md'))).rejects.toMatchObject({
			code: 'NOT_FOUND',
			message: expect.stringContaining('notes/missing.md'),
		});
	});
});

// ---------------------------------------------------------------------------
// write() — with expectedModified (optimistic concurrency)
// ---------------------------------------------------------------------------

describe('createFrontmatterAdapter() — write()', () => {
	it('calls processFrontMatter and merges content into frontmatter fields', async () => {
		const file = makeTFile('notes/test.md', {ctime: 1000, mtime: 3000, size: 300});
		let captured: Record<string, unknown> = {};

		const processFrontMatter = vi.fn().mockImplementation(
			async (_file: unknown, fn: (fm: Record<string, unknown>) => void) => {
				const fm: Record<string, unknown> = {existingKey: 'keep'};
				fn(fm);
				captured = {...fm};
			},
		);

		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			processFrontMatter,
		});

		const adapter = createFrontmatterAdapter(app as never);
		await adapter.write(
			makeWriteRequest({title: 'New Title'}, {expectedModified: 2000}),
		);

		expect(processFrontMatter).toHaveBeenCalledOnce();
		expect(captured).toMatchObject({existingKey: 'keep', title: 'New Title'});
	});

	it('returns CoreWriteResult with file stats after write', async () => {
		const file = makeTFile('notes/test.md', {ctime: 1000, mtime: 3000, size: 300});

		const processFrontMatter = vi.fn().mockImplementation(
			async (_file: unknown, fn: (fm: Record<string, unknown>) => void) => {
				fn({});
			},
		);

		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			processFrontMatter,
		});

		const adapter = createFrontmatterAdapter(app as never);
		const result = await adapter.write(
			makeWriteRequest({title: 'Test'}, {expectedModified: 2000}),
		);

		expect(result).toMatchObject({
			path: 'notes/test.md',
			created: 1000,
			modified: 3000,
		});
	});

	it('adds new fields from content into frontmatter', async () => {
		const file = makeTFile();
		let captured: Record<string, unknown> = {};

		const processFrontMatter = vi.fn().mockImplementation(
			async (_file: unknown, fn: (fm: Record<string, unknown>) => void) => {
				const fm: Record<string, unknown> = {};
				fn(fm);
				captured = {...fm};
			},
		);

		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			processFrontMatter,
		});

		const adapter = createFrontmatterAdapter(app as never);
		await adapter.write(makeWriteRequest({newField: 'value', count: 42}));

		expect(captured).toEqual({newField: 'value', count: 42});
	});

	it('works without expectedModified (create frontmatter on new note)', async () => {
		const file = makeTFile();
		const processFrontMatter = vi.fn().mockImplementation(
			async (_file: unknown, fn: (fm: Record<string, unknown>) => void) => {
				fn({});
			},
		);

		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(file),
			processFrontMatter,
		});

		const adapter = createFrontmatterAdapter(app as never);
		const result = await adapter.write(makeWriteRequest({tag: 'new'}));

		expect(processFrontMatter).toHaveBeenCalledOnce();
		expect(result).toMatchObject({path: 'notes/test.md'});
	});

	it('throws NOT_FOUND error when file does not exist on write', async () => {
		const app = makeApp({
			getFileByPath: vi.fn().mockReturnValue(null),
		});

		const adapter = createFrontmatterAdapter(app as never);
		await expect(adapter.write(makeWriteRequest({title: 'Test'}))).rejects.toMatchObject({
			code: 'NOT_FOUND',
			message: expect.stringContaining('notes/test.md'),
		});
	});
});

// ---------------------------------------------------------------------------
// write() — mode=merge (default): deep-merge semantics
// ---------------------------------------------------------------------------

describe('createFrontmatterAdapter() — write() mode=merge', () => {
	function captureProcessFrontMatter(initial: Record<string, unknown>) {
		let captured: Record<string, unknown> = {};
		const fn = vi.fn().mockImplementation(
			async (_file: unknown, mutator: (fm: Record<string, unknown>) => void) => {
				const fm: Record<string, unknown> = JSON.parse(JSON.stringify(initial)) as Record<string, unknown>;
				mutator(fm);
				captured = fm;
			},
		);
		return {fn, get: () => captured};
	}

	it('deep-merges nested objects instead of replacing them (default mode)', async () => {
		const file = makeTFile();
		const proc = captureProcessFrontMatter({tomo: {state: 'pending', doc_type: 'suggestion'}});
		const app = makeApp({getFileByPath: vi.fn().mockReturnValue(file), processFrontMatter: proc.fn});

		const adapter = createFrontmatterAdapter(app as never);
		await adapter.write(makeWriteRequest({tomo: {state: 'approved'}}));

		expect(proc.get()).toEqual({tomo: {state: 'approved', doc_type: 'suggestion'}});
	});

	it('replaces arrays at every level (no concat)', async () => {
		const file = makeTFile();
		const proc = captureProcessFrontMatter({tags: ['#a', '#b'], tomo: {tags: ['x']}});
		const app = makeApp({getFileByPath: vi.fn().mockReturnValue(file), processFrontMatter: proc.fn});

		const adapter = createFrontmatterAdapter(app as never);
		await adapter.write(makeWriteRequest({tags: ['#c'], tomo: {tags: ['y', 'z']}}));

		expect(proc.get()).toEqual({tags: ['#c'], tomo: {tags: ['y', 'z']}});
	});

	it('preserves untouched top-level keys', async () => {
		const file = makeTFile();
		const proc = captureProcessFrontMatter({title: 'Keep me', tomo: {state: 'pending'}, count: 7});
		const app = makeApp({getFileByPath: vi.fn().mockReturnValue(file), processFrontMatter: proc.fn});

		const adapter = createFrontmatterAdapter(app as never);
		await adapter.write(makeWriteRequest({tomo: {state: 'approved'}}, {mode: 'merge'}));

		expect(proc.get()).toEqual({title: 'Keep me', tomo: {state: 'approved'}, count: 7});
	});
});

// ---------------------------------------------------------------------------
// write() — mode=replace: clear-then-set semantics
// ---------------------------------------------------------------------------

describe('createFrontmatterAdapter() — write() mode=replace', () => {
	function captureProcessFrontMatter(initial: Record<string, unknown>) {
		let captured: Record<string, unknown> = {};
		const fn = vi.fn().mockImplementation(
			async (_file: unknown, mutator: (fm: Record<string, unknown>) => void) => {
				const fm: Record<string, unknown> = JSON.parse(JSON.stringify(initial)) as Record<string, unknown>;
				mutator(fm);
				captured = fm;
			},
		);
		return {fn, get: () => captured};
	}

	it('clears all existing keys before writing supplied keys', async () => {
		const file = makeTFile();
		const proc = captureProcessFrontMatter({title: 'Old', tomo: {state: 'pending'}, tags: ['#a']});
		const app = makeApp({getFileByPath: vi.fn().mockReturnValue(file), processFrontMatter: proc.fn});

		const adapter = createFrontmatterAdapter(app as never);
		await adapter.write(makeWriteRequest({tomo: {state: 'approved'}}, {mode: 'replace'}));

		expect(proc.get()).toEqual({tomo: {state: 'approved'}});
	});

	it('produces an empty frontmatter block when supplied object is empty', async () => {
		const file = makeTFile();
		const proc = captureProcessFrontMatter({title: 'Old', tags: ['#a']});
		const app = makeApp({getFileByPath: vi.fn().mockReturnValue(file), processFrontMatter: proc.fn});

		const adapter = createFrontmatterAdapter(app as never);
		await adapter.write(makeWriteRequest({}, {mode: 'replace'}));

		expect(proc.get()).toEqual({});
	});
});
