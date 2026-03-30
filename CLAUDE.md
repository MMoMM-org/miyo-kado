# Kado — Obsidian Plugin

## Memory & Context
@docs/ai/memory/memory.md

## Routing Rules
<!-- Run /memory-add to capture learnings. Routing reference: docs/ai/memory/routing-reference.md -->
- Personal/workflow corrections → global (~/.claude/includes/)
- Repo conventions/style → docs/ai/memory/general.md
- Tool/CI/build knowledge → docs/ai/memory/tools.md
- Domain/business rules → docs/ai/memory/domain.md
- Architectural decisions → docs/ai/memory/decisions.md
- Current focus/blockers → docs/ai/memory/context.md
- Bugs/fixes → docs/ai/memory/troubleshooting.md

## Build & Dev Commands
- `npm run build` — TypeScript check + esbuild production build
- `npm run dev` — esbuild dev/watch mode
- `npm run lint` — ESLint

## Known Quirks
<!-- Non-obvious gotchas specific to this repo -->

---

# Project Context

This project runs in a security-hardened Docker environment.

## Environment
- Working directory in container: /repo
- Node.js 20 (slim), git, python3, pipx available
- ClamAV antivirus active (2x daily DB update + scan)
- npm lifecycle scripts disabled (supply chain protection)
- Socket CLI active for package scanning

## Authentication

Claude Code uses Claude Pro subscription (OAuth), not an API key.
Auth state persists via the `.claude/` volume mount.

### How it works

Inside the container, Claude Code expects its config at `~/.claude.json`
(`/home/coder/.claude.json`). The setup mounts `.claude/` as `/home/coder/.claude/`
and symlinks `.claude/.claude.json → /home/coder/.claude.json` on startup, so
the file survives container restarts.

### First run (no auth state yet)

**Recommended — copy from macOS (no OAuth flow needed):**
\`\`\`bash
cp ~/.claude.json .claude/.claude.json
\`\`\`
Then run `./begin-code.sh`. Claude Code finds the auth state immediately.

**Alternative — OAuth inside the container:**
Run `./begin-code.sh` without copying first. The script detects missing auth,
exposes port 10000, and starts the container. Run `claude login` inside —
when the browser opens the OAuth URL, the callback can reach the container on
port 10000. After login, `.claude/.claude.json` is written and persists.

Note: Docker OAuth sometimes shows "Invalid OAuth Request / Missing state
parameter". If that happens, use the copy method above.

## Security Hooks
- **PreToolUse**: Blocks dangerous flags, pipe-to-shell patterns,
  rm on critical directories, chmod 777, credential leaks,
  unsafe npm/bun packages via Socket CLI
- **PostToolUse**: ClamAV scan after downloads/installs
- **Session Cleanup** (3x daily): Credential scrubbing from transcripts,
  zombie process cleanup, old snapshot deletion

## Important Rules
- Never store credentials in files — use `claude login` for authentication
- No pipe-to-shell patterns (curl|bash etc.)
- No world-writable permissions (chmod 777)
