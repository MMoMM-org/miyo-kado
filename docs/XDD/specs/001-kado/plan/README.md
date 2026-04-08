---
title: "Kado v1 — Obsidian MCP Gateway Plugin"
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
- `docs/XDD/specs/001-kado/prd.md` — Product Requirements (21 must-have features, acceptance criteria)
- `docs/XDD/specs/001-kado/solution.md` — Solution Design (4-layer architecture, interfaces, ADRs)
- `docs/XDD/adr/MCP Server with Payload Versioning and Anti-Corruption Layer.md` — ADR-001: Dual ACL
- `Constitution.md` — Project governance rules (L1/L2/L3)

**Key Design Decisions**:
- **ADR-1**: Dual ACL — Core has no MCP or Obsidian imports. Two ACL layers translate at boundaries.
- **ADR-2**: Streamable HTTP — `NodeStreamableHTTPServerTransport` via Express.js on configurable host:port.
- **ADR-3**: Fat Tools — 3 MCP tools (`kado-read`, `kado-write`, `kado-search`) with JSON `operation` sub-routing.
- **ADR-4**: Chain of Responsibility — 5 sequential permission gates, short-circuit on denial.
- **ADR-7**: Self-parsed Dataview — Regex-based parsing of 3 inline field variants, no Dataview dependency.
- **ADR-8**: Timestamp concurrency — Writes require `expectedModified` matching `file.stat.mtime`.

**Implementation Context**:
```bash
# Testing
npm test                    # vitest run
npm run test:watch          # vitest watch
npm run test:coverage       # vitest with v8 coverage

# Quality
npm run lint                # eslint .
npm run build               # tsc -noEmit + esbuild production

# Development
npm run dev                 # esbuild watch → ./main.js (hot-reload)
```

---

## Implementation Phases

Each phase is defined in a separate file. Tasks follow red-green-refactor: **Prime** (understand context), **Test** (red), **Implement** (green), **Validate** (refactor + verify).

> **Tracking Principle**: Track logical units that produce verifiable outcomes. The TDD cycle is the method, not separate tracked items.

- [x] [Phase 1: Foundation — Types, Config, Plugin Scaffold](phase-1.md)
- [x] [Phase 2: Core — Permission Gates & Operation Routing](phase-2.md)
- [x] [Phase 3: Obsidian Interface — Vault Adapters](phase-3.md)
- [x] [Phase 4: MCP Layer — Server, Tools & Auth](phase-4.md)
- [x] [Phase 5: Settings UI](phase-5.md)
- [x] [Phase 6: Integration, Audit & Polish](phase-6.md)

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
