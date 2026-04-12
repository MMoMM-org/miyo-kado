---
title: "Full Vault Access & listDir Scope Fix"
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

## Context Priming

*GATE: Read all files in this section before starting any implementation.*

**Specification**:
- `docs/XDD/specs/005-full-vault-access-and-listdir-scope-fix/requirements.md` — Product Requirements
- `docs/XDD/specs/005-full-vault-access-and-listdir-scope-fix/solution.md` — Solution Design

**Key Design Decisions**:
- **ADR-1**: Use `**` glob as the full-vault access pattern — no special-casing in permission engine
- **ADR-2**: Filter files in walk() during collection — consistent with folder filtering, better memory
- **ADR-3**: Silent `/` → `**` migration in config-manager load() — follows existing pattern
- **ADR-4**: Remove `**` warning from validateGlobPattern — it's an officially supported pattern

**Implementation Context**:
```bash
# Testing
npx vitest run                    # Unit tests
npx vitest run test/core          # Core tests only
npx vitest run test/obsidian      # Adapter tests only

# Quality
npm run lint                      # ESLint
npm run build                     # TypeScript check + esbuild

# Full validation
npm run build && npx vitest run && npm run lint
```

---

## Implementation Phases

Each phase is defined in a separate file. Tasks follow red-green-refactor: **Prime** (understand context), **Test** (red), **Implement** (green), **Validate** (refactor + verify).

> **Tracking Principle**: Track logical units that produce verifiable outcomes. The TDD cycle is the method, not separate tracked items.

- [x] [Phase 1: Core Fixes](phase-1.md)
- [x] [Phase 2: Settings UI](phase-2.md)
- [ ] [Phase 3: Documentation & Integration](phase-3.md)

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
| All phase files exist and are linked from this manifest as `[Phase N: Title](phase-N.md)` | ✅ |
