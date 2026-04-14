# Tools — Kado
<!-- CI, build pipeline, API clients, local dev setup. Updated: 2026-04-14 -->
<!-- What goes here: commands that are non-obvious, tool quirks, CI gotchas, env var names -->
<!-- What does NOT go here: domain rules (→ domain.md), code style (→ general.md) -->

<!-- 2026-03-30 -->
- **Test Runner:** Vitest with jsdom environment. Obsidian API mocked via alias in `vitest.config.ts` → `test/__mocks__/obsidian.ts`. Run: `npm test`, `npm run test:watch`, `npm run test:coverage`
- **Build Output:** Production build (`npm run build`) writes to `build/` directory (main.js + manifest.json + styles.css via esbuild copy-assets plugin). Dev build writes to root `main.js`
- **Release Automation:** semantic-release on push to master. Config in `.releaserc.json`. Requires Conventional Commits. Plugins: commit-analyzer, changelog, npm (no publish), exec (version-bump.mjs), git, github (uploads build/ assets)
- **CI Workflows:** `lint.yml` runs build + test + lint on all branches (Node 20/22). `release.yml` runs build + test + semantic-release on master only
- **ESLint Ignores:** `claude-docker-home/`, `test/MiYo-Kado/`, `test/__mocks__/`, `test/**/*.test.ts`, `build/` are all globally ignored in eslint.config.mts
- **@types/node:** Bumped to ^22.0.0 (required by vitest peer dependency)

<!-- 2026-04-14 -->
- **Hot-Reload Mechanik (TestVault):** Das `hot-reload` Plugin im TestVault watched `main.js` und `styles.css` auf mtime-Änderungen (nicht `data.json`). Ein touch/utimesSync auf `main.js` triggert einen vollständigen disable→enable Zyklus, der auch `data.json` neu lädt. Funktioniert in macOS und Docker (solange Plugin-Verzeichnis gemountet). Nutzung in Tests: nach Config-Änderung `utimesSync(main.js)` + ~5s warten. Ersetzt manuelles Reload in Obsidian. (Alter Eintrag "hot-reload does not detect copied files" war falsch.)
