/**
 * Behavioral tests for SearchAdapter.
 *
 * Verifies that createSearchAdapter() returns a SearchAdapter that correctly
 * handles all four search operations (listDir, byTag, byName, listTags) and
 * applies cursor-based pagination. All behaviors are exercised through the
 * public search() method.
 */

import {describe, it, expect, vi} from 'vitest';
import {createSearchAdapter} from '../../src/obsidian/search-adapter';
import type {CoreSearchRequest} from '../../src/types/canonical';

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

function makeTFile(overrides: {
	path: string;
	name?: string;
	ctime?: number;
	mtime?: number;
	size?: number;
	parent?: {path: string} | null;
}) {
	return {
		path: overrides.path,
		name: overrides.name ?? overrides.path.split('/').pop() ?? overrides.path,
		stat: makeStat({ctime: overrides.ctime, mtime: overrides.mtime, size: overrides.size}),
		parent: overrides.parent ?? null,
	};
}

function makeApp(overrides: {
	markdownFiles?: ReturnType<typeof makeTFile>[];
	allFiles?: ReturnType<typeof makeTFile>[];
	cacheMap?: Map<ReturnType<typeof makeTFile>, {tags?: {tag: string}[]; frontmatter?: Record<string, unknown>} | null>;
	readFile?: Map<ReturnType<typeof makeTFile>, string>;
}) {
	const markdownFiles = overrides.markdownFiles ?? [];
	const allFiles = overrides.allFiles ?? markdownFiles;
	const cacheMap = overrides.cacheMap ?? new Map();
	const readFile = overrides.readFile ?? new Map();

	return {
		vault: {
			getMarkdownFiles: vi.fn(() => markdownFiles),
			getFiles: vi.fn(() => allFiles),
			read: vi.fn(async (file: ReturnType<typeof makeTFile>) => readFile.get(file) ?? ''),
		},
		metadataCache: {
			getFileCache: vi.fn((file: ReturnType<typeof makeTFile>) => cacheMap.get(file) ?? null),
		},
	};
}

function makeSearchRequest(overrides: Partial<CoreSearchRequest> = {}): CoreSearchRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'byName',
		...overrides,
	};
}

function encodeOffset(offset: number): string {
	return Buffer.from(String(offset)).toString('base64');
}

// ---------------------------------------------------------------------------
// listDir
// ---------------------------------------------------------------------------

describe('SearchAdapter — listDir', () => {
	it('returns files whose path starts with given directory path', async () => {
		const fileA = makeTFile({path: 'notes/a.md', name: 'a.md', ctime: 100, mtime: 200, size: 10});
		const fileB = makeTFile({path: 'notes/b.md', name: 'b.md', ctime: 300, mtime: 400, size: 20});
		const fileC = makeTFile({path: 'other/c.md', name: 'c.md'});
		const app = makeApp({allFiles: [fileA, fileB, fileC]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'listDir', path: 'notes/'}));

		expect(result.items).toHaveLength(2);
		expect(result.items[0]).toMatchObject({
			path: 'notes/a.md',
			name: 'a.md',
			created: 100,
			modified: 200,
			size: 10,
		});
		expect(result.items[1]).toMatchObject({path: 'notes/b.md'});
	});

	it('returns empty items array for empty directory', async () => {
		const app = makeApp({allFiles: []});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'listDir', path: 'notes/'}));

		expect(result.items).toEqual([]);
	});

	it('excludes files not under the given path prefix', async () => {
		const file = makeTFile({path: 'archive/old.md'});
		const app = makeApp({allFiles: [file]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'listDir', path: 'notes/'}));

		expect(result.items).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// byTag
// ---------------------------------------------------------------------------

describe('SearchAdapter — byTag', () => {
	it('returns notes matching query tag using metadataCache', async () => {
		const fileA = makeTFile({path: 'notes/a.md', name: 'a.md', ctime: 10, mtime: 20, size: 5});
		const fileB = makeTFile({path: 'notes/b.md', name: 'b.md'});
		const cacheMap = new Map([
			[fileA, {tags: [{tag: '#project'}, {tag: '#active'}]}],
			[fileB, {tags: [{tag: '#archive'}]}],
		]);
		const app = makeApp({markdownFiles: [fileA, fileB], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byTag', query: '#project'}));

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			path: 'notes/a.md',
			name: 'a.md',
			created: 10,
			modified: 20,
			size: 5,
		});
	});

	it('returns empty array when no notes match the tag', async () => {
		const file = makeTFile({path: 'notes/a.md'});
		const cacheMap = new Map([[file, {tags: [{tag: '#other'}]}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byTag', query: '#project'}));

		expect(result.items).toEqual([]);
	});

	it('returns empty array when file has no cache entry', async () => {
		const file = makeTFile({path: 'notes/a.md'});
		const app = makeApp({markdownFiles: [file], cacheMap: new Map()});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byTag', query: '#project'}));

		expect(result.items).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// byName
// ---------------------------------------------------------------------------

describe('SearchAdapter — byName', () => {
	it('returns files matching name substring (case-insensitive)', async () => {
		const fileA = makeTFile({path: 'notes/Meeting Notes.md', name: 'Meeting Notes.md'});
		const fileB = makeTFile({path: 'notes/meeting-summary.md', name: 'meeting-summary.md'});
		const fileC = makeTFile({path: 'notes/project.md', name: 'project.md'});
		const app = makeApp({allFiles: [fileA, fileB, fileC]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: 'meeting'}));

		expect(result.items).toHaveLength(2);
		expect(result.items.map((i) => i.name)).toContain('Meeting Notes.md');
		expect(result.items.map((i) => i.name)).toContain('meeting-summary.md');
	});

	it('returns empty array when no files match name', async () => {
		const file = makeTFile({path: 'notes/project.md', name: 'project.md'});
		const app = makeApp({allFiles: [file]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: 'xyz'}));

		expect(result.items).toEqual([]);
	});

	it('is case-insensitive for both query and file name', async () => {
		const file = makeTFile({path: 'UPPER.md', name: 'UPPER.md'});
		const app = makeApp({allFiles: [file]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: 'upper'}));

		expect(result.items).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// listTags
// ---------------------------------------------------------------------------

describe('SearchAdapter — listTags', () => {
	it('returns all unique tags as CoreSearchItems with tag in tags field', async () => {
		const fileA = makeTFile({path: 'notes/a.md'});
		const fileB = makeTFile({path: 'notes/b.md'});
		const cacheMap = new Map([
			[fileA, {tags: [{tag: '#project'}, {tag: '#active'}]}],
			[fileB, {tags: [{tag: '#project'}]}],
		]);
		const app = makeApp({markdownFiles: [fileA, fileB], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'listTags'}));

		expect(result.items).toHaveLength(2);
		const projectItem = result.items.find((i) => i.tags?.includes('#project'));
		expect(projectItem).toBeDefined();
		expect(projectItem?.name).toBe('#project');
	});

	it('counts note occurrences per tag correctly', async () => {
		const fileA = makeTFile({path: 'notes/a.md'});
		const fileB = makeTFile({path: 'notes/b.md'});
		const fileC = makeTFile({path: 'notes/c.md'});
		const cacheMap = new Map([
			[fileA, {tags: [{tag: '#project'}]}],
			[fileB, {tags: [{tag: '#project'}]}],
			[fileC, {tags: [{tag: '#archive'}]}],
		]);
		const app = makeApp({markdownFiles: [fileA, fileB, fileC], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'listTags'}));

		const projectItem = result.items.find((i) => i.tags?.includes('#project'));
		const archiveItem = result.items.find((i) => i.tags?.includes('#archive'));
		expect(projectItem?.size).toBe(2);
		expect(archiveItem?.size).toBe(1);
	});

	it('returns empty array when no markdown files have tags', async () => {
		const file = makeTFile({path: 'notes/a.md'});
		const app = makeApp({markdownFiles: [file], cacheMap: new Map([[file, null]])});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'listTags'}));

		expect(result.items).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// byContent
// ---------------------------------------------------------------------------

describe('SearchAdapter — byContent', () => {
	it('returns notes whose content contains the query string', async () => {
		const fileA = makeTFile({path: 'notes/a.md', name: 'a.md', ctime: 10, mtime: 20, size: 5});
		const fileB = makeTFile({path: 'notes/b.md', name: 'b.md'});
		const app = makeApp({
			markdownFiles: [fileA, fileB],
			readFile: new Map([
				[fileA, 'This note is about project management.'],
				[fileB, 'Nothing relevant here.'],
			]),
		});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byContent', query: 'project management'}));

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({path: 'notes/a.md', name: 'a.md', created: 10, modified: 20, size: 5});
	});

	it('is case-insensitive', async () => {
		const file = makeTFile({path: 'notes/a.md'});
		const app = makeApp({
			markdownFiles: [file],
			readFile: new Map([[file, 'Contains PROJECT MANAGEMENT details']]),
		});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byContent', query: 'project management'}));

		expect(result.items).toHaveLength(1);
	});

	it('returns empty array when no notes match', async () => {
		const file = makeTFile({path: 'notes/a.md'});
		const app = makeApp({
			markdownFiles: [file],
			readFile: new Map([[file, 'Nothing about that topic.']]),
		});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byContent', query: 'zebra'}));

		expect(result.items).toEqual([]);
	});

	it('respects path prefix scope', async () => {
		const fileA = makeTFile({path: 'notes/a.md'});
		const fileB = makeTFile({path: 'archive/b.md'});
		const app = makeApp({
			markdownFiles: [fileA, fileB],
			readFile: new Map([
				[fileA, 'project management in notes'],
				[fileB, 'project management in archive'],
			]),
		});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byContent', query: 'project management', path: 'notes/'}));

		expect(result.items).toHaveLength(1);
		expect(result.items[0].path).toBe('notes/a.md');
	});

	it('paginates results', async () => {
		const files = Array.from({length: 10}, (_, i) => makeTFile({path: `notes/file${i}.md`, name: `file${i}.md`}));
		const readFile = new Map(files.map((f) => [f, 'contains the search term'] as [ReturnType<typeof makeTFile>, string]));
		const app = makeApp({markdownFiles: files, readFile});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byContent', query: 'search term', limit: 3}));

		expect(result.items).toHaveLength(3);
		expect(result.cursor).toBeDefined();
		expect(result.total).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// byFrontmatter
// ---------------------------------------------------------------------------

describe('SearchAdapter — byFrontmatter', () => {
	it('finds notes with matching key=value', async () => {
		const fileA = makeTFile({path: 'notes/a.md', name: 'a.md', ctime: 10, mtime: 20, size: 5});
		const fileB = makeTFile({path: 'notes/b.md', name: 'b.md'});
		const cacheMap = new Map([
			[fileA, {frontmatter: {status: 'active'}}],
			[fileB, {frontmatter: {status: 'archived'}}],
		]);
		const app = makeApp({markdownFiles: [fileA, fileB], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byFrontmatter', query: 'status=active'}));

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({path: 'notes/a.md', name: 'a.md', created: 10, modified: 20, size: 5});
	});

	it('key-only query returns notes that have the frontmatter key', async () => {
		const fileA = makeTFile({path: 'notes/a.md'});
		const fileB = makeTFile({path: 'notes/b.md'});
		const cacheMap = new Map([
			[fileA, {frontmatter: {status: 'active'}}],
			[fileB, {frontmatter: {title: 'No status here'}}],
		]);
		const app = makeApp({markdownFiles: [fileA, fileB], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byFrontmatter', query: 'status'}));

		expect(result.items).toHaveLength(1);
		expect(result.items[0].path).toBe('notes/a.md');
	});

	it('is case-insensitive on values', async () => {
		const file = makeTFile({path: 'notes/a.md'});
		const cacheMap = new Map([[file, {frontmatter: {status: 'Active'}}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byFrontmatter', query: 'status=active'}));

		expect(result.items).toHaveLength(1);
	});

	it('returns empty array when no notes match', async () => {
		const file = makeTFile({path: 'notes/a.md'});
		const cacheMap = new Map([[file, {frontmatter: {status: 'archived'}}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byFrontmatter', query: 'status=active'}));

		expect(result.items).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('SearchAdapter — pagination', () => {
	function makeFiles(count: number) {
		return Array.from({length: count}, (_, i) =>
			makeTFile({path: `notes/file${i}.md`, name: `file${i}.md`}),
		);
	}

	it('applies default limit of 50', async () => {
		const files = makeFiles(60);
		const app = makeApp({allFiles: files});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: 'file'}));

		expect(result.items).toHaveLength(50);
	});

	it('returns cursor when results exceed limit', async () => {
		const files = makeFiles(60);
		const app = makeApp({allFiles: files});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: 'file'}));

		expect(result.cursor).toBeDefined();
		expect(result.cursor).toBe(encodeOffset(50));
	});

	it('returns no cursor on last page', async () => {
		const files = makeFiles(60);
		const app = makeApp({allFiles: files});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(
			makeSearchRequest({operation: 'byName', query: 'file', cursor: encodeOffset(50)}),
		);

		expect(result.items).toHaveLength(10);
		expect(result.cursor).toBeUndefined();
	});

	it('returns next page items when cursor is provided', async () => {
		const files = makeFiles(60);
		const app = makeApp({allFiles: files});
		const adapter = createSearchAdapter(app as never);

		const page1 = await adapter.search(makeSearchRequest({operation: 'byName', query: 'file'}));
		const page2 = await adapter.search(
			makeSearchRequest({operation: 'byName', query: 'file', cursor: page1.cursor}),
		);

		const allPaths = [...page1.items.map((i) => i.path), ...page2.items.map((i) => i.path)];
		expect(new Set(allPaths).size).toBe(60);
	});

	it('respects custom limit', async () => {
		const files = makeFiles(20);
		const app = makeApp({allFiles: files});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(
			makeSearchRequest({operation: 'byName', query: 'file', limit: 5}),
		);

		expect(result.items).toHaveLength(5);
		expect(result.cursor).toBe(encodeOffset(5));
	});

	it('returns total count of matching results', async () => {
		const files = makeFiles(60);
		const app = makeApp({allFiles: files});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: 'file'}));

		expect(result.total).toBe(60);
	});
});
