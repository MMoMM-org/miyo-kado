/**
 * NoteAdapter — Obsidian Interface layer adapter for plain note (markdown) files.
 *
 * Implements ReadWriteAdapter by delegating to Obsidian's vault API.
 * Translates vault results and errors into Core canonical types.
 */

import type {App, TFile} from 'obsidian';
import {MarkdownView, Notice} from 'obsidian';
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
	if (request.operation === 'tags') return readTags(app, file, request);
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

type FileCacheArg = Parameters<App['metadataCache']['getFileCache']>[0];

/** Reads frontmatter tags for a note: accepts string or string[] form, normalizes and dedupes. */
function readFrontmatterTags(app: App, file: FileCacheArg): string[] {
	const cache = app.metadataCache.getFileCache(file);
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

async function readTags(app: App, file: Parameters<App['vault']['read']>[0], request: CoreReadRequest): Promise<CoreFileResult> {
	const scope = request.tagsReturnScope ?? 'all';
	const frontmatter = readFrontmatterTags(app, file);

	if (scope === 'frontmatter-only') {
		const all = dedupePreservingOrder(frontmatter);
		return {
			path: request.path,
			content: {frontmatter, inline: [], all, returnedTags: 'FrontmatterOnly'},
			created: file.stat.ctime,
			modified: file.stat.mtime,
			size: file.stat.size,
		};
	}

	const raw = await app.vault.read(file);
	const body = stripFrontmatter(raw);
	const inline = extractInlineTags(body);
	const all = dedupePreservingOrder([...frontmatter, ...inline]);
	return {
		path: request.path,
		content: {frontmatter, inline, all, returnedTags: 'All'},
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

/** Returns the MarkdownView leaf showing `path`, or null if none is open on that file. */
function findOpenMarkdownView(app: App, path: string): MarkdownView | null {
	const leaves = app.workspace.getLeavesOfType('markdown');
	for (const leaf of leaves) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === path) return view;
	}
	return null;
}

/**
 * Detects whether the target file is open in an editor with unsaved changes.
 * Compares the live editor buffer (`getViewData()`) against the last value
 * Obsidian has read from disk (`vault.read()` — direct fs.readFile, no
 * internal cache). Differences mean the user is mid-typing and a write now
 * would race against the editor's debounce flush.
 */
async function isFileOpenAndDirty(app: App, file: TFile): Promise<boolean> {
	const view = findOpenMarkdownView(app, file.path);
	if (!view) return false;
	const editorContent = view.getViewData();
	const diskContent = await app.vault.read(file);
	return editorContent !== diskContent;
}

function conflictEditorError(path: string): NoteAdapterError {
	return new NoteAdapterError({
		code: 'CONFLICT',
		message: `File ${path} is open in the editor with unsaved changes. Re-read it and retry — the next read will include the user's latest edits once Obsidian auto-saves (≈2 s after the last keystroke).`,
	});
}

async function updateNote(app: App, request: CoreWriteRequest): Promise<CoreWriteResult> {
	const file = app.vault.getFileByPath(request.path);
	if (!file) throw notFoundError(request.path);

	// When the user is actively editing the same file, their in-progress
	// keystrokes must not be silently overwritten. Surface a CONFLICT so the
	// MCP client re-reads (picking up the user's latest edits after the ~2 s
	// Obsidian autosave debounce settles) and retries its write on top of
	// the merged state — never blowing away typing.
	if (await isFileOpenAndDirty(app, file)) {
		// Tell the user an assistant tried to change the note they are
		// editing, so they can pause (or keep typing) deliberately. The
		// MCP client sees CONFLICT and will retry after re-reading.
		new Notice(`Kado wanted to modify ${file.basename} — pause typing to let the assistant through, or keep going and it will retry`, 8000);
		throw conflictEditorError(request.path);
	}

	const newContent = request.content as string;
	await app.vault.process(file, () => newContent);
	const refreshed = app.vault.getFileByPath(request.path);
	const stat = refreshed?.stat ?? file.stat;
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
