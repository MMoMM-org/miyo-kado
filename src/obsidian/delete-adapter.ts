/**
 * DeleteAdapter implementations for notes, files, and frontmatter keys.
 *
 * Notes and files are moved to the user's preferred trash destination via
 * `fileManager.trashFile()` — respects the Obsidian "Deleted files" setting
 * (system trash / .trash folder / permanent delete).
 *
 * Frontmatter delete removes specified keys via `processFrontMatter` with the
 * JS `delete` operator (not set-to-null — actual key removal).
 *
 * Dataview inline fields are deliberately not supported here — regex-based line
 * removal is too risky for a destructive operation.
 */

import type {App} from 'obsidian';
import type {DeleteAdapter} from '../core/operation-router';
import type {CoreDeleteRequest, CoreDeleteResult, CoreError, CoreErrorCode} from '../types/canonical';

// ---------------------------------------------------------------------------
// Error type — shared pattern with other adapters
// ---------------------------------------------------------------------------

export class DeleteAdapterError extends Error {
	readonly code: CoreErrorCode;

	constructor(error: CoreError) {
		super(error.message);
		this.code = error.code;
	}
}

function notFoundError(path: string): DeleteAdapterError {
	return new DeleteAdapterError({code: 'NOT_FOUND', message: `File not found: ${path}`});
}

function validationError(message: string): DeleteAdapterError {
	return new DeleteAdapterError({code: 'VALIDATION_ERROR', message});
}

// ---------------------------------------------------------------------------
// Note delete — trashes the entire markdown file
// ---------------------------------------------------------------------------

/** Creates a DeleteAdapter that trashes markdown notes via fileManager.trashFile. */
export function createNoteDeleteAdapter(app: App): DeleteAdapter {
	return {
		async delete(request: CoreDeleteRequest): Promise<CoreDeleteResult> {
			const file = app.vault.getFileByPath(request.path);
			if (!file) throw notFoundError(request.path);
			await app.fileManager.trashFile(file);
			return {path: request.path};
		},
	};
}

// ---------------------------------------------------------------------------
// File delete — trashes binary files (PNG, PDF, etc.)
// ---------------------------------------------------------------------------

/** Creates a DeleteAdapter that trashes binary files. Uses the same trashFile API. */
export function createFileDeleteAdapter(app: App): DeleteAdapter {
	return {
		async delete(request: CoreDeleteRequest): Promise<CoreDeleteResult> {
			const file = app.vault.getFileByPath(request.path);
			if (!file) throw notFoundError(request.path);
			await app.fileManager.trashFile(file);
			return {path: request.path};
		},
	};
}

// ---------------------------------------------------------------------------
// Frontmatter delete — removes keys from YAML frontmatter
// ---------------------------------------------------------------------------

/**
 * Creates a DeleteAdapter that removes specified keys from YAML frontmatter.
 * Uses `delete fm[key]` — actual key removal, not setting to null.
 */
export function createFrontmatterDeleteAdapter(app: App): DeleteAdapter {
	return {
		async delete(request: CoreDeleteRequest): Promise<CoreDeleteResult> {
			if (!request.keys || request.keys.length === 0) {
				throw validationError('frontmatter delete requires a non-empty `keys` array');
			}
			const file = app.vault.getFileByPath(request.path);
			if (!file) throw notFoundError(request.path);
			await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				for (const key of request.keys!) {
					delete fm[key];
				}
			});
			return {path: request.path, modified: file.stat.mtime};
		},
	};
}
