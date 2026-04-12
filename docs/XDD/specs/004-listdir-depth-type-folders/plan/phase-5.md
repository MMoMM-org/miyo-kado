---
title: "Phase 5: Schema, Integration, Documentation, Handoffs"
status: completed
version: "1.0"
phase: 5
---

# Phase 5: Schema, Integration, Documentation, Handoffs

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` §Documentation Updates
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` §Interface Specifications (MCP schema contract)
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` ADR-1 (depth parameter in kadoSearchShape)
- `docs/XDD/specs/004-listdir-depth-type-folders/requirements.md` §Success Metrics (post-ship validation obligations)
- `src/mcp/tools.ts` lines 68-74 (`kadoSearchShape`), 280 (`registerSearchTool` description)
- `docs/api-reference.md` lines 487-509 (current listDir public contract — to be rewritten)
- `test/integration/tool-roundtrip.test.ts` lines 419-452 (existing listDir integration test — to be migrated)
- `test/live/mcp-live.test.ts` lines 653, 712, 1066, 1308, 1530 (live test assertions — audit for listDir dependencies)
- `_inbox/from-kokoro/2026-04-09_kokoro-to-kado_listdir-depth-and-folder-items.md`
- `_inbox/from-tomo/2026-04-11_tomo-to-kado_listdir-api-gaps.md`

**Key Decisions**:
- Version bump: **0.1.5 → 0.2.0** via `feat:` conventional commit (semantic-release takes care of the actual version field in `manifest.json` and tags — the commit message classification is what matters).
- Integration tests that currently mock `vault.getFiles()` must be migrated to mock `TFolder` hierarchies. This is mechanical but touches multiple test files.
- Post-ship handoff replies to Tomo and Kokoro are part of this phase — they close the integration loop and must not be forgotten. They execute AFTER the implementation commits are merged.

**Dependencies**:
- **Depends on Phases 3 and 4** — the schema description and public docs must match the behavior that Phases 3 and 4 produced. Post-ship handoffs require the code to be shipped.
- Independent of Phase 2 once it merges — the schema update is in a different file than the HTTP 406 fix.

---

## Tasks

This phase closes the public surface: the MCP tool description, the developer-facing API doc, the integration and live test updates, and the cross-repo handoff replies. It is the last phase before the feature is considered complete.

- [x] **T5.1 MCP Tool Schema and Description Update** `[activity: backend-api]` `[ref: SDD/§Documentation Updates; ADR-1, ADR-6, ADR-8]`

  1. **Prime**: Read `kadoSearchShape` at `src/mcp/tools.ts:68-74` and the `registerSearchTool` call at line 280. Note the existing Zod import and the `.describe(...)` pattern used by other fields.
  2. **Test** (RED — add to `test/mcp/tools.test.ts` or similar):
      - Schema accepts a request with `depth: 5` and passes Zod validation.
      - Schema rejects `depth: -1`, `depth: 0`, `depth: 1.5`, `depth: "5"` via the Zod constraints (before the mapper-layer validation even runs — belt-and-suspenders).
      - Schema accepts omitting `depth` entirely.
      - The tool description string (the one registered via `registerTool`) contains the substrings: `"type:"`, `"folder"`, `"childCount"`, `"depth"`, `"/" `, `"VALIDATION_ERROR"`, `"NOT_FOUND"` — enough that an LLM reading the schema knows about every new capability and error mode.
  3. **Implement**:
      - Add the `depth` field to `kadoSearchShape`: `depth: z.number().int().positive().optional().describe('Walk depth for listDir. Omit for unlimited recursion. depth=1 returns only direct children.')`
      - Update the `path` description on `kadoSearchShape` to mention: `/` canonical vault root, trailing-slash acceptance, empty-string rejection, `NOT_FOUND` on missing paths, `VALIDATION_ERROR` when the target is a file.
      - Update the `registerSearchTool` description for the `kado-search` tool at line 280: describe the folder-awareness of `listDir`, the folders-first sort, the `type`/`childCount` response fields, and the new error semantics. Keep it concise — this is an LLM-read schema, not end-user docs.
  4. **Validate**: T5.1 tests pass. Existing schema tests still pass. `npm run build` + `npm run lint` clean.
  5. **Success**:
      - The MCP schema is the migration path (per Constraint CON-4) — any LLM client re-reading the schema understands the new behavior. `[ref: SDD/CON-4]`
      - Zod validation rejects invalid `depth` values at the transport layer as a first line of defense (mapper is second). `[ref: PRD/Feature 2 AC]`

- [x] **T5.2 Integration and Live Test Migration** `[activity: test-design]` `[ref: SDD/§Known Technical Issues (test mock fragility)]`

  1. **Prime**: Read the current listDir test in `test/integration/tool-roundtrip.test.ts:419-452`. Grep `test/live/mcp-live.test.ts` for listDir-related assertions at lines 653, 712, 1066, 1308, 1530. Read the walk-based test mock pattern established in Phase 3 (T3.2) — use it as the template.
  2. **Test** (RED — existing tests are failing after Phase 3 merged; this task makes them pass):
      - The integration test at `tool-roundtrip.test.ts:419-452` currently mocks `vault.getFiles()` — after Phase 3 this mock is unused and the test returns nothing. Failure is the starting state.
      - Any live test in `mcp-live.test.ts` that asserts "items are all files" or "length === file_count" is similarly broken.
  3. **Implement**:
      - Rewrite the `tool-roundtrip.test.ts` listDir integration test to use a TFolder-hierarchy mock (or a real test vault path if the test infrastructure supports it). Assert `type: 'file' | 'folder'` on every returned item. Assert folders-first sort. Assert `childCount` on at least one folder item.
      - Add an integration-level test for the trailing-slash reproducer if not already covered by Phase 2's reproducer — this test should stay in the suite as a regression guard.
      - Audit `mcp-live.test.ts` line-by-line for the 5 listDir references. For each, update assertions to (a) tolerate folder items appearing alongside files and (b) use `type: 'file'` when testing file-specific behavior.
      - Add at least one live test that exercises `depth: 1` on a non-trivial folder and asserts the shallow-scan behavior.
  4. **Validate**: `npm test -- test/integration/`, `npm test -- test/live/`, and the full suite `npm test` all pass. `npm run build` + `npm run lint` clean.
  5. **Success**:
      - All integration and live tests are migrated to the new walk-based implementation. `[ref: SDD/§Risks test mock fragility]`
      - The trailing-slash reproducer from Phase 2 is preserved as an integration regression test. `[ref: PRD/Feature 3]`
      - No test files use `vi.mocked(app.vault.getFiles)` for listDir assertions anymore.

- [x] **T5.3 API Reference Documentation Update** `[activity: docs]` `[ref: SDD/§Documentation Updates]` `[parallel: true]`

  1. **Prime**: Read `docs/api-reference.md` lines 487-509 — the current listDir section. Note its formatting conventions (header style, code block language, response-example layout).
  2. **Test**: Human review. This is documentation — validation is by reading it with the eyes of a new consumer and checking that every PRD Feature 1-8 capability is discoverable.
  3. **Implement**: Rewrite the listDir section in `docs/api-reference.md` to cover:
      - New request parameters: `depth?: number`, updated `path` semantics (`/` root marker, trailing-slash acceptance).
      - New response item shape: `type: 'file' | 'folder'`, `childCount` on folder items, `size: 0` / `created: 0` / `modified: 0` on folder items.
      - Sort order: folders first, alphabetical within each group, locale-independent.
      - Error codes: `NOT_FOUND` for missing paths and hidden targets, `VALIDATION_ERROR` for file targets and invalid `depth`.
      - Two concrete request/response examples: one `depth: 1` shallow scan, one unlimited-depth recursive.
      - A brief "Migration from 0.1.x" subsection noting the behavior changes (folders in responses, errors instead of empty lists, `/` root marker) — even though all consumers are LLM clients, the doc is used by humans reviewing the contract.
  4. **Validate**: Markdown lints clean (`npm run lint` if it includes md, or visual review). Links still resolve. Examples are internally consistent with Phase 3 and Phase 4 behavior.
  5. **Success**:
      - A developer reading only `docs/api-reference.md` can understand every new capability and error mode without consulting the SDD. `[ref: SDD/§Quality Requirements Usability]`
      - Consumer agents (Tomo, Kokoro, future) have a canonical reference document when writing their client code.

- [x] **T5.4 Post-Ship Handoff Acknowledgements** `[activity: coordination]` `[ref: PRD/§Success Metrics Tracking Requirements]`

  **NOTE**: This task executes **after** Phases 1-5's implementation commits have been merged to main. The handoff replies reference the merged code, not a draft branch.

  1. **Prime**: Read the original consumer handoffs in `_inbox/from-kokoro/2026-04-09_kokoro-to-kado_listdir-depth-and-folder-items.md` and `_inbox/from-tomo/2026-04-11_tomo-to-kado_listdir-api-gaps.md`. Read the `miyo-outbox` skill docs for the outbox handoff format.
  2. **Test**: No automated test. Validation is that each inbox file has `status: done` and each outbox file exists with the expected content.
  3. **Implement**:
      - **Tomo reply** (outbox to tomo):
        - Summarize that all four gaps are closed: folder entries with `type`, `depth` parameter, trailing-slash fix, `/` root marker.
        - List the four workarounds that can now be removed: `scripts/lib/kado_client.py` (trailing slash), `scripts/lib/kado_client.py` (empty path), `scripts/vault-scan.py` (flat file derivation), `scripts/moc-tree-builder.py` and `scripts/test-kado.py` (type filter).
        - Warn: `depth: -1` is NOT accepted; clients must omit `depth` for unlimited recursion.
        - Warn: folder items have `size: 0`, `created: 0`, `modified: 0` — scripts that use these fields must guard on `item.type === 'file'` first.
        - Include the version bump (`0.2.0`) and the commit/PR link.
        - Set `_inbox/from-tomo/2026-04-11_tomo-to-kado_listdir-api-gaps.md:status` to `done` via `inbox-set-status.sh`.
      - **Kokoro reply** (outbox to kokoro):
        - Summarize that the kokoro proposal is implemented with one divergence: `depth: -1` was rejected in favor of omitting the parameter. Explain why (single canonical form).
        - Flag: Kokoro's external reference at `global/references/kado-v1-api-contract.md` must be updated in the Kokoro repo to reflect the new contract. We cannot edit Kokoro's repo from Kado; this is a coordination item for Kokoro's own work.
        - Include the version bump (`0.2.0`), the commit/PR link, and a pointer to `docs/api-reference.md` as the authoritative listDir documentation.
        - Set `_inbox/from-kokoro/2026-04-09_kokoro-to-kado_listdir-depth-and-folder-items.md:status` to `done`.
  4. **Validate**: Both outbox files exist under `_outbox/to-tomo/` and `_outbox/to-kokoro/`. Both inbox files have `status: done` in their frontmatter. `git status` shows the new outbox files and the frontmatter updates, nothing unexpected.
  5. **Success**:
      - Cross-repo coordination is closed — Tomo and Kokoro know what changed, what they must do, and where to find the documentation. `[ref: PRD/§Success Metrics]`
      - No loose ends: zero handoffs remain in `pending` state for this feature.

- [x] **T5.5 Final Phase Validation and Version Commit** `[activity: validate]`

  1. **Prime**: Read the full test suite output, the full `git diff main`, and the README manifest in this spec directory. Confirm all Phase 1-4 tasks are checked off.
  2. **Implement**:
      - Run `npm test` — every test passes, no skipped-without-reason tests.
      - Run `npm run build` + `npm run lint` — zero errors.
      - Update `manifest.json` if semantic-release does not handle it automatically. Confirm the Conventional Commits message for the main PR starts with `feat(search):` so the release tooling picks the correct bump.
      - Walk through each of the 24 PRD Gherkin acceptance criteria and map them to passing tests. Any criterion without a test failure-then-pass trace is a gap — backfill the test.
  3. **Validate**:
      - PRD checklist: 24/24 acceptance criteria backed by passing tests.
      - SDD checklist: all 10 ADRs reflected in the shipped code. All 12 code files listed in §Implementation Context are modified as spec'd (except the read-only glob-match.ts).
      - Constitution: L1 Security, Architecture, Testing, Performance rules verified one last time against the final diff.
  4. **Success**:
      - Phase 5 is complete. The feature is shipped. `listDir` serves Tomo and Kokoro's structural-scan use cases with no workarounds remaining. `[ref: PRD/§Success Metrics]`
      - The spec directory's README is updated with a final "Shipped" decision-log row.
