# Context — Kado
<!-- Current sprint focus, active work, known blockers. Updated: 2026-03-30 -->
<!-- This file is short-lived — prune entries older than 2 weeks via /memory-cleanup -->

<!-- 2026-03-30 -->
- Testing and release automation now in place. Next: rename sample classes (6 pre-existing lint errors from obsidianmd/sample-names rule) and start building actual plugin features
- GitHub Secrets needed: `GITHUB_TOKEN` (auto-provided by Actions) — no `NPM_TOKEN` needed since npm publish is disabled
- Test vault at `test/MiYo-Kado/` has hot-reload configured — Obsidian only to be used after consultation

<!-- 2026-03-30 — Post-implementation -->
- Kado v1 implementation complete: 6 phases, 390 tests, all review fixes applied
- Branch: feat/kado-v1-implementation — ready for merge

## Deferred Review Items

### M2 — Wildcard CORS restriction (2026-03-30)
- Location: src/mcp/server.ts:97
- Concern: `cors()` allows all origins — restrict to known clients
- Reason deferred: Requires determining exact client origin list; functional without it
- Branch: feat/kado-v1-implementation

### M4 — Percent-encoded path traversal (2026-03-30)
- Location: src/core/gates/path-access.ts:16
- Concern: PathAccessGate doesn't decode %2e%2e before traversal check
- Reason deferred: Obsidian vault API unlikely to interpret URL-encoded paths; defense-in-depth for hardening pass
- Branch: feat/kado-v1-implementation

### M8 — Concurrent restart guard in settings (2026-03-30)
- Location: src/settings.ts:370
- Concern: Rapid settings changes can interleave stop/start cycles
- Reason deferred: Edge case requiring debounce; H3 double-start guard mitigates the worst scenario
- Branch: feat/kado-v1-implementation

### M11 — Pin obsidian dependency version (2026-03-30)
- Location: package.json:42
- Concern: `obsidian: latest` breaks reproducible builds
- Reason deferred: Requires determining exact version to pin; functional with latest
- Branch: feat/kado-v1-implementation

### M13 — Zod v4 vs v3 MCP SDK compat (2026-03-30)
- Location: src/mcp/tools.ts, package.json
- Concern: Zod v4 enum introspection may not render in MCP tool manifests
- Reason deferred: Needs live testing with Claude Desktop to verify; no runtime impact
- Branch: feat/kado-v1-implementation

### M14 — AuditLogger.updateConfig not wired (2026-03-30)
- Location: src/core/audit-logger.ts:60, src/settings.ts
- Concern: Runtime audit config changes don't take effect until plugin reload
- Reason deferred: Low impact — users rarely change audit settings mid-session
- Branch: feat/kado-v1-implementation

### H7 — Delete permission unreachable (2026-03-30)
- Location: src/types/canonical.ts:17
- Concern: CrudFlags.delete exists but no tool implements it
- Reason deferred: Intentionally reserved for future kado-delete tool; document as reserved
- Branch: feat/kado-v1-implementation

### L4 — Truncate key IDs in audit log (2026-03-30)
- Location: src/mcp/tools.ts
- Concern: Full API key IDs in audit log
- Reason deferred: Hardening pass — keys are local-only
- Branch: feat/kado-v1-implementation

### L5 — Rate limiting (2026-03-30)
- Location: src/mcp/server.ts
- Concern: No rate limiting on MCP endpoint
- Reason deferred: PRD lists as Should-Have; localhost service reduces risk
- Branch: feat/kado-v1-implementation

### L8 — Import SDK CallToolResult type (2026-03-30)
- Location: src/mcp/tools.ts
- Concern: Local type + cast instead of SDK import
- Reason deferred: Cosmetic; no runtime impact
- Branch: feat/kado-v1-implementation
