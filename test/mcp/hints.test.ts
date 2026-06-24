/**
 * Tests for hints — pure derivation of optional, stateless "_hints" guidance
 * attached to tool responses (next-step suggestions for the calling agent).
 *
 * Every hint must be derivable from the current request + result/error alone
 * (no cross-call state). Covers: CONFLICT recovery, FORBIDDEN advisory,
 * pagination continuation, read truncation, tags FrontmatterOnly, top-hit
 * follow-up, and the no-hint cases.
 */

import {describe, it, expect} from 'vitest';
import {deriveHints} from '../../src/mcp/hints';
import type {CoreRequest, CoreSearchRequest, CoreWriteRequest, CoreReadRequest} from '../../src/types/canonical';

const writeReq: CoreWriteRequest = {
	operation: 'note',
	path: 'notes/a.md',
	content: 'x',
	expectedModified: 100,
} as CoreWriteRequest;

const readReq: CoreReadRequest = {operation: 'note', path: 'notes/a.md'} as CoreReadRequest;

describe('deriveHints()', () => {
	it('suggests re-read + retry on CONFLICT', () => {
		const hints = deriveHints({tool: 'kado-write', request: writeReq, error: {code: 'CONFLICT', message: 'changed'}});
		expect(hints).toHaveLength(1);
		expect(hints[0]!.do).toBe('kado-read');
		expect(hints[0]!.with).toMatchObject({operation: 'note', path: 'notes/a.md'});
		expect(hints[0]!.why.toLowerCase()).toContain('expectedmodified');
	});

	it('emits an advisory (no tool) on FORBIDDEN', () => {
		const hints = deriveHints({tool: 'kado-read', request: readReq, error: {code: 'FORBIDDEN', message: 'Access denied'}});
		expect(hints).toHaveLength(1);
		expect(hints[0]!.do).toBeUndefined();
		expect(hints[0]!.why.toLowerCase()).toContain('permission');
	});

	it('emits no hint for a VALIDATION_ERROR', () => {
		const hints = deriveHints({tool: 'kado-read', request: readReq, error: {code: 'VALIDATION_ERROR', message: 'bad'}});
		expect(hints).toEqual([]);
	});

	it('suggests the next page when a search cursor is present', () => {
		const req: CoreSearchRequest = {operation: 'byContent', query: 'alpha', limit: 50} as CoreSearchRequest;
		const hints = deriveHints({
			tool: 'kado-search',
			request: req,
			searchResult: {items: [{path: 'a.md', name: 'a.md', created: 0, modified: 0, size: 1}], cursor: 'NTA=', total: 120},
		});
		const page = hints.find((h) => h.do === 'kado-search' && h.with?.cursor === 'NTA=');
		expect(page).toBeDefined();
		expect(page!.with).toMatchObject({operation: 'byContent', query: 'alpha', cursor: 'NTA='});
	});

	it('suggests reading the top hit for a byContent search', () => {
		const req: CoreSearchRequest = {operation: 'byContent', query: 'alpha'} as CoreSearchRequest;
		const hints = deriveHints({
			tool: 'kado-search',
			request: req,
			searchResult: {items: [{path: 'top.md', name: 'top.md', created: 0, modified: 0, size: 1}], total: 1},
		});
		const read = hints.find((h) => h.do === 'kado-read');
		expect(read).toBeDefined();
		expect(read!.with).toMatchObject({operation: 'note', path: 'top.md'});
	});

	it('emits no hints for an empty search result', () => {
		const req: CoreSearchRequest = {operation: 'byContent', query: 'alpha'} as CoreSearchRequest;
		const hints = deriveHints({tool: 'kado-search', request: req, searchResult: {items: [], total: 0}});
		expect(hints).toEqual([]);
	});

	it('suggests a follow-up range read when content was truncated', () => {
		const hints = deriveHints({
			tool: 'kado-read',
			request: {operation: 'note', path: 'big.md', notePartial: {mode: 'firstXChars', limit: 5}} as unknown as CoreRequest,
			fileResult: {path: 'big.md', content: 'hello', created: 0, modified: 0, size: 999, truncated: true},
		});
		const next = hints.find((h) => h.do === 'kado-read' && h.with?.mode === 'range');
		expect(next).toBeDefined();
		expect(next!.with).toMatchObject({operation: 'note', path: 'big.md', rangeBasis: 'char', start: 5});
	});

	it('suggests a follow-up range read when a firstXWords read was truncated', () => {
		const hints = deriveHints({
			tool: 'kado-read',
			request: {operation: 'note', path: 'big.md', notePartial: {mode: 'firstXWords', limit: 2}} as unknown as CoreRequest,
			fileResult: {path: 'big.md', content: 'one two', created: 0, modified: 0, size: 999, truncated: true},
		});
		const next = hints.find((h) => h.do === 'kado-read' && h.with?.mode === 'range');
		expect(next).toBeDefined();
		expect(next!.with).toMatchObject({operation: 'note', path: 'big.md', rangeBasis: 'char', start: 7});
	});

	it('counts the continuation offset in code points, not UTF-16 units (astral chars)', () => {
		// '👍👍👍' is 3 code points but 6 UTF-16 units. A char-basis range read
		// interprets `start` as code points, so the offset must be 3, not 6 —
		// otherwise the continuation overshoots and skips content.
		const hints = deriveHints({
			tool: 'kado-read',
			request: {operation: 'note', path: 'big.md', notePartial: {mode: 'firstXChars', limit: 3}} as unknown as CoreRequest,
			fileResult: {path: 'big.md', content: '👍👍👍', created: 0, modified: 0, size: 999, truncated: true},
		});
		const next = hints.find((h) => h.do === 'kado-read' && h.with?.mode === 'range');
		expect(next).toBeDefined();
		expect(next!.with).toMatchObject({rangeBasis: 'char', start: 3});
	});

	it('emits no hint for a complete (non-truncated) read', () => {
		const hints = deriveHints({
			tool: 'kado-read',
			request: readReq,
			fileResult: {path: 'notes/a.md', content: 'full body', created: 0, modified: 0, size: 9},
		});
		expect(hints).toEqual([]);
	});

	it('advises that inline tags need note.read on FrontmatterOnly', () => {
		const hints = deriveHints({
			tool: 'kado-read',
			request: {operation: 'tags', path: 'notes/a.md'} as unknown as CoreRequest,
			fileResult: {path: 'notes/a.md', content: {frontmatter: ['x'], inline: [], all: ['x'], returnedTags: 'FrontmatterOnly'}, created: 0, modified: 0, size: 0},
		});
		expect(hints.some((h) => h.why.includes('note.read'))).toBe(true);
	});
});
