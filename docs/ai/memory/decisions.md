# Decisions — Kado
<!-- Architecture choices and rationale. Updated: 2026-03-30 -->
<!-- What goes here: why we chose X over Y, ADR links, significant tradeoff choices -->
<!-- Format: YYYY-MM-DD — Decision: [what] — Rationale: [why] -->

<!-- 2026-03-30 -->
- 2026-03-30 — Decision: **Vitest over Jest** — Rationale: ESM-native, fast startup, good TypeScript integration without extra transform config. jsdom for DOM environment since plugin uses Obsidian UI APIs
- 2026-03-30 — Decision: **Obsidian API mock via Vitest alias** — Rationale: Obsidian can only be used after consultation; mock allows unit testing without Obsidian runtime. Alias in vitest.config.ts redirects `obsidian` imports to `test/__mocks__/obsidian.ts`
- 2026-03-30 — Decision: **semantic-release (Dynbedded pattern)** — Rationale: Reference repo obsidian-dynbedded uses same approach. Conventional Commits drive automatic versioning, changelog, and GitHub Release with plugin assets. No npm publish needed
- 2026-03-30 — Decision: **Build output to `build/` for releases** — Rationale: Separates dev output (root `main.js` for hot-reload) from release artifacts (build/ dir with all assets for GitHub Release upload)
