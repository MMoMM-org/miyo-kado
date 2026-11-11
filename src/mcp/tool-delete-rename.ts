/**
 * kado-delete and kado-rename handlers, including the folder variants (folder
 * policy, scope-neutral rename check, folder tag rules) and the rename timeout
 * guard for Obsidian's link-update dialog. Split out of tools.ts (#135).
 */

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {CoreError, CoreDeleteResult, CoreRenameResult} from '../types/canonical';
import {evaluatePermissions} from '../core/permission-chain';
import {evaluateRenamePermissions} from '../core/rename-policy';
import {evaluateFolderDeletePermissions, evaluateFolderRenamePermissions, checkFolderRenameScopeNeutral} from '../core/folder-policy';
import {validateConcurrency} from '../core/concurrency-guard';
import {kadoLog, truncateKeyId} from '../core/logger';
import {collectFolderTreePaths} from '../obsidian/folder-tree';
import {mapDeleteResult, mapRenameResult, mapError} from './response-mapper';
import {deriveHints} from './hints';
import {mapDeleteRequest, mapRenameRequest} from './request-mapper';
import {evaluateFolderTagAccess, evaluateNoteTagAccess} from './tag-policy';
import type {Extra, ToolDependencies} from './tool-deps';
import {kadoDeleteShape, kadoRenameShape, KADO_DELETE_TOOL_DESCRIPTION, KADO_RENAME_TOOL_DESCRIPTION} from './tool-shapes';
import {isCoreError, extractKeyId, missingAuthError, raceWithTimeout, TIMED_OUT} from './tool-support';
import {debugFields, logAllowed, logDenied} from './tool-logging';

export function registerDeleteTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-delete', {description: KADO_DELETE_TOOL_DESCRIPTION, inputSchema: kadoDeleteShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		let request;
		try {
			request = mapDeleteRequest(args, keyId);
		} catch (err: unknown) {
			return mapError({code: 'VALIDATION_ERROR', message: String((err as Error).message ?? err)});
		}

		// Folder delete has no per-folder permission dimension: authorize it as a
		// synthetic note.delete at the folder path via the same gate chain (zero
		// new gates). All other operations use the generic per-datatype chain.
		const config = deps.configManager.getConfig();
		const chainPerm = request.operation === 'folder'
			? evaluateFolderDeletePermissions(request, config, deps.gates)
			: evaluatePermissions(request, config, deps.gates);
		const perm = chainPerm.allowed
			? await evaluateNoteTagAccess(keyId, config, deps.tagSource, request.path, request.operation)
			: chainPerm;
		if (!perm.allowed) {
			await logDenied('kado-delete', deps, keyId, request, perm.error.gate);
			return mapError(perm.error, deriveHints({tool: 'kado-delete', request, error: perm.error}));
		}

		// Folder delete carries no expectedModified (empty-only is the safety), and
		// getFileMtime would return a real mtime if the path happens to be a FILE —
		// which would spuriously CONFLICT before the adapter can say "not a folder".
		// So skip optimistic concurrency for folder ops entirely.
		if (request.operation !== 'folder') {
			const concurrency = validateConcurrency(request, deps.getFileMtime(request.path));
			if (!concurrency.allowed) {
				kadoLog('kado-delete error', {...debugFields(keyId, request), code: concurrency.error.code});
				return mapError(concurrency.error, deriveHints({tool: 'kado-delete', request, error: concurrency.error}));
			}
		}

		const startMs = performance.now();
		try {
			const result = await deps.router(request);
			if (isCoreError(result)) {
				kadoLog('kado-delete error', {...debugFields(keyId, request), code: result.code});
				return mapError(result, deriveHints({tool: 'kado-delete', request, error: result}));
			}
			await logAllowed('kado-delete', deps, keyId, request, startMs);
			return mapDeleteResult(result as CoreDeleteResult);
		} catch (err: unknown) {
			// Adapters throw DeleteAdapterError with a `code` field — propagate it as the canonical error
			const asError = err as {code?: string; message?: string};
			const code = (asError.code === 'NOT_FOUND' || asError.code === 'VALIDATION_ERROR') ? asError.code : 'INTERNAL_ERROR';
			kadoLog('kado-delete error', {...debugFields(keyId, request), code, err: String(err)});
			if (code !== 'INTERNAL_ERROR') {
				const error: CoreError = {code: code, message: asError.message ?? String(err)};
				return mapError(error, deriveHints({tool: 'kado-delete', request, error}));
			}
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
		}
	});
}

export function registerRenameTool(server: McpServer, deps: ToolDependencies): void {
	server.registerTool('kado-rename', {description: KADO_RENAME_TOOL_DESCRIPTION, inputSchema: kadoRenameShape}, async (args, extra: Extra): Promise<CallToolResult> => {
		const keyId = extractKeyId(extra);
		if (!keyId) return missingAuthError();

		let request;
		try {
			request = mapRenameRequest(args, keyId);
		} catch (err: unknown) {
			return mapError({code: 'VALIDATION_ERROR', message: String((err as Error).message ?? err)});
		}

		// Folder rename has no per-folder permission dimension: authorize it as
		// synthetic note.update on source AND target via the same gate chain (zero
		// new gates). Other operations use the note/file rename-vs-move policy.
		const config = deps.configManager.getConfig();
		const {result: chainPerm} = request.operation === 'folder'
			? evaluateFolderRenamePermissions(request, config, deps.gates)
			: evaluateRenamePermissions(request, config, deps.gates);
		const perm = chainPerm.allowed
			? await evaluateNoteTagAccess(keyId, config, deps.tagSource, request.source, request.operation)
			: chainPerm;
		if (!perm.allowed) {
			await logDenied('kado-rename', deps, keyId, request, perm.error.gate);
			return mapError(perm.error, deriveHints({tool: 'kado-rename', request, error: perm.error}));
		}

		// RBAC permission-neutral invariant (spec 009 C-4): a folder rename that
		// would move any descendant across a permission boundary is blocked, and
		// the permission config is NEVER rewritten (fail-closed, block-not-migrate).
		if (request.operation === 'folder') {
			const key = config.apiKeys.find((k) => k.id === keyId);
			const treePaths = collectFolderTreePaths(deps.app, request.source);
			if (key && treePaths) {
				const neutral = checkFolderRenameScopeNeutral(request.source, request.target, treePaths, config, key);
				if (!neutral.allowed) {
					await logDenied('kado-rename', deps, keyId, request, neutral.error.gate);
					return mapError(neutral.error, deriveHints({tool: 'kado-rename', request, error: neutral.error}));
				}
			}
			const tagPerm = evaluateFolderTagAccess(keyId, config, deps.tagSource, treePaths);
			if (!tagPerm.allowed) {
				await logDenied('kado-rename', deps, keyId, request, tagPerm.error.gate);
				return mapError(tagPerm.error, deriveHints({tool: 'kado-rename', request, error: tagPerm.error}));
			}
		}

		// Folder rename carries no expectedModified (in-place + clobber checks are the
		// safety); skip optimistic concurrency for folder ops for the same reason as delete.
		if (request.operation !== 'folder') {
			const concurrency = validateConcurrency(request, deps.getFileMtime(request.source));
			if (!concurrency.allowed) {
				kadoLog('kado-rename error', {key: truncateKeyId(keyId), code: concurrency.error.code});
				return mapError(concurrency.error, deriveHints({tool: 'kado-rename', request, error: concurrency.error}));
			}
		}

		const startMs = performance.now();
		try {
			// Guard against a hang: when Obsidian's auto-update-links is off, renameFile
			// blocks on a confirmation modal that an MCP caller cannot answer. Bound the
			// wait and report TIMEOUT instead of leaving the client hanging forever.
			const timeoutMs = config.renameTimeoutMs;
			const work = deps.router(request);
			const raced = await raceWithTimeout(work, timeoutMs);
			if (raced === TIMED_OUT) {
				work.catch(() => { /* late settle after timeout must not become an unhandled rejection */ });
				// Obsidian moves the file/folder IMMEDIATELY; the "update links?" dialog only gates
				// the inbound-link rewrite (and the promise we were awaiting). So on timeout the
				// rename has almost always already happened — check the vault and report success with
				// linkUpdatePending instead of a misleading failure. Only a genuinely un-moved item
				// (source still present / target absent) is a real TIMEOUT.
				//
				// Existence is probed via getAbstractFileByPath (matches files AND folders) — NOT
				// getFileMtime, which is file-only and returns undefined for a folder, so a folder
				// rename that actually succeeded would otherwise be misreported as TIMEOUT.
				const targetMoved = deps.app.vault.getAbstractFileByPath(request.target) !== null;
				const sourceGone = deps.app.vault.getAbstractFileByPath(request.source) === null;
				if (targetMoved && sourceGone) {
					// Folders have no mtime → 0; files report their post-move mtime.
					const modified = deps.getFileMtime(request.target) ?? 0;
					kadoLog('kado-rename allowed', {key: truncateKeyId(keyId), linkUpdatePending: true});
					await logAllowed('kado-rename', deps, keyId, request, startMs);
					return mapRenameResult({source: request.source, target: request.target, modified, linkUpdatePending: true});
				}
				kadoLog('kado-rename error', {key: truncateKeyId(keyId), code: 'TIMEOUT'});
				await logDenied('kado-rename', deps, keyId, request, 'timeout');
				return mapError({
					code: 'TIMEOUT',
					message: `Rename did not complete within ${timeoutMs} ms and the file was not moved. Obsidian's "Automatically update internal links" setting is likely off, leaving a confirmation dialog blocking the rename. Enable it in Obsidian (Settings → Files and links) for reliable renames.`,
				});
			}
			const result = raced;
			if (isCoreError(result)) {
				kadoLog('kado-rename error', {key: truncateKeyId(keyId), code: result.code});
				return mapError(result, deriveHints({tool: 'kado-rename', request, error: result}));
			}
			await logAllowed('kado-rename', deps, keyId, request, startMs);
			return mapRenameResult(result as CoreRenameResult);
		} catch (err: unknown) {
			// RenameAdapterError carries NOT_FOUND (missing source), CONFLICT (target exists) — surface those.
			const asError = err as {code?: string; message?: string};
			const code = (asError.code === 'CONFLICT' || asError.code === 'NOT_FOUND' || asError.code === 'VALIDATION_ERROR') ? asError.code : 'INTERNAL_ERROR';
			kadoLog('kado-rename error', {key: truncateKeyId(keyId), code, err: String(err)});
			if (code !== 'INTERNAL_ERROR') {
				const error: CoreError = {code: code, message: asError.message ?? String(err)};
				return mapError(error, deriveHints({tool: 'kado-rename', request, error}));
			}
			return mapError({code: 'INTERNAL_ERROR', message: 'An unexpected error occurred'});
		}
	});
}
