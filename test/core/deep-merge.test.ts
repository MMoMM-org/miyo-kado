/**
 * Tests for deepMerge — pure helper used by the frontmatter-adapter to
 * implement `kado-write operation=frontmatter` with mode=merge semantics.
 *
 * Contract:
 *   - For every key, if BOTH existing and supplied values are plain objects,
 *     recurse and merge.
 *   - Otherwise the supplied value REPLACES the existing value.
 *   - Arrays never merge — they replace.
 *   - Mutates the target in place (so it works inside processFrontMatter's
 *     fn-callback contract) and also returns the target for chaining.
 */

import {describe, it, expect} from 'vitest';
import {deepMerge} from '../../src/core/deep-merge';

describe('deepMerge() — top-level scalars', () => {
	it('adds new keys from source', () => {
		const target: Record<string, unknown> = {a: 1};
		deepMerge(target, {b: 2});
		expect(target).toEqual({a: 1, b: 2});
	});

	it('overwrites existing scalar with new scalar', () => {
		const target: Record<string, unknown> = {a: 1};
		deepMerge(target, {a: 2});
		expect(target).toEqual({a: 2});
	});

	it('preserves keys that are not in source', () => {
		const target: Record<string, unknown> = {a: 1, b: 2};
		deepMerge(target, {a: 99});
		expect(target).toEqual({a: 99, b: 2});
	});

	it('mutates target in place and returns it', () => {
		const target: Record<string, unknown> = {a: 1};
		const returned = deepMerge(target, {b: 2});
		expect(returned).toBe(target);
	});
});

describe('deepMerge() — nested objects', () => {
	it('recurses into nested objects instead of replacing them', () => {
		const target: Record<string, unknown> = {tomo: {state: 'pending', doc_type: 'suggestion'}};
		deepMerge(target, {tomo: {state: 'approved'}});
		expect(target).toEqual({tomo: {state: 'approved', doc_type: 'suggestion'}});
	});

	it('merges multiple levels deep', () => {
		const target: Record<string, unknown> = {a: {b: {c: 1, d: 2}}};
		deepMerge(target, {a: {b: {c: 99}}});
		expect(target).toEqual({a: {b: {c: 99, d: 2}}});
	});

	it('adds a nested object when target has none', () => {
		const target: Record<string, unknown> = {};
		deepMerge(target, {tomo: {state: 'approved'}});
		expect(target).toEqual({tomo: {state: 'approved'}});
	});
});

describe('deepMerge() — arrays REPLACE', () => {
	it('replaces an existing array with the supplied one (no concat)', () => {
		const target: Record<string, unknown> = {tags: ['#a', '#b']};
		deepMerge(target, {tags: ['#c']});
		expect(target).toEqual({tags: ['#c']});
	});

	it('replaces an array inside a nested object', () => {
		const target: Record<string, unknown> = {tomo: {tags: ['x', 'y']}};
		deepMerge(target, {tomo: {tags: ['z']}});
		expect(target).toEqual({tomo: {tags: ['z']}});
	});

	it('replaces an array even when source value is a different array shape', () => {
		const target: Record<string, unknown> = {list: [1, 2, 3]};
		deepMerge(target, {list: []});
		expect(target).toEqual({list: []});
	});
});

describe('deepMerge() — type mismatches', () => {
	it('supplied scalar replaces an existing object', () => {
		const target: Record<string, unknown> = {tomo: {state: 'pending'}};
		deepMerge(target, {tomo: 'replaced'});
		expect(target).toEqual({tomo: 'replaced'});
	});

	it('supplied object replaces an existing scalar', () => {
		const target: Record<string, unknown> = {tomo: 'old'};
		deepMerge(target, {tomo: {state: 'new'}});
		expect(target).toEqual({tomo: {state: 'new'}});
	});

	it('supplied array replaces an existing object', () => {
		const target: Record<string, unknown> = {tags: {nested: true}};
		deepMerge(target, {tags: ['#a']});
		expect(target).toEqual({tags: ['#a']});
	});

	it('supplied null replaces an existing object (explicit clear)', () => {
		const target: Record<string, unknown> = {tomo: {state: 'pending'}};
		deepMerge(target, {tomo: null});
		expect(target).toEqual({tomo: null});
	});
});

describe('deepMerge() — prototype pollution guards', () => {
	it('ignores __proto__ keys in source', () => {
		const target: Record<string, unknown> = {a: 1};
		deepMerge(target, JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>);
		expect((target as {polluted?: unknown}).polluted).toBeUndefined();
		expect(({} as {polluted?: unknown}).polluted).toBeUndefined();
	});

	it('ignores constructor keys in source', () => {
		const target: Record<string, unknown> = {a: 1};
		deepMerge(target, {constructor: {polluted: true}});
		expect(target).toEqual({a: 1});
	});
});
