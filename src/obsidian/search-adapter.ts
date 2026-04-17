/**
 * SearchAdapter — Obsidian Interface layer adapter for search operations.
 *
 * Implements SearchAdapter by delegating to Obsidian's vault and metadataCache
 * APIs. Supports six operations: listDir, byTag, byName, listTags, byContent,
 * byFrontmatter. Pagination uses a base64-encoded offset cursor.
 */

import {TFile, TFolder} from 'obsidian';
import type {App} from 'obsidian';
import type {SearchAdapter} from '../core/operation-router';
import type {CoreSearchRequest, CoreSearchResult, CoreSearchItem, CoreError, SearchFilter} from '../types/canonical';
import {matchGlob, dirCouldContainMatches, pathMatchesPatterns} from '../core/glob-match';
import {normalizeTag, matchTag, isWildcardTag} from '../core/tag-utils';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const BATCH_SIZE = 20;

type SearchResult = CoreSearchResult | CoreError;

function encodeOffset(offset: number): string {
	return btoa(String(offset));
}

function decodeOffset(cursor: string): number {
	const parsed = parseInt(atob(cursor), 10);
	return isNaN(parsed) ? 0 : parsed;
}

function mapFileToItem(file: TFile): CoreSearchItem {
	return {
		path: file.path,
		name: file.name,
		created: file.stat.ctime,
		modified: file.stat.mtime,
		size: file.stat.size,
	};
}

function paginate(items: CoreSearchItem[], cursor: string | undefined, limit: number): CoreSearchResult {
	const offset = cursor ? decodeOffset(cursor) : 0;
	const page = items.slice(offset, offset + limit);
	const nextOffset = offset + limit;
	return {
		items: page,
		total: items.length,
		cursor: nextOffset < items.length ? encodeOffset(nextOffset) : undefined,
	};
}


function isGlobQuery(query: string): boolean {
	return query.includes('*') || query.includes('?');
}

/**
 * Converts a user-facing search glob into a RegExp.
 *
 * Intentional divergence from matchGlob() in glob-match.ts:
 * - Here `*` matches across slashes (any characters including '/') because
 *   users expect "#project/*" to match "#project/alpha" in tag queries.
 * - In permission globs, `*` must NOT cross slash boundaries so that
 *   "Calendar/*" cannot silently permit "Calendar/sub/secret.md".
 */
function globQueryToRegExp(pattern: string, anchored = false): RegExp {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*')
		.replace(/\?/g, '.');
	const src = anchored ? `^${escaped}$` : escaped;
	return new RegExp(src, 'i');
}

/** Returns true when the file's path matches at least one scope pattern. */
function fileInScope(file: TFile, patterns: string[]): boolean {
	if (patterns.length === 0) return false;
	return patterns.some((p) => matchGlob(p, file.path));
}

/** Returns true when at least one scope pattern could match a child of the folder. */
function folderInScope(folderPath: string, patterns: string[]): boolean {
	if (patterns.length === 0) return false;
	// dirCouldContainMatches expects a trailing slash on the directory path
	const dirPath = folderPath.endsWith('/') ? folderPath : folderPath + '/';
	return patterns.some((p) => dirCouldContainMatches(p, dirPath));
}

/** Filters search result items to only include paths matching at least one scope pattern. */
function filterItemsByScope(items: CoreSearchItem[], patterns: string[]): CoreSearchItem[] {
	if (patterns.length === 0) return [];
	return items.filter((item) => {
		if (item.type === 'folder') return folderInScope(item.path, patterns);
		return patterns.some((p) => matchGlob(p, item.path));
	});
}

/**
 * Returns true when the given tag (with '#' prefix) is permitted by the allowedTags list.
 * Tags in config are stored without '#'; Obsidian cache stores them with '#'.
 */
function isTagPermitted(tag: string, allowedTags: string[]): boolean {
	const normalized = normalizeTag(tag);
	if (normalized === null) return false;
	return allowedTags.some((pattern) => matchTag(normalized, pattern));
}

/**
 * Returns true when a search glob could potentially match at least one allowed tag.
 *
 * For each allowed pattern we create a representative tag and test it against
 * the query regex. If none could match, the client has no permission for any
 * tag the glob could return → FORBIDDEN rather than misleading empty results.
 */
function canGlobMatchAllowedTag(queryRegex: RegExp, allowedTags: string[]): boolean {
	return allowedTags.some((pattern) => {
		if (pattern === '*') return true;
		// Create representative tags that would be matched by this pattern.
		// Wildcard 'foo/*' → '#foo/_rep'; bare 'foo' → '#foo' and '#foo/_rep'
		const representative = isWildcardTag(pattern)
			? `#${pattern.slice(0, -1)}_rep`  // 'foo/*' → '#foo/_rep'
			: `#${pattern}`;
		if (!isWildcardTag(pattern)) {
			// Bare name also permits sub-tags, so test a sub-tag representative
			return queryRegex.test(representative) || queryRegex.test(`#${pattern}/_rep`);
		}
		return queryRegex.test(representative);
	});
}

/**
 * Merges inline tags (`cache.tags`) and frontmatter tags (`cache.frontmatter?.tags`)
 * into a single deduplicated list of '#'-prefixed tag strings.
 */
function getFileTags(cache: {tags?: {tag: string}[]; frontmatter?: Record<string, unknown>} | null): string[] {
	if (!cache) return [];
	const seen = new Set<string>();
	if (cache.tags) {
		for (const {tag} of cache.tags) seen.add(tag);
	}
	const fmTags = cache.frontmatter?.tags;
	if (Array.isArray(fmTags)) {
		for (const raw of fmTags) {
			if (typeof raw !== 'string') continue;
			const tag = raw.startsWith('#') ? raw : `#${raw}`;
			seen.add(tag);
		}
	}
	return Array.from(seen);
}

function requireQuery(request: CoreSearchRequest, operation: string): CoreError | null {
	if (!request.query || request.query.trim() === '') {
		return {code: 'VALIDATION_ERROR', message: `${operation} requires a non-empty query`};
	}
	return null;
}

// -----------------------------------------------------------------------
// listDir walk helpers
// -----------------------------------------------------------------------

type ResolveResult =
	| {kind: 'folder'; folder: TFolder}
	| {kind: 'file'}
	| {kind: 'missing'};

/** Returns true if any path segment starts with '.', indicating a hidden path. */
function hasDotSegment(path: string): boolean {
	return path.split('/').some((seg) => seg.startsWith('.'));
}

/**
 * Resolves a path string to a TFolder, TFile, or missing result.
 * undefined path resolves to vault root.
 * Dot-prefixed path segments are treated as missing (hidden).
 */
function resolveFolder(app: App, path: string | undefined): ResolveResult {
	if (path === undefined) return {kind: 'folder', folder: app.vault.getRoot()};
	if (hasDotSegment(path)) return {kind: 'missing'};
	const clean = path.replace(/\/$/, '');
	const target = app.vault.getAbstractFileByPath(clean);
	if (target === null) return {kind: 'missing'};
	if (target instanceof TFolder) return {kind: 'folder', folder: target};
	return {kind: 'file'};
}

/** Maps a TFolder to a CoreSearchItem with folder metadata. */
function mapFolderToItem(folder: TFolder, childCount: number): CoreSearchItem {
	return {
		path: folder.path,
		name: folder.name,
		type: 'folder',
		created: 0,
		modified: 0,
		size: 0,
		childCount,
	};
}

/**
 * Counts children of a folder whose name does NOT start with '.' and are in scope.
 * Hidden children (dot-prefixed) are always excluded.
 * When scope is provided, folders and files outside scope are excluded.
 */
function visibleChildCount(folder: TFolder, scope?: string[]): number {
	let count = 0;
	for (const child of folder.children) {
		if (child.name.startsWith('.')) continue;
		if (child instanceof TFolder) {
			if (scope && !folderInScope(child.path, scope)) continue;
			count++;
		} else if (child instanceof TFile) {
			if (scope && !pathMatchesPatterns(child.path, scope)) continue;
			count++;
		}
	}
	return count;
}

/**
 * Recursively walks a TFolder, collecting CoreSearchItems into out.
 * Stops descending when currentDepth + 1 >= maxDepth (depth-bounded).
 * Unlimited when maxDepth is undefined.
 * When scope is provided, both out-of-scope folders and files are skipped at walk time.
 */
function walk(
	folder: TFolder,
	currentDepth: number,
	maxDepth: number | undefined,
	scope: string[] | undefined,
	out: CoreSearchItem[],
): void {
	for (const child of folder.children) {
		if (child.name.startsWith('.')) continue;
		if (child instanceof TFolder) {
			if (scope && !folderInScope(child.path, scope)) continue;
			out.push(mapFolderToItem(child, visibleChildCount(child, scope)));
			const shouldRecurse = maxDepth === undefined || currentDepth + 1 < maxDepth;
			if (shouldRecurse) walk(child, currentDepth + 1, maxDepth, scope, out);
		} else if (child instanceof TFile) {
			if (scope && !pathMatchesPatterns(child.path, scope)) continue;
			out.push({
				path: child.path,
				name: child.name,
				type: 'file',
				created: child.stat.ctime,
				modified: child.stat.mtime,
				size: child.stat.size,
			});
		}
	}
}

/** Sorts CoreSearchItems folders-first, then by path with locale variant sensitivity. */
function compareListDirItems(a: CoreSearchItem, b: CoreSearchItem): number {
	const aIsFolder = a.type === 'folder';
	const bIsFolder = b.type === 'folder';
	if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
	return a.path.localeCompare(b.path, undefined, {sensitivity: 'variant'});
}

// -----------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------

function listDir(app: App, request: CoreSearchRequest): CoreSearchItem[] | CoreError {
	const resolved = resolveFolder(app, request.path);
	if (resolved.kind === 'missing') {
		return {code: 'NOT_FOUND', message: `Path not found: ${request.path ?? '/'}`};
	}
	if (resolved.kind === 'file') {
		return {
			code: 'VALIDATION_ERROR',
			message: `listDir target must be a folder, got file: ${request.path}`,
		};
	}
	const items: CoreSearchItem[] = [];
	walk(resolved.folder, 0, request.depth, request.scopePatterns, items);
	items.sort(compareListDirItems);
	return items;
}

function byTag(app: App, request: CoreSearchRequest): CoreSearchItem[] | CoreError {
	// Normalize the query once: Obsidian caches tags with '#' prefix, so ensure
	// the query has it. The permission check strips '#' because allowedTags are
	// stored without it.
	const rawQuery = request.query ?? '';
	const query = rawQuery.startsWith('#') || isGlobQuery(rawQuery) ? rawQuery : `#${rawQuery}`;
	const allowed = request.allowedTags;

	// If tag permissions are set, validate the queried tag is permitted
	if (allowed !== undefined && allowed.length === 0) {
		return {code: 'FORBIDDEN', message: 'Access denied'};
	}
	if (allowed !== undefined && !isGlobQuery(query)) {
		const normalized = normalizeTag(query);
		if (normalized !== null && !allowed.some((p) => matchTag(normalized, p))) {
			return {code: 'FORBIDDEN', message: 'Access denied'};
		}
	}

	if (isGlobQuery(query)) {
		const re = globQueryToRegExp(query, true);
		// Pre-check: can the glob structurally match any allowed tag?
		// If not, the client has no permission for tags in this namespace.
		if (allowed !== undefined && !canGlobMatchAllowedTag(re, allowed)) {
			return {code: 'FORBIDDEN', message: 'Access denied'};
		}
		return app.vault.getMarkdownFiles().filter((f) => {
			const cache = app.metadataCache.getFileCache(f);
			const tags = getFileTags(cache).filter((t) => re.test(t));
			if (allowed !== undefined) {
				return tags.some((t) => isTagPermitted(t, allowed));
			}
			return tags.length > 0;
		}).map(mapFileToItem);
	}
	return app.vault.getMarkdownFiles().filter((f) => {
		const cache = app.metadataCache.getFileCache(f);
		return getFileTags(cache).some((t) => t === query);
	}).map(mapFileToItem);
}

function byName(app: App, request: CoreSearchRequest): CoreSearchItem[] {
	const query = (request.query ?? '').toLowerCase();
	if (isGlobQuery(request.query ?? '')) {
		const re = globQueryToRegExp(request.query ?? '');
		return app.vault.getFiles().filter((f) => re.test(f.name)).map(mapFileToItem);
	}
	return app.vault.getFiles().filter((f) => f.name.toLowerCase().includes(query)).map(mapFileToItem);
}

async function byContent(app: App, request: CoreSearchRequest): Promise<CoreSearchItem[]> {
	const query = (request.query ?? '').toLowerCase();
	const prefix = request.filter?.path ?? '';
	const allFiles = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
	const files = request.scopePatterns !== undefined
		? allFiles.filter((f) => fileInScope(f, request.scopePatterns!))
		: allFiles;
	const results: CoreSearchItem[] = [];
	for (let i = 0; i < files.length; i += BATCH_SIZE) {
		const batch = files.slice(i, i + BATCH_SIZE);
		const contents = await Promise.all(batch.map(f => app.vault.read(f)));
		for (let j = 0; j < batch.length; j++) {
			if ((contents[j] ?? '').toLowerCase().includes(query)) {
				results.push(mapFileToItem(batch[j]!));
			}
		}
	}
	return results;
}

function byFrontmatter(app: App, request: CoreSearchRequest): CoreSearchItem[] {
	const query = request.query ?? '';
	const eqIndex = query.indexOf('=');
	const key = eqIndex === -1 ? query : query.slice(0, eqIndex);
	const value = eqIndex === -1 ? null : query.slice(eqIndex + 1).toLowerCase();
	return app.vault.getMarkdownFiles().filter((f) => {
		const fm = app.metadataCache.getFileCache(f)?.frontmatter;
		if (!fm || !(key in fm)) return false;
		if (value === null) return true;
		return frontmatterValueMatches(fm[key], value);
	}).map(mapFileToItem);
}

/**
 * Match a frontmatter value (which may be scalar, array, or comma-separated string)
 * against a case-insensitive lowercase query value.
 *
 * Obsidian's metadataCache preserves the YAML representation:
 * - `tags: [a, b]` → string[] (inline array)
 * - `tags:\n  - a\n  - b` → string[] (list form)
 * - `tags: a, b` → string (comma-separated, per https://obsidian.md/help/tags)
 * - `status: active` → string (scalar)
 *
 * All three forms must match array-membership queries like `tags=finance`.
 */
function frontmatterValueMatches(fmValue: unknown, query: string): boolean {
	if (Array.isArray(fmValue)) {
		return fmValue.some((el) => String(el).toLowerCase() === query);
	}
	const str = String(fmValue).toLowerCase();
	if (str === query) return true;
	// Comma-separated fallback (Obsidian accepts `tags: a, b` as shorthand)
	if (str.includes(',')) {
		return str.split(',').some((part) => part.trim() === query);
	}
	return false;
}

// -----------------------------------------------------------------------
// Shared filter helpers (H1/H2 — single source of truth for filter logic)
// -----------------------------------------------------------------------

interface ParsedFrontmatterFilter {
	key: string;
	value: string | null;
}

function parseFrontmatterFilter(query: string): ParsedFrontmatterFilter {
	const eqIndex = query.indexOf('=');
	return {
		key: eqIndex === -1 ? query : query.slice(0, eqIndex),
		value: eqIndex === -1 ? null : query.slice(eqIndex + 1).toLowerCase(),
	};
}

function matchesFrontmatterFilter(fm: Record<string, unknown> | undefined, parsed: ParsedFrontmatterFilter): boolean {
	if (!fm || !Object.prototype.hasOwnProperty.call(fm, parsed.key)) return false;
	if (parsed.value === null) return true;
	return frontmatterValueMatches(fm[parsed.key], parsed.value);
}

function normalizeTagPatterns(patterns: string[]): string[] {
	return patterns.map((p) => p.startsWith('#') ? p.slice(1) : p);
}

function fileTagsMatchPatterns(fileTags: string[], normalizedPatterns: string[]): boolean {
	return fileTags.some((t) => {
		const normalized = normalizeTag(t);
		if (normalized === null) return false;
		return normalizedPatterns.some((p) => matchTag(normalized, p));
	});
}

/** Strips filter.tags patterns not permitted by allowedTags. Returns [] if all denied. */
function enforceTagPermissions(filterTags: string[], allowedTags: string[] | undefined): string[] {
	if (allowedTags === undefined) return filterTags;
	const normalized = normalizeTagPatterns(filterTags);
	return normalized.filter((p) => allowedTags.some((a) => matchTag(p, a)));
}

// -----------------------------------------------------------------------
// listTags
// -----------------------------------------------------------------------

/**
 * Lists tags, scoped by both file paths and tag permissions.
 * - scopePatterns: only count tags from files whose path matches
 * - allowedTags: only include tags the key has permission for
 * - filter: universal cross-operation filters (path prefix, tag filter, frontmatter filter)
 */
function listTags(app: App, scopePatterns?: string[], allowedTags?: string[], filter?: SearchFilter): CoreSearchItem[] {
	if (allowedTags !== undefined && allowedTags.length === 0) return [];

	const parsedFm = filter?.frontmatter ? parseFrontmatterFilter(filter.frontmatter) : undefined;
	const tagPatterns = filter?.tags
		? enforceTagPermissions(filter.tags, allowedTags)
		: undefined;
	if (tagPatterns !== undefined && tagPatterns.length === 0) return [];

	const counts = new Map<string, number>();
	for (const file of app.vault.getMarkdownFiles()) {
		if (scopePatterns !== undefined) {
			if (scopePatterns.length === 0 || !fileInScope(file, scopePatterns)) continue;
		}
		if (filter?.path && !file.path.startsWith(filter.path)) continue;
		const cache = app.metadataCache.getFileCache(file);
		if (parsedFm && !matchesFrontmatterFilter(cache?.frontmatter, parsedFm)) continue;
		const tags = getFileTags(cache);
		if (tags.length === 0) continue;
		if (tagPatterns && !fileTagsMatchPatterns(tags, tagPatterns)) continue;
		for (const tag of tags) {
			if (allowedTags !== undefined && !isTagPermitted(tag, allowedTags)) continue;
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return Array.from(counts.entries()).map(([tag, count]) => ({
		path: tag,
		name: tag,
		created: 0,
		modified: 0,
		size: count,
		tags: [tag],
	}));
}

// -----------------------------------------------------------------------
// Cross-operation filters (single-pass, no operation awareness — H3/H4)
// -----------------------------------------------------------------------

function applyFilters(items: CoreSearchItem[], filter: SearchFilter, app: App, allowedTags?: string[]): CoreSearchItem[] {
	const parsedFm = filter.frontmatter ? parseFrontmatterFilter(filter.frontmatter) : undefined;
	const tagPatterns = filter.tags
		? enforceTagPermissions(filter.tags, allowedTags)
		: undefined;
	if (tagPatterns !== undefined && tagPatterns.length === 0) return [];

	return items.filter((item) => {
		if (filter.path && !item.path.startsWith(filter.path)) return false;

		if (!tagPatterns && !parsedFm) return true;
		if (item.type === 'folder') return false;

		const file = app.vault.getAbstractFileByPath(item.path);
		if (!(file instanceof TFile)) return false;
		const cache = app.metadataCache.getFileCache(file);

		if (parsedFm && !matchesFrontmatterFilter(cache?.frontmatter, parsedFm)) return false;
		if (tagPatterns && !fileTagsMatchPatterns(getFileTags(cache), tagPatterns)) return false;

		return true;
	});
}

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

/**
 * Creates a SearchAdapter supporting six operations: listDir, byTag, byName, listTags, byContent, byFrontmatter.
 * @param app - The Obsidian App instance for vault and metadata access.
 */
export function createSearchAdapter(app: App): SearchAdapter {
	return {
		async search(request: CoreSearchRequest): Promise<SearchResult> {
			const limit = Math.min(request.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

			// Validate query for operations that require one
			if (request.operation !== 'listDir' && request.operation !== 'listTags') {
				const err = requireQuery(request, request.operation);
				if (err) return err;
			}

			let items: CoreSearchItem[];
			switch (request.operation) {
				case 'listDir': {
					const listResult = listDir(app, request);
					if ('code' in listResult) return listResult;
					items = listResult;
					break;
				}
				case 'byTag': {
					const tagResult = byTag(app, request);
					if ('code' in tagResult) return tagResult;
					items = tagResult;
					break;
				}
				case 'byName':
					items = byName(app, request);
					break;
				case 'listTags':
					items = listTags(app, request.scopePatterns, request.allowedTags, request.filter);
					break;
				case 'byContent':
					items = await byContent(app, request);
					break;
				case 'byFrontmatter':
					items = byFrontmatter(app, request);
					break;
			}

			if (request.filter && request.operation !== 'listTags') {
				const filter = request.operation === 'listDir'
					? {path: request.filter.path}
					: request.filter;
				if (filter.path || filter.tags || filter.frontmatter) {
					items = applyFilters(items, filter, app, request.allowedTags);
				}
			}

			// Apply scope filtering before pagination so total and cursor are accurate.
			// listTags is already pre-filtered at the file level inside listTags().
			if (request.scopePatterns !== undefined && request.operation !== 'listTags') {
				items = filterItemsByScope(items, request.scopePatterns);
			}

			return paginate(items, request.cursor, limit);
		},
	};
}
