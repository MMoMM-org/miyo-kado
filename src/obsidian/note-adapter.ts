/**
 * NoteAdapter — Obsidian Interface layer adapter for plain note (markdown) files.
 *
 * Implements ReadWriteAdapter by delegating to Obsidian's vault API.
 * Translates vault results and errors into Core canonical types.
 */

import type {App, HeadingCache, TFile} from 'obsidian';
import {MarkdownView, Notice} from 'obsidian';
import type {ReadWriteAdapter} from '../core/operation-router';
import type {CoreReadRequest, CoreWriteRequest, CoreFileResult, CoreWriteResult, CoreError, CoreErrorCode, HeadingTarget} from '../types/canonical';
import {extractInlineTags, normalizeTag} from '../core/tag-utils';
import {firstXChars, sliceByLineRange, sliceByCharRange, applyAppend, applyPrepend} from '../core/partial-slice';
import type {NoteWritePartial} from '../types/canonical';

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

function sectionNotFoundError(name: string): NoteAdapterError {
	return new NoteAdapterError({code: 'NOT_FOUND', message: `Section not found: ${name}`});
}

function conflictError(path: string): NoteAdapterError {
	return new NoteAdapterError({code: 'CONFLICT', message: `Note already exists: ${path}`});
}

// ============================================================
// Partial-read helpers
// ============================================================

/**
 * A resolved section span: 0-based start line (inclusive) and end line (exclusive).
 * `endLine` is `Infinity` when the section extends to EOF.
 * Exported for reuse by the partial-write adapter (T4.2+).
 */
export interface SectionSpan {
	startLine: number;
	endLine: number;
}

/**
 * Walk `headings` to find a heading whose path (H1 > H2 > …) matches `path[]`.
 * Each segment must appear at a strictly deeper level than the previous match,
 * and must reside within the previous match's section.
 * Returns the index of the final matched heading, or -1.
 */
export function matchHeadingPath(headings: HeadingCache[], path: string[]): number {
	let from = 0;
	let parentLevel = 0;
	let lastIdx = -1;
	for (const name of path) {
		let found = -1;
		for (let i = from; i < headings.length; i++) {
			const h = headings[i]!;
			if (h.level <= parentLevel) break; // left the parent's section
			if (h.heading === name && h.level > parentLevel) {
				found = i;
				break;
			}
		}
		if (found === -1) return -1;
		lastIdx = found;
		parentLevel = headings[found]!.level;
		from = found + 1;
	}
	return lastIdx;
}

/**
 * Resolve a HeadingTarget to a SectionSpan using Obsidian's HeadingCache[].
 * HeadingCache.position.start.line is 0-based and relative to the WHOLE file
 * (including YAML frontmatter), so the span indices align with the full content
 * string from vault.read() — do NOT strip frontmatter before slicing.
 * Returns null when the target heading cannot be found.
 */
export function resolveSection(headings: HeadingCache[], target: HeadingTarget): SectionSpan | null {
	const idx = ('headingPath' in target)
		? matchHeadingPath(headings, target.headingPath)
		: headings.findIndex(h => h.heading === target.heading); // first text match

	if (idx === -1) return null;

	const matched = headings[idx]!;
	const start = matched.position.start.line;
	const level = matched.level;
	let endLine: number = Infinity;

	// Section ends at the next heading of equal-or-higher level, else EOF.
	for (let i = idx + 1; i < headings.length; i++) {
		const next = headings[i]!;
		if (next.level <= level) {
			endLine = next.position.start.line;
			break;
		}
	}

	return {startLine: start, endLine};
}

// ============================================================
// Core read implementation
// ============================================================

async function readNote(app: App, request: CoreReadRequest): Promise<CoreFileResult> {
	const file = app.vault.getFileByPath(request.path);
	if (!file) throw notFoundError(request.path);
	if (request.operation === 'tags') return readTags(app, file, request);

	// CRITICAL: All partial-read slicing operates on the FULL file content from
	// vault.read() — do NOT strip frontmatter first. Obsidian's HeadingCache
	// position.start.line values are relative to the whole file (including any
	// YAML frontmatter block), so the indices would be wrong on a stripped body.
	const content = await app.vault.read(file);

	if (!request.partial) {
		return {
			path: request.path,
			content,
			created: file.stat.ctime,
			modified: file.stat.mtime,
			size: file.stat.size,
		};
	}

	const partial = request.partial;
	let slice: string;
	let truncated: boolean;

	if (partial.mode === 'firstXChars') {
		({slice, truncated} = firstXChars(content, partial.limit));
	} else if (partial.mode === 'range') {
		if (partial.basis === 'line') {
			({slice, truncated} = sliceByLineRange(content, partial.start, partial.end));
		} else {
			({slice, truncated} = sliceByCharRange(content, partial.start, partial.end));
		}
	} else {
		// mode === 'section'
		const cache = app.metadataCache.getFileCache(file);
		const headings: HeadingCache[] = cache?.headings ?? [];
		const span = resolveSection(headings, partial);

		if (span === null) {
			// Build a human-readable name for the error message.
			const sectionName = 'headingPath' in partial
				? partial.headingPath[partial.headingPath.length - 1] ?? '(unknown)'
				: partial.heading;
			throw sectionNotFoundError(sectionName);
		}

		// Convert the 0-based [startLine, endLine) span to sliceByLineRange's
		// 1-based inclusive form: start+1, end (clamped at line count for EOF).
		const lineCount = content.split('\n').length;
		const rangeEnd = span.endLine === Infinity ? lineCount : span.endLine;
		({slice, truncated} = sliceByLineRange(content, span.startLine + 1, rangeEnd));
	}

	return {
		path: request.path,
		content: slice,
		created: file.stat.ctime,
		modified: file.stat.mtime,
		size: file.stat.size,
		truncated,
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

/**
 * Computes the new file body for a partial write by branching on the write mode.
 * All heading-based modes read from metadataCache (same source as T4.1 reads).
 * The metadataCache may lag the freshly-written body; this is accepted per the SDD.
 */
function computeNewBody(app: App, file: TFile, data: string, partial: NoteWritePartial, content: string): string {
	if (partial.mode === 'append') {
		return applyAppend(data, content);
	}

	if (partial.mode === 'prepend') {
		// Split at the frontmatter boundary so content lands AFTER the FM block.
		// stripFrontmatter returns the body-after-FM; we recover the prefix by
		// slicing the original data at the same boundary.
		const bodyAfterFm = stripFrontmatter(data);
		const fmPrefix = data.slice(0, data.length - bodyAfterFm.length);
		return fmPrefix + applyPrepend(bodyAfterFm, content);
	}

	// All remaining modes need the heading cache.
	const cache = app.metadataCache.getFileCache(file);
	const headings: HeadingCache[] = cache?.headings ?? [];

	if (partial.mode === 'insertUnderHeading') {
		const target = 'headingPath' in partial ? {headingPath: partial.headingPath} : {heading: partial.heading};
		const span = resolveSection(headings, target);
		if (span === null) {
			const name = 'headingPath' in partial
				? (partial.headingPath[partial.headingPath.length - 1] ?? '(unknown)')
				: partial.heading;
			throw sectionNotFoundError(name);
		}

		const lines = data.split('\n');
		// Insert content at the END of the section: splice at index endLine (or at
		// lines.length when endLine is Infinity / past EOF).
		const insertAt = span.endLine === Infinity ? lines.length : span.endLine;
		const contentLines = content === '' ? [] : content.split('\n');
		lines.splice(insertAt, 0, ...contentLines);
		return lines.join('\n');
	}

	if (partial.mode === 'replaceSection') {
		const target = 'headingPath' in partial ? {headingPath: partial.headingPath} : {heading: partial.heading};
		const span = resolveSection(headings, target);
		if (span === null) {
			const name = 'headingPath' in partial
				? (partial.headingPath[partial.headingPath.length - 1] ?? '(unknown)')
				: partial.heading;
			throw sectionNotFoundError(name);
		}

		const lines = data.split('\n');
		// Section BODY = lines after the heading (startLine+1) up to endLine.
		// The heading line itself (startLine) is preserved.
		const bodyStart = span.startLine + 1;
		const bodyEnd = span.endLine === Infinity ? lines.length : span.endLine;

		const contentLines = content === '' ? [] : content.split('\n');
		lines.splice(bodyStart, bodyEnd - bodyStart, ...contentLines);
		return lines.join('\n');
	}

	// replaceRange
	if (partial.basis === 'line') {
		// 1-based inclusive — replace lines [start..end] with content.
		const lines = data.split('\n');
		const from = partial.start - 1; // convert to 0-based
		const to = partial.end;         // end is inclusive 1-based → exclusive 0-based
		const contentLines = content === '' ? [] : content.split('\n');
		lines.splice(from, to - from, ...contentLines);
		return lines.join('\n');
	} else {
		// char basis — 0-based start, exclusive end (code points).
		const cps = Array.from(data);
		const before = cps.slice(0, partial.start).join('');
		const after = cps.slice(partial.end).join('');
		return before + content + after;
	}
}

/**
 * Pre-validates heading-based partial write modes before calling vault.process.
 * Resolves the section span from the metadata cache and throws NOT_FOUND if
 * the heading cannot be found — allowing callers to fail fast before any write.
 * No-ops for non-heading modes (append, prepend, replaceRange).
 */
function preValidateHeadingTarget(
	app: App,
	file: TFile,
	partial: NoteWritePartial,
): void {
	if (
		partial.mode !== 'insertUnderHeading' &&
		partial.mode !== 'replaceSection'
	) return;

	const cache = app.metadataCache.getFileCache(file);
	const headings: HeadingCache[] = cache?.headings ?? [];
	const target = 'headingPath' in partial ? {headingPath: partial.headingPath} : {heading: partial.heading};
	const span = resolveSection(headings, target);
	if (span === null) {
		const name = 'headingPath' in partial
			? (partial.headingPath[partial.headingPath.length - 1] ?? '(unknown)')
			: partial.heading;
		throw sectionNotFoundError(name);
	}
}

/**
 * Applies a partial write to an existing note.
 * Checks for file existence and dirty-editor conflicts before writing.
 * CON-7: the dirty-editor guard runs for EVERY partial write mode.
 */
async function applyPartialWrite(app: App, request: CoreWriteRequest): Promise<CoreWriteResult> {
	const file = app.vault.getFileByPath(request.path);
	if (!file) throw notFoundError(request.path);

	if (await isFileOpenAndDirty(app, file)) {
		new Notice(`Kado wanted to modify ${file.basename} — pause typing to let the assistant through, or keep going and it will retry`, 8000);
		throw conflictEditorError(request.path);
	}

	const partial = request.notePartial!;
	// Pre-validate heading targets so NOT_FOUND is thrown before vault.process.
	preValidateHeadingTarget(app, file, partial);

	const content = request.content as string;
	await app.vault.process(file, (data) => computeNewBody(app, file, data, partial, content));

	const refreshed = app.vault.getFileByPath(request.path);
	const stat = refreshed?.stat ?? file.stat;
	return {path: request.path, created: stat.ctime, modified: stat.mtime};
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
		write: (request: CoreWriteRequest) => {
			if (request.notePartial !== undefined) return applyPartialWrite(app, request);
			return request.expectedModified !== undefined
				? updateNote(app, request)
				: createNote(app, request);
		},
	};
}
