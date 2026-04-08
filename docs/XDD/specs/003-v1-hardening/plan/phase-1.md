# Phase 1 — L4 Glob Pattern Validation

**Spec refs:** PRD Feature 4, SDD §2.1

## Tasks

1. **Implement validator** in `src/core/glob-match.ts`
   - Export `GlobValidationResult` type
   - Export `validateGlobPattern(pattern: string): GlobValidationResult`
   - Length check >256, consecutive `**` check, bare `**` warning

2. **Unit tests** in `test/core/glob-match.test.ts`
   - Table-driven cases: valid, too-long, too-deep, bare-warning
   - Edge cases: empty string, exactly 256 chars, exactly 3 consecutive `**`

3. **Integrate into PathEntry** in `src/settings/components/PathEntry.ts`
   - Call `validateGlobPattern(rule.path)` in the input change handler
   - On error: show inline error via existing error path, do not propagate `onChange`
   - On warning: surface via Notice (Obsidian API) or existing warning UI path

## Files touched

- `src/core/glob-match.ts` (+validator)
- `src/settings/components/PathEntry.ts` (integration)
- `test/core/glob-match.test.ts` (+tests)

## Acceptance

- All PRD Feature 4 acceptance criteria pass
- `npm test`, `npm run lint`, `npm run build` green

## Commit

`feat(security): validate glob patterns to prevent regex backtracking (L4)`
