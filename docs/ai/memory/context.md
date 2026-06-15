# Context — Kado
<!-- Current sprint focus, active work, known blockers. Updated: 2026-06-15 -->
<!-- This file is short-lived — prune entries older than 2 weeks via /memory-cleanup -->

## Active focus

None — no active sprint. v1 plus specs 006 (open-notes), 007 (partial read/write),
and 008 (kado-rename) have shipped to master. Cross-repo contract handoffs for the
rename tool (Kokoro contract + refinements, Tomo availability) are out; Kokoro
confirmed done.

## Open tech debt

None tracked. The v1-hardening review items (2026-04-01) are all closed:
- R1/H5 (audit buffered writes) — DONE: `audit-logger.ts` buffers + batch-flushes
  (500ms timer / `flush()` on unload); `main.ts` writes via `adapter.append`, size via
  `adapter.stat` (no read-modify-write).
- R14/L4 (glob ReDoS) — DONE: `validateGlobPattern` caps length (256) + consecutive
  `**` (3), wired into the settings path editor (`PathEntry.ts`); regex cache evicts at 1000.
- R15/L8 (rate-limit eviction) — DONE: periodic 60s timer (`evictExpiredEntries`,
  `server.ts`) clears expired entries regardless of map size.
- R2/H9, R7/M6, R13/M18 — resolved earlier (Kokoro contract submitted; `resolvedKey`
  cache across the gate chain; `test/settings/**` now exists).
