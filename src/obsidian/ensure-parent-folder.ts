/**
 * ensureParentFolder — creates any missing parent folders of a vault path.
 *
 * Obsidian's `vault.create`/`vault.createBinary` do NOT auto-create missing
 * parent folders — they throw when the target's folder is absent. This helper
 * mirrors the audit-logger pattern (`adapter.exists` → `vault.createFolder`) so
 * a write into a not-yet-existing folder just works, giving `kado-write`
 * implicit `mkdir -p` semantics (spec 009). `createFolder` creates intermediate
 * folders recursively, so a single call covers a deep path like `A/B/C`.
 *
 * Single source of truth for folder-ensuring: the note adapter, the file
 * adapter, and the audit logger all call this instead of open-coding it.
 */

import type {App} from 'obsidian';
import {parentDir} from '../core/rename-policy';

/**
 * Ensures the parent folder of `path` exists, creating it (and any missing
 * ancestors) if absent. No-op for a root-level path. A concurrent writer may
 * create the folder between the `exists` check and `createFolder`, so the
 * "already exists" rejection is swallowed — from this caller's point of view the
 * folder now exists, which is the intended outcome.
 */
export async function ensureParentFolder(app: App, path: string): Promise<void> {
	const dir = parentDir(path);
	if (!dir) return;
	if (await app.vault.adapter.exists(dir)) return;
	await app.vault.createFolder(dir).catch(() => {/* already exists (race) */});
}
