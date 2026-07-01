/**
 * Dry-run permission evaluation — pure core behind the settings "Permission
 * Test" panel (issue #83).
 *
 * Answers "would key K be allowed to do OP on PATH?" by composing the SAME
 * permission chain the MCP tools use (evaluatePermissions for read/create/
 * update/delete/search, evaluateRenamePermissions for rename/move). Nothing is
 * duplicated, so the dry-run verdict can never drift from real tool behavior.
 *
 * It additionally reports a SECONDARY, independent tag-scope readout: whether an
 * optional tag falls within the key's effective (global ∩ key) tag scope. Tags
 * do NOT gate path access in the current model (they scope kado-search byTag) —
 * so this is informational for now, and forward-compatible with the planned
 * tag-deny feature (#81) where a tag will participate in the verdict itself.
 *
 * No imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {
	CoreDeleteRequest,
	CoreErrorCode,
	CoreReadRequest,
	CoreRenameRequest,
	CoreSearchRequest,
	CoreWriteRequest,
	GateResult,
	KadoConfig,
	PermissionGate,
	ReadDataType,
} from '../types/canonical';
import {evaluatePermissions} from './permission-chain';
import {evaluateRenamePermissions} from './rename-policy';
import {matchTag, normalizeTag} from './tag-utils';

/** High-level operations a dry-run can evaluate. `write` is split into create/update for CRUD precision. */
export type DryRunOperation = 'read' | 'create' | 'update' | 'delete' | 'rename' | 'search';

/** Result of the secondary tag-scope readout. */
export type TagScope = 'in-scope' | 'out-of-scope' | 'not-checked';

/** Inputs describing the operation to simulate. */
export interface DryRunInput {
	keyId: string;
	operation: DryRunOperation;
	/**
	 * Data type. Interpretation depends on operation (read accepts 'tags';
	 * delete/rename accept a narrower set — the UI restricts the choices).
	 * Ignored for search (search capability is note.read based).
	 */
	dataType: ReadDataType;
	/** Primary path — the target for read/create/update/delete, the source for rename. */
	path: string;
	/** Target path — only used for rename/move. */
	target?: string;
	/** Optional tag for the independent tag-scope readout. */
	tag?: string;
}

/** Outcome of a dry-run: the path verdict plus the secondary tag-scope readout. */
export interface DryRunResult {
	allowed: boolean;
	/** Deciding gate on denial (e.g. 'global-scope', 'datatype-permission'). */
	gate?: string;
	/** Error code on denial. */
	code?: CoreErrorCode;
	/** Human-readable outcome — the underlying gate message on denial. */
	reason: string;
	/** For rename operations: whether it resolved to an in-folder rename or a cross-folder move. */
	mode?: 'rename' | 'move';
	/** Independent readout: is `tag` within the key's effective tag scope. */
	tagScope: TagScope;
}

/**
 * Evaluates a dry-run against the real permission chain.
 * `gates` should be `createDefaultGateChain()` (or the plugin's live chain).
 */
export function runDryRun(input: DryRunInput, config: KadoConfig, gates: PermissionGate[]): DryRunResult {
	const {verdict, mode} = evaluatePathVerdict(input, config, gates);
	const tagScope = evaluateTagScope(input.tag, input.keyId, config);

	if (verdict.allowed) {
		return {
			allowed: true,
			reason: mode ? `Allowed — ${mode} permitted.` : 'Allowed — all gates passed.',
			mode,
			tagScope,
		};
	}

	return {
		allowed: false,
		gate: verdict.error.gate,
		code: verdict.error.code,
		reason: verdict.error.message,
		mode,
		tagScope,
	};
}

/** Builds the appropriate core request(s) for the operation and runs the chain. */
function evaluatePathVerdict(
	input: DryRunInput,
	config: KadoConfig,
	gates: PermissionGate[],
): {verdict: GateResult; mode?: 'rename' | 'move'} {
	const {keyId: apiKeyId, operation, dataType, path, target} = input;

	switch (operation) {
		case 'read': {
			const req: CoreReadRequest = {apiKeyId, operation: dataType, path};
			return {verdict: evaluatePermissions(req, config, gates)};
		}
		case 'create': {
			// No expectedModified → inferCrudAction = 'create'.
			const req: CoreWriteRequest = {apiKeyId, operation: dataType as CoreWriteRequest['operation'], path, content: ''};
			return {verdict: evaluatePermissions(req, config, gates)};
		}
		case 'update': {
			// expectedModified present → inferCrudAction = 'update'.
			const req: CoreWriteRequest = {
				apiKeyId, operation: dataType as CoreWriteRequest['operation'], path, content: '', expectedModified: 0,
			};
			return {verdict: evaluatePermissions(req, config, gates)};
		}
		case 'delete': {
			const req: CoreDeleteRequest = {
				kind: 'delete', apiKeyId, operation: dataType as CoreDeleteRequest['operation'], path, expectedModified: 0,
			};
			return {verdict: evaluatePermissions(req, config, gates)};
		}
		case 'rename': {
			const req: CoreRenameRequest = {
				kind: 'rename', apiKeyId, operation: dataType as CoreRenameRequest['operation'],
				source: path, target: target ?? path, expectedModified: 0,
			};
			const {result, mode} = evaluateRenamePermissions(req, config, gates);
			return {verdict: result, mode};
		}
		case 'search': {
			// Pathless capability check — the gate derives search access from note.read
			// across the effective scope. Omitting `path` takes the pathless-allow branch
			// in the scope gates (result-level scope filtering is a runtime concern).
			const req: CoreSearchRequest = {apiKeyId, operation: 'listNotes'};
			return {verdict: evaluatePermissions(req, config, gates)};
		}
	}
}

/**
 * Reports whether `tag` is within the key's effective tag scope — the
 * intersection of global security tags and the key's own tags (both must be
 * non-empty), matched with the same wildcard semantics as kado-search.
 * Returns 'not-checked' when no tag is supplied.
 */
function evaluateTagScope(rawTag: string | undefined, keyId: string, config: KadoConfig): TagScope {
	if (rawTag === undefined || rawTag.trim() === '') return 'not-checked';
	const tag = normalizeTag(rawTag);
	if (tag === null) return 'not-checked';

	const key = config.apiKeys.find((k) => k.id === keyId);
	if (!key) return 'out-of-scope';

	const globalTags = config.security.tags ?? [];
	const keyTags = key.tags ?? [];
	if (globalTags.length === 0 || keyTags.length === 0) return 'out-of-scope';

	// Effective scope = key tags that are also permitted by a global tag pattern.
	const allowed = keyTags.filter((kt) => globalTags.some((gt) => matchTag(kt, gt)));
	const inScope = allowed.some((pattern) => matchTag(tag, pattern));
	return inScope ? 'in-scope' : 'out-of-scope';
}
