---
title: "listDir — structural awareness, depth control, and error hygiene"
status: draft
version: "1.0"
---

# Implementation Plan

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All `[NEEDS CLARIFICATION]` markers have been addressed
- [x] All specification file paths are correct and exist
- [x] Each phase follows TDD: Prime → Test → Implement → Validate
- [x] Every task has verifiable success criteria
- [x] A developer could follow this plan independently

### QUALITY CHECKS (Should Pass)

- [x] Context priming section is complete
- [x] All implementation phases are defined with linked phase files
- [x] Dependencies between phases are clear (no circular dependencies)
- [x] Parallel work is properly tagged with `[parallel: true]`
- [x] Activity hints provided for specialist selection `[activity: type]`
- [x] Every phase references relevant SDD sections
- [x] Every test references PRD acceptance criteria
- [x] Integration & E2E tests defined in final phase
- [x] Project commands match actual project setup

---

## Context Priming

*GATE: Read all files in this section before starting any implementation.*

**Specification:**

- `docs/XDD/specs/004-listdir-depth-type-folders/requirements.md` — PRD (7 Must features, 24 Gherkin acceptance criteria)
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` — SDD (10 ADRs, worked implementation examples)
- `docs/XDD/ideas/2026-04-11-listdir-depth-type-folders.md` — brainstorm source (pre-spec)

**Reference documents:**

- `src/CLAUDE.md` — TDD discipline, TypeScript strict, import-order convention
- `Constitution.md` — L1 rules on Security (double-layer ACL), Testing (happy + denial per tool), Performance (pagination, main-thread safety)
- `docs/api-reference.md` — current listDir contract at lines 487-509 (to be updated)
- `_inbox/from-kokoro/2026-04-09_kokoro-to-kado_listdir-depth-and-folder-items.md` — consumer request
- `_inbox/from-tomo/2026-04-11_tomo-to-kado_listdir-api-gaps.md` — consumer request

**Key Design Decisions** (from SDD ADRs — all confirmed during brainstorm/research):

- **ADR-1**: Numeric `depth` parameter — positive integer or omit for unlimited; no `-1` alias
- **ADR-2**: `TFolder.children` walk replaces `vault.getFiles()` for listDir
- **ADR-3**: Folders appear in default recursive response (not only when depth is set)
- **ADR-4**: `childCount` reflects filtered count of visible children, not raw `children.length`
- **ADR-5**: Hidden folder targets return `NOT_FOUND` (security: no existence confirmation)
- **ADR-6**: `/` is canonical vault-root marker; `""` is rejected with helpful error
- **ADR-7**: Folders-first sort, alphabetical within each group, locale-independent
- **ADR-8**: `NOT_FOUND` for missing path, `VALIDATION_ERROR` for file target — no silent empty lists
- **ADR-9**: Scope-filter refactor spans both `search-adapter.ts` and `tools.ts` (three defense layers)
- **ADR-10**: Reuse `dirCouldContainMatches` from `src/core/glob-match.ts:75-80` instead of reinventing

**Implementation Context:**

```bash
# Testing
npm test                              # Unit tests (vitest)
npm test -- --watch                   # Watch mode for TDD
npm test -- test/obsidian/search-adapter.test.ts   # Single file

# Quality
npm run lint                          # ESLint
npm run build                         # tsc + esbuild (typecheck + build)

# Dev loop
npm run dev                           # esbuild watch mode
```

**Test fixture vault**: `test/MiYo-Kado/` — extended in Phase 3 with deeper nesting, empty folders, and folder-only-subfolders cases.

---

## Implementation Phases

Each phase is defined in a separate file. Tasks follow red-green-refactor: **Prime** (understand context), **Test** (red), **Implement** (green), **Validate** (refactor + verify).

> **Tracking Principle**: Track logical units that produce verifiable outcomes. The TDD cycle is the execution method, not separately tracked items.

- [ ] [Phase 1: Types and Mapper Foundation](phase-1.md)
- [ ] [Phase 2: HTTP 406 Bug #1 Investigation and Fix](phase-2.md)
- [ ] [Phase 3: listDir Walk and Fixtures](phase-3.md)
- [ ] [Phase 4: Scope Filter Refactor (Three-Layer Defense)](phase-4.md)
- [ ] [Phase 5: Schema, Integration, Documentation, Handoffs](phase-5.md)

**Phase dependency graph:**

```
Phase 1 (types + mapper) ─┬─> Phase 3 (walk) ──> Phase 4 (scope) ──> Phase 5 (schema/integration/docs)
Phase 2 (HTTP 406)  [parallel with Phase 1] ─────────────────────────┘
```

Phase 2 can run in parallel with Phase 1 because the HTTP 406 investigation may land in any layer and does not depend on the type-system changes. Phases 3→4→5 are strictly sequential because they depend on each prior phase's deliverables.

---

## Plan Verification

Before this plan is ready for implementation, verify:

| Criterion | Status |
|-----------|--------|
| A developer can follow this plan without additional clarification | ✅ |
| Every task produces a verifiable deliverable | ✅ |
| All PRD acceptance criteria map to specific tasks | ✅ (traced in phase files) |
| All SDD components have implementation tasks | ✅ |
| Dependencies are explicit with no circular references | ✅ |
| Parallel opportunities are marked with `[parallel: true]` | ✅ (Phase 2) |
| Each task has specification references `[ref: ...]` | ✅ |
| Project commands in Context Priming are accurate | ✅ |
| All phase files exist and are linked from this manifest as `[Phase N: Title](phase-N.md)` | ✅ |
