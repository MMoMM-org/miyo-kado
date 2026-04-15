/**
 * Behavioral tests for NoteAdapter.
 *
 * Verifies that createNoteAdapter() returns a ReadWriteAdapter that correctly
 * delegates to Obsidian's vault API and maps results/errors to Core types.
 * All behaviors are exercised through the public read() and write() methods.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {App, TFile, MarkdownView, Notice} from '../__mocks__/obsidian';
import {createNoteAdapter} from '../../src/obsidian/note-adapter';
import type {CoreReadRequest, CoreWriteRequest} from '../../src/types/canonical';

function makeLeafWithView(file: TFile, editorContent: string): {view: MarkdownView} {
	const view = new MarkdownView();
	view.file = file;
	view.data = editorContent;
	return {view};
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeReadRequest(path = 'notes/test.md'): CoreReadRequest {
	return {apiKeyId: 'kado_test-key', operation: 'note', path};
}

function makeWriteRequest(overrides: Partial<CoreWriteRequest> = {}): CoreWriteRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'note',
		path: 'notes/test.md',
		content: '# Hello',
		...overrides,
	};
}

function makeTFile(overrides: Partial<{path: string; ctime: number; mtime: number; size: number}> = {}): TFile {
	const file = new TFile();
	file.path = overrides.path ?? 'notes/test.md';
	file.stat = {
		ctime: overrides.ctime ?? 1000,
		mtime: overrides.mtime ?? 2000,
		size: overrides.size ?? 100,
	};
	return file;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NoteAdapter', () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	describe('read()', () => {
		it('returns CoreFileResult with content and stat timestamps when file exists', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000, size: 42});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('# Hello World');

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(makeReadRequest());

			expect(result).toEqual({
				path: 'notes/test.md',
				content: '# Hello World',
				created: 1000,
				modified: 2000,
				size: 42,
			});
		});

		it('throws a NOT_FOUND CoreError when file does not exist', async () => {
			vi.mocked(app.vault.getFileByPath).mockReturnValue(null);

			const adapter = createNoteAdapter(app);

			await expect(adapter.read(makeReadRequest('notes/missing.md'))).rejects.toMatchObject({
				code: 'NOT_FOUND',
				message: expect.stringContaining('notes/missing.md'),
			});
		});
	});

	describe('write() — create (no expectedModified)', () => {
		it('calls vault.create and returns CoreWriteResult when file does not exist', async () => {
			const createdFile = makeTFile({ctime: 3000, mtime: 3000, size: 7});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(null);
			vi.mocked(app.vault.create).mockResolvedValue(createdFile);

			const adapter = createNoteAdapter(app);
			const result = await adapter.write(makeWriteRequest({content: '# Hello'}));

			expect(app.vault.create).toHaveBeenCalledWith('notes/test.md', '# Hello');
			expect(result).toEqual({
				path: 'notes/test.md',
				created: 3000,
				modified: 3000,
			});
		});

		it('returns CONFLICT CoreError when file already exists on create', async () => {
			const existingFile = makeTFile();
			vi.mocked(app.vault.getFileByPath).mockReturnValue(existingFile);

			const adapter = createNoteAdapter(app);

			await expect(adapter.write(makeWriteRequest())).rejects.toMatchObject({
				code: 'CONFLICT',
				message: expect.stringContaining('notes/test.md'),
			});
			expect(app.vault.create).not.toHaveBeenCalled();
		});
	});

	describe('write() — update (with expectedModified)', () => {
		it('writes via vault.process and returns updated CoreWriteResult', async () => {
			const file = makeTFile({ctime: 1000, mtime: 5000, size: 15});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.process).mockImplementation(async (_file, transform) => {
				// Simulate Obsidian updating file.stat after a successful process
				const next = transform('old content');
				file.stat = {ctime: 1000, mtime: 6000, size: next.length};
				return next;
			});

			const adapter = createNoteAdapter(app);
			const result = await adapter.write(
				makeWriteRequest({content: 'updated content', expectedModified: 2000}),
			);

			expect(app.vault.process).toHaveBeenCalledOnce();
			const [processedFile, transform] = vi.mocked(app.vault.process).mock.calls[0] as [unknown, (c: string) => string];
			expect(processedFile).toBe(file);
			expect(transform('anything')).toBe('updated content');
			expect(result).toEqual({
				path: 'notes/test.md',
				created: 1000,
				modified: 6000,
			});
		});

		it('returns NOT_FOUND CoreError when file does not exist on update', async () => {
			vi.mocked(app.vault.getFileByPath).mockReturnValue(null);

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makeWriteRequest({expectedModified: 2000})),
			).rejects.toMatchObject({
				code: 'NOT_FOUND',
				message: expect.stringContaining('notes/test.md'),
			});
			expect(app.vault.process).not.toHaveBeenCalled();
		});
	});

	describe('read() — operation "tags"', () => {
		function makeTagsRequest(
			path = 'notes/tagged.md',
			scope: 'all' | 'frontmatter-only' = 'all',
		): CoreReadRequest {
			return {apiKeyId: 'kado_test-key', operation: 'tags', path, tagsReturnScope: scope};
		}

		it('returns frontmatter+inline with returnedTags="All" when scope is "all"', async () => {
			const file = makeTFile({path: 'notes/tagged.md', ctime: 100, mtime: 200, size: 50});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(
				'---\ntags: [alpha, beta]\n---\nBody text with #beta and #gamma tags.',
			);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				frontmatter: {tags: ['alpha', 'beta']},
			});

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(makeTagsRequest());

			expect(result.path).toBe('notes/tagged.md');
			expect(result.content).toEqual({
				frontmatter: ['alpha', 'beta'],
				inline: ['beta', 'gamma'],
				all: ['alpha', 'beta', 'gamma'],
				returnedTags: 'All',
			});
			expect(result.modified).toBe(200);
		});

		it('preserves frontmatter-first order when dedup across frontmatter+inline overlaps', async () => {
			const file = makeTFile();
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('---\ntags: [b, a]\n---\nbody #a #c #b');
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({frontmatter: {tags: ['b', 'a']}});

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(makeTagsRequest());

			expect((result.content as Record<string, unknown>).all).toEqual(['b', 'a', 'c']);
		});

		it('defaults to scope="all" when tagsReturnScope is not set on the request', async () => {
			const file = makeTFile();
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('body #x');
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue(null);

			const adapter = createNoteAdapter(app);
			const request: CoreReadRequest = {apiKeyId: 'k', operation: 'tags', path: 'notes/tagged.md'};
			const result = await adapter.read(request);

			expect((result.content as Record<string, unknown>).returnedTags).toBe('All');
		});

		it('returns only frontmatter tags and returnedTags="FrontmatterOnly" when scope restricts', async () => {
			const file = makeTFile();
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				frontmatter: {tags: ['alpha', 'beta']},
			});

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(makeTagsRequest('notes/tagged.md', 'frontmatter-only'));

			expect(result.content).toEqual({
				frontmatter: ['alpha', 'beta'],
				inline: [],
				all: ['alpha', 'beta'],
				returnedTags: 'FrontmatterOnly',
			});
		});

		it('does not read the note body when scope is frontmatter-only', async () => {
			const file = makeTFile();
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({frontmatter: {tags: ['a']}});

			const adapter = createNoteAdapter(app);
			await adapter.read(makeTagsRequest('notes/tagged.md', 'frontmatter-only'));

			expect(app.vault.read).not.toHaveBeenCalled();
		});

		it('handles frontmatter tags given as a single space-separated string', async () => {
			const file = makeTFile();
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('---\ntags: "alpha beta"\n---\n');
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				frontmatter: {tags: 'alpha beta'},
			});

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(makeTagsRequest());

			expect(result.content).toEqual({
				frontmatter: ['alpha', 'beta'],
				inline: [],
				all: ['alpha', 'beta'],
				returnedTags: 'All',
			});
		});

		it('handles frontmatter tags given as a comma-separated string', async () => {
			const file = makeTFile();
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('---\ntags: "alpha, beta, #gamma"\n---\n');
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				frontmatter: {tags: 'alpha, beta, #gamma'},
			});

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(makeTagsRequest());

			expect(result.content).toEqual({
				frontmatter: ['alpha', 'beta', 'gamma'],
				inline: [],
				all: ['alpha', 'beta', 'gamma'],
				returnedTags: 'All',
			});
		});

		it('returns empty arrays when note has neither frontmatter nor inline tags', async () => {
			const file = makeTFile();
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('plain body with no tags');
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({});

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(makeTagsRequest());

			expect(result.content).toEqual({frontmatter: [], inline: [], all: [], returnedTags: 'All'});
		});

		it('extracts inline tags even when no frontmatter is present', async () => {
			const file = makeTFile();
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('Just body with #one and #two.');
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue(null);

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(makeTagsRequest());

			expect(result.content).toEqual({
				frontmatter: [],
				inline: ['one', 'two'],
				all: ['one', 'two'],
				returnedTags: 'All',
			});
		});

		it('throws NOT_FOUND when the file is missing', async () => {
			vi.mocked(app.vault.getFileByPath).mockReturnValue(null);
			const adapter = createNoteAdapter(app);
			await expect(adapter.read(makeTagsRequest('notes/missing.md'))).rejects.toMatchObject({
				code: 'NOT_FOUND',
				message: expect.stringContaining('notes/missing.md'),
			});
		});
	});

	describe('write() — operation "note" with string content', () => {
		it('handles string content correctly on create', async () => {
			const createdFile = makeTFile({ctime: 9000, mtime: 9000, size: 5});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(null);
			vi.mocked(app.vault.create).mockResolvedValue(createdFile);

			const adapter = createNoteAdapter(app);
			const result = await adapter.write({
				apiKeyId: 'kado_test-key',
				operation: 'note',
				path: 'notes/test.md',
				content: 'hello',
			});

			expect(app.vault.create).toHaveBeenCalledWith('notes/test.md', 'hello');
			expect(result.path).toBe('notes/test.md');
		});
	});

	describe('write() — coordination with open editor', () => {
		beforeEach(() => {
			Notice._reset();
		});

		it('returns CONFLICT and shows a Notice when the target file is open with unsaved changes', async () => {
			const file = makeTFile({path: 'notes/test.md', ctime: 1000, mtime: 2000});
			const {view} = makeLeafWithView(file, 'user typing in progress');
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([{view} as unknown as never]);
			vi.mocked(app.vault.read).mockResolvedValue('old disk content');

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makeWriteRequest({content: 'new MCP content', expectedModified: 2000})),
			).rejects.toMatchObject({
				code: 'CONFLICT',
				message: expect.stringContaining('open in the editor'),
			});
			expect(app.vault.process).not.toHaveBeenCalled();
			expect(view.save).not.toHaveBeenCalled();
			expect(Notice._instances).toHaveLength(1);
			expect(Notice._instances[0]!.message).toContain('Kado wanted to modify test');
		});

		it('proceeds with the write and shows no Notice when the target file is open but clean', async () => {
			const file = makeTFile({path: 'notes/test.md', ctime: 1000, mtime: 2000});
			const {view} = makeLeafWithView(file, 'identical content');
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([{view} as unknown as never]);
			vi.mocked(app.vault.read).mockResolvedValue('identical content');
			vi.mocked(app.vault.process).mockImplementation(async (_f, transform) => {
				transform('identical content');
				file.stat = {ctime: 1000, mtime: 3000, size: 3};
			});

			const adapter = createNoteAdapter(app);
			const result = await adapter.write(makeWriteRequest({content: 'new', expectedModified: 2000}));

			expect(app.vault.process).toHaveBeenCalledOnce();
			expect(view.save).not.toHaveBeenCalled();
			expect(Notice._instances).toHaveLength(0);
			expect(result.modified).toBe(3000);
		});

		it('does not inspect editor state when the target file is not open in any leaf', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.vault.process).mockImplementation(async () => {});

			const adapter = createNoteAdapter(app);
			await adapter.write(makeWriteRequest({content: 'new', expectedModified: 2000}));

			expect(app.vault.read).not.toHaveBeenCalled();
			expect(app.vault.process).toHaveBeenCalledOnce();
		});

		it('ignores open leaves whose file does not match the target path', async () => {
			const targetFile = makeTFile({path: 'notes/test.md', ctime: 1000, mtime: 2000});
			const otherFile = makeTFile({path: 'notes/other.md'});
			const {view} = makeLeafWithView(otherFile, 'unrelated dirty content');
			vi.mocked(app.vault.getFileByPath).mockReturnValue(targetFile);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([{view} as unknown as never]);
			vi.mocked(app.vault.process).mockImplementation(async () => {});

			const adapter = createNoteAdapter(app);
			await adapter.write(makeWriteRequest({content: 'new', expectedModified: 2000}));

			expect(view.save).not.toHaveBeenCalled();
			expect(app.vault.read).not.toHaveBeenCalled();
			expect(app.vault.process).toHaveBeenCalledOnce();
		});
	});
});
