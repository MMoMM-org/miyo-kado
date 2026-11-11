/**
 * Shared types for the MCP tool layer: the dependencies injected into every
 * tool handler and the activity signal they emit. Split out of tools.ts (#135)
 * so handler modules can depend on these without importing the registry.
 */

import type {App} from 'obsidian';
import type {RequestHandlerExtra} from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {ServerRequest, ServerNotification} from '@modelcontextprotocol/sdk/types.js';
import type {ConfigManager} from '../core/config-manager';
import type {AuditLogger} from '../core/audit-logger';
import type {RouteResult} from '../core/operation-router';
import type {PermissionGate, CoreRequest, NoteTagSource} from '../types/canonical';

/**
 * A single tool-call activity signal, emitted for every allowed or denied call.
 * Consumed by the status-bar indicator (Layer 5). Carries the full `keyId` so
 * the consumer can resolve it to a human label; deliberately omits the path —
 * that detail belongs in the audit log, not an at-a-glance indicator.
 */
export interface ToolActivityEvent {
	/** The tool that ran, e.g. 'kado-write'. */
	tool: string;
	/** Full API key id (the consumer resolves it to a human label). */
	keyId: string;
	/** Whether the call was allowed or denied. */
	decision: 'allowed' | 'denied';
	/** True for mutating tools (write/delete/rename). */
	mutating: boolean;
	/** Denial gate name, when decision is 'denied'. */
	gate?: string;
}

/** Observer for tool-call activity. Must never throw into the call path. */
export type ToolActivityCallback = (event: ToolActivityEvent) => void;

/** Dependencies injected into the MCP tool handlers. */
export interface ToolDependencies {
	configManager: ConfigManager;
	gates: PermissionGate[];
	router: (request: CoreRequest) => Promise<RouteResult>;
	getFileMtime: (path: string) => number | undefined;
	auditLogger?: AuditLogger;
	/**
	 * Optional observer notified on every allowed/denied tool call, independent
	 * of whether audit logging is enabled. Drives the status-bar indicator.
	 */
	onActivity?: ToolActivityCallback;
	/** Obsidian App instance — required by the kado-open-notes tool handler. */
	app: App;
	/**
	 * Whether to register the kado-rename tool. Computed at server-build time as
	 * (Obsidian alwaysUpdateLinks) OR (config.renameWhenLinkUpdateOff). When false,
	 * kado-rename is not registered at all — renaming with auto-update-links off would
	 * block on Obsidian's confirmation modal. Defaults to true when omitted (tests).
	 */
	renameToolEnabled?: boolean;
	/**
	 * Resolves note tags for the tag access policy (#81). Optional so tests and
	 * callers without a vault keep working; when absent and tag rules exist,
	 * tags count as unknown and tag-governed operations are denied (fail-closed).
	 */
	tagSource?: NoteTagSource;
}

/** The MCP SDK's per-call handler context (carries the bearer token as authInfo). */
export type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
