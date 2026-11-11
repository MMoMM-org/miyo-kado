/**
 * Tag-policy glue for the MCP tools (#81) — connects the pure tag access policy
 * (src/core/tag-access.ts) to the tool handlers.
 *
 * Exists to keep tools.ts focused on request handling: it resolves note tags via
 * the NoteTagSource port, redacts denial reasons for clients, and builds the
 * per-request result-disclosure predicate (read permission + tag rules) with the
 * rules compiled once instead of per vault file.
 */

import type {ApiKeyConfig, CoreWriteRequest, GateResult, KadoConfig, NoteTagSource} from '../types/canonical';
import {canReadPath} from '../core/gates/datatype-permission';
import {compileTagRules, evaluateCompiledTagAccess, isMarkdownPath, isTagGovernedDataType, TAG_ACCESS_GATE} from '../core/tag-access';
import {kadoLog, truncateKeyId} from '../core/logger';

/**
 * Client-facing tag-rule denials. Deliberately identical for every reason: the
 * detailed reason names a hidden note's tags, its path, or whether it exists at
 * all, none of which the key may learn. The detail goes to the debug log (and
 * the owner-facing Permission Test); the audit log records gate `tag-access`.
 */
export const TAG_DENIAL_MESSAGE = 'Access denied by tag rules.';
export const FOLDER_TAG_DENIAL_MESSAGE = 'Rename blocked: the folder contains notes this key may not access (tag rules).';

/** Replaces a tag-rule denial's detailed reason with `message`, logging the detail for the vault owner. */
function redactTagDenial(result: GateResult, message: string, keyId: string, path: string): GateResult {
	if (result.allowed) return result;
	kadoLog('tag rule denied', {key: truncateKeyId(keyId), path, reason: result.error.message});
	return {allowed: false, error: {...result.error, message}};
}

/**
 * Tag access policy for a single-note operation, run after the gate chain
 * allowed it. With `newContent` (note creation) the tags of the content about to
 * be written are checked; otherwise the note's CURRENT tags, read from its file
 * content. Non-markdown data types and keys without tag rules pass untouched.
 */
export async function evaluateNoteTagAccess(
	keyId: string,
	config: KadoConfig,
	tagSource: NoteTagSource | undefined,
	path: string,
	operation: string,
	newContent?: string,
): Promise<GateResult> {
	const key = config.apiKeys.find((k) => k.id === keyId);
	if (!key || !isTagGovernedDataType(operation)) return {allowed: true};
	const rules = compileTagRules(config, key);
	if (rules === null) return {allowed: true};
	let tags: string[] | null = null;
	if (tagSource) {
		tags = newContent !== undefined ? tagSource.tagsOfContent(newContent) : await tagSource.readTags(path);
	}
	return redactTagDenial(evaluateCompiledTagAccess(tags, rules), TAG_DENIAL_MESSAGE, keyId, path);
}

/**
 * Tag access policy for a folder rename: the rename moves every descendant, so
 * each markdown note in the tree must pass the key's tag rules. Uses cached tags
 * (a whole tree; unindexed notes fail closed). A tree that cannot be resolved
 * (`null`) is denied while tag rules exist — the descendants cannot be checked.
 */
export function evaluateFolderTagAccess(
	keyId: string,
	config: KadoConfig,
	tagSource: NoteTagSource | undefined,
	treePaths: string[] | null,
): GateResult {
	const key = config.apiKeys.find((k) => k.id === keyId);
	if (!key) return {allowed: true};
	const rules = compileTagRules(config, key);
	if (rules === null) return {allowed: true};
	if (treePaths === null) {
		return {allowed: false, error: {code: 'FORBIDDEN', message: FOLDER_TAG_DENIAL_MESSAGE, gate: TAG_ACCESS_GATE}};
	}
	for (const path of treePaths) {
		if (!isMarkdownPath(path)) continue;
		const result = evaluateCompiledTagAccess(tagSource?.cachedTags(path) ?? null, rules);
		if (!result.allowed) return redactTagDenial(result, FOLDER_TAG_DENIAL_MESSAGE, keyId, path);
	}
	return {allowed: true};
}

/** True when a write creates a new markdown note — the only path that brings a note into existence. */
export function isNoteCreate(request: CoreWriteRequest, getFileMtime: (path: string) => number | undefined): boolean {
	return request.operation === 'note'
		&& request.notePartial === undefined
		&& request.expectedModified === undefined
		&& getFileMtime(request.path) === undefined;
}

/**
 * Builds the result-disclosure predicate for one request: the key may READ the
 * path (global ∩ key, most specific entry wins — see canReadPath) AND, for
 * markdown notes, the note passes the tag rules (cached tags; unindexed notes
 * fail closed). Rules are compiled once here, not per path.
 */
export function createReadablePredicate(
	key: ApiKeyConfig,
	config: KadoConfig,
	tagSource: NoteTagSource | undefined,
): (path: string) => boolean {
	const rules = compileTagRules(config, key);
	return (path) => {
		if (!canReadPath(path, config, key)) return false;
		if (rules === null || !isMarkdownPath(path)) return true;
		return evaluateCompiledTagAccess(tagSource?.cachedTags(path) ?? null, rules).allowed;
	};
}
