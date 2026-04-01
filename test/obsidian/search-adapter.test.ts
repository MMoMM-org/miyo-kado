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

	it('normalizes path without trailing slash to avoid matching similar prefixes', async () => {
		const fileA = makeTFile({path: 'notes/a.md', name: 'a.md'});
		const fileB = makeTFile({path: 'notes-archive/b.md', name: 'b.md'});
		const app = makeApp({allFiles: [fileA, fileB]});
		const adapter = createSearchAdapter(app as never);

		// Path "notes" (no slash) is normalized to "notes/" inside the adapter
		const result = await adapter.search(makeSearchRequest({operation: 'listDir', path: 'notes'}));

		expect(result.items).toHaveLength(1);
		expect(result.items[0].path).toBe('notes/a.md');
	});

	it('root path "/" or empty lists all files', async () => {
		const fileA = makeTFile({path: 'notes/a.md', name: 'a.md'});
		const fileB = makeTFile({path: 'archive/b.md', name: 'b.md'});
		const app = makeApp({allFiles: [fileA, fileB]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'listDir', path: '/'}));

		expect(result.items).toHaveLength(2);
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

	it('supports glob wildcard * in tag query', async () => {
		const fileA = makeTFile({path: 'notes/a.md', name: 'a.md'});
		const fileB = makeTFile({path: 'notes/b.md', name: 'b.md'});
		const fileC = makeTFile({path: 'notes/c.md', name: 'c.md'});
		const cacheMap = new Map([
			[fileA, {tags: [{tag: '#project/alpha'}]}],
			[fileB, {tags: [{tag: '#project/beta'}]}],
			[fileC, {tags: [{tag: '#archive'}]}],
		]);
		const app = makeApp({markdownFiles: [fileA, fileB, fileC], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byTag', query: '#project/*'}));

		expect(result.items).toHaveLength(2);
		expect(result.items.map((i) => i.name)).toContain('a.md');
		expect(result.items.map((i) => i.name)).toContain('b.md');
	});

	it('glob tag matching is case-insensitive', async () => {
		const file = makeTFile({path: 'notes/a.md', name: 'a.md'});
		const cacheMap = new Map([[file, {tags: [{tag: '#Project'}]}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byTag', query: '#project*'}));

		expect(result.items).toHaveLength(1);
	});

	it('glob tag query returns empty when no tags match the pattern', async () => {
		const file = makeTFile({path: 'notes/a.md', name: 'a.md'});
		const cacheMap = new Map([[file, {tags: [{tag: '#project'}]}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byTag', query: '#archive/*'}));

		expect(result.items).toEqual([]);
	});

	it('glob tag query does not match partial tag names without wildcard coverage', async () => {
		const file = makeTFile({path: 'notes/a.md', name: 'a.md'});
		const cacheMap = new Map([[file, {tags: [{tag: '#project/alpha/v2'}]}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		// * does not cross / (it uses .* so it does match across /) — but the
		// pattern must still cover the full tag to match
		const result = await adapter.search(makeSearchRequest({operation: 'byTag', query: '#project/?'}));

		// #project/? matches only single-char after slash, not "alpha/v2"
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

	it('supports glob wildcard * in query', async () => {
		const fileA = makeTFile({path: 'notes/Daily Note 2026-03-28.md', name: 'Daily Note 2026-03-28.md'});
		const fileB = makeTFile({path: 'notes/Daily Note 2026-03-31.md', name: 'Daily Note 2026-03-31.md'});
		const fileC = makeTFile({path: 'notes/Meeting Notes.md', name: 'Meeting Notes.md'});
		const app = makeApp({allFiles: [fileA, fileB, fileC]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: '2026-03-*'}));

		expect(result.items).toHaveLength(2);
		expect(result.items.map((i) => i.name)).toContain('Daily Note 2026-03-28.md');
		expect(result.items.map((i) => i.name)).toContain('Daily Note 2026-03-31.md');
	});

	it('supports glob wildcard ? for single character matching', async () => {
		const fileA = makeTFile({path: 'notes/v1.md', name: 'v1.md'});
		const fileB = makeTFile({path: 'notes/v2.md', name: 'v2.md'});
		const fileC = makeTFile({path: 'notes/v10.md', name: 'v10.md'});
		const app = makeApp({allFiles: [fileA, fileB, fileC]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: 'v?.md'}));

		expect(result.items).toHaveLength(2);
		expect(result.items.map((i) => i.name)).toContain('v1.md');
		expect(result.items.map((i) => i.name)).toContain('v2.md');
	});

	it('glob matching is case-insensitive', async () => {
		const file = makeTFile({path: 'notes/README.md', name: 'README.md'});
		const app = makeApp({allFiles: [file]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: 'read*'}));

		expect(result.items).toHaveLength(1);
	});

	it('glob query returns empty when no files match the pattern', async () => {
		const file = makeTFile({path: 'notes/project.md', name: 'project.md'});
		const app = makeApp({allFiles: [file]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: '2099-*'}));

		expect(result.items).toEqual([]);
	});

	it('glob ? does not match zero characters', async () => {
		const file = makeTFile({path: 'notes/v.md', name: 'v.md'});
		const app = makeApp({allFiles: [file]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: 'v?.md'}));

		expect(result.items).toEqual([]);
	});

	it('literal asterisk in filename is not treated as glob without wildcard intent', async () => {
		// A query without glob chars uses substring matching, not glob
		const file = makeTFile({path: 'notes/normal.md', name: 'normal.md'});
		const app = makeApp({allFiles: [file]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: 'normal'}));

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
		// byContent uses early-exit: stops reading once limit is reached
		const files = Array.from({length: 10}, (_, i) => makeTFile({path: `notes/file${i}.md`, name: `file${i}.md`}));
		const readFile = new Map(files.map((f) => [f, 'contains the search term'] as [ReturnType<typeof makeTFile>, string]));
		const app = makeApp({markdownFiles: files, readFile});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byContent', query: 'search term', limit: 3}));

		expect(result.items).toHaveLength(3);
		// byContent finds all matches; pagination limits the page
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

// ---------------------------------------------------------------------------
// Scope filtering before pagination
// ---------------------------------------------------------------------------

describe('SearchAdapter — scope filtering before pagination', () => {
	it('total reflects filtered count, not pre-filter count', async () => {
		const inScope = makeTFile({path: 'allowed/a.md', name: 'a.md'});
		const outScope = makeTFile({path: 'private/b.md', name: 'b.md'});
		const app = makeApp({allFiles: [inScope, outScope]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'byName',
			query: '*.md',
			scopePatterns: ['allowed/**'],
		}));

		expect(result).toHaveProperty('items');
		const sr = result as {items: {path: string}[]; total: number};
		expect(sr.items).toHaveLength(1);
		expect(sr.total).toBe(1);
		expect(sr.items[0].path).toBe('allowed/a.md');
	});

	it('cursor is consistent with filtered results', async () => {
		// 5 in-scope files, 5 out-of-scope; limit 3
		const inScope = Array.from({length: 5}, (_, i) =>
			makeTFile({path: `allowed/f${i}.md`, name: `f${i}.md`}),
		);
		const outScope = Array.from({length: 5}, (_, i) =>
			makeTFile({path: `private/f${i}.md`, name: `f${i}.md`}),
		);
		const app = makeApp({allFiles: [...inScope, ...outScope]});
		const adapter = createSearchAdapter(app as never);

		const page1 = await adapter.search(makeSearchRequest({
			operation: 'byName',
			query: 'f*',
			limit: 3,
			scopePatterns: ['allowed/**'],
		}));

		const sr1 = page1 as {items: {path: string}[]; total: number; cursor?: string};
		expect(sr1.items).toHaveLength(3);
		expect(sr1.total).toBe(5); // all 5 in-scope files
		expect(sr1.cursor).toBeDefined();

		// Page 2 should get the remaining 2
		const page2 = await adapter.search(makeSearchRequest({
			operation: 'byName',
			query: 'f*',
			limit: 3,
			cursor: sr1.cursor,
			scopePatterns: ['allowed/**'],
		}));

		const sr2 = page2 as {items: {path: string}[]; total: number; cursor?: string};
		expect(sr2.items).toHaveLength(2);
		expect(sr2.cursor).toBeUndefined(); // last page
	});

	it('empty scopePatterns array returns no items', async () => {
		const file = makeTFile({path: 'notes/a.md', name: 'a.md'});
		const app = makeApp({allFiles: [file]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'byName',
			query: 'a*',
			scopePatterns: [],
		}));

		const sr = result as {items: {path: string}[]; total: number};
		expect(sr.items).toEqual([]);
		expect(sr.total).toBe(0);
	});

	it('undefined scopePatterns skips filtering (all items returned)', async () => {
		const fileA = makeTFile({path: 'any/a.md', name: 'a.md'});
		const fileB = makeTFile({path: 'other/b.md', name: 'b.md'});
		const app = makeApp({allFiles: [fileA, fileB]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'byName',
			query: '*.md',
		}));

		const sr = result as {items: {path: string}[]; total: number};
		expect(sr.items).toHaveLength(2);
	});

	it('scope filtering works with byContent operation', async () => {
		const inScope = makeTFile({path: 'allowed/a.md'});
		const outScope = makeTFile({path: 'private/b.md'});
		const app = makeApp({
			markdownFiles: [inScope, outScope],
			readFile: new Map([
				[inScope, 'secret keyword here'],
				[outScope, 'secret keyword here too'],
			]),
		});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'byContent',
			query: 'secret',
			scopePatterns: ['allowed/**'],
		}));

		const sr = result as {items: {path: string}[]; total: number};
		expect(sr.items).toHaveLength(1);
		expect(sr.items[0].path).toBe('allowed/a.md');
	});

	it('scope filtering works with listDir operation', async () => {
		const inScope = makeTFile({path: 'allowed/a.md', name: 'a.md'});
		const outScope = makeTFile({path: 'allowed-secret/b.md', name: 'b.md'});
		const app = makeApp({allFiles: [inScope, outScope]});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'listDir',
			scopePatterns: ['allowed/**'],
		}));

		const sr = result as {items: {path: string}[]; total: number};
		expect(sr.items).toHaveLength(1);
		expect(sr.items[0].path).toBe('allowed/a.md');
	});
});

// ---------------------------------------------------------------------------
// Empty query validation
// ---------------------------------------------------------------------------

describe('SearchAdapter — empty query validation', () => {
	it('byName with empty query returns VALIDATION_ERROR', async () => {
		const app = makeApp({allFiles: []});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: ''}));

		expect(result).toMatchObject({code: 'VALIDATION_ERROR'});
	});

	it('byName with whitespace-only query returns VALIDATION_ERROR', async () => {
		const app = makeApp({allFiles: []});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byName', query: '   '}));

		expect(result).toMatchObject({code: 'VALIDATION_ERROR'});
	});

	it('byTag with empty query returns VALIDATION_ERROR', async () => {
		const app = makeApp({markdownFiles: []});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byTag', query: ''}));

		expect(result).toMatchObject({code: 'VALIDATION_ERROR'});
	});

	it('byContent with empty query returns VALIDATION_ERROR', async () => {
		const app = makeApp({markdownFiles: []});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byContent', query: ''}));

		expect(result).toMatchObject({code: 'VALIDATION_ERROR'});
	});

	it('byFrontmatter with empty query returns VALIDATION_ERROR', async () => {
		const app = makeApp({markdownFiles: []});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'byFrontmatter', query: ''}));

		expect(result).toMatchObject({code: 'VALIDATION_ERROR'});
	});

	it('listDir with no query does NOT return an error', async () => {
		const app = makeApp({allFiles: []});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'listDir'}));

		expect(result).toHaveProperty('items');
	});

	it('listTags with no query does NOT return an error', async () => {
		const app = makeApp({markdownFiles: []});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'listTags'}));

		expect(result).toHaveProperty('items');
	});
});

// ---------------------------------------------------------------------------
// listTags — scope filtering
// ---------------------------------------------------------------------------

describe('SearchAdapter — listTags scoped', () => {
	it('returns only tags from files matching scopePatterns', async () => {
		const fileA = makeTFile({path: 'allowed/a.md'});
		const fileB = makeTFile({path: 'private/b.md'});
		const cacheMap = new Map([
			[fileA, {tags: [{tag: '#visible'}]}],
			[fileB, {tags: [{tag: '#hidden'}]}],
		]);
		const app = makeApp({markdownFiles: [fileA, fileB], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'listTags',
			scopePatterns: ['allowed/**'],
		}));

		expect(result).toHaveProperty('items');
		const items = (result as {items: {name: string}[]}).items;
		expect(items).toHaveLength(1);
		expect(items[0].name).toBe('#visible');
	});

	it('returns empty when no files match scopePatterns', async () => {
		const file = makeTFile({path: 'private/a.md'});
		const cacheMap = new Map([[file, {tags: [{tag: '#secret'}]}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'listTags',
			scopePatterns: ['allowed/**'],
		}));

		const items = (result as {items: {name: string}[]}).items;
		expect(items).toEqual([]);
	});

	it('returns empty when scopePatterns is empty array (whitelist with no paths)', async () => {
		const file = makeTFile({path: 'notes/a.md'});
		const cacheMap = new Map([[file, {tags: [{tag: '#visible'}]}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'listTags',
			scopePatterns: [],
		}));

		const items = (result as {items: {name: string}[]}).items;
		expect(items).toEqual([]);
	});

	it('returns all tags when scopePatterns is undefined', async () => {
		const fileA = makeTFile({path: 'any/a.md'});
		const fileB = makeTFile({path: 'other/b.md'});
		const cacheMap = new Map([
			[fileA, {tags: [{tag: '#one'}]}],
			[fileB, {tags: [{tag: '#two'}]}],
		]);
		const app = makeApp({markdownFiles: [fileA, fileB], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'listTags'}));

		const items = (result as {items: {name: string}[]}).items;
		expect(items).toHaveLength(2);
	});

	it('counts only in-scope occurrences per tag', async () => {
		const fileA = makeTFile({path: 'allowed/a.md'});
		const fileB = makeTFile({path: 'allowed/b.md'});
		const fileC = makeTFile({path: 'private/c.md'});
		const cacheMap = new Map([
			[fileA, {tags: [{tag: '#shared'}]}],
			[fileB, {tags: [{tag: '#shared'}]}],
			[fileC, {tags: [{tag: '#shared'}]}],
		]);
		const app = makeApp({markdownFiles: [fileA, fileB, fileC], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'listTags',
			scopePatterns: ['allowed/**'],
		}));

		const items = (result as {items: {name: string; size: number}[]}).items;
		expect(items).toHaveLength(1);
		expect(items[0].size).toBe(2); // only 2 in-scope files, not 3
	});
});

// ---------------------------------------------------------------------------
// Tag permission filtering
// ---------------------------------------------------------------------------

describe('SearchAdapter — tag permissions', () => {
	// --- listTags ---

	it('listTags returns empty when allowedTags is empty array', async () => {
		const file = makeTFile({path: 'notes/a.md'});
		const cacheMap = new Map([[file, {tags: [{tag: '#project'}]}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'listTags', allowedTags: []}));

		const items = (result as {items: {name: string}[]}).items;
		expect(items).toEqual([]);
	});

	it('listTags returns only permitted tags', async () => {
		const file = makeTFile({path: 'notes/a.md'});
		const cacheMap = new Map([[file, {tags: [{tag: '#project'}, {tag: '#secret'}, {tag: '#project/alpha'}]}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'listTags',
			allowedTags: ['project', 'project/*'],
		}));

		const items = (result as {items: {name: string}[]}).items;
		expect(items).toHaveLength(2);
		expect(items.map((i) => i.name)).toContain('#project');
		expect(items.map((i) => i.name)).toContain('#project/alpha');
	});

	it('listTags returns all tags when allowedTags is undefined', async () => {
		const file = makeTFile({path: 'notes/a.md'});
		const cacheMap = new Map([[file, {tags: [{tag: '#project'}, {tag: '#secret'}]}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'listTags'}));

		const items = (result as {items: {name: string}[]}).items;
		expect(items).toHaveLength(2);
	});

	// --- byTag ---

	it('byTag returns FORBIDDEN when allowedTags is empty', async () => {
		const app = makeApp({markdownFiles: []});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'byTag',
			query: '#project',
			allowedTags: [],
		}));

		expect(result).toMatchObject({code: 'FORBIDDEN'});
	});

	it('byTag returns FORBIDDEN for a tag not in allowedTags', async () => {
		const app = makeApp({markdownFiles: []});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'byTag',
			query: '#secret',
			allowedTags: ['project'],
		}));

		expect(result).toMatchObject({code: 'FORBIDDEN'});
	});

	it('byTag succeeds for a tag in allowedTags', async () => {
		const file = makeTFile({path: 'notes/a.md', name: 'a.md'});
		const cacheMap = new Map([[file, {tags: [{tag: '#project'}]}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'byTag',
			query: '#project',
			allowedTags: ['project'],
		}));

		expect(result).toHaveProperty('items');
		const items = (result as {items: {path: string}[]}).items;
		expect(items).toHaveLength(1);
	});

	it('byTag with wildcard only returns files with permitted tags', async () => {
		const fileA = makeTFile({path: 'notes/a.md', name: 'a.md'});
		const fileB = makeTFile({path: 'notes/b.md', name: 'b.md'});
		const cacheMap = new Map([
			[fileA, {tags: [{tag: '#project/alpha'}]}],
			[fileB, {tags: [{tag: '#secret/data'}]}],
		]);
		const app = makeApp({markdownFiles: [fileA, fileB], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'byTag',
			query: '#*',
			allowedTags: ['project/*'],
		}));

		expect(result).toHaveProperty('items');
		const items = (result as {items: {path: string}[]}).items;
		expect(items).toHaveLength(1);
		expect(items[0].path).toBe('notes/a.md');
	});

	it('byTag with glob returns empty when no matched tags are permitted', async () => {
		const file = makeTFile({path: 'notes/a.md', name: 'a.md'});
		const cacheMap = new Map([[file, {tags: [{tag: '#secret/data'}]}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'byTag',
			query: '#*',
			allowedTags: ['project/*'],
		}));

		expect(result).toHaveProperty('items');
		const items = (result as {items: {path: string}[]}).items;
		expect(items).toEqual([]);
	});

	it('byTag with wildcard allowed tag permits matching sub-tags', async () => {
		const file = makeTFile({path: 'notes/a.md', name: 'a.md'});
		const cacheMap = new Map([[file, {tags: [{tag: '#project/alpha'}]}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'byTag',
			query: '#project/alpha',
			allowedTags: ['project/*'],
		}));

		expect(result).toHaveProperty('items');
		const items = (result as {items: {path: string}[]}).items;
		expect(items).toHaveLength(1);
	});

	it('listTags does not count tags from out-of-scope files even if tag is permitted', async () => {
		const inScope = makeTFile({path: 'allowed/a.md'});
		const outScope = makeTFile({path: 'private/b.md'});
		const cacheMap = new Map([
			[inScope, {tags: [{tag: '#project'}]}],
			[outScope, {tags: [{tag: '#project'}]}],
		]);
		const app = makeApp({markdownFiles: [inScope, outScope], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'listTags',
			scopePatterns: ['allowed/**'],
			allowedTags: ['project'],
		}));

		const items = (result as {items: {name: string; size: number}[]}).items;
		expect(items).toHaveLength(1);
		expect(items[0].size).toBe(1); // only the in-scope file counts
	});

	it('byTag with undefined allowedTags applies no tag restriction', async () => {
		const file = makeTFile({path: 'notes/a.md', name: 'a.md'});
		const cacheMap = new Map([[file, {tags: [{tag: '#anything'}]}]]);
		const app = makeApp({markdownFiles: [file], cacheMap});
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'byTag',
			query: '#anything',
		}));

		expect(result).toHaveProperty('items');
		const items = (result as {items: {path: string}[]}).items;
		expect(items).toHaveLength(1);
	});
});
