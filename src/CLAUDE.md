# src/ — Code Area Rules

## TDD
- RED: Write failing test first. No implementation before a failing test.
- GREEN: Minimal code to make the test pass. Nothing more.
- REFACTOR: Clean up only after GREEN. Run tests again.

## Contracts
- Domain rules live in docs/ai/memory/domain.md — link implementations to these
- Public interfaces must match the SDD contract

## Conventions
<!-- Stack-specific import order, module conventions -->

## TypeScript Rules
- Strict mode: `"strict": true` in tsconfig — no exceptions
- No `any` — use `unknown` + narrowing or define a proper type
- Import order: node builtins → external → internal (enforced by ESLint/biome)
- Prefer explicit return types on public functions
