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
import {TFile, TFolder} from 'obsidian';
import type {RenameAdapter} from '../core/operation-router';
import {parentDir} from '../core/rename-policy';
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

function validationError(message: string): RenameAdapterError {
	return new RenameAdapterError({code: 'VALIDATION_ERROR', message});
}

// ---------------------------------------------------------------------------
// Folder rename — in-place only (spec 009, Phase 3)
// ---------------------------------------------------------------------------

/**
 * Renames a folder in place. In-place ONLY: the parent must not change, so
 * `/test/alt → /test/neu` is allowed but `/test/alt → /neu/alt` (a move) is
 * refused with VALIDATION_ERROR. `fileManager.renameFile` works on a TFolder and
 * rewrites inbound links for every descendant; the same auto-update-links dialog
 * guard as file rename applies at the tool layer. A folder has no mtime, so the
 * result's `modified` is 0.
 */
async function renameFolder(app: App, request: CoreRenameRequest, folder: TFolder): Promise<CoreRenameResult> {
	if (parentDir(request.source) !== parentDir(request.target)) {
		throw validationError(`Cannot move folders — rename in place only (same parent required): ${request.source} → ${request.target}`);
	}
	const existing = app.vault.getAbstractFileByPath(request.target);
	// A case-only rename resolves the target back to the source folder — allow it.
	if (existing && existing !== folder) {
		throw conflictError(request.target);
	}
	try {
		await app.fileManager.renameFile(folder, request.target);
	} catch (err) {
		const now = app.vault.getAbstractFileByPath(request.target);
		if (now && now !== folder) throw conflictError(request.target);
		throw err;
	}
	return {source: request.source, target: request.target, modified: 0};
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
			// Resolve as an abstract file so a folder source is visible (getFileByPath
			// is file-only and would report NOT_FOUND for a folder).
			const src = app.vault.getAbstractFileByPath(request.source);
			if (!src) throw notFoundError(request.source);

			if (src instanceof TFolder) {
				return renameFolder(app, request, src);
			}
			// Only a file remains (a folder returned above; null threw NOT_FOUND).
			if (!(src instanceof TFile)) throw notFoundError(request.source);
			const file = src;

			const existing = app.vault.getAbstractFileByPath(request.target);
			// `existing === file` is a case-only rename on a case-insensitive
			// filesystem (the target resolves back to the source) — allow it.
			// Any OTHER occupant means a real clobber → CONFLICT.
			if (existing && existing !== file) {
				throw conflictError(request.target);
			}

			// fileManager.renameFile fails with a code-less error when the target's
			// parent folder is missing; surface a client-actionable VALIDATION_ERROR
			// instead of leaking it as INTERNAL_ERROR.
			const targetParent = parentDir(request.target);
			if (targetParent && !app.vault.getAbstractFileByPath(targetParent)) {
				throw validationError(`Target folder does not exist: ${targetParent}`);
			}

			// NOTE: when Obsidian's "Automatically update internal links" setting is off,
			// renameFile pops a BLOCKING "update links?" modal and never resolves under an
			// MCP-driven call. Kado does NOT mutate that vault setting; instead the tool is
			// only registered when it is safe (see isRenameToolEnabled) and the tool handler
			// guards every call with a timeout (see registerRenameTool).
			try {
				await app.fileManager.renameFile(file, request.target);
			} catch (err) {
				// Backstop for the check-then-act race: if something occupied the
				// target between our check and the rename, report it as CONFLICT.
				const now = app.vault.getAbstractFileByPath(request.target);
				if (now && now !== file) throw conflictError(request.target);
				throw err;
			}
			// src was narrowed to TFile above, so stat is available.
			return {source: request.source, target: request.target, modified: file.stat.mtime};
		},
	};
}
