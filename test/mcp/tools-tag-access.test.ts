/**
 * Tool-layer tests for tag access rules (#81): tagAllow / tagDeny enforced on
 * top of the real permission chain for single-note operations.
 */

import {describe, it, expect, vi} from 'vitest';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {App} from 'obsidian';
import {registerTools} from '../../src/mcp/tools';
import type {ToolDependencies} from '../../src/mcp/tools';
import {createDefaultGateChain} from '../../src/core/permission-chain';
import {createDefaultApiKeyConfig, createDefaultConfig} from '../../src/types/canonical';
import type {DataTypePermissions, KadoConfig, NoteTagSource} from '../../src/types/canonical';
import type {ConfigManager} from '../../src/core/config-manager';
import {TFile, TFolder} from '../__mocks__/obsidian';

const KEY_ID = 'kado_tag-key';

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>;

function allPermissions(): DataTypePermissions {
	const all = {create: true, read: true, update: true, delete: true};
	return {note: {...all}, frontmatter: {...all}, file: {...all}, dataviewInlineField: {...all}};
}

function makeConfig(rules: {
	globalAllow?: string[]; globalDeny?: string[]; keyAllow?: string[]; keyDeny?: string[];
} = {}): KadoConfig {
	const config = createDefaultConfig();
	config.security.paths = [{path: '**', permissions: allPermissions()}];
	config.security.tagAllow = rules.globalAllow ?? [];
	config.security.tagDeny = rules.globalDeny ?? [];
	config.apiKeys = [createDefaultApiKeyConfig({
		id: KEY_ID,
		paths: [{path: '**', permissions: allPermissions()}],
		tagAllow: rules.keyAllow ?? [],
		tagDeny: rules.keyDeny ?? [],
	})];
	return config;
}

/** Tag source backed by a path → tags map; unknown paths are null (missing/unindexed). */
function makeTagSource(tagsByPath: Record<string, string[]>): NoteTagSource {
	return {
		readTags: vi.fn(async (path: string) => tagsByPath[path] ?? null),
		cachedTags: vi.fn((path: string) => tagsByPath[path] ?? null),
		tagsOfContent: vi.fn((content: string) => Array.from(content.matchAll(/#([\w/]+)/g), (m) => m[1] ?? '')),
	};
}

function makeApp(folder?: TFolder): App {
	return {
		vault: {
			getAbstractFileByPath: vi.fn((p: string) => (folder && p === folder.path ? folder : null)),
		},
		workspace: {activeLeaf: null, getLeavesOfType: vi.fn(() => [])},
	} as unknown as App;
}

function makeDeps(config: KadoConfig, overrides: Partial<ToolDependencies> = {}): ToolDependencies {
	return {
		configManager: {getConfig: () => config} as unknown as ConfigManager,
		gates: createDefaultGateChain(),
		router: vi.fn(async () => ({path: 'x.md', content: 'body', created: 1, modified: 2, size: 4})),
		getFileMtime: vi.fn(() => 5000),
		app: makeApp(),
		onActivity: vi.fn(),
		...overrides,
	};
}

function handler(name: string, deps: ToolDependencies): Handler {
	const tools: Array<{name: string; handler: Handler}> = [];
	const server = {registerTool: (n: string, _s: unknown, h: Handler) => { tools.push({name: n, handler: h}); }};
	registerTools(server as unknown as Parameters<typeof registerTools>[0], deps);
	return tools.find((t) => t.name === name)!.handler;
}

const extra = {authInfo: {token: KEY_ID, clientId: KEY_ID, scopes: []}};

function errorOf(result: CallToolResult): {code: string; message: string} {
	expect(result.isError).toBe(true);
	const first = result.content[0] as {text: string};
	return JSON.parse(first.text) as {code: string; message: string};
}

/** The gate named by the last denied activity event (the response body carries no gate). */
function deniedGate(deps: ToolDependencies): string | undefined {
	const calls = vi.mocked(deps.onActivity!).mock.calls;
	const last = calls[calls.length - 1]?.[0];
	return last?.decision === 'denied' ? last.gate : undefined;
}

describe('tag access — kado-read', () => {
	it('reads a note carrying an allowed tag', async () => {
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {tagSource: makeTagSource({'n.md': ['Work']})});
		const result = await handler('kado-read', deps)({operation: 'note', path: 'n.md'}, extra);
		expect(result.isError).toBeFalsy();
		expect(deps.router).toHaveBeenCalled();
	});

	it('denies an untagged note under tagAllow and never reaches the adapter', async () => {
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {tagSource: makeTagSource({'n.md': []})});
		const err = errorOf(await handler('kado-read', deps)({operation: 'note', path: 'n.md'}, extra));
		expect(err.code).toBe('FORBIDDEN');
		expect(deniedGate(deps)).toBe('tag-access');
		expect(deps.router).not.toHaveBeenCalled();
	});

	it('denies a note with a denied tag even when allowed (deny wins)', async () => {
		const deps = makeDeps(makeConfig({keyAllow: ['Work'], globalDeny: ['Private']}), {tagSource: makeTagSource({'n.md': ['Work', 'Private']})});
		const err = errorOf(await handler('kado-read', deps)({operation: 'frontmatter', path: 'n.md'}, extra));
		expect(err.message).toContain('#Private');
	});

	it('applies to the tags read operation', async () => {
		const deps = makeDeps(makeConfig({keyDeny: ['Private']}), {tagSource: makeTagSource({'n.md': ['Private']})});
		expect(errorOf(await handler('kado-read', deps)({operation: 'tags', path: 'n.md'}, extra)).code).toBe('FORBIDDEN');
		expect(deniedGate(deps)).toBe('tag-access');
	});

	it('does not apply to file reads (attachments stay path-only)', async () => {
		const tagSource = makeTagSource({});
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {tagSource});
		const result = await handler('kado-read', deps)({operation: 'file', path: 'a.png'}, extra);
		expect(result.isError).toBeFalsy();
		expect(tagSource.readTags).not.toHaveBeenCalled();
	});

	it('skips tag lookup entirely when no rules are configured', async () => {
		const tagSource = makeTagSource({});
		const deps = makeDeps(makeConfig(), {tagSource});
		const result = await handler('kado-read', deps)({operation: 'note', path: 'n.md'}, extra);
		expect(result.isError).toBeFalsy();
		expect(tagSource.readTags).not.toHaveBeenCalled();
	});

	it('fails closed when rules exist but no tag source is wired', async () => {
		const deps = makeDeps(makeConfig({keyDeny: ['Private']}));
		expect(errorOf(await handler('kado-read', deps)({operation: 'note', path: 'n.md'}, extra)).code).toBe('FORBIDDEN');
		expect(deniedGate(deps)).toBe('tag-access');
	});
});

describe('tag access — kado-write', () => {
	it('creates a note whose new content carries an allowed tag', async () => {
		const tagSource = makeTagSource({});
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {
			tagSource,
			getFileMtime: vi.fn(() => undefined),
			router: vi.fn(async () => ({path: 'new.md', created: 1, modified: 1})),
		});
		const result = await handler('kado-write', deps)({operation: 'note', path: 'new.md', content: 'hello #Work'}, extra);
		expect(result.isError).toBeFalsy();
		expect(tagSource.tagsOfContent).toHaveBeenCalledWith('hello #Work');
		expect(tagSource.readTags).not.toHaveBeenCalled();
	});

	it('denies creating a note without an allowed tag', async () => {
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {tagSource: makeTagSource({}), getFileMtime: vi.fn(() => undefined)});
		const err = errorOf(await handler('kado-write', deps)({operation: 'note', path: 'new.md', content: 'untagged'}, extra));
		expect(deniedGate(deps)).toBe('tag-access');
		expect(deps.router).not.toHaveBeenCalled();
	});

	it('denies creating a note whose content carries a denied tag', async () => {
		const deps = makeDeps(makeConfig({keyDeny: ['Private']}), {tagSource: makeTagSource({}), getFileMtime: vi.fn(() => undefined)});
		expect(errorOf(await handler('kado-write', deps)({operation: 'note', path: 'new.md', content: '#Private'}, extra)).code).toBe('FORBIDDEN');
		expect(deniedGate(deps)).toBe('tag-access');
	});

	it('checks the current tags on update, not the new content', async () => {
		const tagSource = makeTagSource({'n.md': []});
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {tagSource});
		const args = {operation: 'note', path: 'n.md', content: 'now #Work', expectedModified: 5000};
		expect(errorOf(await handler('kado-write', deps)(args, extra)).code).toBe('FORBIDDEN');
		expect(deniedGate(deps)).toBe('tag-access');
		expect(tagSource.readTags).toHaveBeenCalledWith('n.md');
		expect(tagSource.tagsOfContent).not.toHaveBeenCalled();
	});

	it('allows a frontmatter update on a note in tag scope', async () => {
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {
			tagSource: makeTagSource({'n.md': ['Work']}),
			router: vi.fn(async () => ({path: 'n.md', created: 1, modified: 6000})),
		});
		const args = {operation: 'frontmatter', path: 'n.md', content: {status: 'done'}, expectedModified: 5000};
		expect((await handler('kado-write', deps)(args, extra)).isError).toBeFalsy();
	});

	it('checks current tags for a partial append to an existing note', async () => {
		const deps = makeDeps(makeConfig({keyDeny: ['Private']}), {tagSource: makeTagSource({'n.md': ['Private']})});
		const args = {operation: 'note', path: 'n.md', content: 'more', mode: 'append'};
		expect(errorOf(await handler('kado-write', deps)(args, extra)).code).toBe('FORBIDDEN');
		expect(deniedGate(deps)).toBe('tag-access');
	});
});

describe('tag access — kado-delete', () => {
	it('denies deleting a note outside tag scope', async () => {
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {tagSource: makeTagSource({'n.md': ['Home']})});
		const err = errorOf(await handler('kado-delete', deps)({operation: 'note', path: 'n.md', expectedModified: 5000}, extra));
		expect(deniedGate(deps)).toBe('tag-access');
		expect(deps.router).not.toHaveBeenCalled();
	});

	it('allows deleting a note in tag scope', async () => {
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {
			tagSource: makeTagSource({'n.md': ['Work']}),
			router: vi.fn(async () => ({path: 'n.md'})),
		});
		expect((await handler('kado-delete', deps)({operation: 'note', path: 'n.md', expectedModified: 5000}, extra)).isError).toBeFalsy();
	});
});

describe('tag access — kado-rename', () => {
	it('denies renaming a source note outside tag scope', async () => {
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {tagSource: makeTagSource({'a.md': []})});
		const args = {operation: 'note', source: 'a.md', target: 'b.md', expectedModified: 5000};
		expect(errorOf(await handler('kado-rename', deps)(args, extra)).code).toBe('FORBIDDEN');
		expect(deniedGate(deps)).toBe('tag-access');
		expect(deps.router).not.toHaveBeenCalled();
	});

	it('allows renaming a source note in tag scope', async () => {
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {
			tagSource: makeTagSource({'a.md': ['Work']}),
			router: vi.fn(async () => ({source: 'a.md', target: 'b.md', modified: 6000})),
		});
		const args = {operation: 'note', source: 'a.md', target: 'b.md', expectedModified: 5000};
		expect((await handler('kado-rename', deps)(args, extra)).isError).toBeFalsy();
	});

	function makeFolder(path: string, files: string[]): TFolder {
		const folder = new TFolder();
		folder.path = path;
		folder.children = files.map((p) => {
			const f = new TFile();
			f.path = p;
			f.extension = p.endsWith('.md') ? 'md' : 'png';
			return f;
		});
		return folder;
	}

	it('denies a folder rename when any descendant note fails the tag rules', async () => {
		const folder = makeFolder('F', ['F/a.md', 'F/b.md', 'F/img.png']);
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {
			app: makeApp(folder),
			tagSource: makeTagSource({'F/a.md': ['Work'], 'F/b.md': []}),
		});
		const err = errorOf(await handler('kado-rename', deps)({operation: 'folder', source: 'F', target: 'G'}, extra));
		expect(deniedGate(deps)).toBe('tag-access');
		expect(err.message).toContain('F/b.md');
	});

	it('allows a folder rename when every descendant note passes (non-markdown ignored)', async () => {
		const folder = makeFolder('F', ['F/a.md', 'F/img.png']);
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {
			app: makeApp(folder),
			tagSource: makeTagSource({'F/a.md': ['Work']}),
			router: vi.fn(async () => ({source: 'F', target: 'G', modified: 0})),
		});
		expect((await handler('kado-rename', deps)({operation: 'folder', source: 'F', target: 'G'}, extra)).isError).toBeFalsy();
	});
});

describe('tag access — kado-graph source', () => {
	it('denies graph navigation from a source note outside tag scope', async () => {
		const deps = makeDeps(makeConfig({keyDeny: ['Private']}), {tagSource: makeTagSource({'s.md': ['Private']})});
		expect(errorOf(await handler('kado-graph', deps)({operation: 'outgoing', path: 's.md'}, extra)).code).toBe('FORBIDDEN');
		expect(deniedGate(deps)).toBe('tag-access');
		expect(deps.router).not.toHaveBeenCalled();
	});
});
