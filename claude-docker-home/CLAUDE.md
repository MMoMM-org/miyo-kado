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

## Memory

Rules and preferences are in `~/.claude/rules/`:
- `memory-profile.md` — who this developer is
- `memory-preferences.md` — style and workflow preferences
