/**
 * FileAdapter — ReadWriteAdapter for binary (non-markdown) vault files.
 *
 * Reads binary files from the Obsidian vault and encodes content as base64
 * strings. Accepts base64 string content for writes and decodes to ArrayBuffer
 * before calling the vault API.
 */

import type {App} from 'obsidian';
import type {CoreReadRequest, CoreWriteRequest, CoreFileResult, CoreWriteResult} from '../types/canonical';
import type {ReadWriteAdapter} from '../core/operation-router';
import {NoteAdapterError} from './note-adapter';

// ---------------------------------------------------------------------------
// Base64 ↔ ArrayBuffer helpers
// ---------------------------------------------------------------------------

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

// ---------------------------------------------------------------------------
// Error builders
// ---------------------------------------------------------------------------

function notFoundError(path: string): NoteAdapterError {
	return new NoteAdapterError({code: 'NOT_FOUND', message: `File not found: ${path}`});
}

function conflictError(path: string): NoteAdapterError {
	return new NoteAdapterError({code: 'CONFLICT', message: `File already exists: ${path}`});
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

async function readFile(app: App, request: CoreReadRequest): Promise<CoreFileResult> {
	const file = app.vault.getFileByPath(request.path);
	if (!file) throw notFoundError(request.path);

	const buffer = await app.vault.readBinary(file);
	return {
		path: request.path,
		content: arrayBufferToBase64(buffer),
		created: file.stat.ctime,
		modified: file.stat.mtime,
		size: file.stat.size,
	};
}

async function writeFile(app: App, request: CoreWriteRequest): Promise<CoreWriteResult> {
	const isUpdate = request.expectedModified !== undefined;
	const base64 = request.content as string;
	const buffer = base64ToArrayBuffer(base64);

	if (isUpdate) {
		const file = app.vault.getFileByPath(request.path);
		if (!file) throw notFoundError(request.path);
		await app.vault.modifyBinary(file, buffer);
		return {path: request.path, created: file.stat.ctime, modified: file.stat.mtime};
	}

	const existing = app.vault.getFileByPath(request.path);
	if (existing) throw conflictError(request.path);

	const created = await app.vault.createBinary(request.path, buffer);
	return {path: request.path, created: created.stat.ctime, modified: created.stat.mtime};
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a ReadWriteAdapter for binary vault files (base64 encoded content).
 * @param app - The Obsidian App instance for vault access.
 */
export function createFileAdapter(app: App): ReadWriteAdapter {
	return {
		read: (request: CoreReadRequest) => readFile(app, request),
		write: (request: CoreWriteRequest) => writeFile(app, request),
	};
}
