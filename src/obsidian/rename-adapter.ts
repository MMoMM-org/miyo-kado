/**
 * RenameAdapter — renames or moves a vault file (note or binary).
 *
 * Uses `fileManager.renameFile()` — NOT `vault.rename`/`adapter.rename` — because
 * fileManager is the only API that rewrites inbound `[[wikilinks]]` and markdown
 * links pointing at the moved file. A raw vault/adapter rename would silently
 * break every backlink. The same "use fileManager, not the adapter" discipline
 * applies here as it does to delete (trashFile).
 *
 * The operation refuses to clobber: if a file or folder already exists at the
 * target it returns CONFLICT rather than overwriting. Optimistic concurrency on
 * the source is enforced upstream by the ConcurrencyGuard.
 */

import type {App} from 'obsidian';
import type {RenameAdapter} from '../core/operation-router';
import type {CoreRenameRequest, CoreRenameResult, CoreError, CoreErrorCode} from '../types/canonical';

// ---------------------------------------------------------------------------
// Error type — shared pattern with the other adapters
// ---------------------------------------------------------------------------

export class RenameAdapterError extends Error {
	readonly code: CoreErrorCode;

	constructor(error: CoreError) {
		super(error.message);
		this.code = error.code;
	}
}

function notFoundError(path: string): RenameAdapterError {
	return new RenameAdapterError({code: 'NOT_FOUND', message: `File not found: ${path}`});
}

function conflictError(path: string): RenameAdapterError {
	return new RenameAdapterError({code: 'CONFLICT', message: `Target already exists: ${path}`});
}

// ---------------------------------------------------------------------------
// Rename/move adapter
// ---------------------------------------------------------------------------

/**
 * Creates a RenameAdapter that moves a file via fileManager.renameFile.
 * Backlinks in other notes are updated automatically by Obsidian.
 */
export function createRenameAdapter(app: App): RenameAdapter {
	return {
		async rename(request: CoreRenameRequest): Promise<CoreRenameResult> {
			const file = app.vault.getFileByPath(request.source);
			if (!file) throw notFoundError(request.source);

			// Refuse to overwrite an existing file or folder at the target.
			if (app.vault.getAbstractFileByPath(request.target)) {
				throw conflictError(request.target);
			}

			await app.fileManager.renameFile(file, request.target);
			return {source: request.source, target: request.target, modified: file.stat.mtime};
		},
	};
}
