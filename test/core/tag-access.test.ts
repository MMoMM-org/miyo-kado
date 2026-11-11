/**
 * Tests for the tag access policy (#81): tagAllow / tagDeny filter over path permissions.
 */

import {describe, it, expect} from 'vitest';
import {evaluateTagAccess, hasTagRules, isTagGovernedDataType} from '../../src/core/tag-access';
import {createDefaultApiKeyConfig, createDefaultConfig} from '../../src/types/canonical';
import type {ApiKeyConfig, KadoConfig} from '../../src/types/canonical';

function setup(
	global: {tagAllow?: string[]; tagDeny?: string[]} = {},
	key: {tagAllow?: string[]; tagDeny?: string[]} = {},
): {config: KadoConfig; apiKey: ApiKeyConfig} {
	const config = createDefaultConfig();
	config.security.tagAllow = global.tagAllow ?? [];
	config.security.tagDeny = global.tagDeny ?? [];
	const apiKey = createDefaultApiKeyConfig({id: 'kado_k', tagAllow: key.tagAllow ?? [], tagDeny: key.tagDeny ?? []});
	config.apiKeys = [apiKey];
	return {config, apiKey};
}

function deniedMessage(result: ReturnType<typeof evaluateTagAccess>): string {
	if (result.allowed) throw new Error('expected denial');
	expect(result.error.code).toBe('FORBIDDEN');
	expect(result.error.gate).toBe('tag-access');
	return result.error.message;
}

describe('hasTagRules', () => {
	it('is false when no list is set', () => {
		const {config, apiKey} = setup();
		expect(hasTagRules(config, apiKey)).toBe(false);
	});

	it.each([
		[{tagAllow: ['a']}, {}],
		[{tagDeny: ['a']}, {}],
		[{}, {tagAllow: ['a']}],
		[{}, {tagDeny: ['a']}],
	])('is true when any list is non-empty (%o / %o)', (g, k) => {
		const {config, apiKey} = setup(g, k);
		expect(hasTagRules(config, apiKey)).toBe(true);
	});
});

describe('evaluateTagAccess', () => {
	it('allows everything, including unknown tags, when no rules exist', () => {
		const {config, apiKey} = setup();
		expect(evaluateTagAccess(null, config, apiKey).allowed).toBe(true);
		expect(evaluateTagAccess([], config, apiKey).allowed).toBe(true);
	});

	it('allows a note carrying an allowed tag', () => {
		const {config, apiKey} = setup({}, {tagAllow: ['Work']});
		expect(evaluateTagAccess(['misc', 'Work'], config, apiKey).allowed).toBe(true);
	});

	it('denies an untagged note when tagAllow is set (fail-closed)', () => {
		const {config, apiKey} = setup({}, {tagAllow: ['Work']});
		expect(deniedMessage(evaluateTagAccess([], config, apiKey))).toMatch(/Only notes tagged.*\(key\)/);
	});

	it('denies a note with only other tags when tagAllow is set', () => {
		const {config, apiKey} = setup({tagAllow: ['Work']});
		expect(deniedMessage(evaluateTagAccess(['Home'], config, apiKey))).toMatch(/\(global\)/);
	});

	it('matches nested tags under a bare allow pattern', () => {
		const {config, apiKey} = setup({}, {tagAllow: ['Work']});
		expect(evaluateTagAccess(['Work/ProjectA'], config, apiKey).allowed).toBe(true);
	});

	it('honours x/* wildcard (sub-tags only)', () => {
		const {config, apiKey} = setup({}, {tagAllow: ['Work/*']});
		expect(evaluateTagAccess(['Work/A'], config, apiKey).allowed).toBe(true);
		expect(evaluateTagAccess(['Work'], config, apiKey).allowed).toBe(false);
	});

	it('denies a note carrying a denied tag and names the rule', () => {
		const {config, apiKey} = setup({}, {tagDeny: ['Private']});
		expect(deniedMessage(evaluateTagAccess(['Private'], config, apiKey))).toMatch(/#Private.*\(key\)/);
	});

	it('lets deny win over allow', () => {
		const {config, apiKey} = setup({}, {tagAllow: ['Work'], tagDeny: ['Private']});
		expect(deniedMessage(evaluateTagAccess(['Work', 'Private'], config, apiKey))).toMatch(/#Private/);
	});

	it('applies a global deny even when the key allows the note', () => {
		const {config, apiKey} = setup({tagDeny: ['Secret']}, {tagAllow: ['Work']});
		expect(deniedMessage(evaluateTagAccess(['Work', 'Secret/x'], config, apiKey))).toMatch(/#Secret.*\(global\)/);
	});

	it('requires global and key allow lists to both pass', () => {
		const {config, apiKey} = setup({tagAllow: ['Work']}, {tagAllow: ['Team']});
		expect(evaluateTagAccess(['Work'], config, apiKey).allowed).toBe(false);
		expect(evaluateTagAccess(['Team'], config, apiKey).allowed).toBe(false);
		expect(evaluateTagAccess(['Work', 'Team'], config, apiKey).allowed).toBe(true);
	});

	it('treats unknown tags (null) as denied when any rule exists', () => {
		const {config, apiKey} = setup({tagDeny: ['Private']});
		expect(deniedMessage(evaluateTagAccess(null, config, apiKey))).toMatch(/could not be determined/);
	});

	it('normalizes # prefixes in rules and tags', () => {
		const {config, apiKey} = setup({}, {tagAllow: ['#Work']});
		expect(evaluateTagAccess(['#Work'], config, apiKey).allowed).toBe(true);
	});

	it('ignores empty rule entries', () => {
		const {config, apiKey} = setup({}, {tagAllow: ['', '  ']});
		expect(hasTagRules(config, apiKey)).toBe(false);
		expect(evaluateTagAccess([], config, apiKey).allowed).toBe(true);
	});
});

describe('isTagGovernedDataType', () => {
	it.each(['note', 'frontmatter', 'dataview-inline-field', 'tags'])('governs %s', (op) => {
		expect(isTagGovernedDataType(op)).toBe(true);
	});

	it.each(['file', 'folder'])('does not govern %s', (op) => {
		expect(isTagGovernedDataType(op)).toBe(false);
	});
});
