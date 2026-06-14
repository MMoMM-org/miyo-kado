/**
 * Live integration tests for partial note read/write (spec 007).
 *
 * Exercises the partial-RW modes end-to-end against a running Kado MCP server
 * inside Obsidian, with two-layer verification (MCP result + on-disk content).
 * Focuses on the behaviours hardened by the multi-agent review:
 *   - partial reads (firstXChars / section / range) + truncated semantics
 *   - partial writes (append / prepend / insertUnderHeading / replaceSection / replaceRange)
 *   - C1: prepend onto a frontmatter-only note never runs the fence into content
 *   - M4: replaceRange past EOF is rejected (VALIDATION_ERROR)
 *   - M3: out-of-bounds limit is rejected at the boundary
 *   - M2: non-string partial-write content is rejected
 *
 * Excluded from `npm test` — run via `npm run test:live`. Skips cleanly when the
 * server/vault/config isn't ready (mirrors mcp-live.test.ts preflight).
 */

import {describe, it, expect, beforeAll, afterAll, type TestContext} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {readFileSync, existsSync, unlinkSync, writeFileSync, copyFileSync, utimesSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// ============================================================
// Constants & environment detection
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../..');

const IS_DOCKER = existsSync('/.dockerenv') || existsSync('/proc/1/cgroup');
const MCP_HOST = process.env.KADO_MCP_HOST ?? (IS_DOCKER ? 'host.docker.internal' : '127.0.0.1');
const MCP_PORT = Number(process.env.KADO_MCP_PORT ?? '23026');
const MCP_URL = `http://${MCP_HOST}:${MCP_PORT}/mcp`;

const VAULT = resolve(REPO_ROOT, 'test/MiYo-Kado');
const KADO_DATA_JSON = resolve(VAULT, '.obsidian/plugins/miyo-kado/data.json');
const KADO_DATA_BACKUP = KADO_DATA_JSON + '.bak';
const KADO_MAIN_JS = resolve(KADO_DATA_JSON, '../main.js');
const FIXTURE_CONFIG_PATH = resolve(REPO_ROOT, 'test/fixtures/live-test-config.json');

const KEY1_PLACEHOLDER = 'kado_test-key1-full-access';

// Scratch files created under allowed/ (full CRUD for key1). Cleaned up via fs.
const SCRATCH = 'allowed/_live-partial-scratch.md';
const FMONLY = 'allowed/_live-partial-fmonly.md';
const SCRATCH_FS = resolve(VAULT, SCRATCH);
const FMONLY_FS = resolve(VAULT, FMONLY);

const BASE = '# Title\n\n## Alpha\nalpha body\n## Beta\nbeta body\n';

// ============================================================
// Helpers (key loading, config fixture, reload, MCP client)
// ============================================================

function loadApiKeyByName(name: string): string | null {
	try {
		const raw = readFileSync(resolve(REPO_ROOT, '.mcp.json'), 'utf-8');
		const config = JSON.parse(raw) as {mcpServers?: Record<string, {headers?: {Authorization?: string}}>};
		const auth = config?.mcpServers?.[name]?.headers?.Authorization ?? '';
		if (!auth || auth.includes('YOUR_API_KEY_HERE')) return null;
		return auth.startsWith('Bearer ') ? auth.slice(7) : auth;
	} catch {
		return null;
	}
}

function loadFirstApiKey(): string | null {
	try {
		const raw = readFileSync(resolve(REPO_ROOT, '.mcp.json'), 'utf-8');
		const config = JSON.parse(raw) as {mcpServers?: Record<string, {headers?: {Authorization?: string}}>};
		const first = Object.values(config?.mcpServers ?? {})[0];
		const auth = first?.headers?.Authorization ?? '';
		if (!auth || auth.includes('YOUR_API_KEY_HERE')) return null;
		return auth.startsWith('Bearer ') ? auth.slice(7) : auth;
	} catch {
		return null;
	}
}

/** Loads the fixture config and writes it to data.json (the fixture is ground truth). */
function loadAndWriteFixtureConfig(key1: string): boolean {
	try {
		if (!existsSync(FIXTURE_CONFIG_PATH)) return false;
		let raw = readFileSync(FIXTURE_CONFIG_PATH, 'utf-8');
		raw = raw.replace(new RegExp(KEY1_PLACEHOLDER, 'g'), key1);
		const parsed = JSON.parse(raw) as {apiKeys: Array<{id: string}>; [k: string]: unknown};
		// Drop any remaining placeholder keys (key2/key3 not needed here).
		parsed.apiKeys = parsed.apiKeys.filter((k) => !k.id.startsWith('kado_test-key'));
		delete (parsed as Record<string, unknown>)['_comment'];
		if (existsSync(KADO_DATA_JSON) && !existsSync(KADO_DATA_BACKUP)) {
			copyFileSync(KADO_DATA_JSON, KADO_DATA_BACKUP);
		}
		writeFileSync(KADO_DATA_JSON, JSON.stringify(parsed, null, 2));
		return true;
	} catch {
		return false;
	}
}

/** Touches main.js so the hot-reload plugin performs a disable → enable cycle. */
function triggerPluginReload(): boolean {
	try {
		const now = new Date();
		utimesSync(KADO_MAIN_JS, now, now);
		return true;
	} catch {
		return false;
	}
}

async function isMcpReachable(): Promise<boolean> {
	try {
		await fetch(MCP_URL, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}', signal: AbortSignal.timeout(3_000)});
		return true;
	} catch {
		return false;
	}
}

interface ToolResult {
	isError?: boolean;
	content: Array<{type: string; text: string}>;
}

async function callTool(apiKey: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
	const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
		requestInit: {headers: {Authorization: `Bearer ${apiKey}`}},
	});
	const client = new Client({name: 'kado-partial-rw-test', version: '1.0.0'});
	await client.connect(transport);
	try {
		return (await client.callTool({name: toolName, arguments: args})) as ToolResult;
	} finally {
		await client.close();
	}
}

function parseResult<T = unknown>(result: ToolResult): T {
	const text = result.content[0]?.text ?? '';
	try {
		return JSON.parse(text) as T;
	} catch {
		return {raw: text, code: 'PARSE_ERROR'} as T;
	}
}

// ============================================================
// Tests
// ============================================================

describe('Kado MCP Live — partial read/write', () => {
	let key1: string | null = null;
	let ready = false;

	/** Resets a note to a known content via the MCP create/update path; returns its modified mtime. */
	async function setNote(path: string, content: string): Promise<number> {
		const read = await callTool(key1!, 'kado-read', {operation: 'note', path});
		if (read.isError) {
			const created = await callTool(key1!, 'kado-write', {operation: 'note', path, content});
			return parseResult<{modified: number}>(created).modified;
		}
		const cur = parseResult<{modified: number}>(read).modified;
		const written = await callTool(key1!, 'kado-write', {operation: 'note', path, content, expectedModified: cur});
		return parseResult<{modified: number}>(written).modified;
	}

	async function requireReady(ctx: TestContext): Promise<void> {
		if (!ready) ctx.skip();
		await new Promise((r) => setTimeout(r, 400)); // throttle (rate limit)
	}

	beforeAll(async () => {
		key1 = loadApiKeyByName('kado-key1') ?? loadApiKeyByName('kado') ?? loadFirstApiKey();
		if (!key1) return;

		// Make the fixture config the ground truth and reload the plugin so the
		// server binds with allowed/** write access for key1.
		const wrote = loadAndWriteFixtureConfig(key1);
		if (wrote) {
			await new Promise((r) => setTimeout(r, 1_000));
			if (triggerPluginReload()) await new Promise((r) => setTimeout(r, 5_000));
		}

		if (!(await isMcpReachable())) return;

		// Confirm the active config grants write to allowed/ — otherwise skip with guidance.
		try {
			const created = await callTool(key1, 'kado-write', {operation: 'note', path: SCRATCH, content: BASE});
			const body = parseResult<{code?: string}>(created);
			if (created.isError && (body.code === 'FORBIDDEN' || body.code === 'UNAUTHORIZED')) {
				console.warn('\n⚠️  Kado has stale config — reload the plugin in Obsidian, then re-run npm run test:live\n');
				return;
			}
			// If it already existed, that's fine; the per-test setNote resets content.
		} catch {
			return;
		}

		ready = true;
	});

	afterAll(() => {
		for (const p of [SCRATCH_FS, FMONLY_FS]) {
			try { if (existsSync(p)) unlinkSync(p); } catch { /* best-effort */ }
		}
	});

	// -------------------- Partial reads --------------------

	it('firstXChars returns a truncated slice', async (ctx) => {
		await requireReady(ctx);
		await setNote(SCRATCH, BASE);
		const res = await callTool(key1!, 'kado-read', {operation: 'note', path: SCRATCH, mode: 'firstXChars', limit: 7});
		expect(res.isError).toBeFalsy();
		const body = parseResult<{content: string; truncated: boolean}>(res);
		expect(body.content).toBe('# Title');
		expect(body.truncated).toBe(true);
	});

	it('section returns the heading body and reports truncated', async (ctx) => {
		await requireReady(ctx);
		await setNote(SCRATCH, BASE);
		const res = await callTool(key1!, 'kado-read', {operation: 'note', path: SCRATCH, mode: 'section', heading: 'Alpha'});
		expect(res.isError).toBeFalsy();
		const body = parseResult<{content: string; truncated: boolean}>(res);
		expect(body.content).toContain('## Alpha');
		expect(body.content).toContain('alpha body');
		expect(body.content).not.toContain('beta body');
		expect(body.truncated).toBe(true);
	});

	it('full read (no mode) omits the truncated field', async (ctx) => {
		await requireReady(ctx);
		await setNote(SCRATCH, BASE);
		const res = await callTool(key1!, 'kado-read', {operation: 'note', path: SCRATCH});
		expect(res.isError).toBeFalsy();
		const body = parseResult<Record<string, unknown>>(res);
		expect('truncated' in body).toBe(false);
	});

	// -------------------- Partial writes --------------------

	it('append (lock-free) adds content at EOF', async (ctx) => {
		await requireReady(ctx);
		await setNote(SCRATCH, BASE);
		const res = await callTool(key1!, 'kado-write', {operation: 'note', path: SCRATCH, content: 'APPENDED', mode: 'append'});
		expect(res.isError).toBeFalsy();
		const disk = readFileSync(SCRATCH_FS, 'utf-8');
		expect(disk.startsWith('# Title')).toBe(true);
		expect(disk.endsWith('APPENDED')).toBe(true);
	});

	it('insertUnderHeading inserts at the end of the section', async (ctx) => {
		await requireReady(ctx);
		const mtime = await setNote(SCRATCH, BASE);
		const res = await callTool(key1!, 'kado-write', {operation: 'note', path: SCRATCH, content: 'INSERTED', mode: 'insertUnderHeading', heading: 'Alpha', expectedModified: mtime});
		expect(res.isError).toBeFalsy();
		const disk = readFileSync(SCRATCH_FS, 'utf-8');
		expect(disk).toContain('## Alpha\nalpha body\nINSERTED');
		expect(disk).toContain('## Beta\nbeta body');
	});

	it('replaceSection replaces the section body, preserving the heading', async (ctx) => {
		await requireReady(ctx);
		const mtime = await setNote(SCRATCH, BASE);
		const res = await callTool(key1!, 'kado-write', {operation: 'note', path: SCRATCH, content: 'NEWBETA', mode: 'replaceSection', heading: 'Beta', expectedModified: mtime});
		expect(res.isError).toBeFalsy();
		const disk = readFileSync(SCRATCH_FS, 'utf-8');
		expect(disk).toContain('## Beta\nNEWBETA');
		expect(disk).not.toContain('beta body');
	});

	it('replaceRange (line basis) replaces the addressed lines', async (ctx) => {
		await requireReady(ctx);
		const mtime = await setNote(SCRATCH, BASE);
		const res = await callTool(key1!, 'kado-write', {operation: 'note', path: SCRATCH, content: 'CHANGED', mode: 'replaceRange', rangeBasis: 'line', start: 1, end: 1, expectedModified: mtime});
		expect(res.isError).toBeFalsy();
		const disk = readFileSync(SCRATCH_FS, 'utf-8');
		expect(disk.startsWith('CHANGED\n')).toBe(true);
		expect(disk).not.toContain('# Title');
	});

	it('prepend onto a frontmatter-only note keeps the fence intact (C1)', async (ctx) => {
		await requireReady(ctx);
		// FM-only note whose closing fence is the very last byte (no trailing newline).
		await setNote(FMONLY, '---\ntitle: T\n---');
		const res = await callTool(key1!, 'kado-write', {operation: 'note', path: FMONLY, content: 'BODY', mode: 'prepend'});
		expect(res.isError).toBeFalsy();
		const disk = readFileSync(FMONLY_FS, 'utf-8');
		expect(disk).not.toContain('---BODY');   // fence must not run into content
		expect(disk).toContain('---\nBODY');     // separator preserved, content after FM
	});

	// -------------------- Hardening / error paths --------------------

	it('replaceRange past EOF is rejected (M4)', async (ctx) => {
		await requireReady(ctx);
		const mtime = await setNote(SCRATCH, BASE);
		const res = await callTool(key1!, 'kado-write', {operation: 'note', path: SCRATCH, content: 'x', mode: 'replaceRange', rangeBasis: 'line', start: 500, end: 500, expectedModified: mtime});
		expect(res.isError).toBe(true);
		expect(parseResult<{code: string}>(res).code).toBe('VALIDATION_ERROR');
	});

	it('firstXChars above the bounds cap is rejected (M3)', async (ctx) => {
		await requireReady(ctx);
		// The cap is enforced at two layers: the Zod input schema (.max(1e9)) rejects
		// at the MCP protocol layer first, with the mapper bound as defense-in-depth.
		// Either way the request must be rejected and never return a content slice.
		const res = await callTool(key1!, 'kado-read', {operation: 'note', path: SCRATCH, mode: 'firstXChars', limit: 2_000_000_000});
		expect(res.isError).toBe(true);
		expect(parseResult<{content?: unknown}>(res).content).toBeUndefined();
	});

	it('non-string content for a partial write is rejected (M2)', async (ctx) => {
		await requireReady(ctx);
		const res = await callTool(key1!, 'kado-write', {operation: 'note', path: SCRATCH, content: {not: 'a string'}, mode: 'append'});
		expect(res.isError).toBe(true);
		expect(parseResult<{code: string}>(res).code).toBe('VALIDATION_ERROR');
	});
});
