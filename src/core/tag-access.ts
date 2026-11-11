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

/** True when the global scope or the key defines at least one tag rule. */
export function hasTagRules(config: KadoConfig, key: ApiKeyConfig): boolean {
	return collectRules(config, key).some((r) => r.allow.length > 0 || r.deny.length > 0);
}

/** True for data types that live inside a markdown note and are therefore subject to tag rules. */
export function isTagGovernedDataType(operation: string): boolean {
	return operation !== 'file';
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
	const rules = collectRules(config, key);
	if (!rules.some((r) => r.allow.length > 0 || r.deny.length > 0)) return {allowed: true};
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
