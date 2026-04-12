---
title: "listDir — structural awareness, depth control, and error hygiene"
status: draft
version: "1.0"
---

# Product Requirements Document

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All required sections are complete
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Problem statement is specific and measurable
- [x] Every feature has testable acceptance criteria (Gherkin format)
- [x] No contradictions between sections

### QUALITY CHECKS (Should Pass)

- [x] Problem is validated by evidence (two inbox handoffs from real consumers)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking events
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Product Overview

### Vision

`kado-search listDir` becomes a first-class structural-traversal primitive: MCP agents can explore any Obsidian vault's folder hierarchy with a single call, choosing between a cheap shallow scan or a full recursive walk, and reasoning about the result without path-parsing heuristics.

### Problem Statement

Two MCP agent consumers — **Kokoro** (orchestration/spec-development) and **Tomo** (`/explore-vault` setup wizard) — independently hit four concrete limitations of the current `listDir` operation while building vault-exploration features. The problems are observed, reproducible, and already forcing workarounds downstream:

1. **No structural awareness.** The response shape has no way to represent a folder. Clients cannot discover subdirectories or distinguish files from folders without parsing paths. Empty subdirectories are effectively invisible. Kokoro hit this when building a vault-explorer that needed to count notes per concept; Tomo hit it across three Python scanner scripts that had to strip `type === 'file'` filters and re-derive subfolder structure from flat file paths.
2. **No depth control.** Every `listDir` call returns all descendants, even when the consumer only needs the top-level structure. For a 281-file subtree this means fetching 281 items and post-processing paths just to discover 6 subdirectories. Tomo's vault-scanner pays this cost on every structural query.
3. **Trailing-slash paths return HTTP 406.** Tomo's vault-config uses paths with trailing slashes (`100 Inbox/`, `Atlas/202 Notes/`). Passing them verbatim returns HTTP 406 Not Acceptable — a misleading error since nothing about content negotiation is at fault. Stripping the slash client-side works, but this is an undocumented requirement.
4. **No canonical vault-root marker.** `""` is rejected with an unhelpful `"Path must not be empty"` error. `/` is also rejected because the path-access gate strips leading slashes before validation, turning `/` into `""`. The only working form is to omit the `path` argument entirely — an undocumented convention. Tomo's client has a workaround for this in `kado_client.py`.

**Consequences of inaction:** every new MCP consumer that wants to reason about vault structure reinvents the same workarounds. Tomo already carries four patches across its Python scripts; these patches cannot be removed until Kado's API catches up. Kokoro's roadmap for vault-explorer features is gated on this work. Every future consumer pays the same tax.

### Value Proposition

A single, coherent `listDir` contract that:
- Returns **files and folders** with a `type` discriminator and an accurate `childCount`, making structure detection a single call instead of a post-process.
- Supports a `depth` parameter for shallow scans — massive latency and allocation savings for structural queries on large vaults.
- Accepts `/` as the canonical vault-root marker and `trailing slashes` on any folder path, both documented in the tool description.
- Returns explicit `NOT_FOUND` and `VALIDATION_ERROR` responses for invalid targets instead of silent empty lists, so consumers can distinguish "typo" from "wrong type".
- Enforces scope and hidden-entry filtering consistently, with no information leak about out-of-scope or hidden children.

The first two points let Kokoro and Tomo remove every workaround they have in flight. The last three prevent an entire class of subtle downstream bugs and security hazards.

## User Personas

### Primary Persona: Tomo — `/explore-vault` integration agent

- **Demographics:** Sibling MCP agent in the MiYo ecosystem. Python-based scanner scripts. Operates on arbitrary user vaults. Technical expertise: high.
- **Goals:** Walk an unknown Obsidian vault structurally, classify each top-level concept folder, count notes per concept, detect subdirectory nesting (for Dewey classification), and emit a MOC tree. All structural decisions happen in Phase 2 of the setup wizard.
- **Pain Points:** Four independent `listDir` bugs force workaround patches across `scripts/lib/kado_client.py`, `scripts/vault-scan.py`, `scripts/moc-tree-builder.py`, and `scripts/test-kado.py`. Cannot see empty subdirectories. Cannot do a cheap shallow scan — every query pulls the full subtree. Cannot tell files from folders without path-string heuristics.

### Primary Persona: Kokoro — orchestration and spec-development agent

- **Demographics:** MCP agent in the MiYo ecosystem responsible for spec generation and cross-project orchestration. Typically operates via LLM-authored tool calls against `kado-search`.
- **Goals:** During spec development, build a structural map of the target vault (subdirectories, empty folders, note counts) to drive downstream spec decisions. Needs efficient shallow queries to avoid pulling every file on every structural question.
- **Pain Points:** Same root cause as Tomo — `listDir` returns a flat recursive file list with no folder entries and no depth control. Shallow scans are impossible; structural discovery requires reading every file in the target subtree and parsing paths.

### Secondary Personas

**Future MCP consumers (any LLM-driven agent).** New agents added to the MiYo ecosystem (or third-party integrations against Kado) will read the updated tool schema and expect a modern `listDir`. Designing the contract for Tomo and Kokoro *also* means designing it for every future consumer. Acceptance criteria must be stated in terms of the tool contract, not specific agent implementations.

## User Journey Maps

### Primary User Journey: Tomo vault structural scan

1. **Awareness:** Tomo's `/explore-vault` Phase 2 starts. It needs a MOC tree of the user's vault plus per-concept note counts to run Dewey classification.
2. **Consideration:** Tomo reads the `kado-search` tool description. It sees `listDir` supports `depth` and returns `type: 'file' | 'folder'` items with `childCount` on folders. This is exactly the primitive needed.
3. **Adoption:** Tomo issues one `listDir` call with `path: "/"` and `depth: 1` to discover top-level concept folders. For each concept folder, Tomo issues a second `listDir` with `path: "<concept>/"` and `depth: 1` to enumerate direct subdirectories and count files.
4. **Usage:**
   - **Discover top-level structure** — `listDir({path: "/", depth: 1})` → list of top-level folders and root-level files.
   - **Detect a concept folder's subdirectories** — `listDir({path: "Atlas/202 Notes/", depth: 1})` → 6 folder items with `childCount`, plus direct files.
   - **Deep-scan a subtree** — `listDir({path: "Atlas/202 Notes/"})` (depth omitted) → full recursive walk.
   - **Handle typos** — if Tomo's vault-config references a non-existent path, Kado returns `NOT_FOUND`, Tomo logs and skips.
   - **Handle stale file references** — if a config path points to a file instead of a folder, Kado returns `VALIDATION_ERROR` with a clear "got file" message, Tomo logs and skips.
5. **Retention:** Tomo removes its four Python workarounds (`kado_client.py` trailing-slash strip, `kado_client.py` empty-path drop, `vault-scan.py` path-derivation, `moc-tree-builder.py` type filter). Subsequent runs use the native API directly.

### Secondary User Journey: Kokoro spec-development structural analysis

1. **Awareness:** Kokoro is drafting a spec that needs vault-structure context (e.g., "how is the user's Atlas/202 Notes currently organized?").
2. **Consideration:** Kokoro calls `listDir({path: "Atlas/202 Notes/", depth: 1})` instead of pulling all 281 files and post-processing.
3. **Usage:** Kokoro iterates the returned folder items, uses `childCount` for volume estimates, and writes the findings into the spec.
4. **Retention:** Kokoro's own reference doc (`global/references/kado-v1-api-contract.md`, external) is updated post-ship to reflect the new contract; future spec-development sessions use the documented form.

## Feature Requirements

### Must Have Features

#### Feature 1: Folder entries in `listDir` responses

- **User Story:** As a vault-explorer agent, I want `listDir` to return folder entries alongside files, so that I can discover subdirectories and empty folders without parsing file paths.
- **Acceptance Criteria (Gherkin):**
  - [ ] Given a vault where `Atlas/` contains subfolders `People/` and `Notes/` plus a file `Atlas/README.md`, When the agent calls `listDir({path: "Atlas/"})`, Then the response contains at least two items with `type: 'folder'` (`Atlas/People` and `Atlas/Notes`) and one item with `type: 'file'` (`Atlas/README.md`).
  - [ ] Given a folder that contains an empty subfolder `Empty/`, When the agent calls `listDir({path: "Atlas/", depth: 1})`, Then the response contains a folder item for `Empty` with `childCount: 0`.
  - [ ] Given a folder with 5 direct children (3 files + 2 subfolders), When the agent calls `listDir({path: "Atlas/", depth: 1})`, Then the `childCount` on the `Atlas` folder item (when it appears in a parent listing) is `5`.

#### Feature 2: `depth` parameter for controlled recursion

- **User Story:** As a vault-explorer agent, I want to control recursion depth on `listDir`, so that I can do a cheap shallow scan of direct children instead of fetching the entire subtree on every structural query.
- **Acceptance Criteria (Gherkin):**
  - [ ] Given a folder `Atlas/` with direct children and grandchildren, When the agent calls `listDir({path: "Atlas/", depth: 1})`, Then no grandchild items appear in the response.
  - [ ] Given the same folder, When the agent calls `listDir({path: "Atlas/"})` (depth omitted), Then all descendants appear, recursively.
  - [ ] Given a request with `depth: 0`, `depth: -1`, `depth: 1.5`, or `depth: "1"`, When the mapper validates the request, Then the response is `VALIDATION_ERROR` with message `"depth must be a positive integer"`.
  - [ ] Given a three-level tree `Atlas/L1/L2/L3/file.md`, When the agent calls `listDir({path: "Atlas/", depth: 2})`, Then items at level 2 appear but level-3 items (including `file.md`) do not.

#### Feature 3: Trailing-slash paths accepted

- **User Story:** As an integration script, I want `listDir` to accept paths with trailing slashes without returning HTTP 406, so that I can pass vault-config paths verbatim.
- **Acceptance Criteria (Gherkin):**
  - [ ] Given a valid folder path `100 Inbox`, When the agent calls `listDir({path: "100 Inbox/"})` (with trailing slash), Then the response is a successful listing with the same item set as `listDir({path: "100 Inbox"})` (without trailing slash).
  - [ ] Given any valid folder path, When any request to `listDir` carries a trailing slash on the `path` argument, Then the response is never HTTP 406.

#### Feature 4: Canonical `/` vault-root marker and helpful empty-path error

- **User Story:** As a client library, I want to pass `"/"` as a canonical vault-root marker, so that I have a documentable, explicit form for "list vault root" instead of relying on the undocumented omit-path convention.
- **Acceptance Criteria (Gherkin):**
  - [ ] Given a request `listDir({path: "/"})`, When the mapper processes it, Then the result is equivalent to omitting `path` entirely and the response is a listing of the vault root.
  - [ ] Given a request with `path: ""`, When the mapper validates it, Then the response is `VALIDATION_ERROR` with message `"path must not be empty. Use '/' to list the vault root."`.
  - [ ] Given a request `byContent({query: "foo", path: "/"})`, When the mapper processes it, Then the result is equivalent to a whole-vault `byContent` search (same behavior as omitting `path`).

#### Feature 5: `type` discriminator on response items

- **User Story:** As a consumer script, I want each `listDir` response item to carry a `type: 'file' | 'folder'` field, so that I can branch on entry type without path-parsing heuristics.
- **Acceptance Criteria (Gherkin):**
  - [ ] Given any `listDir` response, When the agent iterates items, Then every item has a `type` field set to either `'file'` or `'folder'`.
  - [ ] Given a response item with `type: 'folder'`, When the agent reads numeric fields, Then `size`, `created`, and `modified` are all `0`.
  - [ ] Given responses from other search operations (`byName`, `byTag`, `byContent`, `byFrontmatter`, `listTags`), When the agent iterates items, Then no item has a `type` field set.

#### Feature 6: Explicit errors for invalid `listDir` targets

- **User Story:** As a vault-explorer agent, I want `listDir` on a nonexistent or file-targeted path to return an explicit error rather than an empty list, so that I can distinguish "nothing here" from "wrong path" in automated workflows.
- **Acceptance Criteria (Gherkin):**
  - [ ] Given a request `listDir({path: "DoesNotExist/"})`, When the adapter resolves the path, Then the response is `NOT_FOUND` with message `"Path not found: DoesNotExist/"`.
  - [ ] Given a request `listDir({path: "Atlas/README.md"})` where `README.md` is a file, When the adapter resolves the path, Then the response is `VALIDATION_ERROR` with message `"listDir target must be a folder, got file: Atlas/README.md"`.
  - [ ] Given neither of the above, the response is never an empty `items` array with a `total: 0` that could be confused with "empty folder".

#### Feature 7: Hidden entries and out-of-scope children excluded from results and counts

- **User Story:** As a security-conscious API surface, I want `listDir` to hide `.`-prefixed entries and respect the caller's scope patterns for folder visibility and `childCount`, so that no information about hidden or inaccessible children leaks to the caller.
- **Acceptance Criteria (Gherkin):**
  - [ ] Given a vault with `.obsidian/`, `.trash/`, and regular folders at the root, When the agent calls `listDir({path: "/"})`, Then the response contains no items with a leading-dot name.
  - [ ] Given a direct request `listDir({path: ".obsidian"})` (or any path containing a `.`-prefixed segment), When the adapter resolves the path, Then the response is `NOT_FOUND` (not `VALIDATION_ERROR`) to avoid confirming the folder's existence.
  - [ ] Given an API key with `scopePatterns: ["Atlas/**"]` and a vault with folders `Atlas/` and `Private/`, When the agent calls `listDir({path: "/"})`, Then `Atlas` appears in the response but `Private` does not.
  - [ ] Given a folder that contains 3 visible children and 2 hidden children (dot-prefixed), When the folder appears as an item in a parent listing, Then its `childCount` is `3`, not `5`.
  - [ ] Given a folder whose direct children include out-of-scope files, When the folder appears as an item, Then its `childCount` reflects only the in-scope children.

### Should Have Features

#### Feature 8: Folders-first result ordering

- **User Story:** As a paginated consumer, I want `listDir` results to return folders before files, so that I know the complete folder set is visible as soon as any file item appears in the stream.
- **Acceptance Criteria (Gherkin):**
  - [ ] Given a folder with mixed files and subfolders and a `limit` of 3, When the agent calls `listDir({path: "Atlas/", depth: 1, limit: 3})`, Then page 1 contains folder items before file items.
  - [ ] Given a stream of items from consecutive `listDir` calls with the same parameters and a moving cursor, When the consumer observes the first `type: 'file'` item, Then all subsequent items are files and no more folders will appear on later pages.
  - [ ] Given items grouped by `type`, When sorted, Then items within each group are ordered alphabetically by full `path` using deterministic case-sensitive comparison (runtime-locale-independent).

### Could Have Features

- **Advisory max-items cap.** A future optional safeguard that caps unlimited-recursive responses on very large vaults at a configurable maximum (e.g., 10,000 items) with a truncation indicator. Not required now — the current pagination model already mitigates this, and no consumer has reported a concrete OOM scenario.

### Won't Have (This Phase)

- Adding `type` or `childCount` to other search operations (`byName`, `byTag`, `byContent`, `byFrontmatter`, `listTags`). Only `listDir` gains structural awareness in this phase.
- A separate `listChildren` operation. One operation with a `depth` parameter is sufficient; a second entry point is explicitly rejected as redundant.
- Folder `mtime` / `ctime` via `app.vault.adapter.stat()`. No known use case; folder timestamps are zero-valued placeholders.
- `depth: -1` as a synonym for "unlimited recursion". Omitting the parameter is the single canonical form; `-1` is rejected with `VALIDATION_ERROR`. A migration note will be sent to Kokoro whose original handoff proposed `-1`.
- Richer folder metadata (aggregate `size`, recursive descendant count, `contentType` / `mimeType` on files). Deferred to a future `folderInfo` / `stats` operation if a use case emerges.
- Feature flags, migration shims, or a deprecation period. All consumers are MCP LLM clients reading the updated tool schema; the schema description is the migration path.

## Detailed Feature Specifications

### Feature: `listDir` depth-controlled structural walk (Feature 1 + 2 + 5 + 7)

**Description:** `listDir` walks the requested folder subtree, optionally limited to N levels of descent, and returns a mixed list of file and folder entries. Each entry carries a `type` discriminator. Folder entries carry a `childCount` that reflects only visible (scope-filtered, non-hidden) direct children. The walk is efficient for shallow scans (`depth: 1`) and equivalent to the current behavior when `depth` is omitted.

**User Flow:**

1. Agent calls `kado-search listDir` with a folder path, an optional `depth`, optional `limit`, and optional `cursor`.
2. Mapper validates `depth` is a positive integer or absent. Mapper recognizes `/` as vault-root and rejects `""` with a helpful error.
3. Adapter resolves the path to a folder. If path points to a file → `VALIDATION_ERROR`. If path does not exist or targets a hidden (dot-prefixed) segment → `NOT_FOUND`.
4. Adapter walks the folder's children, respecting `depth`, skipping `.`-prefixed children, and recording each file and folder with scope-aware `childCount`.
5. Adapter sorts results (folders first, then files, alphabetical within each group).
6. Adapter returns a paginated slice via the existing cursor mechanism.

**Business Rules:**

- **BR-1:** `depth` omitted → unlimited recursion. `depth: N` where N ≥ 1 → walk N levels below the target. `depth: 0`, negative, non-integer, or non-number → `VALIDATION_ERROR`.
- **BR-2:** `path: "/"` and omitted `path` both mean "vault root". `path: ""` is rejected. Trailing slashes on any non-root path are accepted.
- **BR-3:** Every `listDir` response item has `type: 'file' | 'folder'`. Folder items have `size: 0`, `created: 0`, `modified: 0`, and a `childCount` field. File items carry real `size`, `created`, `modified` values from Obsidian's `TFile.stat`.
- **BR-4:** Any file or folder whose name starts with `.` is invisible. It is skipped during the walk and does not contribute to any parent's `childCount`. An explicit request for a dot-prefixed path returns `NOT_FOUND`, not `VALIDATION_ERROR` (to avoid confirming existence).
- **BR-5:** Folder visibility respects the caller's scope patterns. A folder is visible in a listing iff at least one of the caller's scope patterns could match a child of that folder.
- **BR-6:** A folder's `childCount` reflects only direct children the caller is allowed to see (not hidden, not out-of-scope). It is never the raw `children.length`.
- **BR-7:** Results are sorted folders-first, then files, alphabetical within each group, with runtime-locale-independent ordering.
- **BR-8:** Pagination cursors are only valid for requests with identical parameters. Changing `depth`, `path`, or `operation` between paginated calls invalidates the cursor. No runtime enforcement; documented in the tool description.
- **BR-9:** A path that resolves to a file returns `VALIDATION_ERROR: "listDir target must be a folder, got file: {path}"`. A path that does not resolve returns `NOT_FOUND: "Path not found: {path}"`. Neither returns an empty list.

**Edge Cases:**

- **Empty folder:** → Returned with `childCount: 0`. The walk visits it, produces zero child items, and the parent listing still includes it.
- **Folder whose only children are hidden** (e.g., contains only `.gitignore`): → Visible in parent listing, but `childCount: 0`. Direct request for it returns an empty `items` array (folder exists, visible, has no visible children — this is legitimately "empty from the caller's perspective").
- **Folder whose only children are out-of-scope:** → Visible in parent listing if any scope pattern could match inside it; `childCount` reflects zero visible children. Direct request returns an empty `items` array.
- **Cursor replayed with different `depth`:** → Undefined behavior (documented). Consumer is responsible for cursor-parameter consistency.
- **Vault root is empty:** → `listDir({path: "/"})` returns an empty `items` array with `total: 0`, no error.
- **Request targets a symlink that points outside the vault:** → Obsidian's `TFolder` structure does not include out-of-vault entries, so the adapter never encounters them. No special handling needed.
- **Consumer passes `depth: -1`** (Kokoro's legacy proposal): → `VALIDATION_ERROR: "depth must be a positive integer"`. Documented in the tool description; Kokoro's reply handoff explicitly warns about this.

## Success Metrics

### Key Performance Indicators

This feature ships when every consumer-reported issue is closed and downstream workarounds can be removed. Success is measured by the concrete observable effects on the two primary consumers.

- **Adoption:** `listDir` calls from Tomo and Kokoro use the new fields (`depth`, `type`, `childCount`) after ship. Target: ≥ 90% of structural-query `listDir` calls from Tomo's `/explore-vault` pipeline pass a `depth` argument within one week of Tomo updating its client.
- **Engagement:** Tomo's four Python workarounds in `scripts/lib/kado_client.py`, `scripts/vault-scan.py`, `scripts/moc-tree-builder.py`, and `scripts/test-kado.py` are removed in a single follow-up PR on the Tomo repo after Kado ships. Target: four workaround removals, zero retained workarounds.
- **Quality:** Acceptance criteria from Features 1–7 all pass in the Kado test suite. Zero regressions in existing `listDir` integration tests after mocks are updated. Target: 100% of Gherkin criteria pass; existing integration tests pass after mock migration.
- **Business Impact:** Tomo's `/explore-vault` Phase 2 is unblocked. Kokoro's vault-explorer spec work is unblocked. Zero new inbox handoffs from either consumer reporting the same `listDir` gaps within 30 days of ship.

### Tracking Requirements

Because Kado is an Obsidian plugin with no telemetry pipeline, "tracking" happens via the audit log (`logs/kado-audit.log`, NDJSON) and handoff acknowledgements rather than product analytics events.

| Event | Properties | Purpose |
|-------|------------|---------|
| `kado-search listDir` call (audit log) | `operation`, `path`, `depth`, `limit`, `keyId`, `duration_ms`, `itemCount` | Confirm post-ship that consumers pass `depth` on structural queries and that shallow scans are cheaper than deep scans |
| Tomo handoff acknowledgement | `_inbox/from-tomo/...md:status=done` + reply outbox note | Confirm workarounds have been removed downstream |
| Kokoro handoff acknowledgement | `_inbox/from-kokoro/...md:status=done` + reply outbox note | Confirm Kokoro's external `kado-v1-api-contract.md` has been updated |
| New inbox items mentioning `listDir` | Any new handoff filed within 30 days of ship referencing this operation | Detect if the change introduced new gaps or missed edge cases |

---

## Constraints and Assumptions

### Constraints

- **Obsidian plugin platform.** This work ships as part of the Kado Obsidian plugin. No backend, no server runtime other than the embedded MCP HTTP server. Walks are in-process against the plugin's live `App.vault` state.
- **TypeScript strict mode.** All code must compile under `"strict": true` with no `any` (see `src/CLAUDE.md`). All imports must align with existing patterns (node → external → internal).
- **TDD rules.** No implementation code before a failing test (from `src/CLAUDE.md`). Every feature in this PRD must have a failing test written first.
- **MCP tool schema is the contract.** There is no API versioning story for Kado other than the updated Zod schema and the tool description text. Consumers are LLM clients that read the schema fresh on every session.
- **No feature flags, no backward-compat shims.** Additive changes only in TypeScript types; observable behavior changes are allowed because the schema description is the migration path.
- **Version bump: 0.2.0.** Semantic-release + Conventional Commits. This change is a `feat:` commit (not `fix:`) because it introduces new functionality, even though it also closes two bugs.

### Assumptions

- **All `listDir` consumers are MCP LLM clients** (Tomo, Kokoro, any future agent). They read the updated tool schema on every session and adapt to new fields without code changes. This assumption is what allows us to add folders to the default recursive response without a migration period.
- **Tomo commits to updating its Python client** after Kado ships. The value proposition depends on Tomo removing its four workarounds; this is a coordination assumption, not a Kado guarantee.
- **Kokoro can update its external `global/references/kado-v1-api-contract.md`** as a cross-repo task after receiving our handoff. We cannot edit Kokoro's repo from Kado.
- **No end-user (human) interaction.** Nothing in this feature is visible in an Obsidian UI surface. No settings screen, no command palette, no status bar.
- **Obsidian's `TFolder.children` property is live and stable** across plugin lifecycle. We assume it reflects the in-memory vault tree without requiring a refresh call. (Confirmed by Performance research: `children: TAbstractFile[]` is a plain class field, not a getter.)

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| HTTP 406 root cause is in the MCP SDK or transport layer and cannot be fixed locally | Medium | Medium | Spec explicitly includes a contingency: strip trailing slashes in the mapper as a workaround if the root cause is out of our control. Investigation task is first in the plan so the contingency is exposed early. |
| Existing `listDir` tests mock `vault.getFiles()` and break when the implementation switches to `TFolder.children` | Medium | High | Integration research identified every test location (`test/obsidian/search-adapter.test.ts` listDir block, `test/integration/tool-roundtrip.test.ts`, `test/live/mcp-live.test.ts`). Plan must include a dedicated test-mock migration task. |
| `tools.ts` scope filter (`filterResultsByScope` and blacklist filter) applies plain `matchGlob` to folder items, producing wrong results | High | High | Research flagged this as a correctness gap in the brainstorm spec. SDD must include a folder-aware refactor of both sites; not optional. |
| `childCount` computed from filtered walk adds per-folder scope-check cost | Low | Medium | The filter is an in-memory glob match against a small pattern list. Perf research shows the total walk cost is dominated by item allocation, not pattern matching. Acceptable. |
| Consumer ignores the tool description update and continues to use files-only iteration | Low | Low | MCP LLM clients re-read the schema per session. If a specific Tomo script assumes files-only and parses `size > 0`, it will encounter `size: 0` folder items and needs a guard. The outbox handoff to Tomo explicitly warns about this. |
| `depth: -1` is already shipped in Kokoro's client and breaks after rejection | Low | Low | Research confirmed Kokoro's handoff proposed `-1` but no Kokoro client has been built yet. Outbox reply to Kokoro will warn about the rejection and point at `omit depth` as the canonical form. |
| Security regression: explicit `path: ".obsidian"` bypasses hidden-entry filter | High | Was high (closed) | Decision logged: `resolveFolder` rejects any dot-prefixed segment and returns `NOT_FOUND`. Acceptance criterion in Feature 7 tests this. |
| Security regression: `childCount` leaks existence of hidden or out-of-scope children | Medium | Was high (closed) | Decision logged: `childCount` reflects the filtered count, not `children.length`. Acceptance criteria in Feature 7 test both hidden-children and out-of-scope-children exclusion. |

## Open Questions

- [ ] HTTP 406 root cause investigation is deferred to the implementation phase. The investigation task (reproducer test → stack trace → root-cause fix) is the first sub-task of the plan. If the root cause lies outside our codebase, we fall back to the mapper-level strip contingency.
- [ ] Whether the `childCount` "filtered" semantics should be extended to a second exposed field (e.g., `totalChildCount` for the raw count) if a consumer ever wants to detect hidden/out-of-scope presence. Not requested yet; parking-lot candidate if the question comes up.

---

## Supporting Research

### Competitive Analysis

Not applicable in the traditional sense — Kado is an internal Obsidian plugin and the "competitors" are the current listDir implementation and hypothetical alternative designs. The brainstorm phase evaluated three alternative API shapes:

- **Boolean `recursive` flag** — simplest, rejected because it cannot express `depth: 2` or `depth: 3` if ever needed.
- **Numeric `depth` parameter** — ✅ **selected.** Matches Kokoro's original proposal, one canonical form for unlimited (`omit`), linear semantics, small validation surface.
- **Separate `listChildren` operation** — rejected. Maximum backward compatibility, but two overlapping operations forever.

Scope filtering for folder entries considered three strategies:
- **Plain `matchGlob` against folder paths** — rejected, incorrectly hides folders the caller can read into.
- **Folder visible iff any scope pattern could match a child** — ✅ **selected.** Matches user intuition, reuses the existing `dirCouldContainMatches` helper in `src/core/glob-match.ts`.
- **Skip scope filtering on folders** — rejected, information leak.

### User Research

Two first-hand handoff documents from consumer agents, archived at:
- `_inbox/from-kokoro/2026-04-09_kokoro-to-kado_listdir-depth-and-folder-items.md`
- `_inbox/from-tomo/2026-04-11_tomo-to-kado_listdir-api-gaps.md`

Both documents describe observed pain points with specific code references and reproducers. Tomo's handoff includes file-and-line evidence for every issue. The two handoffs were filed independently and converge on the same root problem, which is strong evidence of an actual shared pain point and not a speculative design request.

### Market Data

Vault size reference points from the handoffs and research:
- Atlas/202 Notes in Kokoro's test vault: 281 markdown files + 6 subfolders (209 additional files inside subfolders, total 490).
- Tomo's `/explore-vault` is designed to scan vaults of arbitrary size, typically 1k–100k files.
- Kado's test vault at `test/MiYo-Kado/` currently has a modest structure; the plan must extend it with deeper nesting, empty folders, and folders containing only subfolders to exercise the new walk semantics.
- Performance research confirmed `TFolder.children` is O(1) access and the new walk is dramatically cheaper than `getFiles()` + prefix-filter for any subtree target.
