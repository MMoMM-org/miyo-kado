---
title: "Partial Note Read/Write — Implementation Plan"
status: draft
version: "1.0"
---

# Implementation Plan

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All `[NEEDS CLARIFICATION: ...]` markers have been addressed
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

## Overview

Adds partial read (`firstXChars` / `section` / `range`) and partial write
(`append` / `prepend` / `insertUnderHeading` / `replaceSection` / `replaceRange`)
to `kado-read` / `kado-write` for `operation: "note"`. Reuses the existing gate
chain — partial reads are Note-Read, partial writes are Note-Update. Backward
compatible: omitting `mode` behaves byte-for-byte like today.

- PRD: [`requirements.md`](../requirements.md)
- SDD: [`solution.md`](../solution.md) (ADR-1 … ADR-8 confirmed)
- Tracking: [#69](https://github.com/MMoMM-org/miyo-kado/issues/69)

## Context Priming

Read before starting any phase:
- `docs/XDD/specs/007-partial-note-rw/solution.md` — design, ADRs, traced walkthroughs
- `src/types/canonical.ts` — request/result types + type guards
- `src/obsidian/note-adapter.ts` — current read/update/create + dirty-editor guard
- `src/mcp/request-mapper.ts` — existing frontmatter `mode` validation pattern
- `src/core/gates/datatype-permission.ts` + `src/core/concurrency-guard.ts` — create/update discrimination (the ADR-2 surface)
- `src/CLAUDE.md` — TDD rules; `test/CLAUDE.md` — test conventions
- Build/test split (auto-memory `kado_build_typecheck_scope`): `npm run build` typechecks `src/` only — run `npx tsc` on touched `test/` files.

## Phases

- [x] [Phase 1: Foundations — types & pure slice helpers](phase-1.md)
- [x] [Phase 2: Gate chain — create/update discrimination & lock semantics](phase-2.md)
- [x] [Phase 3: Request mapping & validation boundary](phase-3.md)
- [x] [Phase 4: Note adapter — partial read slicing & partial write](phase-4.md)
- [x] [Phase 5: MCP surface, docs & end-to-end](phase-5.md)

## Dependency Graph

```
Phase 1 (types + partial-slice)
   |
   |--> Phase 2 (gate chain) ......... highest risk (ADR-2)
   |--> Phase 3 (request-mapper) ..... may run parallel to Phase 2 (different file)
   |
   '--> Phase 4 (adapter) ............ needs Phase 1 + Phase 2 (routing = 3rd ADR-2 site)
            |
            '--> Phase 5 (MCP + docs + E2E) ... needs Phases 1-4
```

- Phase 1 is the foundation (no Obsidian dependency).
- **Phase 2 is the highest-risk work (ADR-2 three-site change).** Phase 4 contains the third site (adapter routing) and must follow Phase 2.
- Phase 3 touches only `request-mapper.ts` and may run in parallel with Phase 2.
- Phase 5 integrates and proves backward compatibility.

## Project Commands

```bash
npm run build                              # tsc -noEmit (src only) + esbuild
npx vitest run                             # full unit suite
npx vitest run <file>                      # focused
npx tsc --noEmit -p tsconfig.test.json     # typecheck test/** (NOT covered by build)
npm run lint                               # eslint src/  (stylelint may be absent locally)
# Live testing: docs/live-testing.md
```

## Deviations

_None yet. Record here with rationale if implementation requires a spec change (per Deviation Protocol)._
