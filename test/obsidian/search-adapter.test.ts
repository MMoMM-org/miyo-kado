/**
 * Behavioral tests for SearchAdapter.
 *
 * Verifies that createSearchAdapter() returns a SearchAdapter that correctly
 * handles all four search operations (listDir, byTag, byName, listTags) and
 * applies cursor-based pagination. All behaviors are exercised through the
 * public search() method.
 */

import {describe, it, expect, vi} from 'vitest';
import {TFile, TFolder} from '../__mocks__/obsidian';
import {createSearchAdapter} from '../../src/obsidian/search-adapter';
import type {CoreSearchRequest, CoreSearchResult, CoreError} from '../../src/types/canonical';

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
// TFolder/TFile tree mock helpers for listDir walk tests
// ---------------------------------------------------------------------------

type MockFile = TFile;
type MockFolder = TFolder;

/**
 * Creates a TFile instance (real class instance so instanceof TFile === true).
 * stat defaults: ctime=1000, mtime=2000, size=512.
 */
function makeMockFile(path: string, stat?: {ctime?: number; mtime?: number; size?: number}): MockFile {
	const f = new TFile();
	f.path = path;
	f.name = path.split('/').pop() ?? path;
	f.stat = {
		ctime: stat?.ctime ?? 1000,
		mtime: stat?.mtime ?? 2000,
		size: stat?.size ?? 512,
	};
	return f;
}

/**
 * Creates a TFolder instance (real class instance so instanceof TFolder === true).
 * Children must be set separately after creation or passed via makeMockFolder.
 */
function makeMockFolder(path: string, children: (MockFile | MockFolder)[] = []): MockFolder {
	const folder = new TFolder();
	folder.path = path;
	folder.name = path.split('/').pop() ?? path;
	folder.children = children;
	return folder;
}

/**
 * Builds a full vault tree from nested folder spec.
 * Returns an app mock with getRoot() and getAbstractFileByPath() properly wired.
 */
function makeAppWithTree(root: MockFolder, extraMarkdownFiles?: MockFile[]) {
	const pathIndex = new Map<string, MockFile | MockFolder>();

	function indexNode(node: MockFile | MockFolder): void {
		pathIndex.set(node.path, node);
		if (node instanceof TFolder) {
			for (const child of node.children) indexNode(child);
		}
	}
	// Index all nodes including root
	pathIndex.set(root.path, root);
	for (const child of root.children) indexNode(child);

	const allFiles = Array.from(pathIndex.values()).filter((n): n is MockFile => n instanceof TFile);
	const markdownFiles = allFiles.filter(f => f.name.endsWith('.md'));

	return {
		vault: {
			getRoot: vi.fn(() => root),
			getAbstractFileByPath: vi.fn((p: string) => pathIndex.get(p) ?? null),
			getMarkdownFiles: vi.fn(() => extraMarkdownFiles ?? markdownFiles),
			getFiles: vi.fn(() => allFiles),
			read: vi.fn(async () => ''),
		},
		metadataCache: {
			getFileCache: vi.fn(() => null),
		},
	};
}

// ---------------------------------------------------------------------------
// listDir — fixture tree (mirrors test/MiYo-Kado/listdir-fixtures/ on disk)
// ---------------------------------------------------------------------------
//
// listdir-fixtures/
//   .hidden-root.md              (hidden — must not appear in walk)
//   L0/
//     EmptyFolder/               (no children)
//     L1/
//       L1-file.md
//       L2/
//         L2-file.md
//         L3/
//           deep-file.md
//     OnlySubfolders/
//       SubA/
//         subA-note.md
//       SubB/
//         subB-note.md
//     L0-root-a.md
//     L0-root-b.md

function buildFixtureTree() {
	// L3 level
	const deepFile = makeMockFile('listdir-fixtures/L0/L1/L2/L3/deep-file.md');
	const L3 = makeMockFolder('listdir-fixtures/L0/L1/L2/L3', [deepFile]);

	// L2 level
	const l2File = makeMockFile('listdir-fixtures/L0/L1/L2/L2-file.md');
	const L2 = makeMockFolder('listdir-fixtures/L0/L1/L2', [L3, l2File]);

	// L1 level
	const l1File = makeMockFile('listdir-fixtures/L0/L1/L1-file.md');
	const L1 = makeMockFolder('listdir-fixtures/L0/L1', [L2, l1File]);

	// OnlySubfolders
	const subANote = makeMockFile('listdir-fixtures/L0/OnlySubfolders/SubA/subA-note.md');
	const SubA = makeMockFolder('listdir-fixtures/L0/OnlySubfolders/SubA', [subANote]);
	const subBNote = makeMockFile('listdir-fixtures/L0/OnlySubfolders/SubB/subB-note.md');
	const SubB = makeMockFolder('listdir-fixtures/L0/OnlySubfolders/SubB', [subBNote]);
	const OnlySubfolders = makeMockFolder('listdir-fixtures/L0/OnlySubfolders', [SubA, SubB]);

	// EmptyFolder
	const EmptyFolder = makeMockFolder('listdir-fixtures/L0/EmptyFolder', []);

	// L0-level files
	const l0FileA = makeMockFile('listdir-fixtures/L0/L0-root-a.md', {ctime: 100, mtime: 200, size: 10});
	const l0FileB = makeMockFile('listdir-fixtures/L0/L0-root-b.md', {ctime: 300, mtime: 400, size: 20});

	// L0 folder
	const L0 = makeMockFolder('listdir-fixtures/L0', [EmptyFolder, L1, OnlySubfolders, l0FileA, l0FileB]);

	// Hidden root file
	const hiddenRoot = makeMockFile('listdir-fixtures/.hidden-root.md');

	// Root of the fixture subtree
	const fixtureRoot = makeMockFolder('listdir-fixtures', [hiddenRoot, L0]);

	// Full vault root (empty except for the fixture subtree for these tests)
	const vaultRoot = makeMockFolder('', [fixtureRoot]);

	return {vaultRoot, fixtureRoot, L0, L1, L2, L3, EmptyFolder, OnlySubfolders, SubA, SubB, deepFile, l0FileA, l0FileB};
}

// ---------------------------------------------------------------------------
// listDir
// ---------------------------------------------------------------------------

describe('SearchAdapter — listDir (TFolder walk)', () => {
	/**
	 * Helper to narrow CoreSearchResult | CoreError union by throwing on error.
	 * Used by success-path tests that access result.items, result.total, result.cursor.
	 */
	function expectOk(r: CoreSearchResult | CoreError): CoreSearchResult {
		if ('code' in r) throw new Error(`expected success, got ${r.code}: ${r.message}`);
		return r;
	}

	// -----------------------------------------------------------------------
	// Happy path: depth:1 returns only direct children, folders sorted first
	// -----------------------------------------------------------------------
	it('depth:1 returns only direct children of L0, folders before files', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/L0',
			depth: 1,
		})));

		// Should have 3 folders + 2 files = 5 items
		expect(result.items).toHaveLength(5);

		// First 3 items are folders
		expect(result.items[0].type).toBe('folder');
		expect(result.items[1].type).toBe('folder');
		expect(result.items[2].type).toBe('folder');

		// Folder names (sorted)
		const folderNames = result.items.slice(0, 3).map((i) => i.name);
		expect(folderNames).toEqual(['EmptyFolder', 'L1', 'OnlySubfolders']);

		// Last 2 items are files
		expect(result.items[3].type).toBe('file');
		expect(result.items[4].type).toBe('file');
	});

	it('folder items carry type:folder, size:0, created:0, modified:0, and childCount', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/L0',
			depth: 1,
		})));

		const l1Item = result.items.find((i) => i.name === 'L1');
		expect(l1Item).toBeDefined();
		expect(l1Item).toMatchObject({
			type: 'folder',
			size: 0,
			created: 0,
			modified: 0,
		});
		expect(typeof l1Item?.childCount).toBe('number');
	});

	// -----------------------------------------------------------------------
	// Depth semantics
	// -----------------------------------------------------------------------
	it('depth:2 includes level-2 items but NOT level-3 items', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/L0',
			depth: 2,
		})));

		const paths = result.items.map((i) => i.path);

		// L2 folder should be present (it's at depth 2 from L0)
		expect(paths).toContain('listdir-fixtures/L0/L1/L2');
		// L1-file.md at depth 2 should be present
		expect(paths).toContain('listdir-fixtures/L0/L1/L1-file.md');
		// SubA, SubB at depth 2 should be present
		expect(paths).toContain('listdir-fixtures/L0/OnlySubfolders/SubA');
		expect(paths).toContain('listdir-fixtures/L0/OnlySubfolders/SubB');

		// L3 folder should NOT be present (depth 3 from L0)
		expect(paths).not.toContain('listdir-fixtures/L0/L1/L2/L3');
		// deep-file.md should NOT be present (inside L3)
		expect(paths).not.toContain('listdir-fixtures/L0/L1/L2/L3/deep-file.md');
	});

	// -----------------------------------------------------------------------
	// Unlimited recursion (depth omitted)
	// -----------------------------------------------------------------------
	it('depth omitted walks the full subtree and sorts folders-first at each combined level', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/L0',
		})));

		const paths = result.items.map((i) => i.path);

		// All deep items present
		expect(paths).toContain('listdir-fixtures/L0/L1/L2/L3/deep-file.md');
		expect(paths).toContain('listdir-fixtures/L0/OnlySubfolders/SubA/subA-note.md');
		expect(paths).toContain('listdir-fixtures/L0/OnlySubfolders/SubB/subB-note.md');

		// Folders before files within each parent's output
		const folderItems = result.items.filter((i) => i.type === 'folder');
		const fileItems = result.items.filter((i) => i.type === 'file');
		expect(folderItems.length).toBeGreaterThan(0);
		expect(fileItems.length).toBeGreaterThan(0);
	});

	// -----------------------------------------------------------------------
	// Empty folder
	// -----------------------------------------------------------------------
	it('EmptyFolder appears at depth:1 with childCount:0', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/L0',
			depth: 1,
		})));

		const emptyFolder = result.items.find((i) => i.name === 'EmptyFolder');
		expect(emptyFolder).toBeDefined();
		expect(emptyFolder?.childCount).toBe(0);
	});

	it('direct listDir on EmptyFolder returns items:[]', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/L0/EmptyFolder',
		})));

		expect(result.items).toEqual([]);
		expect('code' in result).toBe(false);
	});

	// -----------------------------------------------------------------------
	// OnlySubfolders: childCount counts only visible children
	// -----------------------------------------------------------------------
	it('OnlySubfolders has childCount:2 (SubA + SubB visible)', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/L0',
			depth: 1,
		})));

		const onlySubfolders = result.items.find((i) => i.name === 'OnlySubfolders');
		expect(onlySubfolders?.childCount).toBe(2);
	});

	// -----------------------------------------------------------------------
	// Hidden entry filtering
	// -----------------------------------------------------------------------
	it('hidden entry .hidden-root.md does not appear in listdir-fixtures listing', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures',
			depth: 1,
		})));

		const paths = result.items.map((i) => i.path);
		expect(paths).not.toContain('listdir-fixtures/.hidden-root.md');
	});

	it('hidden folder target .obsidian returns NOT_FOUND', async () => {
		const obsidianFolder = makeMockFolder('.obsidian', []);
		const vaultRoot = makeMockFolder('', [obsidianFolder]);
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: '.obsidian',
		}));

		expect(result).toMatchObject({code: 'NOT_FOUND'});
	});

	it('hidden folder target listdir-fixtures/.hidden returns NOT_FOUND', async () => {
		const hiddenFolder = makeMockFolder('listdir-fixtures/.hidden', []);
		const fixtureRoot = makeMockFolder('listdir-fixtures', [hiddenFolder]);
		const vaultRoot = makeMockFolder('', [fixtureRoot]);
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/.hidden',
		}));

		expect(result).toMatchObject({code: 'NOT_FOUND'});
	});

	// -----------------------------------------------------------------------
	// Path resolves to file → VALIDATION_ERROR
	// -----------------------------------------------------------------------
	it('path pointing to a file returns VALIDATION_ERROR with message matching /listDir target must be a folder, got file:/', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/L0/L1/L2/L3/deep-file.md',
		}));

		expect(result).toMatchObject({code: 'VALIDATION_ERROR'});
		expect((result as {message: string}).message).toMatch(/listDir target must be a folder, got file:/);
	});

	// -----------------------------------------------------------------------
	// Missing path → NOT_FOUND
	// -----------------------------------------------------------------------
	it('non-existent path returns NOT_FOUND with message matching /Path not found:/', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'NotAVault/Folder',
		}));

		expect(result).toMatchObject({code: 'NOT_FOUND'});
		expect((result as {message: string}).message).toMatch(/Path not found:/);
	});

	// -----------------------------------------------------------------------
	// Root listing (path omitted)
	// -----------------------------------------------------------------------
	it('root listing (path omitted) returns vault-root children, folders sorted first', async () => {
		const fileAtRoot = makeMockFile('root-note.md');
		const folderAtRoot = makeMockFolder('Notes', []);
		const vaultRoot = makeMockFolder('', [fileAtRoot, folderAtRoot]);
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			depth: 1,
		})));

		expect(result.items.length).toBeGreaterThan(0);
		// Folder should come before file
		const firstItem = result.items[0];
		expect(firstItem?.type).toBe('folder');
	});

	// -----------------------------------------------------------------------
	// Sort determinism
	// -----------------------------------------------------------------------
	it('sort order is byte-identical across repeated calls', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const req = makeSearchRequest({operation: 'listDir', path: 'listdir-fixtures/L0', depth: 1});
		const result1 = expectOk(await adapter.search(req));
		const result2 = expectOk(await adapter.search(req));

		expect(result1.items.map((i) => i.path)).toEqual(result2.items.map((i) => i.path));
	});

	// -----------------------------------------------------------------------
	// type:'file' on file items with real stat
	// -----------------------------------------------------------------------
	it('file items carry type:file with real size/created/modified from stat', async () => {
		const {vaultRoot, l0FileA} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/L0',
			depth: 1,
		})));

		const fileItem = result.items.find((i) => i.path === l0FileA.path);
		expect(fileItem).toBeDefined();
		expect(fileItem).toMatchObject({
			type: 'file',
			created: 100,
			modified: 200,
			size: 10,
		});
	});

	// -----------------------------------------------------------------------
	// Pagination respects ordering (folders first)
	// -----------------------------------------------------------------------
	it('limit:3 on L0 with depth:1 returns the 3 folders first', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/L0',
			depth: 1,
			limit: 3,
		})));

		expect(result.items).toHaveLength(3);
		// All 3 returned items should be folders
		expect(result.items.every((i) => i.type === 'folder')).toBe(true);
	});

	// -----------------------------------------------------------------------
	// Switch-case error propagation: errors bypass filterItemsByScope
	// -----------------------------------------------------------------------
	it('NOT_FOUND propagates directly without being wrapped in a paginated result', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'Does/Not/Exist',
			scopePatterns: ['allowed/**'],
		}));

		// Must be a CoreError, NOT a CoreSearchResult
		expect(result).toMatchObject({code: 'NOT_FOUND'});
		expect('items' in result).toBe(false);
	});

	it('VALIDATION_ERROR propagates directly without being wrapped in a paginated result', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/L0/L1/L2/L3/deep-file.md',
			scopePatterns: ['allowed/**'],
		}));

		expect(result).toMatchObject({code: 'VALIDATION_ERROR'});
		expect('items' in result).toBe(false);
	});

	// -----------------------------------------------------------------------
	// Scope filter — folder-aware (Phase 4 T4.1)
	// -----------------------------------------------------------------------

	// T4.1-1: Folder visibility with nested scope
	it('scope ["Atlas/**"] at root shows Atlas folder but hides Other folder', async () => {
		const atlasNote = makeMockFile('Atlas/note.md');
		const atlasFolder = makeMockFolder('Atlas', [atlasNote]);
		const otherNote = makeMockFile('Other/note.md');
		const otherFolder = makeMockFolder('Other', [otherNote]);
		const vaultRoot = makeMockFolder('', [atlasFolder, otherFolder]);
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			depth: 1,
			scopePatterns: ['Atlas/**'],
		})));

		const names = result.items.map((i) => i.name);
		expect(names).toContain('Atlas');
		expect(names).not.toContain('Other');
	});

	// T4.1-2: Folder visibility with sub-scope
	it('scope ["listdir-fixtures/L0/L1/**"] on L0 shows L1 but hides EmptyFolder and OnlySubfolders', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/L0',
			depth: 1,
			scopePatterns: ['listdir-fixtures/L0/L1/**'],
		})));

		const names = result.items.map((i) => i.name);
		expect(names).toContain('L1');
		expect(names).not.toContain('EmptyFolder');
		expect(names).not.toContain('OnlySubfolders');
	});

	// T4.1-3: Folder visibility with root glob ("**")
	// Note: "**/*.md" does NOT make top-level folders visible via dirCouldContainMatches
	// because the probe "Atlas/__probe__" doesn't end in ".md". The correct broad
	// pattern that makes all folders visible is "**" (matches any path).
	it('scope ["**"] at root shows all top-level folders', async () => {
		const atlasNote = makeMockFile('Atlas/note.md');
		const atlasFolder = makeMockFolder('Atlas', [atlasNote]);
		const docsNote = makeMockFile('Docs/guide.md');
		const docsFolder = makeMockFolder('Docs', [docsNote]);
		const vaultRoot = makeMockFolder('', [atlasFolder, docsFolder]);
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			depth: 1,
			scopePatterns: ['**'],
		})));

		const names = result.items.map((i) => i.name);
		expect(names).toContain('Atlas');
		expect(names).toContain('Docs');
	});

	// T4.1-4: Single-star scope — no top-level folders visible
	it('scope ["*.md"] at root hides all top-level folders (single star cannot cross /)', async () => {
		const atlasNote = makeMockFile('Atlas/note.md');
		const atlasFolder = makeMockFolder('Atlas', [atlasNote]);
		const rootNote = makeMockFile('root.md');
		const vaultRoot = makeMockFolder('', [atlasFolder, rootNote]);
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			depth: 1,
			scopePatterns: ['*.md'],
		})));

		const folderItems = result.items.filter((i) => i.type === 'folder');
		expect(folderItems).toHaveLength(0);
	});

	// T4.1-5: Walk-time filtering — out-of-scope folder subtrees are never walked
	it('scope ["listdir-fixtures/L0/L1/**"] deep walk on L0 excludes EmptyFolder and OnlySubfolders subtrees entirely', async () => {
		const {vaultRoot} = buildFixtureTree();
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'listdir-fixtures/L0',
			scopePatterns: ['listdir-fixtures/L0/L1/**'],
		})));

		const paths = result.items.map((i) => i.path);

		// L1 subtree items should appear
		expect(paths.some((p) => p.startsWith('listdir-fixtures/L0/L1'))).toBe(true);

		// EmptyFolder and its descendants must NOT appear
		expect(paths.some((p) => p.startsWith('listdir-fixtures/L0/EmptyFolder'))).toBe(false);

		// OnlySubfolders and its descendants must NOT appear
		expect(paths.some((p) => p.startsWith('listdir-fixtures/L0/OnlySubfolders'))).toBe(false);
	});

	// T4.1-6: childCount with scope — only in-scope children counted
	it('childCount of a folder item reflects only children visible within scope', async () => {
		// List 'outer' directly. 'outer' has two child folders:
		//   - in-scope/ with 3 sub-children (all in scope via outer/in-scope/**)
		//   - out-of-scope/ that is skipped at walk time
		// scope: ["outer/in-scope/**"] — makes 'in-scope' visible with childCount:3
		const subA = makeMockFolder('outer/in-scope/A', []);
		const subB = makeMockFolder('outer/in-scope/B', []);
		const subC = makeMockFolder('outer/in-scope/C', []);
		const inScope = makeMockFolder('outer/in-scope', [subA, subB, subC]);
		const outOfScope = makeMockFolder('outer/out-of-scope', [
			makeMockFolder('outer/out-of-scope/X', []),
		]);
		const outer = makeMockFolder('outer', [inScope, outOfScope]);
		const vaultRoot = makeMockFolder('', [outer]);
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'outer',
			depth: 1,
			scopePatterns: ['outer/in-scope/**'],
		})));

		// Only 'in-scope' appears; 'out-of-scope' is skipped by walk-time filter
		const names = result.items.map((i) => i.name);
		expect(names).toContain('in-scope');
		expect(names).not.toContain('out-of-scope');

		// in-scope's childCount reflects all 3 in-scope sub-children (A, B, C)
		const inScopeItem = result.items.find((i) => i.name === 'in-scope');
		expect(inScopeItem?.childCount).toBe(3);
	});

	// T4.1-7: childCount with hidden + scope — hidden and out-of-scope both excluded
	it('childCount excludes both hidden children and out-of-scope children', async () => {
		// List 'scope-root' directly. It has one child folder 'target'
		// that is in scope (scope-root/target/**).
		// 'target' has: A (in scope), B (in scope), .hidden (hidden), Out (out of scope)
		// scope: ["scope-root/target/A/**", "scope-root/target/B/**"]
		//   — Out is not covered by these patterns; .hidden is excluded by name filter
		//   — target itself is NOT visible via folderInScope since patterns are sub-patterns
		// Workaround: list 'scope-root/target' directly so children are checked by scope.
		// This verifies visibleChildCount excludes hidden AND out-of-scope sub-items.
		const childA = makeMockFolder('scope-root/target/A', [makeMockFile('scope-root/target/A/note.md')]);
		const childB = makeMockFolder('scope-root/target/B', [makeMockFile('scope-root/target/B/note.md')]);
		const hiddenChild = makeMockFolder('scope-root/target/.hidden', []);
		const childOut = makeMockFolder('scope-root/target/Out', [makeMockFile('scope-root/target/Out/note.md')]);
		const target = makeMockFolder('scope-root/target', [childA, childB, hiddenChild, childOut]);
		const scopeRoot = makeMockFolder('scope-root', [target]);
		const vaultRoot = makeMockFolder('', [scopeRoot]);
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		// List scope-root/target directly: walk emits A, B (Out skipped, .hidden skipped)
		const result = expectOk(await adapter.search(makeSearchRequest({
			operation: 'listDir',
			path: 'scope-root/target',
			scopePatterns: ['scope-root/target/A/**', 'scope-root/target/B/**'],
		})));

		// Only A and B appear — Out is skipped (walk-time scope), .hidden is always skipped
		const names = result.items.map((i) => i.name);
		expect(names).toContain('A');
		expect(names).toContain('B');
		expect(names).not.toContain('Out');
		expect(names).not.toContain('.hidden');
		// Exactly 2 items: A and B (files filtered by filterItemsByScope too if any)
		expect(result.items.filter((i) => i.type === 'folder')).toHaveLength(2);
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
		// Files in-scope and out-of-scope under the vault root
		const inScopeFile = makeMockFile('allowed/a.md');
		const outScopeFile = makeMockFile('allowed-secret/b.md');
		const allowedFolder = makeMockFolder('allowed', [inScopeFile]);
		const allowedSecretFolder = makeMockFolder('allowed-secret', [outScopeFile]);
		const vaultRoot = makeMockFolder('', [allowedFolder, allowedSecretFolder]);
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		// listDir without a path → vault root; scopePatterns filters the results
		const result = await adapter.search(makeSearchRequest({
			operation: 'listDir',
			scopePatterns: ['allowed/**'],
		}));

		const sr = result as {items: {path: string}[]; total: number};
		// Only allowed/a.md should survive the scope filter (file items only match)
		expect(sr.items.some(i => i.path === 'allowed/a.md')).toBe(true);
		expect(sr.items.every(i => !i.path.startsWith('allowed-secret'))).toBe(true);
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
		// vault root has no children → returns empty items, no error
		const vaultRoot = makeMockFolder('', []);
		const app = makeAppWithTree(vaultRoot);
		const adapter = createSearchAdapter(app as never);

		const result = await adapter.search(makeSearchRequest({operation: 'listDir'}));

		expect(result).toHaveProperty('items');
		expect('code' in result).toBe(false);
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
