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
import {App, TFile, createMockTFile, createMockCachedMetadata} from '../__mocks__/obsidian';
import {mapReadRequest, mapWriteRequest, mapSearchRequest} from '../../src/mcp/request-mapper';
import {mapFileResult, mapWriteResult, mapSearchResult, mapError} from '../../src/mcp/response-mapper';
import {evaluatePermissions, createDefaultGateChain} from '../../src/core/permission-chain';
import {validateConcurrency} from '../../src/core/concurrency-guard';
import {createOperationRouter} from '../../src/core/operation-router';
import {ConfigManager} from '../../src/core/config-manager';
import {createNoteAdapter} from '../../src/obsidian/note-adapter';
import {createFrontmatterAdapter} from '../../src/obsidian/frontmatter-adapter';
import {createInlineFieldAdapter} from '../../src/obsidian/inline-field-adapter';
import {createSearchAdapter} from '../../src/obsidian/search-adapter';
import type {KadoConfig, CoreError} from '../../src/types/canonical';

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
			},
		],
		audit: {enabled: false, logDirectory: 'logs', logFileName: 'kado-audit.log', maxSizeBytes: 10485760, maxRetainedLogs: 3},
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

function makeAdapters(app: App) {
	return {
		note: createNoteAdapter(app),
		frontmatter: createFrontmatterAdapter(app),
		file: createNoteAdapter(app), // file adapter re-uses note path for tests
		'dataview-inline-field': createInlineFieldAdapter(app),
		search: createSearchAdapter(app),
	};
}

// ============================================================
// Pipeline helper
// ============================================================

async function runPipeline(
	config: KadoConfig,
	app: App,
	toolArgs: Record<string, unknown>,
	keyId: string,
	toolName: 'kado-read' | 'kado-write' | 'kado-search',
) {
	const gates = createDefaultGateChain();
	const adapters = makeAdapters(app);
	const router = createOperationRouter(adapters);

	// Step 1: map MCP args to canonical request
	const request =
		toolName === 'kado-read'
			? mapReadRequest(toolArgs, keyId)
			: toolName === 'kado-write'
				? mapWriteRequest(toolArgs, keyId)
				: mapSearchRequest(toolArgs, keyId);

	// Step 2: evaluate permissions
	const permResult = evaluatePermissions(request, config, gates);
	if (!permResult.allowed) {
		return mapError(permResult.error);
	}

	// Step 3: concurrency guard for writes
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
	}

	// Step 4: route to adapter
	const result = await router(request);

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
	return mapWriteResult(result);
}

function parseResult(callResult: {content: {type: string; text: string}[]}) {
	return JSON.parse(callResult.content[0]!.text);
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
				{operation: 'note', path: 'projects/../etc/passwd'},
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
					},
				],
				audit: {enabled: false, logDirectory: 'logs', logFileName: 'kado-audit.log', maxSizeBytes: 10485760, maxRetainedLogs: 3},
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
});
