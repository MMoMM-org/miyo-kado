/**
 * Config import/export — portable backup & restore of the whole KadoConfig (#84).
 *
 * exportConfig wraps the config in a small versioned envelope. The export is a
 * FULL backup and INCLUDES API key secrets (the `kado_…` ids are the bearer
 * tokens) so a restore reconnects existing clients unchanged — the UI warns the
 * file is sensitive.
 *
 * parseImport validates the envelope and runs the payload through normalizeConfig
 * (the same shape logic as on-disk load), returning a summary for confirmation.
 * applyImport overlays only the SELECTED sections (general / security / specific
 * keys) onto the current config — pure, returning a new config plus a change
 * summary. Keys are matched by id: same id replaces, new id appends.
 *
 * Pure — ZERO imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import type {KadoConfig} from '../types/canonical';
import {normalizeConfig} from './config-normalize';

/** Envelope marker identifying a Kado config export file. */
export const EXPORT_FORMAT = 'kado-config';
/** Current export schema version. Bump when the envelope shape changes. */
export const EXPORT_VERSION = 1;

/** Versioned export envelope. */
export interface ConfigExport {
	format: typeof EXPORT_FORMAT;
	version: number;
	/** Unix ms the export was produced (stamped by the caller). */
	exportedAt: number;
	config: KadoConfig;
}

/** Human-facing summary of an import payload, for the confirmation UI. */
export interface ImportSummary {
	version: number;
	exportedAt?: number;
	general: boolean;
	security: {listMode: string; paths: number; tags: number};
	keys: {id: string; label: string; enabled: boolean}[];
}

/** Result of parsing/validating an import payload. */
export type ParseResult =
	| {ok: true; config: KadoConfig; summary: ImportSummary}
	| {ok: false; error: string};

/** Which sections of an import to apply. */
export interface ImportSelection {
	general: boolean;
	security: boolean;
	/** Ids (from the imported config) of the keys to apply. */
	keyIds: string[];
}

/** What an applyImport actually changed. */
export interface ImportChanges {
	general: boolean;
	security: boolean;
	keysAdded: number;
	keysReplaced: number;
}

/** Deep clone via JSON — config is always JSON-serializable (it is persisted as JSON). */
function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Build a portable export envelope. Deep-clones so later mutation of the source
 * config does not affect the exported snapshot. Includes API key secrets.
 */
export function exportConfig(config: KadoConfig, exportedAt: number): ConfigExport {
	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt,
		config: clone(config),
	};
}

/** Validate and normalize a raw parsed JSON payload into an importable config + summary. */
export function parseImport(raw: unknown): ParseResult {
	if (raw === null || typeof raw !== 'object') {
		return {ok: false, error: 'File is not a JSON object.'};
	}
	const env = raw as Partial<ConfigExport>;
	if (env.format !== EXPORT_FORMAT) {
		return {ok: false, error: `Not a Kado config export (expected "format": "${EXPORT_FORMAT}").`};
	}
	if (typeof env.version !== 'number') {
		return {ok: false, error: 'Export is missing a numeric "version".'};
	}
	if (env.version > EXPORT_VERSION) {
		return {ok: false, error: `Export version ${env.version} is newer than this plugin supports (${EXPORT_VERSION}). Update Kado, then import again.`};
	}
	if (env.config === null || typeof env.config !== 'object') {
		return {ok: false, error: 'Export has no "config" object.'};
	}

	const config = normalizeConfig(env.config);
	const summary: ImportSummary = {
		version: env.version,
		exportedAt: typeof env.exportedAt === 'number' ? env.exportedAt : undefined,
		general: true,
		security: {
			listMode: config.security.listMode,
			paths: config.security.paths.length,
			tags: config.security.tags.length,
		},
		keys: config.apiKeys.map((k) => ({id: k.id, label: k.label, enabled: k.enabled})),
	};
	return {ok: true, config, summary};
}

/**
 * Overlay the selected sections of `incoming` onto a clone of `current`.
 * Pure — never mutates its arguments. Keys are matched by id.
 */
export function applyImport(
	current: KadoConfig,
	incoming: KadoConfig,
	selection: ImportSelection,
): {config: KadoConfig; changes: ImportChanges} {
	const next = clone(current);
	const changes: ImportChanges = {general: false, security: false, keysAdded: 0, keysReplaced: 0};

	if (selection.general) {
		next.server = clone(incoming.server);
		next.audit = clone(incoming.audit);
		next.debugLogging = incoming.debugLogging;
		next.renameWhenLinkUpdateOff = incoming.renameWhenLinkUpdateOff;
		next.renameTimeoutMs = incoming.renameTimeoutMs;
		next.renameWarningAcknowledged = incoming.renameWarningAcknowledged;
		changes.general = true;
	}

	if (selection.security) {
		next.security = clone(incoming.security);
		changes.security = true;
	}

	for (const id of selection.keyIds) {
		const incomingKey = incoming.apiKeys.find((k) => k.id === id);
		if (!incomingKey) continue;
		const keyClone = clone(incomingKey);
		const idx = next.apiKeys.findIndex((k) => k.id === id);
		if (idx >= 0) {
			next.apiKeys[idx] = keyClone;
			changes.keysReplaced++;
		} else {
			next.apiKeys.push(keyClone);
			changes.keysAdded++;
		}
	}

	return {config: next, changes};
}
