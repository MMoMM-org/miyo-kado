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

### R1/H5 — Audit buffered writes (2026-04-01)
- Location: src/main.ts:81
- Concern: Audit write reads full log on every entry; should buffer + batch append
- Reason deferred: Significant write chain architecture refactor; C1 fix already added .catch() recovery
- Branch: feat/kado-v1-implementation

### R2/H9 — Kokoro design record for v1 API (2026-04-01) — RESOLVED
- Location: docs/XDD/specs/001-kado/
- Concern: Constitution requires MCP tool schemas submitted to MiYo Kokoro before merge
- Resolution: Contract created at `_outbox/for-kokoro/kado-v1-mcp-api-contract.md` — ready for submission
- Branch: feat/kado-v1-implementation

### R7/M6 — Repeated linear key lookups across gate chain (2026-04-01)
- Location: src/core/gates/authenticate.ts:27, key-scope.ts:33
- Concern: config.apiKeys.find() called 5 times per request across gates
- Reason deferred: Touches multiple gate files; refactor scope beyond review fixes
- Branch: feat/kado-v1-implementation

### R13/M18 — Settings sub-components have zero tests (2026-04-01)
- Location: src/settings/components/*, src/settings/tabs/*
- Concern: UI components untested; config mutation paths not verified
- Reason deferred: Large scope — multiple new test files needed
- Branch: feat/kado-v1-implementation

### R14/L4 — Unbounded glob pattern complexity (2026-04-01)
- Location: src/core/glob-match.ts:16
- Concern: No validation on pattern length/depth; ReDoS potential
- Reason deferred: Low-risk, admin-only config surface
- Branch: feat/kado-v1-implementation

### R15/L8 — evictStaleEntries only triggers at 10K IPs (2026-04-01)
- Location: src/mcp/server.ts:42
- Concern: Stale rate-limit entries never cleaned until 10K threshold
- Reason deferred: Negligible impact in single-user Obsidian deployment
- Branch: feat/kado-v1-implementation
