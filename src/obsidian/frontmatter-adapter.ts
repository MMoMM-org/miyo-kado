/**
 * FrontmatterAdapter — ReadWriteAdapter implementation for YAML frontmatter.
 *
 * Reads frontmatter via metadataCache and writes via fileManager.processFrontMatter
 * for atomic YAML mutation. Part of the Obsidian Interface layer (Phase 3).
 */

import type {App, TFile} from 'obsidian';
import type {ReadWriteAdapter} from '../core/operation-router';
import type {CoreReadRequest, CoreWriteRequest, CoreFileResult, CoreWriteResult} from '../types/canonical';
import {NoteAdapterError} from './note-adapter';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function notFoundError(path: string): NoteAdapterError {
	return new NoteAdapterError({code: 'NOT_FOUND', message: `File not found: ${path}`});
}

function getFile(app: App, path: string): TFile | null {
	return app.vault.getFileByPath(path);
}

function readFrontmatter(app: App, file: TFile): Record<string, unknown> {
	const cache = app.metadataCache.getFileCache(file);
	return (cache?.frontmatter as Record<string, unknown> | undefined) ?? {};
}

function buildFileResult(path: string, content: Record<string, unknown>, file: TFile): CoreFileResult {
	return {
		path,
		content,
		created: file.stat.ctime,
		modified: file.stat.mtime,
		size: file.stat.size,
	};
}

function buildWriteResult(path: string, file: TFile): CoreWriteResult {
	return {
		path,
		created: file.stat.ctime,
		modified: file.stat.mtime,
	};
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * Creates a ReadWriteAdapter for YAML frontmatter read/write via metadataCache and processFrontMatter.
 * @param app - The Obsidian App instance for vault and metadata access.
 */
export function createFrontmatterAdapter(app: App): ReadWriteAdapter {
	return {
		async read(request: CoreReadRequest): Promise<CoreFileResult> {
			const file = getFile(app, request.path);
			if (!file) {
				throw notFoundError(request.path);
			}
			const content = readFrontmatter(app, file);
			return buildFileResult(request.path, content, file);
		},

		async write(request: CoreWriteRequest): Promise<CoreWriteResult> {
			const file = getFile(app, request.path);
			if (!file) {
				throw notFoundError(request.path);
			}
			const content = request.content as Record<string, unknown>;
			await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				Object.assign(fm, content);
			});
			return buildWriteResult(request.path, file);
		},
	};
}
