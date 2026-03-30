/**
 * NoteAdapter — Obsidian Interface layer adapter for plain note (markdown) files.
 *
 * Implements ReadWriteAdapter by delegating to Obsidian's vault API.
 * Translates vault results and errors into Core canonical types.
 */

import type {App} from 'obsidian';
import type {ReadWriteAdapter} from '../core/operation-router';
import type {CoreReadRequest, CoreWriteRequest, CoreFileResult, CoreWriteResult, CoreError, CoreErrorCode} from '../types/canonical';

export class NoteAdapterError extends Error {
	readonly code: CoreErrorCode;

	constructor(error: CoreError) {
		super(error.message);
		this.code = error.code;
	}
}

function notFoundError(path: string): NoteAdapterError {
	return new NoteAdapterError({code: 'NOT_FOUND', message: `Note not found: ${path}`});
}

function conflictError(path: string): NoteAdapterError {
	return new NoteAdapterError({code: 'CONFLICT', message: `Note already exists: ${path}`});
}

async function readNote(app: App, request: CoreReadRequest): Promise<CoreFileResult> {
	const file = app.vault.getFileByPath(request.path);
	if (!file) throw notFoundError(request.path);
	const content = await app.vault.read(file);
	return {
		path: request.path,
		content,
		created: file.stat.ctime,
		modified: file.stat.mtime,
		size: file.stat.size,
	};
}

async function createNote(app: App, request: CoreWriteRequest): Promise<CoreWriteResult> {
	const existing = app.vault.getFileByPath(request.path);
	if (existing) throw conflictError(request.path);
	const file = await app.vault.create(request.path, request.content as string);
	return {path: request.path, created: file.stat.ctime, modified: file.stat.mtime};
}

async function updateNote(app: App, request: CoreWriteRequest): Promise<CoreWriteResult> {
	const file = app.vault.getFileByPath(request.path);
	if (!file) throw notFoundError(request.path);
	await app.vault.modify(file, request.content as string);
	return {path: request.path, created: file.stat.ctime, modified: file.stat.mtime};
}

export function createNoteAdapter(app: App): ReadWriteAdapter {
	return {
		read: (request: CoreReadRequest) => readNote(app, request),
		write: (request: CoreWriteRequest) =>
			request.expectedModified !== undefined
				? updateNote(app, request)
				: createNote(app, request),
	};
}
