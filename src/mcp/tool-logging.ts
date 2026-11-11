/**
 * Activity, debug and audit logging for MCP tool calls. Every allowed or
 * denied call goes through logAllowed/logDenied so the status-bar signal, the
 * debug log and the audit log stay consistent. Split out of tools.ts (#135).
 */

import type {CoreRequest, DataType, CoreOpenNotesRequest} from '../types/canonical';
import {isCoreSearchRequest, isCoreOpenNotesRequest, isCoreWriteRequest, isCoreRenameRequest, isCoreGraphRequest, isCoreGraphAuditRequest} from '../types/canonical';
import {createAuditEntry} from '../core/audit-logger';
import {kadoLog, truncateKeyId} from '../core/logger';
import type {ToolDependencies} from './tool-deps';

/** Tools that mutate the vault — drive the more salient write indicator. */
const MUTATING_TOOLS = new Set(['kado-write', 'kado-delete', 'kado-rename']);

function extractDataType(request: CoreRequest): DataType {
	if (isCoreSearchRequest(request)) return 'note';
	// Graph navigation and the vault-wide graph audit read the link structure of
	// notes — audited as a note read.
	if (isCoreGraphRequest(request) || isCoreGraphAuditRequest(request)) return 'note';
	// 'tags' read operation is audited as a note read (it reads the note body).
	if (request.operation === 'tags') return 'note';
	// Folder delete is authorized and audited as a note operation (folder-policy).
	if (request.operation === 'folder') return 'note';
	return request.operation;
}

export function debugFields(keyId: string, request: CoreRequest): Record<string, unknown> {
	const fields: Record<string, unknown> = {
		key: truncateKeyId(keyId),
		operation: String(('operation' in request ? request.operation : undefined) ?? ''),
	};
	if ('path' in request && request.path !== undefined) fields.path = request.path;
	if ('query' in request && request.query !== undefined) fields.query = request.query;
	return fields;
}

/** Notifies the activity observer, swallowing any error so UI never breaks a tool call. */
function emitActivity(deps: ToolDependencies, tool: string, keyId: string, decision: 'allowed' | 'denied', gate?: string): void {
	if (!deps.onActivity) return;
	try {
		deps.onActivity({tool, keyId, decision, mutating: MUTATING_TOOLS.has(tool), gate});
	} catch {
		// Activity observer must never crash a tool call.
	}
}

export async function logAllowed(
	tool: string,
	deps: ToolDependencies,
	keyId: string,
	request: CoreRequest | CoreOpenNotesRequest,
	startHrMs: number,
	extra?: {permittedCount?: number},
): Promise<void> {
	emitActivity(deps, tool, keyId, 'allowed');
	const auditLogger = deps.auditLogger;
	const durationMs = Math.max(1, Math.round(performance.now() - startHrMs));
	if (isCoreOpenNotesRequest(request as {kind?: unknown})) {
		kadoLog(`${tool} allowed`, {key: truncateKeyId(keyId), scope: (request as CoreOpenNotesRequest).scope, durationMs});
		if (!auditLogger) return;
		try {
			await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation: 'openNotes', query: (request as CoreOpenNotesRequest).scope, decision: 'allowed', durationMs, permittedCount: extra?.permittedCount}));
		} catch { /* audit logging must never crash a tool call */ }
		return;
	}
	const coreReq = request as CoreRequest;
	if (isCoreRenameRequest(coreReq)) {
		// Rename has no single `path`/`dataType`, so it bypasses debugFields/extractDataType:
		// path=source, query=target (auditors derive rename-vs-move from the two folders),
		// dataType=operation ('note'|'file').
		kadoLog(`${tool} allowed`, {key: truncateKeyId(keyId), operation: coreReq.operation, source: coreReq.source, target: coreReq.target, durationMs});
		if (!auditLogger) return;
		try {
			await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation: coreReq.operation, dataType: coreReq.operation, path: coreReq.source, query: coreReq.target, decision: 'allowed', durationMs}));
		} catch { /* audit logging must never crash a tool call */ }
		return;
	}
	kadoLog(`${tool} allowed`, {...debugFields(keyId, coreReq), durationMs});
	if (!auditLogger) return;
	try {
		const path = 'path' in coreReq ? (coreReq.path as string) : undefined;
		const query = 'query' in coreReq ? (coreReq.query as string) : undefined;
		const operation = String(('operation' in coreReq ? coreReq.operation : 'graph-audit') ?? '');
		const dataType = extractDataType(coreReq);
		// Partial note write: body is touched, record the mode for auditors.
		// Frontmatter write: body is preserved byte-identical, so bodyTouched=false.
		// All other ops (full note write, reads): leave both fields absent.
		const isWrite = isCoreWriteRequest(coreReq);
		const bodyTouched = isWrite && coreReq.operation === 'frontmatter' ? false
			: isWrite && coreReq.operation === 'note' && coreReq.notePartial !== undefined ? true
			: undefined;
		const mode = isWrite && coreReq.operation === 'note' && coreReq.notePartial !== undefined
			? coreReq.notePartial.mode
			: undefined;
		await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation, dataType, path, query, decision: 'allowed', durationMs, bodyTouched, mode}));
	} catch {
		// Audit logging must never crash a tool call — log failure is non-fatal
	}
}

export async function logDenied(
	tool: string,
	deps: ToolDependencies,
	keyId: string,
	request: CoreRequest | CoreOpenNotesRequest,
	gate: string | undefined,
): Promise<void> {
	emitActivity(deps, tool, keyId, 'denied', gate);
	const auditLogger = deps.auditLogger;
	if (isCoreOpenNotesRequest(request as {kind?: unknown})) {
		kadoLog(`${tool} denied`, {key: truncateKeyId(keyId), scope: (request as CoreOpenNotesRequest).scope, gate});
		if (!auditLogger) return;
		try {
			await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation: 'openNotes', query: (request as CoreOpenNotesRequest).scope, decision: 'denied', gate}));
		} catch { /* audit logging must never crash a tool call */ }
		return;
	}
	const coreReq = request as CoreRequest;
	if (isCoreRenameRequest(coreReq)) {
		kadoLog(`${tool} denied`, {key: truncateKeyId(keyId), operation: coreReq.operation, source: coreReq.source, target: coreReq.target, gate});
		if (!auditLogger) return;
		try {
			await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation: coreReq.operation, dataType: coreReq.operation, path: coreReq.source, query: coreReq.target, decision: 'denied', gate}));
		} catch { /* audit logging must never crash a tool call */ }
		return;
	}
	kadoLog(`${tool} denied`, {...debugFields(keyId, coreReq), gate});
	if (!auditLogger) return;
	try {
		const path = 'path' in coreReq ? (coreReq.path as string) : undefined;
		const query = 'query' in coreReq ? (coreReq.query as string) : undefined;
		const operation = String(('operation' in coreReq ? coreReq.operation : 'graph-audit') ?? '');
		const dataType = extractDataType(coreReq);
		await auditLogger.log(createAuditEntry({apiKeyId: truncateKeyId(keyId), operation, dataType, path, query, decision: 'denied', gate}));
	} catch {
		// Audit logging must never crash a tool call — log failure is non-fatal
	}
}
