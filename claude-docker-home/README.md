# Claude Code Home — Kado

This directory is mounted as /home/coder inside the Docker container.
It contains your Claude Code settings, skills, hooks, and plugins for this repo.

## TODO

- [ ] Review CLAUDE.md — does it reflect this repo correctly?
- [ ] Add repo-specific skills to .claude/skills/
- [ ] Add project-specific rules to .claude/rules/
- [ ] Verify memory-profile.md and memory-preferences.md are present
- [ ] Run begin-code.sh and test the environment

## Structure

```
claude-docker-home/
├── CLAUDE.md           — Docker CLAUDE.md (repo-specific)
├── .claude.json        — UI settings (not committed — written by claude login)
├── .claude/
│   ├── settings.json   — Claude Code settings (statusline, hooks, plugins)
│   ├── hooks/          — dev-notify-bridge + stop-reflect
│   ├── skills/         — repo-specific skills
│   ├── rules/          — memory-profile.md, memory-preferences.md (not committed)
│   └── the-custom-startup-statusline-*.sh
└── .config/the-custom-startup/statusline.toml
```
