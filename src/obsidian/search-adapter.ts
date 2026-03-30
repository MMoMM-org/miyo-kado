/**
 * SearchAdapter — Obsidian Interface layer adapter for search operations.
 *
 * Implements SearchAdapter by delegating to Obsidian's vault and metadataCache
 * APIs. Supports four operations: listDir, byTag, byName, listTags.
 * Pagination uses a base64-encoded offset cursor.
 */

import type {App, TFile} from 'obsidian';
import type {SearchAdapter} from '../core/operation-router';
import type {CoreSearchRequest, CoreSearchResult, CoreSearchItem} from '../types/canonical';

const DEFAULT_LIMIT = 50;

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

function listDir(app: App, request: CoreSearchRequest): CoreSearchItem[] {
	const prefix = request.path ?? '';
	return app.vault.getFiles().filter((f) => f.path.startsWith(prefix)).map(mapFileToItem);
}

function byTag(app: App, request: CoreSearchRequest): CoreSearchItem[] {
	const query = request.query ?? '';
	return app.vault.getMarkdownFiles().filter((f) => {
		const cache = app.metadataCache.getFileCache(f);
		return cache?.tags?.some((t) => t.tag === query) ?? false;
	}).map(mapFileToItem);
}

function byName(app: App, request: CoreSearchRequest): CoreSearchItem[] {
	const query = (request.query ?? '').toLowerCase();
	return app.vault.getFiles().filter((f) => f.name.toLowerCase().includes(query)).map(mapFileToItem);
}

async function byContent(app: App, request: CoreSearchRequest): Promise<CoreSearchItem[]> {
	const query = (request.query ?? '').toLowerCase();
	const prefix = request.path ?? '';
	const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
	const results: CoreSearchItem[] = [];
	for (const file of files) {
		const content = await app.vault.read(file);
		if (content.toLowerCase().includes(query)) {
			results.push(mapFileToItem(file));
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

function listTags(app: App): CoreSearchItem[] {
	const counts = new Map<string, number>();
	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache?.tags) continue;
		for (const {tag} of cache.tags) {
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

export function createSearchAdapter(app: App): SearchAdapter {
	return {
		async search(request: CoreSearchRequest): Promise<CoreSearchResult> {
			const limit = request.limit ?? DEFAULT_LIMIT;
			let items: CoreSearchItem[];
			switch (request.operation) {
				case 'listDir':
					items = listDir(app, request);
					break;
				case 'byTag':
					items = byTag(app, request);
					break;
				case 'byName':
					items = byName(app, request);
					break;
				case 'listTags':
					items = listTags(app);
					break;
				case 'byContent':
					items = await byContent(app, request);
					break;
				case 'byFrontmatter':
					items = byFrontmatter(app, request);
					break;
			}
			return paginate(items, request.cursor, limit);
		},
	};
}
