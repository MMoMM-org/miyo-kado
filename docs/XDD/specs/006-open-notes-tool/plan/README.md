---
title: "Open Notes Tool — Implementation Plan"
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

## Specification Compliance Guidelines

### How to Ensure Specification Adherence

1. **Before Each Phase**: Read the referenced SDD sections and PRD acceptance criteria.
2. **During Implementation**: Reference specific SDD sections in commits (`ref SDD/Section X`).
3. **After Each Task**: Run unit tests, lint, typecheck. For test files, run `tsc` directly (build does not cover `test/**`).
4. **Phase Completion**: Verify all phase PRD acceptance criteria pass.

### Deviation Protocol

When implementation requires changes from the specification:
1. Document the deviation in the phase file with clear rationale.
2. Obtain user approval before proceeding.
3. Update SDD when the deviation improves the design (include in README Decisions Log).
4. Record all deviations in the phase file for traceability.

## Metadata Reference

- `[parallel: true]` — tasks that can run concurrently with same-phase siblings
- `[ref: document/section; lines: X-Y]` — links to PRD/SDD
- `[activity: type]` — activity hint for specialist selection

### Success Criteria

**Validate** = process verification ("did we follow TDD?")
**Success** = outcome verification ("does it behave correctly?")

---

## Context Priming

*GATE: Read all files in this section before starting any implementation.*

**Specification**:

- `docs/XDD/specs/006-open-notes-tool/requirements.md` — Product Requirements
- `docs/XDD/specs/006-open-notes-tool/solution.md` — Solution Design
- `docs/live-testing.md` — how to run the plugin against a real Obsidian vault (Phase 3)
- `docs/ai/memory/decisions.md` — prior architectural decisions (context only)

**Key Design Decisions** (from SDD Architecture Decisions):

- **ADR-1**: Reuse `filterResultsByScope` / `resolveScope` — no parallel path-ACL code.
- **ADR-2**: Feature gate is a standalone pure function (`gateOpenNoteScope`), NOT a `PermissionGate` in the chain.
- **ADR-3**: Enumerate only known view types (`markdown`, `canvas`, `pdf`, `image`) — no `iterateAllLeaves`.
- **ADR-4**: Path-ACL denial is silent. Feature-gate denial returns `FORBIDDEN` with `gate: 'feature-gate'`.
- **ADR-5**: One tool `kado-open-notes` with `scope` param (not three tools).
- **ADR-6**: Per-key default OFF, AND-combined with global (no inheritance).

**Implementation Context**:

```bash
# Testing
npm test                              # vitest suite (if configured)
npx tsc --noEmit                      # TypeScript check on src/
npx tsc --noEmit -p tsconfig.test.json # MUST run separately for test/ files
                                      # (build does not cover test/**)

# Quality
npm run lint                          # ESLint

# Build
npm run build                         # tsc + esbuild production bundle
npm run dev                           # esbuild watch mode (used with live-testing)
```

---

## Implementation Phases

Each phase is defined in a separate file. Tasks follow red-green-refactor: **Prime** (understand context), **Test** (red), **Implement** (green), **Validate** (refactor + verify).

> **Tracking Principle**: Track logical units that produce verifiable outcomes. The TDD cycle is the method, not separate tracked items.

- [x] [Phase 1: Core Foundation — Types, Config, Feature Gate, Adapter](phase-1.md)
- [ ] [Phase 2: MCP Tool Registration & Handler](phase-2.md)
- [ ] [Phase 3: Settings UI & End-to-End Validation](phase-3.md)

---

## Plan Verification

| Criterion | Status |
|-----------|--------|
| A developer can follow this plan without additional clarification | ✅ |
| Every task produces a verifiable deliverable | ✅ |
| All PRD acceptance criteria map to specific tasks | ✅ |
| All SDD components have implementation tasks | ✅ |
| Dependencies are explicit with no circular references | ✅ |
| Parallel opportunities are marked with `[parallel: true]` | ✅ |
| Each task has specification references `[ref: ...]` | ✅ |
| Project commands in Context Priming are accurate | ✅ |
| All phase files exist and are linked from this manifest | ✅ |
