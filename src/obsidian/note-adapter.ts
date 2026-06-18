/**
 * NoteAdapter — Obsidian Interface layer adapter for plain note (markdown) files.
 *
 * Implements ReadWriteAdapter by delegating to Obsidian's vault API.
 * Translates vault results and errors into Core canonical types.
 */

import type {App, HeadingCache, TFile} from 'obsidian';
import {MarkdownView, Notice, parseYaml} from 'obsidian';
import type {ReadWriteAdapter} from '../core/operation-router';
import type {CoreReadRequest, CoreWriteRequest, CoreFileResult, CoreWriteResult, CoreError, CoreErrorCode, HeadingTarget, NoteWritePartial} from '../types/canonical';
import {extractInlineTags, normalizeTag} from '../core/tag-utils';
import {firstXChars, sliceByLineRange, sliceByCharRange, applyAppend, applyPrepend} from '../core/partial-slice';

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
 */
interface SectionSpan {
	startLine: number;
	endLine: number;
}

/**
 * Walk `headings` to find a heading whose path (H1 > H2 > …) matches `path[]`.
 * Each segment must appear at a strictly deeper level than the previous match,
 * and must reside within the previous match's section.
 * Returns the index of the final matched heading, or -1.
 */
function matchHeadingPath(headings: HeadingCache[], path: string[]): number {
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

/** Narrows a partial descriptor's heading arm to a HeadingTarget. */
function toHeadingTarget(p: {heading: string} | {headingPath: string[]}): HeadingTarget {
	return 'headingPath' in p ? {headingPath: p.headingPath} : {heading: p.heading};
}

/** Human-readable heading name for NOT_FOUND messages (last path segment, or the text). */
function headingName(target: HeadingTarget): string {
	return 'headingPath' in target
		? (target.headingPath[target.headingPath.length - 1] ?? '(unknown)')
		: target.heading;
}

/** Resolves a section span or throws NOT_FOUND — single source for the resolve+throw pattern. */
function resolveSectionOrThrow(headings: HeadingCache[], target: HeadingTarget): SectionSpan {
	const span = resolveSection(headings, target);
	if (span === null) throw sectionNotFoundError(headingName(target));
	return span;
}

/** Clamps the `Infinity` EOF sentinel of a span's endLine to a concrete line count. */
function endLineOf(span: SectionSpan, lineCount: number): number {
	return span.endLine === Infinity ? lineCount : span.endLine;
}

/** True when `line` is a Markdown ATX heading (`# …`). Used to detect a stale cache before splicing. */
function isHeadingLine(line: string | undefined): boolean {
	return line !== undefined && /^#{1,6}(\s|$)/.test(line);
}

/**
 * Rebuilds a line array after a splice without spreading `insert` as call
 * arguments — `lines.splice(at, n, ...huge)` would hit V8's argument-count
 * limit for very large insertions, so use array-spread (iteration) instead.
 */
function spliceLines(lines: string[], start: number, deleteCount: number, insert: string[]): string {
	return [...lines.slice(0, start), ...insert, ...lines.slice(start + deleteCount)].join('\n');
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
		const span = resolveSectionOrThrow(headings, toHeadingTarget(partial));

		// Convert the 0-based [startLine, endLine) span to sliceByLineRange's
		// 1-based inclusive form: start+1, end (clamped at line count for EOF).
		const lineCount = content.split('\n').length;
		({slice, truncated} = sliceByLineRange(content, span.startLine + 1, endLineOf(span, lineCount)));
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

/**
 * Splits content at the YAML frontmatter boundary into `{prefix, body}` where
 * `prefix + body === content` in the normal case. The split point is returned
 * explicitly rather than reconstructed by length arithmetic, so callers (e.g.
 * prepend) can never run the closing fence and inserted text together.
 *
 * Edge case: a frontmatter-only file whose closing `---` is the very last byte
 * (no trailing newline). There is no body, and concatenating onto the bare
 * fence would corrupt it, so the prefix is normalized with a trailing newline.
 */
function splitFrontmatter(content: string): {prefix: string; body: string} {
	if (!content.startsWith('---')) return {prefix: '', body: content};
	const end = content.indexOf('\n---', 3);
	if (end === -1) return {prefix: '', body: content};
	const afterFence = content.indexOf('\n', end + 1);
	if (afterFence === -1) return {prefix: content + '\n', body: ''};
	return {prefix: content.slice(0, afterFence + 1), body: content.slice(afterFence + 1)};
}

/** Strips a leading YAML frontmatter block so inline-tag scanning does not re-scan it. */
function stripFrontmatter(content: string): string {
	return splitFrontmatter(content).body;
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
 * Compares the live editor buffer (`getViewData()`) against Obsidian's in-memory
 * cached copy (`vault.cachedRead()`, kept in sync with the last saved state).
 * Differences mean the user is mid-typing and a write now would race the editor's
 * debounce flush. `cachedRead` is used instead of `read` to avoid an fs round-trip
 * that would widen the window in which the debounce can fire between the two reads.
 *
 * This is a best-effort guard, not a hard lock: the CONFLICT-and-retry contract
 * tolerates the residual race (the client re-reads and retries on top of the
 * merged state). See SDD CON-7.
 */
async function isFileOpenAndDirty(app: App, file: TFile): Promise<boolean> {
	const view = findOpenMarkdownView(app, file.path);
	if (!view) return false;
	const editorContent = view.getViewData();
	const cachedContent = await app.vault.cachedRead(file);
	if (editorContent === cachedContent) return false; // fast path: byte-identical
	return !contentsEquivalent(editorContent, cachedContent);
}

/**
 * Returns the raw YAML text inside a frontmatter block (between the opening and
 * closing `---` fences), or null if `prefix` is not a frontmatter block. Operates
 * on the `prefix` returned by splitFrontmatter, which is `---\n<yaml>\n---\n`.
 */
function innerYaml(prefix: string): string | null {
	if (!prefix.startsWith('---')) return null;
	const open = prefix.indexOf('\n');
	const close = prefix.indexOf('\n---', open);
	if (open === -1 || close === -1) return null;
	return prefix.slice(open + 1, close + 1);
}

/**
 * Recursively sorts object keys so two structurally-equal objects serialize
 * identically regardless of key order. Array order is preserved (it is
 * semantically meaningful, e.g. an ordered tag list).
 */
function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			out[key] = canonicalize((value as Record<string, unknown>)[key]);
		}
		return out;
	}
	return value;
}

/** True when two YAML strings parse to the same structure (ignoring serialization). */
function frontmatterEquivalent(a: string, b: string): boolean {
	try {
		return JSON.stringify(canonicalize(parseYaml(a))) === JSON.stringify(canonicalize(parseYaml(b)));
	} catch {
		return false; // unparseable on either side → treat as different (fail safe: dirty)
	}
}

/**
 * True when the editor buffer and the on-disk copy are equivalent despite not
 * being byte-identical. Obsidian's Properties widget re-serializes frontmatter in
 * canonical form (key order, quoting, empty-array style), so getViewData() never
 * byte-matches the on-disk YAML even with zero user edits — a byte comparison
 * would flag such notes as perpetually "dirty" and block every assistant write.
 *
 * The body is compared verbatim (any real typing differs there); only the
 * frontmatter is compared semantically. See CON-7 — this keeps the dirty-editor
 * guard a true edit detector rather than a serialization-diff detector.
 */
function contentsEquivalent(editor: string, cached: string): boolean {
	if (typeof editor !== 'string' || typeof cached !== 'string') return false; // can't compare → treat as dirty
	const e = splitFrontmatter(editor);
	const c = splitFrontmatter(cached);
	if (e.body !== c.body) return false;
	const ey = innerYaml(e.prefix);
	const cy = innerYaml(c.prefix);
	if (ey === null || cy === null) return e.prefix === c.prefix; // no FM block → exact compare
	return ey === cy || frontmatterEquivalent(ey, cy);
}

function conflictEditorError(path: string): NoteAdapterError {
	return new NoteAdapterError({
		code: 'CONFLICT',
		message: `File ${path} is open in the editor with unsaved changes. Re-read it and retry — the next read will include the user's latest edits once Obsidian auto-saves (≈2 s after the last keystroke).`,
	});
}

/** CONFLICT raised when the metadata cache was too stale to splice safely. */
function staleSectionConflict(name: string): NoteAdapterError {
	return new NoteAdapterError({
		code: 'CONFLICT',
		message: `Heading "${name}" moved since it was indexed. Re-read the note and retry.`,
	});
}

/** VALIDATION_ERROR raised when a replaceRange bound points beyond the file. */
function rangeOutOfBounds(position: string, available: number): NoteAdapterError {
	return new NoteAdapterError({
		code: 'VALIDATION_ERROR',
		message: `replaceRange ${position} is past the end of the file (it has ${available}). Re-read and use an in-range value.`,
	});
}

/**
 * Computes the new file body for a partial write. A pure function of its inputs:
 * the heading span (for insert/replace-section modes) is resolved by the caller
 * BEFORE vault.process and passed in, so this function never touches live state.
 *
 * For heading modes the resolved span comes from the metadata cache, which can
 * lag the freshest `data`. As a safety net we verify the resolved start line is
 * still a heading in `data`; if not, the cache was stale and we fail with
 * CONFLICT rather than splicing at the wrong place. See SDD ADR-5 / CON-7.
 */
function computeNewBody(data: string, partial: NoteWritePartial, content: string, span: SectionSpan | null): string {
	if (partial.mode === 'append') {
		return applyAppend(data, content);
	}

	if (partial.mode === 'prepend') {
		// Split at the frontmatter boundary so content lands AFTER the FM block,
		// using the explicit split point (never length arithmetic) so the closing
		// fence and inserted text can't run together.
		const {prefix, body} = splitFrontmatter(data);
		return prefix + applyPrepend(body, content);
	}

	if (partial.mode === 'insertUnderHeading' || partial.mode === 'replaceSection') {
		const lines = data.split('\n');
		const resolved = span!; // resolved before vault.process; non-null for heading modes
		if (!isHeadingLine(lines[resolved.startLine])) {
			throw staleSectionConflict(headingName(toHeadingTarget(partial)));
		}
		const insert = content === '' ? [] : content.split('\n');
		if (partial.mode === 'insertUnderHeading') {
			// Insert at the END of the section (just before the next sibling/EOF).
			return spliceLines(lines, endLineOf(resolved, lines.length), 0, insert);
		}
		// replaceSection — replace the section BODY (lines after the heading),
		// preserving the heading line itself (resolved.startLine).
		const bodyStart = resolved.startLine + 1;
		return spliceLines(lines, bodyStart, endLineOf(resolved, lines.length) - bodyStart, insert);
	}

	// replaceRange
	if (partial.basis === 'line') {
		// 1-based inclusive — replace lines [start..end] with content.
		const lines = data.split('\n');
		const from = partial.start - 1; // convert to 0-based
		if (from > lines.length) throw rangeOutOfBounds(`line ${partial.start}`, lines.length);
		const to = Math.min(partial.end, lines.length); // clamp inclusive end → exclusive 0-based
		const insert = content === '' ? [] : content.split('\n');
		return spliceLines(lines, from, to - from, insert);
	}
	// char basis — 0-based start, exclusive end (code points). O(end), code-point-safe.
	let i = 0;
	let cp = 0;
	while (i < data.length && cp < partial.start) {
		const c = data.codePointAt(i)!;
		i += c > 0xffff ? 2 : 1;
		cp++;
	}
	if (cp < partial.start) throw rangeOutOfBounds(`char ${partial.start}`, cp);
	const startByte = i;
	while (i < data.length && cp < partial.end) {
		const c = data.codePointAt(i)!;
		i += c > 0xffff ? 2 : 1;
		cp++;
	}
	return data.slice(0, startByte) + content + data.slice(i);
}

/**
 * Shared write scaffold: resolves the file, refuses to clobber an actively-edited
 * note (CON-7 dirty-editor guard), runs `buildTransform` to construct the body
 * transform (resolving heading spans / validating fail-fast BEFORE vault.process),
 * then applies it atomically and returns the refreshed stat.
 *
 * Optimistic concurrency (expectedModified) is enforced once by the
 * ConcurrencyGuard before the request reaches the adapter (single source of
 * truth — see concurrency-guard.ts). The residual TOCTOU window between that
 * check and vault.process is bounded: vault.process always operates on the
 * freshest on-disk `data`, and the stale-cache guard in computeNewBody fails
 * safe for heading modes, so a concurrent external write cannot corrupt the note.
 */
async function writeViaProcess(
	app: App,
	request: CoreWriteRequest,
	buildTransform: (file: TFile) => (data: string) => string,
): Promise<CoreWriteResult> {
	const file = app.vault.getFileByPath(request.path);
	if (!file) throw notFoundError(request.path);

	if (await isFileOpenAndDirty(app, file)) {
		// Tell the user an assistant tried to change the note they are editing so
		// they can pause (or keep typing). The MCP client sees CONFLICT and retries
		// after re-reading the merged state — never blowing away in-progress typing.
		new Notice(`Kado wanted to modify ${file.basename} — pause typing to let the assistant through, or keep going and it will retry`, 8000);
		throw conflictEditorError(request.path);
	}

	const transform = buildTransform(file); // may throw NOT_FOUND fail-fast before any write
	await app.vault.process(file, transform);

	const refreshed = app.vault.getFileByPath(request.path);
	const stat = refreshed?.stat ?? file.stat;
	return {path: request.path, created: stat.ctime, modified: stat.mtime};
}

/**
 * Applies a partial write to an existing note. Heading spans are resolved exactly
 * once (after the dirty-editor guard, before vault.process) so a missing heading
 * fails fast as NOT_FOUND.
 */
async function applyPartialWrite(app: App, request: CoreWriteRequest): Promise<CoreWriteResult> {
	const partial = request.notePartial!;
	const content = request.content;
	if (typeof content !== 'string') {
		throw new NoteAdapterError({
			code: 'VALIDATION_ERROR',
			message: 'Partial note writes require string content (the markdown fragment to add or use as replacement).',
		});
	}

	return writeViaProcess(app, request, (file) => {
		let span: SectionSpan | null = null;
		if (partial.mode === 'insertUnderHeading' || partial.mode === 'replaceSection') {
			const headings = app.metadataCache.getFileCache(file)?.headings ?? [];
			span = resolveSectionOrThrow(headings, toHeadingTarget(partial));
		}
		return (data) => computeNewBody(data, partial, content, span);
	});
}

async function updateNote(app: App, request: CoreWriteRequest): Promise<CoreWriteResult> {
	const newContent = request.content as string;
	return writeViaProcess(app, request, () => () => newContent);
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
