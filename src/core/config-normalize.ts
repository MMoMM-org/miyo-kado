/**
 * normalizeConfig — turns arbitrary stored/imported data into a complete,
 * defaults-filled KadoConfig.
 *
 * Extracted from ConfigManager.load so the exact same shape-normalization and
 * legacy migration runs for BOTH on-disk data.json AND imported config files
 * (#84). Single source of truth for "what a valid KadoConfig looks like".
 *
 * Pure — ZERO imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import {
	type KadoConfig,
	createDefaultConfig,
	createDefaultSecurityConfig,
} from '../types/canonical';

/** Normalize arbitrary stored data into a complete KadoConfig, filling defaults and migrating legacy fields. */
export function normalizeConfig(stored: unknown): KadoConfig {
	if (stored === null || stored === undefined || typeof stored !== 'object') {
		return createDefaultConfig();
	}
	const defaults = createDefaultConfig();
	const partial = stored as Partial<KadoConfig>;

	// Merge audit — handle migration from old logFilePath to logDirectory/logFileName
	const storedAudit = (partial.audit ?? {}) as Record<string, unknown>;
	const mergedAudit = {...defaults.audit, ...storedAudit};
	// Remove legacy field if present
	if ('logFilePath' in mergedAudit) {
		delete (mergedAudit as Record<string, unknown>)['logFilePath'];
	}

	// Merge security scope — handle migration from old globalAreas to security
	const storedSecurity = (partial as Record<string, unknown>).security as Partial<typeof defaults.security> | undefined;
	const mergedSecurity = {
		...createDefaultSecurityConfig(),
		...(storedSecurity ?? {}),
	};

	// Migrate legacy path "/" → "**" in global security paths
	for (const entry of mergedSecurity.paths) {
		if (entry.path === '/') {
			entry.path = '**';
		}
	}

	// Ensure open-notes flags are boolean (default false) on global security
	mergedSecurity.allowActiveNote = mergedSecurity.allowActiveNote === true;
	mergedSecurity.allowOtherNotes = mergedSecurity.allowOtherNotes === true;

	// Ensure apiKeys have new flat fields (listMode, paths, tags)
	const keys = (partial.apiKeys ?? defaults.apiKeys).map(key => ({
		...key,
		listMode: key.listMode ?? 'whitelist' as const,
		paths: key.paths ?? [],
		tags: key.tags ?? [],
		allowActiveNote: (key as unknown as Record<string, unknown>).allowActiveNote === true,
		allowOtherNotes: (key as unknown as Record<string, unknown>).allowOtherNotes === true,
	}));

	// Migrate legacy path "/" → "**" in each API key's paths
	for (const key of keys) {
		for (const entry of key.paths) {
			if (entry.path === '/') {
				entry.path = '**';
			}
		}
	}

	return {
		...defaults,
		...partial,
		server: {...defaults.server, ...(partial.server ?? {})},
		audit: mergedAudit as typeof defaults.audit,
		security: mergedSecurity,
		apiKeys: keys,
		debugLogging: partial.debugLogging ?? defaults.debugLogging,
		renameWhenLinkUpdateOff: partial.renameWhenLinkUpdateOff === true,
		renameTimeoutMs: typeof partial.renameTimeoutMs === 'number' && Number.isFinite(partial.renameTimeoutMs) && partial.renameTimeoutMs > 0
			? partial.renameTimeoutMs
			: defaults.renameTimeoutMs,
		renameWarningAcknowledged: partial.renameWarningAcknowledged === true,
	};
}
