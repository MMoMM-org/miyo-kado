---
title: "UI Settings Rework"
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
- `docs/XDD/specs/002-ui-settings-rework/requirements.md` — Product Requirements
- `docs/XDD/specs/002-ui-settings-rework/solution.md` — Solution Design

**Key Design Decisions**:
- **ADR-1**: Settings file decomposition — Split `settings.ts` into `settings/SettingsTab.ts` + `tabs/` + `components/`
- **ADR-2**: Data model extensions — Extend GlobalArea (listMode, tags), AuditConfig (logDirectory, logFileName, maxRetainedLogs), KeyAreaConfig (tags)
- **ADR-3**: Obsidian Modal for pickers — Use `Modal` class for folder and tag pickers
- **ADR-4**: Tag storage — Store without `#`, normalize on input, `getAllTags()` for merged set, wildcard `*` at end only
- **ADR-5**: Whitelist/blacklist scope-level — `listMode` on GlobalArea, applies to both paths and tags

**Implementation Context**:
```bash
# Testing
npx vitest                 # Unit tests
npx vitest run             # Single run

# Quality
npm run lint               # ESLint
npm run build              # TypeScript check + esbuild production

# Development
npm run dev                # esbuild watch mode

# Live testing
# See docs/live-testing.md for Obsidian test vault setup
```

---

## Implementation Phases

Each phase is defined in a separate file. Tasks follow red-green-refactor: **Prime** (understand context), **Test** (red), **Implement** (green), **Validate** (refactor + verify).

> **Tracking Principle**: Track logical units that produce verifiable outcomes. The TDD cycle is the method, not separate tracked items.

- [ ] [Phase 1: Data Model & Config Extensions](phase-1.md)
- [ ] [Phase 2: Reusable UI Components](phase-2.md)
- [ ] [Phase 3: Settings Tabs](phase-3.md)
- [ ] [Phase 4: Wiring & Audit Migration](phase-4.md)
- [ ] [Phase 5: Integration Testing & Polish](phase-5.md)

---

## Plan Verification

Before this plan is ready for implementation, verify:

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
