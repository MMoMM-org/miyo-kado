/**
 * SearchAdapter — Obsidian Interface layer adapter for search operations.
 *
 * Implements SearchAdapter by delegating to Obsidian's vault and metadataCache
 * APIs. Supports six operations: listDir, byTag, byName, listTags, byContent,
 * byFrontmatter. Pagination uses a base64-encoded offset cursor.
 */

import type {App, TFile} from 'obsidian';
import type {SearchAdapter} from '../core/operation-router';
import type {CoreSearchRequest, CoreSearchResult, CoreSearchItem, CoreError} from '../types/canonical';
import {matchGlob} from '../core/glob-match';
import {normalizeTag, matchTag} from '../core/tag-utils';

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

function normalizeDir(path: string): string {
	if (path === '' || path === '/') return '';
	return path.endsWith('/') ? path : path + '/';
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

/** Filters search result items to only include paths matching at least one scope pattern. */
function filterItemsByScope(items: CoreSearchItem[], patterns: string[]): CoreSearchItem[] {
	if (patterns.length === 0) return [];
	return items.filter((item) => patterns.some((p) => matchGlob(p, item.path)));
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

function requireQuery(request: CoreSearchRequest, operation: string): CoreError | null {
	if (!request.query || request.query.trim() === '') {
		return {code: 'VALIDATION_ERROR', message: `${operation} requires a non-empty query`};
	}
	return null;
}

// -----------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------

function listDir(app: App, request: CoreSearchRequest): CoreSearchItem[] {
	const prefix = normalizeDir(request.path ?? '');
	return app.vault.getFiles().filter((f) => f.path.startsWith(prefix)).map(mapFileToItem);
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
		return app.vault.getMarkdownFiles().filter((f) => {
			const cache = app.metadataCache.getFileCache(f);
			const tags = cache?.tags?.filter((t) => re.test(t.tag)) ?? [];
			// If allowed tags are set, further restrict to permitted tags
			if (allowed !== undefined) {
				return tags.some((t) => isTagPermitted(t.tag, allowed));
			}
			return tags.length > 0;
		}).map(mapFileToItem);
	}
	return app.vault.getMarkdownFiles().filter((f) => {
		const cache = app.metadataCache.getFileCache(f);
		return cache?.tags?.some((t) => t.tag === query) ?? false;
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
	const prefix = request.path ?? '';
	// Apply scope filtering before reading file contents to avoid reading out-of-scope files.
	// scopePatterns is set by the search handler when the key has whitelist-based scoping.
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
		return String(fm[key]).toLowerCase() === value;
	}).map(mapFileToItem);
}

/**
 * Lists tags, scoped by both file paths and tag permissions.
 * - scopePatterns: only count tags from files whose path matches
 * - allowedTags: only include tags the key has permission for
 */
function listTags(app: App, scopePatterns?: string[], allowedTags?: string[]): CoreSearchItem[] {
	// No tag permissions → no tag access
	if (allowedTags !== undefined && allowedTags.length === 0) return [];

	const counts = new Map<string, number>();
	for (const file of app.vault.getMarkdownFiles()) {
		if (scopePatterns !== undefined) {
			if (scopePatterns.length === 0 || !fileInScope(file, scopePatterns)) continue;
		}
		const cache = app.metadataCache.getFileCache(file);
		if (!cache?.tags) continue;
		for (const {tag} of cache.tags) {
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
// Public API
// -----------------------------------------------------------------------

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
				case 'listDir':
					items = listDir(app, request);
					break;
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
					items = listTags(app, request.scopePatterns, request.allowedTags);
					break;
				case 'byContent':
					items = await byContent(app, request);
					break;
				case 'byFrontmatter':
					items = byFrontmatter(app, request);
					break;
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
