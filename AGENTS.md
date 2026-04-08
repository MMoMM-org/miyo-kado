# AGENTS.md — Kado

Guidance for AI coding agents (Claude Code, Cursor, Codex, Aider, etc.) working on this repo.
Claude Code users: `CLAUDE.md` is the primary entry point and takes precedence.

## What Kado is

Kado is an Obsidian community plugin that exposes a **security-first [Model Context Protocol](https://modelcontextprotocol.io/) server** for the user's vault. It gives AI assistants controlled, granular access to notes, frontmatter, files, and Dataview inline fields through three MCP tools: `kado-read`, `kado-write`, `kado-search`.

Every request passes through **five permission gates** (authenticate → global-scope → key-scope → datatype-permission → path-access). Default-deny. See `README.md` for the full security model.

## Repo layout

```
src/
  main.ts           # Obsidian plugin lifecycle only — keep minimal
  core/             # Permission gates, routing, concurrency. No MCP or Obsidian imports.
  mcp/              # MCP API handler: Express + Streamable HTTP, auth, rate limiting
  obsidian/         # Vault adapters (notes, frontmatter, files, inline fields, search)
  settings/         # Settings UI and persistence
  types/            # Shared TypeScript types
docs/
  configuration.md  # Vault owners: installation, settings, API keys
  api-reference.md  # MCP client developers: tool schemas, errors
  development.md    # Contributors: build, test, lint, architecture, live testing
  live-testing.md   # How to test against a real Obsidian vault
  ai/memory/        # Persistent project memory (see CLAUDE.md routing rules)
```

Clean architecture applies: `core/` must not import from `mcp/` or `obsidian/`. Adapters depend inward, never outward.

## Build, test, lint

```bash
npm run build    # tsc --noEmit + esbuild production bundle
npm run dev      # esbuild watch mode
npm test         # vitest (unit/integration)
npm run test:live    # live tests against a real vault — see docs/live-testing.md
npm run lint     # ESLint
```

Before any PR: `npm run build && npm test && npm run lint` must pass.

## Conventions

- **TypeScript strict mode**. No implicit `any`.
- **One feature or one fix per change.** Don't bundle unrelated work.
- **Conventional commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Release notes are generated from history.
- **English only** in code, comments, and commit messages.
- **File header**: add a short comment at the top of new files explaining *why* the file exists.
- **Don't commit build artifacts**: `main.js`, `node_modules/`, `dist/`.
- **Never change `manifest.json` `id`** — it's stable API after release.
- **Don't introduce network calls** outside the MCP server itself without explicit justification. Kado is local-first.
- **Register cleanup**: use `this.register*` helpers for DOM listeners, events, and intervals so unload is clean.

## Security rules (non-negotiable)

- **Default-deny stays default-deny.** Any change that loosens a permission gate requires explicit review.
- **Audit log is metadata-only** — never log note content, frontmatter values, or file bytes.
- **Path traversal checks** live in gate 4 (`path-access`). Don't bypass them for "internal" callers.
- **Rate limiting** (200 req/min/IP) must not be disabled in production code paths.
- **Secrets**: API keys are stored via Obsidian's `loadData`/`saveData`. Never log, echo, or write them to disk elsewhere.

## Agent do / don't

**Do**
- Read `CLAUDE.md`, `docs/development.md`, and the relevant `src/*/CLAUDE.md` before making non-trivial changes.
- Prefer editing existing files over creating new ones.
- Keep `src/main.ts` small — delegate to modules.
- Run the full check suite (`build`, `test`, `lint`) before declaring work done.
- Update `README.md`, `docs/configuration.md`, or `docs/api-reference.md` when user-facing behavior changes.

**Don't**
- Don't add dependencies without a clear reason. Bundle size and supply-chain surface matter.
- Don't weaken permission gates, rate limits, or audit logging.
- Don't commit generated `main.js` or editor workspace files.
- Don't rename stable IDs: plugin `id`, command IDs, MCP tool names.
- Don't introduce Node/Electron-only APIs unless `isDesktopOnly` stays `true` (it currently is).

## Further reading

- `README.md` — feature overview, security model, architecture
- `CLAUDE.md` — Claude Code entry point and memory routing
- `docs/development.md` — contributor guide
- `docs/api-reference.md` — MCP tool schemas and error codes
- `docs/configuration.md` — user-facing setup
- Obsidian plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
