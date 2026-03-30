# Context — Kado
<!-- Current sprint focus, active work, known blockers. Updated: 2026-03-30 -->
<!-- This file is short-lived — prune entries older than 2 weeks via /memory-cleanup -->

<!-- 2026-03-30 -->
- Testing and release automation now in place. Next: rename sample classes (6 pre-existing lint errors from obsidianmd/sample-names rule) and start building actual plugin features
- GitHub Secrets needed: `GITHUB_TOKEN` (auto-provided by Actions) — no `NPM_TOKEN` needed since npm publish is disabled
- Test vault at `test/MiYo-Kado/` has hot-reload configured — Obsidian only to be used after consultation
