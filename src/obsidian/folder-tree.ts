/**
 * folder-tree — enumerate a folder's own path plus every descendant path.
 *
 * Used by the folder-rename RBAC permission-neutral check (spec 009, C-4): the
 * check must compare the resolved scope of every path the rename would rewrite,
 * which means walking the folder subtree. Kept in the obsidian layer because it
 * touches the vault; the neutrality diff itself is pure core (folder-policy).
 */

import type {App} from 'obsidian';
import {TFolder} from 'obsidian';

/**
 * Returns the folder's own path and the paths of all descendants (files and
 * subfolders, recursively), or `null` if `folderPath` does not resolve to a
 * folder. The folder's own path is included first so a caller can treat the
 * returned list as "every path the rename touches".
 */
export function collectFolderTreePaths(app: App, folderPath: string): string[] | null {
	const root = app.vault.getAbstractFileByPath(folderPath);
	if (!(root instanceof TFolder)) return null;

	const paths: string[] = [];
	const walk = (folder: TFolder): void => {
		paths.push(folder.path);
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				walk(child);
			} else {
				paths.push(child.path);
			}
		}
	};
	walk(root);
	return paths;
}
