/**
 * Workspace adapter for enumerating currently open notes.
 *
 * Iterates over all known Obsidian view types, converts each leaf with a
 * backing TFile into an OpenNoteDescriptor, and de-duplicates by path —
 * upgrading any prior entry to active: true when the active pane is the dup.
 */

import {App, WorkspaceLeaf, TFile} from 'obsidian';
import type {OpenNoteDescriptor} from '../types/canonical';

/** View types Kado recognises. Only leaves of these types are enumerated. */
export const KNOWN_VIEW_TYPES = ['markdown', 'canvas', 'pdf', 'image'] as const;

/**
 * Returns descriptors for all open vault files, one entry per unique path.
 * Linked panes showing the same file are collapsed into a single entry;
 * if any of those panes is active, the entry carries active: true.
 */
export function enumerateOpenNotes(app: App): OpenNoteDescriptor[] {
	const activeLeaf = (app.workspace as unknown as {activeLeaf?: WorkspaceLeaf | null}).activeLeaf ?? null;
	const seen = new Map<string, OpenNoteDescriptor>();

	for (const type of KNOWN_VIEW_TYPES) {
		for (const leaf of app.workspace.getLeavesOfType(type)) {
			const descriptor = leafToDescriptor(leaf, activeLeaf);
			if (!descriptor) continue;
			const prior = seen.get(descriptor.path);
			if (!prior) {
				seen.set(descriptor.path, descriptor);
			} else if (!prior.active && descriptor.active) {
				seen.set(descriptor.path, descriptor);
			}
		}
	}

	return [...seen.values()];
}

function leafToDescriptor(leaf: WorkspaceLeaf, activeLeaf: WorkspaceLeaf | null): OpenNoteDescriptor | null {
	const file: TFile | undefined = (leaf.view as unknown as {file?: TFile}).file ?? undefined;
	// instanceof guards against plugin-injected views that expose a non-TFile
	// object with a .path property — only real vault files may produce descriptors.
	if (!file || !(file instanceof TFile)) return null;
	return {
		name: file.basename,
		path: file.path,
		active: leaf === activeLeaf,
		type: leaf.view.getViewType(),
	};
}
