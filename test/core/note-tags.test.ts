/**
 * Tests for raw-markdown note tag extraction (#81 tag access rules).
 */

import {describe, it, expect} from 'vitest';
import {extractNoteTags, frontmatterTags, normalizeFrontmatterTags, splitFrontmatter} from '../../src/core/note-tags';

/** Minimal YAML stub: supports `tags: a, b`, `tags: [a, b]` and block lists — enough for tag extraction. */
function fakeParseYaml(yaml: string): unknown {
	const lines = yaml.split('\n');
	const out: Record<string, unknown> = {};
	for (let i = 0; i < lines.length; i++) {
		const m = /^(\w+):\s*(.*)$/.exec(lines[i] ?? '');
		if (!m) continue;
		const [, key, rest] = m as unknown as [string, string, string];
		if (rest === '') {
			const items: string[] = [];
			while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1] ?? '')) {
				items.push((lines[++i] ?? '').replace(/^\s*-\s+/, '').trim());
			}
			out[key] = items;
		} else if (rest.startsWith('[')) {
			out[key] = rest.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
		} else {
			out[key] = rest;
		}
	}
	return out;
}

describe('normalizeFrontmatterTags', () => {
	it('splits the string form at whitespace and commas', () => {
		expect(normalizeFrontmatterTags('work, #private  todo')).toEqual(['work', 'private', 'todo']);
	});

	it('normalizes array entries and ignores non-strings', () => {
		expect(normalizeFrontmatterTags(['#Work', 7, ' x '])).toEqual(['Work', 'x']);
	});

	it('returns [] for null, undefined and other shapes', () => {
		expect(normalizeFrontmatterTags(undefined)).toEqual([]);
		expect(normalizeFrontmatterTags(null)).toEqual([]);
		expect(normalizeFrontmatterTags({a: 1})).toEqual([]);
	});

	it('dedupes preserving first occurrence', () => {
		expect(normalizeFrontmatterTags(['a', '#a', 'b'])).toEqual(['a', 'b']);
	});
});

describe('frontmatterTags', () => {
	it('reads the singular `tag` alias and case variants like Obsidian does', () => {
		expect(frontmatterTags({tag: 'Private'})).toEqual(['Private']);
		expect(frontmatterTags({Tags: ['Work']})).toEqual(['Work']);
		expect(frontmatterTags({TAG: 'a, b'})).toEqual(['a', 'b']);
	});

	it('merges several tag keys and ignores unrelated keys', () => {
		expect(frontmatterTags({tags: ['Work'], tag: 'Private', tagline: 'x'})).toEqual(['Work', 'Private']);
	});

	it('returns [] for a missing or non-object frontmatter', () => {
		expect(frontmatterTags(undefined)).toEqual([]);
		expect(frontmatterTags(null)).toEqual([]);
		expect(frontmatterTags('tags: x')).toEqual([]);
	});
});

describe('splitFrontmatter', () => {
	it('returns empty prefix when there is no frontmatter', () => {
		expect(splitFrontmatter('hello')).toEqual({prefix: '', body: 'hello'});
	});

	it('splits at the closing fence', () => {
		expect(splitFrontmatter('---\na: 1\n---\nbody')).toEqual({prefix: '---\na: 1\n---\n', body: 'body'});
	});
});

describe('extractNoteTags', () => {
	it('combines frontmatter and inline tags, deduped', () => {
		const content = '---\ntags: [Work, Shared]\n---\nText #Work and #Work/ProjectA';
		expect(extractNoteTags(content, fakeParseYaml)).toEqual(['Work', 'Shared', 'Work/ProjectA']);
	});

	it('reads block-list frontmatter tags', () => {
		const content = '---\ntags:\n  - Private\n  - x\n---\nbody';
		expect(extractNoteTags(content, fakeParseYaml)).toEqual(['Private', 'x']);
	});

	it('does not treat tags inside code blocks as tags', () => {
		const content = 'see\n```\n#Private\n```\nand `#Secret` inline';
		expect(extractNoteTags(content, fakeParseYaml)).toEqual([]);
	});

	it('returns inline tags only when there is no frontmatter', () => {
		expect(extractNoteTags('plain #Work note', fakeParseYaml)).toEqual(['Work']);
	});

	it('ignores frontmatter whose YAML fails to parse but still reads inline tags', () => {
		const throwing = (): unknown => { throw new Error('bad yaml'); };
		expect(extractNoteTags('---\n: :\n---\n#Work', throwing)).toEqual(['Work']);
	});

	it('reads a singular `tag:` frontmatter key', () => {
		expect(extractNoteTags('---\ntag: Private\n---\nbody', fakeParseYaml)).toEqual(['Private']);
	});

	it('does not scan frontmatter text for inline tags', () => {
		const content = '---\ntitle: "#NotATag"\n---\nbody';
		expect(extractNoteTags(content, fakeParseYaml)).toEqual([]);
	});
});
