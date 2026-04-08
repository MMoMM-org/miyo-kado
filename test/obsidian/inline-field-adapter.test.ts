/**
 * Behavioral tests for InlineFieldAdapter and parseInlineFields.
 *
 * Tests the parsing and modification of Dataview inline fields through
 * the public read() and write() methods, plus the pure parseInlineFields
 * function for parsing edge cases.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {App, TFile} from '../__mocks__/obsidian';
import {parseInlineFields, createInlineFieldAdapter} from '../../src/obsidian/inline-field-adapter';
import type {CoreReadRequest, CoreWriteRequest} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeReadRequest(path = 'notes/test.md'): CoreReadRequest {
	return {apiKeyId: 'kado_test-key', operation: 'dataview-inline-field', path};
}

function makeWriteRequest(overrides: Partial<CoreWriteRequest> = {}): CoreWriteRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'dataview-inline-field',
		path: 'notes/test.md',
		content: {},
		...overrides,
	};
}

function makeTFile(overrides: Partial<{path: string; ctime: number; mtime: number; size: number}> = {}): TFile {
	const file = new TFile();
	file.path = overrides.path ?? 'notes/test.md';
	file.stat = {
		ctime: overrides.ctime ?? 1000,
		mtime: overrides.mtime ?? 2000,
		size: overrides.size ?? 100,
	};
	return file;
}

// ---------------------------------------------------------------------------
// parseInlineFields — parsing unit tests
// ---------------------------------------------------------------------------

describe('parseInlineFields', () => {
	it('parses a bare field', () => {
		const fields = parseInlineFields('rating:: 8');
		expect(fields).toHaveLength(1);
		expect(fields[0]).toMatchObject({key: 'rating', value: '8', wrapping: 'none'});
	});

	it('parses a bracket field', () => {
		const fields = parseInlineFields('Some text [status:: done] more text');
		expect(fields).toHaveLength(1);
		expect(fields[0]).toMatchObject({key: 'status', value: 'done', wrapping: 'bracket'});
	});

	it('parses a paren field', () => {
		const fields = parseInlineFields('Some text (priority:: high) more text');
		expect(fields).toHaveLength(1);
		expect(fields[0]).toMatchObject({key: 'priority', value: 'high', wrapping: 'paren'});
	});

	it('skips fields inside fenced code blocks', () => {
		const content = '```\nrating:: 8\n```';
		const fields = parseInlineFields(content);
		expect(fields).toHaveLength(0);
	});

	it('skips fields inside YAML frontmatter', () => {
		const content = '---\nrating:: 8\n---\n\nActual content';
		const fields = parseInlineFields(content);
		expect(fields).toHaveLength(0);
	});

	it('parses multiple bracket fields on one line', () => {
		const fields = parseInlineFields('Text [status:: done] and [priority:: high]');
		expect(fields).toHaveLength(2);
		expect(fields[0]).toMatchObject({key: 'status', value: 'done'});
		expect(fields[1]).toMatchObject({key: 'priority', value: 'high'});
	});

	it('parses bare field with list marker stripped', () => {
		const fields = parseInlineFields('- due:: 2024-01-01');
		expect(fields).toHaveLength(1);
		expect(fields[0]).toMatchObject({key: 'due', value: '2024-01-01', wrapping: 'none'});
	});

	it('parses field with spaces in key', () => {
		const fields = parseInlineFields('start date:: 2024-01-01');
		expect(fields).toHaveLength(1);
		expect(fields[0]).toMatchObject({key: 'start date', value: '2024-01-01'});
	});

	it('returns empty value for empty bare field', () => {
		const fields = parseInlineFields('key::');
		expect(fields).toHaveLength(1);
		expect(fields[0]).toMatchObject({key: 'key', value: ''});
	});

	it('returns line, start, and end positions on the InlineField', () => {
		const fields = parseInlineFields('rating:: 8');
		expect(fields[0]).toMatchObject({line: 0, start: 0});
		expect(typeof fields[0].end).toBe('number');
	});

	it('does not parse fields inside non-opening frontmatter block mid-document', () => {
		// --- mid-document is NOT frontmatter; field should be parsed
		const content = 'Some content\n---\nrating:: 8\n---\n';
		const fields = parseInlineFields(content);
		expect(fields).toHaveLength(1);
		expect(fields[0]).toMatchObject({key: 'rating', value: '8'});
	});
});

// ---------------------------------------------------------------------------
// InlineFieldAdapter — read() tests
// ---------------------------------------------------------------------------

describe('InlineFieldAdapter read()', () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it('returns CoreFileResult with content as Record of parsed fields', async () => {
		const file = makeTFile({ctime: 1000, mtime: 2000, size: 50});
		vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
		vi.mocked(app.vault.read).mockResolvedValue('rating:: 8\n[status:: done]');

		const adapter = createInlineFieldAdapter(app);
		const result = await adapter.read(makeReadRequest());

		expect(result.path).toBe('notes/test.md');
		expect(result.created).toBe(1000);
		expect(result.modified).toBe(2000);
		expect(result.content).toEqual({rating: '8', status: 'done'});
	});

	it('returns empty Record when file has no inline fields', async () => {
		const file = makeTFile();
		vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
		vi.mocked(app.vault.read).mockResolvedValue('# Just a heading\n\nSome regular text.');

		const adapter = createInlineFieldAdapter(app);
		const result = await adapter.read(makeReadRequest());

		expect(result.content).toEqual({});
	});

	it('merges duplicate keys into an array', async () => {
		const file = makeTFile();
		vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
		vi.mocked(app.vault.read).mockResolvedValue('[tag:: a] [tag:: b]');

		const adapter = createInlineFieldAdapter(app);
		const result = await adapter.read(makeReadRequest());

		expect(result.content).toEqual({tag: ['a', 'b']});
	});

	it('throws NOT_FOUND when file does not exist', async () => {
		vi.mocked(app.vault.getFileByPath).mockReturnValue(null);

		const adapter = createInlineFieldAdapter(app);

		await expect(adapter.read(makeReadRequest('notes/missing.md'))).rejects.toMatchObject({
			code: 'NOT_FOUND',
			message: expect.stringContaining('notes/missing.md'),
		});
	});
});

// ---------------------------------------------------------------------------
// InlineFieldAdapter — write() tests
// ---------------------------------------------------------------------------

describe('InlineFieldAdapter write()', () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	/** Stub vault.process to feed `initial` to the transform and capture the result. */
	function stubProcess(initial: string): {captured: () => string | undefined} {
		let captured: string | undefined;
		vi.mocked(app.vault.process).mockImplementation(async (_file: unknown, fn: unknown) => {
			const transform = fn as (data: string) => string;
			captured = transform(initial);
			return captured;
		});
		return {captured: () => captured};
	}

	it('modifies a bare field value preserving surrounding text', async () => {
		const file = makeTFile({ctime: 1000, mtime: 3000, size: 20});
		vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
		const captured = stubProcess('rating:: 8\nother text');

		const adapter = createInlineFieldAdapter(app);
		await adapter.write(makeWriteRequest({content: {rating: '10'}}));

		const written = captured.captured() ?? '';
		expect(written).toContain('rating:: 10');
		expect(written).toContain('other text');
	});

	it('modifies a bracket field preserving [key:: newValue] wrapping', async () => {
		const file = makeTFile({ctime: 1000, mtime: 3000, size: 30});
		vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
		const captured = stubProcess('Text [status:: done] more');

		const adapter = createInlineFieldAdapter(app);
		await adapter.write(makeWriteRequest({content: {status: 'in-progress'}}));

		const written = captured.captured() ?? '';
		expect(written).toContain('[status:: in-progress]');
		expect(written).toContain('Text');
		expect(written).toContain('more');
	});

	it('modifies a paren field preserving (key:: newValue) wrapping', async () => {
		const file = makeTFile({ctime: 1000, mtime: 3000, size: 30});
		vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
		const captured = stubProcess('Text (priority:: low) more');

		const adapter = createInlineFieldAdapter(app);
		await adapter.write(makeWriteRequest({content: {priority: 'high'}}));

		const written = captured.captured() ?? '';
		expect(written).toContain('(priority:: high)');
	});

	it('returns CoreWriteResult with path and timestamps', async () => {
		const file = makeTFile({ctime: 1000, mtime: 4000, size: 20});
		vi.mocked(app.vault.getFileByPath).mockReturnValue(file);
		stubProcess('rating:: 8');

		const adapter = createInlineFieldAdapter(app);
		const result = await adapter.write(makeWriteRequest({content: {rating: '9'}}));

		expect(result).toEqual({
			path: 'notes/test.md',
			created: 1000,
			modified: 4000,
		});
	});

	it('throws NOT_FOUND when file does not exist', async () => {
		vi.mocked(app.vault.getFileByPath).mockReturnValue(null);

		const adapter = createInlineFieldAdapter(app);

		await expect(
			adapter.write(makeWriteRequest({path: 'notes/missing.md', content: {key: 'val'}})),
		).rejects.toMatchObject({
			code: 'NOT_FOUND',
			message: expect.stringContaining('notes/missing.md'),
		});
		expect(app.vault.process).not.toHaveBeenCalled();
	});

	it('throws VALIDATION_ERROR when content is not a Record', async () => {
		const file = makeTFile();
		vi.mocked(app.vault.getFileByPath).mockReturnValue(file);

		const adapter = createInlineFieldAdapter(app);

		await expect(
			adapter.write(makeWriteRequest({content: 'plain string'})),
		).rejects.toMatchObject({
			code: 'VALIDATION_ERROR',
		});
	});
});
