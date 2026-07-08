/**
 * Tests for collectFolderTreePaths — walks a folder subtree and returns the
 * folder's own path plus every descendant (files + subfolders). Feeds the
 * folder-rename RBAC neutrality check (spec 009, Phase 4).
 */

import {describe, it, expect, vi} from 'vitest';
import {TFile, TFolder} from '../__mocks__/obsidian';
import {collectFolderTreePaths} from '../../src/obsidian/folder-tree';

function file(path: string): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.split('/').pop() ?? path;
	return f;
}

function folder(path: string, children: (TFile | TFolder)[] = []): TFolder {
	const f = new TFolder();
	f.path = path;
	f.name = path.split('/').pop() ?? path;
	f.children = children;
	return f;
}

function appWith(root: TFolder | TFile | null) {
	return {
		vault: {getAbstractFileByPath: vi.fn(() => root)},
	} as never;
}

describe('collectFolderTreePaths', () => {
	it('returns the folder path plus all descendants (files and subfolders, recursive)', () => {
		const tree = folder('A/alt', [
			file('A/alt/note.md'),
			folder('A/alt/sub', [file('A/alt/sub/deep.md')]),
		]);

		const paths = collectFolderTreePaths(appWith(tree), 'A/alt');

		expect(paths).toEqual([
			'A/alt',
			'A/alt/note.md',
			'A/alt/sub',
			'A/alt/sub/deep.md',
		]);
	});

	it('returns just the folder path for an empty folder', () => {
		expect(collectFolderTreePaths(appWith(folder('A/empty')), 'A/empty')).toEqual(['A/empty']);
	});

	it('returns null when the path does not resolve', () => {
		expect(collectFolderTreePaths(appWith(null), 'A/ghost')).toBeNull();
	});

	it('returns null when the path is a file, not a folder', () => {
		expect(collectFolderTreePaths(appWith(file('A/note.md')), 'A/note.md')).toBeNull();
	});
});
