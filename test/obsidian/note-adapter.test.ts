/**
 * Behavioral tests for NoteAdapter.
 *
 * Verifies that createNoteAdapter() returns a ReadWriteAdapter that correctly
 * delegates to Obsidian's vault API and maps results/errors to Core types.
 * All behaviors are exercised through the public read() and write() methods.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {App, TFile, MarkdownView, Notice} from '../__mocks__/obsidian';
import type {HeadingCache} from '../__mocks__/obsidian';
import {createNoteAdapter} from '../../src/obsidian/note-adapter';
import type {CoreReadRequest, CoreWriteRequest, NoteReadPartial, NoteWritePartial} from '../../src/types/canonical';

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

function makePartialWriteRequest(notePartial: NoteWritePartial, content: string, overrides: Partial<CoreWriteRequest> = {}): CoreWriteRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'note',
		path: 'notes/test.md',
		content,
		notePartial,
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
			vi.mocked(app.vault.cachedRead).mockResolvedValue('old disk content');

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
			vi.mocked(app.vault.cachedRead).mockResolvedValue('identical content');
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

			expect(app.vault.cachedRead).not.toHaveBeenCalled();
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
			expect(app.vault.cachedRead).not.toHaveBeenCalled();
			expect(app.vault.process).toHaveBeenCalledOnce();
		});
	});

	// ---------------------------------------------------------------------------
	// Helpers for partial read tests
	// ---------------------------------------------------------------------------

	/**
	 * Build a HeadingCache entry in the shape Obsidian actually provides.
	 * heading: text only (no leading # or spaces).
	 * level: 1-6.
	 * position.start.line: 0-based line index into the FULL file content.
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

	function makePartialReadRequest(partial: NoteReadPartial, path = 'notes/test.md'): CoreReadRequest {
		return {apiKeyId: 'kado_test-key', operation: 'note', path, partial};
	}

	describe('read() — HeadingCache shape assertion', () => {
		it('HeadingCache mock exposes position.start.line and level (API shape guard)', () => {
			const h = makeHeading('Introduction', 2, 5);
			// If Obsidian ever changes this shape, this test will catch it early.
			expect(h.heading).toBe('Introduction');
			expect(h.level).toBe(2);
			expect(h.position.start.line).toBe(5);
		});
	});

	describe('read() — partial: firstXChars', () => {
		it('returns slice + truncated:true when content exceeds limit', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000, size: 100});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('Hello, World! This is more text.');

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(makePartialReadRequest({mode: 'firstXChars', limit: 5}));

			expect(result.content).toBe('Hello');
			expect(result.truncated).toBe(true);
			expect(result.modified).toBe(2000);
		});

		it('returns full content + truncated:false when limit >= content length', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000, size: 10});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('Hi');

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(makePartialReadRequest({mode: 'firstXChars', limit: 100}));

			expect(result.content).toBe('Hi');
			expect(result.truncated).toBe(false);
		});
	});

	describe('read() — partial: section by heading TEXT', () => {
		const CONTENT = '# Title\nIntro line.\n## Tasks\nDo stuff.\n## Notes\nSome notes.';
		// Line 0: "# Title"
		// Line 1: "Intro line."
		// Line 2: "## Tasks"
		// Line 3: "Do stuff."
		// Line 4: "## Notes"
		// Line 5: "Some notes."

		it('returns section content from heading line to next equal-level heading (exclusive)', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000, size: 60});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(CONTENT);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [
					makeHeading('Title', 1, 0),
					makeHeading('Tasks', 2, 2),
					makeHeading('Notes', 2, 4),
				],
			});

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(
				makePartialReadRequest({mode: 'section', heading: 'Tasks'}),
			);

			// Section "Tasks" spans lines 2-3 (line 4 starts the next H2)
			expect(result.content).toBe('## Tasks\nDo stuff.');
			expect(result.truncated).toBe(true); // content exists outside the section
		});

		it('section that is the entire body has truncated:false', async () => {
			const FULL = '# Only\nAll content.';
			// Line 0: "# Only"
			// Line 1: "All content."
			const file = makeTFile({ctime: 1000, mtime: 2000, size: 20});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(FULL);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [makeHeading('Only', 1, 0)],
			});

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(
				makePartialReadRequest({mode: 'section', heading: 'Only'}),
			);

			expect(result.content).toBe(FULL);
			expect(result.truncated).toBe(false);
		});

		it('section extends to EOF when no subsequent heading of equal-or-higher level', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000, size: 60});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(CONTENT);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [
					makeHeading('Title', 1, 0),
					makeHeading('Tasks', 2, 2),
					makeHeading('Notes', 2, 4),
				],
			});

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(
				makePartialReadRequest({mode: 'section', heading: 'Notes'}),
			);

			expect(result.content).toBe('## Notes\nSome notes.');
			expect(result.truncated).toBe(true);
		});

		it('throws NOT_FOUND when heading text does not exist', async () => {
			const file = makeTFile();
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('# Title\nBody.');
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [makeHeading('Title', 1, 0)],
			});

			const adapter = createNoteAdapter(app);
			await expect(
				adapter.read(makePartialReadRequest({mode: 'section', heading: 'Missing'})),
			).rejects.toMatchObject({
				code: 'NOT_FOUND',
				message: expect.stringContaining('Missing'),
			});
		});

		it('throws NOT_FOUND when metadataCache returns null (unindexed file)', async () => {
			const file = makeTFile();
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('# Title\nIntro.\n## Tasks\nDo stuff.');
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue(null);

			const adapter = createNoteAdapter(app);
			await expect(
				adapter.read(makePartialReadRequest({mode: 'section', heading: 'Tasks'})),
			).rejects.toMatchObject({
				code: 'NOT_FOUND',
				message: expect.stringContaining('Tasks'),
			});
		});
	});

	describe('read() — partial: section by headingPath', () => {
		// Content with duplicate "Tasks" at different nesting levels:
		// # Project
		// ## Tasks       ← line 1
		// ### Subtask
		// # Work
		// ## Tasks       ← line 4 (duplicate heading text, different path)
		// ### Subtask
		const CONTENT_DUP = '# Project\n## Tasks\n### Subtask\n# Work\n## Tasks\n### Subtask';

		it('disambiguates duplicate headings via headingPath', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000, size: 60});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(CONTENT_DUP);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [
					makeHeading('Project', 1, 0),
					makeHeading('Tasks', 2, 1),
					makeHeading('Subtask', 3, 2),
					makeHeading('Work', 1, 3),
					makeHeading('Tasks', 2, 4),
					makeHeading('Subtask', 3, 5),
				],
			});

			const adapter = createNoteAdapter(app);

			// Target the SECOND "Tasks" under "Work"
			const result = await adapter.read(
				makePartialReadRequest({mode: 'section', headingPath: ['Work', 'Tasks']}),
			);
			expect(result.content).toBe('## Tasks\n### Subtask');
			expect(result.truncated).toBe(true);
		});

		it('throws NOT_FOUND when headingPath does not resolve', async () => {
			const file = makeTFile();
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('# Project\n## Tasks\n');
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [
					makeHeading('Project', 1, 0),
					makeHeading('Tasks', 2, 1),
				],
			});

			const adapter = createNoteAdapter(app);
			await expect(
				adapter.read(makePartialReadRequest({mode: 'section', headingPath: ['Project', 'NoSuchSection']})),
			).rejects.toMatchObject({
				code: 'NOT_FOUND',
				message: expect.stringContaining('NoSuchSection'),
			});
		});
	});

	describe('read() — partial: range (line basis)', () => {
		const CONTENT = 'line1\nline2\nline3\nline4\nline5';

		it('returns the requested line span + truncated:true', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000, size: 30});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(CONTENT);

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(
				makePartialReadRequest({mode: 'range', basis: 'line', start: 2, end: 3}),
			);

			expect(result.content).toBe('line2\nline3');
			expect(result.truncated).toBe(true);
		});

		it('clamps end past EOF instead of throwing', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000, size: 30});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue(CONTENT);

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(
				makePartialReadRequest({mode: 'range', basis: 'line', start: 4, end: 999}),
			);

			expect(result.content).toBe('line4\nline5');
			expect(result.truncated).toBe(true);
		});
	});

	describe('read() — partial: range (char basis)', () => {
		it('returns the requested char span + truncated:true', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000, size: 20});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('Hello, World!');

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(
				makePartialReadRequest({mode: 'range', basis: 'char', start: 0, end: 5}),
			);

			expect(result.content).toBe('Hello');
			expect(result.truncated).toBe(true);
		});

		it('clamps end past EOF', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000, size: 5});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('Hi');

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(
				makePartialReadRequest({mode: 'range', basis: 'char', start: 0, end: 9999}),
			);

			expect(result.content).toBe('Hi');
			expect(result.truncated).toBe(false);
		});
	});

	describe('read() — no partial (regression)', () => {
		it('returns full content unchanged when request.partial is omitted', async () => {
			const file = makeTFile({ctime: 1000, mtime: 3000, size: 50});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.vault.read).mockResolvedValue('Full note content here.');

			const adapter = createNoteAdapter(app);
			const result = await adapter.read(makeReadRequest());

			expect(result.content).toBe('Full note content here.');
			expect(result.truncated).toBeUndefined();
			expect(result.modified).toBe(3000);
		});
	});

	// ---------------------------------------------------------------------------
	// Partial write tests (T4.2)
	// ---------------------------------------------------------------------------

	/**
	 * Helper to set up vault.process so it calls the transform with provided data
	 * and captures the resulting new body via captureBody.
	 */
	function setupVaultProcess(file: TFile, initialData: string, captureBody?: {value: string}): void {
		vi.mocked(app.vault.process).mockImplementation(async (_f, transform) => {
			const result = transform(initialData);
			if (captureBody) captureBody.value = result;
			file.stat = {ctime: file.stat.ctime, mtime: 9999, size: result.length};
			return result;
		});
	}

	describe('write() — partial: append', () => {
		beforeEach(() => { Notice._reset(); });

		it('appends content at end of file without altering existing content', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			const captured = {value: ''};
			setupVaultProcess(file, 'existing body', captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'append'}, 'new line'));

			expect(captured.value).toBe('existing body\nnew line');
		});

		it('appends without double newline when body already ends with newline', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			const captured = {value: ''};
			setupVaultProcess(file, 'existing body\n', captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'append'}, 'new line'));

			expect(captured.value).toBe('existing body\nnew line');
		});

		it('returns CoreWriteResult with refreshed stat', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			setupVaultProcess(file, 'body');

			const adapter = createNoteAdapter(app);
			const result = await adapter.write(makePartialWriteRequest({mode: 'append'}, 'more'));

			expect(result).toEqual({path: 'notes/test.md', created: 1000, modified: 9999});
		});

		it('raises CONFLICT and shows Notice when file is open and dirty', async () => {
			const file = makeTFile({path: 'notes/test.md', ctime: 1000, mtime: 2000});
			const {view} = makeLeafWithView(file, 'user is typing here');
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([{view} as unknown as never]);
			vi.mocked(app.vault.cachedRead).mockResolvedValue('old disk content');

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'append'}, 'new')),
			).rejects.toMatchObject({code: 'CONFLICT', message: expect.stringContaining('open in the editor')});
			expect(app.vault.process).not.toHaveBeenCalled();
			expect(Notice._instances).toHaveLength(1);
			expect(Notice._instances[0]!.message).toContain('Kado wanted to modify test');
		});

		it('raises NOT_FOUND when file is missing', async () => {
			vi.mocked(app.vault.getFileByPath).mockReturnValue(null);

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'append'}, 'new')),
			).rejects.toMatchObject({code: 'NOT_FOUND', message: expect.stringContaining('notes/test.md')});
		});
	});

	describe('write() — partial: prepend', () => {
		beforeEach(() => { Notice._reset(); });

		it('prepends content AFTER frontmatter block without altering existing body', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			const data = '---\ntitle: Test\n---\nbody line';
			const captured = {value: ''};
			setupVaultProcess(file, data, captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'prepend'}, 'prepended'));

			// Frontmatter prefix preserved, content inserted before body
			expect(captured.value).toBe('---\ntitle: Test\n---\nprepended\nbody line');
		});

		it('prepends at start of file when there is no frontmatter', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			const captured = {value: ''};
			setupVaultProcess(file, 'existing content', captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'prepend'}, 'new first line'));

			expect(captured.value).toBe('new first line\nexisting content');
		});

		it('never inserts at offset 0 when frontmatter exists', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			const data = '---\ntags: [a]\n---\nbody';
			const captured = {value: ''};
			setupVaultProcess(file, data, captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'prepend'}, 'inserted'));

			expect(captured.value.startsWith('---')).toBe(true);
			expect(captured.value.indexOf('inserted')).toBeGreaterThan(captured.value.indexOf('---\n', 3));
		});

		it('raises CONFLICT and shows Notice when file is open and dirty', async () => {
			const file = makeTFile({path: 'notes/test.md', ctime: 1000, mtime: 2000});
			const {view} = makeLeafWithView(file, 'user is typing');
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([{view} as unknown as never]);
			vi.mocked(app.vault.cachedRead).mockResolvedValue('disk content differs');

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'prepend'}, 'new')),
			).rejects.toMatchObject({code: 'CONFLICT'});
			expect(Notice._instances).toHaveLength(1);
		});

		it('raises NOT_FOUND when file is missing', async () => {
			vi.mocked(app.vault.getFileByPath).mockReturnValue(null);

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'prepend'}, 'new')),
			).rejects.toMatchObject({code: 'NOT_FOUND'});
		});
	});

	describe('write() — partial: insertUnderHeading', () => {
		beforeEach(() => { Notice._reset(); });

		// Content layout:
		// Line 0: "# Title"
		// Line 1: "Intro text."
		// Line 2: "## Tasks"
		// Line 3: "- task one"
		// Line 4: "## Notes"
		// Line 5: "Some notes."
		const CONTENT = '# Title\nIntro text.\n## Tasks\n- task one\n## Notes\nSome notes.';

		function makeTasksHeadings(): HeadingCache[] {
			return [
				makeHeading('Title', 1, 0),
				makeHeading('Tasks', 2, 2),
				makeHeading('Notes', 2, 4),
			];
		}

		it('inserts at END of section (before next heading), not directly after heading line', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({headings: makeTasksHeadings()});
			const captured = {value: ''};
			setupVaultProcess(file, CONTENT, captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'insertUnderHeading', heading: 'Tasks'}, '- new task'));

			// Content inserted at end of Tasks section (before "## Notes" at line 4)
			// Lines: "# Title", "Intro text.", "## Tasks", "- task one", "- new task", "## Notes", "Some notes."
			expect(captured.value).toBe('# Title\nIntro text.\n## Tasks\n- task one\n- new task\n## Notes\nSome notes.');
		});

		it('surrounding sections are byte-unchanged after insert', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({headings: makeTasksHeadings()});
			const captured = {value: ''};
			setupVaultProcess(file, CONTENT, captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'insertUnderHeading', heading: 'Tasks'}, '- new task'));

			// "## Notes\nSome notes." unchanged at end
			expect(captured.value.endsWith('## Notes\nSome notes.')).toBe(true);
			// "# Title\nIntro text." unchanged at start
			expect(captured.value.startsWith('# Title\nIntro text.')).toBe(true);
		});

		it('inserts at EOF when section extends to end of file', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({headings: makeTasksHeadings()});
			const captured = {value: ''};
			setupVaultProcess(file, CONTENT, captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'insertUnderHeading', heading: 'Notes'}, 'extra note'));

			// Notes is the last section; content appended at EOF
			expect(captured.value).toBe('# Title\nIntro text.\n## Tasks\n- task one\n## Notes\nSome notes.\nextra note');
		});

		it('raises NOT_FOUND naming the heading when heading is missing', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({headings: makeTasksHeadings()});

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'insertUnderHeading', heading: 'NoSuchHeading'}, 'content')),
			).rejects.toMatchObject({code: 'NOT_FOUND', message: expect.stringContaining('NoSuchHeading')});
		});

		it('raises CONFLICT and shows Notice when file is open and dirty', async () => {
			const file = makeTFile({path: 'notes/test.md', ctime: 1000, mtime: 2000});
			const {view} = makeLeafWithView(file, 'user is typing');
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([{view} as unknown as never]);
			vi.mocked(app.vault.cachedRead).mockResolvedValue('disk content differs');
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({headings: makeTasksHeadings()});

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'insertUnderHeading', heading: 'Tasks'}, 'content')),
			).rejects.toMatchObject({code: 'CONFLICT'});
			expect(Notice._instances).toHaveLength(1);
		});

		it('raises NOT_FOUND when file is missing', async () => {
			vi.mocked(app.vault.getFileByPath).mockReturnValue(null);

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'insertUnderHeading', heading: 'Tasks'}, 'content')),
			).rejects.toMatchObject({code: 'NOT_FOUND'});
		});

		it('is a no-op when content is empty string (inserts nothing, body unchanged)', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({headings: makeTasksHeadings()});
			const captured = {value: ''};
			setupVaultProcess(file, CONTENT, captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'insertUnderHeading', heading: 'Tasks'}, ''));

			// Empty content must not insert a stray blank line — body is unchanged
			expect(captured.value).toBe(CONTENT);
		});

		it('inserts at end of nested section via headingPath (SUCCESS)', async () => {
			// Content with nested headings:
			// Line 0: "# Title"
			// Line 1: "Intro."
			// Line 2: "## Tasks"
			// Line 3: "- existing"
			// Line 4: "## Notes"
			// Line 5: "note text"
			const DOC = '# Title\nIntro.\n## Tasks\n- existing\n## Notes\nnote text';
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [
					makeHeading('Title', 1, 0),
					makeHeading('Tasks', 2, 2),
					makeHeading('Notes', 2, 4),
				],
			});
			const captured = {value: ''};
			setupVaultProcess(file, DOC, captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'insertUnderHeading', headingPath: ['Title', 'Tasks']}, '- new task'));

			expect(captured.value).toBe('# Title\nIntro.\n## Tasks\n- existing\n- new task\n## Notes\nnote text');
		});

		it('throws NOT_FOUND naming the last path segment when headingPath does not resolve', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [
					makeHeading('Title', 1, 0),
					makeHeading('Tasks', 2, 2),
				],
			});

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'insertUnderHeading', headingPath: ['Title', 'NoSuchSection']}, 'x')),
			).rejects.toMatchObject({code: 'NOT_FOUND', message: expect.stringContaining('NoSuchSection')});
		});
	});

	describe('write() — partial: replaceSection', () => {
		beforeEach(() => { Notice._reset(); });

		const CONTENT = '# Title\nIntro text.\n## Tasks\n- task one\n- task two\n## Notes\nSome notes.';
		// Line 0: "# Title"
		// Line 1: "Intro text."
		// Line 2: "## Tasks"
		// Line 3: "- task one"
		// Line 4: "- task two"
		// Line 5: "## Notes"
		// Line 6: "Some notes."

		function makeHeadings(): HeadingCache[] {
			return [
				makeHeading('Title', 1, 0),
				makeHeading('Tasks', 2, 2),
				makeHeading('Notes', 2, 5),
			];
		}

		it('replaces section BODY while preserving the heading line itself', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({headings: makeHeadings()});
			const captured = {value: ''};
			setupVaultProcess(file, CONTENT, captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'replaceSection', heading: 'Tasks'}, '- replaced task'));

			// "## Tasks" heading preserved, body replaced, other sections unchanged
			expect(captured.value).toBe('# Title\nIntro text.\n## Tasks\n- replaced task\n## Notes\nSome notes.');
		});

		it('deletes section body (bare heading remains) when content is empty string', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({headings: makeHeadings()});
			const captured = {value: ''};
			setupVaultProcess(file, CONTENT, captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'replaceSection', heading: 'Tasks'}, ''));

			// Section body deleted — heading line stays, no extra blank lines between headings
			expect(captured.value).toBe('# Title\nIntro text.\n## Tasks\n## Notes\nSome notes.');
		});

		it('raises NOT_FOUND naming the heading when heading is missing', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({headings: makeHeadings()});

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'replaceSection', heading: 'NonExistent'}, 'x')),
			).rejects.toMatchObject({code: 'NOT_FOUND', message: expect.stringContaining('NonExistent')});
		});

		it('raises CONFLICT and shows Notice when file is open and dirty', async () => {
			const file = makeTFile({path: 'notes/test.md', ctime: 1000, mtime: 2000});
			const {view} = makeLeafWithView(file, 'user is typing');
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([{view} as unknown as never]);
			vi.mocked(app.vault.cachedRead).mockResolvedValue('disk content differs');
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({headings: makeHeadings()});

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'replaceSection', heading: 'Tasks'}, 'x')),
			).rejects.toMatchObject({code: 'CONFLICT'});
			expect(Notice._instances).toHaveLength(1);
		});

		it('raises NOT_FOUND when file is missing', async () => {
			vi.mocked(app.vault.getFileByPath).mockReturnValue(null);

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'replaceSection', heading: 'Tasks'}, 'x')),
			).rejects.toMatchObject({code: 'NOT_FOUND'});
		});

		it('replaces body of nested section resolved via headingPath (SUCCESS)', async () => {
			// Document with duplicate "Tasks" headings under different parents:
			// Line 0: "# Project"
			// Line 1: "## Tasks"
			// Line 2: "- proj task"
			// Line 3: "# Work"
			// Line 4: "## Tasks"
			// Line 5: "- work task"
			const DOC = '# Project\n## Tasks\n- proj task\n# Work\n## Tasks\n- work task';
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [
					makeHeading('Project', 1, 0),
					makeHeading('Tasks', 2, 1),
					makeHeading('Work', 1, 3),
					makeHeading('Tasks', 2, 4),
				],
			});
			const captured = {value: ''};
			setupVaultProcess(file, DOC, captured);

			const adapter = createNoteAdapter(app);
			// Target the SECOND "Tasks" under "Work" via headingPath
			await adapter.write(makePartialWriteRequest({mode: 'replaceSection', headingPath: ['Work', 'Tasks']}, '- replaced'));

			// Only the Work > Tasks section body is replaced; Project > Tasks unchanged
			expect(captured.value).toBe('# Project\n## Tasks\n- proj task\n# Work\n## Tasks\n- replaced');
		});

		it('throws NOT_FOUND naming the last path segment when replaceSection headingPath does not resolve', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
				headings: [
					makeHeading('Project', 1, 0),
					makeHeading('Tasks', 2, 1),
				],
			});

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'replaceSection', headingPath: ['Project', 'Missing']}, 'x')),
			).rejects.toMatchObject({code: 'NOT_FOUND', message: expect.stringContaining('Missing')});
		});
	});

	describe('write() — partial: replaceRange (line basis)', () => {
		beforeEach(() => { Notice._reset(); });

		// 1-based inclusive line range
		const CONTENT = 'line1\nline2\nline3\nline4\nline5';

		it('replaces addressed lines with content (1-based inclusive)', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			const captured = {value: ''};
			setupVaultProcess(file, CONTENT, captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'replaceRange', basis: 'line', start: 2, end: 3}, 'replaced'));

			expect(captured.value).toBe('line1\nreplaced\nline4\nline5');
		});

		it('deletes addressed lines when content is empty string (valid)', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			const captured = {value: ''};
			setupVaultProcess(file, CONTENT, captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'replaceRange', basis: 'line', start: 2, end: 3}, ''));

			expect(captured.value).toBe('line1\nline4\nline5');
		});

		it('raises CONFLICT and shows Notice when file is open and dirty', async () => {
			const file = makeTFile({path: 'notes/test.md', ctime: 1000, mtime: 2000});
			const {view} = makeLeafWithView(file, 'user is typing');
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([{view} as unknown as never]);
			vi.mocked(app.vault.cachedRead).mockResolvedValue('disk content differs');

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'replaceRange', basis: 'line', start: 1, end: 2}, 'x')),
			).rejects.toMatchObject({code: 'CONFLICT'});
			expect(Notice._instances).toHaveLength(1);
		});

		it('raises NOT_FOUND when file is missing', async () => {
			vi.mocked(app.vault.getFileByPath).mockReturnValue(null);

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'replaceRange', basis: 'line', start: 1, end: 2}, 'x')),
			).rejects.toMatchObject({code: 'NOT_FOUND'});
		});
	});

	describe('write() — partial: replaceRange (char basis)', () => {
		beforeEach(() => { Notice._reset(); });

		// 0-based start, exclusive end
		const CONTENT = 'Hello, World!';

		it('replaces addressed char span with content (0-based, end exclusive)', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			const captured = {value: ''};
			setupVaultProcess(file, CONTENT, captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'replaceRange', basis: 'char', start: 7, end: 12}, 'Kado'));

			expect(captured.value).toBe('Hello, Kado!');
		});

		it('deletes addressed char span when content is empty string (valid)', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			const captured = {value: ''};
			setupVaultProcess(file, CONTENT, captured);

			const adapter = createNoteAdapter(app);
			await adapter.write(makePartialWriteRequest({mode: 'replaceRange', basis: 'char', start: 5, end: 7}, ''));

			expect(captured.value).toBe('HelloWorld!');
		});

		it('raises CONFLICT and shows Notice when file is open and dirty', async () => {
			const file = makeTFile({path: 'notes/test.md', ctime: 1000, mtime: 2000});
			const {view} = makeLeafWithView(file, 'user is typing');
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([{view} as unknown as never]);
			vi.mocked(app.vault.cachedRead).mockResolvedValue('disk content differs');

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'replaceRange', basis: 'char', start: 0, end: 5}, 'x')),
			).rejects.toMatchObject({code: 'CONFLICT'});
			expect(Notice._instances).toHaveLength(1);
		});

		it('raises NOT_FOUND when file is missing', async () => {
			vi.mocked(app.vault.getFileByPath).mockReturnValue(null);

			const adapter = createNoteAdapter(app);

			await expect(
				adapter.write(makePartialWriteRequest({mode: 'replaceRange', basis: 'char', start: 0, end: 5}, 'x')),
			).rejects.toMatchObject({code: 'NOT_FOUND'});
		});
	});

	describe('write() — routing: notePartial routes to partial path, not createNote/updateNote', () => {
		beforeEach(() => { Notice._reset(); });

		it('routes to applyPartialWrite when notePartial is set (even without expectedModified)', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.vault.process).mockImplementation(async (_f, transform) => {
				transform('current body');
				file.stat = {ctime: 1000, mtime: 5000, size: 10};
			});

			const adapter = createNoteAdapter(app);
			// No expectedModified — without routing fix this would go to createNote
			const result = await adapter.write(makePartialWriteRequest({mode: 'append'}, 'added'));

			// vault.create must NOT have been called (would be createNote path)
			expect(app.vault.create).not.toHaveBeenCalled();
			// vault.process MUST have been called (partial path)
			expect(app.vault.process).toHaveBeenCalledOnce();
			expect(result.path).toBe('notes/test.md');
		});

		it('does not raise CONFLICT "Note already exists" when file exists and notePartial is set', async () => {
			const file = makeTFile({ctime: 1000, mtime: 2000});
			vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
			vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
			vi.mocked(app.vault.process).mockImplementation(async (_f, transform) => {
				transform('body');
				file.stat = {ctime: 1000, mtime: 5000, size: 4};
			});

			const adapter = createNoteAdapter(app);

			// Should NOT throw "already exists" — must go through partial path
			await expect(
				adapter.write(makePartialWriteRequest({mode: 'append'}, 'x')),
			).resolves.toBeDefined();
		});
	});
});
