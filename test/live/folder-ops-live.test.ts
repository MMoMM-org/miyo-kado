/**
 * Live integration tests for folder operations (spec 009), Phase 5 / T5.1.
 *
 * Exercises the real Obsidian vault semantics that mocks cannot cover:
 *   - kado-write implicit parent-folder creation (mkdir -p)
 *   - kado-delete operation="folder": empty-only (non-empty refused), not-a-folder, missing
 *   - kado-rename operation="folder": in-place succeeds (descendant moves), cross-parent refused
 * Two-layer verification: MCP result AND on-disk state under test/MiYo-Kado.
 *
 * Uses the CURRENT plugin config as-is (key1 already has full CRUD on allowed/**)
 * — it does NOT rewrite data.json or reload the plugin. Excluded from `npm test`;
 * run via `npm run test:live`. Skips cleanly when the server/vault isn't ready.
 *
 * NOT covered here (need a bespoke config — see live-test-checklist.md): the RBAC
 * permission-neutral block (needs a rule naming the old folder) and the
 * auto-update-links-OFF timeout path.
 */

import {describe, it, expect, beforeAll, afterAll, type TestContext} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {readFileSync, existsSync, rmSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../..');

const IS_DOCKER = existsSync('/.dockerenv') || existsSync('/proc/1/cgroup');
const MCP_HOST = process.env.KADO_MCP_HOST ?? (IS_DOCKER ? 'host.docker.internal' : '127.0.0.1');
const MCP_PORT = Number(process.env.KADO_MCP_PORT ?? '23026');
const MCP_URL = `http://${MCP_HOST}:${MCP_PORT}/mcp`;

const VAULT = resolve(REPO_ROOT, 'test/MiYo-Kado');
const fsPath = (vaultRel: string): string => resolve(VAULT, vaultRel);

// All scratch lives under allowed/ (full CRUD for key1) and is fs-cleaned.
const SCRATCH_ROOTS = ['allowed/_live_mk', 'allowed/_live_del', 'allowed/_live_alt', 'allowed/_live_neu', 'allowed/sub/_live_neu'];

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

// A single persistent client for the whole suite: the server is stateless per
// request, so one `initialize` handshake + N tool calls stays well under the
// per-IP rate limit (20 req / 5 s) — far better than a fresh connect per call.
let sharedClient: Client | null = null;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function connectShared(apiKey: string): Promise<void> {
	const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
		requestInit: {headers: {Authorization: `Bearer ${apiKey}`}},
	});
	sharedClient = new Client({name: 'kado-folder-ops-test', version: '1.0.0'});
	await sharedClient.connect(transport);
}

async function callTool(_apiKey: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
	await sleep(300); // throttle every request to stay under the rate limit
	return (await sharedClient!.callTool({name: toolName, arguments: args})) as ToolResult;
}

function parseResult<T = unknown>(result: ToolResult): T {
	const text = result.content[0]?.text ?? '';
	try {
		return JSON.parse(text) as T;
	} catch {
		return {raw: text, code: 'PARSE_ERROR'} as T;
	}
}

function cleanupScratch(): void {
	for (const rel of SCRATCH_ROOTS) {
		try { rmSync(fsPath(rel), {recursive: true, force: true}); } catch { /* best-effort */ }
	}
}

describe('Kado MCP Live — folder operations (spec 009)', () => {
	let key1: string | null = null;
	let ready = false;

	async function requireReady(ctx: TestContext): Promise<void> {
		if (!ready) ctx.skip();
		await new Promise((r) => setTimeout(r, 400)); // throttle (rate limit) + let Obsidian settle
	}

	beforeAll(async () => {
		key1 = loadFirstApiKey();
		if (!key1) return;
		if (!(await isMcpReachable())) return;
		cleanupScratch();
		// Cool down first: a prior run may have saturated the 20 req / 5 s window.
		await sleep(6_000);
		await connectShared(key1);
		// Confirm write access to allowed/ with the live config; skip (not fail) otherwise.
		try {
			const probe = await callTool(key1, 'kado-write', {operation: 'note', path: 'allowed/_live_mk/probe.md', content: '# probe\n'});
			const body = parseResult<{code?: string}>(probe);
			if (probe.isError && (body.code === 'FORBIDDEN' || body.code === 'UNAUTHORIZED')) {
				console.warn('\n⚠️  Kado config denies write to allowed/ — reload the plugin, then re-run npm run test:live\n');
				return;
			}
		} catch {
			return;
		}
		ready = true;
	});

	afterAll(async () => {
		try { await sharedClient?.close(); } catch { /* best-effort */ }
		cleanupScratch();
	});

	// -------------------- Create: implicit mkdir -p --------------------

	it('kado-write creates missing parent folders (mkdir -p) and the note on disk', async (ctx) => {
		await requireReady(ctx);
		const path = 'allowed/_live_mk/a/b/deep.md';
		const res = await callTool(key1!, 'kado-write', {operation: 'note', path, content: '# deep\n'});

		expect(res.isError).toBeFalsy();
		expect(parseResult<{path: string}>(res).path).toBe(path);
		// Filesystem: the intermediate folders and the note actually exist.
		expect(existsSync(fsPath('allowed/_live_mk/a/b'))).toBe(true);
		expect(existsSync(fsPath(path))).toBe(true);
		expect(readFileSync(fsPath(path), 'utf-8')).toContain('# deep');
	});

	// -------------------- Delete: empty-only --------------------

	it('kado-delete operation="folder" refuses a NON-EMPTY folder (no recursive delete)', async (ctx) => {
		await requireReady(ctx);
		await callTool(key1!, 'kado-write', {operation: 'note', path: 'allowed/_live_del/keep.md', content: 'x'});
		await new Promise((r) => setTimeout(r, 300));

		const res = await callTool(key1!, 'kado-delete', {operation: 'folder', path: 'allowed/_live_del'});

		expect(res.isError).toBe(true);
		expect(parseResult<{code: string; message: string}>(res).code).toBe('VALIDATION_ERROR');
		expect(parseResult<{message: string}>(res).message).toContain('not empty');
		// Folder + its note are untouched.
		expect(existsSync(fsPath('allowed/_live_del/keep.md'))).toBe(true);
	});

	it('kado-delete operation="folder" trashes an EMPTY folder', async (ctx) => {
		await requireReady(ctx);
		// Empty the folder first (delete its only note via MCP), then delete the folder.
		const read = await callTool(key1!, 'kado-read', {operation: 'note', path: 'allowed/_live_del/keep.md'});
		const modified = parseResult<{modified: number}>(read).modified;
		await callTool(key1!, 'kado-delete', {operation: 'note', path: 'allowed/_live_del/keep.md', expectedModified: modified});
		await new Promise((r) => setTimeout(r, 400));

		const res = await callTool(key1!, 'kado-delete', {operation: 'folder', path: 'allowed/_live_del'});

		expect(res.isError).toBeFalsy();
		expect(parseResult<{path: string}>(res).path).toBe('allowed/_live_del');
		await new Promise((r) => setTimeout(r, 300));
		expect(existsSync(fsPath('allowed/_live_del'))).toBe(false);
	});

	it('kado-delete operation="folder" on a file path returns VALIDATION_ERROR (not a folder)', async (ctx) => {
		await requireReady(ctx);
		const res = await callTool(key1!, 'kado-delete', {operation: 'folder', path: 'allowed/_live_mk/a/b/deep.md'});
		expect(res.isError).toBe(true);
		expect(parseResult<{message: string}>(res).message).toContain('not a folder');
	});

	it('kado-delete operation="folder" on a missing path returns NOT_FOUND', async (ctx) => {
		await requireReady(ctx);
		const res = await callTool(key1!, 'kado-delete', {operation: 'folder', path: 'allowed/_live_ghost'});
		expect(res.isError).toBe(true);
		expect(parseResult<{code: string}>(res).code).toBe('NOT_FOUND');
	});

	// -------------------- Rename: in-place only --------------------

	it('kado-rename operation="folder" renames a folder in place; the descendant moves on disk', async (ctx) => {
		await requireReady(ctx);
		await callTool(key1!, 'kado-write', {operation: 'note', path: 'allowed/_live_alt/inside.md', content: '# inside\n'});
		await new Promise((r) => setTimeout(r, 300));

		const res = await callTool(key1!, 'kado-rename', {operation: 'folder', source: 'allowed/_live_alt', target: 'allowed/_live_neu'});

		expect(res.isError).toBeFalsy();
		const body = parseResult<{source: string; target: string}>(res);
		expect(body).toMatchObject({source: 'allowed/_live_alt', target: 'allowed/_live_neu'});
		await new Promise((r) => setTimeout(r, 300));
		// Filesystem: old path gone, new path holds the descendant.
		expect(existsSync(fsPath('allowed/_live_alt'))).toBe(false);
		expect(existsSync(fsPath('allowed/_live_neu/inside.md'))).toBe(true);
	});

	it('kado-rename operation="folder" refuses a cross-parent move (in place only)', async (ctx) => {
		await requireReady(ctx);
		// Source exists from the previous test (allowed/_live_neu); target has a different parent (allowed/sub).
		const res = await callTool(key1!, 'kado-rename', {operation: 'folder', source: 'allowed/_live_neu', target: 'allowed/sub/_live_neu'});

		expect(res.isError).toBe(true);
		expect(parseResult<{code: string}>(res).code).toBe('VALIDATION_ERROR');
		expect(parseResult<{message: string}>(res).message).toContain('in place');
		// The folder did not move.
		expect(existsSync(fsPath('allowed/_live_neu'))).toBe(true);
		expect(existsSync(fsPath('allowed/sub/_live_neu'))).toBe(false);
	});
});
