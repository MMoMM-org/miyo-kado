/**
 * NoteTagSource adapter (#81) — resolves a note's tags for the tag access policy.
 *
 * Exists so the tool layer can feed tag rules without knowing Obsidian APIs:
 * single-note operations read the file content (so a not-yet-indexed note
 * cannot slip past a deny rule after a restart), bulk result filters use the
 * synchronous metadata cache, and note creation parses the new content.
 */

import type {App} from 'obsidian';
import {TFile, parseYaml} from 'obsidian';
import type {NoteTagSource} from '../types/canonical';
import {dedupePreservingOrder, extractNoteTags, normalizeFrontmatterTags} from '../core/note-tags';
import {normalizeTag} from '../core/tag-utils';

/** Creates a NoteTagSource backed by the vault and metadata cache of `app`. */
export function createNoteTagSource(app: App): NoteTagSource {
	const markdownFile = (path: string): TFile | null => {
		const file = app.vault.getFileByPath(path);
		return file instanceof TFile && file.extension === 'md' ? file : null;
	};

	return {
		async readTags(path) {
			const file = markdownFile(path);
			if (!file) return null;
			try {
				return extractNoteTags(await app.vault.read(file), parseYaml);
			} catch {
				return null;
			}
		},

		cachedTags(path) {
			const file = markdownFile(path);
			if (!file) return null;
			const cache = app.metadataCache.getFileCache(file);
			if (!cache) return null;
			const inline = (cache.tags ?? [])
				.map((t) => normalizeTag(t.tag))
				.filter((t): t is string => t !== null);
			return dedupePreservingOrder([...normalizeFrontmatterTags(cache.frontmatter?.tags), ...inline]);
		},

		tagsOfContent(content) {
			return extractNoteTags(content, parseYaml);
		},
	};
}
