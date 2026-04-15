/**
 * NoteAdapter — Obsidian Interface layer adapter for plain note (markdown) files.
 *
 * Implements ReadWriteAdapter by delegating to Obsidian's vault API.
 * Translates vault results and errors into Core canonical types.
 */

import type {App} from 'obsidian';
import type {ReadWriteAdapter} from '../core/operation-router';
import type {CoreReadRequest, CoreWriteRequest, CoreFileResult, CoreWriteResult, CoreError, CoreErrorCode} from '../types/canonical';
import {extractInlineTags, normalizeTag} from '../core/tag-utils';

/** Error thrown by vault adapters, wrapping a CoreError with its error code. */
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
	if (request.operation === 'tags') return readTags(app, file, request.path);
	const content = await app.vault.read(file);
	return {
		path: request.path,
		content,
		created: file.stat.ctime,
		modified: file.stat.mtime,
		size: file.stat.size,
	};
}

/** Splits a frontmatter tags string at whitespace or commas and normalizes each token. */
function parseFrontmatterTagString(raw: string): string[] {
	return raw
		.split(/[\s,]+/)
		.map((t) => normalizeTag(t))
		.filter((t): t is string => t !== null);
}

/** Reads frontmatter tags for a note: accepts string or string[] form, normalizes and dedupes. */
function readFrontmatterTags(app: App, file: {path: string}): string[] {
	const cache = app.metadataCache.getFileCache(file as Parameters<typeof app.metadataCache.getFileCache>[0]);
	const raw: unknown = cache?.frontmatter?.tags;
	if (raw === undefined || raw === null) return [];
	const collected: string[] = [];
	if (typeof raw === 'string') {
		collected.push(...parseFrontmatterTagString(raw));
	} else if (Array.isArray(raw)) {
		for (const entry of raw) {
			if (typeof entry !== 'string') continue;
			const tag = normalizeTag(entry);
			if (tag !== null) collected.push(tag);
		}
	}
	return dedupePreservingOrder(collected);
}

function dedupePreservingOrder(tags: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const tag of tags) {
		if (!seen.has(tag)) {
			seen.add(tag);
			out.push(tag);
		}
	}
	return out;
}

/** Strips a leading YAML frontmatter block so inline-tag scanning does not re-scan it. */
function stripFrontmatter(content: string): string {
	if (!content.startsWith('---')) return content;
	const end = content.indexOf('\n---', 3);
	if (end === -1) return content;
	const afterFence = content.indexOf('\n', end + 1);
	return afterFence === -1 ? '' : content.slice(afterFence + 1);
}

async function readTags(app: App, file: Parameters<App['vault']['read']>[0], path: string): Promise<CoreFileResult> {
	const raw = await app.vault.read(file);
	const frontmatter = readFrontmatterTags(app, file as {path: string});
	const body = stripFrontmatter(raw);
	const inline = extractInlineTags(body);
	const all = dedupePreservingOrder([...frontmatter, ...inline]);
	return {
		path,
		content: {frontmatter, inline, all},
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
	// Obsidian bug: vault.modify()/process()/read() after adapter.write() can
	// truncate the file back to the previous size. Any vault cache interaction
	// triggers an internal flush with stale stat.size. Workaround: write ONLY
	// via adapter, get stat from adapter, and let Obsidian discover the change
	// through its file watcher (which correctly re-reads the full file).
	// See docs/upstream-bugs/vault-cache-truncation.md for full details.
	// Filed upstream: https://forum.obsidian.md/t/vault-cache-truncation-after-adapter-write/113139
	await app.vault.adapter.write(file.path, request.content as string);
	const stat = (await app.vault.adapter.stat(file.path)) ?? file.stat;
	return {path: request.path, created: stat.ctime, modified: stat.mtime};
}

/**
 * Creates a ReadWriteAdapter for plain markdown note files.
 * @param app - The Obsidian App instance for vault access.
 */
export function createNoteAdapter(app: App): ReadWriteAdapter {
	return {
		read: (request: CoreReadRequest) => readNote(app, request),
		write: (request: CoreWriteRequest) =>
			request.expectedModified !== undefined
				? updateNote(app, request)
				: createNote(app, request),
	};
}
