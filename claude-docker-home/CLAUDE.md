# Kado — Docker (secure)

> Running inside a Docker container. Repo mounted at /Volumes/Moon/Coding/MiYo/Kado.
> Home directory (`/home/coder`) is `claude-docker-home/` from the host repo.

## Environment

- Node.js 22, zsh, git, python3, gh, ripgrep, fd, fzf, yq, git-delta available
- Working directory: /Volumes/Moon/Coding/MiYo/Kado
- Home: /home/coder (mounted from claude-docker-home/)
- Kouzou config: /home/coder/Kouzou/ (read-only)
- Variant: secure

## Rules

- English for all code and technical documentation
- Use Plan Mode for any change touching more than 2 files
- Commit after every completed task

## Plugins

Plugins are pre-configured in `~/.claude/settings.json` (`enabledPlugins`).
Claude Code installs them automatically on first session start.
If plugins are missing, run `/setup-docker-home`.

## Always

- Use Plan Mode before tasks touching more than 2 files
- Commit after every completed task
- English for all code and technical documentation
- Update memory files as you go — not at end of session
- Limit each change to one feature or one fix.
- The development environment is the current macOS, always consider special deviations because of that.
- When shipping a feature or fix, always update the README and any relevant documentation; reference GitHub issue numbers where appropriate.
- Before editing any file make sure that they are tracked in git and are in a clean state.


## Tone & Behavior

- Be concise — short summaries, no extended breakdowns unless working through a plan
- No flattery or compliments unless judgment is specifically requested
- Tell me when I'm wrong or when there's a better approach
- Point out relevant standards or conventions I appear unaware of
- When in doubt, ask — don't guess intent

## Code Conduct

- Prefer self-documenting code over comments; only comment non-obvious logic, deviations, or gotchas
- Use complete, descriptive variable names: `calculateTotalPrice` not `calc`
- Read and inspect files before proposing changes — never speculate about unread code
- Do what was asked; nothing more, nothing less
- When intent is ambiguous, default to information and recommendations — only edit when explicitly asked
- Use parallel tool calls for independent operations
- Before creating new functions or utilities, check existing codebase for reusable implementations
- NEVER create files unless absolutely necessary — always prefer editing existing files
- While working: flag potential issues with error handling, edge cases, security, and conflicts with existing patterns
- Add a short description if possible into any file which explains why the file exists.
- Use the clean architecture and clean code principle.
- Root Cause Analysis before Test Fixing

## Tool Usage

| Task | Use | Not |
|---|---|---|
| Find files | `fd 'pattern' src/` | ~~find~~ |
| Search content | `rg "pattern" src/` | ~~grep -r~~ |
| List all files | `rg --files` or `fd . -t f` | ~~ls -R~~ |
| Show directories | `fd . -t d` | ~~find -type d~~ |

Start broad, then narrow: `rg "partial" | rg "specific"`

## Workflows

### Code Change Workflows

Three standard workflows based on change size. Choose the one that fits.

#### 1. Small Feature / Bugfix (1-2 files)

1. Branch: `feature/<topic>` or `fix/<topic>`
2. Plan: brief plan in chat (Plan Mode if touching >2 files)
3. Change: one feature or fix per task — no mixed commits
4. Test: targeted tests (not the full suite unless quick)
5. Commit: `feat: …` or `fix: …`, referencing issues where applicable

#### 2. Medium Refactoring (multiple files, one module)

1. Branch: `refactor/<area>`
2. Plan: list affected modules/files and the goal
3. Change: work in logical steps — types/API first, then implementation, then call-sites. Address related issues in one pass, not piecemeal.
4. Test: module tests + brief end-to-end smoke
5. Commits: one clean refactor commit, or 2-3 logically separated commits (rename+move, implementation, cleanup)

#### 3. Large Change / Re-Architecture

1. Branch: `spike/<topic>` for exploration phase
2. Spike: prototype in a spike branch — goal is understanding, not merge-ready quality
3. Decide: document findings in an ADR or project rule file
4. Implement: new branch `feature/<topic>-impl`, clean implementation based on spike learnings
5. Test: thorough testing with migration steps if applicable


## Git Conventions

Conventional Commits: `<type>(<scope>): <subject>`
- Types: `feat` | `fix` | `docs` | `style` | `refactor` | `test` | `chore` | `perf`
- Subject: imperative mood, no period
- Complex changes: add body explaining what/why; reference issues
- Keep commits atomic — split by concern
- Branch naming: `feature/<topic>`, `fix/<topic>`, `refactor/<area>`, `spike/<topic>`
- Commit subject line is max 72 characters