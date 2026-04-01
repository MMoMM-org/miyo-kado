/**
 * InlineFieldAdapter — Obsidian Interface layer adapter for Dataview inline fields.
 *
 * Parses and modifies Dataview inline fields embedded in note content.
 * Supports bare (key:: value), bracket ([key:: value]), and paren ((key:: value)) syntax.
 * Fields inside fenced code blocks or YAML frontmatter are skipped.
 */

import type {App} from 'obsidian';
import type {ReadWriteAdapter} from '../core/operation-router';
import type {CoreReadRequest, CoreWriteRequest, CoreFileResult, CoreWriteResult, CoreError, CoreErrorCode} from '../types/canonical';

// ============================================================
// Types
// ============================================================

export interface InlineField {
	key: string;
	value: string;
	line: number;
	start: number;
	end: number;
	wrapping: 'none' | 'bracket' | 'paren';
}

// ============================================================
// Error class
// ============================================================

export class InlineFieldAdapterError extends Error {
	readonly code: CoreErrorCode;

	constructor(error: CoreError) {
		super(error.message);
		this.code = error.code;
	}
}

// ============================================================
// Regex patterns
// ============================================================

const BRACKET_RE = /\[([^[\]#*_`:]+?)\s*::\s*([^\]]*?)]/g;
const PAREN_RE = /\(([^()#*_`:]+?)\s*::\s*([^)]*?)\)/g;
const BARE_RE = /^([^\n[\]()#*_`:]+\w)\s*::\s*(.*)$/;
const LIST_MARKER_RE = /^(?:- |\* |\d+\. )/;

// ============================================================
// Pure parsing function
// ============================================================

/**
 * Parses all Dataview inline fields from a string of note content.
 * Fields inside fenced code blocks or YAML frontmatter are excluded.
 */
export function parseInlineFields(content: string): InlineField[] {
	const lines = content.split('\n');
	const results: InlineField[] = [];
	const skippedLines = buildSkippedLineSet(lines);

	let charOffset = 0;

	for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
		const line = lines[lineIdx] ?? '';

		if (!skippedLines.has(lineIdx)) {
			parseLineFields(line, lineIdx, charOffset, results);
		}

		charOffset += line.length + 1; // +1 for newline
	}

	return results;
}

function buildSkippedLineSet(lines: string[]): Set<number> {
	const skipped = new Set<number>();
	let inFence = false;
	let inFrontmatter = false;

	for (let i = 0; i < lines.length; i++) {
		const trimmed = (lines[i] ?? '').trim();

		if (i === 0 && trimmed === '---') {
			inFrontmatter = true;
			skipped.add(i);
			continue;
		}

		if (inFrontmatter) {
			skipped.add(i);
			if (trimmed === '---') {
				inFrontmatter = false;
			}
			continue;
		}

		if (trimmed.startsWith('```')) {
			inFence = !inFence;
			skipped.add(i);
			continue;
		}

		if (inFence) {
			skipped.add(i);
		}
	}

	return skipped;
}

function parseLineFields(line: string, lineIdx: number, charOffset: number, results: InlineField[]): void {
	// Try bracket and paren fields first — these can be anywhere in the line
	const prevLen = results.length;
	parseBracketFields(line, lineIdx, charOffset, results);
	parseParenFields(line, lineIdx, charOffset, results);

	// Only attempt bare field if no bracket/paren fields were found on this line
	// (bare fields are full-line, so mixing doesn't apply)
	if (results.length === prevLen) {
		parseBareField(line, lineIdx, charOffset, results);
	}
}

function parseBracketFields(line: string, lineIdx: number, charOffset: number, results: InlineField[]): void {
	BRACKET_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = BRACKET_RE.exec(line)) !== null) {
		const key = match[1] ?? '';
		const value = match[2] ?? '';
		results.push({
			key: key.trim(),
			value: value.trim(),
			line: lineIdx,
			start: charOffset + match.index,
			end: charOffset + match.index + match[0].length,
			wrapping: 'bracket',
		});
	}
}

function parseParenFields(line: string, lineIdx: number, charOffset: number, results: InlineField[]): void {
	PAREN_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = PAREN_RE.exec(line)) !== null) {
		const key = match[1] ?? '';
		const value = match[2] ?? '';
		results.push({
			key: key.trim(),
			value: value.trim(),
			line: lineIdx,
			start: charOffset + match.index,
			end: charOffset + match.index + match[0].length,
			wrapping: 'paren',
		});
	}
}

function parseBareField(line: string, lineIdx: number, charOffset: number, results: InlineField[]): void {
	const stripped = line.replace(LIST_MARKER_RE, '');
	const markerLength = line.length - stripped.length;
	const match = BARE_RE.exec(stripped);
	if (!match) return;

	const rawKey = match[1] ?? '';
	const rawValue = match[2] ?? '';
	const key = rawKey.trim();
	const value = rawValue.trim();
	const fullMatch = `${rawKey}:: ${rawValue}`;

	results.push({
		key,
		value,
		line: lineIdx,
		start: charOffset + markerLength,
		end: charOffset + markerLength + fullMatch.length,
		wrapping: 'none',
	});
}

// ============================================================
// Result aggregation
// ============================================================

function aggregateFields(fields: InlineField[]): Record<string, string | string[]> {
	const result: Record<string, string | string[]> = {};

	for (const field of fields) {
		const existing = result[field.key];
		if (existing === undefined) {
			result[field.key] = field.value;
		} else if (Array.isArray(existing)) {
			existing.push(field.value);
		} else {
			result[field.key] = [existing, field.value];
		}
	}

	return result;
}

// ============================================================
// Error helpers
// ============================================================

function notFoundError(path: string): InlineFieldAdapterError {
	return new InlineFieldAdapterError({code: 'NOT_FOUND', message: `Inline field file not found: ${path}`});
}

function validationError(message: string): InlineFieldAdapterError {
	return new InlineFieldAdapterError({code: 'VALIDATION_ERROR', message});
}

// ============================================================
// Adapter operations
// ============================================================

async function readFields(app: App, request: CoreReadRequest): Promise<CoreFileResult> {
	const file = app.vault.getFileByPath(request.path);
	if (!file) throw notFoundError(request.path);

	const content = await app.vault.read(file);
	const fields = parseInlineFields(content);
	const record = aggregateFields(fields);

	return {
		path: request.path,
		content: record,
		created: file.stat.ctime,
		modified: file.stat.mtime,
		size: file.stat.size,
	};
}

function assertRecordContent(content: CoreWriteRequest['content']): asserts content is Record<string, unknown> {
	if (typeof content !== 'object' || content === null || content instanceof ArrayBuffer) {
		throw validationError('InlineFieldAdapter write() requires content to be a Record<string, unknown>');
	}
}

async function writeFields(app: App, request: CoreWriteRequest): Promise<CoreWriteResult> {
	assertRecordContent(request.content);

	const file = app.vault.getFileByPath(request.path);
	if (!file) throw notFoundError(request.path);

	const original = await app.vault.read(file);
	const updates = applyFieldUpdates(original, request.content);
	await app.vault.modify(file, updates);

	const refreshed = app.vault.getFileByPath(request.path);
	const stat = refreshed?.stat ?? file.stat;
	return {path: request.path, created: stat.ctime, modified: stat.mtime};
}

function applyFieldUpdates(content: string, updates: Record<string, unknown>): string {
	let result = content;

	// Process bracket and paren replacements on full content
	for (const [key, newValue] of Object.entries(updates)) {
		const valueStr = String(newValue);
		result = applyBracketOrParenUpdate(result, key, valueStr);
	}

	// Process bare field updates in a single split-join pass
	const lines = result.split('\n');
	const bareUpdates = new Map<string, string>();
	for (const [key, newValue] of Object.entries(updates)) {
		bareUpdates.set(key, String(newValue));
	}

	const updatedLines = lines.map(line => {
		const stripped = line.replace(LIST_MARKER_RE, '');
		const markerLength = line.length - stripped.length;
		const match = BARE_RE.exec(stripped);
		if (match) {
			const matchedKey = (match[1] ?? '').trim();
			const bareValue = bareUpdates.get(matchedKey);
			if (bareValue !== undefined) {
				const marker = line.slice(0, markerLength);
				return `${marker}${matchedKey}:: ${bareValue}`;
			}
		}
		return line;
	});

	return updatedLines.join('\n');
}

function applyBracketOrParenUpdate(content: string, key: string, newValue: string): string {
	// Try bracket first
	const bracketRe = new RegExp(`\\[${escapeRegex(key)}\\s*::\\s*[^\\]]*?\\]`, 'g');
	const bracketResult = content.replace(bracketRe, () => `[${key}:: ${newValue}]`);
	if (bracketResult !== content) return bracketResult;

	// Try paren
	const parenRe = new RegExp(`\\(${escapeRegex(key)}\\s*::\\s*[^)]*?\\)`, 'g');
	const parenResult = content.replace(parenRe, () => `(${key}:: ${newValue})`);
	if (parenResult !== content) return parenResult;

	return content;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// Factory
// ============================================================

export function createInlineFieldAdapter(app: App): ReadWriteAdapter {
	return {
		read: (request: CoreReadRequest) => readFields(app, request),
		write: (request: CoreWriteRequest) => writeFields(app, request),
	};
}
