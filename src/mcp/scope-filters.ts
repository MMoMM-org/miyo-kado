/**
 * Result-disclosure and scope helpers for the MCP tool layer: which result
 * items a key may see (read permission + tag rules) and the scope hints
 * injected into search requests. Split out of tools.ts (#135).
 */

import type {CoreSearchItem, KadoConfig, ApiKeyConfig, OpenNoteDescriptor, NoteTagSource} from '../types/canonical';
import {dirCouldContainMatches} from '../core/glob-match';
import {computeSearchTagScope} from '../core/tag-access';
import {createReadablePredicate} from './tag-policy';

/**
 * Returns true when the key may READ the file at `path` (global ∩ key, most
 * specific entry wins — see canReadPath) AND, for markdown notes, the note passes
 * the key's tag rules (#81, cached tags; unindexed notes fail closed). Shared
 * result-disclosure predicate for search, graph, graph-audit and open-notes. A
 * glob match alone is not enough: a matching entry may still disable read.
 */
export function isPathPermittedForKey(path: string, key: ApiKeyConfig, config: KadoConfig, tagSource?: NoteTagSource): boolean {
	return createReadablePredicate(key, config, tagSource)(path);
}

/** Filters search result items to only include paths within the key's permitted scope. */
export function filterResultsByScope(items: CoreSearchItem[], keyId: string, config: KadoConfig, tagSource?: NoteTagSource): CoreSearchItem[] {
	const key = config.apiKeys.find((k) => k.id === keyId);
	if (!key) return [];
	const readable = createReadablePredicate(key, config, tagSource);

	return items.filter((item) => {
		if (item.type === 'folder') {
			const inGlobal = isFolderInScope(item.path, config.security.listMode, config.security.paths.map((p) => p.path));
			const inKey = isFolderInScope(item.path, key.listMode, key.paths.map((p) => p.path));
			return inGlobal && inKey;
		}
		return readable(item.path);
	});
}

/**
 * Returns true when a folder path is permitted by a whitelist/blacklist scope.
 * Whitelist: at least one pattern could match a child of this folder.
 * Blacklist: NO pattern could match a child of this folder (otherwise the folder
 *   would leak the existence of blacklisted descendants).
 */
function isFolderInScope(folderPath: string, listMode: string, patterns: string[]): boolean {
	const prefix = folderPath.endsWith('/') ? folderPath : folderPath + '/';
	const couldMatchChild = patterns.some((p) => dirCouldContainMatches(p, prefix));
	return listMode === 'whitelist' ? couldMatchChild : !couldMatchChild;
}

/**
 * Returns the intersection of global and key path patterns that a file must match.
 * For whitelists, a file must match at least one pattern from each list.
 * Used to pre-filter files in scope-aware operations like listTags.
 */
export function computeScopePatterns(keyId: string, config: KadoConfig): string[] | undefined {
	const key = config.apiKeys.find((k) => k.id === keyId);
	if (!key) return [];

	// For whitelist scopes, the effective patterns are the key's own paths
	// (a file must match both global AND key patterns — the key's patterns
	// are always a subset of or equal to the global patterns in practice).
	if (key.listMode === 'whitelist') {
		return key.paths.map((p) => p.path);
	}

	// For blacklist keys, use the global whitelist patterns if global is whitelist
	if (config.security.listMode === 'whitelist') {
		return config.security.paths.map((p) => p.path);
	}

	// Both blacklist — pattern-based inclusion filtering not possible;
	// return undefined to skip adapter-level filtering (gates still enforce access).
	return undefined;
}

/**
 * Returns the effective tag patterns a key may use for tag-based operations:
 * global ∩ key search tags plus the "Only notes tagged" rules (#81) — see
 * computeSearchTagScope. Returns [] for an unknown key or an empty scope (no access).
 */
export function computeAllowedTags(keyId: string, config: KadoConfig): string[] | undefined {
	const key = config.apiKeys.find((k) => k.id === keyId);
	if (!key) return [];
	return computeSearchTagScope(config, key);
}

/**
 * Prunes open-note descriptors to only those matching the scope kind from the feature gate.
 * 'allow-active-only' keeps only active notes; 'allow-other-only' keeps only non-active;
 * 'allow-both' keeps all.
 */
export function pruneToScopeKind(
	notes: OpenNoteDescriptor[],
	kind: 'allow-active-only' | 'allow-other-only' | 'allow-both',
): OpenNoteDescriptor[] {
	if (kind === 'allow-active-only') return notes.filter((n) => n.active);
	if (kind === 'allow-other-only') return notes.filter((n) => !n.active);
	return notes;
}

/**
 * Filters open-note descriptors by path ACL (global AND key whitelist/blacklist).
 * Silently drops any descriptor whose path is not permitted — ADR-4 privacy invariant.
 * Delegates to isPathPermittedForKey to share glob-matching logic with filterResultsByScope.
 */
export function filterDescriptorsByAcl(notes: OpenNoteDescriptor[], key: ApiKeyConfig, config: KadoConfig, tagSource?: NoteTagSource): OpenNoteDescriptor[] {
	const readable = createReadablePredicate(key, config, tagSource);
	return notes.filter((note) => readable(note.path));
}
