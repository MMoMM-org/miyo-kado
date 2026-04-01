# Tools — Kado
<!-- CI, build pipeline, API clients, local dev setup. Updated: 2026-03-30 -->
<!-- What goes here: commands that are non-obvious, tool quirks, CI gotchas, env var names -->
<!-- What does NOT go here: domain rules (→ domain.md), code style (→ general.md) -->

<!-- 2026-03-30 -->
- **Test Runner:** Vitest with jsdom environment. Obsidian API mocked via alias in `vitest.config.ts` → `test/__mocks__/obsidian.ts`. Run: `npm test`, `npm run test:watch`, `npm run test:coverage`
- **Build Output:** Production build (`npm run build`) writes to `build/` directory (main.js + manifest.json + styles.css via esbuild copy-assets plugin). Dev build writes to root `main.js`
- **Release Automation:** semantic-release on push to master. Config in `.releaserc.json`. Requires Conventional Commits. Plugins: commit-analyzer, changelog, npm (no publish), exec (version-bump.mjs), git, github (uploads build/ assets)
- **CI Workflows:** `lint.yml` runs build + test + lint on all branches (Node 20/22). `release.yml` runs build + test + semantic-release on master only
- **ESLint Ignores:** `claude-docker-home/`, `test/MiYo-Kado/`, `test/__mocks__/`, `test/**/*.test.ts`, `build/` are all globally ignored in eslint.config.mts
- **Test Vault Plugin Update:** The test vault (`test/MiYo-Kado/.obsidian/plugins/miyo-kado/`) uses symlinks to root `main.js`, `styles.css`, `manifest.json`. The root `main.js` is only auto-updated when the **build tracker** (`npm run dev`) is running. Without it, `main.js` must be manually copied from `build/` after `npm run build`.
- **@types/node:** Bumped to ^22.0.0 (required by vitest peer dependency)
