/**
 * Tests for the NoteTagSource adapter (#81) — resolves note tags from content or the metadata cache.
 */

import {describe, it, expect, beforeEach} from 'vitest';
import {App, TFile, createMockCachedMetadata} from '../__mocks__/obsidian';
import {createNoteTagSource} from '../../src/obsidian/note-tag-source';

function makeFile(path: string, extension = 'md'): TFile {
	const file = new TFile();
	file.path = path;
	file.extension = extension;
	return file;
}

describe('NoteTagSource', () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	describe('readTags()', () => {
		it('extracts frontmatter and inline tags from the file content', async () => {
			const file = makeFile('n.md');
			app.vault.getFileByPath.mockReturnValue(file);
			app.vault.read.mockResolvedValue('---\ntags: [Work]\n---\nbody #Team');
			const source = createNoteTagSource(app as never);
			await expect(source.readTags('n.md')).resolves.toEqual(['Work', 'Team']);
			expect(app.vault.read).toHaveBeenCalledWith(file);
		});

		it('returns null for a missing file', async () => {
			app.vault.getFileByPath.mockReturnValue(null);
			await expect(createNoteTagSource(app as never).readTags('missing.md')).resolves.toBeNull();
		});

		it('returns null for a non-markdown file', async () => {
			app.vault.getFileByPath.mockReturnValue(makeFile('a.png', 'png'));
			await expect(createNoteTagSource(app as never).readTags('a.png')).resolves.toBeNull();
		});

		it('returns null when reading fails', async () => {
			app.vault.getFileByPath.mockReturnValue(makeFile('n.md'));
			app.vault.read.mockRejectedValue(new Error('io'));
			await expect(createNoteTagSource(app as never).readTags('n.md')).resolves.toBeNull();
		});
	});

	describe('cachedTags()', () => {
		it('merges cached inline tags and frontmatter tags (string and array forms)', () => {
			app.vault.getFileByPath.mockReturnValue(makeFile('n.md'));
			app.metadataCache.getFileCache.mockReturnValue(createMockCachedMetadata({
				tags: [{tag: '#Team', position: {start: {line: 0, col: 0, offset: 0}, end: {line: 0, col: 5, offset: 5}}}],
				frontmatter: {tags: 'Work, Shared'},
			}));
			expect(createNoteTagSource(app as never).cachedTags('n.md')).toEqual(['Work', 'Shared', 'Team']);
		});

		it('reads a singular `tag` frontmatter key from the cache', () => {
			app.vault.getFileByPath.mockReturnValue(makeFile('n.md'));
			app.metadataCache.getFileCache.mockReturnValue(createMockCachedMetadata({frontmatter: {tag: 'Private'}}));
			expect(createNoteTagSource(app as never).cachedTags('n.md')).toEqual(['Private']);
		});

		it('treats an upper-case .MD extension as markdown', () => {
			app.vault.getFileByPath.mockReturnValue(makeFile('N.MD', 'MD'));
			app.metadataCache.getFileCache.mockReturnValue(createMockCachedMetadata({tags: [{tag: '#Work', position: {start: {line: 0, col: 0, offset: 0}, end: {line: 0, col: 5, offset: 5}}}]}));
			expect(createNoteTagSource(app as never).cachedTags('N.MD')).toEqual(['Work']);
		});

		it('returns [] for an indexed note without tags', () => {
			app.vault.getFileByPath.mockReturnValue(makeFile('n.md'));
			app.metadataCache.getFileCache.mockReturnValue(createMockCachedMetadata({}));
			expect(createNoteTagSource(app as never).cachedTags('n.md')).toEqual([]);
		});

		it('returns null when the note is not indexed yet', () => {
			app.vault.getFileByPath.mockReturnValue(makeFile('n.md'));
			app.metadataCache.getFileCache.mockReturnValue(null);
			expect(createNoteTagSource(app as never).cachedTags('n.md')).toBeNull();
		});

		it('returns null for missing and non-markdown files', () => {
			app.vault.getFileByPath.mockReturnValue(null);
			expect(createNoteTagSource(app as never).cachedTags('x.md')).toBeNull();
			app.vault.getFileByPath.mockReturnValue(makeFile('a.png', 'png'));
			expect(createNoteTagSource(app as never).cachedTags('a.png')).toBeNull();
		});
	});

	describe('tagsOfContent()', () => {
		it('extracts tags from new content without touching the vault', () => {
			const tags = createNoteTagSource(app as never).tagsOfContent('---\ntags: [Work]\n---\n#Draft');
			expect(tags).toEqual(['Work', 'Draft']);
			expect(app.vault.read).not.toHaveBeenCalled();
		});
	});
});
