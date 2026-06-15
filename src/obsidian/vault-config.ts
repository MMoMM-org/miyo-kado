/**
 * Reader for Obsidian vault config values that are not in the public typings.
 *
 * `alwaysUpdateLinks` mirrors the user's "Files and links → Automatically update
 * internal links" setting. When OFF, `fileManager.renameFile` pops a blocking
 * confirmation modal — which would hang an MCP-driven rename — so Kado uses this
 * to decide whether the kado-rename tool is safe to register.
 */

import type {App} from 'obsidian';

/** Narrow view of the untyped `vault.getConfig` accessor (avoids `any`). */
interface VaultConfigReader {
	getConfig?(key: string): unknown;
}

/**
 * Returns true when Obsidian's "Automatically update internal links" is ON.
 * Defaults to false when the accessor is unavailable (e.g. tests) — the safe
 * stance, since false means "treat rename as needing the explicit opt-in".
 */
export function getAlwaysUpdateLinks(app: App): boolean {
	const vault = app.vault as unknown as VaultConfigReader;
	return vault.getConfig?.('alwaysUpdateLinks') === true;
}
