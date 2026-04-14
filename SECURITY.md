# Security Policy

## Reporting a Vulnerability

If you discover a security issue in MiYo Kado, please **do not** open a public GitHub issue. Instead, email **marcus@mmomm.org** with:

- A clear description of the issue
- Steps to reproduce (or a proof-of-concept if applicable)
- The Kado version + Obsidian version + OS

I aim to respond within 7 days. Coordinated disclosure is appreciated for issues that affect user vault contents or credential handling.

---

## What ships to your vault

Kado is an Obsidian plugin. Only the bundled `main.js` (built with esbuild) runs inside Obsidian. Build/test/CI tooling **never executes in the user environment**.

### Production dependencies (bundled in `main.js`)

| Package | Purpose |
|---|---|
| `@modelcontextprotocol/sdk` | MCP protocol implementation |
| `cors` | CORS middleware (disabled by default in Kado) |
| `express` | HTTP server framework |
| `zod` | Schema validation |

These are the only packages whose vulnerabilities can affect Kado users in their vaults.

### Build/test/CI dependencies (never shipped)

`vitest`, `vite` (transitive), `esbuild`, `typescript`, `semantic-release`, `lodash-es` (transitive of semantic-release), `jsdom`, ESLint plugins, etc. — these run only on the maintainer's machine and in GitHub Actions. They never reach a user's Obsidian instance.

---

## Dependabot alert triage

GitHub Dependabot scans the full `package-lock.json` and may surface alerts for **transitive dependencies** that are not part of the shipped bundle. We triage these as follows:

| Alert location | User-impact | Action |
|---|---|---|
| Direct production dep with exploitable surface in Kado | **HIGH** | Fix immediately, release patch |
| Direct production dep with vulnerability in unused feature | Low | Track, fix at next regular update |
| Transitive of production dep, unused feature | Low | Track, upgrade via parent dep |
| Build/test/CI tooling (e.g. vite, lodash-es from semantic-release) | None | Auto-merge Dependabot patch bumps |

### Currently open alerts (as of last review)

Most open alerts are in build/test tooling and do **not** affect users. Notable categories:

- **`vite` (transitive of `vitest`)** — Vite vulnerabilities affect the dev server (file traversal, websocket file read). Vite is used only when running unit tests; never bundled.
- **`lodash-es` / `lodash` (transitive of `semantic-release`)** — Code injection via `_.template`. Used only in the release pipeline; never bundled.
- **`hono` / `@hono/node-server` (transitive of MCP SDK)** — Cookie name validation, IPv4-mapped IPv6 in `ipRestriction`, path traversal in `toSSG`, repeated-slash bypass in `serveStatic`. Kado does not use any of these features. The MCP SDK uses Hono internally for its own HTTP handling, but the vulnerable code paths are not on Kado's request surface.

### What you can do as a user

- **Update Kado** when a new release ships — patches for production deps roll out in patch releases (e.g. `0.4.x`).
- **Run Kado locally only** (`server.connectionType: "local"`) unless you understand the network exposure trade-offs.
- **Review the audit log** at the path you configured in settings — every allowed and denied request is logged.

---

## Security model

The full request flow passes through five permission gates in order — see `docs/api-reference.md` ("Security Model") for details. Default-deny applies at the global security level; nothing is exposed unless you whitelist it.

### Defenses in place

- Bearer token authentication with constant-time comparison
- Path traversal rejection (`..`, null bytes, absolute paths, URL-encoded variants)
- Optimistic concurrency via `expectedModified` on writes and deletes
- Rate limiting (200 req/min per IP)
- NDJSON audit log with rotation
- All deletions go through `fileManager.trashFile()` (respects user's "Deleted files" setting)

### Known issues

Tracked as GitHub Issues:

- [#8](https://github.com/MMoMM-org/miyo-kado/issues/8) Blacklist permission-flag semantics inconsistent across CRUD actions
- [#9](https://github.com/MMoMM-org/miyo-kado/issues/9) Settings tab stale after plugin reload (UX, not security)
- [#10](https://github.com/MMoMM-org/miyo-kado/issues/10) Transient file truncation after `vault.adapter.write()` (Obsidian-internal)
- [#11](https://github.com/MMoMM-org/miyo-kado/issues/11) MCP SDK does not handle 429 `Retry-After` (upstream SDK gap)

---

## Supported versions

Only the latest minor version receives security patches. Kado follows semantic versioning; the most recent release on `master` is the only supported branch.

| Version | Supported |
|---|---|
| 0.4.x | ✅ |
| < 0.4.0 | ❌ Please upgrade |
