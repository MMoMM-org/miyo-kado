/**
 * Behavioral tests for enumerateOpenNotes.
 *
 * Verifies that the workspace adapter correctly enumerates open note leaves,
 * deduplicates linked panes, excludes non-file and unknown-type views,
 * and accurately identifies the active leaf.
 */

import {describe, it, expect, vi} from 'vitest';
import {App, TFile} from '../__mocks__/obsidian';
import {enumerateOpenNotes} from '../../src/obsidian/open-notes-adapter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTFile(path: string, basename: string): TFile {
	const file = new TFile();
	file.path = path;
	file.basename = basename;
	return file;
}

function makeLeaf(file: TFile | null, viewType: string): {view: {file: TFile | null; getViewType: () => string}} {
	return {
		view: {
			file,
			getViewType: vi.fn(() => viewType),
		},
	};
}

function makeApp(
	leaves: Record<string, Array<ReturnType<typeof makeLeaf>>>,
	activeLeaf: ReturnType<typeof makeLeaf> | null,
): App {
	const app = new App();
	(app.workspace.getLeavesOfType as ReturnType<typeof vi.fn>).mockImplementation((type: string) => {
		return leaves[type] ?? [];
	});
	(app.workspace as Record<string, unknown>)['activeLeaf'] = activeLeaf;
	return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enumerateOpenNotes', () => {
	it('returns [] when workspace has zero leaves', () => {
		const app = makeApp({}, null);
		expect(enumerateOpenNotes(app)).toEqual([]);
	});

	it('returns one entry with active: true and correct fields when one markdown leaf is focused', () => {
		const file = makeTFile('notes/hello.md', 'hello');
		const leaf = makeLeaf(file, 'markdown');
		const app = makeApp({markdown: [leaf]}, leaf);

		const result = enumerateOpenNotes(app);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			name: 'hello',
			path: 'notes/hello.md',
			active: true,
			type: 'markdown',
		});
	});

	it('returns ONE entry with active: true when two panes show the same file (active-upgrade dedupe)', () => {
		const file = makeTFile('notes/shared.md', 'shared');
		const inactiveLeaf = makeLeaf(file, 'markdown');
		const activeLeaf = makeLeaf(file, 'markdown');
		const app = makeApp({markdown: [inactiveLeaf, activeLeaf]}, activeLeaf);

		const result = enumerateOpenNotes(app);

		expect(result).toHaveLength(1);
		expect(result[0].active).toBe(true);
		expect(result[0].path).toBe('notes/shared.md');
	});

	it('returns all entries with active: false when workspace.activeLeaf is null (mobile fallback)', () => {
		const file = makeTFile('notes/a.md', 'a');
		const leaf = makeLeaf(file, 'markdown');
		const app = makeApp({markdown: [leaf]}, null);

		const result = enumerateOpenNotes(app);

		expect(result).toHaveLength(1);
		expect(result[0].active).toBe(false);
		expect(result[0].path).toBe('notes/a.md');
	});

	it('excludes leaves whose view returns no file', () => {
		const leaf = makeLeaf(null, 'markdown');
		const app = makeApp({markdown: [leaf]}, null);

		expect(enumerateOpenNotes(app)).toEqual([]);
	});

	it('returns a canvas leaf with type "canvas" when it has a TFile', () => {
		const file = makeTFile('diagrams/flow.canvas', 'flow');
		const leaf = makeLeaf(file, 'canvas');
		const app = makeApp({canvas: [leaf]}, null);

		const result = enumerateOpenNotes(app);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			name: 'flow',
			path: 'diagrams/flow.canvas',
			active: false,
			type: 'canvas',
		});
	});

	it('excludes leaves whose view type is not in KNOWN_VIEW_TYPES', () => {
		const file = makeTFile('custom/thing.xyz', 'thing');
		// We never register 'xyz' leaves in the known types map, so getLeavesOfType
		// will never be called for it — result is empty.
		const app = makeApp({'xyz': [makeLeaf(file, 'xyz')]}, null);

		// Only known types are iterated; 'xyz' is unknown so getLeavesOfType('xyz')
		// is never called and the leaf is not included.
		expect(enumerateOpenNotes(app)).toEqual([]);
	});

	// M9 — non-trivial exclusion check: pass-through of raw view type
	// A leaf returned by getLeavesOfType('markdown') whose getViewType() returns
	// a non-KNOWN type still makes it through the KNOWN_VIEW_TYPES loop (because
	// the adapter iterates known types, not view.getViewType()). The descriptor's
	// type field must faithfully carry the raw string — this catches any filtering
	// or type-field corruption in leafToDescriptor.
	it('faithfully passes through the raw view type even when leaf returns a non-standard type string (pass-through per SDD)', () => {
		const file = makeTFile('notes/custom.md', 'custom');
		// getLeavesOfType('markdown') returns this leaf, but its getViewType() returns
		// a non-standard string — adapter must not filter or mutate the type field.
		const leaf = makeLeaf(file, 'markdown-enhanced-plugin');
		const app = makeApp({markdown: [leaf]}, null);

		const result = enumerateOpenNotes(app);

		// The leaf IS included (came from getLeavesOfType('markdown')).
		expect(result).toHaveLength(1);
		// The type field must carry the raw getViewType() result, not the iteration key.
		expect(result[0].type).toBe('markdown-enhanced-plugin');
	});

	it('handles activeLeaf being null (mobile edge case) without throwing', () => {
		const file = makeTFile('notes/a.md', 'a');
		const leaf = makeLeaf(file, 'markdown');
		const app = makeApp({markdown: [leaf]}, null);

		const result = enumerateOpenNotes(app);

		expect(result).toHaveLength(1);
		expect(result[0].active).toBe(false);
	});
});
