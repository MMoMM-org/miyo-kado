/**
 * MCP tool registration — bridges the MCP SDK to the Kado Core pipeline.
 *
 * Registers the Kado tools (kado-read, kado-write, kado-search, kado-delete,
 * kado-rename, kado-open-notes, kado-graph, kado-graph-audit) on an McpServer
 * instance. Each handler lives in its own tool-*.ts module: it extracts the
 * keyId from the bearer token, maps args into a canonical CoreRequest, runs
 * the permission chain (plus tag rules), runs the concurrency guard for
 * writes, routes to the correct adapter, and maps the result back to a
 * CallToolResult. This module is the stable entry point: it re-exports the
 * public types, shapes and scope helpers (#135).
 */

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {ToolDependencies} from './tool-deps';
import {registerReadTool, registerWriteTool} from './tool-read-write';
import {registerDeleteTool, registerRenameTool} from './tool-delete-rename';
import {registerSearchTool} from './tool-search';
import {registerOpenNotesTool} from './tool-open-notes';
import {registerGraphTool, registerGraphAuditTool} from './tool-graph';

export type {ToolActivityEvent, ToolActivityCallback, ToolDependencies} from './tool-deps';
export {
	kadoReadShape,
	kadoWriteShape,
	kadoOpenNotesShape,
	kadoGraphShape,
	kadoGraphAuditShape,
	kadoSearchShape,
	KADO_GRAPH_AUDIT_TOOL_DESCRIPTION,
	KADO_GRAPH_TOOL_DESCRIPTION,
	KADO_SEARCH_TOOL_DESCRIPTION,
} from './tool-shapes';
export {isPathPermittedForKey, filterResultsByScope, computeScopePatterns, computeAllowedTags} from './scope-filters';

// ============================================================
// Public API
// ============================================================

/**
 * Registers every Kado tool on the MCP server (kado-rename only when it is safe).
 * @param server - The MCP server instance to register tools on.
 * @param deps - Shared dependencies (config, gates, router, audit logger).
 */
export function registerTools(server: McpServer, deps: ToolDependencies): void {
	registerReadTool(server, deps);
	registerWriteTool(server, deps);
	registerSearchTool(server, deps);
	registerDeleteTool(server, deps);
	// Only register rename when it is safe: Obsidian's auto-update-links is on, or the
	// user explicitly opted in. Otherwise renameFile would block on a confirmation modal.
	if (deps.renameToolEnabled !== false) {
		registerRenameTool(server, deps);
	}
	registerOpenNotesTool(server, deps);
	registerGraphTool(server, deps);
	registerGraphAuditTool(server, deps);
}
