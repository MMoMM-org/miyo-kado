---
title: "Kado v1 Hardening — Implementation Plan"
status: active
version: "1.0"
---

# Implementation Plan

## Phases

| # | Phase | Status | File | Size |
|---|-------|--------|------|------|
| 1 | L4 Glob validation | pending | [phase-1.md](phase-1.md) | S |
| 2 | L8 Rate-limit eviction | pending | [phase-2.md](phase-2.md) | S |
| 3 | M6 Single key resolution | pending | [phase-3.md](phase-3.md) | M |
| 4 | H5 Audit buffer | pending | [phase-4.md](phase-4.md) | M |
| 5 | M18 Settings UI tests | pending | [phase-5.md](phase-5.md) | L |

## Phase gate

Each phase ends with:
- `npm run lint` — clean
- `npm test` — all pass
- `npm run build` — typecheck + bundle succeed
- Commit pushed
- CI green on GitHub before next phase starts

## References

- PRD: [requirements.md](../requirements.md)
- SDD: [solution.md](../solution.md)
