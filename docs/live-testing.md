# Live Testing — Kado MCP Server

Integration tests that exercise the full Kado pipeline against a running Obsidian instance.
Unlike unit tests (which mock the Obsidian API), these tests connect to the real MCP server
via HTTP and verify end-to-end behavior including permission gates, vault I/O, and concurrency control.

## Quick Start

```bash
npm run test:live          # run all live tests
npm test                   # unit tests only — live tests are excluded
```

## Architecture

```
Test Runner (vitest, node env)
    │
    │  StreamableHTTP (MCP SDK Client)
    │  Bearer auth via API key
    ▼
┌──────────────────────────────┐
│  Kado MCP Server (Obsidian)  │  ← running inside Obsidian.app
│  127.0.0.1:23026/mcp         │
└──────────────────────────────┘
    │
    ▼
┌──────────────────────────────┐
│  Test Vault: test/MiYo-Kado  │  ← fixture data in the repo
│  ├── allowed/                │  ← full CRUD for test key
│  ├── maybe-allowed/          │  ← partial permissions
│  └── nope/                   │  ← denied area (no key access)
└──────────────────────────────┘
```

The test runner talks to the MCP server over HTTP. The server runs inside Obsidian
which has the test vault open. Assertions happen at two levels:

- **MCP level**: tool call results (`isError`, response content, error codes)
- **Filesystem level**: direct `readFileSync`/`existsSync` to verify what Obsidian actually wrote

## Preflight Cascade

Before any tool test runs, a multi-step preflight determines whether the environment
is ready. Each step that fails causes all subsequent tests to **skip** (not fail).
This means `npm run test:live` never produces false negatives when the environment
simply isn't set up.

The `beforeAll()` executes these checks in order:

### Step 1 — API Key (`.mcp.json`)

The test reads the API key from the repo's `.mcp.json`:

```json
{
  "mcpServers": {
    "kado": {
      "type": "url",
      "url": "http://127.0.0.1:23026/mcp",
      "headers": {
        "Authorization": "Bearer <API_KEY>"
      }
    }
  }
}
```

- `.mcp.json` is gitignored (contains secrets)
- If the key is missing or still the placeholder `YOUR_API_KEY_HERE` → skip all

### Step 2 — Plugin Config (`data.json`)

The Kado plugin stores its config at:

```
test/MiYo-Kado/.obsidian/plugins/miyo-kado/data.json
```

This file is in the repo and readable from any environment (macOS or Docker).
The test reads it to check:

| Field | What it tells us |
|-------|-----------------|
| `server.enabled` | Is the MCP server turned on? |
| `server.host` / `server.port` | Where is it listening? |
| `apiKeys[].areas` | Does the test key have area assignments? |
| `globalAreas[].pathPatterns` | Which paths are configured? |

**Important**: Obsidian loads `data.json` on plugin start. If you edit the file
while Obsidian is running, you must reload the plugin (disable → enable) for
changes to take effect. Obsidian may also overwrite the file when saving its
own state.

### Step 3 — macOS Checks (Obsidian process + vault open)

On macOS, two checks run in sequence:

**Obsidian process**: `pgrep -x Obsidian` checks whether Obsidian.app is running.
In Docker, the function short-circuits and returns `'unknown'` without running pgrep.

**Vault open**: Obsidian's global config at `~/Library/Application Support/obsidian/obsidian.json`
tracks which vaults are open. The test reads this file and checks whether the
`test/MiYo-Kado` vault has `"open": true`.

```json
{
  "vaults": {
    "f6526f2ffa23cd93": {
      "path": "/Volumes/Moon/Coding/MiYo/Kado/test/MiYo-Kado",
      "open": true
    }
  }
}
```

In Docker, this file is inaccessible → check returns `'unknown'` and is skipped.

If either check returns `false` (not `'unknown'`) on macOS → skip all.

### Step 4 — Plugin Config Gates

Two gates from the `data.json` read in Step 2:

- **Server enabled**: if `server.enabled` is `false` → skip all
- **Key has areas**: if the test API key has no area assignments → skip all

These catch config issues early before the network probe.

### Step 5 — MCP Server Probe

The definitive check: a raw HTTP POST to the MCP endpoint. Any response
(even 400 or 401) means the server is listening.

```typescript
await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(3_000),
});
```

If the connection is refused or times out → skip all.

### Preflight Summary

| Check | macOS | Docker | Skip if fails |
|-------|-------|--------|---------------|
| API key in `.mcp.json` | read file | read file | yes |
| `data.json` read | read file | read file | — (provides data for gates) |
| Obsidian process running | `pgrep` | skip (`'unknown'`) | yes (macOS) |
| Vault open | `obsidian.json` | skip (`'unknown'`) | yes (macOS) |
| `data.json` server enabled | gate check | gate check | yes |
| `data.json` key has areas | gate check | gate check | yes |
| MCP server reachable | HTTP probe | HTTP probe | yes |

### Test Output When Environment Unavailable

```
 ✓ Preflight > API key is configured in .mcp.json
 ↓ Preflight > Obsidian is running (macOS only)             [skipped]
 ↓ Preflight > MiYo-Kado vault is open (macOS only)         [skipped]
 ↓ Preflight > Kado plugin: server is enabled in data.json  [skipped]
 ↓ Preflight > Kado plugin: API key has area assignments     [skipped]
 ↓ Preflight > MCP server is reachable                       [skipped]
 ↓ kado-read > reads a note from allowed area                [skipped]
 ...
```

No red failures — just clean skips.

## Docker Support

In Docker, the MCP server runs on the macOS host, not inside the container.
The test auto-detects Docker via `/.dockerenv` or `/proc/1/cgroup` and adjusts:

| Setting | macOS | Docker |
|---------|-------|--------|
| MCP host | `127.0.0.1` | `host.docker.internal` |
| Obsidian checks | full | skipped (`'unknown'`) |
| `data.json` | readable | readable (repo mount) |

Override with environment variables:

```bash
KADO_MCP_HOST=host.docker.internal npm run test:live
KADO_MCP_PORT=23027 npm run test:live
```

## MCP Client

Tests use the official MCP SDK client (`@modelcontextprotocol/sdk/client`).
Each tool call creates a fresh client connection — the server operates
statelessly (no sessions).

```typescript
const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
});
const client = new Client({ name: 'kado-live-test', version: '1.0.0' });
await client.connect(transport);
const result = await client.callTool({ name: 'kado-read', arguments: { ... } });
await client.close();
```

## Verification Strategy

### Two-Layer Verification

Every write operation is verified at both layers:

1. **MCP layer**: check `result.isError`, parse response JSON, verify returned
   paths and timestamps
2. **Filesystem layer**: `readFileSync` / `existsSync` against the vault directory
   to confirm what Obsidian actually persisted

```typescript
// MCP: tool call succeeds
expect(result.isError).toBeFalsy();
const body = parseResult(result);
expect(body.path).toBe('allowed/_live-test-scratch.md');

// Filesystem: file actually exists with correct content
expect(existsSync(scratchFsPath)).toBe(true);
expect(readFileSync(scratchFsPath, 'utf-8')).toBe(expectedContent);
```

This catches bugs where the MCP layer reports success but the vault adapter
fails silently.

### Plugin Config Inspection

The test reads `data.json` directly from the filesystem to verify plugin
configuration before making MCP calls:

```typescript
const data = JSON.parse(readFileSync(KADO_DATA_JSON, 'utf-8'));
// Check: server enabled? key has areas? pathPatterns correct?
```

This catches misconfiguration early and produces clear skip messages
instead of cryptic tool errors.

## Cleanup

Write tests create temporary files in the vault. Cleanup happens via
direct filesystem operations (not MCP — there is no delete tool):

```typescript
beforeAll(() => {
    // Start clean
    if (existsSync(scratchFsPath)) unlinkSync(scratchFsPath);
});

afterAll(() => {
    // Leave no trace
    if (existsSync(scratchFsPath)) unlinkSync(scratchFsPath);
});
```

**Why filesystem cleanup, not MCP?** Kado has no delete tool (`CrudFlags.delete`
is reserved for future use). Direct `unlinkSync` is the only way to remove
test artifacts. Obsidian detects the external deletion and updates its index.

**Timing caveat**: Obsidian's vault API caches file state. If a file is deleted
externally and a create is attempted immediately, Obsidian may still think the
file exists. In practice, the `beforeAll` cleanup runs before Obsidian
processes the deletion. If this causes flaky tests, add a short delay or
run the cleanup well before the test suite.

## Write Contract (Optimistic Concurrency)

The write flow enforces optimistic concurrency control via `expectedModified`:

```
Create:  kado-write { path, content }                    → file must NOT exist
Update:  kado-write { path, content, expectedModified }  → file must exist, mtime must match
```

### The Read→Write Cycle

```
1. kado-read  { path }                         → { content, modified: 1234 }
2. kado-write { path, content, expectedModified: 1234 }  → OK
3. kado-write { path, content, expectedModified: 1234 }  → CONFLICT (stale)
4. kado-read  { path }                         → { content, modified: 5678 }
5. kado-write { path, content, expectedModified: 5678 }  → OK
```

Every update requires a fresh `modified` timestamp from a prior read.
The tests verify this contract including the stale-timestamp rejection:

| Test Case | expectedModified | File state | Expected result |
|-----------|-----------------|------------|-----------------|
| Create new file | not set | doesn't exist | OK |
| Create existing | not set | exists | error |
| Update with fresh ts | from read | matches mtime | OK |
| Update with stale ts | wrong value | doesn't match | CONFLICT |
| Sequential updates | reuse old ts | changed after first write | CONFLICT on second |

## Test Vault Structure

```
test/MiYo-Kado/
├── allowed/                        ← API key has full CRUD
│   ├── Project Alpha.md            ← frontmatter, inline tags, dataview fields, links
│   ├── Meeting Notes 2026-03-28.md ← participants array, checkboxes, inline tags
│   ├── API Design Draft.md         ← tables, code blocks
│   └── Daily Note 2026-03-31.md    ← mood/energy/focus fields
├── maybe-allowed/                  ← API key has read-only (note), read+update (frontmatter)
│   ├── Budget 2026.md              ← both bracket [key:: val] and list-item - key:: val fields
│   └── Vendor Evaluation.md        ← nested frontmatter (vendors array)
├── nope/                           ← no API key access → all operations FORBIDDEN
│   ├── Credentials.md              ← fake secrets for permission testing
│   └── Incident Report.md          ← severity/timeline fields
└── .obsidian/
    └── plugins/miyo-kado/
        ├── main.js                 ← symlink to repo build output (main.js at repo root)
        └── data.json               ← plugin config (server, areas, keys, audit)
```

### Why Three Areas?

The three directories map to Kado's permission model:

- **allowed/**: the test API key has this area assigned with full CRUD → tests read, write, search
- **maybe-allowed/**: assigned with restricted permissions → tests partial access
- **nope/**: not assigned to the test key at all → tests that FORBIDDEN is returned

### Test Data Design

Each test file includes multiple data types to exercise all Kado operations:

| Data type | Example | Tested by |
|-----------|---------|-----------|
| Note content | `# Project Alpha` | `kado-read { operation: 'note' }` |
| YAML frontmatter | `status: active` | `kado-read { operation: 'frontmatter' }` |
| Bracket inline fields | `[completion:: 40%]` | `kado-read { operation: 'dataview-inline-field' }` |
| List-item inline fields | `- amount:: €17,500` | same — tests parser handles both formats |
| Inline tags | `#engineering` | `kado-search { operation: 'byTag' }` |
| Wikilinks | `[[Meeting Notes]]` | structural test data |

## PRD Feature Coverage

Coverage map of live tests against PRD Must-Have features (F-1 through F-21).
Validated 2026-03-31 against `docs/XDD/specs/001-kado/prd.md`.

### Covered

| Feature | Tests |
|---------|-------|
| F-3 API-key auth | `Authentication > rejects invalid key`, `rejects empty auth` |
| F-17 Path/dir listing | `kado-search > lists directory contents`, `respects pagination limit` |
| F-18 Content search + chunking | `kado-search > searches by content substring`, `respects pagination limit` |
| F-19 Frontmatter/tag search | `kado-search > finds notes by tag`, `searches by frontmatter field`, `lists all tags` |

### Partially Covered

| Feature | What's tested | Gap |
|---------|--------------|-----|
| F-1 Default-Deny | `nope/` is denied | `nope/` is both globally unconfigured AND key-unassigned — can't distinguish which layer blocked. Need a path in a global area but not assigned to the test key. |
| F-2 Global scope | `allowed/` reads succeed, `nope/` denied | No test for a path that simply isn't in any global area definition (e.g. `unlisted/test.md`). |
| F-4 Per-key scoping | Reads from `maybe-allowed/` succeed | No test attempts a write to `maybe-allowed/` that the key-level restriction should block. The restricted side is never triggered. |
| F-7 Fail-fast auth | Denied requests return FORBIDDEN | No side-effect verification (confirm target file wasn't touched). |
| F-14 Per-key area selection | `nope/` denied (not assigned) | Same conflation as F-1 — can't tell global-deny from key-deny. |

### Not Covered (Testable via MCP)

| Feature | Why missing | What to add |
|---------|------------|-------------|
| F-5 Independent CRUD by data type | No test probes cross-data-type boundaries | Attempt note-write to `maybe-allowed/` (key has `note.create: false`) → expect FORBIDDEN. Attempt frontmatter-write (key has `frontmatter.update: true`) → expect success. |
| F-6 Distinct Note/Frontmatter model | No test isolates note-vs-frontmatter permission | Same as F-5 — use `maybe-allowed/` key config which has different note vs. frontmatter permissions. |
| F-8 Audit logging | No test reads the audit log | Read `audit.log` after allowed + denied operations. Verify entries exist, verify no note content in log. |
| F-21 Search→Write separation | No test uses search results to attempt unauthorized write | After `byName` search, attempt `kado-write` with a returned path using a read-only key → expect FORBIDDEN. |

### Not Covered (Requires UI Testing)

These features are Obsidian Settings UI screens and cannot be exercised through
the MCP HTTP interface. They require manual QA or a separate test harness
(Playwright/Electron against Obsidian):

- F-9 Global configuration screen
- F-10 Configurable server exposure mode
- F-11 Manage global allowed areas
- F-12 API key management interface
- F-13 Per-key configuration screen
- F-15 CRUD permission editing per data type
- F-16 Understandable effective-permissions view

### Not Covered (Non-Functional / Implementation)

- F-20 Use Obsidian APIs before custom scans — implementation directive, not testable
  through black-box MCP calls. Would require white-box profiling.

## SDD Spec Drift

Deviations between the live tests/documentation and the Solution Design Document
(`docs/XDD/specs/001-kado/solution.md`). Validated 2026-03-31.

### `byContent` and `byFrontmatter` not in SDD SearchOperation enum

The SDD's `kadoSearchSchema` defines `operation: z.enum(['byTag', 'byName', 'listDir', 'listTags'])`.
The implementation and live tests also use `byContent` and `byFrontmatter`, which were
added post-SDD. The `SearchOperation` type in `src/types/canonical.ts` already includes
both, but `solution.md` has not been updated.

**Action**: Update the SDD's search schema enum, or add an amendment noting the addition.

### ConcurrencyGuard edge case: update on non-existent file

The live tests cover stale-timestamp rejection and sequential updates, but do not test
a write with `expectedModified` set on a file that doesn't exist. The SDD implies this
should return `NOT_FOUND` (adapter level) or `CONFLICT` (guard level), but the exact
behavior is unpinned.

**Action**: Add a test case for this edge case to pin the contract.

### Audit log path convention

The SDD default example shows `".obsidian/plugins/kado/audit.log"`. The test vault
uses `"plugins/miyo-kado/audit.log"` (relative to `vault.configDir`). This is a
configuration value difference, not a structural mismatch — the plugin was renamed
from `kado` to `miyo-kado`.

## Known Issues

### listTags scope filtering

`listTags` returns items with `path: "#tagname"` (the tag name as a synthetic path).
The `filterResultsByScope` function then filters these against area glob patterns like
`allowed/**` — which never matches `#tagname`. Result: `items: []` even though
`total: 3` shows tags exist.

**Workaround in tests**: the test checks `total > 0` as a fallback.

### byTag / listTags only check inline tags

The search adapter checks `cache.tags` (inline `#tag` occurrences in the note body)
but not `cache.frontmatter.tags` (YAML frontmatter `tags:` array). Notes must include
inline `#tag` in addition to frontmatter tags to be found by `byTag`.

### Obsidian file cache timing

When files are created or deleted externally (`writeFileSync` / `unlinkSync`),
Obsidian's vault API may not reflect the change immediately. The `beforeAll`
cleanup in write tests runs before the create test, giving Obsidian time to
notice the deletion. If this becomes flaky, consider a short `setTimeout` or
vault-level cleanup.

## Configuration Reference

### .mcp.json (gitignored)

```json
{
  "mcpServers": {
    "kado": {
      "type": "url",
      "url": "http://127.0.0.1:23026/mcp",
      "headers": {
        "Authorization": "Bearer <your-api-key-id>"
      }
    }
  }
}
```

### data.json (in repo)

The test expects this configuration in `test/MiYo-Kado/.obsidian/plugins/miyo-kado/data.json`:

- `server.enabled: true`, `server.port: 23026`
- Global area "Allowed" with `pathPatterns: ["allowed/**"]`
- Global area "Maybe Allowed" with `pathPatterns: ["maybe-allowed/**"]`
- No area for `nope/`
- API key matching `.mcp.json` with both areas assigned
- `audit.logFilePath: "plugins/miyo-kado/audit.log"`

### vitest.live.config.ts

Separate vitest config for live tests:

- `environment: 'node'` (not jsdom — needs real network)
- `testTimeout: 30_000` (network round-trips)
- `hookTimeout: 15_000` (beforeAll/afterAll cap)
- `include: ['test/live/**/*.test.ts']`
- Excluded from `npm test` via `exclude: ['test/live/**']` in main config

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KADO_MCP_HOST` | `127.0.0.1` (macOS) / `host.docker.internal` (Docker) | MCP server hostname |
| `KADO_MCP_PORT` | `23026` | MCP server port |
