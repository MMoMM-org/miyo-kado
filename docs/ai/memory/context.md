# Context — Kado
<!-- Current sprint focus, active work, known blockers. Updated: 2026-03-31 -->
<!-- This file is short-lived — prune entries older than 2 weeks via /memory-cleanup -->

## Active: UI Settings Rework (Spec 002)

**Branch:** feat/kado-v1-implementation
**Spec:** docs/XDD/specs/002-ui-settings-rework/ (PRD v1.2, SDD v1.1, PLAN v1.1)

### Implementation Status (2026-03-31)

All 5 phases implemented and committed:

| Phase | Commit | Status |
|-------|--------|--------|
| 1: Data model & config | ed888a9 | Done — types, tag-utils, config merge, audit rotation |
| 2: UI components | 60d2525 | Done — PermissionMatrix, modals, PathEntry, TagEntry, CSS |
| 3: Settings tabs | 2493f66 | Done — SettingsTab, GeneralTab, GlobalSecurityTab, ApiKeyTab |
| 4: Wiring & migration | 64a0e6c | Done — main.ts rewired, old settings.ts deleted |
| 5: Polish & tests | 168a2cd | Done — tag-utils tests, lint fixes |
| Audit log fix | dd4e7b6 | Done — auto-create logs dir, 6 audit log live tests |

### Test Status
- **Unit tests:** 421/421 passing (28 files)
- **Live tests:** 34/34 passing (2 macOS-only skipped) — includes audit log verification
- **Build:** Clean (tsc + esbuild)
- **Lint:** Clean on src/ (only temp/ mockup files have errors)

### Next: GUI Bug Fixes (2026-04-01)

User tested the new settings UI in Obsidian and found issues. Bugs not yet cataloged — need screenshot or description from user. Known areas to investigate:

1. **Area assignment permissions** — when assigning an area to a key, all permissions default to false (correct per default-deny), but user found this confusing or broken
2. **General UI rendering** — user reported "jede menge fehler in der gui" (many GUI bugs) — specifics TBD
3. **Audit log visibility** — resolved: log file is `.log` not `.md`, so Obsidian doesn't show it. The "View log" button in settings opens it.

### Architecture (new settings/)
```
src/settings/
├── SettingsTab.ts              # Tab bar + routing + version header
├── tabs/
│   ├── GeneralTab.ts           # Server, API keys, audit
│   ├── GlobalSecurityTab.ts    # Areas, paths, tags, list mode
│   └── ApiKeyTab.ts            # Key CRUD, area assignments, effective perms
└── components/
    ├── PermissionMatrix.ts     # 4×4 CRUD grid (accessible)
    ├── PathEntry.ts            # Path row + browse + matrix
    ├── TagEntry.ts             # Tag row + picker + Read badge
    ├── VaultFolderModal.ts     # Directory picker modal
    └── TagPickerModal.ts       # Tag picker + manual entry
```

### Key Design Decisions (ADRs in SDD)
- ADR-1: Settings decomposed into tab + component files
- ADR-2: GlobalArea gets listMode + tags, AuditConfig gets logDirectory/logFileName/maxRetainedLogs
- ADR-3: Obsidian Modal class for pickers (not SuggestModal)
- ADR-4: Tags stored without #, normalized on input, getAllTags via metadataCache.getTags()
- ADR-5: listMode per scope (not per path/tag), key inherits from area

### Live Test Config
- Tests write deterministic config to data.json (backed up to .bak)
- Plugin reload required after first run (stale config detection)
- Config persists after tests — not auto-restored
- Rate limiting can cause flaky failures on rapid re-runs (<30s apart)

## Deferred Review Items

### M2 — Wildcard CORS restriction (2026-03-30)
- Location: src/mcp/server.ts:97
- Concern: `cors()` allows all origins — restrict to known clients
- Reason deferred: Requires determining exact client origin list; functional without it

### M4 — Percent-encoded path traversal (2026-03-30)
- Location: src/core/gates/path-access.ts:16
- Concern: PathAccessGate doesn't decode %2e%2e before traversal check
- Reason deferred: Obsidian vault API unlikely to interpret URL-encoded paths

### M11 — Pin obsidian dependency version (2026-03-30)
- Location: package.json:42
- Concern: `obsidian: latest` breaks reproducible builds

### M13 — Zod v4 vs v3 MCP SDK compat (2026-03-30)
- Location: src/mcp/tools.ts, package.json
- Concern: Zod v4 enum introspection may not render in MCP tool manifests

### H7 — Delete permission unreachable (2026-03-30)
- Location: src/types/canonical.ts:17
- Concern: CrudFlags.delete exists but no tool implements it — reserved for future kado-delete
