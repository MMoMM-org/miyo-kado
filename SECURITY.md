# Security Policy

## Reporting a Vulnerability

If you discover a security issue in MiYo Kado, please **do not** open a public GitHub issue. Instead, email **marcus@mmomm.org** with:

- A clear description of the issue
- Steps to reproduce (or a proof-of-concept if applicable)
- The Kado version + Obsidian version + OS

I aim to respond within 7 days. Coordinated disclosure is appreciated for issues that affect user vault contents or credential handling.

Confirmed vulnerabilities are tracked as private GitHub security advisories and fixed in the advisory's temporary private fork. The advisory is published 7 days after the release that contains the fix, so users have time to update. Publishing is automated by `.github/workflows/publish-advisories.yml`.

Release note for maintainers: an advisory-fork merge lands on `master` as a single `Merge commit from fork` commit, which semantic-release does not classify, so it cuts no release. After all advisory PRs are merged, ship them with one squash-merged PR titled `fix(security): …`. Merge stacked advisory PRs one at a time and rebase the next one onto `master` in between, because the merge squashes the branch and changes the commit SHAs.

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

### Currently open alerts (last reviewed 2026-10-29)

Every package bundled into `main.js` is on a patched version (MCP SDK 1.32.2, zod 4.6.7, express 5.3.0 and their transitives `body-parser`, `qs`, `proxy-addr`, `fast-uri`, `@hono/node-server`). Bundle membership was checked with the esbuild metafile, not by grepping `main.js`. The tracking ticket is [#40](https://github.com/MMoMM-org/miyo-kado/issues/40). The remaining open alerts do **not** affect users:

**Not bundled:**
- `moment` (via the `obsidian` type package): `obsidian` is marked external in the build and provided by the Obsidian app at runtime, so neither package ends up in `main.js`.
- `hono`, `ip-address`, `express-rate-limit`: installed as transitives of the MCP SDK, but not part of Kado's bundle (Kado uses its own express transport and rate limiter).

**Bundled inside `npm` (a transitive of `semantic-release`). CI-only, never shipped:**
- `brace-expansion`, `ip-address`, `postcss-selector-parser`, `undici` (second copies inside `node_modules/npm/`).

`overrides` cannot reach packages bundled inside `npm` itself. These clear when `semantic-release` ships a newer `npm`.

### What you can do as a user

- **Update Kado** when a new release ships — patches for production deps roll out in patch releases (e.g. `1.3.x`).
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

- [#9](https://github.com/MMoMM-org/miyo-kado/issues/9) Settings tab stale after plugin reload (UX, not security)
- [#10](https://github.com/MMoMM-org/miyo-kado/issues/10) Transient file truncation after `vault.adapter.write()` (Obsidian-internal)
- [#11](https://github.com/MMoMM-org/miyo-kado/issues/11) MCP SDK does not handle 429 `Retry-After` (upstream SDK gap)

### Security fixes

- **1.3.1** — Permission enforcement hardened: search, graph, graph-audit and open-notes results now require read permission on each returned path (not just a matching scope pattern); folder renames require `operation="folder"`; tag reads honour frontmatter-only access. Upgrade recommended for any setup that denies read on part of a granted area. Advisories are published 7 days after release.

---

## Supported versions

Only the latest minor version receives security patches. Kado follows semantic versioning; the most recent release on `master` is the only supported branch.

| Version | Supported |
|---|---|
| 1.3.x (≥ 1.3.1) | ✅ |
| < 1.3.1 | ❌ Please upgrade |
