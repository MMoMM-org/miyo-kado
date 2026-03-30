# Routing Reference — Scope × Lifetime × Category

| Learning type | Examples | Target scope | Target file |
|---|---|---|---|
| Personal correction | "stop adding semicolons to commit messages" | global | ~/.claude/includes/memory-*.md |
| Workflow preference | "always use worktrees for features" | global | ~/.claude/includes/memory-*.md |
| Project decision | "we use monorepo for all TCS work" | project | ~/Kouzou/projects/<proj>/memory.md |
| Naming convention | "use kebab-case for all file names" | repo | general.md |
| Code style rule | "no `any` types in TypeScript" | repo | general.md |
| Build command quirk | "use `bun run` not `npm run`" | repo | tools.md |
| CI knowledge | "GitHub Actions cache key is `bun.lock`" | repo | tools.md |
| Business rule | "UserRepository returns null for unknown IDs" | repo | domain.md |
| Data model fact | "Order.status is always lowercase" | repo | domain.md |
| Architecture choice | "chose hexagonal over layered" | repo | decisions.md |
| Tech tradeoff | "using SQLite because low concurrency expected" | repo | decisions.md |
| Current sprint goal | "implementing auth this week" | repo | context.md |
| Known blocker | "bun test crashes on M1 with arm64 native modules" | repo | troubleshooting.md |
| Proven fix | "set NODE_OPTIONS=--max-old-space-size=4096 for builds" | repo | troubleshooting.md |
