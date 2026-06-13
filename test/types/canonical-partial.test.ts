/**
 * Tests for partial note read/write canonical type extensions (spec 007).
 * Covers NoteReadMode, NoteWriteMode, HeadingTarget, RangeTarget,
 * NoteReadPartial, NoteWritePartial, and backward-compat guard behaviour.
 */

import {describe, it, expect} from 'vitest';
import {
	isCoreReadRequest,
	isCoreWriteRequest,
	type CoreReadRequest,
	type CoreWriteRequest,
	type CoreFileResult,
	type NoteReadMode,
	type NoteWriteMode,
	type HeadingTarget,
	type RangeTarget,
	type NoteReadPartial,
	type NoteWritePartial,
} from '../../src/types/canonical';

// ============================================================
// Compile-time union helpers
// ============================================================

// Trick: assign to a typed variable — TypeScript errors if incompatible.
// @ts-expect-error — extra key must be rejected by NoteReadPartial union
const _badReadPartial: NoteReadPartial = {mode: 'firstXChars', limit: 10, extraKey: true};

// @ts-expect-error — mode value not in NoteWriteMode must be rejected
const _badWriteMode: NoteWriteMode = 'nonExistentMode';

// @ts-expect-error — RangeTarget basis must be 'line' | 'char'
const _badRangeBasis: RangeTarget = {basis: 'byte', start: 0, end: 5};

// ============================================================
// Factory helpers
// ============================================================

const makeReadRequest = (overrides?: Partial<CoreReadRequest>): CoreReadRequest => ({
	apiKeyId: 'kado_abc123',
	operation: 'note',
	path: 'notes/test.md',
	...overrides,
});

const makeWriteRequest = (overrides?: Partial<CoreWriteRequest>): CoreWriteRequest => ({
	apiKeyId: 'kado_abc123',
	operation: 'note',
	path: 'notes/test.md',
	content: '# Hello',
	...overrides,
});

// ============================================================
// NoteReadMode
// ============================================================

describe('NoteReadMode', () => {
	it('accepts all three valid mode values', () => {
		const modes: NoteReadMode[] = ['firstXChars', 'section', 'range'];
		expect(modes).toHaveLength(3);
	});
});

// ============================================================
// NoteWriteMode
// ============================================================

describe('NoteWriteMode', () => {
	it('accepts all five valid mode values', () => {
		const modes: NoteWriteMode[] = [
			'append',
			'prepend',
			'insertUnderHeading',
			'replaceSection',
			'replaceRange',
		];
		expect(modes).toHaveLength(5);
	});
});

// ============================================================
// HeadingTarget
// ============================================================

describe('HeadingTarget', () => {
	it('accepts single-string heading arm', () => {
		const t: HeadingTarget = {heading: 'Introduction'};
		expect('heading' in t).toBe(true);
	});

	it('accepts headingPath array arm', () => {
		const t: HeadingTarget = {headingPath: ['Chapter 1', 'Section A']};
		expect('headingPath' in t).toBe(true);
	});
});

// ============================================================
// RangeTarget
// ============================================================

describe('RangeTarget', () => {
	it('accepts line basis', () => {
		const t: RangeTarget = {basis: 'line', start: 1, end: 10};
		expect(t.basis).toBe('line');
		expect(t.start).toBe(1);
		expect(t.end).toBe(10);
	});

	it('accepts char basis', () => {
		const t: RangeTarget = {basis: 'char', start: 0, end: 50};
		expect(t.basis).toBe('char');
	});
});

// ============================================================
// NoteReadPartial union arms
// ============================================================

describe('NoteReadPartial', () => {
	it('accepts firstXChars arm', () => {
		const p: NoteReadPartial = {mode: 'firstXChars', limit: 500};
		expect(p.mode).toBe('firstXChars');
		if (p.mode === 'firstXChars') {
			expect(p.limit).toBe(500);
		}
	});

	it('accepts section arm with heading', () => {
		const p: NoteReadPartial = {mode: 'section', heading: 'Intro'};
		expect(p.mode).toBe('section');
	});

	it('accepts section arm with headingPath', () => {
		const p: NoteReadPartial = {mode: 'section', headingPath: ['H1', 'H2']};
		expect(p.mode).toBe('section');
	});

	it('accepts range arm', () => {
		const p: NoteReadPartial = {mode: 'range', basis: 'line', start: 5, end: 20};
		expect(p.mode).toBe('range');
		if (p.mode === 'range') {
			expect(p.basis).toBe('line');
		}
	});
});

// ============================================================
// NoteWritePartial union arms
// ============================================================

describe('NoteWritePartial', () => {
	it('accepts append arm', () => {
		const p: NoteWritePartial = {mode: 'append'};
		expect(p.mode).toBe('append');
	});

	it('accepts prepend arm', () => {
		const p: NoteWritePartial = {mode: 'prepend'};
		expect(p.mode).toBe('prepend');
	});

	it('accepts insertUnderHeading with heading', () => {
		const p: NoteWritePartial = {mode: 'insertUnderHeading', heading: 'Summary'};
		expect(p.mode).toBe('insertUnderHeading');
	});

	it('accepts insertUnderHeading with headingPath', () => {
		const p: NoteWritePartial = {mode: 'insertUnderHeading', headingPath: ['Results']};
		expect(p.mode).toBe('insertUnderHeading');
	});

	it('accepts replaceSection with heading', () => {
		const p: NoteWritePartial = {mode: 'replaceSection', heading: 'Intro'};
		expect(p.mode).toBe('replaceSection');
	});

	it('accepts replaceRange arm', () => {
		const p: NoteWritePartial = {mode: 'replaceRange', basis: 'char', start: 0, end: 100};
		expect(p.mode).toBe('replaceRange');
		if (p.mode === 'replaceRange') {
			expect(p.basis).toBe('char');
		}
	});
});

// ============================================================
// CoreReadRequest — partial field
// ============================================================

describe('CoreReadRequest with partial', () => {
	it('isCoreReadRequest still returns true when partial is set', () => {
		const req = makeReadRequest({
			partial: {mode: 'firstXChars', limit: 200},
		});
		expect(isCoreReadRequest(req)).toBe(true);
	});

	it('isCoreReadRequest still returns true with section partial', () => {
		const req = makeReadRequest({
			partial: {mode: 'section', heading: 'Intro'},
		});
		expect(isCoreReadRequest(req)).toBe(true);
	});

	it('partial is optional — omitting it works', () => {
		const req = makeReadRequest();
		expect(req.partial).toBeUndefined();
		expect(isCoreReadRequest(req)).toBe(true);
	});
});

// ============================================================
// CoreWriteRequest — notePartial field
// ============================================================

describe('CoreWriteRequest with notePartial', () => {
	it('isCoreWriteRequest still returns true when notePartial is set', () => {
		const req = makeWriteRequest({
			notePartial: {mode: 'append'},
		});
		expect(isCoreWriteRequest(req)).toBe(true);
	});

	it('isCoreWriteRequest still returns true with replaceRange notePartial', () => {
		const req = makeWriteRequest({
			notePartial: {mode: 'replaceRange', basis: 'line', start: 3, end: 7},
		});
		expect(isCoreWriteRequest(req)).toBe(true);
	});

	it('notePartial is optional — omitting it works', () => {
		const req = makeWriteRequest();
		expect(req.notePartial).toBeUndefined();
		expect(isCoreWriteRequest(req)).toBe(true);
	});

	it('mode stays as FrontmatterWriteMode — does not accept notePartial modes', () => {
		// FrontmatterWriteMode stays typed as 'merge' | 'replace'; notePartial is separate.
		const req = makeWriteRequest({mode: 'merge', notePartial: {mode: 'prepend'}});
		expect(req.mode).toBe('merge');
		expect(req.notePartial?.mode).toBe('prepend');
	});
});

// ============================================================
// CoreFileResult — truncated field
// ============================================================

describe('CoreFileResult with truncated', () => {
	it('truncated is optional and defaults to absent', () => {
		const result: CoreFileResult = {
			path: 'notes/test.md',
			content: '# Hello',
			created: 1700000000000,
			modified: 1700000001000,
			size: 100,
		};
		expect(result.truncated).toBeUndefined();
	});

	it('truncated can be set to true for partial reads', () => {
		const result: CoreFileResult = {
			path: 'notes/test.md',
			content: 'partial content…',
			created: 1700000000000,
			modified: 1700000001000,
			size: 100,
			truncated: true,
		};
		expect(result.truncated).toBe(true);
	});

	it('truncated can be set to false explicitly', () => {
		const result: CoreFileResult = {
			path: 'notes/test.md',
			content: 'full content',
			created: 1700000000000,
			modified: 1700000001000,
			size: 100,
			truncated: false,
		};
		expect(result.truncated).toBe(false);
	});
});
