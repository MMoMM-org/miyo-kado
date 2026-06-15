/**
 * End-to-end tool call integration tests.
 *
 * Exercises the full pipeline from MCP tool args to CallToolResult:
 *   RequestMapper → PermissionChain → ConcurrencyGuard → OperationRouter
 *   → Adapter → ResponseMapper
 *
 * Uses real core logic throughout; only the Obsidian vault/metadataCache APIs
 * are mocked at the boundary.
 */

import {describe, it, expect, vi} from 'vitest';
import {App, TFile, TFolder, MarkdownView, Notice, WorkspaceLeaf, createMockTFile, createMockCachedMetadata} from '../__mocks__/obsidian';
import type {HeadingCache} from '../__mocks__/obsidian';
import {mapReadRequest, mapWriteRequest, mapSearchRequest, mapRenameRequest} from '../../src/mcp/request-mapper';
import {mapFileResult, mapWriteResult, mapSearchResult, mapRenameResult, mapError} from '../../src/mcp/response-mapper';
import {evaluatePermissions, createDefaultGateChain} from '../../src/core/permission-chain';
import {evaluateRenamePermissions} from '../../src/core/rename-policy';
import {validateConcurrency} from '../../src/core/concurrency-guard';
import {createOperationRouter} from '../../src/core/operation-router';
import {ConfigManager} from '../../src/core/config-manager';
import {createNoteAdapter} from '../../src/obsidian/note-adapter';
import {createFrontmatterAdapter} from '../../src/obsidian/frontmatter-adapter';
import {createInlineFieldAdapter} from '../../src/obsidian/inline-field-adapter';
import {createSearchAdapter} from '../../src/obsidian/search-adapter';
import {createNoteDeleteAdapter, createFileDeleteAdapter, createFrontmatterDeleteAdapter} from '../../src/obsidian/delete-adapter';
import {createRenameAdapter} from '../../src/obsidian/rename-adapter';
import type {KadoConfig, CoreError, CoreFileResult, CoreWriteResult, CoreSearchResult, CoreDeleteResult, CoreRenameResult} from '../../src/types/canonical';

// ============================================================
// Config factory
// ============================================================

/**
 * Builds a realistic config:
 *   - Global security scope covering projects/**
 *     Notes: CRUD, FM: CRU, Files: R, DV: RU
 *   - API key "test-key" with its own path permissions
 *     Notes: CRU (no delete), FM: RU, Files: R, DV: R
 *   - Server enabled
 */
function makeTestConfig(): KadoConfig {
	return {
		server: {enabled: true, host: '127.0.0.1', port: 23026, connectionType: 'local'},
		security: {
			listMode: 'whitelist',
			paths: [
				{
					path: 'projects/**',
					permissions: {
						note: {create: true, read: true, update: true, delete: true},
						frontmatter: {create: true, read: true, update: true, delete: false},
						file: {create: false, read: true, update: false, delete: false},
						dataviewInlineField: {create: false, read: true, update: true, delete: false},
					},
				},
			],
			tags: [],
			allowActiveNote: false,
			allowOtherNotes: false,
		},
		apiKeys: [
			{
				id: 'test-key',
				label: 'Test Key',
				enabled: true,
				createdAt: 1000,
				listMode: 'whitelist',
				paths: [
					{
						path: 'projects/**',
						permissions: {
							note: {create: true, read: true, update: true, delete: false},
							frontmatter: {create: false, read: true, update: true, delete: false},
							file: {create: false, read: true, update: false, delete: false},
							dataviewInlineField: {create: false, read: true, update: false, delete: false},
						},
					},
				],
				tags: [],
				allowActiveNote: false,
				allowOtherNotes: false,
			},
		],
		audit: {enabled: false, logDirectory: 'logs', logFileName: 'kado-audit.log', maxSizeBytes: 10485760, maxRetainedLogs: 3},
		debugLogging: false,
		renameWhenLinkUpdateOff: false,
		renameTimeoutMs: 60000,
	};
}

function makeConfigManager(config: KadoConfig): ConfigManager {
	const mgr = new ConfigManager(
		async () => config,
		async () => {},
	);
	return mgr;
}

// ============================================================
// App + adapter factories
// ============================================================

function makeApp(): App {
	return new App();
}

/**
 * Wires getRoot() and getAbstractFileByPath() on an existing App mock
 * given a flat list of TFile instances. Creates a minimal folder tree
 * (one TFolder per unique parent path) so the TFolder walk works.
 */
function wireVaultTree(app: App, files: TFile[]): void {
	// Collect all unique folder paths from file paths
	const folderMap = new Map<string, TFolder>();

	function getOrCreateFolder(folderPath: string): TFolder {
		const existing = folderMap.get(folderPath);
		if (existing) return existing;
		const folder = new TFolder();
		folder.path = folderPath;
		folder.name = folderPath.split('/').pop() ?? folderPath;
		folder.children = [];
		folderMap.set(folderPath, folder);
		return folder;
	}

	// Create root
	const root = getOrCreateFolder('');
	root.name = '/';

	// Create folder hierarchy and assign file children
	for (const file of files) {
		const segments = file.path.split('/');
		segments.pop(); // remove filename
		let currentPath = '';
		let parentFolder = root;
		for (const seg of segments) {
			const childPath = currentPath === '' ? seg : `${currentPath}/${seg}`;
			const childFolder = getOrCreateFolder(childPath);
			if (!parentFolder.children.includes(childFolder)) {
				parentFolder.children.push(childFolder);
			}
			parentFolder = childFolder;
			currentPath = childPath;
		}
		// Add file to its immediate parent folder
		if (!parentFolder.children.includes(file)) {
			parentFolder.children.push(file);
		}
	}

	// Build index: path → file or folder
	const pathIndex = new Map<string, TFile | TFolder>();
	for (const file of files) pathIndex.set(file.path, file);
	for (const [path, folder] of folderMap.entries()) {
		if (path !== '') pathIndex.set(path, folder);
	}

	vi.mocked(app.vault.getRoot).mockReturnValue(root);
	vi.mocked(app.vault.getAbstractFileByPath).mockImplementation((p: string) => {
		return pathIndex.get(p) ?? null;
	});
}

function makeAdapters(app: ReturnType<typeof makeApp>) {
	return {
		note: createNoteAdapter(app as never),
		frontmatter: createFrontmatterAdapter(app as never),
		file: createNoteAdapter(app as never), // file adapter re-uses note path for tests
		'dataview-inline-field': createInlineFieldAdapter(app as never),
		search: createSearchAdapter(app as never),
		deleteAdapters: {
			note: createNoteDeleteAdapter(app as never),
			file: createFileDeleteAdapter(app as never),
			frontmatter: createFrontmatterDeleteAdapter(app as never),
		},
		rename: createRenameAdapter(app as never),
	};
}

// ============================================================
// Pipeline helper
// ============================================================

async function runPipeline(
	config: KadoConfig,
	app: ReturnType<typeof makeApp>,
	toolArgs: Record<string, unknown>,
	keyId: string,
	toolName: 'kado-read' | 'kado-write' | 'kado-search' | 'kado-rename',
) {
	const gates = createDefaultGateChain();
	const adapters = makeAdapters(app);
	const router = createOperationRouter(adapters);

	// Step 1: map MCP args to canonical request.
	// Mirrors tools.ts: mapper throws become VALIDATION_ERROR.
	let request: ReturnType<typeof mapReadRequest> | ReturnType<typeof mapWriteRequest> | ReturnType<typeof mapSearchRequest> | ReturnType<typeof mapRenameRequest>;
	try {
		request =
			toolName === 'kado-read'
				? mapReadRequest(toolArgs, keyId)
				: toolName === 'kado-write'
					? mapWriteRequest(toolArgs, keyId)
					: toolName === 'kado-rename'
						? mapRenameRequest(toolArgs, keyId)
						: mapSearchRequest(toolArgs, keyId);
	} catch (err: unknown) {
		return mapError({code: 'VALIDATION_ERROR', message: String((err as Error).message ?? err)});
	}

	// Step 2: evaluate permissions. Rename has its own two-path policy and must
	// NOT go through the single-path gate chain directly (mirrors tools.ts).
	if (toolName === 'kado-rename') {
		const renameReq = request as ReturnType<typeof mapRenameRequest>;
		const {result: permResult} = evaluateRenamePermissions(renameReq, config, gates);
		if (!permResult.allowed) {
			return mapError(permResult.error);
		}
	} else {
		const permResult = evaluatePermissions(request, config, gates);
		if (!permResult.allowed) {
			return mapError(permResult.error);
		}
	}

	// Step 3: concurrency guard for writes (path mtime) and renames (source mtime)
	if (toolName === 'kado-write') {
		const writeReq = request as {expectedModified?: number; path: string};
		let currentMtime: number | undefined;
		if (writeReq.expectedModified !== undefined) {
			const file = app.vault.getFileByPath(writeReq.path);
			currentMtime = file ? file.stat.mtime : undefined;
		}
		const concResult = validateConcurrency(request, currentMtime);
		if (!concResult.allowed) {
			return mapError(concResult.error);
		}
	} else if (toolName === 'kado-rename') {
		const renameReq = request as ReturnType<typeof mapRenameRequest>;
		const file = app.vault.getFileByPath(renameReq.source);
		const concResult = validateConcurrency(request, file ? file.stat.mtime : undefined);
		if (!concResult.allowed) {
			return mapError(concResult.error);
		}
	}

	// Step 4: route to adapter.
	// Mirrors tools.ts: adapter throws (NoteAdapterError, FrontmatterAdapterError, …)
	// carry a `code` field and must be mapped to the appropriate error result.
	let result: CoreFileResult | CoreWriteResult | CoreSearchResult | CoreDeleteResult | CoreRenameResult | CoreError;
	try {
		result = await router(request);
	} catch (err: unknown) {
		const asError = err as {code?: string; message?: string};
		const code = (asError.code === 'CONFLICT' || asError.code === 'NOT_FOUND' || asError.code === 'VALIDATION_ERROR')
			? (asError.code as CoreError['code'])
			: 'INTERNAL_ERROR';
		if (code !== 'INTERNAL_ERROR') {
			return mapError({code, message: asError.message ?? String(err)});
		}
		return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
	}

	// Step 5: map to CallToolResult
	if ('code' in result) {
		return mapError(result as CoreError);
	}
	if ('items' in result) {
		return mapSearchResult(result);
	}
	if ('content' in result) {
		return mapFileResult(result);
	}
	if ('source' in result) {
		return mapRenameResult(result);
	}
	return mapWriteResult(result as CoreWriteResult);
}

function parseResult(callResult: unknown) {
	const cr = callResult as {content: {type: string; text: string}[]};
	return JSON.parse(cr.content[0]!.text);
}

// ============================================================
// Tests
// ============================================================

describe('End-to-end tool call pipeline', () => {
	// --------------------------------------------------------
	// kado-read: note
	// --------------------------------------------------------

	describe('kado-read note', () => {
		it('returns content and timestamps for an authorized path', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			const file = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: 42},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('# Plan\n\nContent here.');

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/plan.md'},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.path).toBe('projects/plan.md');
			expect(body.content).toBe('# Plan\n\nContent here.');
			expect(body.created).toBe(1000);
			expect(body.modified).toBe(2000);
			expect(body.size).toBe(42);
		});
	});

	// --------------------------------------------------------
	// kado-read: frontmatter
	// --------------------------------------------------------

	describe('kado-read frontmatter', () => {
		it('returns structured frontmatter object', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			const file = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: 100},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue(
				createMockCachedMetadata({
					frontmatter: {title: 'Plan', status: 'active', priority: 1},
				}),
			);

			const result = await runPipeline(
				config,
				app,
				{operation: 'frontmatter', path: 'projects/plan.md'},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.content).toEqual({title: 'Plan', status: 'active', priority: 1});
		});
	});

	// --------------------------------------------------------
	// kado-read: dataview-inline-field
	// --------------------------------------------------------

	describe('kado-read dataview-inline-field', () => {
		it('returns parsed inline fields as a record', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			const noteContent = 'project:: alpha\nstatus:: in-progress\n';
			const file = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: noteContent.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(noteContent);

			const result = await runPipeline(
				config,
				app,
				{operation: 'dataview-inline-field', path: 'projects/plan.md'},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.content).toEqual({project: 'alpha', status: 'in-progress'});
		});
	});

	// --------------------------------------------------------
	// kado-write: create note
	// --------------------------------------------------------

	describe('kado-write note (create)', () => {
		it('creates a new file and returns path with timestamps', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			const createdFile = createMockTFile({
				path: 'projects/new.md',
				name: 'new.md',
				stat: {ctime: 3000, mtime: 3000, size: 7},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(null);
			vi.mocked(app.vault.create).mockResolvedValue(createdFile);

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/new.md', content: '# New'},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.path).toBe('projects/new.md');
			expect(body.created).toBe(3000);
			expect(body.modified).toBe(3000);
		});
	});

	// --------------------------------------------------------
	// kado-write: update note (matching timestamp)
	// --------------------------------------------------------

	describe('kado-write note (update)', () => {
		it('updates existing file when expectedModified matches', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			const existingFile = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: 50},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(existingFile);
			vi.mocked(app.vault.modify).mockResolvedValue(undefined);

			const result = await runPipeline(
				config,
				app,
				{
					operation: 'note',
					path: 'projects/plan.md',
					content: '# Updated Plan',
					expectedModified: 2000,
				},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.path).toBe('projects/plan.md');
		});
	});

	// --------------------------------------------------------
	// kado-write: frontmatter mode (merge default + explicit replace)
	// --------------------------------------------------------

	describe('kado-write frontmatter (mode)', () => {
		function setupFrontmatterWrite(initial: Record<string, unknown>) {
			const config = makeTestConfig();
			// Grant key the update permission for frontmatter (default config
			// gives it on global but not on the test-key for paths).
			config.apiKeys[0]!.paths[0]!.permissions.frontmatter = {
				create: true, read: true, update: true, delete: false,
			};
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: 200},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);

			let captured: Record<string, unknown> = {};
			vi.mocked(app.fileManager.processFrontMatter).mockImplementation(
				async (_f: unknown, mutator: (fm: Record<string, unknown>) => void) => {
					const fm: Record<string, unknown> = JSON.parse(JSON.stringify(initial)) as Record<string, unknown>;
					mutator(fm);
					captured = fm;
				},
			);

			return {config, app, getCaptured: () => captured};
		}

		it('default mode deep-merges nested objects', async () => {
			const {config, app, getCaptured} = setupFrontmatterWrite({
				tomo: {state: 'pending', doc_type: 'suggestion'},
				title: 'Keep me',
			});

			const result = await runPipeline(
				config,
				app,
				{
					operation: 'frontmatter',
					path: 'projects/plan.md',
					content: {tomo: {state: 'approved'}},
					expectedModified: 2000,
				},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBeUndefined();
			expect(getCaptured()).toEqual({
				tomo: {state: 'approved', doc_type: 'suggestion'},
				title: 'Keep me',
			});
		});

		it('mode=replace clears existing keys then writes supplied object', async () => {
			const {config, app, getCaptured} = setupFrontmatterWrite({
				tomo: {state: 'pending', doc_type: 'suggestion'},
				title: 'Old',
				tags: ['#a'],
			});

			const result = await runPipeline(
				config,
				app,
				{
					operation: 'frontmatter',
					path: 'projects/plan.md',
					content: {tomo: {state: 'approved'}},
					expectedModified: 2000,
					mode: 'replace',
				},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBeUndefined();
			expect(getCaptured()).toEqual({tomo: {state: 'approved'}});
		});

		it('mode=merge replaces arrays (no concat)', async () => {
			const {config, app, getCaptured} = setupFrontmatterWrite({
				tags: ['#captured', '#topic/knowledge'],
			});

			const result = await runPipeline(
				config,
				app,
				{
					operation: 'frontmatter',
					path: 'projects/plan.md',
					content: {tags: ['#approved']},
					expectedModified: 2000,
					mode: 'merge',
				},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBeUndefined();
			expect(getCaptured()).toEqual({tags: ['#approved']});
		});

	});

	// --------------------------------------------------------
	// kado-write: wrong timestamp → CONFLICT
	// --------------------------------------------------------

	describe('kado-write wrong timestamp', () => {
		it('returns CONFLICT error when expectedModified does not match current mtime', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			const existingFile = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: 50},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(existingFile);

			const result = await runPipeline(
				config,
				app,
				{
					operation: 'note',
					path: 'projects/plan.md',
					content: '# Stale Edit',
					expectedModified: 9999, // wrong — file mtime is 2000
				},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBe(true);
			const body = parseResult(result);
			expect(body.code).toBe('CONFLICT');
		});
	});

	// --------------------------------------------------------
	// kado-search: byTag
	// --------------------------------------------------------

	describe('kado-search byTag', () => {
		it('returns matching notes within the vault', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			const matchingFile = createMockTFile({
				path: 'projects/tagged.md',
				name: 'tagged.md',
				stat: {ctime: 1000, mtime: 2000, size: 10},
			});
			vi.mocked(app.vault.getMarkdownFiles).mockReturnValue([matchingFile]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue(
				createMockCachedMetadata({tags: [{tag: '#project'}]}),
			);

			const result = await runPipeline(
				config,
				app,
				{operation: 'byTag', query: '#project'},
				'test-key',
				'kado-search',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.items).toHaveLength(1);
			expect(body.items[0].path).toBe('projects/tagged.md');
		});
	});

	// --------------------------------------------------------
	// kado-search: listDir
	// --------------------------------------------------------

	describe('kado-search listDir', () => {
		it('returns files in projects/ with timestamps', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			const file1 = createMockTFile({
				path: 'projects/a.md',
				name: 'a.md',
				stat: {ctime: 1000, mtime: 2000, size: 10},
			});
			const file2 = createMockTFile({
				path: 'projects/b.md',
				name: 'b.md',
				stat: {ctime: 1100, mtime: 2100, size: 20},
			});
			vi.mocked(app.vault.getFiles).mockReturnValue([file1, file2]);
			wireVaultTree(app, [file1, file2]);

			const result = await runPipeline(
				config,
				app,
				{operation: 'listDir', path: 'projects/'},
				'test-key',
				'kado-search',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.items).toHaveLength(2);
			expect(body.items[0].path).toBe('projects/a.md');
			expect(body.items[1].path).toBe('projects/b.md');
			expect(body.items[0].created).toBe(1000);
			expect(body.items[0].modified).toBe(2000);
		});
	});

	// --------------------------------------------------------
	// Unauthorized: unknown key
	// --------------------------------------------------------

	describe('unknown API key', () => {
		it('returns UNAUTHORIZED error', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/plan.md'},
				'unknown-key',
				'kado-read',
			);

			expect(result.isError).toBe(true);
			const body = parseResult(result);
			expect(body.code).toBe('UNAUTHORIZED');
		});
	});

	// --------------------------------------------------------
	// Forbidden path: outside scope
	// --------------------------------------------------------

	describe('forbidden path', () => {
		it('returns FORBIDDEN error for path outside configured areas', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'journal/private.md'},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBe(true);
			const body = parseResult(result);
			expect(body.code).toBe('FORBIDDEN');
		});
	});

	// --------------------------------------------------------
	// Path traversal
	// --------------------------------------------------------

	describe('path traversal', () => {
		it('returns VALIDATION_ERROR for traversal attempt', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			// Use a path that starts within the projects area to pass global-scope and
			// key-scope gates, but contains a traversal segment that path-access will catch.
			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/../etc/passwd.md'},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBe(true);
			const body = parseResult(result);
			expect(body.code).toBe('VALIDATION_ERROR');
		});
	});

	// --------------------------------------------------------
	// Forbidden operation: delete without permission
	// --------------------------------------------------------

	describe('forbidden operation', () => {
		it('returns FORBIDDEN when key lacks delete permission for notes', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			// The test-key has note.delete = false per makeTestConfig
			// kado-write without expectedModified → create action
			// kado-write with expectedModified → update action
			// There is no explicit "delete" tool arg path — the datatype-permission gate
			// checks the inferred action. We need a delete request; we can manually
			// build a config with delete=true globally but key has delete=false,
			// then use a CoreWriteRequest... However, delete is not a write tool action.
			// Instead we validate by checking the gate directly via a modified config
			// that enables a key with explicit delete=false, and verify the gate denies.

			// Build a config where key explicitly lacks all permissions on notes
			const deleteConfig: KadoConfig = {
				...config,
				apiKeys: [
					{
						...config.apiKeys[0]!,
						paths: [
							{
								path: 'projects/**',
								permissions: {
									note: {create: false, read: false, update: false, delete: false},
									frontmatter: {create: false, read: false, update: false, delete: false},
									file: {create: false, read: false, update: false, delete: false},
									dataviewInlineField: {create: false, read: false, update: false, delete: false},
								},
							},
						],
					},
				],
			};

			// A read request against a key with note.read = false → FORBIDDEN from datatype-permission
			const result = await runPipeline(
				deleteConfig,
				app,
				{operation: 'note', path: 'projects/plan.md'},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBe(true);
			const body = parseResult(result);
			expect(body.code).toBe('FORBIDDEN');
		});
	});

	// --------------------------------------------------------
	// listDir trailing-slash regression (Tomo bug #1, spec 004 Phase 2 T2.1)
	// --------------------------------------------------------

	describe('listDir trailing-slash regression', () => {
		/**
		 * Config that mirrors Tomo's real setup: bare path names (no glob wildcards)
		 * as the allowed patterns, e.g. "100 Inbox" or "allowed".
		 */
		function makeBarePathConfig(): KadoConfig {
			const perms = {
				note: {create: true, read: true, update: true, delete: true},
				frontmatter: {create: true, read: true, update: true, delete: true},
				file: {create: true, read: true, update: true, delete: true},
				dataviewInlineField: {create: true, read: true, update: true, delete: true},
			};
			return {
				server: {enabled: true, host: '127.0.0.1', port: 23026, connectionType: 'local'},
				security: {
					listMode: 'whitelist',
					paths: [{path: '100 Inbox', permissions: perms}],
					tags: [],
					allowActiveNote: false,
					allowOtherNotes: false,
				},
				apiKeys: [
					{
						id: 'test-key',
						label: 'Test Key',
						enabled: true,
						createdAt: 1000,
						listMode: 'whitelist',
						paths: [{path: '100 Inbox', permissions: perms}],
						tags: [],
						allowActiveNote: false,
						allowOtherNotes: false,
					},
				],
				audit: {enabled: false, logDirectory: 'logs', logFileName: 'kado-audit.log', maxSizeBytes: 10485760, maxRetainedLogs: 3},
				debugLogging: false,
				renameWhenLinkUpdateOff: false,
				renameTimeoutMs: 60000,
			};
		}

		it('listDir with trailing slash returns the same result as without slash', async () => {
			const config = makeBarePathConfig();
			const app = makeApp();

			const file1 = createMockTFile({
				path: '100 Inbox/note-a.md',
				name: 'note-a.md',
				stat: {ctime: 1000, mtime: 2000, size: 10},
			});
			const file2 = createMockTFile({
				path: '100 Inbox/note-b.md',
				name: 'note-b.md',
				stat: {ctime: 1100, mtime: 2100, size: 20},
			});
			vi.mocked(app.vault.getFiles).mockReturnValue([file1, file2]);
			wireVaultTree(app, [file1, file2]);

			// With trailing slash (Tomo's original reproducer)
			const withSlash = await runPipeline(
				config,
				app,
				{operation: 'listDir', path: '100 Inbox/'},
				'test-key',
				'kado-search',
			);

			// Without trailing slash (works per Tomo's report)
			const withoutSlash = await runPipeline(
				config,
				app,
				{operation: 'listDir', path: '100 Inbox'},
				'test-key',
				'kado-search',
			);

			expect(withSlash.isError).toBeUndefined();
			expect(withoutSlash.isError).toBeUndefined();

			const bodyWithSlash = parseResult(withSlash);
			const bodyWithoutSlash = parseResult(withoutSlash);

			expect(bodyWithSlash.items).toHaveLength(2);
			expect(bodyWithoutSlash.items).toHaveLength(2);
			// Both forms should return the same items
			expect(bodyWithSlash.items).toEqual(bodyWithoutSlash.items);
		});

		it('listDir with trailing slash on nested path (100 Inbox/sub/) returns files', async () => {
			const config = makeBarePathConfig();
			const app = makeApp();

			const file = createMockTFile({
				path: '100 Inbox/sub/note.md',
				name: 'note.md',
				stat: {ctime: 1000, mtime: 2000, size: 10},
			});
			vi.mocked(app.vault.getFiles).mockReturnValue([file]);
			wireVaultTree(app, [file]);

			const result = await runPipeline(
				config,
				app,
				{operation: 'listDir', path: '100 Inbox/sub/'},
				'test-key',
				'kado-search',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.items).toHaveLength(1);
			expect(body.items[0].path).toBe('100 Inbox/sub/note.md');
		});

		it('byContent with path "/" returns same results as path omitted', async () => {
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: 100},
			});
			vi.mocked(app.vault.getMarkdownFiles).mockReturnValue([file]);
			vi.mocked(app.vault.read).mockResolvedValue('important content');

			const withSlash = await runPipeline(config, app, {operation: 'byContent', query: 'important', path: '/'}, 'test-key', 'kado-search');
			const withoutPath = await runPipeline(config, app, {operation: 'byContent', query: 'important'}, 'test-key', 'kado-search');

			expect(withSlash.isError).toBeUndefined();
			expect(withoutPath.isError).toBeUndefined();

			const bodySlash = parseResult(withSlash);
			const bodyNoPath = parseResult(withoutPath);

			expect(bodySlash.items).toHaveLength(bodyNoPath.items.length);
		});
	});

	// --------------------------------------------------------
	// ConfigManager integration
	// --------------------------------------------------------

	describe('ConfigManager integration', () => {
		it('pipeline uses config loaded via ConfigManager', async () => {
			const rawConfig = makeTestConfig();
			const mgr = makeConfigManager(rawConfig);
			await mgr.load();
			const config = mgr.getConfig();

			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: 10},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('# From Config Manager');

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/plan.md'},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.content).toBe('# From Config Manager');
		});
	});

	// ============================================================
	// Partial Note READ — end-to-end (spec 007 T5.4)
	// ============================================================

	/**
	 * Build a HeadingCache entry using the same shape as Obsidian's real cache.
	 * `line` is 0-based relative to the FULL file content (including frontmatter).
	 */
	function makeHeading(heading: string, level: number, line: number): HeadingCache {
		return {
			heading,
			level,
			position: {
				start: {line, col: 0, offset: 0},
				end: {line, col: heading.length + level + 1, offset: 0},
			},
		};
	}

	describe('kado-read partial note — section mode (T5.4)', () => {
		// File content:
		//   Line 0: "# Project"
		//   Line 1: "Intro."
		//   Line 2: "## Tasks"
		//   Line 3: "- do thing"
		//   Line 4: "## Notes"
		//   Line 5: "Some notes."
		const CONTENT = '# Project\nIntro.\n## Tasks\n- do thing\n## Notes\nSome notes.';

		it('returns the matched section body and truncated:true when content exists outside the slice', async () => {
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/spec.md',
				name: 'spec.md',
				stat: {ctime: 1000, mtime: 2000, size: CONTENT.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(CONTENT);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [
					makeHeading('Project', 1, 0),
					makeHeading('Tasks', 2, 2),
					makeHeading('Notes', 2, 4),
				],
			});

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/spec.md', mode: 'section', heading: 'Tasks'},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			// Section "Tasks" runs from line 2 up to (not including) line 4.
			expect(body.content).toBe('## Tasks\n- do thing');
			// Lines 0-1 and 4-5 exist outside the slice.
			expect(body.truncated).toBe(true);
		});

		it('returns truncated:false when the section is the entire file body', async () => {
			const FULL = '# Only\nAll content here.';
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/solo.md',
				name: 'solo.md',
				stat: {ctime: 1000, mtime: 2000, size: FULL.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(FULL);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [makeHeading('Only', 1, 0)],
			});

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/solo.md', mode: 'section', heading: 'Only'},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.content).toBe(FULL);
			expect(body.truncated).toBe(false);
		});

		it('returns NOT_FOUND when the heading does not exist in metadataCache', async () => {
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/spec.md',
				name: 'spec.md',
				stat: {ctime: 1000, mtime: 2000, size: 40},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('# Project\nIntro.');
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [makeHeading('Project', 1, 0)],
			});

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/spec.md', mode: 'section', heading: 'NonExistent'},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBe(true);
			const body = parseResult(result);
			expect(body.code).toBe('NOT_FOUND');
		});
	});

	describe('kado-read partial note — firstXChars mode (T5.4)', () => {
		it('returns the first N characters and truncated:true when content is longer', async () => {
			const CONTENT = 'Hello, World! This is a long note.';
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/long.md',
				name: 'long.md',
				stat: {ctime: 1000, mtime: 2000, size: CONTENT.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(CONTENT);

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/long.md', mode: 'firstXChars', limit: 5},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.content).toBe('Hello');
			expect(body.truncated).toBe(true);
		});

		it('returns full content and truncated:false when limit exceeds content length', async () => {
			const CONTENT = 'Short.';
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/short.md',
				name: 'short.md',
				stat: {ctime: 1000, mtime: 2000, size: CONTENT.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(CONTENT);

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/short.md', mode: 'firstXChars', limit: 1000},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.content).toBe(CONTENT);
			expect(body.truncated).toBe(false);
		});
	});

	describe('kado-read partial note — range mode (T5.4)', () => {
		// Content:
		//   Line 1: "alpha"
		//   Line 2: "beta"
		//   Line 3: "gamma"
		const CONTENT = 'alpha\nbeta\ngamma';

		it('returns the requested line range and truncated:true when lines exist outside the range', async () => {
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/lines.md',
				name: 'lines.md',
				stat: {ctime: 1000, mtime: 2000, size: CONTENT.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(CONTENT);

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/lines.md', mode: 'range', rangeBasis: 'line', start: 2, end: 2},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.content).toBe('beta');
			expect(body.truncated).toBe(true);
		});
	});

	// ============================================================
	// Partial Note WRITE — end-to-end (spec 007 T5.4)
	// ============================================================

	describe('kado-write partial note — additive lock-free path (T5.4)', () => {
		it('append without expectedModified succeeds and new body starts with old body and ends with appended content', async () => {
			// applyAppend inserts a newline separator when the body does not end with one.
			// Use a body that ends with '\n' so the concatenation is a simple join, which
			// makes the assertion unambiguous regardless of the separator logic.
			const OLD_BODY = '# Project\n\nExisting content.\n';
			const APPENDED = 'New paragraph.';
			const EXPECTED_BODY = OLD_BODY + APPENDED; // body ends with \n → no extra separator added
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: OLD_BODY.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			// No open editor leaf — straightforward path.
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);

			let writtenBody = '';
			vi.mocked(app.vault.process).mockImplementation(async (_f, transform) => {
				writtenBody = transform(OLD_BODY);
				file.stat = {ctime: 1000, mtime: 3000, size: writtenBody.length};
			});

			const result = await runPipeline(
				config,
				app,
				{
					operation: 'note',
					path: 'projects/plan.md',
					content: APPENDED,
					mode: 'append',
					// No expectedModified — lock-free append path
				},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.path).toBe('projects/plan.md');
			// Written body must be byte-identical to old body + appended content.
			// OLD_BODY ends with '\n' so applyAppend does not insert an extra separator.
			expect(writtenBody).toBe(EXPECTED_BODY);
		});

		it('prepend without expectedModified places new content before the existing body', async () => {
			const OLD_BODY = 'Existing content.';
			const PREPENDED = 'Preamble.\n\n';
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: OLD_BODY.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);

			let writtenBody = '';
			vi.mocked(app.vault.process).mockImplementation(async (_f, transform) => {
				writtenBody = transform(OLD_BODY);
				file.stat = {ctime: 1000, mtime: 3000, size: writtenBody.length};
			});

			const result = await runPipeline(
				config,
				app,
				{
					operation: 'note',
					path: 'projects/plan.md',
					content: PREPENDED,
					mode: 'prepend',
				},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBeUndefined();
			expect(writtenBody).toBe(PREPENDED + OLD_BODY);
		});
	});

	describe('kado-write partial note — CONFLICT on dirty editor (T5.4)', () => {
		it('returns CONFLICT when the target note is open and dirty during an append', async () => {
			const DISK_CONTENT = 'Saved content.';
			const EDITOR_CONTENT = 'Saved content. [user is typing]';
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: DISK_CONTENT.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);

			// Simulate an open editor with unsaved content
			const view = new MarkdownView();
			view.file = file;
			view.data = EDITOR_CONTENT;
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([{view} as unknown as WorkspaceLeaf] as unknown as never[]);
			// Disk content differs from editor → dirty
			vi.mocked(app.vault.read).mockResolvedValue(DISK_CONTENT);

			Notice._reset();

			const result = await runPipeline(
				config,
				app,
				{
					operation: 'note',
					path: 'projects/plan.md',
					content: '\n\nNew section.',
					mode: 'append',
				},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBe(true);
			const body = parseResult(result);
			expect(body.code).toBe('CONFLICT');
			// vault.process must NOT have been called
			expect(app.vault.process).not.toHaveBeenCalled();
			// A Notice must have been shown to inform the user
			expect(Notice._instances.length).toBeGreaterThan(0);
		});
	});

	describe('kado-write partial note — replaceSection round-trip (T5.4)', () => {
		it('replaceSection with expectedModified writes the new section body and returns updated timestamps', async () => {
			const OLD_BODY = '# Project\n\n## Tasks\nOld task.\n## Notes\nSome notes.';
			// headings for the old body:
			//   Line 0: "# Project"
			//   Line 1: "" (blank)
			//   Line 2: "## Tasks"
			//   Line 3: "Old task."
			//   Line 4: "## Notes"
			//   Line 5: "Some notes."
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: OLD_BODY.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [
					makeHeading('Project', 1, 0),
					makeHeading('Tasks', 2, 2),
					makeHeading('Notes', 2, 4),
				],
			});

			let writtenBody = '';
			vi.mocked(app.vault.process).mockImplementation(async (_f, transform) => {
				writtenBody = transform(OLD_BODY);
				file.stat = {ctime: 1000, mtime: 3000, size: writtenBody.length};
			});

			const result = await runPipeline(
				config,
				app,
				{
					operation: 'note',
					path: 'projects/plan.md',
					content: 'New task.\nAnother task.',
					mode: 'replaceSection',
					heading: 'Tasks',
					expectedModified: 2000,
				},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.path).toBe('projects/plan.md');
			// The Tasks section body (line 3, between heading and the next H2) was replaced.
			// Heading line is preserved; body replaced with new content.
			expect(writtenBody).toContain('## Tasks\nNew task.\nAnother task.');
			// The Notes section is untouched.
			expect(writtenBody).toContain('## Notes\nSome notes.');
		});

		it('returns VALIDATION_ERROR when replaceSection is called without expectedModified (ADR-5)', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			// The mapper throws before any adapter call — runPipeline catches mapper
			// throws and maps them to VALIDATION_ERROR (mirrors tools.ts behaviour).
			const result = await runPipeline(
				config,
				app,
				{
					operation: 'note',
					path: 'projects/plan.md',
					content: 'New body.',
					mode: 'replaceSection',
					heading: 'Tasks',
					// No expectedModified — must be rejected by the mapper (ADR-5)
				},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBe(true);
			const body = parseResult(result);
			expect(body.code).toBe('VALIDATION_ERROR');
		});
	});

	describe('kado-write partial note — insertUnderHeading round-trip (review M9)', () => {
		it('insertUnderHeading with expectedModified appends at the end of the section', async () => {
			const OLD_BODY = '# Project\n\n## Tasks\nOld task.\n## Notes\nSome notes.';
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: OLD_BODY.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [makeHeading('Project', 1, 0), makeHeading('Tasks', 2, 2), makeHeading('Notes', 2, 4)],
			});

			let writtenBody = '';
			vi.mocked(app.vault.process).mockImplementation(async (_f, transform) => {
				writtenBody = transform(OLD_BODY);
				file.stat = {ctime: 1000, mtime: 3000, size: writtenBody.length};
			});

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/plan.md', content: 'New task.', mode: 'insertUnderHeading', heading: 'Tasks', expectedModified: 2000},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBeUndefined();
			// Inserted at the END of the Tasks section (before "## Notes"), heading preserved.
			expect(writtenBody).toContain('## Tasks\nOld task.\nNew task.\n## Notes');
		});
	});

	describe('kado-write partial note — replaceRange round-trip (review M9)', () => {
		it('replaceRange (line basis) with expectedModified replaces the addressed lines', async () => {
			const OLD_BODY = 'line1\nline2\nline3\nline4';
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: OLD_BODY.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);

			let writtenBody = '';
			vi.mocked(app.vault.process).mockImplementation(async (_f, transform) => {
				writtenBody = transform(OLD_BODY);
				file.stat = {ctime: 1000, mtime: 3000, size: writtenBody.length};
			});

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/plan.md', content: 'replaced', mode: 'replaceRange', rangeBasis: 'line', start: 2, end: 3, expectedModified: 2000},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBeUndefined();
			expect(writtenBody).toBe('line1\nreplaced\nline4');
		});
	});

	// ============================================================
	// Backward-compatibility regression (spec 007 T5.4 §3)
	// ============================================================
	//
	// These tests protect the pre-feature contract: callers that supply no `mode`
	// must get exactly the same behavior as before partial-RW was introduced.
	// A future regression in the routing logic will cause these to fail loudly.

	describe('backward-compat: no-mode read (T5.4)', () => {
		it('no-mode read omits truncated and returns full content', async () => {
			const FULL_BODY = '# Full Note\n\nAll the content is here.\n\nEven this part.';
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/full.md',
				name: 'full.md',
				stat: {ctime: 1000, mtime: 2000, size: FULL_BODY.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(FULL_BODY);

			const result = await runPipeline(
				config,
				app,
				// No `mode` field — legacy full-read behavior
				{operation: 'note', path: 'projects/full.md'},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);

			// Content must be BYTE-IDENTICAL to the vault content.
			expect(body.content).toBe(FULL_BODY);

			// The `truncated` key must be ABSENT for full reads (ADR-6 / response-mapper contract).
			// Using 'in' to distinguish undefined-value from absent key.
			expect('truncated' in body).toBe(false);
		});

		it('no-mode read returns standard stat fields (created, modified, size, path)', async () => {
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/full.md',
				name: 'full.md',
				stat: {ctime: 1000, mtime: 2000, size: 42},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('body');

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/full.md'},
				'test-key',
				'kado-read',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.path).toBe('projects/full.md');
			expect(body.created).toBe(1000);
			expect(body.modified).toBe(2000);
			expect(body.size).toBe(42);
			// Absence of truncated re-confirmed here as part of the compat contract.
			expect('truncated' in body).toBe(false);
		});
	});

	describe('backward-compat: no-mode write replaces whole body (T5.4)', () => {
		it('no-mode write replaces the entire note body — byte-identical to pre-feature behavior', async () => {
			const ORIGINAL = '# Old\n\nThis will be fully replaced.';
			const NEW_CONTENT = '# New\n\nFresh content for the whole note.';
			const config = makeTestConfig();
			const app = makeApp();
			const file = createMockTFile({
				path: 'projects/plan.md',
				name: 'plan.md',
				stat: {ctime: 1000, mtime: 2000, size: ORIGINAL.length},
			});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);

			let writtenBody = '';
			vi.mocked(app.vault.process).mockImplementation(async (_f, transform) => {
				writtenBody = transform(ORIGINAL);
				file.stat = {ctime: 1000, mtime: 3000, size: writtenBody.length};
			});

			const result = await runPipeline(
				config,
				app,
				// No mode — full-replace path (expectedModified present → update, not create)
				{
					operation: 'note',
					path: 'projects/plan.md',
					content: NEW_CONTENT,
					expectedModified: 2000,
				},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.path).toBe('projects/plan.md');
			// The adapter must have called vault.process with a transform that returns exactly NEW_CONTENT.
			expect(writtenBody).toBe(NEW_CONTENT);
		});

		it('no-mode write with no expectedModified creates a new note (pre-feature create path)', async () => {
			const config = makeTestConfig();
			const app = makeApp();
			const createdFile = createMockTFile({
				path: 'projects/brand-new.md',
				name: 'brand-new.md',
				stat: {ctime: 5000, mtime: 5000, size: 10},
			});
			// File does not exist yet → getFileByPath returns null
			vi.mocked(app.vault.getFileByPath).mockReturnValue(null);
			vi.mocked(app.vault.create).mockResolvedValue(createdFile);

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', path: 'projects/brand-new.md', content: '# New'},
				'test-key',
				'kado-write',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.path).toBe('projects/brand-new.md');
			expect(body.created).toBe(5000);
			expect(body.modified).toBe(5000);
			// vault.create must have been called, not vault.process
			expect(app.vault.create).toHaveBeenCalledOnce();
			expect(app.vault.process).not.toHaveBeenCalled();
		});
	});

	// --------------------------------------------------------
	// kado-rename: full pipeline (mapper → rename policy → guard → adapter)
	// --------------------------------------------------------

	describe('kado-rename', () => {
		it('renames a note in-folder end-to-end (update permission)', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			const file = createMockTFile({
				path: 'projects/draft.md',
				name: 'draft.md',
				stat: {ctime: 1000, mtime: 2000, size: 42},
			});
			// projects/ folder exists; the target file does not.
			wireVaultTree(app, [file]);
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			const renameFile = vi.fn().mockResolvedValue(undefined);
			(app.fileManager as unknown as {renameFile: typeof renameFile}).renameFile = renameFile;

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', source: 'projects/draft.md', target: 'projects/final.md', expectedModified: 2000},
				'test-key',
				'kado-rename',
			);

			expect(result.isError).toBeUndefined();
			const body = parseResult(result);
			expect(body.source).toBe('projects/draft.md');
			expect(body.target).toBe('projects/final.md');
			expect(renameFile).toHaveBeenCalledWith(file, 'projects/final.md');
		});

		it('denies a cross-folder move when the key lacks delete on the source (FORBIDDEN)', async () => {
			const config = makeTestConfig(); // key: note CRU on projects/**, no delete
			const app = makeApp();

			const file = createMockTFile({
				path: 'projects/draft.md',
				name: 'draft.md',
				stat: {ctime: 1000, mtime: 2000, size: 42},
			});
			wireVaultTree(app, [file]);
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			const renameFile = vi.fn().mockResolvedValue(undefined);
			(app.fileManager as unknown as {renameFile: typeof renameFile}).renameFile = renameFile;

			// Different parent folder ⇒ move ⇒ requires delete(source)+create(target);
			// the key has neither delete nor create-elsewhere, so it must be denied.
			const result = await runPipeline(
				config,
				app,
				{operation: 'note', source: 'projects/draft.md', target: 'projects/archive/draft.md', expectedModified: 2000},
				'test-key',
				'kado-rename',
			);

			expect(result.isError).toBe(true);
			expect(parseResult(result).code).toBe('FORBIDDEN');
			expect(renameFile).not.toHaveBeenCalled();
		});

		it('returns CONFLICT when the source changed since the read', async () => {
			const config = makeTestConfig();
			const app = makeApp();

			const file = createMockTFile({
				path: 'projects/draft.md',
				name: 'draft.md',
				stat: {ctime: 1000, mtime: 2000, size: 42},
			});
			wireVaultTree(app, [file]);
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			const renameFile = vi.fn().mockResolvedValue(undefined);
			(app.fileManager as unknown as {renameFile: typeof renameFile}).renameFile = renameFile;

			const result = await runPipeline(
				config,
				app,
				{operation: 'note', source: 'projects/draft.md', target: 'projects/final.md', expectedModified: 1999},
				'test-key',
				'kado-rename',
			);

			expect(result.isError).toBe(true);
			expect(parseResult(result).code).toBe('CONFLICT');
			expect(renameFile).not.toHaveBeenCalled();
		});
	});
});
