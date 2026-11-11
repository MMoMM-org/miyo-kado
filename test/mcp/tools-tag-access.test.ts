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
import {createSearchAdapter} from '../../src/obsidian/search-adapter';
import {createNoteTagSource} from '../../src/obsidian/note-tag-source';

const KEY_ID = 'kado_tag-key';

/** Client-facing denial texts: identical for every reason, so they disclose nothing about hidden notes. */
const TAG_DENIAL_MESSAGE = 'Access denied by tag rules.';
const FOLDER_TAG_DENIAL_MESSAGE = 'Rename blocked: the folder contains notes this key may not access (tag rules).';

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
		expect(err.message).toBe(TAG_DENIAL_MESSAGE);
		expect(err.message).not.toContain('Private');
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

describe('tag access — no disclosure in client messages', () => {
	it('returns the same message for a missing note, an untagged note and a denied tag', async () => {
		const config = makeConfig({keyAllow: ['Work'], keyDeny: ['Private']});
		const deps = makeDeps(config, {tagSource: makeTagSource({'untagged.md': [], 'private.md': ['Work', 'Private']})});
		const read = handler('kado-read', deps);
		const messages = await Promise.all(['missing.md', 'untagged.md', 'private.md'].map(
			async (path) => errorOf(await read({operation: 'note', path}, extra)).message,
		));
		expect(new Set(messages)).toEqual(new Set([TAG_DENIAL_MESSAGE]));
	});

	it('still records the tag-access gate for the audit log', async () => {
		const deps = makeDeps(makeConfig({keyDeny: ['Private']}), {tagSource: makeTagSource({'p.md': ['Private']})});
		await handler('kado-read', deps)({operation: 'note', path: 'p.md'}, extra);
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

describe('tag access — other note-level writes and deletes', () => {
	it('denies a dataview inline-field write on a note outside tag scope', async () => {
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {tagSource: makeTagSource({'n.md': []})});
		const args = {operation: 'dataview-inline-field', path: 'n.md', content: {status: 'x'}, expectedModified: 5000};
		expect(errorOf(await handler('kado-write', deps)(args, extra)).message).toBe(TAG_DENIAL_MESSAGE);
		expect(deps.router).not.toHaveBeenCalled();
	});

	it('denies a full overwrite of an existing note outside tag scope even if the new body is tagged', async () => {
		const tagSource = makeTagSource({'n.md': ['Home']});
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {tagSource});
		const args = {operation: 'note', path: 'n.md', content: '#Work now', expectedModified: 5000};
		expect(errorOf(await handler('kado-write', deps)(args, extra)).message).toBe(TAG_DENIAL_MESSAGE);
		expect(tagSource.tagsOfContent).not.toHaveBeenCalled();
	});

	it('denies removing frontmatter keys from a note carrying a denied tag', async () => {
		const deps = makeDeps(makeConfig({keyDeny: ['Private']}), {tagSource: makeTagSource({'n.md': ['Private']})});
		const args = {operation: 'frontmatter', path: 'n.md', keys: ['tags'], expectedModified: 5000};
		expect(errorOf(await handler('kado-delete', deps)(args, extra)).message).toBe(TAG_DENIAL_MESSAGE);
		expect(deps.router).not.toHaveBeenCalled();
	});

	it('allows removing frontmatter keys from a note in tag scope', async () => {
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {
			tagSource: makeTagSource({'n.md': ['Work']}),
			router: vi.fn(async () => ({path: 'n.md'})),
		});
		const args = {operation: 'frontmatter', path: 'n.md', keys: ['status'], expectedModified: 5000};
		expect((await handler('kado-delete', deps)(args, extra)).isError).toBeFalsy();
	});

	it('leaves an empty-folder delete path-only', async () => {
		const tagSource = makeTagSource({});
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {tagSource, router: vi.fn(async () => ({path: 'Empty'}))});
		expect((await handler('kado-delete', deps)({operation: 'folder', path: 'Empty'}, extra)).isError).toBeFalsy();
		expect(tagSource.readTags).not.toHaveBeenCalled();
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
		expect(err.message).toBe(FOLDER_TAG_DENIAL_MESSAGE);
		expect(err.message).not.toContain('F/b.md');
	});

	it('checks upper-case .MD descendants in a folder rename', async () => {
		const folder = makeFolder('F', ['F/a.MD']);
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {app: makeApp(folder), tagSource: makeTagSource({'F/a.MD': []})});
		expect(errorOf(await handler('kado-rename', deps)({operation: 'folder', source: 'F', target: 'G'}, extra)).message).toBe(FOLDER_TAG_DENIAL_MESSAGE);
	});

	it('denies a folder rename when tag rules exist but the folder tree cannot be resolved', async () => {
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {app: makeApp(), tagSource: makeTagSource({})});
		const err = errorOf(await handler('kado-rename', deps)({operation: 'folder', source: 'Missing', target: 'Other'}, extra));
		expect(err.message).toBe(FOLDER_TAG_DENIAL_MESSAGE);
		expect(deps.router).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// Result-disclosure filters (search, graph, graph-audit, open-notes)
// ---------------------------------------------------------------------------

describe('tag access — result filters', () => {
	const tags = {'work.md': ['Work'], 'home.md': ['Home'], 'both.md': ['Work', 'Private'], 'untagged.md': []};

	it('kado-search hands the adapter a readablePath predicate that applies tag rules', async () => {
		const router = vi.fn(async () => ({items: [], total: 0}));
		const deps = makeDeps(makeConfig({keyAllow: ['Work'], keyDeny: ['Private']}), {router, tagSource: makeTagSource(tags)});
		await handler('kado-search', deps)({operation: 'byContent', query: 'x'}, extra);
		const routed = (router.mock.calls as unknown as [{readablePath: (p: string) => boolean}][])[0]![0];
		expect(routed.readablePath('work.md')).toBe(true);
		expect(routed.readablePath('home.md')).toBe(false);
		expect(routed.readablePath('both.md')).toBe(false);
		expect(routed.readablePath('untagged.md')).toBe(false);
		expect(routed.readablePath('unindexed.md')).toBe(false);
		expect(routed.readablePath('Attachments/a.png')).toBe(true);
	});

	it('kado-search readablePath applies tag rules to upper-case .MD notes', async () => {
		const router = vi.fn(async () => ({items: [], total: 0}));
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {router, tagSource: makeTagSource({'A.MD': ['Work'], 'B.MD': []})});
		await handler('kado-search', deps)({operation: 'listNotes'}, extra);
		const routed = (router.mock.calls as unknown as [{readablePath: (p: string) => boolean}][])[0]![0];
		expect(routed.readablePath('A.MD')).toBe(true);
		expect(routed.readablePath('B.MD')).toBe(false);
		expect(routed.readablePath('unknown.Md')).toBe(false);
	});

	it('kado-search readablePath ignores tags when no rules exist', async () => {
		const router = vi.fn(async () => ({items: [], total: 0}));
		const tagSource = makeTagSource(tags);
		const deps = makeDeps(makeConfig(), {router, tagSource});
		await handler('kado-search', deps)({operation: 'listNotes'}, extra);
		const routed = (router.mock.calls as unknown as [{readablePath: (p: string) => boolean}][])[0]![0];
		expect(routed.readablePath('unindexed.md')).toBe(true);
		expect(tagSource.cachedTags).not.toHaveBeenCalled();
	});

	it('kado-search post-filters results by tag rules when both scopes are blacklists', async () => {
		const config = makeConfig({keyAllow: ['Work']});
		config.security.listMode = 'blacklist';
		config.security.paths = [];
		config.apiKeys[0]!.listMode = 'blacklist';
		config.apiKeys[0]!.paths = [];
		const item = (path: string) => ({path, name: path, created: 1, modified: 1, size: 1});
		const router = vi.fn(async () => ({items: [item('work.md'), item('home.md')], total: 2}));
		const deps = makeDeps(config, {router, tagSource: makeTagSource(tags)});
		const result = await handler('kado-search', deps)({operation: 'byName', query: 'md'}, extra);
		const text = (result.content[0] as {text: string}).text;
		expect(text).toContain('work.md');
		expect(text).not.toContain('home.md');
	});

	it('kado-graph drops resolved nodes and via hops outside tag scope', async () => {
		const router = vi.fn(async () => ({
			source: 'work.md',
			operation: 'related' as const,
			nodes: [
				{path: 'work.md', relation: 'related' as const, via: ['home.md', 'work.md']},
				{path: 'home.md', relation: 'outgoing' as const},
			],
		}));
		const deps = makeDeps(makeConfig({keyAllow: ['Work']}), {router, tagSource: makeTagSource(tags)});
		const result = await handler('kado-graph', deps)({operation: 'related', path: 'work.md'}, extra);
		const body = JSON.parse((result.content[0] as {text: string}).text) as {nodes: Array<{path: string; via?: string[]}>};
		expect(body.nodes).toEqual([{path: 'work.md', relation: 'related', via: ['work.md']}]);
	});

	it('kado-graph-audit omits orphans and dead-link sources outside tag scope', async () => {
		const router = vi.fn(async () => ({
			orphans: [{path: 'work.md'}, {path: 'home.md'}],
			deadLinks: [{source: 'both.md', target: 'Secret', count: 1}, {source: 'work.md', target: 'Missing', count: 1}],
		}));
		const deps = makeDeps(makeConfig({keyAllow: ['Work'], keyDeny: ['Private']}), {router, tagSource: makeTagSource(tags)});
		const text = ((await handler('kado-graph-audit', deps)({}, extra)).content[0] as {text: string}).text;
		expect(text).toContain('work.md');
		expect(text).not.toContain('home.md');
		expect(text).not.toContain('Secret');
	});

	it('kado-open-notes filters open notes outside tag scope', async () => {
		const config = makeConfig({keyAllow: ['Work']});
		config.security.allowActiveNote = true;
		config.security.allowOtherNotes = true;
		config.apiKeys[0]!.allowActiveNote = true;
		config.apiKeys[0]!.allowOtherNotes = true;
		const leaf = (path: string) => {
			const file = new TFile();
			file.path = path;
			file.basename = path.replace(/\.md$/, '');
			return {view: {file, getViewType: () => 'markdown'}};
		};
		const app = {
			vault: {getAbstractFileByPath: vi.fn(() => null)},
			workspace: {activeLeaf: null, getLeavesOfType: vi.fn((type: string) => (type === 'markdown' ? [leaf('work.md'), leaf('home.md')] : []))},
		} as unknown as App;
		const deps = makeDeps(config, {app, tagSource: makeTagSource(tags)});
		const text = ((await handler('kado-open-notes', deps)({scope: 'all'}, extra)).content[0] as {text: string}).text;
		expect(text).toContain('work.md');
		expect(text).not.toContain('home.md');
	});
});

// ---------------------------------------------------------------------------
// Composition: real search adapter + real NoteTagSource over one fake vault,
// driven through kado-search — proves the OUTPUT is filtered, not just the
// predicate handed to the adapter.
// ---------------------------------------------------------------------------

describe('tag access — kado-search end to end over a fake vault', () => {
	type Cache = {tags?: {tag: string}[]; frontmatter?: Record<string, unknown>};
	const notes: Record<string, {cache: Cache; body: string}> = {
		'v/work.md': {cache: {frontmatter: {tags: ['Work'], status: 'open'}}, body: 'alpha project'},
		'v/home.md': {cache: {tags: [{tag: '#Home'}], frontmatter: {status: 'open'}}, body: 'alpha secret'},
		'v/both.md': {cache: {frontmatter: {tag: 'Private', tags: ['Work'], status: 'open'}}, body: 'alpha private'},
		'v/plain.md': {cache: {frontmatter: {status: 'open'}}, body: 'alpha plain'},
		'v/nested.md': {cache: {tags: [{tag: '#Work/ProjectA'}]}, body: 'alpha nested'},
	};

	function makeVaultApp(): App {
		const files = new Map<string, TFile>();
		for (const path of Object.keys(notes)) {
			const f = new TFile();
			f.path = path;
			f.name = path.split('/').pop() ?? path;
			f.basename = f.name.replace(/\.md$/, '');
			f.extension = 'md';
			files.set(path, f);
		}
		const all = [...files.values()];
		return {
			vault: {
				getMarkdownFiles: vi.fn(() => all),
				getFiles: vi.fn(() => all),
				getFileByPath: vi.fn((p: string) => files.get(p) ?? null),
				getAbstractFileByPath: vi.fn((p: string) => files.get(p) ?? null),
				read: vi.fn(async (f: TFile) => notes[f.path]?.body ?? ''),
				cachedRead: vi.fn(async (f: TFile) => notes[f.path]?.body ?? ''),
			},
			metadataCache: {getFileCache: vi.fn((f: TFile) => notes[f.path]?.cache ?? null)},
			workspace: {activeLeaf: null, getLeavesOfType: vi.fn(() => [])},
		} as unknown as App;
	}

	async function search(args: Record<string, unknown>): Promise<string[]> {
		const app = makeVaultApp();
		const adapter = createSearchAdapter(app);
		const deps = makeDeps(makeConfig({keyAllow: ['Work'], keyDeny: ['Private']}), {
			app,
			tagSource: createNoteTagSource(app),
			router: vi.fn(async (req) => adapter.search(req as Parameters<typeof adapter.search>[0])),
		});
		const result = await handler('kado-search', deps)(args, extra);
		expect(result.isError).toBeFalsy();
		const body = JSON.parse((result.content[0] as {text: string}).text) as {items: Array<{path: string}>};
		return body.items.map((i) => i.path).sort();
	}

	const allowed = ['v/nested.md', 'v/work.md'];

	it('byContent returns only notes passing the tag rules', async () => {
		expect(await search({operation: 'byContent', query: 'alpha'})).toEqual(allowed);
	});

	it('byFrontmatter returns only notes passing the tag rules', async () => {
		expect(await search({operation: 'byFrontmatter', query: 'status=open'})).toEqual(['v/work.md']);
	});

	it('byName with filter.tags returns only notes passing the tag rules', async () => {
		expect(await search({operation: 'byName', query: '*', filter: {tags: ['#Work']}})).toEqual(allowed);
	});

	it('byTag for an allowed tag works without extra search tags and hides the Private note', async () => {
		expect(await search({operation: 'byTag', query: '#Work'})).toEqual(['v/work.md']);
	});

	it('listTags counts only tags of visible notes', async () => {
		expect(await search({operation: 'listTags'})).toEqual(['#Work', '#Work/ProjectA']);
	});
});
