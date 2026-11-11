/**
 * Tag access policy (#81) — `tagAllow` / `tagDeny` as a pure filter over path permissions.
 *
 * Exists as a policy function rather than a 6th gate in the permission chain:
 * gates receive a request copy and the rename/folder/graph policies rebuild
 * requests, so note tags attached to a request would be dropped. The tool layer
 * resolves a note's tags and calls evaluateTagAccess after the chain allows.
 *
 * Semantics:
 *   - Tag rules only remove access; CRUD flags stay on path entries.
 *   - tagAllow (any-of): when non-empty, the note must carry ≥1 matching tag.
 *   - tagDeny (any-of): a note carrying any matching tag is denied. Deny wins.
 *   - Global and key rules are evaluated independently; both must pass.
 *   - Unknown tags (null — not indexed / unreadable) are denied whenever any rule exists.
 *   - Only markdown data types are governed; `file` stays path-only.
 *
 * ZERO imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {ApiKeyConfig, GateResult, KadoConfig} from '../types/canonical';
import {matchTag, normalizeTag} from './tag-utils';
import {dedupePreservingOrder} from './note-tags';

/** Gate label reported on tag-rule denials (audit log, status bar, Permission Test). */
export const TAG_ACCESS_GATE = 'tag-access';

/** A scope's tag rules with normalized, non-empty patterns. */
interface TagRules {
	scope: 'global' | 'key';
	allow: string[];
	deny: string[];
}

function normalizeList(raw: string[] | undefined): string[] {
	return (raw ?? []).map(normalizeTag).filter((t): t is string => t !== null);
}

function collectRules(config: KadoConfig, key: ApiKeyConfig): TagRules[] {
	return [
		{scope: 'global', allow: normalizeList(config.security.tagAllow), deny: normalizeList(config.security.tagDeny)},
		{scope: 'key', allow: normalizeList(key.tagAllow), deny: normalizeList(key.tagDeny)},
	];
}

/**
 * The tag patterns a key may use for tag-based search (byTag, listTags,
 * filter.tags): the key's search tags permitted by a global search-tag pattern
 * (both lists must be non-empty), plus every "Only notes tagged" pattern of the
 * global scope and the key. Adding tagAllow is safe — result filters still apply
 * the tag rules — and spares users from entering the same tag twice.
 */
export function computeSearchTagScope(config: KadoConfig, key: ApiKeyConfig): string[] {
	const globalTags = config.security.tags ?? [];
	const keyTags = key.tags ?? [];
	const searchTags = globalTags.length === 0 || keyTags.length === 0
		? []
		: keyTags.filter((kt) => globalTags.some((gt) => matchTag(kt, gt)));
	return dedupePreservingOrder([...searchTags, ...normalizeList(config.security.tagAllow), ...normalizeList(key.tagAllow)]);
}

/**
 * A key's normalized tag rules (global + key), compiled once so per-file result
 * filters do not re-normalize the configured lists for every vault file.
 */
export interface CompiledTagRules {
	readonly scopes: readonly TagRules[];
}

/** Compiles the tag rules of the global scope and `key`; null when neither defines any rule. */
export function compileTagRules(config: KadoConfig, key: ApiKeyConfig): CompiledTagRules | null {
	const scopes = collectRules(config, key);
	return scopes.some((r) => r.allow.length > 0 || r.deny.length > 0) ? {scopes} : null;
}

/** True when the global scope or the key defines at least one tag rule. */
export function hasTagRules(config: KadoConfig, key: ApiKeyConfig): boolean {
	return compileTagRules(config, key) !== null;
}

/** Operations that act on (part of) a markdown note and are therefore subject to tag rules. */
const TAG_GOVERNED_OPERATIONS: ReadonlySet<string> = new Set(['note', 'frontmatter', 'dataview-inline-field', 'tags']);

/**
 * True for data types that live inside a markdown note. `file` (attachments)
 * and `folder` (empty-folder delete; folder rename is checked per descendant)
 * are not governed.
 */
export function isTagGovernedDataType(operation: string): boolean {
	return TAG_GOVERNED_OPERATIONS.has(operation);
}

function denied(message: string): GateResult {
	return {allowed: false, error: {code: 'FORBIDDEN', message, gate: TAG_ACCESS_GATE}};
}

/**
 * Evaluates the tag rules for a note carrying `tags` (without or with `#`).
 * `null` means the tags are unknown; that is denied whenever any rule exists.
 * Deny rules are checked across both scopes before allow rules, so the reported
 * reason names a matching deny rule whenever one applies.
 */
export function evaluateTagAccess(tags: string[] | null, config: KadoConfig, key: ApiKeyConfig): GateResult {
	return evaluateCompiledTagAccess(tags, compileTagRules(config, key));
}

/** evaluateTagAccess over pre-compiled rules (null = no rules → allowed). */
export function evaluateCompiledTagAccess(tags: string[] | null, compiled: CompiledTagRules | null): GateResult {
	if (compiled === null) return {allowed: true};
	const rules = compiled.scopes;
	if (tags === null) {
		return denied('Note tags could not be determined; tag rules deny access until the note is readable/indexed.');
	}

	const noteTags = tags.map(normalizeTag).filter((t): t is string => t !== null);

	for (const rule of rules) {
		for (const pattern of rule.deny) {
			if (noteTags.some((t) => matchTag(t, pattern))) {
				return denied(`Denied by tag rule #${pattern} (${rule.scope}).`);
			}
		}
	}

	for (const rule of rules) {
		if (rule.allow.length === 0) continue;
		const matched = noteTags.some((t) => rule.allow.some((pattern) => matchTag(t, pattern)));
		if (!matched) {
			const list = rule.allow.map((p) => `#${p}`).join(', ');
			return denied(`Note carries none of the tags in "Only notes tagged" (${list}) (${rule.scope}).`);
		}
	}

	return {allowed: true};
}
